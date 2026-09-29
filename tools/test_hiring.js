/* ===========================================================
   专项测试 · 招聘后链路（面试 → Offer → 入职前置）
   零依赖：只用 Node 22 内置 fetch。用法：先启动 server/，再执行
         node --experimental-sqlite tools/test_hiring.js
   报告写入 tools/_test_hiring.txt（UTF8），避免控制台编码问题。

   为什么单独一套（而不是塞进 test_auth.js）：
   test_auth.js 覆盖的是「可信底座」——身份、权限、审计、治理、迁移的**横切能力**；
   本文件覆盖的是「一条业务链路能不能真的走通」——状态机、行级归属、合规闸门。
   两者失败时的排查方向完全不同：前者是「谁都不该进的进来了」，
   后者是「该往前走的人走不动了」。混在一起会互相淹没。

   本测试**会重置演示数据**（调 /api/reset），因为它需要一段干净的
   「待人工复核 → 已邀约 → 待面试 → … → 已入职」链路。
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const OUT = path.join(__dirname, '_test_hiring.txt');
const PW = process.env.DEMO_PASSWORD || 'Demo@2026';
const ACC = { hrd: 'U-001', recruiter: 'U-002', employee: 'U-003', hrbp: 'U-005', admin: 'U-000', auditor: 'U-006', itvWang: 'U-007', itvSun: 'U-008' };

const lines = [];
let pass = 0, fail = 0;
const log = s => lines.push(s);
function check(name, ok, extra) {
  if (ok) { pass++; log(`  [OK] ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; log(`  [XX] ${name}${extra ? '  ' + extra : ''}`); }
  return !!ok;
}
const eq = (name, got, want) => check(name, got === want, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const has = (name, arr, v) => check(name, Array.isArray(arr) && arr.includes(v), `含 ${v}? ${JSON.stringify(arr)}`);
const lacks = (name, arr, v) => check(name, Array.isArray(arr) && !arr.includes(v), `不应含 ${v}`);

let token = null;
async function call(method, url, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = opts.token !== undefined ? opts.token : token;
  if (t) headers.Authorization = 'Bearer ' + t;
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 静态资源等非 JSON */ }
  return { status: r.status, json, text };
}
async function as(who) {
  const r = await call('POST', '/api/auth/login', { identifier: ACC[who], password: PW }, { token: null });
  if (r.status !== 200) throw new Error(`登录失败 ${who}: ${r.status} ${r.text.slice(0, 160)}`);
  return { token: r.json.token, me: r.json.me };
}
async function boot(t) {
  const r = await call('GET', '/api/bootstrap', undefined, { token: t });
  if (r.status !== 200) throw new Error('bootstrap ' + r.status + ' ' + r.text.slice(0, 200));
  return r.json;
}
const errMsg = r => (r.json && r.json.error && r.json.error.message) || r.text.slice(0, 100);

(async () => {
  log('===== 招聘后链路专项测试（面试 → Offer → 入职前置） =====');
  log('BASE = ' + BASE + '\n');

  /* ---------- 0. 健康检查：确认后端已是本轮版本 ---------- */
  log('[0] 前置');
  const h = await call('GET', '/api/health', undefined, { token: null });
  eq('认证模式 strict', h.json && h.json.authMode, 'strict');
  check('schema >= v5（面试与 Offer 表已迁移）', h.json && h.json.schemaVersion >= 5, 'v' + (h.json && h.json.schemaVersion));

  const hrd = await as('hrd');
  const R = await call('POST', '/api/reset', {}, { token: hrd.token });
  eq('重置演示数据 → 200', R.status, 200);

  const recruiter = await as('recruiter');
  const itvWang = await as('itvWang');
  const itvSun = await as('itvSun');
  const employee = await as('employee');
  const hrbp = await as('hrbp');
  const auditor = await as('auditor');

  /* ---------- 1. 面试官角色：从「配了能力没人当」变成真的有真人 ---------- */
  log('\n[1] 面试官角色落地与行级范围');
  const pWang = await call('GET', '/api/permissions', undefined, { token: itvWang.token });
  eq('王磊角色 = interviewer', pWang.json.me.role, 'interviewer');
  eq('王磊数据范围 = dept', pWang.json.me.scope, 'dept');
  has('王磊有 interview:feedback', pWang.json.me.abilities, 'interview:feedback');
  has('王磊有 candidate:read', pWang.json.me.abilities, 'candidate:read');
  lacks('王磊没有 approval:read（面试官不需要看审批流）', pWang.json.me.abilities, 'approval:read');
  lacks('王磊没有 approval:decide', pWang.json.me.abilities, 'approval:decide');
  lacks('王磊没有 screen:run（不能自己发起筛选）', pWang.json.me.abilities, 'screen:run');

  const bWang = await boot(itvWang.token);
  const jobIdsWang = (bWang.jobs || []).map(j => j.id);
  has('王磊看得到本部门岗位 J-118（后端组）', jobIdsWang, 'J-118');
  lacks('王磊看不到 J-122（前端组，非本部门）', jobIdsWang, 'J-122');
  lacks('王磊看不到 J-126（产品中心）', jobIdsWang, 'J-126');

  const bSun = await boot(itvSun.token);
  const jobIdsSun = (bSun.jobs || []).map(j => j.id);
  has('孙倩看得到 J-126（产品中心）', jobIdsSun, 'J-126');
  lacks('孙倩看不到 J-118（后端组）', jobIdsSun, 'J-118');

  const bEmp = await boot(employee.token);
  eq('员工 bootstrap 不含面试数据', JSON.stringify(bEmp.interviews), '[]');
  eq('员工 bootstrap 不含 Offer 数据', JSON.stringify(bEmp.offers), '[]');
  eq('员工 bootstrap pipeline 为 null', bEmp.pipeline, null);

  /* ---------- 2. 筛选 → 审批 → 已邀约 ---------- */
  log('\n[2] 筛选 → HRD 批准 → 已邀约');
  const run = await call('POST', '/api/agent/screening/run', { jobId: 'J-118' }, { token: hrd.token });
  eq('运行筛选 Agent → 200', run.status, 200);
  check('筛选产生写回审批单', !!run.json.approvalId, 'approvalId=' + run.json.approvalId);

  let b = await boot(hrd.token);
  const pending = (b.approvals || []).filter(a => a.status === 'pending');
  check('存在待批审批单', pending.length > 0, '共 ' + pending.length + ' 条');
  const appr = await call('POST', `/api/approvals/${pending[0].id.replace(/\D/g, '')}/approve`, {}, { token: hrd.token });
  eq('HRD 批准 → 200', appr.status, 200);
  check('批准真实变更了候选人阶段', appr.json.changed >= 1, 'changed=' + appr.json.changed);

  b = await boot(hrd.token);
  const invited = (b.candidates || []).filter(c => c.stage === '已邀约');
  check('出现「已邀约」候选人', invited.length > 0, invited.map(c => c.name + '=' + c.score).join(', '));
  const target = invited[0];
  check('「已邀约」候选人所属岗位为 J-118', target.jobId === 'J-118', target.jobId);

  /* ---------- 3. 安排面试：功能级 + 行级 + 参数校验 ---------- */
  log('\n[3] 安排面试（谁能排、排给谁、参数校验）');
  const at = '2026-10-09 14:00';
  const schBody = { candidateId: target.id, interviewerId: 'U-007', scheduledAt: at, mode: '线上', durationMin: 60 };

  eq('员工安排面试 → 403（无 interview:schedule）', (await call('POST', '/api/interviews', schBody, { token: employee.token })).status, 403);
  eq('审计员安排面试 → 403', (await call('POST', '/api/interviews', schBody, { token: auditor.token })).status, 403);
  eq('面试官自己安排面试 → 403（排期是招聘侧职责）', (await call('POST', '/api/interviews', schBody, { token: itvWang.token })).status, 403);
  eq('HRBP 读面试列表 → 403（能力表里没有 interview:read）', (await call('GET', '/api/interviews', undefined, { token: hrbp.token })).status, 403);

  const badTime = await call('POST', '/api/interviews', Object.assign({}, schBody, { scheduledAt: '下周三下午' }), { token: recruiter.token });
  eq('时间格式非法 → 400', badTime.status, 400);
  const badItv = await call('POST', '/api/interviews', Object.assign({}, schBody, { interviewerId: 'U-003' }), { token: recruiter.token });
  eq('指定非面试官 → 400', badItv.status, 400);

  const ok1 = await call('POST', '/api/interviews', schBody, { token: recruiter.token });
  eq('招聘专员安排面试 → 200', ok1.status, 200);
  eq('轮次自动为第 1 轮', ok1.json.round, 1);
  eq('候选人阶段 → 待面试', ok1.json.stage, '待面试');
  const itvId = ok1.json.id;

  const dup = await call('POST', '/api/interviews', schBody, { token: recruiter.token });
  eq('同轮重复排期 → 409', dup.status, 409);

  /* 招聘专员的数据范围是 all，但岗位必须在范围内 */
  const ghost = await call('POST', '/api/interviews', { candidateId: 'C-NOT-EXIST', interviewerId: 'U-007', scheduledAt: at }, { token: recruiter.token });
  eq('候选人不存在 → 404', ghost.status, 404);

  b = await boot(hrd.token);
  const t1 = (b.candidates || []).find(c => c.id === target.id);
  eq('库内阶段已写入「待面试」', t1 && t1.stage, '待面试');

  /* ---------- 4. 面试官的行级归属 ---------- */
  log('\n[4] 面试官只能碰属于自己的面试');
  const liWang = await call('GET', '/api/interviews', undefined, { token: itvWang.token });
  eq('王磊查询面试列表 → 200', liWang.status, 200);
  check('王磊只看到自己的面试', (liWang.json.interviews || []).every(x => x.interviewerId === 'U-007'),
    JSON.stringify((liWang.json.interviews || []).map(x => x.interviewerId)));
  check('王磊看到了刚安排的面试', (liWang.json.interviews || []).some(x => x.id === itvId));

  const liSun = await call('GET', '/api/interviews', undefined, { token: itvSun.token });
  eq('孙倩查询面试列表 → 200', liSun.status, 200);
  eq('孙倩看不到别人的面试（0 条）', (liSun.json.interviews || []).length, 0);

  const steal = await call('POST', `/api/interviews/${itvId}/start`, {}, { token: itvSun.token });
  eq('孙倩开始王磊的面试 → 403', steal.status, 403);
  check('403 文案点明「不是你的面试」', /不是你的面试/.test(errMsg(steal)), errMsg(steal));

  const start = await call('POST', `/api/interviews/${itvId}/start`, {}, { token: itvWang.token });
  eq('王磊开始面试 → 200', start.status, 200);
  eq('候选人阶段 → 面试中', start.json.stage, '面试中');

  b = await boot(hrd.token);
  check('「面试中」这一状态终于真的会被写入（此前是前端徽章里的死值）',
    (b.candidates || []).some(c => c.stage === '面试中'), '面试中人数=' + (b.candidates || []).filter(c => c.stage === '面试中').length);

  const hrdFeedback = await call('POST', `/api/interviews/${itvId}/feedback`, { result: 'pass', feedback: 'HRD 代填' }, { token: hrd.token });
  eq('HRD 代填面试结论 → 403（纪要只能面试官本人写）', hrdFeedback.status, 403);

  /* ---------- 5. 提交反馈驱动流转 ---------- */
  log('\n[5] 提交面试结论（状态机）');
  const emptyFb = await call('POST', `/api/interviews/${itvId}/feedback`, { result: 'pass', feedback: '' }, { token: itvWang.token });
  eq('空纪要 → 400', emptyFb.status, 400);
  const badRes = await call('POST', `/api/interviews/${itvId}/feedback`, { result: 'maybe', feedback: '技术深度待验证' }, { token: itvWang.token });
  eq('非法结论 → 400', badRes.status, 400);

  const fb1 = await call('POST', `/api/interviews/${itvId}/feedback`,
    { result: 'pass', feedback: '分布式与高并发经验扎实，项目职责描述清楚；建议加一轮复试确认架构能力。', score: 8.5 },
    { token: itvWang.token });
  eq('第 1 轮通过 → 200', fb1.status, 200);
  eq('第 1 轮通过 → 待复试（不是直接发 Offer）', fb1.json.stage, '待复试');
  eq('标记为非终轮', fb1.json.finalRound, false);

  const again = await call('POST', `/api/interviews/${itvId}/feedback`, { result: 'pass', feedback: '重复提交' }, { token: itvWang.token });
  eq('已完成的面试再提交 → 409', again.status, 409);

  /* ---------- 6. 复试 → 待发 offer ---------- */
  log('\n[6] 复试 → 待发offer');
  const ok2 = await call('POST', '/api/interviews',
    { candidateId: target.id, interviewerId: 'U-007', scheduledAt: '2026-10-12 10:00', mode: '现场', durationMin: 90 },
    { token: recruiter.token });
  eq('安排第 2 轮 → 200', ok2.status, 200);
  eq('轮次自增为 2', ok2.json.round, 2);

  await call('POST', `/api/interviews/${ok2.json.id}/start`, {}, { token: itvWang.token });
  const fb2 = await call('POST', `/api/interviews/${ok2.json.id}/feedback`,
    { result: 'pass', feedback: '架构与团队协作能力确认通过，建议进入 Offer 环节。', score: 9 },
    { token: itvWang.token });
  eq('第 2 轮通过 → 200', fb2.status, 200);
  eq('终轮通过 → 待发offer', fb2.json.stage, '待发offer');
  eq('标记为终轮', fb2.json.finalRound, true);

  /* ---------- 7. Offer：合规闸门 + 权限分工 ---------- */
  log('\n[7] Offer（合规校验是代码，审批权归 HRD）');
  const cheap = await call('POST', '/api/offers', { candidateId: target.id, salary: 1000, probationMonths: 3 }, { token: recruiter.token });
  eq('月薪低于最低工资 → 422', cheap.status, 422);
  check('422 说明是合规校验拦截', /合规校验未通过/.test(errMsg(cheap)), errMsg(cheap).slice(0, 90));

  const longProbation = await call('POST', '/api/offers', { candidateId: target.id, salary: 30000, probationMonths: 12 }, { token: recruiter.token });
  eq('试用期超过法定上限 → 422', longProbation.status, 422);

  const of1 = await call('POST', '/api/offers', { candidateId: target.id, salary: 30000, probationMonths: 3, reportDate: '2026-11-02' }, { token: recruiter.token });
  eq('招聘专员起草 Offer → 200', of1.status, 200);
  check('返回合规校验明细', of1.json.checks && of1.json.checks.pass.length >= 3, String(JSON.stringify(of1.json.checks)).slice(0, 160));
  const offerId = of1.json.rawId;

  const dupOffer = await call('POST', '/api/offers', { candidateId: target.id, salary: 30000, probationMonths: 3 }, { token: recruiter.token });
  eq('同一候选人重复起草 → 409', dupOffer.status, 409);

  const empOffer = await call('POST', '/api/offers', { candidateId: target.id, salary: 30000 }, { token: employee.token });
  eq('员工起草 Offer → 403', empOffer.status, 403);

  const recDecide = await call('POST', `/api/offers/${offerId}/decide`, { decision: 'approve' }, { token: recruiter.token });
  eq('招聘专员审批 Offer → 403（没有 offer:decide）', recDecide.status, 403);
  const audDecide = await call('POST', `/api/offers/${offerId}/decide`, { decision: 'approve' }, { token: auditor.token });
  eq('审计员审批 Offer → 403', audDecide.status, 403);

  const rejNoNote = await call('POST', `/api/offers/${offerId}/decide`, { decision: 'reject' }, { token: hrd.token });
  eq('HRD 驳回不带原因 → 400', rejNoNote.status, 400);

  const approved = await call('POST', `/api/offers/${offerId}/decide`, { decision: 'approve' }, { token: hrd.token });
  eq('HRD 批准并发出 → 200', approved.status, 200);
  eq('Offer 状态 = 已发出', approved.json.status, 'sent');
  eq('候选人阶段 → 已发offer', approved.json.stage, '已发offer');

  const resp = await call('POST', `/api/offers/${offerId}/respond`, { accepted: true }, { token: recruiter.token });
  eq('登记候选人接受 → 200', resp.status, 200);
  eq('候选人阶段 → 已入职', resp.json.stage, '已入职');

  /* ---------- 8. 漏斗、审计与 403 分级 ---------- */
  log('\n[8] 漏斗 / 审计 / 403 分级文案');
  b = await boot(hrd.token);
  check('bootstrap 返回 pipeline 漏斗', !!b.pipeline && Array.isArray(b.pipeline.order), JSON.stringify(b.pipeline && b.pipeline.order));
  const hiredStage = b.pipeline && b.pipeline.order.find(x => x.stage === '已入职');
  check('漏斗中「已入职」计数 >= 1', hiredStage && hiredStage.count >= 1, JSON.stringify(hiredStage));
  eq('bootstrap 返回阶段顺序表', Array.isArray(b.stages) && b.stages[0], '待人工复核');
  check('bootstrap 返回面试记录', Array.isArray(b.interviews) && b.interviews.length >= 2, '共 ' + (b.interviews || []).length + ' 条');
  check('bootstrap 返回 Offer', Array.isArray(b.offers) && b.offers.length >= 1, '共 ' + (b.offers || []).length + ' 条');

  const au = await call('GET', '/api/audit?limit=200', undefined, { token: hrd.token });
  eq('审计接口声明 append-only', au.json.appendOnly, true);
  const acts = (au.json.logs || []).map(l => l.action).join(' | ');
  check('审计含「安排面试」', /安排面试/.test(acts));
  check('审计含「提交面试结论」', /提交面试结论/.test(acts));
  check('审计含「批准并发出 Offer」', /批准并发出 Offer/.test(acts));
  check('审计含「登记 Offer 已接受」', /登记 Offer 已接受/.test(acts));

  const empItv = await call('POST', '/api/interviews', schBody, { token: employee.token });
  eq('功能级 403 带 details.level=ability', empItv.json.error.details && empItv.json.error.details.level, 'ability');
  const b126 = (b.candidates || []).filter(c => c.jobId === 'J-126');
  if (b126.length) {
    const cross = await call('GET', `/api/candidates/${b126[0].id}/detail`, undefined, { token: itvWang.token });
    eq('跨部门读候选人 → 403', cross.status, 403);
    eq('行级 403 带 details.level=scope', cross.json.error.details && cross.json.error.details.level, 'scope');
  } else {
    check('J-126 有候选人可供跨部门测试', false, '未取到 J-126 候选人');
  }

  /* ---------- 汇总 ---------- */
  log('\n===== 结果 =====');
  log(`通过 ${pass} · 失败 ${fail}`);
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  lines.push('\n[FATAL] ' + e.message + '\n' + (e.stack || ''));
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(2);
});
