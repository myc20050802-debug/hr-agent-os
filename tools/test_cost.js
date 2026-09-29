/**
 * 验证「模型用量只来自真实响应」—— 规则模式不得虚报，接入模式必须真调。
 *
 * 背景：修复前 runScreening 在**规则模式下**也会按 160 token/份 记一个常量，
 * 并把工具名写成 llm.score_resume，前端据此显示出一笔并未发生的模型成本。
 * 本测试用两套隔离实例把两种模式都跑一遍：
 *
 *   A 规则模式（不配 LLM）  → 所有步骤 tokens=0、无 llm.* 工具名、假网关收到 0 次调用
 *   B 接入模式（本地假网关）→ 假网关收到 N 次调用、tokens 恰为 N×137（响应里的 usage）、
 *                            ai_note 落库为模型输出
 *
 * 关键断言是 B 里的 `tokens / calls === 137`：
 * 137 是假网关**在响应里声明**的用量。若仍是那个 160 的常量，此断言必失败。
 *
 * 零依赖，直接：node tools/test_cost.js
 *   两个实例各用独立 DB（DB_PATH 指向临时目录），不碰演示库 server/hr_agent.db。
 */
'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT_RULE = 8890, PORT_MODEL = 8892, PORT_FAKE = 8891;
const FAKE_TOTAL_TOKENS = 137;          // 假网关在 usage 里声明的用量
const MODEL_NOTE_MARK = 'MODEL_NOTE_';

let pass = 0, fails = [];
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };
const section = t => console.log('\n=== ' + t + ' ===');

/* ---------- 假模型网关：OpenAI 兼容，usage 回一个固定值 ---------- */
let llmCalls = 0;
function startFakeLLM() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let buf = '';
      req.on('data', d => buf += d);
      req.on('end', () => {
        if (/\/chat\/completions$/.test(req.url)) {
          llmCalls++;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{ message: { content: MODEL_NOTE_MARK + llmCalls + ' 综合匹配度高，建议优先沟通。' } }],
            usage: { prompt_tokens: 100, completion_tokens: 37, total_tokens: FAKE_TOTAL_TOKENS },
          }));
        } else { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); }
      });
    });
    srv.listen(PORT_FAKE, '127.0.0.1', () => resolve(srv));
  });
}

/* ---------- 测试实例 ---------- */
const children = [];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-cost-'));
function startServer(port, dbFile, extraEnv) {
  const p = spawn(NODE, ['--experimental-sqlite', 'server.js'], {
    cwd: path.join(ROOT, 'server'),
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbFile, LOG_LEVEL: 'warn' }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(p);
  let err = '';
  p.stderr.on('data', d => { err += d.toString(); });
  p.on('error', e => { err += String(e); });
  return { proc: p, stderr: () => err };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitHealthy(port, label, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error(label + ' 在 ' + timeoutMs + 'ms 内未就绪');
}

/* ---------- 极简 HTTP 客户端（带 cookie） ---------- */
function client(port) {
  let cookie = '';
  const call = async (method, url, body) => {
    const h = { 'content-type': 'application/json' };
    if (cookie) h.cookie = cookie;
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; ');
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* 非 JSON */ }
    return { status: r.status, json };
  };
  return call;
}

(async () => {
  console.log('验证：模型用量是否只来自真实响应\n（A 规则模式 / B 接入模式，均为隔离实例）');

  const fake = await startFakeLLM();
  startServer(PORT_RULE, path.join(tmpDir, 'rule.db'), null);
  startServer(PORT_MODEL, path.join(tmpDir, 'model.db'), {
    LLM_API_URL: `http://127.0.0.1:${PORT_FAKE}/v1`,
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'fake-model',
  });

  const healthRule = await waitHealthy(PORT_RULE, '规则模式实例');
  const healthModel = await waitHealthy(PORT_MODEL, '接入模式实例');

  const LOGIN = { identifier: 'U-001', password: 'Demo@2026' };

  /* ================= A · 规则模式 ================= */
  section('A · 规则模式（未配置模型）');
  ok('/api/health 报 mode=rule', healthRule.mode === 'rule', 'mode=' + healthRule.mode);

  const ca = client(PORT_RULE);
  const la = await ca('POST', '/api/auth/login', LOGIN);
  ok('以 U-001 登录成功', la.status === 200, 'status=' + la.status);

  const bo = await ca('GET', '/api/bootstrap');
  const jobId = bo.json && bo.json.jobs && bo.json.jobs[0] && bo.json.jobs[0].id;
  ok('取到岗位用于筛选', !!jobId, 'jobId=' + jobId);

  const callsBefore = llmCalls;
  const runA = await ca('POST', '/api/agent/screening/run', { jobId });
  ok('筛选执行成功', runA.status === 200 && runA.json && runA.json.status === 'waiting_approval', 'status=' + runA.status);
  const stepsA = (runA.json && runA.json.steps) || [];
  ok('返回了执行步骤', stepsA.length > 0, 'steps=' + stepsA.length);

  const nonZero = stepsA.filter(s => Number(s.tokens) > 0);
  ok('★ 所有步骤 tokens 均为 0（不再虚报用量）', nonZero.length === 0,
    nonZero.map(s => s.tool + '=' + s.tokens).join(','));
  const llmNamed = stepsA.filter(s => /^llm\./.test(String(s.tool)));
  ok('★ 没有任何步骤被命名为 llm.*（不冒充模型调用）', llmNamed.length === 0,
    llmNamed.map(s => s.tool).join(','));
  const scoreStepA = stepsA.find(s => /score_resume$/.test(String(s.tool)));
  ok('打分步骤存在且工具名为 rule.score_resume', !!scoreStepA && scoreStepA.tool === 'rule.score_resume',
    scoreStepA ? scoreStepA.tool : '未找到打分步骤');
  ok('打分步骤被显式标记 rule=true', !!scoreStepA && scoreStepA.rule === true);
  ok('★ 假网关收到 0 次调用（规则模式确实没调模型）', llmCalls === callsBefore, 'calls=' + (llmCalls - callsBefore));

  /* ================= B · 接入模式 ================= */
  section('B · 接入模式（本地假网关）');
  ok('/api/health 报 mode=llm', healthModel.mode === 'llm', 'mode=' + healthModel.mode);

  const cb = client(PORT_MODEL);
  const lb = await cb('POST', '/api/auth/login', LOGIN);
  ok('以 U-001 登录成功', lb.status === 200, 'status=' + lb.status);

  const bob = await cb('GET', '/api/bootstrap');
  const jobIdB = bob.json && bob.json.jobs && bob.json.jobs[0] && bob.json.jobs[0].id;
  ok('取到岗位用于筛选', !!jobIdB, 'jobId=' + jobIdB);

  const before = llmCalls;
  const runB = await cb('POST', '/api/agent/screening/run', { jobId: jobIdB });
  ok('筛选执行成功', runB.status === 200 && runB.json && runB.json.status === 'waiting_approval', 'status=' + runB.status);
  const stepsB = (runB.json && runB.json.steps) || [];
  const calls = llmCalls - before;

  const scoreStepB = stepsB.find(s => String(s.tool) === 'llm.score_resume');
  ok('★ 打分步骤工具名为 llm.score_resume', !!scoreStepB, stepsB.map(s => s.tool).join(','));
  ok('打分步骤标记 rule=false', !!scoreStepB && scoreStepB.rule === false);
  ok('★ 假网关被真实调用（calls > 0）', calls > 0, 'calls=' + calls);

  const tokB = scoreStepB ? Number(scoreStepB.tokens) : -1;
  ok('★ 用量 = 调用次数 × 响应声明的 137', calls > 0 && tokB === calls * FAKE_TOTAL_TOKENS,
    'tokens=' + tokB + ', calls×137=' + (calls * FAKE_TOTAL_TOKENS));
  ok('★ 用量不等于旧的伪造常量 160/份', calls > 0 && tokB !== calls * 160,
    '若等于 ' + (calls * 160) + ' 说明还在用常量');

  /* 模型理由是否真的落库（aiNote） */
  const bob2 = await cb('GET', '/api/bootstrap');
  const cand = bob2.json && bob2.json.candidates && bob2.json.candidates.find(c => c.jobId === jobIdB && c.score != null);
  if (cand) {
    const det = await cb('GET', '/api/candidates/' + cand.id + '/detail');
    const note = det.json && det.json.candidate && det.json.candidate.aiNote;
    ok('★ ai_note 为模型输出（含 ' + MODEL_NOTE_MARK + ' 前缀）', !!note && String(note).indexOf(MODEL_NOTE_MARK) >= 0,
      'note=' + String(note).slice(0, 60));
  } else {
    ok('★ ai_note 为模型输出（未取到候选人，跳过）', false, '未找到已评分候选人');
  }

  /* 规则模式的实例不能被 B 的配置影响 */
  ok('两个实例互不干扰（规则实例仍报 rule）', (await waitHealthy(PORT_RULE, '规则实例')).mode === 'rule');

  /* ---------- 结果 ---------- */
  console.log('\n================ 结果 ================');
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  if (fails.length) fails.forEach(f => console.log('  ✗ ' + f));

  children.forEach(p => { try { p.kill('SIGKILL'); } catch { /* 已退出 */ } });
  fake.close();
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 文件锁，留待系统清理 */ }
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.error('测试异常：' + e.message);
  children.forEach(p => { try { p.kill('SIGKILL'); } catch { /* 忽略 */ } });
  process.exit(1);
});
