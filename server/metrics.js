/* ===========================================================
   横切 · 指标采集（metrics）
   职责：为「可观测」提供最小可用的一手数据 —— 请求量、延迟分位、错误率、
        Agent 任务数、越权拦截数、模型调用与成本。

   为什么用固定桶而不是滑动窗口：单进程演示场景下，固定桶（按分钟滚动 60 个槽）
   足够回答「错误率多少 / P95 多少」，且内存恒定、无锁、零依赖。
   上真实生产应换 Prometheus + Histogram，但**接口形状保持一致**（/api/metrics
   返回同一组键），换实现不改调用方。
   =========================================================== */
'use strict';
const { config } = require('./config.js');

const WINDOW_SLOTS = 60;           // 60 个 1 分钟槽
const started = Date.now();

/** 延迟直方图边界（ms）：P50/P90/P95/P99 都从这组桶里插值 */
const BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];

const counters = new Map();        // name -> number
const perMinute = [];              // [{minute, req, err, sumMs, hist[]}]
const hist = new Array(BUCKETS.length).fill(0);

let curMinute = Math.floor(Date.now() / 60000);
let cur = { req: 0, err: 0, sumMs: 0 };

function slot() {
  const m = Math.floor(Date.now() / 60000);
  if (m !== curMinute) {
    perMinute.push(Object.assign({ minute: curMinute }, cur));
    while (perMinute.length > WINDOW_SLOTS) perMinute.shift();
    curMinute = m;
    cur = { req: 0, err: 0, sumMs: 0 };
  }
  return cur;
}

function inc(name, delta = 1) { counters.set(name, (counters.get(name) || 0) + delta); }

function observe(ms, isError) {
  const c = slot();
  c.req++;
  c.sumMs += ms;
  if (isError) c.err++;
  const i = BUCKETS.findIndex(b => ms <= b);
  hist[i < 0 ? BUCKETS.length - 1 : i]++;
}

/** 从直方图插值分位（够用即可；不是精确分位，但单调且稳定） */
function quantile(q) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return BUCKETS[i] === Infinity ? BUCKETS[i - 1] : BUCKETS[i];
  }
  return BUCKETS[BUCKETS.length - 2];
}

const snapshot = () => {
  const live = perMinute.concat([Object.assign({ minute: curMinute }, cur)]);
  const req = live.reduce((a, x) => a + x.req, 0);
  const err = live.reduce((a, x) => a + x.err, 0);
  const sumMs = live.reduce((a, x) => a + x.sumMs, 0);
  return {
    uptimeSec: Math.round((Date.now() - started) / 1000),
    requests: req,
    errors: err,
    errorRate: req ? +(err / req * 100).toFixed(2) : 0,
    avgMs: req ? +(sumMs / req).toFixed(1) : 0,
    latencyMs: { p50: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95), p99: quantile(0.99) },
    series: live.slice(-15).map(x => ({ minute: new Date(x.minute * 60000 + 8 * 3600e3).toISOString().slice(11, 16), req: x.req, err: x.err })),
    counters: Object.fromEntries([...counters.entries()].sort()),
    limits: { rateLimit: config.rateLimit.enabled },
  };
};

module.exports = { inc, observe, snapshot, BUCKETS };
