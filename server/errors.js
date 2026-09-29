/* ===========================================================
   横切 · 错误契约（errors）
   职责：定义**全站统一的错误形状**，让前端只需处理一种错误结构。

   统一响应契约：
     成功 → { ok: true,  data: {...}, requestId }
     失败 → { ok: false, error: { code, message, details? }, requestId }

   为什么需要 requestId：用户报障时只说「刚才保存失败」是没法定位的；
   把 requestId 返回给前端并同时写进日志，一条 ID 就能拉出完整链路。

   错误分两类：
   - AppError：**预期内**的业务错误（404 / 403 / 参数错），有明确 code 与 HTTP 码。
   - 其他异常：**非预期**，一律收敛为 500 internal，且**不把堆栈返回给客户端**
     （堆栈只进日志）—— 这是最基本的信息泄露防护。
   =========================================================== */
'use strict';

/* 错误码表：code 是对机器的契约，message 是对人的说明。前端只依赖 code。 */
const CODES = {
  BAD_REQUEST:        { http: 400, message: '请求参数不合法' },
  UNAUTHENTICATED:    { http: 401, message: '未登录或会话已失效，请重新登录' },
  FORBIDDEN:          { http: 403, message: '数据范围权限不足' },
  NOT_FOUND:          { http: 404, message: '资源不存在' },
  METHOD_NOT_ALLOWED: { http: 405, message: '请求方法不被允许' },
  CONFLICT:           { http: 409, message: '资源状态冲突' },
  PAYLOAD_TOO_LARGE:  { http: 413, message: '请求体过大' },
  UNPROCESSABLE:      { http: 422, message: '请求可解析但语义不合法' },
  RATE_LIMITED:       { http: 429, message: '请求过于频繁，请稍后再试' },
  INTERNAL:           { http: 500, message: '服务内部错误' },
  UPSTREAM:           { http: 502, message: '上游依赖不可用' },
  UNAVAILABLE:        { http: 503, message: '服务暂不可用' },
};

class AppError extends Error {
  /**
   * @param {string} code    CODES 中的键
   * @param {string} [message] 覆盖默认说明（面向用户，勿含内部细节）
   * @param {object} [opts]   { details, cause, exposed }
   */
  constructor(code, message, opts = {}) {
    const def = CODES[code] || CODES.INTERNAL;
    super(message || def.message);
    this.name = 'AppError';
    this.code = CODES[code] ? code : 'INTERNAL';
    this.http = def.http;
    this.details = opts.details;
    this.exposed = opts.exposed !== false;   // 是否可安全返回给客户端
    if (opts.cause) this.cause = opts.cause;
    Error.captureStackTrace?.(this, AppError);
  }
}

/* 便捷构造器：让调用点读起来像业务语言，而不是 new AppError('X', 'Y') */
const badRequest = (msg, details) => new AppError('BAD_REQUEST', msg, { details });
const unauthenticated = (msg) => new AppError('UNAUTHENTICATED', msg);
const forbidden = (msg, details) => new AppError('FORBIDDEN', msg, { details });
const notFound = (msg) => new AppError('NOT_FOUND', msg);
const conflict = (msg) => new AppError('CONFLICT', msg);
const rateLimited = (msg) => new AppError('RATE_LIMITED', msg);
const rateLimited429 = rateLimited;

/**
 * 把任意异常收敛成统一错误体。
 * @returns {{ http:number, body:object, isExpected:boolean }}
 */
function toResponse(err, requestId) {
  const isApp = err instanceof AppError;
  const http = isApp ? err.http : (Number(err?.status) || 500);
  const code = isApp ? err.code : (http >= 500 ? 'INTERNAL' : 'BAD_REQUEST');
  const body = {
    ok: false,
    error: {
      code,
      message: isApp ? err.message : (http >= 500 ? CODES.INTERNAL.message : String(err?.message || CODES.BAD_REQUEST.message)),
    },
    requestId,
  };
  if (isApp && err.details !== undefined) body.error.details = err.details;
  return { http, body, isExpected: isApp && http < 500 };
}

module.exports = { AppError, CODES, toResponse, badRequest, unauthenticated, forbidden, notFound, conflict, rateLimited, rateLimited429 };
