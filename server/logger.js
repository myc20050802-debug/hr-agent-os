/* ===========================================================
   横切 · 结构化日志（logger）
   职责：输出**机器可解析**的 JSON 行日志，并携带 requestId 贯穿整条链路。

   为什么不用 console.log 字符串拼接：
   日志一旦不是结构化的，「按 requestId 捞出一次请求的全部日志」就只能靠 grep，
   且无法做「错误率 / 延迟分位」这类指标。本项目要演示「可观测」，第一步就是日志结构化。

   同时提供：
   - 敏感字段自动脱敏（password / token / cookie 永不落日志）
   - 子 logger（bind）：把 requestId / userId 一次性绑定，后续每行自动带上
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { config } = require('./config.js');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const threshold = LEVELS[config.log.level] ?? LEVELS.info;

/* 永不落日志的键名（含子串匹配，覆盖 authorization / set-cookie 等） */
const REDACT_KEYS = ['password', 'passwd', 'token', 'secret', 'cookie', 'authorization', 'credential', 'apikey', 'api_key'];

function redact(value, depth = 0) {
  if (depth > 4) return '[deep]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const low = k.toLowerCase();
    out[k] = REDACT_KEYS.some(r => low.includes(r)) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

let fileStream = null;
function ensureStream() {
  if (fileStream || !config.log.file) return fileStream;
  try {
    fs.mkdirSync(path.dirname(config.log.file), { recursive: true });
    fileStream = fs.createWriteStream(config.log.file, { flags: 'a' });
    fileStream.on('error', () => { fileStream = null; });   // 落盘失败不影响服务
  } catch { fileStream = null; }
  return fileStream;
}

const nowISO = () => new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 23) + '+08:00';

function emit(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const rec = Object.assign({ t: nowISO(), level, msg }, redact(fields || {}));
  let line = JSON.stringify(rec);
  if (config.log.pretty) {
    const { t, level: lv, msg: m, ...rest } = rec;
    line = `${t} ${lv.toUpperCase().padEnd(5)} ${m} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`.trim();
  }
  process.stdout.write(line + '\n');
  const st = ensureStream();
  if (st) { try { st.write(line + '\n'); } catch { /* 忽略落盘异常 */ } }
}

function make(base = {}) {
  return {
    debug: (msg, f) => emit('debug', msg, { ...base, ...f }),
    info:  (msg, f) => emit('info',  msg, { ...base, ...f }),
    warn:  (msg, f) => emit('warn',  msg, { ...base, ...f }),
    error: (msg, f) => emit('error', msg, { ...base, ...f }),
    /** 派生子 logger：把 requestId / userId 等上下文一次性绑上去 */
    bind: (extra) => make({ ...base, ...extra }),
  };
}

module.exports = { logger: make(), redact, LEVELS };
