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
  /* 探针命中：三个岗位各 1 例「标签命中但背景不对口」，应当全部落在误筛里 */
  const probeBad = bad.filter(x => x.probe);
  eq('边界探针全部被识别为分歧（3 例）', probeBad.length, 3);
  ok('所有分歧方向一致：均为 AI 过宽（no→ok），没有 AI 过严',
    bad.every(x => x.label === 'no' && (x.ai === 'strong' || x.ai === 'ok')),
    bad.map(x => x.id + ':' + x.label + '→' + x.ai).join('、'));
  eq('硬性门槛拦截例数符合预期（3 例：年限 ×2 / 学历 ×1）', metrics.gateBlocked, 3);

  /* v15 · 匹配层口径：跨岗近似词不得靠「前 4 字同头」混进命中。
     G-J09（前端负责人）原先 1/6 命中完全是 JavaScript 借了 Java 的前 4 个字。
     断言写成「与完全不沾边的基准相等 / 与真命中的基准相等」，不写死系数阶梯的数值 ——
     阶梯将来调档时这几条不该跟着红。既锁「不许误命中」，也锁「不许过度收紧」：
     把同词族措辞差异一起杀掉会让匹配层从过宽翻到过窄，那是另一种缺陷。 */
  const skillScoreOf = (skills, kws) => {
    const cand = { id: 'T', name: 'T', years_exp: 3, edu_rank: 2,
      skills: JSON.stringify(skills), business_tags: '[]', plus_tags: '[]', parse_ok: 1 };
    const job = { id: 'T', title: 'T', industry: '互联网', must_years: 3, must_edu_rank: 2,
      keywords: JSON.stringify(kws), must_have: '[]', nice_have: '[]', rubric: '{}' };
    const terms = engine.evaluateCandidate(cand, job).why.terms;
    return (terms.find(t => t.dim === '技能匹配') || {}).score;
  };
  const S_HIT = skillScoreOf(['Java'], ['Java']);     /* 真命中：技能维度拿到的分 */
  const S_MISS = skillScoreOf(['Python'], ['Java']);  /* 完全不沾边：只能拿底分 */
  section('A2 · 岗位关键词匹配口径（v15）');
  ok('前置校验：真命中的技能分必须高于不沾边（否则下面几条失去判别力）',
    S_HIT > S_MISS, S_HIT + ' vs ' + S_MISS);
  eq('JavaScript 不再借「前 4 字同头」拿到 Java 的技能分', skillScoreOf(['JavaScript'], ['Java']), S_MISS);
  eq('React 不再借「前 4 字同头」拿到 Reactive 的技能分', skillScoreOf(['React'], ['Reactive']), S_MISS);
  eq('community 不再命中 Unity（左边界）', skillScoreOf(['community'], ['Unity']), S_MISS);
  eq('同词族拉丁前缀仍算命中（Spring Cloud ↔ Spring Boot）', skillScoreOf(['Spring Cloud'], ['Spring Boot']), S_HIT);
  eq('英文复数仍算命中（agents → agent）', skillScoreOf(['agents'], ['agent']), S_HIT);
  eq('粘连写法仍算命中（nodejs → node）', skillScoreOf(['nodejs'], ['node']), S_HIT);
  eq('中文短语差异仍算命中（「高并发」↔「高并发、大流量…」）',
    skillScoreOf(['高并发、大流量系统实战经验'], ['高并发']), S_HIT);

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

  runGoldenSet();

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
