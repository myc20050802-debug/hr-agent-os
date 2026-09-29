/* ===========================================================
   L2 · 数据治理域（governance）
   职责：把 PIPL 对「敏感个人信息」的要求落成可执行代码，而不是文档里的声明。

   覆盖四项数据主体 / 合规能力（对齐 docs/07 §3.1-7 与 docs/08 §七）：
     ① 授权留痕   —— 简历从哪来、授权了什么用途、什么时候到期、有没有撤回
     ② 留存期     —— 到期自动清理（不是「记得删」）
     ③ 删除权     —— 数据主体可要求删除；默认**匿名化**，可选硬删除
     ④ 可携带     —— 数据主体可导出自己的数据

   一个关键取舍：**默认匿名化而非直接 DELETE**
   - 直接删行会让审计链断掉（审计里引用 candidate_id，删了就查不到上下文），
     统计口径也会跟着跳变。
   - 匿名化保留「这条记录存在过」这个事实，但抹掉全部可识别信息，
     合规上满足「不可识别到个人」的目标。
   - 但 PIPL 语境下有场景要求**彻底删除**，所以 `mode:'hard'` 保留为显式选项，
     并写审计（谁在什么时候执行了硬删）。
   =========================================================== */
'use strict';
const { config } = require('./config.js');
const audit = require('./audit.js');
const { badRequest, notFound } = require('./errors.js');
const { logger } = require('./logger.js');

/* 候选人的可识别字段 —— 匿名化时要抹掉的清单（含 JSON 数组字段）
   注意 ai_why 也在清单里：归因文案里含具体业务标签与命中情况（如「命中 2 个
   商业化、增长类业务标签」），属于对「这个人」的画像描述，匿名化时不能留下。 */
const IDENTIFYING_FIELDS = [
  ['name', "'已删除'"], ['gender', 'NULL'], ['birth_date', 'NULL'], ['company', 'NULL'],
  ['edu_text', 'NULL'], ['skills', "'[]'"], ['business_tags', "'[]'"], ['plus_tags', "'[]'"],
  ['ai_reasons', "'[]'"], ['ai_why', 'NULL'], ['ai_note', 'NULL'], ['override_reason', 'NULL'], ['override_code', 'NULL'], ['source', 'NULL'],
];

const DEFAULT_POLICIES = [
  ['候选人简历', 180, '招聘评估所必需，评估结束后转入人才库需另行授权'],
  ['面试记录', 180, '劳动争议举证期与内部复盘需要'],
  ['落选者档案', 90, '《个人信息保护法》最小必要原则，落选后不再需要长期留存'],
];

const nowCN = () => audit.nowCN();
const plusDays = d => new Date(Date.now() + d * 86400e3 + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

/* ---------- ① 留存策略 ---------- */
function ensureDefaultPolicies(db, tenantId) {
  const st = db.prepare(`INSERT OR IGNORE INTO retention_policies (tenant_id,data_class,retain_days,basis,updated_at) VALUES (?,?,?,?,?)`);
  DEFAULT_POLICIES.forEach(([cls, days, basis]) => st.run(tenantId, cls, days, basis, nowCN()));
}

function listPolicies(db, tenantId) {
  return db.prepare(`SELECT * FROM retention_policies WHERE tenant_id=? ORDER BY id`).all(tenantId);
}

function upsertPolicy(db, tenantId, { dataClass, retainDays, basis }) {
  if (!dataClass) throw badRequest('dataClass 必填');
  const days = Number(retainDays);
  if (!Number.isFinite(days) || days < 1 || days > 3650) throw badRequest('留存天数需在 1–3650 之间');
  db.prepare(`INSERT INTO retention_policies (tenant_id,data_class,retain_days,basis,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(tenant_id,data_class) DO UPDATE SET retain_days=excluded.retain_days, basis=excluded.basis, updated_at=excluded.updated_at`)
    .run(tenantId, dataClass, Math.floor(days), basis || '', nowCN());
  return listPolicies(db, tenantId);
}

const policyDays = (db, tenantId, cls) => {
  const p = db.prepare(`SELECT retain_days FROM retention_policies WHERE tenant_id=? AND data_class=?`).get(tenantId, cls);
  return p ? Number(p.retain_days) : config.governance.defaultRetainDays;
};

/* ---------- ② 授权留痕 ---------- */
function grantConsent(db, { tenantId, candidateId, purpose, channel, evidence, days = 180 }) {
  if (!candidateId || !purpose) throw badRequest('candidateId 与 purpose 必填');
  const cand = db.prepare(`SELECT id FROM candidates WHERE id=?`).get(candidateId);
  if (!cand) throw notFound('候选人不存在');
  const grantedAt = nowCN();
  const expiresAt = plusDays(days);
  db.prepare(`INSERT INTO consents (tenant_id,candidate_id,purpose,channel,evidence,granted_at,expires_at) VALUES (?,?,?,?,?,?,?)`)
    .run(tenantId, candidateId, purpose, channel || '投递时勾选', evidence || '', grantedAt, expiresAt);
  db.prepare(`UPDATE candidates SET consent_given=1 WHERE id=?`).run(candidateId);
  return { candidateId, purpose, grantedAt, expiresAt };
}

function revokeConsent(db, { tenantId, candidateId, purpose }) {
  const r = db.prepare(`UPDATE consents SET revoked_at=? WHERE tenant_id=? AND candidate_id=? ${purpose ? 'AND purpose=?' : ''} AND revoked_at IS NULL`)
    .run(...(purpose ? [nowCN(), tenantId, candidateId, purpose] : [nowCN(), tenantId, candidateId]));
  const anyValid = validConsent(db, { tenantId, candidateId });
  if (!anyValid) db.prepare(`UPDATE candidates SET consent_given=0 WHERE id=?`).run(candidateId);
  return { revoked: Number(r.changes || 0), consentGiven: !!anyValid };
}

/**
 * 是否存在**有效**授权：未撤回 + 未过期。
 * 注意判据里包含 expires_at ——「授权过」不等于「现在还有效」，
 * 这是很多系统漏掉的一环。
 */
function validConsent(db, { tenantId, candidateId, purpose }) {
  const now = nowCN();
  const row = db.prepare(`SELECT id FROM consents
    WHERE tenant_id=? AND candidate_id=? ${purpose ? 'AND purpose=?' : ''}
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`)
    .get(...(purpose ? [tenantId, candidateId, purpose, now] : [tenantId, candidateId, now]));
  return !!row;
}

const listConsents = (db, { tenantId, candidateId }) =>
  db.prepare(`SELECT * FROM consents WHERE tenant_id=? ${candidateId ? 'AND candidate_id=?' : ''} ORDER BY id DESC LIMIT 200`)
    .all(...(candidateId ? [tenantId, candidateId] : [tenantId]));

/* ---------- ③ 留存期：设置与巡检 ---------- */
/** 给还没有 retain_until 的候选人补上到期时间（按「落选者档案」策略） */
function backfillRetention(db, tenantId) {
  const days = policyDays(db, tenantId, '落选者档案');
  const r = db.prepare(`UPDATE candidates SET retain_until=? WHERE tenant_id=? AND retain_until IS NULL`)
    .run(plusDays(days), tenantId);
  return Number(r.changes || 0);
}

/**
 * 留存期巡检：把到期候选人匿名化。
 * 本方法**可重复调用**（幂等），适合挂到定时任务上。
 */
function sweepExpired(db, tenantId, { dryRun = false } = {}) {
  const now = nowCN();
  const rows = db.prepare(`SELECT id, name FROM candidates
    WHERE tenant_id=? AND retain_until IS NOT NULL AND retain_until < ?
      AND anonymized_at IS NULL`).all(tenantId, now);
  if (dryRun) return { due: rows.length, anonymized: 0, ids: rows.map(r => r.id) };

  let n = 0;
  db.exec('BEGIN');
  try {
    rows.forEach(r => { anonymizeWithin(db, r.id); n++; });
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }

  if (n) {
    audit.record(db, {
      tenantId, actorType: 'system', actorId: null,
      action: '留存期到期自动清理', objectType: 'candidate', objectId: `${n} 条`,
      detail: `按留存策略匿名化 ${n} 条候选人记录（到期日 < ${now}）`, result: audit.RESULT.OK,
    });
    logger.info('留存期巡检完成', { anonymized: n, tenantId });
  }
  return { due: rows.length, anonymized: n, ids: rows.map(r => r.id) };
}

/* 匿名化：抹掉全部可识别字段，保留存在性事实（供审计与统计） */
function anonymizeWithin(db, candidateId) {
  const sets = IDENTIFYING_FIELDS.map(([f, v]) => `${f}=${v}`).join(',');
  db.prepare(`UPDATE candidates SET ${sets}, anonymized_at=?, stage='anonymized' WHERE id=?`).run(nowCN(), candidateId);
}

/* ---------- ④ 数据主体权利：导出 / 删除 ---------- */
/** 导出某候选人的全部留存数据（数据可携带权 / 查阅权） */
function exportSubjectData(db, { tenantId, candidateId }) {
  const c = db.prepare(`SELECT * FROM candidates WHERE id=? AND tenant_id=?`).get(candidateId, tenantId);
  if (!c) throw notFound('候选人不存在');
  return {
    subject: { id: c.id, name: c.name },
    profile: {
      gender: c.gender, birth: c.birth_date, company: c.company, edu: c.edu_text,
      years: c.years_exp, skills: JSON.parse(c.skills || '[]'),
    },
    /* 「为什么给了这个分」是自动决策的说明，属于当事人有权知悉的内容
       （《个人信息保护法》第 24 条自动化决策的透明度要求）—— 导出时一并给出。 */
    screening: { score: c.ai_score, grade: c.ai_grade, note: c.ai_note, why: c.ai_why ? JSON.parse(c.ai_why) : null, human: c.human_decision },
    consents: listConsents(db, { tenantId, candidateId }),
    retention: { retainUntil: c.retain_until, anonymizedAt: c.anonymized_at },
    generatedAt: nowCN(),
  };
}

/**
 * 删除权。
 * @param {'anonymize'|'hard'} mode 默认 anonymize（保留审计上下文）；
 *        hard 会连同该候选人的授权记录一并物理删除。
 */
function eraseCandidate(db, ctx, { candidateId, reason, mode = 'anonymize' }) {
  const c = db.prepare(`SELECT * FROM candidates WHERE id=? AND tenant_id=?`).get(candidateId, ctx.tenantId);
  if (!c) throw notFound('候选人不存在');
  if (!reason) throw badRequest('删除必须记录事由（合规要求）');

  db.exec('BEGIN');
  try {
    if (mode === 'hard') {
      db.prepare(`DELETE FROM consents WHERE tenant_id=? AND candidate_id=?`).run(ctx.tenantId, candidateId);
      db.prepare(`DELETE FROM candidates WHERE id=? AND tenant_id=?`).run(candidateId, ctx.tenantId);
    } else {
      anonymizeWithin(db, candidateId);
      db.prepare(`UPDATE consents SET revoked_at=? WHERE tenant_id=? AND candidate_id=? AND revoked_at IS NULL`)
        .run(nowCN(), ctx.tenantId, candidateId);
    }
    db.prepare(`INSERT INTO erasure_requests (tenant_id,candidate_id,requested_by,reason,status,handled_by,handled_at)
      VALUES (?,?,?,?,'done',?,?)`)
      .run(ctx.tenantId, candidateId, ctx.userId, `${mode === 'hard' ? '硬删除' : '匿名化'}：${reason}`, ctx.userId, nowCN());
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }

  audit.record(db, {
    tenantId: ctx.tenantId, actorType: 'user', actorId: ctx.userId,
    action: mode === 'hard' ? '执行数据删除（物理）' : '执行数据删除（匿名化）',
    objectType: 'candidate', objectId: candidateId,
    detail: `事由：${reason}`, result: audit.RESULT.OK,
  });
  return { ok: true, mode, candidateId };
}

const listErasureRequests = (db, tenantId) =>
  db.prepare(`SELECT * FROM erasure_requests WHERE tenant_id=? ORDER BY id DESC LIMIT 100`).all(tenantId);

/* ---------- 治理总览（给前端的合规看板用真实数字） ---------- */
function summary(db, tenantId) {
  const now = nowCN();
  const total = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE tenant_id=?`).get(tenantId).c;
  const anonymized = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE tenant_id=? AND anonymized_at IS NOT NULL`).get(tenantId).c;
  const noConsent = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE tenant_id=? AND (consent_given IS NULL OR consent_given=0)`).get(tenantId).c;
  const due = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE tenant_id=? AND retain_until IS NOT NULL AND retain_until < ? AND anonymized_at IS NULL`).get(tenantId, now).c;
  const consents = db.prepare(`SELECT COUNT(*) c FROM consents WHERE tenant_id=? AND revoked_at IS NULL`).get(tenantId).c;
  const revoked = db.prepare(`SELECT COUNT(*) c FROM consents WHERE tenant_id=? AND revoked_at IS NOT NULL`).get(tenantId).c;
  const expiredConsent = db.prepare(`SELECT COUNT(*) c FROM consents WHERE tenant_id=? AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?`).get(tenantId, now).c;
  return {
    candidates: total, anonymized, noConsent, dueForDeletion: due,
    consentsActive: consents, consentsRevoked: revoked, consentsExpired: expiredConsent,
    policies: listPolicies(db, tenantId),
  };
}

module.exports = {
  IDENTIFYING_FIELDS, DEFAULT_POLICIES,
  ensureDefaultPolicies, listPolicies, upsertPolicy, policyDays,
  grantConsent, revokeConsent, validConsent, listConsents,
  backfillRetention, sweepExpired, anonymizeWithin,
  exportSubjectData, eraseCandidate, listErasureRequests, summary,
};
