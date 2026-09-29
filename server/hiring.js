/* ===========================================================
   L2 · 招聘后链路（hiring）：面试 → Offer → 入职前置
   职责：把候选人从「已邀约」推进到「已入职」的全部状态流转收敛到一个地方。

   为什么必须独立成模块（而不是塞进 engine.js）：
   ① 状态机只能有一份。阶段流转如果散在路由、前端、引擎三处，
      必然出现「表里说没面试、候选人却已入职」这类自相矛盾的数据。
   ② 权限语义与筛选完全不同：筛选是「Agent 判断 + 人审批」，
      面试是「人判断（面试官写纪要）+ 系统只做整理」，
      Offer 是「人起草 + 更高一层人批准」。两套语义混在一个文件里会互相污染。
   ③ 面试官的行级范围是「只看属于自己的面试」，这条规则必须与阶段流转写在同一个作用域里，
      否则「能改阶段但不能改面试」这种缝会被绕过。

   三条不可退让的规则（写进代码，不只是文档）：
   - **面试结果只能由该场面试的面试官本人填写**：Agent 不产出录用建议，HR 也不能代填。
   - **Offer 的发出只有 HRD 能批**（offer:decide）；招聘专员只能起草（offer:create）。
   - **合规校验是代码，不是模型**：最低工资、试用期上限这类硬红线在校验失败时直接阻断，
     不交给模型「判断」——模型可以被说服，`if` 不行。
   =========================================================== */
'use strict';
const audit = require('./audit.js');
const rbac = require('./rbac.js');

const T = 'T-001';
const now = () => audit.nowCN();

/* ===========================================================
   一、阶段单一事实来源
   =========================================================== */
const STAGES = {
  REVIEW: '待人工复核',     // 筛选中 / 等 HR 人工确认
  INVITED: '已邀约',        // HR 批准写回后，等邀约
  SCHEDULED: '待面试',      // 已排期，等面试官
  ONGOING: '面试中',        // 面试官已开工
  SECOND: '待复试',         // 通过但需加面（或待定）
  OFFER: '待发offer',       // 面试通过，等起草/审批 Offer
  OFFER_SENT: '已发offer',
  HIRED: '已入职',
  REJECTED: '已淘汰',
};

/** 漏斗顺序（用于前端展示与统计；已淘汰单独统计，不算漏斗节点） */
const FUNNEL = [STAGES.REVIEW, STAGES.INVITED, STAGES.SCHEDULED, STAGES.ONGOING, STAGES.SECOND, STAGES.OFFER, STAGES.OFFER_SENT, STAGES.HIRED];

/** 面试结论枚举 */
const ROUND_RESULT = { PASS: 'pass', HOLD: 'hold', FAIL: 'fail' };
const RESULT_LABEL = { pass: '通过', hold: '待定（需加面）', fail: '未通过' };
/** 通过后还要不要加面：第 1 轮通过 → 复试；第 2 轮及以后通过 → 直接进 Offer */
const FINAL_ROUND = 2;

/* ===========================================================
   二、小工具
   =========================================================== */
/** 允许安排面试的阶段：已邀约 / 待复试，以及「待面试」本身（改约 = 再排一场） */
const SCHEDULABLE = new Set([STAGES.INVITED, STAGES.SECOND, STAGES.SCHEDULED]);

/** 校验并规范化时间（只接受 YYYY-MM-DD HH:MM，避免 `new Date` 把各种模糊写法静默解释成别的时间） */
function normTime(v) {
  const s = String(v == null ? '' : v).trim().replace('T', ' ');
  const m = /^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/**
 * 从岗位薪资描述解析带宽。
 * 岗位库里是 `25-40K·14薪` 这种人类写法，解析失败就返回 null —— 宁可不校验，
 * 也不要用一个猜出来的数字去卡人（错误的正则比没有正则更危险）。
 */
function salaryBand(jobSalary) {
  const m = /(\d+(?:\.\d+)?)\s*[-~到]\s*(\d+(?:\.\d+)?)\s*K/i.exec(String(jobSalary || ''));
  if (!m) return null;
  return { low: Math.round(+m[1] * 1000), high: Math.round(+m[2] * 1000) };
}

/* ---------- 合规红线：代码校验，模型不参与 ---------- */
const MIN_WAGE_BJ = 2420;      // 北京市最低工资标准（月）
const MAX_PROBATION_MONTHS = 6; // 劳动合同法第十九条：试用期最长不得超过六个月

/**
 * Offer 合规校验。返回 { block: string[], warn: string[], pass: string[] }。
 * block 非空时**拒绝创建**（不是「提示一下让人自己决定」）。
 */
function checkOffer({ salary, probationMonths, jobSalary, candidate }) {
  const block = [], warn = [], pass = [];
  const s = Number(salary);

  if (!Number.isFinite(s) || s <= 0) block.push('月薪必须为正数（当前值无法解析）');
  else if (s < MIN_WAGE_BJ) block.push(`月薪 ${s} 元低于北京市最低工资标准 ${MIN_WAGE_BJ} 元/月 —— 违法，已阻断`);
  else pass.push(`✓ 月薪 ${s.toLocaleString('zh-CN')} 元不低于当地最低工资标准（${MIN_WAGE_BJ} 元/月）`);

  const pm = Number(probationMonths);
  if (Number.isFinite(pm) && pm > MAX_PROBATION_MONTHS) block.push(`试用期 ${pm} 个月超过法定上限 ${MAX_PROBATION_MONTHS} 个月 —— 违法，已阻断`);
  else if (Number.isFinite(pm)) pass.push(`✓ 试用期 ${pm} 个月，未超过法定上限`);

  const band = salaryBand(jobSalary);
  if (band && Number.isFinite(s)) {
    if (s < band.low || s > band.high) warn.push(`⚠️ 月薪 ${s.toLocaleString('zh-CN')} 元超出岗位带宽 ${band.low.toLocaleString('zh-CN')}-${band.high.toLocaleString('zh-CN')} 元，需书面说明理由`);
    else pass.push(`✓ 月薪处于岗位带宽 ${band.low.toLocaleString('zh-CN')}-${band.high.toLocaleString('zh-CN')} 元之内`);
  } else {
    warn.push('⚠️ 岗位未写薪资带宽或格式无法解析，带宽校验已跳过（不伪造结论）');
  }

  pass.push('✓ 未包含竞业限制等需单独协商的条款（本模板不含该条款）');
  return { block, warn, pass };
}

/* ===========================================================
   三、面试
   =========================================================== */
const ITV_SQL = `SELECT i.*, c.name AS candidate_name, c.stage AS candidate_stage, c.company AS candidate_company,
                          j.title AS job_title, j.dept_path AS job_dept, j.salary AS job_salary,
                          u.name AS interviewer_name, u.title AS interviewer_title
                   FROM interviews i
                   LEFT JOIN candidates c ON c.id = i.candidate_id
                   LEFT JOIN jobs       j ON j.id = i.job_id
                   LEFT JOIN users      u ON u.id = i.interviewer_id`;

function decor(r) {
  return {
    id: r.id, candidateId: r.candidate_id, candidate: r.candidate_name, candidateStage: r.candidate_stage,
    jobId: r.job_id, job: r.job_title, dept: r.job_dept,
    round: r.round, mode: r.mode, at: r.scheduled_at, durationMin: r.duration_min,
    interviewerId: r.interviewer_id, interviewer: r.interviewer_name, interviewerTitle: r.interviewer_title,
    status: r.status, result: r.result, resultLabel: r.result ? (RESULT_LABEL[r.result] || r.result) : '',
    feedback: r.feedback || '', score: r.score,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** 面试官名录（安排面试时的下拉用；只给有安排权的人看，见 routes） */
function interviewers(db) {
  return db.prepare(`SELECT id,name,title,dept_path FROM users
    WHERE role='interviewer' AND is_active=1 ORDER BY id`).all()
    .map(u => ({ id: u.id, name: u.name, title: u.title, dept: u.dept_path }));
}

/**
 * 面试列表。行级规则：
 * - 面试官：**只看属于自己的面试**（这是本模块最硬的一条行级规则；
 *   若只在路由层过滤，任何新增的读接口都会漏）。
 * - 其他角色：按岗位部门是否在其数据范围内过滤。
 */
function listInterviews(db, { ctx, candidateId, jobId, limit = 100 } = {}) {
  let rows = db.prepare(ITV_SQL + ` ORDER BY COALESCE(i.scheduled_at,'') DESC, i.id DESC LIMIT ?`).all(Math.min(Number(limit) || 100, 300));
  if (ctx && ctx.role === 'interviewer') rows = rows.filter(r => r.interviewer_id === ctx.userId);
  else if (ctx) rows = rows.filter(r => rbac.inScope(ctx, { deptPath: r.job_dept }));
  if (candidateId) rows = rows.filter(r => r.candidate_id === candidateId);
  if (jobId) rows = rows.filter(r => r.job_id === jobId);
  return rows.map(decor);
}

/** 该候选人下一轮次 = 已完成的面试场次 + 1。
 *  为什么数「已完成」而不是「最大轮次 + 1」：被取消的面试不该占用轮次号，
 *  否则「取消一次 → 重排」会把第 1 轮变成第 2 轮，于是「第 1 轮通过只进复试」
 *  这条规则会被跳过，人还没复面就直接进了 Offer。 */
function nextRound(db, candidateId) {
  const r = db.prepare(`SELECT COUNT(*) c FROM interviews WHERE candidate_id=? AND status='completed'`).get(candidateId);
  return Number(r.c || 0) + 1;
}

/**
 * 安排面试 → 候选人进入「待面试」。
 * 一个人同时只能有**一场**未完成的面试：这是硬约束，不是「同一轮不能重复」。
 * 理由：两场同时挂着，「这一轮到底算不算过了」就说不清，阶段流转会失真。
 * 需要改约就先取消，取消会把阶段退回，不会留下悬挂状态。
 */
function scheduleInterview(db, { candidateId, interviewerId, scheduledAt, mode, durationMin, round, ctx }) {
  const c = db.prepare(`SELECT * FROM candidates WHERE id=?`).get(candidateId);
  if (!c) return { error: 'candidate_not_found' };
  if (!SCHEDULABLE.has(c.stage)) return { error: 'stage_not_schedulable', stage: c.stage };

  const openNow = db.prepare(`SELECT id,round FROM interviews WHERE candidate_id=? AND status IN ('scheduled','in_progress') ORDER BY round DESC LIMIT 1`).get(candidateId);
  if (openNow) return { error: 'round_already_open', existingId: openNow.id, round: openNow.round };

  const iv = db.prepare(`SELECT id,name,title FROM users WHERE id=? AND role='interviewer' AND is_active=1`).get(interviewerId);
  if (!iv) return { error: 'interviewer_not_found' };

  const at = normTime(scheduledAt);
  if (!at) return { error: 'bad_time', hint: '时间格式须为 YYYY-MM-DD HH:MM' };

  const rd = Number.isFinite(Number(round)) && Number(round) > 0 ? Number(round) : nextRound(db, candidateId);

  const modeV = mode === '现场' ? '现场' : '线上';
  const dur = Number.isFinite(Number(durationMin)) ? Math.min(Math.max(Number(durationMin), 15), 480) : 60;
  const ts = now();
  const res = db.prepare(`INSERT INTO interviews
    (tenant_id,candidate_id,job_id,round,mode,scheduled_at,duration_min,interviewer_id,status,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'scheduled',?,?,?)`)
    .run(T, candidateId, c.job_id, rd, modeV, at, dur, iv.id, ctx.userId, ts, ts);

  db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(STAGES.SCHEDULED, candidateId);

  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId, action: '安排面试（第 ' + rd + ' 轮）',
    objectType: 'candidate', objectId: candidateId,
    detail: `${c.name} · ${iv.name}（${iv.title || '面试官'}）· ${at} · ${modeV} ${dur} 分钟 · 阶段 ${c.stage} → ${STAGES.SCHEDULED}`,
    result: audit.RESULT.OK,
  });
  return { ok: true, id: res.lastInsertRowid, round: rd, at, interviewer: iv.name, stage: STAGES.SCHEDULED };
}

/** 面试官开始面试 → 「面试中」 */
function startInterview(db, id, ctx) {
  const itv = db.prepare(`SELECT * FROM interviews WHERE id=?`).get(id);
  if (!itv) return { error: 'not_found' };
  if (itv.interviewer_id !== ctx.userId) return { error: 'not_your_interview' };
  if (itv.status !== 'scheduled') return { error: 'bad_status', status: itv.status };

  db.prepare(`UPDATE interviews SET status='in_progress', updated_at=? WHERE id=?`).run(now(), id);
  const c = db.prepare(`SELECT stage FROM candidates WHERE id=?`).get(itv.candidate_id);
  if (c && c.stage === STAGES.SCHEDULED) {
    db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(STAGES.ONGOING, itv.candidate_id);
  }
  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId, action: '开始面试（第 ' + itv.round + ' 轮）',
    objectType: 'candidate', objectId: itv.candidate_id,
    detail: `面试记录 #${id} · 阶段 ${(c && c.stage) || '?'} → ${STAGES.ONGOING}`, result: audit.RESULT.OK,
  });
  return { ok: true, stage: STAGES.ONGOING };
}

/**
 * 提交面试反馈 → 驱动阶段流转。**只有该场面试官本人能写。**
 *
 * 流转规则（集中在这里，前端/路由不得各写一份）：
 *   未通过      → 已淘汰
 *   待定        → 待复试（需加面）
 *   通过 · 非终轮 → 待复试（需加面）
 *   通过 · 终轮   → 待发offer
 */
function submitFeedback(db, id, { result, feedback, score, ctx }) {
  const itv = db.prepare(`SELECT * FROM interviews WHERE id=?`).get(id);
  if (!itv) return { error: 'not_found' };
  if (itv.interviewer_id !== ctx.userId) return { error: 'not_your_interview' };
  if (!['scheduled', 'in_progress'].includes(itv.status)) return { error: 'bad_status', status: itv.status };
  if (!Object.values(ROUND_RESULT).includes(result)) return { error: 'bad_result' };
  const note = String(feedback || '').trim();
  if (note.length < 5) return { error: 'feedback_required', hint: '面试纪要至少 5 个字：结论必须可追溯' };

  const c = db.prepare(`SELECT * FROM candidates WHERE id=?`).get(itv.candidate_id);
  const next = result === ROUND_RESULT.FAIL ? STAGES.REJECTED
    : result === ROUND_RESULT.HOLD ? STAGES.SECOND
      : (itv.round >= FINAL_ROUND ? STAGES.OFFER : STAGES.SECOND);

  const ts = now();
  const sc = Number(score);
  db.prepare(`UPDATE interviews SET status='completed', result=?, feedback=?, score=?, updated_at=? WHERE id=?`)
    .run(result, note, Number.isFinite(sc) ? sc : null, ts, id);
  db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(next, itv.candidate_id);

  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId,
    action: `提交面试结论（第 ${itv.round} 轮 · ${RESULT_LABEL[result] || result}）`,
    objectType: 'candidate', objectId: itv.candidate_id,
    detail: `${(c && c.name) || itv.candidate_id} · 阶段 ${(c && c.stage) || '?'} → ${next} · 纪要：${note.slice(0, 80)}`,
    result: audit.RESULT.OK,
  });
  return { ok: true, result, resultLabel: RESULT_LABEL[result], stage: next, round: itv.round, finalRound: itv.round >= FINAL_ROUND };
}

/** 取消 / 改约：候选人退回「已邀约」，不留下「永远排不上」的悬挂状态 */
function cancelInterview(db, id, { reason, ctx }) {
  const itv = db.prepare(`SELECT * FROM interviews WHERE id=?`).get(id);
  if (!itv) return { error: 'not_found' };
  if (!['scheduled', 'in_progress'].includes(itv.status)) return { error: 'bad_status', status: itv.status };
  if (ctx.role === 'interviewer' && itv.interviewer_id !== ctx.userId) return { error: 'not_your_interview' };

  const c = db.prepare(`SELECT stage FROM candidates WHERE id=?`).get(itv.candidate_id);
  db.prepare(`UPDATE interviews SET status='cancelled', feedback=?, updated_at=? WHERE id=?`)
    .run('已取消：' + (reason || '未填写原因'), now(), id);

  let back = null;
  if (c && [STAGES.SCHEDULED, STAGES.ONGOING].includes(c.stage)) {
    back = itv.round > 1 ? STAGES.SECOND : STAGES.INVITED;
    db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(back, itv.candidate_id);
  }
  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId, action: '取消面试（第 ' + itv.round + ' 轮）',
    objectType: 'candidate', objectId: itv.candidate_id,
    detail: `面试记录 #${id} 已取消 · 原因：${reason || '未填写'}${back ? ' · 阶段退回 ' + back : ''}`,
    result: audit.RESULT.OK,
  });
  return { ok: true, stage: back };
}

/* ===========================================================
   四、Offer
   =========================================================== */
const OFFER_SQL = `SELECT o.*, c.name AS candidate_name, c.stage AS candidate_stage,
                          j.title AS job_title, j.dept_path AS job_dept, j.salary AS job_salary,
                          ub.name AS created_by_name, ud.name AS decided_by_name
                   FROM offers o
                   LEFT JOIN candidates c ON c.id = o.candidate_id
                   LEFT JOIN jobs       j ON j.id = o.job_id
                   LEFT JOIN users      ub ON ub.id = o.created_by
                   LEFT JOIN users      ud ON ud.id = o.decided_by`;

const OFFER_LABEL = {
  pending_approval: '待审批', sent: '已发出', rejected: '已驳回', accepted: '已接受', declined: '已拒绝',
};

const decorOffer = (r, checks) => ({
  id: 'OF-' + r.id, rawId: r.id, candidateId: r.candidate_id, candidate: r.candidate_name, candidateStage: r.candidate_stage,
  jobId: r.job_id, job: r.job_title, dept: r.job_dept,
  salary: r.salary, probationMonths: r.probation_months, reportDate: r.report_date,
  status: r.status, statusLabel: OFFER_LABEL[r.status] || r.status,
  note: r.note || '', createdBy: r.created_by_name, createdAt: r.created_at,
  decidedBy: r.decided_by_name, decidedAt: r.decided_at, decidedNote: r.decided_note || '',
  checks: checks || [],
});

function listOffers(db, { ctx, candidateId, limit = 100 } = {}) {
  let rows = db.prepare(OFFER_SQL + ` ORDER BY o.id DESC LIMIT ?`).all(Math.min(Number(limit) || 100, 300));
  if (ctx) rows = rows.filter(r => rbac.inScope(ctx, { deptPath: r.job_dept }));
  if (candidateId) rows = rows.filter(r => r.candidate_id === candidateId);
  return rows.map(r => decorOffer(r, []));
}

/**
 * 起草 Offer。**会跑代码级合规校验，block 非空直接拒绝**。
 * 不做「起草即发送」：发出是高风险动作，必须过 offer:decide 闸门（见 decideOffer）。
 */
function createOffer(db, { candidateId, salary, probationMonths, reportDate, note, ctx }) {
  const c = db.prepare(`SELECT * FROM candidates WHERE id=?`).get(candidateId);
  if (!c) return { error: 'candidate_not_found' };
  if (c.stage !== STAGES.OFFER) return { error: 'stage_not_offerable', stage: c.stage };

  const open = db.prepare(`SELECT id,status FROM offers WHERE candidate_id=? AND status IN ('pending_approval','sent')`).get(candidateId);
  if (open) return { error: 'offer_already_open', existingId: 'OF-' + open.id, status: open.status };

  const job = db.prepare(`SELECT title,dept_path,salary FROM jobs WHERE id=?`).get(c.job_id);
  const pm = Number.isFinite(Number(probationMonths)) ? Number(probationMonths) : 3;
  const checks = checkOffer({ salary, probationMonths: pm, jobSalary: job && job.salary, candidate: c });
  if (checks.block.length) return { error: 'compliance_blocked', checks };

  const ts = now();
  const res = db.prepare(`INSERT INTO offers
    (tenant_id,candidate_id,job_id,salary,probation_months,report_date,status,note,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'pending_approval',?,?,?,?)`)
    .run(T, candidateId, c.job_id, Math.round(Number(salary)), pm, reportDate || null,
      note || '', ctx.userId, ts, ts);

  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId, action: '起草 Offer（送审）',
    objectType: 'offer', objectId: 'OF-' + res.lastInsertRowid,
    detail: `${c.name} · ${job ? job.title : c.job_id} · 月薪 ${Math.round(Number(salary))} 元 · 试用期 ${pm} 个月 · 待 HRD 审批`,
    result: audit.RESULT.OK,
  });
  return { ok: true, id: 'OF-' + res.lastInsertRowid, rawId: res.lastInsertRowid, checks, stage: c.stage };
}

/**
 * 审批 Offer（offer:decide，HRD 独占）。
 * 批准 → 发出（阶段 已发offer）；驳回 → 退回招聘侧修改，候选人**留在**待发offer。
 */
function decideOffer(db, id, { decision, note, ctx }) {
  const o = db.prepare(`SELECT * FROM offers WHERE id=?`).get(id);
  if (!o) return { error: 'not_found' };
  if (o.status !== 'pending_approval') return { error: 'bad_status', status: o.status };

  const c = db.prepare(`SELECT name,stage FROM candidates WHERE id=?`).get(o.candidate_id);
  const ts = now();
  if (decision === 'approve') {
    db.prepare(`UPDATE offers SET status='sent', decided_by=?, decided_at=?, decided_note=?, updated_at=? WHERE id=?`)
      .run(ctx.userId, ts, note || '', ts, id);
    db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(STAGES.OFFER_SENT, o.candidate_id);
    audit.record(db, {
      tenantId: T, actorType: 'user', actorId: ctx.userId, action: '批准并发出 Offer',
      objectType: 'offer', objectId: 'OF-' + id,
      detail: `${(c && c.name) || o.candidate_id} · 阶段 ${(c && c.stage) || '?'} → ${STAGES.OFFER_SENT}`,
      result: audit.RESULT.OK,
    });
    return { ok: true, status: 'sent', stage: STAGES.OFFER_SENT };
  }

  if (!String(note || '').trim()) return { error: 'reason_required' };
  db.prepare(`UPDATE offers SET status='rejected', decided_by=?, decided_at=?, decided_note=?, updated_at=? WHERE id=?`)
    .run(ctx.userId, ts, note, ts, id);
  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId, action: '驳回 Offer 申请',
    objectType: 'offer', objectId: 'OF-' + id,
    detail: `${(c && c.name) || o.candidate_id} · 原因：${note} · 候选人留在「${STAGES.OFFER}」可重新起草`,
    result: audit.RESULT.OK,
  });
  return { ok: true, status: 'rejected', stage: c && c.stage };
}

/** 候选人应答（接受 / 拒绝）。接受即进入入职前置，触发入转调离 Agent。 */
function respondOffer(db, id, { accepted, reason, ctx }) {
  const o = db.prepare(`SELECT * FROM offers WHERE id=?`).get(id);
  if (!o) return { error: 'not_found' };
  if (o.status !== 'sent') return { error: 'bad_status', status: o.status };
  const c = db.prepare(`SELECT name,stage FROM candidates WHERE id=?`).get(o.candidate_id);
  const ts = now();

  if (accepted) {
    db.prepare(`UPDATE offers SET status='accepted', updated_at=? WHERE id=?`).run(ts, id);
    db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(STAGES.HIRED, o.candidate_id);
    audit.record(db, {
      tenantId: T, actorType: 'user', actorId: ctx.userId, action: '登记 Offer 已接受',
      objectType: 'offer', objectId: 'OF-' + id,
      detail: `${(c && c.name) || o.candidate_id} · 阶段 → ${STAGES.HIRED} · 已触发入转调离 Agent 的入职前置流程`,
      result: audit.RESULT.OK,
    });
    return { ok: true, status: 'accepted', stage: STAGES.HIRED };
  }

  db.prepare(`UPDATE offers SET status='declined', decided_note=?, updated_at=? WHERE id=?`).run(reason || '', ts, id);
  db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(STAGES.REJECTED, o.candidate_id);
  audit.record(db, {
    tenantId: T, actorType: 'user', actorId: ctx.userId, action: '登记 Offer 被拒',
    objectType: 'offer', objectId: 'OF-' + id,
    detail: `${(c && c.name) || o.candidate_id} · 阶段 → ${STAGES.REJECTED} · 原因：${reason || '未填写'}`,
    result: audit.RESULT.OK,
  });
  return { ok: true, status: 'declined', stage: STAGES.REJECTED };
}

/* ===========================================================
   五、漏斗统计（供前端与报表）
   =========================================================== */
function pipeline(db) {
  const rows = db.prepare(`SELECT stage, COUNT(*) n FROM candidates GROUP BY stage`).all();
  const by = Object.fromEntries(rows.map(r => [r.stage, r.n]));
  const order = FUNNEL.map(s => ({ stage: s, count: by[s] || 0 }));
  return {
    order,
    rejected: by[STAGES.REJECTED] || 0,
    other: rows.filter(r => !FUNNEL.includes(r.stage) && r.stage !== STAGES.REJECTED).map(r => ({ stage: r.stage, count: r.n })),
    interviews: {
      open: db.prepare(`SELECT COUNT(*) c FROM interviews WHERE status IN ('scheduled','in_progress')`).get().c,
      done: db.prepare(`SELECT COUNT(*) c FROM interviews WHERE status='completed'`).get().c,
    },
    offers: {
      pending: db.prepare(`SELECT COUNT(*) c FROM offers WHERE status='pending_approval'`).get().c,
      sent: db.prepare(`SELECT COUNT(*) c FROM offers WHERE status='sent'`).get().c,
    },
  };
}

module.exports = {
  STAGES, FUNNEL, ROUND_RESULT, RESULT_LABEL, FINAL_ROUND, OFFER_LABEL,
  MIN_WAGE_BJ, MAX_PROBATION_MONTHS,
  normTime, salaryBand, checkOffer,
  interviewers, listInterviews, scheduleInterview, startInterview, submitFeedback, cancelInterview,
  listOffers, createOffer, decideOffer, respondOffer, pipeline,
  T,
};
