#!/usr/bin/env node
/* ===========================================================
   HR-Agent OS · 规则 vs LLM 双模式对照评测
   -----------------------------------------------------------
   为什么要做这个（产品问题，不是技术问题）：
     项目 README 讲了一堆「AI 自主执行」，但访客把平台跑起来会发现 ——
     **默认体验里没有模型调用**（`config.llm.url` 为空 → 走规则模式）。
     这本身是好设计（离线可用、可回归、0 token），但项目从来没把这个**分工**讲清楚，
     于是「AI 在哪」变成一个说不清的问题。本评测就是回答它的：

       ① AI 到底参与哪一步？      → 用代码证据回答（下面「分工」章节）
       ② 规则模式跑出来什么水平？  → 用同一份黄金集**实跑**，出真实指标
       ③ 换成 LLM 打分会更好吗？   → 让模型当「第二意见」独立判档，与人工标签对照

   ★ 诚实约定（本脚本的硬规则）：
     LLM 未配置时，模式 B **绝不输出任何数字**，只标注「未运行」并给出开启方式。
     编一个看起来合理的对照结果，比不跑更糟 —— 那是拿可信度换一张好看的表。

   用法：
     node --experimental-sqlite tools/eval_dual_mode.js                  # 跑并打印
     node --experimental-sqlite tools/eval_dual_mode.js --md docs/16_x.md # 同时写报告
     # 启用模式 B：
     #   LLM_API_URL=https://api.openai.com/v1 LLM_API_KEY=sk-... node ... tools/eval_dual_mode.js
   =========================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'server', 'engine.js'));

const RANK = { no: 0, ok: 1, strong: 2 };
const GRADES = ['strong', 'ok', 'no'];
const pct = x => (x === null || x === undefined) ? '—' : (x * 100).toFixed(1) + '%';

/* Wilson 95% 置信区间。
   为什么这个报告必须带它：30 例样本上的点估计（无论它多漂亮）都撑不起结论式表述 ——
   区间宽度有十几到二十几个百分点，也就是说这 30 例**分不开相邻的两个十位档**。
   只写点估计而不写区间，等于用一个精确的数字表达了不精确的事实。 */
function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { lo: (c - h) / d, hi: (c + h) / d };
}
const ci = (k, n) => {
  const w = wilson(k, n);
  return w ? '[' + pct(w.lo) + ', ' + pct(w.hi) + ']' : '—';
};

/* ===========================================================
   一 · 载入黄金集
   =========================================================== */
const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', 'golden_set.json'), 'utf8'));
const CASES = G.cases;

/* 还原成与数据库行同样的形状（数组 → JSON 字符串）。
   与 tools/test_eval.js 完全同构 —— 两边喂进去的输入必须一模一样，
   否则「两份报告」比的东西就不是同一个。 */
const ROWS = CASES.map(c => {
  const job = G.jobs[c.jobId];
  return {
    meta: c,
    cand: {
      id: c.id, name: c.name, years_exp: c.years_exp, edu_rank: c.edu_rank,
      skills: JSON.stringify(c.skills || []),
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

/* ===========================================================
   二 · 指标（与 test_eval.js 同一口径）
   -----------------------------------------------------------
   档位一致率  完全同档的比例
   ±1 档一致率 档位距离 ≤ 1
   误筛率      人工说该通过（strong/ok）却被判 no   ← 安全红线
   漏筛率      人工说该淘汰（no）却被判 strong/ok   ← 成本问题
   =========================================================== */
function metrics(rows /* [{label, pred, gate}] */) {
  const n = rows.length;
  const dist = rows.map(r => Math.abs(RANK[r.pred] - RANK[r.label]));
  const same = dist.filter(d => d === 0).length;
  const near = dist.filter(d => d <= 1).length;

  const shouldPass = rows.filter(r => r.label === 'strong' || r.label === 'ok');
  const missed = shouldPass.filter(r => r.pred === 'no');
  const shouldReject = rows.filter(r => r.label === 'no');
  const overPassed = shouldReject.filter(r => r.pred === 'strong' || r.pred === 'ok');

  return {
    n,
    exact: n ? same / n : null,
    within1: n ? near / n : null,
    miss: shouldPass.length ? missed.length / shouldPass.length : null,
    missN: missed.length, passBase: shouldPass.length,
    falsePass: shouldReject.length ? overPassed.length / shouldReject.length : null,
    fpN: overPassed.length, rejectBase: shouldReject.length,
    dist,
    same, near,
    missed, overPassed,
    dist_pred: {
      strong: rows.filter(r => r.pred === 'strong').length,
      ok: rows.filter(r => r.pred === 'ok').length,
      no: rows.filter(r => r.pred === 'no').length,
    },
    gateBlocked: rows.filter(r => r.gate).length,
  };
}

/* ===========================================================
   三 · 模式 A：规则（服务端口径，实跑）
   =========================================================== */
function runRuleMode() {
  const out = ROWS.map(r => {
    /* 与线上筛选调用的是同一个函数 —— 不是另写一份「评测专用」打分 */
    const res = engine.evaluateCandidate(r.cand, r.job);
    return {
      id: r.meta.id, jobId: r.meta.jobId, jobTitle: r.job.title, name: r.meta.name,
      label: r.meta.label, pred: res.grade, score: res.score,
      gate: !!res.gate, gateReason: res.gateReason || null,
      probe: !!r.meta.probe, note: r.meta.labelNote || '',
    };
  });
  return { out, m: metrics(out) };
}

/* ===========================================================
   四 · 模式 B：LLM 第二意见（配置了才跑）
   -----------------------------------------------------------
   给模型的输入与规则**完全一致**（只有结构化字段，不给它看规则算出来的分数）——
   否则模型会顺着规则的分抄，对照就失去意义。
   =========================================================== */
function buildPrompt(r) {
  const j = G.jobs[r.meta.jobId];
  const c = r.meta;
  return [
    {
      role: 'system',
      content: '你是资深招聘筛选官。只依据给定字段独立判断候选人匹配档位，'
        + '不要寒暄、不要解释过程，只输出一行 JSON：{"grade":"strong|ok|no","reason":"不超过40字"}。'
        + 'strong=明显推荐面试；ok=可以进下一轮；no=不建议。',
    },
    {
      role: 'user',
      content: '【岗位】' + j.title + '（行业：' + (j.industry || '未标注') + '）\n'
        + '最低年限：' + j.must_years + ' 年；最低学历档：' + j.must_edu_rank + '\n'
        + '必要项：' + (j.must_have || []).join('、') + '\n'
        + '加分项：' + (j.nice_have || []).join('、') + '\n'
        + '【候选人】' + c.name + '，' + c.years_exp + ' 年经验，学历档 ' + c.edu_rank + '\n'
        + '技能：' + (c.skills || []).join('、') + '\n'
        + '业务背景：' + (c.business_tags || []).join('、') + '\n'
        + '加分标签：' + (c.plus_tags || []).join('、'),
    },
  ];
}

function parseGrade(text) {
  if (!text) return { grade: null, reason: '', raw: '' };
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return { grade: null, reason: '', raw: String(text).slice(0, 160) };
  try {
    const j = JSON.parse(m[0]);
    const g = String(j.grade || '').toLowerCase().trim();
    return {
      grade: GRADES.includes(g) ? g : null,
      reason: String(j.reason || '').slice(0, 80),
      raw: m[0].slice(0, 160),
    };
  } catch (e) {
    return { grade: null, reason: '', raw: m[0].slice(0, 160) };
  }
}

async function runLlmMode() {
  const out = [];
  let tokens = 0, usageUnknown = 0, failed = 0, unparsed = 0;

  for (const r of ROWS) {
    const gen = await engine.llm(buildPrompt(r));
    const p = parseGrade(gen.text);
    if (gen.error) failed++;
    if (gen.text && !p.grade) unparsed++;
    const u = gen.usage && Number(gen.usage.total_tokens);
    if (u) tokens += u; else usageUnknown++;

    out.push({
      id: r.meta.id, jobId: r.meta.jobId, jobTitle: r.job.title, name: r.meta.name,
      label: r.meta.label, pred: p.grade, reason: p.reason, raw: p.raw,
      error: gen.error || null, tokens: u || 0, probe: !!r.meta.probe,
    });
  }

  /* 只有判出合法档位的样本才计入指标 —— 但「判不出」本身要被记下来，
     否则模型乱答一通反而会因为样本变少而显得更准。 */
  const usable = out.filter(x => GRADES.includes(x.pred));
  return { out, m: metrics(usable), tokens, usageUnknown, failed, unparsed, usableN: usable.length };
}

/* ===========================================================
   五 · 报告
   =========================================================== */
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };

(async () => {
  const llmOn = engine.llmConfigured();

  console.log('\n===== 规则 vs LLM 双模式对照 =====');
  console.log('  黄金集              ' + CASES.length + ' 例 / ' + new Set(CASES.map(c => c.jobId)).size + ' 个岗位');
  console.log('  LLM 网关            ' + (llmOn
    ? '已配置（model=' + (process.env.LLM_MODEL || 'gpt-4o-mini') + '）→ 模式 B 将实跑'
    : '未配置 → 模式 B 标注「未运行」，不输出任何数字'));

  /* --- 模式 A --- */
  const A = runRuleMode();
  console.log('\n--- 模式 A · 规则（当前默认，服务端口径实跑）---');
  console.log('  档位一致率   ' + pct(A.m.exact) + '  (' + A.m.same + '/' + A.m.n + ')');
  console.log('    └ 95% 置信区间 ' + ci(A.m.same, A.m.n) + '  ← 30 例样本只能给到这个精度');
  console.log('  ±1 档一致率  ' + pct(A.m.within1) + '  (' + A.m.near + '/' + A.m.n + ')');
  console.log('  误筛率       ' + pct(A.m.miss) + '  (' + A.m.missN + '/' + A.m.passBase + ')');
  console.log('  漏筛率       ' + pct(A.m.falsePass) + '  (' + A.m.fpN + '/' + A.m.rejectBase + ')');
  console.log('  档位分布     strong ' + A.m.dist_pred.strong + ' / ok ' + A.m.dist_pred.ok
    + ' / no ' + A.m.dist_pred.no + '（门槛拦截 ' + A.m.gateBlocked + '）');

  /* --- 模式 B --- */
  let B = null;
  if (llmOn) {
    console.log('\n--- 模式 B · LLM 第二意见（实跑中，30 次调用）---');
    B = await runLlmMode();
    console.log('  可判档样本   ' + B.usableN + '/' + CASES.length
      + '（失败 ' + B.failed + ' · 无法解析 ' + B.unparsed + '）');
    console.log('  档位一致率   ' + pct(B.m.exact) + '  (' + B.m.same + '/' + B.m.n + ')');
    console.log('  ±1 档一致率  ' + pct(B.m.within1) + '  (' + B.m.near + '/' + B.m.n + ')');
    console.log('  误筛率       ' + pct(B.m.miss) + '  (' + B.m.missN + '/' + B.m.passBase + ')');
    console.log('  漏筛率       ' + pct(B.m.falsePass) + '  (' + B.m.fpN + '/' + B.m.rejectBase + ')');
    console.log('  真实用量     ' + B.tokens + ' tokens' + (B.usageUnknown ? '（' + B.usageUnknown + ' 次未返回 usage）' : ''));
    /* --- 模式间一致性 --- */
    const pair = A.out.filter(a => {
      const b = B.out.find(x => x.id === a.id);
      return b && GRADES.includes(b.pred);
    });
    const agree = pair.filter(a => {
      const b = B.out.find(x => x.id === a.id);
      return b.pred === a.pred;
    }).length;
    B.crossAgree = pair.length ? agree / pair.length : null;
    B.crossN = pair.length; B.crossSame = agree;
    console.log('  两模式一致   ' + pct(B.crossAgree) + '  (' + agree + '/' + pair.length + ')');
  } else {
    console.log('\n--- 模式 B · LLM 第二意见 ---');
    console.log(C.y + '  未运行（LLM_API_URL / LLM_API_KEY 未设置）' + C.x);
    console.log(C.d + '  开启方式：LLM_API_URL=<网关>/v1 LLM_API_KEY=<key> node --experimental-sqlite tools/eval_dual_mode.js' + C.x);
    console.log(C.d + '  本报告在模式 B 处只标注「未运行」，不填任何估算值。' + C.x);
  }

  /* ---------- Markdown 报告 ----------
     注意：**无论有没有 --md 都先构建一次**。理由：报告模板里有大量字符串拼接，
     只在「要写文件时」才跑它的话，模板写错（少括号、拼错变量）会一直藏到
     某次手动生成报告时才炸 —— 而那时通常是临近交付。让它每次运行都过一遍。 */
  const md = buildMarkdown(A, B, llmOn);
  const mdIdx = process.argv.indexOf('--md');
  if (mdIdx !== -1 && process.argv[mdIdx + 1]) {
    const out = path.resolve(ROOT, process.argv[mdIdx + 1]);
    fs.writeFileSync(out, md, 'utf8');
    console.log('\n' + C.g + '✓ 报告已写入 ' + path.relative(ROOT, out)
      + '（' + md.split('\n').length + ' 行 / ' + md.length + ' 字符）' + C.x);
  } else {
    console.log(C.d + '  （报告模板已构建：' + md.split('\n').length
      + ' 行；要落盘加 --md <路径>）' + C.x);
  }

  /* 退出码：规则模式的硬红线（误筛必须为 0）——与 test_eval.js 同一标准 */
  const bad = A.m.miss !== 0;
  console.log('\n' + (bad ? C.r + '✗ 规则模式误筛率不为 0（安全红线）' : C.g + '✓ 规则模式误筛率为 0（安全红线守住）') + C.x + '\n');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

/* ===========================================================
   报告正文
   =========================================================== */
function buildMarkdown(A, B, llmOn) {
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
  const L = [];
  const P = s => L.push(s);

  P('# 规则 × LLM 双模式对照评测');
  P('');
  P('> 生成方式：`node --experimental-sqlite tools/eval_dual_mode.js --md docs/16_规则与LLM双模式对照评测.md`');
  P('> 生成时间（北京时间）：' + today);
  P('> 黄金集：`tools/golden/golden_set.json`（' + CASES.length + ' 例 / ' + new Set(CASES.map(c => c.jobId)).size + ' 个岗位，人工标注三档）');
  P('');
  P('---');
  P('');
  P('## 〇、一句话结论');
  P('');
  P('这个项目的 AI **不是「模型在打分」**，而是「**规则算分 + 模型写话**」：');
  P('分数与档位 100% 由固定权重的 `scoreOne()` 算出（可复现、可解释、0 token），');
  P('模型只负责推荐理由的措辞、制度问答的组织、JD 的润色。');
  P('所以「规则 vs LLM」比的**不是谁的分数更准** —— 换模型不会改变任何一个人的档位；');
  P('要回答的是：**该不该让模型参与判断**，以及**让模型当第二意见时它和规则差多远**。');
  P('');
  P('---');
  P('');
  P('## 一、AI 到底在哪一步（代码证据）');
  P('');
  P('| 环节 | 谁在做 | 代码位置 | 换模型会变吗 |');
  P('|---|---|---|---|');
  P('| 硬性门槛拦截（年限/学历） | 规则 | `server/engine.js` `ruleGate()` | 不会 |');
  P('| 相关性门槛（岗位关键词零命中） | 规则 | `server/engine.js` `skillGate()`（v16） | 不会 |');
  P('| 分数与档位（strong/ok/no） | 规则 `scoreOne()` | `server/engine.js:180-182` 注释明确「分数与维度固定由 scoreOne() 算」 | **不会** |');
  P('| 维度归因（为什么给这个分） | 规则 | `shared/score-why.js` 的 `LADDERS` | 不会 |');
  P('| 推荐理由**措辞** | 模型（可插拔） | `server/engine.js:191` 只在 `useModel` 时调用，且只把 `r.dims` 喂过去 | 会 |');
  P('| 员工制度问答 | 规则检索 + 模型组织语言 | `server/engine.js:548` | 措辞会 |');
  P('| JD 润色 | 规则打底 + 模型润色 | `server/engine.js:1320`（仅「配了模型」且「HR 填了内容」时触发） | 会 |');
  P('');
  P('**关键验证**：`evaluateCandidate()`（评测与线上筛选共用的入口）内部**没有任何 `llm()` 调用** ——');
  P('它是纯函数。这也是本评测的模式 A 能被称为「服务端口径」的原因；');
  P('换句话说：**模式 A 的结果不会因为换模型而变化**，这是设计目标，不是巧合。');
  P('');
  P('---');
  P('');
  P('## 二、模式 A · 规则（实跑，真实数字）');
  P('');
  P('| 指标 | 结果 | 口径 |');
  P('|---|---|---|');
  P('| 样本数 | ' + A.m.n + ' | ' + A.m.n + ' 例人工标注 |');
  P('| 档位一致率 | **' + pct(A.m.exact) + '** | 完全同档（' + A.m.same + '/' + A.m.n + '） |');
  P('| 　└ 95% 置信区间 | ' + ci(A.m.same, A.m.n) + ' | Wilson 区间，样本 ' + A.m.n + ' 例 |');
  P('| ±1 档一致率 | **' + pct(A.m.within1) + '** | 档位距离 ≤ 1（' + A.m.near + '/' + A.m.n + '） |');
  P('| 误筛率 | **' + pct(A.m.miss) + '** | 人工说该通过却被判 no（' + A.m.missN + '/' + A.m.passBase + '）← 安全红线 |');
  P('| 漏筛率 | **' + pct(A.m.falsePass) + '** | 人工说该淘汰却被放行（' + A.m.fpN + '/' + A.m.rejectBase + '）← 成本问题 |');
  P('| 门槛拦截 | ' + A.m.gateBlocked + ' 例 | 规则前置拦截，不进入打分（年限 / 学历 / **技能零命中**） |');
  P('');
  P('档位分布（AI）：strong ' + A.m.dist_pred.strong + ' / ok ' + A.m.dist_pred.ok + ' / no ' + A.m.dist_pred.no);
  P('');
  P('### 怎么读这个 ' + pct(A.m.exact) + '');
  P('');
  P('口径先说清楚：一致率 = **AI 档位与人工标注完全同档**的比例。');
  P('±1 档一致率 ' + pct(A.m.within1) + ' 的含义是「没有跨两档的硬错」——');
  P('相邻档判错（strong↔ok）在招聘里通常只意味着多聊一轮，不构成事故。');
  P('');
  /* 区间宽度按实测算 —— 不要把「宽 22 个百分点」之类的数字写死在模板里。 */
  const wCI = wilson(A.m.same, A.m.n);
  const wPP = wCI ? ((wCI.hi - wCI.lo) * 100).toFixed(1) : '—';
  P('**区间比点估计更重要**：' + A.m.n + ' 例上的 ' + pct(A.m.exact) + '，Wilson 95% 区间是 '
    + ci(A.m.same, A.m.n) + '，**宽度 ' + wPP + ' 个百分点** —— '
    + '样本量给的上限就在这里，点估计再漂亮也压不住它。');
  P('诚实的写法是「一致率约 ' + pct(A.m.exact) + '（' + A.m.n + ' 例，95% CI '
    + ci(A.m.same, A.m.n) + '）」，而不是把点估计当结论用。');
  P('');
  P('要收窄区间只有一条路：**扩样本**。当前黄金集是 3 个岗位 × 10 例，而词库覆盖 30 个职能族 ——');
  P('把每个职能族至少补 2 例（≈60 例新样本）是性价比最高的一步。');
  P('');
  P('### 逐例明细');
  P('');
  P('| 例号 | 岗位 | 人工 | AI | 分 | 距离 | 说明 |');
  P('|---|---|---|---|---|---|---|');
  for (const x of A.out) {
    P('| ' + x.id + ' | ' + x.jobTitle + ' | ' + x.label + ' | ' + (x.pred + (x.gate ? '(门槛)' : ''))
      + ' | ' + x.score + ' | ' + Math.abs(RANK[x.pred] - RANK[x.label])
      + ' | ' + (x.probe ? '**探针** ' : '') + (x.note || '') + ' |');
  }
  P('');
  P('---');
  P('');
  P('## 三、模式 B · LLM 第二意见');
  P('');
  if (!llmOn) {
    P('### ⚠️ 未运行 —— 本报告不提供任何估算值');
    P('');
    P('当前 `LLM_API_URL` / `LLM_API_KEY` 未配置，**模式 B 没有跑**。');
    P('这里刻意留空，而不是填一组「看起来合理」的数字：编出来的对照结果比不跑更糟。');
    P('');
    P('开启方式：');
    P('');
    P('```bash');
    P('LLM_API_URL=<你的网关地址，如 https://api.openai.com/v1> \\');
    P('LLM_API_KEY=<你的 key> \\');
    P('LLM_MODEL=<模型名，默认 gpt-4o-mini> \\');
    P('node --experimental-sqlite tools/eval_dual_mode.js \\');
    P('  --md docs/16_规则与LLM双模式对照评测.md');
    P('```');
    P('');
    P('跑完之后这张表会被真实数字填上，并且会自动多出一张**两模式一致率**：');
    P('');
    P('| 指标 | 模式 A 规则 | 模式 B LLM |');
    P('|---|---|---|');
    P('| 档位一致率 | ' + pct(A.m.exact) + ' | 待跑 |');
    P('| ±1 档一致率 | ' + pct(A.m.within1) + ' | 待跑 |');
    P('| 误筛率 | ' + pct(A.m.miss) + ' | 待跑 |');
    P('| 漏筛率 | ' + pct(A.m.falsePass) + ' | 待跑 |');
    P('');
    P('### 跑之前要有的预期（写在这里是为了防止事后凑解释）');
    P('');
    P('1. **模型很可能比规则更宽松**。规则的漏筛率已经偏高（' + pct(A.m.falsePass) + '，方向在安全侧），');
    P('   而通用模型对「必备项没写但背景接近」这类情况通常更愿意给机会 —— 如果模式 B 的**误筛率**');
    P('   （该通过却判 no）反而更低、漏筛率更高，那是符合预期的，不是「模型更准」。');
    P('2. **一致率大概率在 60%~85% 之间**。低于 60% 要怀疑提示词或字段表达；');
    P('   高于 95% 要怀疑模型在猜（或提示词泄漏了规则答案）—— 真到了 95%+，');
    P('   反而应该检查是不是把规则算出的分数喂进去了。');
    P('3. **「判不出」要单独计数**。模型输出无法解析成三档的样本必须被记下来，');
    P('   不能从分母里悄悄删掉 —— 否则乱答会让准确率虚高。本脚本已按此处理。');
    P('');
    P('### 就算模式 B 结果更好，也不会拿它当默认');
    P('');
    P('| 维度 | 规则 | LLM |');
    P('|---|---|---|');
    P('| 可复现性 | 同输入必同输出 | 同输入可能不同输出（temperature 0.2 也非严格确定） |');
    P('| 可解释性 | 每个分数可归因到维度与系数 | 只有一段话，审计时无法回答「为什么是 73 分」 |');
    P('| 成本 | 0 token | 每份简历一次调用 |');
    P('| 离线可用 | 是 | 否 |');
    P('| 合规/反歧视 | 规则里能写死「禁止使用哪些字段」 | 模型可能从姓名/院校推断出敏感属性 |');
    P('');
    P('筛选是**要签字、要可追溯**的动作。这几条里任何一条单独都足以让人工审核场景倾向规则——');
    P('所以模型的正确定位是**第二意见**（帮 HR 发现被规则漏掉的异类），而不是主判。');
  } else {
    P('模式 B 本轮**实跑**（模型：' + (process.env.LLM_MODEL || 'gpt-4o-mini') + '）。');
    P('');
    P('### 对照结果');
    P('');
    P('| 指标 | 模式 A · 规则 | 模式 B · LLM |');
    P('|---|---|---|');
    P('| 可判档样本 | ' + A.m.n + ' | ' + B.usableN + '/' + CASES.length
      + '（失败 ' + B.failed + ' · 无法解析 ' + B.unparsed + '） |');
    P('| 档位一致率 | ' + pct(A.m.exact) + ' | ' + pct(B.m.exact) + ' |');
    P('| ±1 档一致率 | ' + pct(A.m.within1) + ' | ' + pct(B.m.within1) + ' |');
    P('| 误筛率 | ' + pct(A.m.miss) + ' | ' + pct(B.m.miss) + ' |');
    P('| 漏筛率 | ' + pct(A.m.falsePass) + ' | ' + pct(B.m.falsePass) + ' |');
    P('| 真实用量 | 0 token | ' + B.tokens + ' token |');
    P('');
    P('**两模式一致率**：' + pct(B.crossAgree) + '（' + B.crossSame + '/' + B.crossN + '）——'
      + '两份结果在多少比例上给出同一个档位。');
    P('');
    P('### 逐例对照');
    P('');
    P('| 例号 | 岗位 | 人工 | 规则 | LLM | 规则分 | LLM 理由 |');
    P('|---|---|---|---|---|---|---|');
    for (const a of A.out) {
      const b = B.out.find(x => x.id === a.id) || {};
      P('| ' + a.id + ' | ' + a.jobTitle + ' | ' + a.label + ' | ' + a.pred + ' | '
        + (b.pred || '_(判不出)_') + ' | ' + a.score + ' | ' + (b.reason || b.error || '') + ' |');
    }
  }
  P('');
  P('---');
  P('');
  P('## 四、复现方式');
  P('');
  P('```bash');
  P('# 模式 A（无需任何配置，随时可跑）');
  P('node --experimental-sqlite tools/eval_dual_mode.js');
  P('');
  P('# 模式 A + 模式 B（配置网关后）');
  P('LLM_API_URL=... LLM_API_KEY=... node --experimental-sqlite tools/eval_dual_mode.js \\');
  P('  --md docs/16_规则与LLM双模式对照评测.md');
  P('');
  P('# 相关的既有套件');
  P('node --experimental-sqlite tools/test_eval.js   # 黄金集评测 + 一致率接口（14 节）');
  P('```');
  P('');
  P('> 本报告与 `tools/test_eval.js` 共用同一份黄金集与同一套指标口径，');
  P('> 且都直接调用 `engine.evaluateCandidate()` —— 不存在「评测专用打分」这回事。');
  P('');

  return L.join('\n');
}
