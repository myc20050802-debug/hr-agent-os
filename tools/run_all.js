#!/usr/bin/env node
/**
 * 一键回归：起一个**隔离实例**（独立端口 + 独立库），把各套件跑一遍并汇总。
 *
 * 为什么要隔离而不是复用 8788：
 *   ① 回归会写数据（跑筛选、批 Offer、重置评分），跑在演示库上会把演示状态打乱；
 *   ② 演示实例可能本来就起着，端口占用会让 `npm test` 直接失败。
 * 隔离实例用 DB_PATH 指向临时目录，跑完即删，演示库毫发无伤。
 *
 * 用法：node tools/run_all.js [--only backend|frontend|all] [--verbose]
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT = Number(process.env.TEST_PORT || 8799);
const BASE = 'http://127.0.0.1:' + PORT;
const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : 'all';
const VERBOSE = argv.includes('--verbose');

const C = { g: '\u001b[32m', r: '\u001b[31m', y: '\u001b[33m', d: '\u001b[2m', x: '\u001b[0m' };

const SUITES = [
  { id: 'auth', kind: 'backend', name: '后端契约（鉴权 / 权限 / 迁移 / 错误契约）', file: 'tools/test_auth.js' },
  { id: 'hiring', kind: 'backend', name: '招聘链路（状态机 / 合规闸门 / 行级隔离）', file: 'tools/test_hiring.js' },
  { id: 'jd', kind: 'backend', name: 'JD 生成口径（原文还原 / 段落化 / 往返无损）', file: 'tools/test_jd.js' },
  { id: 'eval', kind: 'backend', name: '筛选质量评测（一致率 / 漏筛率 / 误筛率）', file: 'tools/test_eval.js' },
  { id: 'screening', kind: 'self', name: '筛选运行（用量真实性 / 可重复运行）', file: 'tools/test_screening.js' },
  { id: 'offline', kind: 'frontend', name: '前端离线渲染与交互（无后端）', file: '平台原型/test_prototype.js' },
  { id: 'live', kind: 'frontend', name: '前端在线渲染与交互（真后端）', file: '平台原型/test_live.js' },
  /* 压测单独一档：它比功能回归慢一个量级，且对机器负载敏感。
     放进默认 npm test 会让「改一行代码等两分钟」，所以只在显式指定时跑：
     node tools/run_all.js --only load */
  { id: 'load', kind: 'load', name: '并发压测（P95 / P99 / 吞吐）', file: 'tools/test_load.js', optIn: true },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasJsdom = () => { try { require.resolve('jsdom'); return true; } catch { return false; } };

let server = null;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-test-'));
const children = [];

function startIsolatedServer() {
  const p = spawn(NODE, ['--experimental-sqlite', 'server.js'], {
    cwd: path.join(ROOT, 'server'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT), HOST: '127.0.0.1',
      DB_PATH: path.join(tmpDir, 'test.db'),
      LOG_LEVEL: 'error',
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(p);
  let err = '';
  p.stderr.on('data', d => { err += d.toString(); });
  return { proc: p, stderr: () => err };
}

async function waitHealth(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* 还没起 */ }
    await sleep(400);
  }
  return false;
}

function runSuite(s) {
  const r = spawnSync(NODE, ['--experimental-sqlite', s.file], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { BASE, DEMO_PASSWORD: process.env.DEMO_PASSWORD || 'Demo@2026' }),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n').filter(l => l && !/ExperimentalWarning|--trace-warnings/.test(l));
  const summary = lines.filter(l => /通过 \d+ 项|全部通过|结果 |失败|✗/.test(l)).slice(-4);
  return { code: r.status === null ? 3 : r.status, summary, lines };
}

(async () => {
  console.log('HR-Agent OS · 一键回归');
  console.log(C.d + '隔离实例 ' + BASE + ' · 临时库 ' + tmpDir + C.x + '\n');

  const jsdom = hasJsdom();
  /* 默认（all）跑功能回归，跳过 optIn 套件；显式 --only load 时才跑压测。 */
  const picked = SUITES.filter(s => (ONLY === 'all' ? !s.optIn : s.kind === ONLY));
  const needServer = picked.some(s => s.kind === 'backend' || s.kind === 'frontend' || s.kind === 'load');

  if (needServer) {
    server = startIsolatedServer();
    const okHealth = await waitHealth();
    if (!okHealth) {
      console.error(C.r + '✗ 隔离实例未能在 30s 内就绪' + C.x);
      const e = server.stderr().trim();
      if (e) console.error(C.d + e.split('\n').slice(-12).join('\n') + C.x);
      children.forEach(p => p.kill('SIGKILL'));
      process.exit(2);
    }
    console.log('  ' + C.g + '✓' + C.x + ' 隔离实例已就绪\n');
  }

  const results = [];
  for (const s of picked) {
    if (s.kind === 'frontend' && !jsdom) {
      console.log('  ' + C.y + '−' + C.x + ' ' + s.name + C.d + '（跳过：未安装 jsdom，npm i -D jsdom）' + C.x);
      results.push({ s, skipped: true });
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, s.file))) {
      console.log('  ' + C.y + '−' + C.x + ' ' + s.name + C.d + '（跳过：' + s.file + ' 不存在）' + C.x);
      results.push({ s, skipped: true });
      continue;
    }
    process.stdout.write('  … ' + s.name + '\r');
    const r = runSuite(s);
    const ok = r.code === 0;
    console.log('  ' + (ok ? C.g + '✓' : C.r + '✗') + C.x + ' ' + s.name);
    if (!ok || VERBOSE) {
      const show = VERBOSE ? r.lines : r.summary;
      show.forEach(l => console.log('      ' + (VERBOSE ? C.d : C.r) + l + C.x));
    }
    results.push({ s, ok, code: r.code });
  }

  const ran = results.filter(x => !x.skipped);
  const bad = ran.filter(x => !x.ok);
  const skipped = results.filter(x => x.skipped).length;

  console.log('\n' + '='.repeat(52));
  if (!bad.length) {
    console.log(C.g + '全部通过' + C.x + '：' + ran.length + ' 套件'
      + (skipped ? '，' + skipped + ' 套件跳过' : ''));
  } else {
    console.log(C.r + '有失败' + C.x + '：' + bad.length + '/' + ran.length + ' 套件未通过');
    bad.forEach(x => console.log('  · ' + x.s.name + '（退出码 ' + x.code + '）'));
  }
  console.log('='.repeat(52));

  children.forEach(p => { try { p.kill('SIGKILL'); } catch { /* 已退出 */ } });
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 文件锁，交给系统 */ }
  process.exit(bad.length ? 1 : 0);
})().catch(e => {
  console.error('运行器异常：' + (e && e.stack || e));
  children.forEach(p => { try { p.kill('SIGKILL'); } catch { /* 忽略 */ } });
  process.exit(2);
});
