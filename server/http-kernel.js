/* ===========================================================
   L0/L1 · HTTP 内核（http-kernel）
   职责：所有「与业务无关」的协议层工作，一次写完，路由层不再重复。
     · requestId 生成与贯穿（响应头 + 日志 + 审计）
     · 安全响应头 / CORS（本地开发白名单）
     · 令牌桶限流（登录接口单独一档，防暴力破解）
     · 请求体读取（带大小上限）+ memo 化（避免「body 未消费 → 连接被 RST」）
     · 统一响应形状与错误封装（全部走 errors.js）
     · 结构化访问日志 + 指标打点
     · 声明式路由匹配 + 权限标注
     · 静态资源托管（含目录穿越防护）
     · 优雅关闭

   为什么把限流放在 L0 而不是 L1：限流是「保护自己」的能力，不是业务规则。
   业务路由不应该有机会忘记给自己加限流。

   ⚠️ 一个必须记住的历史教训（ADR-005）：node:sqlite 在 Windows 上每条语句 fsync，
   所以**请求路径上的写操作要尽可能少**。last_seen_at 的节流写、日志落盘用流式追加，
   都是这条教训的产物。
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config.js');
const { logger } = require('./logger.js');
const metrics = require('./metrics.js');
const { AppError, toResponse } = require('./errors.js');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

/* ===========================================================
   令牌桶限流
   =========================================================== */
const buckets = new Map();
function take(key, { capacity, refillPerSec }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: capacity, last: now }; buckets.set(key, b); }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens < 1) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / refillPerSec)) };
  }
  b.tokens -= 1;
  return { ok: true };
}
/* 定期清掉长期不活跃的桶，防止内存随 IP 数无限增长 */
const sweepTimer = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of buckets) if (v.last < cutoff) buckets.delete(k);
}, 5 * 60 * 1000);
sweepTimer.unref?.();

/* ===========================================================
   路由表
   =========================================================== */
function createRouter() {
  const routes = [];
  const add = (method, pattern, policy, handler) => {
    /* 支持 '/api/jobs/:id' 形式的路径参数 */
    const segs = pattern.split('/').filter(Boolean);
    routes.push({ method, pattern, segs, policy: policy || {}, handler });
  };
  const api = {
    routes,
    get:  (p, pol, h) => add('GET', p, pol, typeof pol === 'function' ? pol : h),
    post: (p, pol, h) => add('POST', p, pol, typeof pol === 'function' ? pol : h),
    put:  (p, pol, h) => add('PUT', p, pol, typeof pol === 'function' ? pol : h),
    del:  (p, pol, h) => add('DELETE', p, pol, typeof pol === 'function' ? pol : h),
    /** 原始注册：允许一个 handler 处理多方法 */
    any:  (methods, p, pol, h) => methods.forEach(m => add(m, p, pol, h)),
    match(method, pathname) {
      const parts = pathname.split('/').filter(Boolean);
      let pathMatched = false;
      for (const r of routes) {
        if (r.segs.length !== parts.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < r.segs.length; i++) {
          const s = r.segs[i];
          if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(parts[i]);
          else if (s !== parts[i]) { ok = false; break; }
        }
        if (!ok) continue;
        pathMatched = true;
        if (r.method === method) return { route: r, params };
      }
      return pathMatched ? { methodMismatch: true } : null;
    },
  };
  return api;
}

/* ===========================================================
   请求体读取
   ---------------------------------------------------------------
   超限时**不要 req.destroy()**：直接把连接掐断会让客户端在「正在上传」的过程中
   收到 RST，表现成 `fetch failed / ECONNRESET`，而不是一个可读的 413。
   正确做法是继续把数据读完但**丢弃**（drain），让请求正常走到 end，
   再返回 413 —— 客户端才能拿到「太大了」这个明确结论。
   为防止病态上传把内存/带宽吃干，超过上限 8 倍时仍强制断开。
   =========================================================== */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, overflow = false;
    let chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        if (!overflow) { overflow = true; chunks = []; }   // 丢已缓冲内容，控制内存
        if (size > limit * 8) { req.destroy(); return; }    // 病态上传：放弃
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (overflow) {
        return reject(new AppError('PAYLOAD_TOO_LARGE', `请求体超过上限 ${Math.round(limit / 1024 / 1024)}MB`));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/x-www-form-urlencoded')) {
        return resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new AppError('BAD_REQUEST', '请求体不是合法 JSON')); }
    });
    req.on('aborted', () => reject(new AppError('BAD_REQUEST', '客户端中断了请求')));
    req.on('error', reject);
  });
}

/* ===========================================================
   内核
   ===========================================================
   @param {object} deps
     deps.router      路由表（routes.js 构建）
     deps.authenticate(req) → { ctx, user, session } | null
     deps.onAuthFail(err, rc) → 可选钩子（写审计用）
     deps.publicPaths Set<string>  免鉴权路径
   =========================================================== */
function createKernel(deps) {
  const { router } = deps;
  const PUBLIC = deps.publicPaths || new Set(['/api/health', '/api/auth/login']);

  /** 允许的来源：同源（无 Origin 头）+ 本机开发端口 */
  function corsOrigin(origin) {
    if (!origin) return null;
    if (origin === 'null') return 'null';                       // file:// 打开的单文件原型
    try {
      const u = new URL(origin);
      if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return origin;
    } catch { /* 非法 Origin 一律拒绝 */ }
    return null;
  }

  function applyCommonHeaders(res, requestId, origin) {
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }

  function json(res, code, payload, extraHeaders) {
    const body = JSON.stringify(payload);
    res.writeHead(code, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    }, extraHeaders || {}));
    res.end(body);
  }

  async function handle(req, res) {
    const t0 = Date.now();
    const requestId = String(req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex'));
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = (req.method || 'GET').toUpperCase();
    const origin = corsOrigin(req.headers.origin);
    const ip = (req.socket && req.socket.remoteAddress) || '';
    const log = logger.bind({ requestId, method, path: pathname });
    let identity = 'anon';
    let statusForLog = 500;

    applyCommonHeaders(res, requestId, origin);

    /* --- CORS 预检 --- */
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-Id,X-User',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }

    /* --- 请求体：进入 API 时立刻挂上读取 Promise（memo 化）
           漏掉这一步就会「body 未消费 → 连接被销毁 → 下一个请求 ECONNRESET」 --- */
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const bodyPromise = hasBody
      ? readBody(req, config.http.maxBodyBytes).catch(e => { throw e; })
      : Promise.resolve({});
    /* 未被 handler 消费时也要 drain，避免连接被 RST */
    bodyPromise.catch(() => {});
    let bodyConsumed = false;

    try {
      if (!pathname.startsWith('/api/')) {
        return await serveStatic(req, res, pathname, method);
      }

      /* --- 限流：登录档 vs 通用档 --- */
      if (config.rateLimit.enabled) {
        const isLogin = pathname === '/api/auth/login';
        const cfg = isLogin ? config.rateLimit.login : config.rateLimit.api;
        const key = isLogin ? `login:${ip}:${(await safeIpBody(bodyPromise, pathname))}` : `api:${ip}`;
        const r = take(key, cfg);
        if (!r.ok) {
          metrics.inc('http.ratelimited');
          statusForLog = 429;
          return json(res, 429, { ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }, requestId },
            { 'Retry-After': String(r.retryAfter) });
        }
      }

      const m = router.match(method, pathname);
      if (!m) {
        statusForLog = 404;
        return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' }, requestId });
      }
      if (m.methodMismatch) {
        statusForLog = 405;
        return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不被允许' }, requestId });
      }
      const { route, params } = m;

      /* --- 鉴权（功能级权限的第一道闸门） --- */
      let auth = null;
      const isPublic = PUBLIC.has(pathname) || route.policy.public === true;
      if (deps.authenticate) {
        auth = deps.authenticate(req);         // strict 模式：只认会话；legacy：认 X-User
      }
      if (!isPublic) {
        if (!auth) {
          statusForLog = 401;
          if (deps.onUnauthenticated) deps.onUnauthenticated({ pathname, method, ip, requestId });
          return json(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED', message: '未登录或会话已失效，请重新登录' }, requestId });
        }
        identity = auth.ctx.userId;
        const need = route.policy.need;
        if (need && !require('./rbac.js').can(auth.ctx, need)) {
          statusForLog = 403;
          if (deps.onForbidden) deps.onForbidden(auth, { pathname, method, need, requestId, ip });
          /* 文案必须区分「功能级」与「行级」两种 403 ——
             这里是**功能级**：这个动作对你的角色就没有开放。
             行级拒绝（记录不在你的数据范围内）由 routes.js 的 denyScope 返回，措辞不同。
             原来两种都写「数据范围权限不足」，排查时会往错的方向找。 */
          return json(res, 403, {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: `403：你的角色（${auth.ctx.role}）没有执行该操作所需的能力「${need}」，此功能未对你的角色开放`,
              details: { level: 'ability', need, role: auth.ctx.role },
            },
            requestId,
          });
        }
      } else if (auth) {
        identity = auth.ctx.userId;
      }

      /* --- 构造请求上下文 --- */
      const cookies = [];
      const rc = {
        requestId, method, pathname, url, params,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        ip, log, auth,
        user: auth ? auth.user : null,
        ctx: auth ? auth.ctx : null,
        async body() { bodyConsumed = true; return bodyPromise; },
        json(code, payload, headers) { statusForLog = code; return json(res, code, payload, headers); },
        ok(payload) { return rc.json(200, Object.assign({ ok: true }, payload)); },
        setCookie(name, value, opts) {
          cookies.push(require('./security.js').serializeCookie(name, value, opts));
          res.setHeader('Set-Cookie', cookies);
        },
        clearCookie(name) { rc.setCookie(name, '', { maxAge: 0 }); },
      };

      const out = await route.handler(rc);
      if (!res.writableEnded) {
        /* handler 未显式返回响应 → 视为 204 */
        statusForLog = 204;
        res.writeHead(204, { 'Set-Cookie': cookies.length ? cookies : undefined });
        res.end();
      }
      return out;
    } catch (err) {
      const { http, body, isExpected } = toResponse(err, requestId);
      statusForLog = http;
      if (isExpected) {
        log.warn('请求被拒绝', { code: body.error.code, msg: body.error.message });
      } else {
        log.error('未处理异常', { err: err && err.message, stack: err && err.stack });
      }
      if (!res.writableEnded) return json(res, http, body);
    } finally {
      /* body 始终 drain（无论 handler 有没有读） —— 见上方注释 */
      if (!bodyConsumed && hasBody) { try { await bodyPromise; } catch { /* 忽略 */ } }
      const ms = Date.now() - t0;
      const isErr = statusForLog >= 500;
      metrics.observe(ms, isErr);
      log.info('http', { status: statusForLog, ms, ip, user: identity });
    }
  }

  /** 登录限流的 key 需要到 body 里取账号，但不能因为读 body 出错而 500 */
  async function safeIpBody(p, pathname) {
    try { const b = await p; return String(b && (b.identifier || b.username) || '-').slice(0, 40); }
    catch { return '-'; }
  }

  /* ---------- 静态资源 ---------- */
  async function serveStatic(req, res, pathname, method) {
    if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(config.staticRoot, rel));
    if (!file.startsWith(config.staticRoot)) {           // 目录穿越防护
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('forbidden');
    }
    return new Promise(resolve => {
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('404: ' + pathname);
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        if (method === 'HEAD') return res.end();
        res.end(data);
        resolve();
      });
    });
  }

  return { handle, json, take, buckets };
}

module.exports = { createRouter, createKernel, MIME };
