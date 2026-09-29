/* ===========================================================
   L1 · 路由层（routes）
   职责：把「协议 + 权限 + 编排」声明在一张表里，业务实现仍交给 L2 领域模块。

   本文件的核心价值是**一眼可审**：
   每条路由都显式标出 `need`（功能级能力），没标的只有两种可能 ——
   要么 public（登录 / 健康检查），要么「任意登录用户可读的系统参考信息」。
   安全评审时只需读这一张表，不必翻遍 handler。

   分层纪律（docs/08 §3.2）：
   - 本层**不写业务规则**，业务实现一律调 L2（engine / auth / governance）。
   - 本层负责：入参校验 → 调 L2 → 组装响应 → 决定哪些字段要脱敏。
   - 行级（数据范围）与字段级脱敏在这里落地，因为它们依赖「谁在请求」。
   =========================================================== */
'use strict';
const { config } = require('./config.js');
const { createRouter } = require('./http-kernel.js');
const engine = require('./engine.js');
const dbmod = require('./db.js');
const auth = require('./auth.js');
const rbac = require('./rbac.js');
const audit = require('./audit.js');
const gov = require('./governance.js');
const hiring = require('./hiring.js');
const metrics = require('./metrics.js');
const OverrideCodes = require('../shared/override-codes.js');
const { badRequest, notFound, conflict, forbidden, AppError } = require('./errors.js');

/* 演示租户：本期单租户。它是**服务端常量**，永不从请求读取 —— 见 rbac 文件头纪律。 */
const TENANT = 'T-001';

const J = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/* ===========================================================
   只读快照：按角色裁剪 bootstrap
   =========================================================== */
/**
 * 为什么 bootstrap 要按角色裁剪，而不是「全量返回 + 前端隐藏」：
 * 「前端隐藏」只是视觉效果 —— 数据已经到浏览器了，抓包即得。
 * 真正的行级权限必须在**服务端出数据之前**完成裁剪。
 */
function scopeSnapshot(db, ctx) {
  const masking = rbac.shouldMask(ctx);
  const canCand = rbac.can(ctx, 'candidate:read');
  const canApproval = rbac.can(ctx, 'approval:read');
  const canAudit = rbac.can(ctx, 'audit:read');
  const canEmp = rbac.can(ctx, 'employee:read');
  const canReport = rbac.can(ctx, 'report:read');
  const canItv = rbac.can(ctx, 'interview:read');
  const canOffer = rbac.can(ctx, 'offer:read');
  const canSchedule = rbac.can(ctx, 'interview:schedule');

  /* 面试官的第二道行级收窄：他看得到候选人列表，但**只应该看到与自己有关的人**。
     只按「岗位属于本部门」过滤是不够的 —— 同部门在招 5 个岗位、10 个候选人，
     面试官只负责其中 2 个，那另外 8 份简历不该出现在他的候选人库里。
     这条规则写在服务端出数据之前（同 docs/08 ADR-009：前端隐藏 ≠ 权限）。 */
  const myInterviewCandidates = ctx.role === 'interviewer'
    ? new Set(hiring.listInterviews(db, { ctx }).map(i => i.candidateId))
    : null;

  const kbDocs = () => db.prepare(`SELECT * FROM kb_documents WHERE tenant_id=? AND status='active' ORDER BY id`).all(TENANT).map(d => ({
    id: d.id, title: d.title, ver: d.ver, eff: d.effective_at, scope: '全员可见',
    chunks: db.prepare(`SELECT COUNT(*) c FROM kb_chunks WHERE doc_id=?`).get(d.id).c,
    updated: d.updated_at,
    covers: J((db.prepare(`SELECT keywords FROM kb_chunks WHERE doc_id=? LIMIT 1`).get(d.id) || {}).keywords),
  }));

  /* 员工角色：只返回「自助」所需的最小数据集。
     注意这里连岗位列表都不给 —— 不是「不给看」，而是「这不属于他的工作界面」。 */
  if (!rbac.can(ctx, 'job:read') && rbac.can(ctx, 'self:read')) {
    const lb = db.prepare(`SELECT * FROM leave_balance WHERE user_id=?`).get(ctx.userId);
    return {
      jobs: [], candidates: [], approvals: [], employees: [], auditLogs: [], activity: [],
      /* 招聘后链路一并对员工清空：字段必须**存在且为空数组**，不能省略。
         前端按 `D.interviews.length` 这类方式渲染，键缺失会变成 undefined 而不是「空」，
         直接让页面崩掉（这个坑在治理匿名化那次已经踩过一次，见 docs/09 §六）。 */
      interviews: [], offers: [], interviewers: [], pipeline: null, stages: [],
      kbDocs: kbDocs(), kbUnanswered: [], myLeave: lb || null,
      industries: dbmod.INDUSTRIES, industrySkills: {},
      kpis: { pendingApprovals: 0, selfServiceOnly: true },
    };
  }

  const snap = engine.bootstrap(db);              // 全量快照（含 JD 版本自愈）

  /* 行级：岗位按部门子树过滤 */
  const scopeJobIds = new Set(snap.jobs.filter(j => rbac.inScope(ctx, { deptPath: j.dept })).map(j => j.id));

  return {
    jobs: snap.jobs.filter(j => scopeJobIds.has(j.id)),
    /* 行级 + 字段级：候选人 */
    candidates: canCand
      ? snap.candidates
        .filter(c => scopeJobIds.has(c.jobId))
        .filter(c => !myInterviewCandidates || myInterviewCandidates.has(c.id))
        .map(c => (masking ? { ...c, gender: '已脱敏', birth: '已脱敏' } : c))
      : [],
    /* 招聘后链路：面试与 Offer（行级规则在 hiring.js 内，两处必须一致） */
    interviews: canItv ? hiring.listInterviews(db, { ctx }) : [],
    offers: canOffer ? hiring.listOffers(db, { ctx }) : [],
    interviewers: canSchedule ? hiring.interviewers(db) : [],
    pipeline: canCand ? hiring.pipeline(db) : null,
    stages: hiring.FUNNEL,
    approvals: canApproval ? snap.approvals : [],
    employees: canEmp ? snap.employees.filter(e => rbac.inScope(ctx, { deptPath: e.dept, ownerId: e.id })) : [],
    auditLogs: canAudit ? snap.auditLogs : [],
    activity: canAudit ? snap.activity : [],
    kbDocs: snap.kbDocs,
    kbUnanswered: canApproval ? snap.kbUnanswered : [],
    industries: snap.industries,
    industrySkills: snap.industrySkills,
    kpis: canReport
      ? Object.assign({}, snap.kpis, {
        pendingApprovals: (canApproval ? snap.approvals : []).filter(a => a.status === 'pending').length,
      })
      : { pendingApprovals: 0 },
  };
}

/* ===========================================================
   路由表
   =========================================================== */
function buildRouter(db) {
  const r = createRouter();

  /* ---------- 行级越权：写审计后抛 403 ----------
     写成「返回错误对象」而不是「抛」，是为了让调用点读起来是
     `if (!ok) throw denyScope(...)` 这种一眼能懂的形态。 */
  function denyScope(rc, objectType, objectId, reason) {
    audit.denied(db, {
      tenantId: TENANT, actorId: rc.ctx.userId, action: '行级越权访问尝试',
      objectType, objectId, reason, requestId: rc.requestId,
    });
    metrics.inc('rbac.denied');
    /* 这里是**行级**拒绝：动作本身你有权做，但这条记录不在你的数据范围内。
       与 http-kernel 里的功能级 403 措辞刻意区分开（见该处注释）。 */
    return new AppError('FORBIDDEN', '403：数据范围不足 —— 你有权做这个动作，但该记录不在你的数据范围内', {
      details: { level: 'scope', objectType, objectId },
    });
  }

  function jobInScope(rc, jobId) {
    const job = db.prepare(`SELECT id,dept_path FROM jobs WHERE id=?`).get(jobId);
    if (!job) throw notFound('岗位不存在');
    if (!rbac.inScope(rc.ctx, { deptPath: job.dept_path })) {
      throw denyScope(rc, 'job', jobId, `岗位属于 ${job.dept_path}，超出角色 ${rc.ctx.role} 的数据范围`);
    }
    return job;
  }

  /* 把 hiring 的领域错误码翻译成 HTTP 语义。
     为什么集中成一个函数：状态机有十来个拒绝理由，如果每个 handler 各写一段 if，
     迟早出现「同一个错误在不同接口返回不同状态码」——那前端就没法统一处理了。 */
  function hiringError(out) {
    switch (out.error) {
      case 'candidate_not_found': return notFound('候选人不存在');
      case 'not_found': return notFound('记录不存在');
      case 'interviewer_not_found': return badRequest('面试官不存在或已停用（必须是 interviewer 角色的在职账号）');
      case 'stage_not_schedulable': return conflict(`候选人当前处于「${out.stage}」，不能安排面试。只有「已邀约 / 待复试」可排期`);
      case 'bad_time': return badRequest(out.hint || '时间格式非法，应为 YYYY-MM-DD HH:MM');
      case 'round_already_open': return conflict(`该候选人已有未完成的面试安排（#${out.existingId} · 第 ${out.round} 轮）：请先提交结论或取消它，再排下一场`);
      case 'not_your_interview': return forbidden('这不是你的面试。面试纪要只能由本场面试官本人填写（HR 也不可代填）');
      case 'bad_status': return conflict(`当前状态（${out.status}）不允许该操作`);
      case 'bad_result': return badRequest('面试结论必须是 pass / hold / fail 之一');
      case 'feedback_required': return badRequest(out.hint || '面试纪要必填');
      case 'stage_not_offerable': return conflict(`候选人当前处于「${out.stage}」，只有面试通过（待发offer）才能起草 Offer`);
      case 'offer_already_open': return conflict(`该候选人已有未结的 Offer（${out.existingId} · ${out.status}），不能重复起草`);
      case 'compliance_blocked':
        return new AppError('UNPROCESSABLE',
          '合规校验未通过，Offer 未创建（这是代码校验，不是模型判断）：\n· ' + out.checks.block.join('\n· '),
          { details: { checks: out.checks } });
      case 'reason_required': return badRequest('驳回必须填写原因');
      default: return badRequest('操作失败：' + out.error);
    }
  }

  /** 候选人 → 岗位 → 行级校验（面试/Offer 两类动作共用同一道闸门） */
  function candidateInScope(rc, candidateId) {
    const c = db.prepare(`SELECT * FROM candidates WHERE id=?`).get(candidateId);
    if (!c) throw notFound('候选人不存在');
    jobInScope(rc, c.job_id);
    return c;
  }

  const needFull = ctx => rbac.can(ctx, 'job:read') || rbac.can(ctx, 'report:read') || rbac.can(ctx, 'approval:read');

  /* ================= 系统 ================= */
  r.get('/api/health', { public: true }, rc => rc.ok({
    time: audit.nowCN(),
    mode: engine.llmConfigured() ? 'llm' : 'rule',
    authMode: config.auth.mode,
    schemaVersion: dbmod.schemaVersion(db),
    uptimeSec: metrics.snapshot().uptimeSec,
    /* WAL 体积：只读的运维信息。写在这里是因为「库很小、磁盘却占了不少」
       和「备份出来的 .db 少数据」这两个问题的第一现场都是它。 */
    wal: dbmod.walInfo(db),
  }));

  r.get('/api/metrics', { need: 'metrics:read' }, rc => rc.ok({ metrics: metrics.snapshot() }));

  /* 筛选一致率：AI 档位 vs 人工结论（样本来自真实操作，不做演示假数据）。
     为什么单独开一个接口而不是塞进 /api/metrics：
     /api/metrics 是运行计数器（请求数、时长），这里是**质量指标**，口径完全不同，
     混在一起会让「0 次请求」和「0 个人工复核」难以区分。 */
  r.get('/api/metrics/agreement', { need: 'metrics:read' }, rc => rc.ok({
    agreement: engine.screeningAgreement(db, TENANT),
    definitions: {
      '档位一致率': '人工确认 AI 结论的样本 ÷ 全部有人工结论的样本',
      humanOverrodeUp: 'AI 判不合适、人工推进（规则过严）',
      humanOverrodeDown: 'AI 判合适、人工否决（规则过宽）',
    },
  }));

  /* ================= 认证 ================= */
  r.post('/api/auth/login', { public: true }, async rc => {
    const b = await rc.body();
    const out = auth.login(db, {
      identifier: b.identifier || b.username, password: b.password,
      ip: rc.ip, userAgent: rc.headers['user-agent'],
    });
    rc.setCookie(config.auth.cookieName, out.token, { maxAge: Math.floor(config.auth.sessionTtlMs / 1000) });
    return rc.ok({
      token: out.token, expiresAt: out.expiresAt,
      me: rbac.describe(out.ctx),
      mustChangePassword: !!out.user.must_change_password,
    });
  });

  r.post('/api/auth/logout', {}, rc => {
    auth.logout(db, rc.ctx);
    rc.clearCookie(config.auth.cookieName);
    return rc.ok({});
  });

  r.get('/api/auth/me', {}, rc => rc.ok({
    me: rbac.describe(rc.ctx),
    authMode: config.auth.mode,
    mustChangePassword: !!rc.user.must_change_password,
    activeSessions: auth.activeSessions(db, rc.ctx.userId).length,
  }));

  r.post('/api/auth/change-password', {}, async rc => {
    const b = await rc.body();
    const out = auth.changePassword(db, rc.ctx, b.oldPassword, b.newPassword);
    rc.clearCookie(config.auth.cookieName);       // 改密后旧会话全废，强制重新登录
    return rc.ok(out);
  });

  /* 系统参考信息：任意登录用户可读（不含任何业务数据） */
  r.get('/api/permissions', {}, rc => rc.ok({
    roles: Object.entries(rbac.ROLE_ABILITIES).map(([role, abilities]) => ({
      role, label: rbac.ROLE_LABEL[role] || role,
      scope: rbac.ROLE_SCOPE[role] || 'self',
      abilities: abilities.includes('*') ? ['*（全部能力）'] : abilities,
      count: abilities.includes('*') ? rbac.ABILITIES.length : abilities.length,
    })),
    abilities: rbac.ABILITIES,
    scopeLabels: { all: '全量数据', dept: '本部门（含下级）', self: '仅本人' },
    me: rbac.describe(rc.ctx),
  }));

  /* ================= 启动快照 ================= */
  r.get('/api/bootstrap', {}, rc => rc.ok(Object.assign(
    {
      server: true,
      mode: engine.llmConfigured() ? 'llm' : 'rule',
      me: rbac.describe(rc.ctx),
      authMode: config.auth.mode,
      schemaVersion: dbmod.schemaVersion(db),
      /* 推翻原因枚举由服务端下发（唯一真源），前端不再自己硬编码一份 */
      overrideCodes: { decisions: OverrideCodes.DECISIONS, codes: OverrideCodes.CODES },
    },
    needFull(rc.ctx) ? scopeSnapshot(db, rc.ctx) : scopeSnapshot(db, rc.ctx)
  )));

  /* ================= 岗位库 ================= */
  r.get('/api/jobs', { need: 'job:read' }, rc => {
    const jobs = db.prepare(`SELECT * FROM jobs ORDER BY COALESCE(opened_at,'') DESC, id`).all()
      .filter(j => rbac.inScope(rc.ctx, { deptPath: j.dept_path }))
      .map(j => ({
        id: j.id, title: j.title, dept: j.dept_path, industry: j.industry || '互联网',
        mustHave: J(j.must_have), niceHave: J(j.nice_have), keywords: J(j.keywords),
        mustYears: j.must_years, mustEduRank: j.must_edu_rank, salary: j.salary || '',
        headcount: j.headcount || 1, openedAt: j.opened_at || '', status: j.status,
        applicants: db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=?`).get(j.id).c,
        pending: db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=? AND ai_score IS NULL`).get(j.id).c,
      }));
    return rc.ok({ jobs, industries: dbmod.INDUSTRIES });
  });

  r.post('/api/jobs', { need: 'job:write' }, async rc => {
    const b = await rc.body();
    if (!String(b.title || '').trim()) throw badRequest('岗位名称必填');
    const out = engine.createJob(db, b, rc.ctx.userId);
    if (out.error) throw badRequest(out.msg || out.error);
    metrics.inc('job.created');
    return rc.ok(out);
  });

  r.any(['PUT', 'PATCH'], '/api/jobs/:id', { need: 'job:write' }, async rc => {
    const b = await rc.body();
    jobInScope(rc, rc.params.id);
    const out = engine.updateJob(db, rc.params.id, b, rc.ctx.userId);
    if (out.error) throw badRequest(out.msg || out.error);
    return rc.ok(out);
  });

  r.del('/api/jobs/:id', { need: 'job:write' }, rc => {
    jobInScope(rc, rc.params.id);
    const out = engine.deleteJob(db, rc.params.id, rc.ctx.userId);
    if (out.error) throw notFound('岗位不存在');
    metrics.inc('job.deleted');
    return rc.ok(out);
  });

  r.post('/api/jobs/:id/seed-candidates', { need: 'job:write' }, async rc => {
    const b = await rc.body();
    jobInScope(rc, rc.params.id);
    const n = engine.autoSeedCandidates(db, rc.params.id, num(b.count, 5));
    return rc.ok({ seeded: n, msg: `已生成 ${n} 份演示简历` });
  });

  /* ================= Agent：筛选 / JD ================= */
  r.post('/api/agent/screening/run', { need: 'screen:run' }, async rc => {
    const b = await rc.body();
    const fallback = (db.prepare(`SELECT id FROM jobs WHERE status='open' ORDER BY COALESCE(opened_at,'') DESC, id LIMIT 1`).get() || {}).id;
    const jobId = b.jobId || fallback;
    if (!jobId) throw badRequest('没有可运行的岗位');
    jobInScope(rc, jobId);
    const out = await engine.runScreening(db, { jobId, initiatorId: rc.ctx.userId });
    if (out.status === 'error' && out.error === 'job_not_found') throw notFound('岗位不存在');
    metrics.inc('agent.screening.runs');
    return rc.ok(out);
  });

  r.post('/api/agent/jd/generate', { need: 'job:write' }, async rc => {
    const b = await rc.body();
    const out = await engine.runJD(db, Object.assign({}, b, { initiatorId: rc.ctx.userId }));
    if (out.status === 'error') throw badRequest(out.msg || 'JD 生成失败');
    metrics.inc('agent.jd.runs');
    return rc.ok(out);
  });

  /* ================= 员工自助问答 ================= */
  r.post('/api/chat', {}, async rc => {
    const b = await rc.body();
    let asUserId = rc.ctx.userId, impersonated = false;
    /* HR 可「以员工视角预览」——这是真实需求（HR 想知道员工会看到什么），
       但必须有 employee:read 能力，且**每次预览都留痕**。 */
    if (b.asUserId && b.asUserId !== rc.ctx.userId) {
      if (!rbac.can(rc.ctx, 'employee:read')) {
        throw denyScope(rc, 'user', b.asUserId, '无 employee:read 能力，不能代员工提问');
      }
      asUserId = b.asUserId;
      impersonated = true;
    }
    const out = await engine.chat(db, { question: b.question, userId: asUserId });
    if (impersonated) {
      audit.record(db, {
        tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '以员工视角预览自助问答',
        objectType: 'user', objectId: asUserId, detail: `问题：${String(b.question || '').slice(0, 60)}`, result: audit.RESULT.OK,
      });
    }
    metrics.inc('agent.chat');
    return rc.ok(out);
  });

  /* ================= 审批 ================= */
  async function decide(rc, decision) {
    const id = Number(String(rc.params.id).replace(/\D/g, ''));
    const out = engine.decide(db, id, rc.ctx.userId, decision, (await rc.body()).reason);
    if (out.error === 'not_found') throw notFound('审批单不存在');
    if (out.error === 'reason_required') throw badRequest('驳回必须填写原因（这是产品规则，不是技术限制）');
    if (out.error && String(out.error).startsWith('already')) throw conflict('该审批单已被处理');
    metrics.inc(decision === 'approve' ? 'approval.approved' : 'approval.rejected');
    return rc.ok(out);
  }
  r.post('/api/approvals/:id/approve', { need: 'approval:decide' }, rc => decide(rc, 'approve'));
  r.post('/api/approvals/:id/reject', { need: 'approval:decide' }, rc => decide(rc, 'reject'));

  /* ================= 面试（已邀约 → 待面试 → 面试中 → 待复试 / 待发offer） =================
     能力分工是刻意的：安排面试要 interview:schedule（招聘侧），
     写结论要 interview:feedback（且**只有本场面试官**，行级在 hiring.js 内再判一次）。 */
  r.get('/api/interviews', { need: 'interview:read' }, rc => rc.ok({
    interviews: hiring.listInterviews(db, { ctx: rc.ctx, candidateId: rc.query.candidateId, jobId: rc.query.jobId }),
    interviewers: rbac.can(rc.ctx, 'interview:schedule') ? hiring.interviewers(db) : [],
    stages: hiring.FUNNEL,
    results: hiring.RESULT_LABEL,
  }));

  r.post('/api/interviews', { need: 'interview:schedule' }, async rc => {
    const b = await rc.body();
    const c = candidateInScope(rc, b.candidateId);
    const out = hiring.scheduleInterview(db, {
      candidateId: c.id, interviewerId: b.interviewerId, scheduledAt: b.scheduledAt,
      mode: b.mode, durationMin: b.durationMin, round: b.round, ctx: rc.ctx,
    });
    if (out.error) throw hiringError(out);
    metrics.inc('interview.scheduled');
    return rc.ok(out);
  });

  r.post('/api/interviews/:id/start', { need: 'interview:feedback' }, rc => {
    const out = hiring.startInterview(db, num(rc.params.id, 0), rc.ctx);
    if (out.error) throw hiringError(out);
    return rc.ok(out);
  });

  r.post('/api/interviews/:id/feedback', { need: 'interview:feedback' }, async rc => {
    const b = await rc.body();
    const out = hiring.submitFeedback(db, num(rc.params.id, 0), {
      result: b.result, feedback: b.feedback, score: b.score, ctx: rc.ctx,
    });
    if (out.error) throw hiringError(out);
    metrics.inc('interview.completed');
    return rc.ok(out);
  });

  r.post('/api/interviews/:id/cancel', { need: 'interview:schedule' }, async rc => {
    const b = await rc.body();
    const out = hiring.cancelInterview(db, num(rc.params.id, 0), { reason: b.reason, ctx: rc.ctx });
    if (out.error) throw hiringError(out);
    metrics.inc('interview.cancelled');
    return rc.ok(out);
  });

  /* ================= Offer：起草（招聘侧）→ 审批（HRD 独占）→ 候选人应答 ================= */
  r.get('/api/offers', { need: 'offer:read' }, rc => rc.ok({
    offers: hiring.listOffers(db, { ctx: rc.ctx, candidateId: rc.query.candidateId }),
    labels: hiring.OFFER_LABEL,
    floors: { minWage: hiring.MIN_WAGE_BJ, maxProbationMonths: hiring.MAX_PROBATION_MONTHS },
  }));

  r.post('/api/offers', { need: 'offer:create' }, async rc => {
    const b = await rc.body();
    const c = candidateInScope(rc, b.candidateId);
    const out = hiring.createOffer(db, {
      candidateId: c.id, salary: b.salary, probationMonths: b.probationMonths,
      reportDate: b.reportDate, note: b.note, ctx: rc.ctx,
    });
    if (out.error) throw hiringError(out);
    metrics.inc('offer.created');
    return rc.ok(out);
  });

  r.post('/api/offers/:id/decide', { need: 'offer:decide' }, async rc => {
    const b = await rc.body();
    const out = hiring.decideOffer(db, num(rc.params.id, 0), { decision: b.decision, note: b.note, ctx: rc.ctx });
    if (out.error) throw hiringError(out);
    metrics.inc(b.decision === 'approve' ? 'offer.approved' : 'offer.rejected');
    return rc.ok(out);
  });

  r.post('/api/offers/:id/respond', { need: 'offer:create' }, async rc => {
    const b = await rc.body();
    const out = hiring.respondOffer(db, num(rc.params.id, 0), { accepted: b.accepted !== false, reason: b.reason, ctx: rc.ctx });
    if (out.error) throw hiringError(out);
    return rc.ok(out);
  });

  /* ================= 人工推翻 / 确认 AI 结论 =================
     为什么把「确认」也做成一条真实写入（原先只是一个 toast）：
     只记录推翻，就永远算不出「人工与 AI 的一致率」——
     样本里全是分歧，一致率恒为 0。确认 AI 结论同样是一次人工判断，
     把它落库，一致率才有分母。这不是多加一个按钮，是让指标成立的前提。

     原因码（override_code）只对推翻必填：确认 = 无异议，不需要归因。
     取值域见 shared/override-codes.js —— 前后端同一份枚举。 */
  r.post('/api/candidates/:id/override', { need: 'screen:run' }, async rc => {
    const b = await rc.body();
    const decision = String(b.decision || '').trim();
    if (!OverrideCodes.isValidDecision(decision)) {
      throw badRequest('decision 必须是 confirmed / approved_by_human / rejected_by_human 之一');
    }
    const confirmed = decision === 'confirmed';
    if (!confirmed) {
      if (!b.reason || !String(b.reason).trim()) throw badRequest('推翻必须填写原因，会进入优化数据集');
      if (!b.overrideCode || !OverrideCodes.isValidCode(b.overrideCode)) {
        throw badRequest('推翻必须选择原因码（枚举见 /api/bootstrap 的 overrideCodes），当前为：' + (b.overrideCode || '空'));
      }
    }
    const c = db.prepare(`SELECT * FROM candidates WHERE id=?`).get(rc.params.id);
    if (!c) throw notFound('候选人不存在');
    const job = db.prepare(`SELECT dept_path FROM jobs WHERE id=?`).get(c.job_id);
    if (!rbac.inScope(rc.ctx, { deptPath: job && job.dept_path })) {
      throw denyScope(rc, 'candidate', rc.params.id, '候选人所属岗位超出本角色数据范围');
    }

    /* 方向自洽校验：推翻必须与 AI 建议**反向**。
       AI 判 strong/ok（建议推进）时，「人工推进」不是推翻而是重复；
       这种请求更像前端传错参数，直接拒掉，避免污染一致率样本。 */
    if (!confirmed) {
      const wantReject = OverrideCodes.aiAdvisesAdvance(c.ai_grade);
      if (wantReject && decision === 'approved_by_human') {
        throw badRequest('AI 已判为该推进，' + decision + ' 不构成推翻（AI 档位=' + (c.ai_grade || '未评分') + '）');
      }
      if (!wantReject && decision === 'rejected_by_human') {
        throw badRequest('AI 已判为不适合，' + decision + ' 不构成推翻（AI 档位=' + (c.ai_grade || '未评分') + '）');
      }
    }

    db.prepare(`UPDATE candidates SET human_decision=?, override_reason=?, override_code=?, human_decided_at=? WHERE id=?`)
      .run(decision, confirmed ? null : String(b.reason).trim(), confirmed ? null : b.overrideCode, audit.nowCN(), rc.params.id);

    const codeLabel = confirmed ? '人工确认 AI 结论' : ('原因码 ' + b.overrideCode + '（' + OverrideCodes.labelOfCode(b.overrideCode) + '）');
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId,
      action: confirmed ? '人工确认 AI 筛选结论' : '人工推翻 AI 筛选结论',
      objectType: 'candidate', objectId: rc.params.id,
      detail: (confirmed ? '' : '原因：' + b.reason + ' · ') + codeLabel + '（样本已计入一致率）',
      result: audit.RESULT.OK,
    });
    metrics.inc(confirmed ? 'screening.confirms' : 'screening.overrides');
    return rc.ok({ decision, overrideCode: confirmed ? null : b.overrideCode });
  });

  /* 重置某岗位的 AI 评分，便于重复演示。
     为什么必须有这个接口：筛选只处理 `ai_score IS NULL` 的候选人
     （见 engine.runScreening 的取数条件），所以同一岗位第二次运行会「无事发生」。
     没有它，演示到第二轮就走不下去了。
     范围：只清评分与人工结论，**不动阶段** —— 重置的是「机器判断」，
     不是把人从流程里退回去。 */
  r.post('/api/jobs/:id/reset-scores', { need: 'screen:run' }, rc => {
    const job = db.prepare(`SELECT id,title,dept_path FROM jobs WHERE id=?`).get(rc.params.id);
    if (!job) throw notFound('岗位不存在');
    if (!rbac.inScope(rc.ctx, { deptPath: job.dept_path })) {
      throw denyScope(rc, 'job', rc.params.id, '岗位超出本角色数据范围');
    }
    const before = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=? AND ai_score IS NOT NULL`).get(job.id).c;
    db.prepare(`UPDATE candidates SET ai_score=NULL, ai_grade=NULL, ai_reasons=NULL, ai_note=NULL,
      human_decision=NULL, override_reason=NULL, override_code=NULL, human_decided_at=NULL
      WHERE job_id=? AND ai_score IS NOT NULL`).run(job.id);
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '重置岗位 AI 评分',
      objectType: 'job', objectId: job.id,
      detail: `${job.title}：清空 ${before} 份评分（阶段不变，可重新运行筛选）`, result: audit.RESULT.OK,
    });
    metrics.inc('screening.resets');
    return rc.ok({ reset: before });
  });

  /* ================= 候选人详情（受审计的 PII 读取路径） =================
     为什么单独开这个接口，而不是让 bootstrap 直接返回未脱敏数据：
     读 PII 必须留痕。若放在 bootstrap，则每进一次首页就写一条审计
     （既无意义、又会因 fsync 拖慢），所以把「看原文」做成一个**显式动作**：
     点开详情 = 一次有明确意图的访问 = 值得留痕。 */
  r.get('/api/candidates/:id/detail', { need: 'candidate:read' }, rc => {
    const c = db.prepare(`SELECT * FROM candidates WHERE id=?`).get(rc.params.id);
    if (!c) throw notFound('候选人不存在');
    const job = db.prepare(`SELECT id,title,dept_path FROM jobs WHERE id=?`).get(c.job_id);
    if (!rbac.inScope(rc.ctx, { deptPath: job && job.dept_path })) {
      throw denyScope(rc, 'candidate', rc.params.id, '候选人所属岗位超出本角色数据范围');
    }
    const masked = rbac.shouldMask(rc.ctx);
    if (masked) {
      audit.denied(db, {
        tenantId: TENANT, actorId: rc.ctx.userId, action: '请求候选人敏感字段未获授权',
        objectType: 'candidate', objectId: c.id,
        reason: `角色 ${rc.ctx.role} 无 pii:read，已返回脱敏结果`, requestId: rc.requestId,
      });
    } else {
      audit.record(db, {
        tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '查看候选人简历原文',
        objectType: 'candidate', objectId: c.id,
        detail: `岗位 ${c.job_id} · 含未脱敏联系方式与受保护字段`, result: audit.RESULT.OK,
      });
    }
    return rc.ok({
      candidate: {
        id: c.id, jobId: c.job_id, job: job ? job.title : '', name: c.name,
        gender: masked ? '已脱敏' : c.gender,
        birth: masked ? '已脱敏' : c.birth_date,
        years: c.years_exp, edu: c.edu_text, company: c.company,
        skills: J(c.skills), businessTags: J(c.business_tags), plusTags: J(c.plus_tags),
        score: c.ai_score, grade: c.ai_grade, reasons: J(c.ai_reasons), aiNote: c.ai_note,
        human: c.human_decision, overrideReason: c.override_reason,
        overrideCode: c.override_code, humanDecidedAt: c.human_decided_at,
        consent: gov.validConsent(db, { tenantId: TENANT, candidateId: c.id }),
        retainUntil: c.retain_until, anonymizedAt: c.anonymized_at, masked,
      },
    });
  });

  /* ================= 审计 ================= */
  r.get('/api/audit', { need: 'audit:read' }, rc => rc.ok({
    logs: audit.tail(db, Math.min(num(rc.query.limit, 50), 500)),
    stats: audit.stats(db),
    appendOnly: true,
    note: 'audit_logs 由数据库触发器保证 append-only：UPDATE / DELETE 会被物理拒绝',
  }));

  /* ================= 数据治理（M8） ================= */
  r.get('/api/governance/summary', { need: 'governance:read' }, rc => rc.ok({ summary: gov.summary(db, TENANT) }));

  r.get('/api/governance/policies', { need: 'governance:read' }, rc => rc.ok({ policies: gov.listPolicies(db, TENANT) }));

  r.put('/api/governance/policies', { need: 'governance:write' }, async rc => {
    const b = await rc.body();
    const policies = gov.upsertPolicy(db, TENANT, b);
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '调整留存策略',
      objectType: 'retention_policy', objectId: b.dataClass, detail: `留存 ${b.retainDays} 天`, result: audit.RESULT.OK,
    });
    return rc.ok({ policies });
  });

  r.post('/api/governance/sweep', { need: 'governance:write' }, async rc => {
    const b = await rc.body();
    const out = gov.sweepExpired(db, TENANT, { dryRun: b.dryRun === true || b.dryRun === 'true' });
    return rc.ok(Object.assign(out, { msg: out.anonymized ? `已匿名化 ${out.anonymized} 条到期记录` : `到期 ${out.due} 条（未执行）` }));
  });

  r.get('/api/governance/consents', { need: 'governance:read' }, rc =>
    rc.ok({ consents: gov.listConsents(db, { tenantId: TENANT, candidateId: rc.query.candidateId }) }));

  r.post('/api/governance/consents', { need: 'governance:write' }, async rc => {
    const b = await rc.body();
    const out = gov.grantConsent(db, { tenantId: TENANT, ...b });
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '登记候选人授权',
      objectType: 'candidate', objectId: b.candidateId, detail: `用途：${b.purpose} · 有效期至 ${out.expiresAt}`, result: audit.RESULT.OK,
    });
    return rc.ok({ consent: out });
  });

  r.post('/api/governance/consents/revoke', { need: 'governance:write' }, async rc => {
    const b = await rc.body();
    const out = gov.revokeConsent(db, { tenantId: TENANT, candidateId: b.candidateId, purpose: b.purpose });
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '撤回候选人授权',
      objectType: 'candidate', objectId: b.candidateId, detail: `撤回 ${out.revoked} 条授权`, result: audit.RESULT.OK,
    });
    return rc.ok(out);
  });

  r.get('/api/governance/subject/:id/export', { need: 'governance:read' }, rc => {
    const subjectData = gov.exportSubjectData(db, { tenantId: TENANT, candidateId: rc.params.id });
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '导出数据主体数据（查阅权）',
      objectType: 'candidate', objectId: rc.params.id, result: audit.RESULT.OK,
    });
    return rc.ok({ subjectData });
  });

  r.get('/api/governance/erasure', { need: 'governance:read' }, rc => rc.ok({ requests: gov.listErasureRequests(db, TENANT) }));

  r.post('/api/governance/erasure', { need: 'governance:write' }, async rc => {
    const b = await rc.body();
    const out = gov.eraseCandidate(db, rc.ctx, {
      candidateId: b.candidateId, reason: b.reason, mode: b.mode === 'hard' ? 'hard' : 'anonymize',
    });
    metrics.inc('governance.erasure');
    return rc.ok(out);
  });

  /* ================= 越权演示 =================
     同一路由在 HRD/管理员身份下 200，在员工身份下 403 ——
     这就是「功能级权限」最直观的证据。 */
  r.post('/api/employees/export', { need: 'employee:export' }, rc => {
    const n = db.prepare(`SELECT COUNT(*) c FROM users`).get().c;
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '导出全公司员工数据',
      objectType: 'api', objectId: '/api/employees/export', detail: `角色 ${rc.ctx.role} → 允许 · 共 ${n} 行`, result: audit.RESULT.OK,
    });
    return rc.ok({ rows: n });
  });

  /* ================= 账号与会话管理 ================= */
  r.get('/api/users', { need: 'admin:user' }, rc => rc.ok({
    users: db.prepare(`SELECT id,name,role,dept_path,title,is_active,last_login_at,failed_logins,must_change_password
      FROM users WHERE tenant_id=? ORDER BY id`).all(TENANT).map(u => ({
      id: u.id, name: u.name, role: u.role, roleLabel: rbac.ROLE_LABEL[u.role] || u.role,
      dept: u.dept_path, title: u.title, active: !!u.is_active,
      lastLoginAt: u.last_login_at, failedLogins: u.failed_logins || 0,
      mustChangePassword: !!u.must_change_password,
    })),
    sessions: db.prepare(`SELECT s.sid,s.user_id,u.name,s.issued_at,s.last_seen_at,s.client_ip
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.issued_at DESC LIMIT 50`).all(audit.nowCN()),
  }));

  r.post('/api/users/:id/revoke-sessions', { need: 'admin:user' }, rc => {
    const target = db.prepare(`SELECT id FROM users WHERE id=?`).get(rc.params.id);
    if (!target) throw notFound('用户不存在');
    const n = auth.revokeAllForUser(db, rc.params.id, `管理员 ${rc.ctx.userId} 强制下线`);
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '强制用户下线',
      objectType: 'user', objectId: rc.params.id, detail: `吊销会话 ${n} 个`, result: audit.RESULT.OK,
    });
    return rc.ok({ revoked: n });
  });

  r.post('/api/users/:id/activate', { need: 'admin:user' }, async rc => {
    const b = await rc.body();
    const active = b.active === false ? 0 : 1;
    const res = db.prepare(`UPDATE users SET is_active=? WHERE id=?`).run(active, rc.params.id);
    if (!res.changes) throw notFound('用户不存在');
    if (!active) auth.revokeAllForUser(db, rc.params.id, '账号被停用');
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: active ? '启用账号' : '停用账号',
      objectType: 'user', objectId: rc.params.id, result: audit.RESULT.OK,
    });
    return rc.ok({ active: !!active });
  });

  /* ================= 演示维护 ================= */
  r.post('/api/reset', { need: 'admin:policy' }, rc => {
    dbmod.reseedRuntime(db);
    auth.ensureSeedCredentials(db);
    gov.ensureDefaultPolicies(db, TENANT);
    gov.backfillRetention(db, TENANT);
    audit.record(db, {
      tenantId: TENANT, actorType: 'user', actorId: rc.ctx.userId, action: '重置演示数据',
      objectType: 'system', objectId: 'reset', detail: '清空运行期表并回到种子状态（账号与会话保留）', result: audit.RESULT.OK,
    });
    return rc.ok({ msg: '已回到初始种子状态：候选人恢复为待评分、审批与运行记录清空；账号与会话保留' });
  });

  return r;
}

module.exports = { buildRouter, scopeSnapshot, TENANT };
