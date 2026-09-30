/* ===========================================================
   L5 · 配置层（config）
   职责：把「分散在代码各处的 process.env 读取 + 魔法数字」收敛成一处，
        并在启动时完成校验（fail fast），避免运行到一半才发现配错。

   设计取舍：
   - 零依赖 —— 不引入 dotenv，但支持 server/.env（简单 KEY=VALUE 解析）。
   - 密钥自动生成并落盘（.session_secret），保证重启不会把所有人踢下线，
     同时避免「默认硬编码密钥」这个最常见的生产事故。
   - 本文件是唯一允许读 process.env 的文件（其余模块一律 require config）。
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SERVER_DIR = __dirname;

/* ---------- 极简 .env 解析（KEY=VALUE，支持 # 注释与引号） ---------- */
function loadDotEnv() {
  const f = path.join(SERVER_DIR, '.env');
  if (!fs.existsSync(f)) return;
  let txt = '';
  try { txt = fs.readFileSync(f, 'utf8'); } catch { return; }
  txt.split(/\r?\n/).forEach(line => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const i = s.indexOf('=');
    if (i < 1) return;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;   // 真实环境变量优先于 .env
  });
}
loadDotEnv();

const str = (k, d) => (process.env[k] == null || process.env[k] === '' ? d : String(process.env[k]));
const num = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) ? n : d; };
const bool = (k, d) => { const v = process.env[k]; if (v == null || v === '' ) return d; return /^(1|true|yes|on)$/i.test(v); };
const abs = (k, d) => (process.env[k] ? path.resolve(process.env[k]) : d);

/* 环境名要在 config 对象之前定，因为「生产环境默认关掉什么」依赖它 */
const ENV = str('NODE_ENV', 'development');
const IS_PROD = ENV === 'production';

/* ---------- 会话密钥：持久化，缺失则生成（0600） ---------- */
function loadSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return { value: fromEnv, source: 'env' };
  /* 路径可覆盖：容器/私有化部署常把状态目录挂在卷上，写死在代码目录里
     会导致「容器一重建，所有人被踢下线」——重启后签名密钥变了，
     库里所有会话立即失效。 */
  const f = abs('SESSION_SECRET_FILE', path.join(SERVER_DIR, '.session_secret'));
  if (fs.existsSync(f)) {
    const v = fs.readFileSync(f, 'utf8').trim();
    if (v.length >= 32) return { value: v, source: 'file' };
  }
  const v = crypto.randomBytes(48).toString('base64url');
  try { fs.writeFileSync(f, v, { mode: 0o600 }); } catch { /* 只读文件系统：降级为进程内密钥 */ }
  return { value: v, source: 'generated' };
}
const secret = loadSecret();

/* ---------- 认证模式：只有 strict，没有开关 ----------
   曾经存在一个 `AUTH_MODE=legacy` 分支：它会信任 `X-User` 请求头，用来做
   「迁移前 vs 迁移后」的对比演示。它已被**删除**，理由：
   ① 「留一个开关」= 留一个后门。只要代码里还有一条信任请求头的路径，
      配置写错、环境变量残留、部署脚本拷贝了开发 .env，任何一条都能让整套鉴权失效。
      安全开关的正确默认值不是「关」，而是「不存在」。
   ② 对比演示的价值是一次性的，代价却是永久的：每次评审都要额外解释
      「我们保证生产不会打开它」——这句话本身就是风险。
   需要证明「身份不可伪造」时，用测试断言（见 tools/test_auth.js）比留后门更可信。 */
const AUTH_MODE = 'strict';

const config = {
  env: ENV,
  root: ROOT,
  serverDir: SERVER_DIR,
  staticRoot: path.join(ROOT, '平台原型'),

  /* 数据文件：库文件与会话密钥一样，路径必须可覆盖 —— 部署时数据目录挂在卷上，
     写死在代码目录里就意味着「重建即丢数据」。db.js / tools/backup.js 都读这里。 */
  db: {
    file: abs('DB_PATH', path.join(SERVER_DIR, 'hr_agent.db')),
  },

  /* 演示维护开关 —— 这里刻意**不是**「默认打开、生产再关」：
     /api/reset 会清空运行期表，放在公网就是一个「点一下数据全没」的按钮。
     所以默认值按环境给：生产默认关。 */
  admin: {
    allowReset: bool('ALLOW_RESET', !IS_PROD),
  },

  http: {
    port: num('PORT', 8788),
    host: str('HOST', '127.0.0.1'),
    /* 请求体上限：简历上传走这里，默认 8MB */
    maxBodyBytes: num('MAX_BODY_BYTES', 8 * 1024 * 1024),
    /* 优雅关闭等待在途请求的上限 */
    shutdownGraceMs: num('SHUTDOWN_GRACE_MS', 5000),
  },

  auth: {
    mode: AUTH_MODE,
    secret: secret.value,
    secretSource: secret.source,
    /* 会话有效期：演示场景 12 小时足够；生产应更短并配刷新令牌 */
    sessionTtlMs: num('SESSION_TTL_MS', 12 * 3600 * 1000),
    /* scrypt 参数。选 scrypt 而非 ADR-006 提的 Argon2id：Argon2id 需要原生模块，
       与「零依赖可交付」冲突。scrypt 是 Node 内置的内存困难型 KDF，
       参数（N=2^15, r=8, p=1）在 OWASP 建议区间内。换 Argon2id 只需替换本文件
       相邻的 security.js 两个函数，调用方无需改动。 */
    scrypt: { N: 32768, r: 8, p: 1, keyLen: 64, saltLen: 16 },
    cookieName: str('SESSION_COOKIE', 'hr_session'),
    cookieSecure: bool('COOKIE_SECURE', false),   // 本地 http 演示为 false；上 TLS 后置 true
  },

  rbac: {
    /* 字段级：默认遮罩的 PII 字段 */
    piiFields: ['phone', 'email', 'gender', 'birth', 'birth_date', 'id_card'],
  },

  rateLimit: {
    enabled: bool('RATE_LIMIT', true),
    /* 登录接口：按 IP + 账号双维度限流，防暴力破解 */
    login: { capacity: num('RL_LOGIN_CAP', 10), refillPerSec: num('RL_LOGIN_REFILL', 10 / 60) },
    /* 通用接口：按身份限流 */
    api: { capacity: num('RL_API_CAP', 600), refillPerSec: num('RL_API_REFILL', 10) },
  },

  log: {
    level: str('LOG_LEVEL', 'info'),
    /* 结构化日志落盘（便于「可观测」演示）；置空则只输出 stdout */
    file: str('LOG_FILE', path.join(SERVER_DIR, 'logs', 'app.log')),
    pretty: bool('LOG_PRETTY', false),
  },

  llm: {
    url: str('LLM_API_URL', ''),
    key: str('LLM_API_KEY', ''),
    model: str('LLM_MODEL', 'gpt-4o-mini'),
    timeoutMs: num('LLM_TIMEOUT_MS', 20000),
  },

  governance: {
    /* 默认留存期（天）：演示默认 180 天；到期由清理任务标记为待删除 */
    defaultRetainDays: num('DEFAULT_RETAIN_DAYS', 180),
    consentRequired: bool('CONSENT_REQUIRED', true),
  },
};

/* ---------- 启动期校验：配置错误应在这里炸，而不是在业务里炸 ---------- */
function validate() {
  const errs = [];
  if (!Number.isInteger(config.http.port) || config.http.port < 1 || config.http.port > 65535) errs.push('PORT 非法');
  if (!config.auth.secret || config.auth.secret.length < 16) errs.push('SESSION_SECRET 过短（需 ≥16 字符）');
  /* 生产环境必须开 COOKIE_SECURE：否则会话 Cookie 会以明文 http 传输，
     中间人可直接窃取身份。这是「配置错误就别启动」的典型场景。 */
  if (IS_PROD && config.auth.cookieSecure !== true) {
    errs.push('生产环境必须设置 COOKIE_SECURE=1（禁止明文 http 传输会话 Cookie）');
  }
  if (errs.length) throw new Error('[config] 配置校验失败：\n  - ' + errs.join('\n  - '));
  return true;
}

/* ---------- 启动期告警：不拦启动，但必须让人看见 ----------
   与 validate 的分工：validate 管「配错一定出事」，这里管「配了就该知道」。
   ALLOW_RESET=1 在公网等于对外开放一个清库按钮 —— 不禁止（有人就是拿它做
   公网演示），但每次启动都喊一遍，且横幅里标红。 */
function warnings() {
  const w = [];
  if (IS_PROD && config.admin.allowReset) {
    w.push('生产环境开启了 ALLOW_RESET：/api/reset 会清空运行期表，确认这是有意为之（公网暴露即事故）');
  }
  if (!IS_PROD && config.auth.cookieSecure) {
    w.push('开发环境开启了 COOKIE_SECURE：若用 http 访问，浏览器不会发送会话 Cookie（表现成「登录后立刻掉线」）');
  }
  return w;
}

/* 启动横幅用：不打印密钥本身，只说明来源 */
config.describe = () => ({
  env: config.env,
  authMode: config.auth.mode,
  secretSource: config.auth.secretSource,
  llm: config.llm.url ? 'llm' : 'rule',
  db: config.db.file,
  allowReset: config.admin.allowReset,
});

module.exports = { config, validate, warnings };
