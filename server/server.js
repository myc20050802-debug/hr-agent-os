/* ===========================================================
   HR-Agent OS · 服务入口（组装器）
   职责：**只做组装与生命周期**，不含任何业务逻辑。

   装配顺序（对齐 docs/08 §3.1 分层）：
     L5 config → L4 db(migrate/seed) → L2 领域服务 → L1 routes → L0 kernel → http

   启动：node --experimental-sqlite server.js      （或双击 start.bat）
         加 --reset 可重置数据库到干净种子状态
   默认地址 http://127.0.0.1:8788

   与 v0.9.x 的关键差异（M1 可信底座）：
   - 身份不再来自可伪造的 X-User 请求头，而是「口令登录 + 服务端会话」。
   - 所有 /api/* 未登录一律 401（不再是「默认就是 HRD」）。
   - 角色越权 403 且写审计；审计表由数据库触发器保证 append-only。
   - schema 改由版本化迁移管理，可从空库一键建到最新版本。

   历史教训（ADR-005）仍适用：node:sqlite 每条写语句在 Windows 上 fsync 一次，
   因此**请求路径上的写操作要尽可能少且要批量化**。这也是为什么 last_seen_at
   要节流写、bootstrap 的 JD 自愈要合并成一个事务。
   =========================================================== */
'use strict';
const http = require('http');
const path = require('path');

const { config, validate, warnings } = require('./config.js');
const { logger } = require('./logger.js');
const metrics = require('./metrics.js');
const audit = require('./audit.js');
const auth = require('./auth.js');
const gov = require('./governance.js');
const dbmod = require('./db.js');
const { buildRouter, TENANT } = require('./routes.js');
const { createKernel } = require('./http-kernel.js');
const { redact } = require('./logger.js');

/* ---------- L5：配置先校验，配错就别启动 ---------- */
validate();
const configWarnings = warnings();
const info = config.describe();

/* `--reset` 与 /api/reset 受**同一个开关**约束。
   两个入口两条判断是最容易漏的写法 —— 关掉接口却留着命令行，
   等于「以为关上了，其实没有」。 */
const wantReset = process.argv.includes('--reset');
if (wantReset && !config.admin.allowReset) {
  logger.error('拒绝执行 --reset：本机已关闭演示重置（ALLOW_RESET=0）', { env: config.env });
  process.stderr.write('\n[启动中止] --reset 会清空运行期表，但当前配置禁止重置'
    + `（NODE_ENV=${config.env}, ALLOW_RESET=0）。\n`
    + '  确有需要：临时设置 ALLOW_RESET=1 再执行，并在用完后移除该变量。\n\n');
  process.exit(2);
}

/* ---------- L4：数据库（迁移 + 种子） ---------- */
const db = dbmod.open(wantReset);
logger.info('数据库就绪', {
  file: info.db,
  schemaVersion: dbmod.schemaVersion(db),
  migrated: db.__migration ? db.__migration.applied.length : 0,
});

/* ---------- L2：身份与治理的初始化（幂等，每次启动都跑） ---------- */
const seeded = auth.ensureSeedCredentials(db);
gov.ensureDefaultPolicies(db, TENANT);
const backfilled = gov.backfillRetention(db, TENANT);
const swept = auth.sweepExpired(db);
logger.info('初始化完成', { seededCredentials: seeded, backfilledRetention: backfilled, sweptSessions: swept });

/* ---------- 认证：把「请求」变成「身份」 ----------
   **只认会话。`X-User` 请求头在本进程里没有任何代码路径会去读它** ——
   这是 M1 的全部意义。曾经的 AUTH_MODE=legacy 分支已删除，理由见 config.js。 */
function extractToken(req) {
  const cookies = require('./security.js').parseCookies(req.headers.cookie);
  const fromCookie = cookies[config.auth.cookieName];
  if (fromCookie) return { token: fromCookie, via: 'cookie' };
  const h = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(h)) return { token: h.replace(/^Bearer\s+/i, '').trim(), via: 'bearer' };
  /* 兼容：部分客户端不便设 Cookie，允许用自定义头携带同一枚令牌（仍然验签） */
  const alt = req.headers['x-session-token'];
  if (alt) return { token: String(alt), via: 'header' };
  return { token: null, via: null };
}

function authenticate(req) {
  const { token, via } = extractToken(req);
  if (!token) return null;
  const s = auth.resolveSession(db, token);
  if (s) s.via = via;
  return s;
}

/* ---------- 拒绝留痕：401 不算安全事件，403 才算 ----------
   401 是「还没登录」，浏览器首屏必然触发一次，写审计只会淹没有用信息；
   403 是「登录了但越权」，这才是需要被看见的情报。 */
const onForbidden = (a, m) => {
  audit.denied(db, {
    tenantId: a.ctx.tenantId, actorId: a.ctx.userId, action: '越权访问被拦截',
    objectType: 'api', objectId: m.method + ' ' + m.pathname,
    reason: `角色 ${a.ctx.role} 缺少能力 ${m.need}`, requestId: m.requestId,
  });
  metrics.inc('rbac.denied');
};
const onUnauthenticated = () => metrics.inc('auth.anonymous.blocked');

/* ---------- L1 + L0 ---------- */
const router = buildRouter(db);
const kernel = createKernel({
  router,
  authenticate,
  onForbidden,
  onUnauthenticated,
  publicPaths: new Set(['/api/health', '/api/auth/login']),
});

const server = http.createServer((req, res) => {
  kernel.handle(req, res).catch(err => {
    logger.error('内核未捕获异常', { err: err && err.message, stack: err && err.stack, url: req.url });
    if (!res.writableEnded) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: '服务内部错误' } }));
      } catch { /* 连接已断，忽略 */ }
    }
  });
});

/* ---------- 维护任务：会话清理 + 留存期巡检 ----------
   放在服务进程内是刻意的取舍：单机私有化部署不引入 Redis/Celery，
   用 unref 定时器避免拖住进程退出。上规模时应换成外部调度（见 docs/08 §九）。 */
const MAINTENANCE_MS = 10 * 60 * 1000;
const maintenance = setInterval(() => {
  try {
    auth.sweepExpired(db);
    const r = gov.sweepExpired(db, TENANT);
    if (r.anonymized) logger.info('留存期巡检已匿名化', { count: r.anonymized });
    /* 顺带把 WAL 合并回主库（PASSIVE：不阻塞在途读者）。
       为什么放在这里：本进程是唯一的写者，维护定时器天然是「安全窗口」；
       让 -wal 长期增长没有任何好处，只会在需要备份时咬人。 */
    dbmod.checkpoint(db, 'PASSIVE');
  } catch (e) { logger.error('维护任务失败', { err: e.message }); }
}, MAINTENANCE_MS);
maintenance.unref?.();

/* ---------- 优雅关闭：等在途请求结束再关连接 ---------- */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('收到关闭信号，开始优雅关闭', { signal, graceMs: config.http.shutdownGraceMs });
  /* 关闭前把 WAL 合并并截断（TRUNCATE）：
     退出后主库文件即是完整数据，拷贝走就能用，不需要连 -wal 一起拷。
     这是「备份可用性」问题，不是优化。 */
  const cp = dbmod.checkpoint(db, 'TRUNCATE');
  logger.info('WAL 已 checkpoint', cp);
  const finish = (code) => {
    try { db.close(); } catch { /* ignore */ }
    logger.info('服务已关闭');
    process.exit(code);
  };
  server.close(() => finish(0));
  setTimeout(() => {
    logger.warn('优雅关闭超时，强制退出');
    finish(1);
  }, config.http.shutdownGraceMs).unref?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', e => logger.error('uncaughtException', { err: e.message, stack: e.stack }));
process.on('unhandledRejection', e => logger.error('unhandledRejection', { err: String(e) }));

/* ---------- 启动 ---------- */
server.listen(config.http.port, config.http.host, () => {
  const L = [];
  const line = '  ' + '─'.repeat(62);
  L.push('');
  L.push(line);
  L.push('   HR-Agent OS · 本地全栈版（M1 可信底座）');
  L.push('   浏览器打开   http://' + config.http.host + ':' + config.http.port);
  L.push('   运行模式     ' + (info.llm === 'llm' ? 'LLM 已接入（OpenAI 兼容）' : '规则模式（离线可用，未配 LLM）'));
  L.push('   认证模式     strict（口令登录 + 服务端会话；X-User 请求头一律忽略）');
  L.push('   会话密钥     ' + info.secretSource + (info.secretSource === 'generated' ? '（已生成并落盘 server/.session_secret）' : ''));
  L.push('   数据库       server/hr_agent.db · SQLite · schema v' + dbmod.schemaVersion(db));
  L.push('   演示账号     U-001 李静(HRD) / U-002 王强(招聘) / U-005 陈明(HRBP)');
  L.push('                U-007 王磊(面试官·后端) / U-008 孙倩(面试官·产品)');
  L.push('                U-003 张一鸣(员工) / U-000 管理员 / U-006 周审(数据保护)');
  L.push('   初始口令     见登录页「演示账号」提示栏（演示用统一口令）');
  L.push('                — 口令不进日志：stdout 常被重定向进文件，写口令等于发凭证');
  L.push('   演示重置     ' + (info.allowReset
    ? '已开启（右上角 ♻ 或 POST /api/reset，需 admin:policy）'
    : '已关闭（ALLOW_RESET=0）—— 停服后用 --reset 重建'));
  L.push(line);
  if (configWarnings.length) {
    L.push('');
    configWarnings.forEach(w => L.push('   ⚠️  ' + w));
  }
  L.push('');
  logger.info('服务已启动', { url: `http://${config.http.host}:${config.http.port}`, env: config.env, authMode: info.authMode, schemaVersion: dbmod.schemaVersion(db) });
  process.stdout.write(L.join('\n') + '\n');
});

module.exports = { server, kernel, db };
