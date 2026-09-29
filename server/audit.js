/* ===========================================================
   L2 · 审计服务（audit）
   职责：所有**有后果的动作**都要留痕，且只插不改。

   「只插不改」的两层保障：
   - 应用层：本模块只暴露 insert（+ 只读查询），没有任何 UPDATE/DELETE 代码路径。
   - 数据库层：migrations.js v4 建了 BEFORE UPDATE / BEFORE DELETE 触发器，
     物理上拒绝改写。两层都有，才算「审计不可篡改」。

   什么必须留痕（本项目的纪律）：
   - 所有写操作（建岗 / 审批 / 推翻 / 重置 / 治理）
   - **所有被拒绝的访问**（result='blocked'）—— 越权尝试本身就是情报
   - 所有敏感数据访问（读未脱敏 PII）
   - Agent 的每一次判断（见 engine.js，沿用同一张表）
   =========================================================== */
'use strict';
const { logger } = require('./logger.js');

/* 结果枚举：ok / blocked / pending / error。前端与报表都依赖这四个值。 */
const RESULT = { OK: 'ok', BLOCKED: 'blocked', PENDING: 'pending', ERROR: 'error' };

function nowCN() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
}

let insertStmt = null;
function stmt(db) {
  if (!insertStmt) {
    insertStmt = db.prepare(`INSERT INTO audit_logs
      (tenant_id,actor_type,actor_id,task_id,action,object_type,object_id,detail,result,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
  }
  return insertStmt;
}

/**
 * 写一条审计。
 * **失败不抛出** —— 审计写不进去不应该让主业务崩掉，但必须留下 error 日志，
 * 因为这本身是个需要排查的严重问题（审计断链）。
 */
function record(db, e) {
  try {
    stmt(db).run(
      e.tenantId || 'T-001',
      e.actorType || 'system',
      e.actorId || null,
      e.taskId || null,
      e.action,
      e.objectType || null,
      e.objectId || null,
      e.detail || '',
      e.result || RESULT.OK,
      e.createdAt || nowCN()
    );
  } catch (err) {
    logger.error('审计写入失败（审计断链，需排查）', { action: e && e.action, err: err.message });
  }
}

/** 拒绝访问留痕的统一入口：detail 里写清「谁、想做什么、被什么规则拦下」 */
function denied(db, { tenantId, actorType, actorId, action, objectType, objectId, reason, requestId }) {
  record(db, {
    tenantId, actorType: actorType || 'user', actorId, action, objectType, objectId,
    detail: `被拦截：${reason || '权限不足'}${requestId ? ' · requestId=' + requestId : ''}`,
    result: RESULT.BLOCKED,
  });
}

/** 只读查询：审计尾部（供 /api/audit 与报表） */
function tail(db, limit = 50) {
  return db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`).all(Math.min(Number(limit) || 50, 500));
}

function stats(db) {
  const r = db.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN result='blocked' THEN 1 ELSE 0 END) blocked,
      SUM(CASE WHEN result='ok' THEN 1 ELSE 0 END) ok,
      SUM(CASE WHEN result='error' THEN 1 ELSE 0 END) err
    FROM audit_logs`).get();
  return { total: r.total || 0, blocked: r.blocked || 0, ok: r.ok || 0, error: r.err || 0 };
}

module.exports = { record, denied, tail, stats, RESULT, nowCN };
