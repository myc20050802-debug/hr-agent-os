/* ===========================================================
   专项测试 · M1 可信底座（认证 / 三层权限 / 审计 / 治理 / 迁移）
   零依赖：只用 Node 22 内置 fetch，不需要 jsdom、不需要测试框架。
   用法：先启动 server/，再执行
         node --experimental-sqlite tools/test_auth.js
   报告写入 tools/_test_auth.txt（UTF8），避免控制台编码问题。

   为什么不用 Jest/Vitest：本项目「零依赖可交付」是产品约束（见 docs/07 §1.3）。
   一个 200 行的自研断言器足以覆盖「跑真实 HTTP 链路」这个诉求，
   而且没有任何安装步骤 —— 评审方 clone 下来就能跑。
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const OUT = path.join(__dirname, '_test_auth.txt');
const DEMO = { hrd: 'U-001', recruiter: 'U-002', employee: 'U-003', hrbp: 'U-005', admin: 'U-000', auditor: 'U-006' };
const PW = process.env.DEMO_PASSWORD || 'Demo@2026';

const lines = [];
let pass = 0, fail = 0;
const log = s => lines.push(s);
function check(name, ok, extra) {
  if (ok) { pass++; log(`  [OK] ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; log(`  [XX] ${name}${extra ? '  ' + extra : ''}`); }
  return ok;
}
function eq(name, got, want) { return check(name, got === want, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }

/* ---------- HTTP 客户端：手动管理令牌，同时验证 Cookie 与 Bearer 两条路 ---------- */
let token = null;
async function call(method, url, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token !== undefined ? opts.token : token) {
    const t = opts.token !== undefined ? opts.token : token;
    if (opts.via === 'cookie') headers.Cookie = `hr_session=${t}`;
    else headers.Authorization = 'Bearer ' + t;
  }
  if (opts.headers) Object.assign(headers, opts.headers);
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON（静态资源） */ }
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/hr_session=([^;]+)/);
  return { status: r.status, json, text, setCookie, cookieToken: m ? m[1] : null };
}
const as = async who => {
  const r = await call('POST', '/api/auth/login', { identifier: DEMO[who], password: PW }, { token: null });
  if (r.status !== 200) throw new Error(`登录失败 ${who}: ${r.status} ${r.text.slice(0, 120)}`);
  return { token: r.json.token, cookie: r.cookieToken, me: r.json.me };
};

(async () => {
  log('===== M1 可信底座专项测试 =====');
  log('BASE = ' + BASE + '\n');

  /* ---------- 0. 健康检查 ---------- */
  log('[0] 系统');
  const h = await call('GET', '/api/health', undefined, { token: null });
  check('健康检查 200', h.status === 200, JSON.stringify(h.json));
  eq('认证模式为 strict', h.json.authMode, 'strict');
  check('schema 版本 >= 4', h.json.schemaVersion >= 4, 'v' + h.json.schemaVersion);

  /* ---------- 1. 匿名访问 ---------- */
  log('\n[1] 匿名访问（这是 M1 的核心：不再默认是 HRD）');
  const guarded = ['/api/bootstrap', '/api/jobs', '/api/audit', '/api/metrics', '/api/governance/summary', '/api/users', '/api/permissions'];
  for (const p of guarded) {
    const r = await call('GET', p, undefined, { token: null });
    check(`匿名 GET ${p} → 401`, r.status === 401, 'http=' + r.status);
  }
  const forged = await call('GET', '/api/bootstrap', undefined, { token: null, headers: { 'X-User': 'U-001' } });
  check('伪造 X-User 头仍 401（请求头信任已移除）', forged.status === 401, 'http=' + forged.status);

  /* ---------- 2. 登录 ---------- */
  log('\n[2] 登录与会话');
  const badPw = await call('POST', '/api/auth/login', { identifier: DEMO.hrd, password: 'wrong-pass' }, { token: null });
  eq('错误口令 → 401', badPw.status, 401);
  const ghost = await call('POST', '/api/auth/login', { identifier: 'U-999', password: 'whatever' }, { token: null });
  eq('不存在账号 → 401', ghost.status, 401);
  eq('两种失败提示一致（不可枚举账号）', ghost.json.error.message, badPw.json.error.message);
  const missing = await call('POST', '/api/auth/login', {}, { token: null });
  eq('缺参数 → 400', missing.status, 400);

  const hrd = await as('hrd');
  token = hrd.token;
  check('HRD 登录成功并下发令牌', !!hrd.token, '角色=' + hrd.me.role + ' 能力=' + hrd.me.abilities.length);
  check('响应含 Set-Cookie 会话', !!hrd.cookie, 'cookie 长度=' + (hrd.cookie || '').length);
  const viaCookie = await call('GET', '/api/auth/me', undefined, { token: hrd.cookie, via: 'cookie' });
  check('Cookie 通道可鉴权', viaCookie.status === 200, 'http=' + viaCookie.status);
  const viaBearer = await call('GET', '/api/auth/me', undefined, { token: hrd.token });
  check('Bearer 通道可鉴权', viaBearer.status === 200, 'http=' + viaBearer.status);
  const tampered = hrd.token.slice(0, -4) + 'AAAA';
  const bad = await call('GET', '/api/auth/me', undefined, { token: tampered });
  eq('篡改令牌 → 401', bad.status, 401);
  eq('X-User 无法覆盖会话身份', (await call('GET', '/api/auth/me', undefined, { headers: { 'X-User': 'U-003' } })).json.me.id, DEMO.hrd);

  /* ---------- 3. HRD 全量视图 ---------- */
  log('\n[3] HRD 全量视图（功能级 + 字段级均通过）');
  const bh = await call('GET', '/api/bootstrap');
  eq('bootstrap 200', bh.status, 200);
  check('岗位数 > 0', bh.json.jobs.length > 0, 'jobs=' + bh.json.jobs.length);
  check('候选人数 > 0', bh.json.candidates.length > 0, 'candidates=' + bh.json.candidates.length);
  check('员工数 > 0', bh.json.employees.length > 0, 'employees=' + bh.json.employees.length);
  check('审计日志可见', bh.json.auditLogs.length > 0, 'logs=' + bh.json.auditLogs.length);
  const hrdCand = bh.json.candidates.find(c => c.gender && c.gender !== '已脱敏');
  check('HRD 可见未脱敏字段（pii:read）', !!hrdCand, hrdCand ? '样本 ' + hrdCand.id : '全部被遮罩');

  /* ---------- 4. 招聘专员：字段级脱敏 ---------- */
  log('\n[4] 招聘专员：有 candidate:read 但无 pii:read → 字段级脱敏');
  const rec = await as('recruiter');
  token = rec.token;
  const br = await call('GET', '/api/bootstrap');
  eq('bootstrap 200', br.status, 200);
  check('候选人可见', br.json.candidates.length > 0, 'candidates=' + br.json.candidates.length);
  check('受保护字段已遮罩', br.json.candidates.every(c => c.gender === '已脱敏' || c.gender === undefined),
    '样本 gender=' + (br.json.candidates[0] || {}).gender);
  check('招聘专员看不到审计日志（无 audit:read）', br.json.auditLogs.length === 0);
  eq('/api/audit → 403', (await call('GET', '/api/audit')).status, 403);

  /* ---------- 5. HRBP：行级=本部门 ---------- */
  log('\n[5] HRBP：行级范围=本部门（含下级）');
  const hb = await as('hrbp');
  token = hb.token;
  const bb = await call('GET', '/api/bootstrap');
  eq('bootstrap 200', bb.status, 200);
  check('岗位被行级裁剪到本部门', bb.json.jobs.length > 0 && bb.json.jobs.every(j => String(j.dept || '').startsWith('/人力资源中心')),
    'jobs=' + bb.json.jobs.length + ' depts=' + JSON.stringify([...new Set(bb.json.jobs.map(j => j.dept))]));
  check('候选人同步裁剪', bb.json.candidates.every(c => bb.json.jobs.some(j => j.id === c.jobId)));
  eq('HRBP 无 job:write → 建岗 403', (await call('POST', '/api/jobs', { title: 'X' })).status, 403);

  /* ---------- 6. 员工：自助最小集 ---------- */
  log('\n[6] 员工：自助最小集 + 越权拦截');
  const emp = await as('employee');
  token = emp.token;
  const be = await call('GET', '/api/bootstrap');
  eq('bootstrap 200', be.status, 200);
  eq('岗位不可见', be.json.jobs.length, 0);
  eq('候选人不可见', be.json.candidates.length, 0);
  eq('员工档案不可见', be.json.employees.length, 0);
  eq('审计不可见', be.json.auditLogs.length, 0);
  eq('自助标记生效', be.json.kpis.selfServiceOnly, true);
  check('可读知识库（自助检索需要）', be.json.kbDocs.length > 0, 'kbDocs=' + be.json.kbDocs.length);
  check('可读本人年假余额', !!be.json.myLeave, JSON.stringify(be.json.myLeave));

  const beforeDenied = (await (async () => { token = hrd.token; return call('GET', '/api/audit'); })()).json;
  const blockedBefore = beforeDenied.stats.blocked;
  token = emp.token;
  eq('员工导出全公司 → 403', (await call('POST', '/api/employees/export', {})).status, 403);
  eq('员工读审计 → 403', (await call('GET', '/api/audit')).status, 403);
  eq('员工看指标 → 403', (await call('GET', '/api/metrics')).status, 403);
  eq('员工建岗 → 403', (await call('POST', '/api/jobs', { title: 'X' })).status, 403);
  eq('员工跑筛选 → 403', (await call('POST', '/api/agent/screening/run', {})).status, 403);
  eq('员工改留存策略 → 403', (await call('PUT', '/api/governance/policies', { dataClass: '候选人简历', retainDays: 1 })).status, 403);
  eq('员工重置演示数据 → 403', (await call('POST', '/api/reset', {})).status, 403);

  token = hrd.token;
  const after = (await call('GET', '/api/audit')).json;
  check('越权尝试已被写入审计（blocked 增长）', after.stats.blocked > blockedBefore,
    `blocked ${blockedBefore} → ${after.stats.blocked}`);
  const blockedLog = after.logs.find(l => l.result === 'blocked' && String(l.detail || '').includes('被拦截'));
  check('审计记录含「谁想做什么、被谁拦下」', !!blockedLog, blockedLog ? String(blockedLog.detail).slice(0, 70) : '未找到');
  eq('审计接口声明 append-only', after.appendOnly, true);
  check('HRD 审计统计可读', after.stats.total > 0, JSON.stringify(after.stats));

  /* ---------- 7. 行级越权的真实路径（候选人详情） ---------- */
  log('\n[7] 候选人详情：PII 读取必须留痕，无权限则遮罩 + 记 blocked');
  const anyJob = dbJobId(bh.json.jobs);
  const anyCand = bh.json.candidates[0];
  if (anyCand) {
    const dHrd = await call('GET', `/api/candidates/${anyCand.id}/detail`);
    eq('HRD 读详情 200', dHrd.status, 200);
    eq('HRD 拿到未脱敏', dHrd.json.candidate.masked, false);
    token = rec.token;
    const dRec = await call('GET', `/api/candidates/${anyCand.id}/detail`);
    eq('招聘专员读详情 200', dRec.status, 200);
    eq('招聘专员拿到脱敏结果', dRec.json.candidate.masked, true);
    eq('性别被遮罩', dRec.json.candidate.gender, '已脱敏');
    token = emp.token;
    eq('员工读详情 → 403（无 candidate:read）', (await call('GET', `/api/candidates/${anyCand.id}/detail`)).status, 403);
  }

  /* ---------- 8. 迁移与数据治理 ---------- */
  token = hrd.token;
  log('\n[8] 数据治理（M8）');
  const gs = await call('GET', '/api/governance/summary');
  eq('治理总览 200', gs.status, 200);
  check('留存策略已初始化', gs.json.summary.policies.length >= 3, gs.json.summary.policies.map(p => p.data_class + '=' + p.retain_days + 'd').join(', '));
  check('候选人到期字段已回填', typeof gs.json.summary.dueForDeletion === 'number');
  const pol = await call('PUT', '/api/governance/policies', { dataClass: '落选者档案', retainDays: 45, basis: '测试调整' });
  eq('调整留存策略 200', pol.status, 200);
  check('策略已更新为 45 天', pol.json.policies.some(p => p.data_class === '落选者档案' && p.retain_days === 45));
  eq('非法留存天数 → 400', (await call('PUT', '/api/governance/policies', { dataClass: '落选者档案', retainDays: 0 })).status, 400);

  const sweep = await call('POST', '/api/governance/sweep', { dryRun: true });
  eq('留存巡检(dryRun) 200', sweep.status, 200);

  if (anyCand) {
    check('登记授权', (await call('POST', '/api/governance/consents', { candidateId: anyCand.id, purpose: '招聘评估', days: 30 })).status === 200);
    const cl = await call('GET', `/api/governance/consents?candidateId=${anyCand.id}`);
    check('授权可查', cl.json.consents.length > 0, '共 ' + cl.json.consents.length + ' 条');
    check('撤回授权', (await call('POST', '/api/governance/consents/revoke', { candidateId: anyCand.id })).status === 200);
    const ex = await call('GET', `/api/governance/subject/${anyCand.id}/export`);
    eq('数据主体导出（查阅权）200', ex.status, 200);
    check('导出含授权与留存信息', !!ex.json.subjectData.consents && !!ex.json.subjectData.retention);
    const noReason = await call('POST', '/api/governance/erasure', { candidateId: anyCand.id });
    eq('删除不写事由 → 400（合规要求）', noReason.status, 400);
    const erased = await call('POST', '/api/governance/erasure', { candidateId: anyCand.id, reason: '数据主体申请删除', mode: 'anonymize' });
    eq('匿名化删除 200', erased.status, 200);
    const after = await call('GET', `/api/candidates/${anyCand.id}/detail`);
    eq('删除后姓名已匿名化', after.json.candidate.name, '已删除');
    check('删除后仍保留存在性事实（审计链不断）', !!after.json.candidate.anonymizedAt);
    eq('删除请求已登记', (await call('GET', '/api/governance/erasure')).json.requests.length > 0, true);
  }

  /* ---------- 9. 岗位 CRUD + 筛选 Agent（HRD） ---------- */
  log('\n[9] 岗位 CRUD 与筛选 Agent（真实写库）');
  const created = await call('POST', '/api/jobs', {
    title: '供应链采购专员', industry: '制造业', dept: '/供应链中心', mustYears: 3, eduRank: 2,
    must: ['3 年以上采购经验，熟悉供应商开发与成本管控'], nice: ['有 ERP 使用经验'],
  });
  eq('建岗 200', created.status, 200);
  const newId = created.json.job && created.json.job.id;
  check('返回新岗位 ID', !!newId, newId);
  if (newId) {
    const seeded = await call('POST', `/api/jobs/${newId}/seed-candidates`, { count: 3 });
    eq('自动生成演示简历 200', seeded.status, 200);
    eq('生成数量正确', seeded.json.seeded, 3);
    const upd = await call('PUT', `/api/jobs/${newId}`, { title: '供应链采购专员（改）' });
    eq('改岗 200', upd.status, 200);
    const run = await call('POST', '/api/agent/screening/run', { jobId: newId });
    eq('筛选 Agent 200', run.status, 200);
    check('返回真实执行步骤', Array.isArray(run.json.steps) && run.json.steps.length >= 5, 'steps=' + (run.json.steps || []).length);
    const del = await call('DELETE', `/api/jobs/${newId}`);
    eq('删岗 200', del.status, 200);
    eq('删不存在的岗位 → 404', (await call('DELETE', '/api/jobs/J-XXX')).status, 404);
  }
  eq('建岗缺名称 → 400', (await call('POST', '/api/jobs', { industry: '制造业' })).status, 400);

  const jd = await call('POST', '/api/agent/jd/generate', { title: 'AI 产品经理', industry: '互联网' });
  eq('JD 生成 200', jd.status, 200);
  eq('识别职能族为 product（不是按行业兜底）', jd.json.fnKey, 'product');
  check('JD 正文未混入 Java / Spring（职能族优先仍生效）', !/Java|Spring/i.test(jd.json.jd || ''),
    'jd 前 60 字=' + String(jd.json.jd || '').slice(0, 60).replace(/\n/g, ' '));
  check('JD 含合规扫描结论', !!jd.json.scan, JSON.stringify(jd.json.scan));
  const scan = await call('POST', '/api/agent/jd/generate', { title: '渠道销售专员', industry: '销售', must: ['限男性，35 岁以下，需本地户籍'] });
  check('歧视性用语被扫描命中', (scan.json.scan.flagged || []).length > 0, JSON.stringify(scan.json.scan.flagged).slice(0, 120));
  eq('命中后阻断直接发布', scan.json.blockPublish, true);

  /* ---------- 10. 审批与越权演示 ---------- */
  log('\n[10] 审批、导出与审计闭环');
  const exp = await call('POST', '/api/employees/export', {});
  eq('HRD 导出全量 200', exp.status, 200);
  check('返回行数', exp.json.rows > 0, 'rows=' + exp.json.rows);
  const apList = await call('GET', '/api/bootstrap');
  const pending = apList.json.approvals.find(a => a.status === 'pending');
  if (pending) {
    const apId = String(pending.id).replace(/\D/g, '');
    eq('驳回不填原因 → 400', (await call('POST', `/api/approvals/${apId}/reject`, {})).status, 400);
    eq('驳回填原因 → 200', (await call('POST', `/api/approvals/${apId}/reject`, { reason: '候选人年限不足，人工复核驳回' })).status, 200);
    eq('重复处理 → 409', (await call('POST', `/api/approvals/${apId}/reject`, { reason: 'again' })).status, 409);
  }

  /* ---------- 11. 账号管理与强制下线 ---------- */
  log('\n[11] 账号与会话管理');
  eq('HRD 无 admin:user → /api/users 403', (await call('GET', '/api/users')).status, 403);
  const adm = await as('admin');
  token = adm.token;
  const users = await call('GET', '/api/users');
  eq('管理员读账号列表 200', users.status, 200);
  const adminCount = users.json.users.filter(u => u.role === 'admin').length;
  check('已补齐 admin 与 auditor 账号', users.json.users.some(u => u.role === 'auditor') && adminCount >= 1,
    '共 ' + users.json.users.length + ' 个账号');
  check('账号列表不含口令哈希', !/password_hash/.test(users.text));
  const rev = await call('POST', `/api/users/${DEMO.hrbp}/revoke-sessions`, {});
  eq('强制下线 200', rev.status, 200);
  check('吊销数可读', typeof rev.json.revoked === 'number', 'revoked=' + rev.json.revoked);
  eq('强下线不存在的用户 → 404', (await call('POST', '/api/users/U-999/revoke-sessions', {})).status, 404);

  /* ---------- 12. 数据主体与审计员角色 ---------- */
  log('\n[12] 数据保护负责人（auditor）');
  const aud = await as('auditor');
  token = aud.token;
  eq('审计员读审计 200', (await call('GET', '/api/audit')).status, 200);
  eq('审计员读治理 200', (await call('GET', '/api/governance/summary')).status, 200);
  eq('审计员读指标 200', (await call('GET', '/api/metrics')).status, 200);
  eq('审计员建岗 403', (await call('POST', '/api/jobs', { title: 'X' })).status, 403);
  eq('审计员写治理 403', (await call('PUT', '/api/governance/policies', { dataClass: '候选人简历', retainDays: 30 })).status, 403);
  eq('审计员无 pii:read，候选人不可见', (await call('GET', '/api/bootstrap')).json.candidates.length, 0);

  /* ---------- 13. 指标 ---------- */
  token = hrd.token;
  const mt = await call('GET', '/api/metrics');
  eq('指标 200', mt.status, 200);
  check('含延迟分位', !!mt.json.metrics.latencyMs && typeof mt.json.metrics.latencyMs.p95 === 'number', JSON.stringify(mt.json.metrics.latencyMs));
  check('含错误率与计数', typeof mt.json.metrics.errorRate === 'number' && typeof mt.json.metrics.requests === 'number');
  check('含业务计数（越权拦截等）', Object.keys(mt.json.metrics.counters).length > 0, JSON.stringify(mt.json.metrics.counters).slice(0, 160));

  /* ---------- 14. 限流 ---------- */
  log('\n[14] 登录限流（防暴力破解）');
  let limited = false, codes = [];
  for (let i = 0; i < 14; i++) {
    const r = await call('POST', '/api/auth/login', { identifier: 'U-004', password: 'brute-force-' + i }, { token: null });
    codes.push(r.status);
    if (r.status === 429) { limited = true; break; }
  }
  check('连续失败触发 429', limited, '状态序列=' + codes.join(','));

  /* ---------- 15. 登出 ---------- */
  log('\n[15] 登出与会话吊销');
  const t2 = (await as('hrbp')).token;
  token = t2;
  eq('登出前 /api/auth/me 200', (await call('GET', '/api/auth/me')).status, 200);
  eq('登出 200', (await call('POST', '/api/auth/logout', {})).status, 200);
  eq('登出后同令牌 → 401', (await call('GET', '/api/auth/me', undefined, { token: t2 })).status, 401);

  /* ---------- 16. 错误契约 ---------- */
  log('\n[16] 统一错误契约');
  token = hrd.token;
  const nf = await call('GET', '/api/does-not-exist');
  eq('未知接口 404', nf.status, 404);
  eq('错误体含 code', nf.json.error.code, 'NOT_FOUND');
  check('错误体含 requestId', !!nf.json.requestId, nf.json.requestId);
  eq('方法不允许 405', (await call('DELETE', '/api/bootstrap')).status, 405);
  const badJson = await fetch(BASE + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: '{not json' });
  eq('非法 JSON 体 → 400', badJson.status, 400);
  const big = await fetch(BASE + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ title: 'x'.repeat(9 * 1024 * 1024) }) });
  eq('超大请求体 → 413', big.status, 413);

  /* ---------- 收尾 ---------- */
  log('\n[17] 数据一致性复查');
  token = hrd.token;
  const fin = await call('GET', '/api/audit?limit=500');
  check('审计链连续（无 error 结果）', fin.json.stats.error === 0, JSON.stringify(fin.json.stats));
  log('\n===== 结果 =====');
  log(`通过 ${pass} 项，失败 ${fail} 项`);
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  log('\n[FATAL] ' + (e && e.stack || e));
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  process.exit(2);
});

function dbJobId(jobs) { return jobs && jobs[0] ? jobs[0].id : null; }
