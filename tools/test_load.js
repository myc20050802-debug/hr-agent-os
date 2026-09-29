#!/usr/bin/env node
/**
 * HR-Agent OS · 并发压测（记录 P95 / P99）
 * -----------------------------------------------------------
 * 为什么需要它：在此之前项目只能证明「功能对」，没法回答
 * 「20 个人同时用会不会卡」。而这是一个**单进程 + 单写者**的本地服务，
 * 并发能力天生有限 —— 与其含糊地说「够用」，不如把数字量出来贴在墙上。

 * 三个阶段：
 *   ① 纯读   /api/bootstrap + /api/audit + /api/metrics/agreement
 *   ② 纯写   POST /api/candidates/:id/override（一次 UPDATE + 一条审计）
 *   ③ 读写混合 —— 这一阶段才是 WAL 存在的意义：
 *             读请求不应被写请求阻塞，否则「读不阻塞写」就只是一句宣传语。

 * 口径说明（写清楚，避免数字被误读）：
 *   - 延迟 = 从发起请求到收到响应的墙钟时间，**含 Node 单线程排队时间**。
 *     并发 20 时看到的是「这一批人一起用」的体感，不是单请求的服务时间。
 *   - 阈值故意放宽（本地机器差异大）。本套件的价值在于：
 *     ① 出现 P99 尾延迟异常时能立刻看见；② 阶段③ 一旦出现 5xx 就说明并发有坑。
 *   - 机器是笔记本还是台式机差异很大，所以断言只兜底、不卡死，数字以打印为准。

 * 用法：BASE=http://127.0.0.1:8788 node tools/test_load.js
 *       经一键回归（单独跑，不混进 npm test）：node tools/run_all.js --only load
 * 可调：LOAD_READS / LOAD_WRITES / LOAD_MIXED / LOAD_CONC
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const PW = process.env.DEMO_PASSWORD || 'Demo@2026';

const N_READ = Number(process.env.LOAD_READS || 240);
const N_WRITE = Number(process.env.LOAD_WRITES || 40);
const N_MIXED = Number(process.env.LOAD_MIXED || 120);
const CONC = Number(process.env.LOAD_CONC || 20);

let pass = 0;
const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
};
const section = t => console.log('\n=== ' + t + ' ===');

let cookie = '';
async function req(method, url, body) {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; ');
  return { ok: r.ok, status: r.status, url: method + ' ' + url, json: async () => r.json() };
}

/* ---------- 延迟统计 ---------- */
const q = (sorted, p) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
};
function summarize(lat) {
  const s = lat.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: q(s, 0), p50: q(s, 50), p90: q(s, 90), p95: q(s, 95), p99: q(s, 99),
    max: s.length ? s[s.length - 1] : 0,
    mean: s.length ? Math.round(sum / s.length) : 0,
  };
}

/** 固定并发的工作池：conc 个 worker 抢 n 个任务（模拟「一批人同时点」） */
async function runPool({ label, n, conc, fn }) {
  const t0 = Date.now();
  const lat = [], errs = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const k = next++;
      if (k >= n) return;
      const s = Date.now();
      try {
        const res = await fn(k);
        lat.push(Date.now() - s);
        if (!res || !res.ok) errs.push((res && res.status) + ' ' + (res && res.url));
      } catch (e) { errs.push('EXC ' + (e && e.message)); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, n)) }, worker));
  const wall = Date.now() - t0;
  const st = summarize(lat);
  const line = `  ${label.padEnd(10)} n=${String(n).padStart(4)} 并发=${String(conc).padStart(3)}  `
    + `P50 ${String(st.p50).padStart(4)}ms  P90 ${String(st.p90).padStart(4)}ms  `
    + `P95 ${String(st.p95).padStart(4)}ms  P99 ${String(st.p99).padStart(4)}ms  `
    + `max ${String(st.max).padStart(5)}ms  吞吐 ${(n / (wall / 1000)).toFixed(1)} req/s  错误 ${errs.length}`;
  console.log(line);
  return { label, n, conc, wallMs: wall, rps: Number((n / (wall / 1000)).toFixed(1)), stats: st, errs };
}

(async () => {
  console.log('HR-Agent OS · 并发压测');
  console.log('目标 ' + BASE + ' · 并发 ' + CONC + '（读 ' + N_READ + ' / 写 ' + N_WRITE + ' / 混合 ' + N_MIXED + '）');

  const login = await req('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
  if (!login.ok) {
    console.error('✗ 登录失败（' + login.status + '）—— 请确认后端已启动：BASE 是否正确？');
    process.exit(2);
  }

  /* 预热：首请求要编译 SQL、填满 JD 自愈缓存，计进指标会失真 */
  for (let i = 0; i < 5; i++) await req('GET', '/api/bootstrap');

  const boot = await (await req('GET', '/api/bootstrap')).json();
  const candIds = (boot.candidates || []).map(c => c.id);
  if (!candIds.length) { console.error('✗ 库里没有候选人，先初始化数据'); process.exit(2); }
  const health0 = await (await req('GET', '/api/health')).json();

  section('① 纯读（bootstrap / audit / 一致率）');
  const READ_PATHS = ['/api/bootstrap', '/api/audit?limit=50', '/api/metrics/agreement', '/api/jobs', '/api/offers'];
  const reads = await runPool({
    label: '读', n: N_READ, conc: CONC,
    fn: k => req('GET', READ_PATHS[k % READ_PATHS.length]),
  });

  section('② 纯写（人工确认：UPDATE + 审计各一条）');
  const writes = await runPool({
    label: '写', n: N_WRITE, conc: Math.max(1, Math.min(10, CONC)),
    fn: k => req('POST', '/api/candidates/' + candIds[k % candIds.length] + '/override', { decision: 'confirmed' }),
  });

  section('③ 读写混合（WAL 的意义所在：读不应被写阻塞）');
  const mixed = await runPool({
    label: '混合', n: N_MIXED, conc: CONC,
    fn: k => (k % 3 === 0)
      ? req('POST', '/api/candidates/' + candIds[k % candIds.length] + '/override', { decision: 'confirmed' })
      : req('GET', READ_PATHS[k % READ_PATHS.length]),
  });

  const health1 = await (await req('GET', '/api/health')).json();
  section('数据库现场（WAL 体积 / checkpoint 是否在动）');
  const fmt = b => (b / 1024).toFixed(1) + ' KB';
  console.log('  journal_mode     ' + (health1.wal && health1.wal.journalMode));
  console.log('  主库 dbBytes     ' + fmt(health1.wal ? health1.wal.dbBytes : 0));
  console.log('  WAL  walBytes    ' + fmt(health1.wal ? health1.wal.walBytes : 0)
    + '（压测前 ' + fmt(health0.wal ? health0.wal.walBytes : 0) + '）');
  console.log('  shm  shmBytes    ' + fmt(health1.wal ? health1.wal.shmBytes : 0));
  console.log('  说明：WAL 未无限增长即说明 autocheckpoint 在工作；关闭服务时会 TRUNCATE 归零。');

  /* ---------- 断言（兜底，不卡死） ---------- */
  section('判定');
  ok('阶段① 纯读无错误', reads.errs.length === 0, reads.errs.slice(0, 3).join(' | '));
  ok('阶段② 纯写无错误', writes.errs.length === 0, writes.errs.slice(0, 3).join(' | '));
  ok('阶段③ 混合无错误（读未被写阻塞到报错）', mixed.errs.length === 0, mixed.errs.slice(0, 3).join(' | '));
  ok('读 P95 < 800ms', reads.stats.p95 < 800, reads.stats.p95 + 'ms');
  ok('写 P95 < 1200ms', writes.stats.p95 < 1200, writes.stats.p95 + 'ms');
  ok('混合 P95 < 1200ms', mixed.stats.p95 < 1200, mixed.stats.p95 + 'ms');
  ok('读吞吐 > 20 req/s', reads.rps > 20, reads.rps + ' req/s');
  ok('WAL 未失控（< 8MB，autocheckpoint 阈值 4MB）',
    !health1.wal || health1.wal.walBytes < 8 * 1024 * 1024, ((health1.wal || {}).walBytes || 0) + ' bytes');
  ok('/api/health 暴露 WAL 体积（运维可观测）', !!(health1.wal && typeof health1.wal.walBytes === 'number'));

  const report = {
    generatedAt: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' (UTC+8)',
    base: BASE, concurrency: CONC,
    phases: { reads, writes, mixed },
    wal: { before: health0.wal, after: health1.wal },
  };
  try {
    fs.writeFileSync(path.join(ROOT, '_load_result.json'), JSON.stringify(report, null, 2));
    console.log('\n  压测结果已写入 _load_result.json');
  } catch (e) { console.log('  （结果落盘失败：' + e.message + '）'); }

  console.log('\n' + '='.repeat(52));
  if (!fails.length) console.log('全部通过：' + pass + ' 项');
  else { console.log('结果 ' + (pass + fails.length) + ' 项，失败 ' + fails.length + ' 项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
  console.log('='.repeat(52));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('压测异常：' + (e && e.stack || e)); process.exit(2); });
