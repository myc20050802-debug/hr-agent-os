#!/usr/bin/env node
/**
 * HR-Agent OS · 筛选质量评测（黄金集 + 一致率接口）
 * -----------------------------------------------------------
 * 背景：在此之前，项目只能回答「筛选跑没跑通」，回答不了「筛得准不准」。
 * 面试里被问一句「准确率多少」就卡住 —— 因为根本没有评测集。
 * 本套件补上这块，并用**同一份规则逻辑**（server/engine.js 的 evaluateCandidate）
 * 跑评测，确保「评测里说的」和「线上做的」是一回事（不是两套实现各说各话）。

 * A 部分 · 离线黄金集（不依赖后端）
 *   读取 tools/golden/golden_set.json：3 个岗位 × 10 份人工标注简历 = 30 例。
 *   逐例调用 evaluateCandidate（= 硬性门槛 ruleGate + 四维打分 scoreOne），
 *   与人工标签比对，输出四项指标：
 *     档位一致率   完全同档（strong/ok/no）的比例
 *     ±1 档一致率  档位距离 ≤ 1 的比例（差一档算「接近」，不算硬错）
 *     漏筛率       人工认为该通过（strong/ok）却被 AI 判 no 的比例  ← 安全红线
 *     误筛率       人工认为该淘汰（no）却被 AI 判 strong/ok 的比例  ← 成本问题
 *   口径说明：漏筛 = 把好苗子漏掉；误筛 = 把不该推的放了进来。
 *   两者的严重性不对称：漏筛是「悄悄杀掉机会」，误筛只是「多进一轮人工」。
 *   所以本套件把「漏筛率必须为 0」写成硬断言 —— 它是回归红线。

 * A4 部分 · 基线守卫（比对 tools/golden/baseline.json；--write-baseline 刷新）
 * B 部分 · 一致率接口与推翻原因枚举（需要后端，BASE 环境变量）
 *   验证 override_code 枚举校验、三种人工结论的落库与方向自洽，
 *   以及 /api/metrics/agreement 的算术是否与真实操作一致。

 * 零依赖。经一键回归运行：node tools/run_all.js --only backend
 * 单独运行（需要 sqlite 实验标志）：node --experimental-sqlite tools/test_eval.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const PW = process.env.DEMO_PASSWORD || 'Demo@2026';
/* 评测数字的唯一源（README / 文档由 check_docs.js 按它校验） */
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const BASELINE_FILE = path.join(__dirname, 'golden', 'baseline.json');

const engine = require(path.join(ROOT, 'server', 'engine.js'));
const OC = require(path.join(ROOT, 'shared', 'override-codes.js'));

let pass = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
};
const eq = (name, got, want) => ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
const section = t => console.log('\n=== ' + t + ' ===');
const pct = x => (x * 100).toFixed(1) + '%';

/* 档位 → 序号，用于算「差几档」 */
const RANK = { no: 0, ok: 1, strong: 2 };

/* ---------- HTTP 客户端（Part B） ---------- */
let cookie = '';
async function call(method, url, body) {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; ');
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* 非 JSON */ }
  return { status: r.status, json, text: txt };
}

/* ===========================================================
   A · 黄金集评测
   =========================================================== */
function runGoldenSet() {
  const file = path.join(__dirname, 'golden', 'golden_set.json');
  const G = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cases = G.cases;

  /* ---- A5 · 黄金集口径与配额（rubric v1，源：docs/20） ----
     口径文档是 docs/20；这里只做**能机器校验的部分**：结构完整性 / 枚举合法性 /
     引用有效性 / 分布配额。
     为什么必须有这一段：扩样到 60+ 例时，最大的风险不是「标错一例」，而是
     「标歪了分布」—— 60 例里 50 个 no，指标会好看但毫无判别力。配额底线写在这里，
     扩样时它盯着你别把分布标歪。
     ⚠ 为什么放在**回放之前**：如果 jobId 指向不存在的岗位，下面的回放会直接
     `G.jobs[c.jobId].id` 抛异常崩掉 —— 断言根本没机会跑（这正是
     「看起来在检查、其实观测不到」）。所以校验必须先于消费：结构不过 → 早退不回放。
     诚实说明：difficulty 是新增的分层轴，现有 30 例**尚未回填**，故只校验
     「已声明的取值合法」并打印覆盖率，不硬性要求 30 例全具备（流程规则在 docs/20，
     不做假断言）。 */
  section('A5 · 黄金集口径与配额（rubric v1，源：docs/20）');
  ok('rubricVersion 已声明（口径已冻结）',
    Number.isInteger(G.rubricVersion) && G.rubricVersion >= 1, String(G.rubricVersion));
  ok('rubricDoc 指向人类可读快照且文件存在',
    typeof G.rubricDoc === 'string' && fs.existsSync(path.join(ROOT, G.rubricDoc)), String(G.rubricDoc));
  eq('difficultyLegend 三层齐全', Object.keys(G.difficultyLegend || {}).sort().join(','), 'borderline,clear,trap');
  eq('gradeThresholds 三档齐全', Object.keys(G.gradeThresholds || {}).sort().join(','), 'no,ok,strong');
  const shapeBad = cases.filter(c => !(c.id && c.jobId && c.label && typeof c.labelNote === 'string' && c.labelNote.length > 3));
  ok('每例都带 id / jobId / label / labelNote', shapeBad.length === 0, shapeBad.map(c => c.id || '?').join(','));
  const labelBad = cases.filter(c => !['strong', 'ok', 'no'].includes(c.label));
  ok('label 取值合法（strong / ok / no）', labelBad.length === 0, labelBad.map(c => c.id + ':' + c.label).join(','));
  eq('case id 唯一（无重号）', new Set(cases.map(c => c.id)).size, cases.length);
  const refBad = cases.filter(c => !G.jobs[c.jobId]);
  ok('jobId 无悬空引用（都在 jobs 里）', refBad.length === 0, refBad.map(c => c.id + '→' + c.jobId).join(','));
  ok('声明了 difficulty 的案例取值合法',
    cases.filter(c => c.difficulty).every(c => Object.keys(G.difficultyLegend).includes(c.difficulty)),
    cases.filter(c => c.difficulty && !Object.keys(G.difficultyLegend).includes(c.difficulty)).map(c => c.id).join(','));
  /* ---- 结构错误 ⇒ 早退：回放前必须先有合法的集合 ---- */
  if (shapeBad.length || labelBad.length || refBad.length) {
    console.log('\n  ⚠ 黄金集结构有误（上列 ✗），跳过回放 —— 先修 golden_set.json 再看指标。');
    return null;
  }
  const byJob = {};
  cases.forEach(c => { byJob[c.jobId] = (byJob[c.jobId] || 0) + 1; });
  ok('每岗位例数 ≥ 10（扩样后目标 20）',
    Object.keys(G.jobs).every(j => (byJob[j] || 0) >= 10),
    Object.keys(G.jobs).map(j => j + ':' + (byJob[j] || 0)).join(' '));
  ok('每岗位至少 1 例陷阱探针（probe）',
    Object.keys(G.jobs).every(j => cases.some(c => c.jobId === j && c.probe)),
    Object.keys(G.jobs).map(j => j + ':' + cases.filter(c => c.jobId === j && c.probe).length).join(' '));
  const shareOf = k => cases.filter(c => c.label === k).length / cases.length;
  ok('三档占比均在 [20%, 50%]（分布不极端，指标才有判别力）',
    ['strong', 'ok', 'no'].every(k => shareOf(k) >= 0.2 && shareOf(k) <= 0.5),
    ['strong', 'ok', 'no'].map(k => k + ':' + pct(shareOf(k))).join(' '));
  /* 配额进度（信息性，非致命）：difficulty 覆盖 + 距 60 例目标的差距 */
  console.log('  配额进度（信息性）：difficulty 已回填 ' + cases.filter(c => c.difficulty).length + '/' + cases.length
    + ' · 距 60 例目标还需 ' + Math.max(0, 60 - cases.length) + ' 例'
    + ' · 工作表 tools/golden/labeling_worksheet.csv');

  /* 关键：把黄金集还原成**与数据库行同样的形状**（数组 → JSON 字符串），
     否则 engine 里的 J()（JSON.parse）拿不到数组，评测会因为喂错输入而失真。 */
  const rows = cases.map(c => {
    const job = G.jobs[c.jobId];
    return {
      meta: c,
      cand: {
        id: c.id, name: c.name, years_exp: c.years_exp, edu_rank: c.edu_rank,
        skills: JSON.stringify(c.skills),
        business_tags: JSON.stringify(c.business_tags || []),
        plus_tags: JSON.stringify(c.plus_tags || []),
        parse_ok: 1,
      },
      job: {
        id: job.id, title: job.title, industry: job.industry,
        must_years: job.must_years, must_edu_rank: job.must_edu_rank,
        keywords: JSON.stringify(job.keywords || []),
        must_have: JSON.stringify(job.must_have || []),
        nice_have: JSON.stringify(job.nice_have || []),
        rubric: '{}',
      },
    };
  });

  /* 逐例回放：与线上筛选调用的是同一个 evaluateCandidate */
  const out = rows.map(r => {
    const res = engine.evaluateCandidate(r.cand, r.job);
    const dist = Math.abs(RANK[res.grade] - RANK[r.meta.label]);
    return {
      id: r.meta.id, jobId: r.meta.jobId, name: r.meta.name,
      label: r.meta.label, ai: res.grade, score: res.score, gate: res.gate,
      gateReason: res.gateReason || null,
      dist, probe: !!r.meta.probe, note: r.meta.labelNote,
    };
  });

  const n = out.length;
  const same = out.filter(x => x.dist === 0).length;
  const near = out.filter(x => x.dist <= 1).length;

  /* 漏筛：人工说该通过，AI 说 no —— 只在「非门槛拦截」与「门槛拦截」都算（门槛误杀尤其危险） */
  const shouldPass = out.filter(x => x.label === 'strong' || x.label === 'ok');
  const missed = shouldPass.filter(x => x.ai === 'no');
  /* 误筛：人工说 no，AI 说 strong/ok */
  const shouldReject = out.filter(x => x.label === 'no');
  const overPassed = shouldReject.filter(x => x.ai === 'strong' || x.ai === 'ok');

  const metrics = {
    n,
    exactAgreement: n ? same / n : null,
    within1Agreement: n ? near / n : null,
    missRate: shouldPass.length ? missed.length / shouldPass.length : null,
    falsePassRate: shouldReject.length ? overPassed.length / shouldReject.length : null,
    distribution: {
      strong: out.filter(x => x.ai === 'strong').length,
      ok: out.filter(x => x.ai === 'ok').length,
      no: out.filter(x => x.ai === 'no').length,
    },
    gateBlocked: out.filter(x => x.gate).length,
  };

  /* --------- 打印逐例明细（按岗位分块，便于人工复核） --------- */
  console.log('\n  例号    岗位     人工      AI      分    距离  说明');
  console.log('  ' + '-'.repeat(84));
  for (const x of out) {
    const flag = x.dist === 0 ? ' ' : (x.dist === 1 ? '~' : '!');
    console.log('  ' + flag + ' ' + x.id.padEnd(6) + ' ' + x.jobId.padEnd(8) + ' '
      + x.label.padEnd(7) + ' ' + (x.ai + (x.gate ? '(门槛)' : '')).padEnd(8) + ' '
      + String(x.score).padStart(4) + '   ' + String(x.dist).padStart(2) + '    '
      + (x.probe ? '[探针] ' : '') + (x.dist === 0 ? '' : x.note));
  }

  console.log('\n  ---- 指标（口径：漏筛=把好苗子漏掉；误筛=把不该推的放进来） ----');
  console.log('  样本数            ' + n);
  console.log('  档位分布(人工)    strong ' + cases.filter(c => c.label === 'strong').length
    + ' / ok ' + cases.filter(c => c.label === 'ok').length
    + ' / no ' + cases.filter(c => c.label === 'no').length);
  console.log('  档位分布(AI)      strong ' + metrics.distribution.strong
    + ' / ok ' + metrics.distribution.ok + ' / no ' + metrics.distribution.no
    + '   （其中硬性门槛拦截 ' + metrics.gateBlocked + ' 例）');
  console.log('  档位一致率        ' + pct(metrics.exactAgreement) + '  (' + same + '/' + n + ')');
  console.log('  ±1 档一致率       ' + pct(metrics.within1Agreement) + '  (' + near + '/' + n + ')');
  console.log('  漏筛率            ' + pct(metrics.missRate) + '  (' + missed.length + '/' + shouldPass.length + ' 该通过被误杀)');
  console.log('  误筛率            ' + pct(metrics.falsePassRate) + '  (' + overPassed.length + '/' + shouldReject.length + ' 该淘汰被放行)');
  if (missed.length) console.log('  ⚠ 漏筛明细：' + missed.map(x => x.id + '(' + x.label + '→' + x.ai + (x.gate ? ' 门槛:' + x.gateReason : '') + ')').join('、'));

  const bad = out.filter(x => x.dist > 0);
  if (bad.length) {
    console.log('  不一致明细（' + bad.length + ' 例）：');
    bad.forEach(x => console.log('    · ' + x.id + ' 人工=' + x.label + ' AI=' + x.ai + '（' + x.score + '）'
      + (x.probe ? ' [探针]' : '') + ' — ' + x.note));
  }

  /* --------- 断言：既是验收，也是回归红线 --------- */
  section('A · 黄金集评测（30 例人工标注）');
  eq('黄金集样本数为 30', n, 30);
  eq('覆盖 3 个岗位', new Set(cases.map(c => c.jobId)).size, 3);
  eq('三档标签都存在（标签不是单一档）', new Set(cases.map(c => c.label)).size, 3);
  ok('全部 30 例均产出合法档位', out.every(x => ['strong', 'ok', 'no'].includes(x.ai)),
    out.filter(x => !['strong', 'ok', 'no'].includes(x.ai)).map(x => x.ai).join(','));
  ok('全部 30 例均产出 0–100 的分值', out.every(x => Number.isFinite(x.score) && x.score >= 0 && x.score <= 100));
  ok('档位一致率 ≥ 85%', metrics.exactAgreement >= 0.85, pct(metrics.exactAgreement));
  eq('±1 档一致率 = 100%（无跨两档的硬错）', metrics.within1Agreement, 1);
  /* 最要紧的一条：宁可可聊多一点，也不能把合格的人静默杀掉 */
  eq('漏筛率 = 0（没有任何「该通过」被 AI 判 no）', metrics.missRate, 0);
  ok('误筛率 ≤ 30%（错误方向都在安全侧：多进一轮人工，而非漏掉人）',
    metrics.falsePassRate <= 0.3, pct(metrics.falsePassRate));
  /* 探针：三个岗位各 1 例「背景不对口」，人工都标 no。
     v16 前 3 例全部被抬进 ok；加了「技能零命中」相关性门槛后，
     G-J09（前端投 Java，技能 0/6）/ G-P09（算法投产品，技能 0/6）被判 no，
     只剩 G-M09（销售投实施，技能 2/6 —— 客户沟通、培训确实对得上）。
     相关性门槛按设计不触发 M09，它靠业务维度拿满 30 分（保险/直销/地推/团队管理 4 条）
     停在 ok。**这是已知简化**：业务维度数的是「简历声明的业务语境条数」，
     不与该岗位的业务做匹配（见 engine.js:scoreOne 的 bizN）。
     把「剩下的那一个分歧」钉死，防止它悄悄变成更多 —— 也防止有人以为已经全对。 */
  const probeBad = bad.filter(x => x.probe);
  eq('探针分歧从 3 例降至 1 例', probeBad.length, 1);
  eq('仅存的分歧是 G-M09（业务标签全在销售域，业务维度仍给满分 → 已知简化）',
    probeBad.length ? probeBad[0].id : '(无)', 'G-M09');
  ok('所有分歧方向一致：均为 AI 过宽（no→ok），没有 AI 过严',
    bad.every(x => x.label === 'no' && (x.ai === 'strong' || x.ai === 'ok')),
    bad.map(x => x.id + ':' + x.label + '→' + x.ai).join('、'));
  /* 门槛构成：只断言总数太脆（换了哪一类构成看不出来）。分开三条钉住 ——
     技能零命中 6 例里只有 2 例（G-J09/G-P09）原先判错，另外 4 例本来就是 no，
     这道闸只是把它们的分数从「底分堆出来的 43~59」改成诚实的 0。 */
  const gateByKind = { 年限: 0, 学历: 0, 技能: 0 };
  out.filter(x => x.gate).forEach(x => {
    const r = x.gateReason || '';
    if (/年限/.test(r)) gateByKind.年限++;
    else if (/学历/.test(r)) gateByKind.学历++;
    else if (/未命中/.test(r)) gateByKind.技能++;
  });
  eq('门槛拦截例数 = 9（年限 ×2 / 学历 ×1 / 技能零命中 ×6）', metrics.gateBlocked, 9);
  eq('门槛构成：年限 ×2', gateByKind.年限, 2);
  eq('门槛构成：学历 ×1', gateByKind.学历, 1);
  eq('门槛构成：技能零命中 ×6', gateByKind.技能, 6);

  /* v15 · 匹配层口径：跨岗近似词不得靠「前 4 字同头」混进命中。
     G-J09（前端负责人）原先 1/6 命中完全是 JavaScript 借了 Java 的前 4 个字。
     断言写成「与完全不沾边的基准相等 / 与真命中的基准相等」，不写死系数阶梯的数值 ——
     阶梯将来调档时这几条不该跟着红。既锁「不许误命中」，也锁「不许过度收紧」：
     把同词族措辞差异一起杀掉会让匹配层从过宽翻到过窄，那是另一种缺陷。 */
  const evalFor = (skills, kws) => {
    const cand = { id: 'T', name: 'T', years_exp: 3, edu_rank: 2,
      skills: JSON.stringify(skills), business_tags: '[]', plus_tags: '[]', parse_ok: 1 };
    const job = { id: 'T', title: 'T', industry: '互联网', must_years: 3, must_edu_rank: 2,
      keywords: JSON.stringify(kws), must_have: '[]', nice_have: '[]', rubric: '{}' };
    return engine.evaluateCandidate(cand, job);
  };
  const skillScoreOf = (skills, kws) => {
    const r = evalFor(skills, kws);
    /* v16 起「零命中」会被相关性门槛拦下（why 为 null）。A2 要测的是**匹配层**，
       所以每条都额外带一个「必命中锚点」把门槛让开 —— 否则断言会因为「出了门槛」
       而不是因为「匹配层判对了」而变绿，那就成了一条测不到东西的断言。 */
    if (!r.why) return -1;
    return ((r.why.terms || []).find(t => t.dim === '技能匹配') || {}).score;
  };
  const ANCHOR = 'MySQL';                       /* 必命中锚点：只为让开 v16 相关性门槛 */
  const sS = (subject, target) => skillScoreOf([subject, ANCHOR], [target, ANCHOR]);
  const S_HIT = sS('Java', 'Java');              /* 与目标真命中：2/2 */
  const S_MISS = sS('Python', 'Java');           /* 与目标完全不沾边：1/2 */
  section('A2 · 岗位关键词匹配口径（v15）');
  ok('前置校验：真命中的技能分必须高于不沾边（否则下面几条失去判别力）',
    S_HIT > S_MISS, S_HIT + ' vs ' + S_MISS);
  eq('JavaScript 不再借「前 4 字同头」拿到 Java 的技能分', sS('JavaScript', 'Java'), S_MISS);
  eq('React 不再借「前 4 字同头」拿到 Reactive 的技能分', sS('React', 'Reactive'), S_MISS);
  eq('community 不再命中 Unity（左边界）', sS('community', 'Unity'), S_MISS);
  eq('同词族拉丁前缀仍算命中（Spring Cloud ↔ Spring Boot）', sS('Spring Cloud', 'Spring Boot'), S_HIT);
  eq('英文复数仍算命中（agents → agent）', sS('agents', 'agent'), S_HIT);
  eq('粘连写法仍算命中（nodejs → node）', sS('nodejs', 'node'), S_HIT);
  eq('中文短语差异仍算命中（「高并发」↔「高并发、大流量…」）',
    sS('高并发、大流量系统实战经验', '高并发'), S_HIT);

  /* ---- A3 · 相关性门槛（v16） ----
     这道闸的意义：四维都有底分，一份完全不对口的简历靠「业务 30 + 稳定 15 + 加分 15」
     就能顶到 70+。底分机制本身没错（四维全触底 50 分仍在 no 档），
     错的是「技能一个都没命中」这件事没有任何地方表达出来。
     下面既锁「该拦的要拦」，也锁「不该拦的别拦」—— 后者同样重要：
     把「岗位没抽出关键词」或「简历没列技能」当成不匹配，会让整批候选人静默出局。 */
  const gateCand = (skills, extra) => Object.assign({
    id: 'T', name: 'T', years_exp: 5, edu_rank: 3,
    skills: JSON.stringify(skills),
    business_tags: JSON.stringify(['电商', '订单', '支付', '高并发']),
    plus_tags: JSON.stringify(['开源', '专利', '大厂']), parse_ok: 1 }, extra || {});
  const JAVA_KWS = ['Java', 'Spring Boot', 'MySQL', 'Redis', '微服务', '高并发'];
  const gateJob = (kws) => ({ id: 'T', title: '高级 Java 工程师', industry: '互联网',
    must_years: 3, must_edu_rank: 2, keywords: JSON.stringify(kws || JAVA_KWS),
    must_have: '[]', nice_have: '[]', rubric: '{}' });

  section('A3 · 相关性门槛（v16）：技能零命中即出局');
  const gFull = engine.evaluateCandidate(gateCand(JAVA_KWS), gateJob());
  ok('前置校验：技能全命中时该候选人为强档（说明非技能三维确实足以撑到 ok 以上）',
    !gFull.gate && gFull.grade === 'strong', gFull.grade + ' / ' + gFull.score);
  const gZero = engine.evaluateCandidate(gateCand(['JavaScript', 'TypeScript', 'Vue', 'React', 'Node.js']), gateJob());
  eq('技能零命中 ⇒ 档位判 no（原先靠 业务+稳定+加分 顶进 ok）', gZero.grade, 'no');
  eq('技能零命中 ⇒ 走相关性门槛（gate = true）', gZero.gate, true);
  ok('门槛原因写明「一个都未命中」', /未命中/.test(gZero.gateReason || ''), gZero.gateReason || '(空)');
  ok('被拦下的例子里 reasons 标明维度为「相关性门槛」',
    (gZero.reasons || []).some(x => x.dim === '相关性门槛'),
    JSON.stringify((gZero.reasons || []).map(x => x.dim)));
  ok('被拦下时 why 为 null（不给一个「0 分却有完整归因」的假解释）', gZero.why === null);
  /* 反向约束：保守边界 */
  const gOne = engine.evaluateCandidate(gateCand(['Java', 'Android', 'Kotlin']), gateJob());
  ok('命中 1 项就不触发门槛（宁可多聊一轮，不可误杀）', !gOne.gate && gOne.grade !== 'no',
    'gate=' + gOne.gate + ' grade=' + gOne.grade + ' score=' + gOne.score);
  const gNoKw = engine.evaluateCandidate(gateCand(['JavaScript', 'Vue']), gateJob([]));
  ok('岗位没抽出关键词时门槛不触发（不把「判不了」当成「不匹配」）', !gNoKw.gate, 'gate=' + gNoKw.gate);
  const gNoSkill = engine.evaluateCandidate(gateCand([]), gateJob());
  ok('简历没列技能时门槛不触发（不把「没解析出技能」当成「零命中」）', !gNoSkill.gate, 'gate=' + gNoSkill.gate);

  /* ---- A4 · 基线守卫（质量不倒退 / 错误不增长） ----
     为什么需要它：README 与文档里的 96.7% / 0% / 8.3% 过去是**手抄**的，
     改一次口径要人肉去多处同步 —— 实测漏过一次：README 表格已改成 8.3%，
     同一篇正文仍写着「不回避 25% 的误筛率」，两处自相矛盾。
     现在数字只有一个源 tools/golden/baseline.json：
       · 这里守「不许变差」（断言是**单向**的 ≥ / ≤，口径升级让指标变好时不该红，
         变差时必须红 —— 这才是回归红线该有的方向性）；
       · check_docs.js 守「文档必须写对」。
     本段不依赖后端，所以 --write-baseline 只跑黄金集即可刷新基线。 */
  const B = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : null;

  if (WRITE_BASELINE) {
    const snap = {
      schema: 1,
      updatedAt: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) + ' (UTC+8)',
      note: '评测数字的唯一源。README / 文档里的指标由 tools/check_docs.js 按这里校验，'
          + 'tools/test_eval.js 按这里做「质量不倒退、错误不增长」守卫。'
          + '改口径后刷新：node --experimental-sqlite tools/test_eval.js --write-baseline',
      reqLibVer: engine.REQ_LIB_VER,
      goldenSet: { file: 'tools/golden/golden_set.json', version: G.version },
      n, same, near,
      shouldPass: shouldPass.length,
      shouldReject: shouldReject.length,
      missed: missed.length,
      overPassed: overPassed.length,
      /* 存**原值**不存四舍五入后的值：第一版存了 toFixed(4)，
         结果 29/30 → 0.9667 比真实值 0.96666… 略大，守卫立刻报了一次**假红**
         （「不低于基线 96.7% → 96.7%」，两边打印出来一样却不过）。
         原值进 JSON 再读回来是同一个 double，比较是精确的，不需要容差。 */
      exactAgreement: metrics.exactAgreement,
      within1Agreement: metrics.within1Agreement,
      missRate: metrics.missRate,
      falsePassRate: metrics.falsePassRate,
      gates: metrics.gateBlocked,
    };
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(snap, null, 2) + '\n');
    console.log('\n  基线已写入 ' + path.relative(ROOT, BASELINE_FILE)
      + '（REQ_LIB_VER ' + engine.REQ_LIB_VER + '）');
    return metrics;
  }

  section('A4 · 基线守卫（源：' + path.relative(ROOT, BASELINE_FILE) + '）');
  if (!B) {
    ok('基线文件存在（缺失请先跑 --write-baseline）', false, '未找到 ' + BASELINE_FILE);
  } else {
    eq('样本数与基线一致', n, B.n);
    ok('档位一致率不低于基线 ' + pct(B.exactAgreement),
      metrics.exactAgreement >= B.exactAgreement, pct(metrics.exactAgreement));
    ok('±1 档一致率不低于基线 ' + pct(B.within1Agreement),
      metrics.within1Agreement >= B.within1Agreement, pct(metrics.within1Agreement));
    ok('漏筛率不高于基线 ' + pct(B.missRate) + '（安全红线）',
      metrics.missRate <= B.missRate, pct(metrics.missRate));
    ok('误筛率不高于基线 ' + pct(B.falsePassRate),
      metrics.falsePassRate <= B.falsePassRate, pct(metrics.falsePassRate));
    ok('门槛拦截例数不高于基线 ' + B.gates, metrics.gateBlocked <= B.gates, String(metrics.gateBlocked));
    if (engine.REQ_LIB_VER !== B.reqLibVer) {
      console.log('  ⚠ 口径版本已升级（REQ_LIB_VER ' + B.reqLibVer + ' → ' + engine.REQ_LIB_VER
        + '）：确认指标变化是有意的，再跑 --write-baseline 刷新基线，并重跑 npm run check:docs');
    }
  }

  /* 把评测结果落盘，供 README / 文档引用（同一份数字，不手抄） */
  const report = {
    generatedAt: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' (UTC+8)',
    goldenSet: { file: 'tools/golden/golden_set.json', version: G.version, n },
    metrics, mismatches: bad.map(x => ({ id: x.id, jobId: x.jobId, human: x.label, ai: x.ai, score: x.score, probe: x.probe, note: x.note })),
    perCase: out,
  };
  const outFile = path.join(ROOT, '_eval_result.json');
  try { fs.writeFileSync(outFile, JSON.stringify(report, null, 2)); console.log('\n  评测结果已写入 ' + path.relative(ROOT, outFile)); }
  catch (e) { console.log('  （结果落盘失败：' + e.message + '）'); }

  return metrics;
}

/* ===========================================================
   B · 一致率接口与推翻原因枚举
   =========================================================== */
async function runApiSuite() {
  section('B · 一致率接口与推翻原因枚举（真后端 ' + BASE + '）');

  const me = await call('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
  eq('以 U-001（HRD）登录成功', me.status, 200);

  const boot0 = await call('GET', '/api/bootstrap');
  ok('bootstrap 下发推翻原因枚举（前端不再自造一份）',
    boot0.json && boot0.json.overrideCodes && boot0.json.overrideCodes.codes.length >= 5,
    'codes=' + (boot0.json && boot0.json.overrideCodes ? boot0.json.overrideCodes.codes.length : 'null'));
  ok('枚举含「关键词误命中」等可归因条目',
    boot0.json && boot0.json.overrideCodes.codes.some(c => c.code === 'keyword_fuzzy'));

  /* 空样本：一致率应为 null 并给出说明 —— 不编一个 0% 糊弄 */
  const ag0 = await call('GET', '/api/metrics/agreement');
  eq('一致率接口可访问', ag0.status, 200);
  eq('无人工结论时样本数 = 0', ag0.json.agreement.samples, 0);
  eq('无样本时一致率为 null（不编数字）', ag0.json.agreement.agreementRate, null);
  ok('无样本时返回明确说明', typeof ag0.json.agreement.note === 'string' && ag0.json.agreement.note.length > 5);

  /* 先跑一次筛选，制造带档位的候选人 */
  const run = await call('POST', '/api/agent/screening/run', { jobId: 'J-118' });
  eq('运行 J-118 筛选成功', run.status, 200);

  const boot = await call('GET', '/api/bootstrap');
  const cands = (boot.json.candidates || []).filter(c => c.jobId === 'J-118' && c.grade);
  ok('筛选后 J-118 候选人带上了 AI 档位', cands.length > 0, 'count=' + cands.length);
  const noCand = cands.find(c => c.grade === 'no');
  const advCand = cands.find(c => c.grade === 'strong' || c.grade === 'ok');
  ok('存在被判 no 的候选人（供方向校验用例）', !!noCand);
  ok('存在被判 strong/ok 的候选人（供方向校验用例）', !!advCand);

  /* --- 入参校验 --- */
  const r1 = await call('POST', '/api/candidates/' + (advCand ? advCand.id : 'X') + '/override', { decision: 'whatever', reason: 'x', overrideCode: 'other' });
  eq('非法 decision 被拒（400）', r1.status, 400);
  const r2 = await call('POST', '/api/candidates/' + advCand.id + '/override', { decision: 'rejected_by_human', reason: 'x' });
  eq('推翻但缺原因码被拒（400）', r2.status, 400);
  const r3 = await call('POST', '/api/candidates/' + advCand.id + '/override', { decision: 'rejected_by_human', reason: 'x', overrideCode: 'not_a_code' });
  eq('非法原因码被拒（400）', r3.status, 400);
  const r4 = await call('POST', '/api/candidates/' + advCand.id + '/override', { decision: 'rejected_by_human', overrideCode: 'biz_overrated' });
  eq('推翻但缺原因文本被拒（400）', r4.status, 400);

  /* --- 方向自洽：AI 判 no 时「人工否决」不构成推翻 --- */
  const r5 = await call('POST', '/api/candidates/' + noCand.id + '/override', { decision: 'rejected_by_human', reason: '重复否决', overrideCode: 'other' });
  eq('方向不符（AI 已判 no 又称人工否决）被拒（400）', r5.status, 400);
  const r6 = await call('POST', '/api/candidates/' + advCand.id + '/override', { decision: 'approved_by_human', reason: '方向不符', overrideCode: 'other' });
  eq('方向不符（AI 已判推进又称人工推进）被拒（400）', r6.status, 400);

  /* --- 三种人工结论各写一条 --- */
  const o1 = await call('POST', '/api/candidates/' + noCand.id + '/override', { decision: 'approved_by_human', reason: '年限卡得过死，项目经历其实很扎实', overrideCode: 'gate_too_strict' });
  eq('推翻（过严方向）写入成功', o1.status, 200);
  eq('推翻返回原因码回执', o1.json.overrideCode, 'gate_too_strict');

  const o2 = await call('POST', '/api/candidates/' + advCand.id + '/override', { decision: 'rejected_by_human', reason: '标签堆得多，实际业务深度不足', overrideCode: 'biz_overrated' });
  eq('推翻（过宽方向）写入成功', o2.status, 200);

  const third = cands.filter(c => c.id !== noCand.id && c.id !== advCand.id)[0];
  ok('存在第三位候选人用于「确认」样本', !!third);
  const o3 = await call('POST', '/api/candidates/' + (third ? third.id : 'X') + '/override', { decision: 'confirmed' });
  eq('人工确认 AI 结论写入成功（无需原因）', o3.status, 200);
  eq('确认不产生原因码', o3.json.overrideCode, null);

  /* --- 一致率算术 --- */
  const ag1 = await call('GET', '/api/metrics/agreement');
  const A = ag1.json.agreement;
  eq('样本数 = 3（1 确认 + 2 推翻）', A.samples, 3);
  eq('确认数 = 1', A.confirmed, 1);
  eq('AI 过严（人工推进）数 = 1', A.humanOverrodeUp, 1);
  eq('AI 过宽（人工否决）数 = 1', A.humanOverrodeDown, 1);
  eq('一致率 = 1/3', A.agreementRate, Number((1 / 3).toFixed(4)));
  const codeMap = Object.fromEntries((A.byCode || []).map(x => [x.code, x.count]));
  eq('byCode 含 gate_too_strict = 1', codeMap.gate_too_strict, 1);
  eq('byCode 含 biz_overrated = 1', codeMap.biz_overrated, 1);
  ok('byCode 带人类可读标签（不是裸码）',
    (A.byCode || []).every(x => typeof x.label === 'string' && x.label.length > 2));

  /* --- 枚举与一致率口径的单元校验（不依赖后端） --- */
  ok('agrees：AI=no + 人工推进 → 不一致', OC.agrees('no', 'approved_by_human') === false);
  ok('agrees：AI=strong + 人工否决 → 不一致', OC.agrees('strong', 'rejected_by_human') === false);
  ok('agrees：人工确认 → 一致', OC.agrees('ok', 'confirmed') === true);
  ok('agrees：样本缺失时返回 null（不计入一致率）', OC.agrees(null, 'confirmed') === null && OC.agrees('ok', null) === null);
  ok('oppositeOf：AI=no 时推翻方向应为推进', OC.oppositeOf('no') === 'approved_by_human');
  ok('oppositeOf：AI=strong 时推翻方向应为否决', OC.oppositeOf('strong') === 'rejected_by_human');
  ok('isValidCode 拒绝未知码', OC.isValidCode('nope') === false && OC.isValidCode('other') === true);

  /* --- 权限：无 screen:run 的用户不能推翻 --- */
  const saved = cookie; cookie = '';
  const emp = await call('POST', '/api/auth/login', { identifier: 'U-003', password: PW });
  eq('以 U-003（员工，无 screen:run）登录成功', emp.status, 200);
  const r7 = await call('POST', '/api/candidates/' + (third ? third.id : 'X') + '/override', { decision: 'confirmed' });
  eq('无 screen:run 的用户推翻被拒（403）', r7.status, 403);
  cookie = saved;

  /* --- 重置评分应同时清掉人工结论，避免污染一致率 --- */
  const rs = await call('POST', '/api/jobs/J-118/reset-scores');
  eq('重置 J-118 评分成功', rs.status, 200);
  const ag2 = await call('GET', '/api/metrics/agreement');
  eq('重置后人工结论样本归零（不残留脏样本）', ag2.json.agreement.samples, 0);

  /* --- 审计留痕 --- */
  const au = await call('GET', '/api/audit?limit=200');
  const logs = (au.json && au.json.logs) || [];
  ok('审计日志记录了人工推翻', logs.some(l => l.action && l.action.includes('人工推翻 AI 筛选结论')));
  ok('审计日志记录了人工确认', logs.some(l => l.action && l.action.includes('人工确认 AI 筛选结论')));
}

/* ===========================================================
   入口
   =========================================================== */
(async () => {
  console.log('HR-Agent OS · 筛选质量评测');
  console.log('（A 黄金集回放 · B 一致率接口；规则逻辑与线上同一份 evaluateCandidate）');

  const m = runGoldenSet();

  /* --write-baseline 只跑黄金集就退出：B 需要起后端，与本开关无关 */
  if (WRITE_BASELINE) {
    /* 结构有误时 runGoldenSet 早退返回 null —— 绝不拿一个坏集合去覆盖基线 */
    if (!m) { console.log('\n黄金集结构有误，已跳过写基线（先修 golden_set.json）'); process.exit(1); }
    console.log('\n基线刷新完成：一致率 ' + pct(m.exactAgreement) + ' / 漏筛 ' + pct(m.missRate)
      + ' / 误筛 ' + pct(m.falsePassRate));
    console.log('下一步：node tools/check_docs.js  （确认文档里的指标行跟着更新）');
    process.exit(fails.length ? 1 : 0);
  }

  try {
    await runApiSuite();
  } catch (e) {
    section('B · 一致率接口');
    ok('接口套件执行未抛异常', false, e && e.message);
  }

  console.log('\n' + '='.repeat(52));
  if (!fails.length) console.log('全部通过：' + pass + ' 项');
  else {
    console.log('结果 ' + (pass + fails.length) + ' 项，失败 ' + fails.length + ' 项：');
    fails.forEach(f => console.log('  ✗ ' + f));
  }
  console.log('='.repeat(52));
  process.exit(fails.length ? 1 : 0);
})();
