/* ===========================================================
   L2 · 认证服务（auth）
   职责：注册口令、登录、会话解析、登出、改密、会话清理。

   这是 docs/08 附录第 10 题的答案 ——「如果只做一件事：删掉对 X-User 请求头的信任」。
   本模块之后，`X-User` 在任何 strict 模式路径上都不再被读取。

   为什么是「不透明令牌 + 服务端会话表」而不是纯 JWT：
   - 纯 JWT 无法吊销：员工离职、密码泄露、设备丢失时，只能等它自然过期。
   - 本设计里令牌只是「会话 ID 的载体」，服务端 sessions 表才是真相来源，
     因此可以**即时踢人**（revokeAllForUser），且能记录登录 IP / UA 供审计。

   性能注意（这是本项目踩过的坑，见 ADR-005）：
   node:sqlite 每条写语句在 Windows 上都会 fsync。因此 last_seen_at 这类
   「每次请求都变」的字段**必须节流写**，否则读接口会变成写接口，吞吐被 fsync 拖死。
   =========================================================== */
'use strict';
const { config } = require('./config.js');
const S = require('./security.js');
const rbac = require('./rbac.js');
const audit = require('./audit.js');
const metrics = require('./metrics.js');
const { logger } = require('./logger.js');
const { AppError, badRequest, unauthenticated, forbidden } = require('./errors.js');

/* 演示账号口令：仅用于本地演示环境。生产必须走首次登录强制改密。 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026';
const MAX_FAILED = 5;
const LOCK_MS = 5 * 60 * 1000;
const SEEN_THROTTLE_MS = 60 * 1000;

/* ---------- 演示账号补齐（幂等） ----------
   为什么放在这里而不是 seed：seed 属于「业务演示数据」，口令属于「身份数据」，
   且老库已经有 users 行、不能重灌。这里做的是「缺谁补谁 + 补口令」。 */
/* 「增量账号」：不属于 db.js 的历史种子，但必须是**幂等可重建**的。
   为什么放在这里而不是 db.js 的 seed()：
   ① seed() 只在空库跑一次，老库升级时不会补人；这里是每次启动都跑，能补齐。
   ② /api/reset 会清空 users 表再灌种子，路由随后会再调一次本函数，所以重置后也在。
   注意 U-007/U-008 是 `interviewer` —— 之前这个角色配了能力却没有任何真人担任，
   「已邀约 → 面试官」这一段因此是断的。派真人之后链路才闭环。 */
const EXTRA_USERS = [
  ['U-000', 'T-001', '系统管理员', 'admin', '/信息技术部', '系统管理员', ''],
  ['U-006', 'T-001', '周审', 'auditor', '/合规与风控部', '数据保护负责人', ''],
  ['U-007', 'T-001', '王磊', 'interviewer', '/技术中心/后端组', '后端负责人', ''],
  ['U-008', 'T-001', '孙倩', 'interviewer', '/产品中心', '产品总监', ''],
];

function ensureSeedCredentials(db) {
  const T = 'T-001';
  const ins = db.prepare(`INSERT INTO users (id,tenant_id,name,role,dept_path,title,external_id,is_active) VALUES (?,?,?,?,?,?,?,1)`);
  EXTRA_USERS.forEach(u => {
    const exists = db.prepare(`SELECT id FROM users WHERE id=?`).get(u[0]);
    if (!exists) ins.run(...u);
  });

  /* 给所有还没有口令的账号写入演示口令（老库升级路径） */
  const need = db.prepare(`SELECT id FROM users WHERE password_hash IS NULL OR password_hash=''`).all();
  if (need.length) {
    const st = db.prepare(`UPDATE users SET password_hash=?, password_algo=?, password_updated_at=?, must_change_password=1 WHERE id=?`);
    const hash = S.hashPassword(DEMO_PASSWORD);
    const ts = audit.nowCN();
    need.forEach(u => st.run(hash, S.ALGO, ts, u.id));
    logger.warn('已为演示账号写入初始口令（must_change_password=1）', { count: need.length, hint: '生产环境禁止共享初始口令' });
  }
  db.prepare(`UPDATE users SET is_active=1 WHERE is_active IS NULL`).run();
  return need.length;
}

/* ---------- 锁定策略：连续失败 N 次锁定 M 分钟 ---------- */
function checkLock(u) {
  if (!u.locked_until) return;
  const until = Date.parse(String(u.locked_until).replace(' ', 'T') + '+08:00');
  if (Number.isFinite(until) && until > Date.now()) {
    const sec = Math.ceil((until - Date.now()) / 1000);
    throw new AppError('FORBIDDEN', `账号已临时锁定，请 ${sec} 秒后重试（连续失败 ${MAX_FAILED} 次）`);
  }
}

function markFailure(db, u) {
  const n = Number(u.failed_logins || 0) + 1;
  const lockUntil = n >= MAX_FAILED ? audit.nowCN().slice(0, 11) + new Date(Date.now() + LOCK_MS + 8 * 3600e3).toISOString().slice(11, 19) : null;
  db.prepare(`UPDATE users SET failed_logins=?, locked_until=? WHERE id=?`).run(n, lockUntil, u.id);
  return { n, lockUntil };
}

const clearFailure = (db, uid) =>
  db.prepare(`UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=? WHERE id=?`).run(audit.nowCN(), uid);

/* ---------- 登录 ---------- */
/**
 * @returns {{ token:string, expiresAt:number, user:object, ctx:object }}
 * 注意：无论「账号不存在」还是「口令错误」，对外都是同一句提示 ——
 * 不给攻击者「哪些账号存在」的枚举信号。
 */
function login(db, { identifier, password, ip, userAgent } = {}) {
  const ident = String(identifier || '').trim();
  if (!ident || !password) throw badRequest('请输入账号与密码');

  const u = db.prepare(`SELECT * FROM users WHERE id=? OR external_id=?`).get(ident, ident);
  const GENERIC = '账号或密码不正确';

  if (!u) {
    /* 计时对齐：做一次哈希运算，避免「不存在」比「密码错」返回更快而被枚举 */
    try { S.hashPassword(String(password).padEnd(8, 'x')); } catch { /* 忽略 */ }
    metrics.inc('auth.login.fail');
    throw new AppError('UNAUTHENTICATED', GENERIC);
  }
  if (!u.is_active) { metrics.inc('auth.login.fail'); throw forbidden('账号已停用，请联系系统管理员'); }
  checkLock(u);

  if (!S.verifyPassword(password, u.password_hash || '')) {
    const { n, lockUntil } = markFailure(db, u);
    metrics.inc('auth.login.fail');
    audit.record(db, {
      tenantId: u.tenant_id, actorType: 'user', actorId: u.id,
      action: '登录失败', objectType: 'user', objectId: u.id,
      detail: `口令校验失败（第 ${n} 次）${lockUntil ? ' · 已锁定 5 分钟' : ''}`,
      result: audit.RESULT.BLOCKED,
    });
    throw new AppError('UNAUTHENTICATED', GENERIC);
  }

  clearFailure(db, u.id);

  const sid = S.randomId('S-');
  const token = S.signToken({ sid, uid: u.id, tid: u.tenant_id }, config.auth.sessionTtlMs);
  const fp = S.tokenFingerprint(token);
  const now = audit.nowCN();
  const exp = new Date(Date.now() + config.auth.sessionTtlMs + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`INSERT INTO sessions (sid,tenant_id,user_id,token_fp,issued_at,expires_at,last_seen_at,client_ip,user_agent)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(sid, u.tenant_id, u.id, fp, now, exp, now, String(ip || '').slice(0, 60), String(userAgent || '').slice(0, 200));

  metrics.inc('auth.login.ok');
  audit.record(db, {
    tenantId: u.tenant_id, actorType: 'user', actorId: u.id,
    action: '登录成功', objectType: 'session', objectId: sid,
    detail: `角色 ${u.role} · IP ${ip || '—'}${u.must_change_password ? ' · 使用初始口令，需尽快修改' : ''}`,
    result: audit.RESULT.OK,
  });

  const ctx = rbac.buildContext(u, { sid });
  return { token, sid, expiresAt: Date.now() + config.auth.sessionTtlMs, user: u, ctx };
}

/* ---------- 会话解析（每个请求都会走） ---------- */
/**
 * @param {string} token 原始令牌（Cookie 或 Bearer）
 * @returns {{ctx:object,user:object,session:object}|null}
 */
function resolveSession(db, token, { touch = true } = {}) {
  if (!token) return null;
  const payload = S.verifyToken(token);           // 先验签 + 验过期
  if (!payload || !payload.sid) return null;

  const s = db.prepare(`SELECT * FROM sessions WHERE sid=?`).get(payload.sid);
  if (!s) return null;
  if (s.revoked_at) return null;
  if (!S.safeEqual(s.token_fp, S.tokenFingerprint(token))) return null;   // 换签不发新 sid，防混用
  const expMs = Date.parse(String(s.expires_at).replace(' ', 'T') + '+08:00');
  if (Number.isFinite(expMs) && expMs < Date.now()) return null;

  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(s.user_id);
  if (!u || !u.is_active) return null;

  /* 节流写 last_seen_at：见文件头「性能注意」 */
  if (touch) {
    const last = Date.parse(String(s.last_seen_at || '').replace(' ', 'T') + '+08:00');
    if (!Number.isFinite(last) || Date.now() - last > SEEN_THROTTLE_MS) {
      try { db.prepare(`UPDATE sessions SET last_seen_at=? WHERE sid=?`).run(audit.nowCN(), s.sid); }
      catch { /* 读取路径上的写失败不影响鉴权结果 */ }
    }
  }
  return { ctx: rbac.buildContext(u, s), user: u, session: s };
}

/* ---------- 登出 / 吊销 ---------- */
function logout(db, ctx, reason = '用户主动登出') {
  if (!ctx || !ctx.sid) return { ok: true };
  db.prepare(`UPDATE sessions SET revoked_at=?, revoke_reason=? WHERE sid=?`).run(audit.nowCN(), reason, ctx.sid);
  audit.record(db, {
    tenantId: ctx.tenantId, actorType: 'user', actorId: ctx.userId,
    action: '登出', objectType: 'session', objectId: ctx.sid, detail: reason, result: audit.RESULT.OK,
  });
  metrics.inc('auth.logout');
  return { ok: true };
}

/** 即时踢人：改密、离职、怀疑泄露时使用 —— 纯 JWT 做不到这件事 */
function revokeAllForUser(db, userId, reason) {
  const r = db.prepare(`UPDATE sessions SET revoked_at=?, revoke_reason=? WHERE user_id=? AND revoked_at IS NULL`)
    .run(audit.nowCN(), reason, userId);
  return Number(r.changes || 0);
}

/* ---------- 改密 ---------- */
function changePassword(db, ctx, oldPw, newPw) {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(ctx.userId);
  if (!u) throw unauthenticated();
  /* 改密必须先验旧口令：否则会话被盗后可直接改密永久占号 */
  if (!S.verifyPassword(oldPw, u.password_hash || '')) throw forbidden('原密码不正确');
  if (String(newPw || '').length < 8) throw badRequest('新密码至少 8 位');
  if (String(newPw) === String(oldPw)) throw badRequest('新密码不能与原密码相同');

  db.prepare(`UPDATE users SET password_hash=?, password_algo=?, password_updated_at=?, must_change_password=0 WHERE id=?`)
    .run(S.hashPassword(newPw), S.ALGO, audit.nowCN(), u.id);

  const kicked = revokeAllForUser(db, u.id, '密码已修改，强制重新登录');
  audit.record(db, {
    tenantId: ctx.tenantId, actorType: 'user', actorId: u.id,
    action: '修改密码', objectType: 'user', objectId: u.id,
    detail: `已吊销全部会话 ${kicked} 个`, result: audit.RESULT.OK,
  });
  metrics.inc('auth.password.changed');
  return { ok: true, revokedSessions: kicked };
}

/* ---------- 维护任务：清理过期会话 ---------- */
function sweepExpired(db) {
  const r = db.prepare(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`)
    .run(audit.nowCN(), new Date(Date.now() - 7 * 86400e3 + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19));
  const n = Number(r.changes || 0);
  if (n) logger.info('已清理过期会话', { count: n });
  return n;
}

function activeSessions(db, userId) {
  return db.prepare(`SELECT sid,issued_at,expires_at,last_seen_at,client_ip,user_agent
    FROM sessions WHERE user_id=? AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 20`).all(userId);
}

module.exports = {
  ensureSeedCredentials, login, resolveSession, logout, revokeAllForUser,
  changePassword, sweepExpired, activeSessions, DEMO_PASSWORD, MAX_FAILED,
};
