/* ===========================================================
   横切 · 安全原语（security）
   职责：只做「密码」与「令牌」两件事的底层实现，不含任何业务语义。

   为什么单独成文件：这两个是**安全关键代码**，一旦写错（比如用 == 比较哈希、
   把盐固定、把令牌原文存库）就是全盘失守。集中在一处便于审查与替换算法。

   ① 口令存储：scrypt（Node 内置）而非明文/单轮哈希
      - 每用户独立随机盐（16B）
      - 存储串自带参数：`scrypt$N$r$p$salt$hash` —— 未来换参数也能校验老密码
      - 比较用 timingSafeEqual，防时序侧信道
      - 注：ADR 原定 Argon2id，因需原生模块与「零依赖」冲突而降级为 scrypt。
        替换点只在 hashPassword / verifyPassword 两个函数。

   ② 会话令牌：HMAC-SHA256 签名的自包含令牌 + 服务端会话记录
      - 令牌本身不加密（只签名），**因此绝不放敏感信息**，只放 sid / uid / tid / exp
      - 服务端 sessions 表记 sid，用于**主动吊销**（登出 / 强制下线）
        —— 纯 JWT 无法吊销，这是本设计相对纯 JWT 的关键改进
      - 库里只存令牌指纹（sha256），不存令牌原文：库被读走也无法直接冒充
   =========================================================== */
'use strict';
const crypto = require('crypto');
const { config } = require('./config.js');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s), 'base64url');

/* ---------- ① 口令 ---------- */
const ALGO = 'scrypt';

function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('口令强度不足：至少 8 位');
  }
  const { N, r, p, keyLen, saltLen } = config.auth.scrypt;
  const salt = crypto.randomBytes(saltLen);
  const dk = crypto.scryptSync(plain, salt, keyLen, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return [ALGO, N, r, p, b64u(salt), b64u(dk)].join('$');
}

function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== ALGO) return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = fromB64u(saltB64);
  const expected = fromB64u(hashB64);
  let actual;
  try {
    actual = crypto.scryptSync(plain, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  } catch { return false; }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** 定时攻击安全的等长比较（哈希 / 指纹用） */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------- ② 会话令牌 ---------- */
const seg = s => b64u(Buffer.from(s, 'utf8'));

/** 签发：payload → `body.signature`（两段 base64url） */
function signToken(payload, ttlMs = config.auth.sessionTtlMs) {
  const iat = Date.now();
  const body = seg(JSON.stringify({ ...payload, iat, exp: iat + ttlMs }));
  const sig = b64u(crypto.createHmac('sha256', config.auth.secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * 校验：签名合法 + 未过期才返回 payload，否则 null。
 * 注意顺序 —— **先验签名再解析内容**，避免把未验证的数据当输入。
 */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const expect = b64u(crypto.createHmac('sha256', config.auth.secret).update(body).digest());
  if (!safeEqual(sig, expect)) return null;
  let p;
  try { p = JSON.parse(fromB64u(body).toString('utf8')); } catch { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  return p;
}

/** 令牌指纹：库里只存这个，不存原文 */
const tokenFingerprint = token => crypto.createHash('sha256').update(String(token)).digest('hex');

/* ---------- ③ Cookie ---------- */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i < 1) return;
    const k = pair.slice(0, i).trim();
    let v = pair.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* 非法编码保留原值 */ }
    if (k) out[k] = v;
  });
  return out;
}

function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure ?? config.auth.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

/* ---------- ④ 生成器 ---------- */
const randomId = (prefix = '') => prefix + crypto.randomBytes(12).toString('base64url');
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { hashPassword, verifyPassword, safeEqual, signToken, verifyToken, tokenFingerprint, parseCookies, serializeCookie, randomId, randomToken, ALGO };
