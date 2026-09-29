#!/usr/bin/env node
/* ===========================================================
   tools/test_devup.js · 「打开项目就在线」这条链路的验收
   ---------------------------------------------------------------
   被测对象是三个东西，缺一个这条链路就不成立：
     ① tools/dev-up.js   —— 幂等启动（已在跑就不启第二个实例）
     ② server 的 CORS 白名单 —— 让 file:// / 预览面板 能探测到本机后端
     ③ 项目级 SessionStart hook（.workbuddy/settings.json）—— 接线没被删掉

   为什么必须自动化：这三处任何一处悄悄失效，症状都只是「原型又变回离线」，
   不会报错、不会崩，靠人肉发现不了。
   =========================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const OUT = path.join(ROOT, '_test_devup.txt');

const lines = [];
const log = (...a) => lines.push(a.map(x => String(x)).join(' '));
let pass = 0, fail = 0;
const ok = m => { pass++; log('  ✓ ' + m); };
const bad = m => { fail++; log('  ✗ ' + m); };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 找一个空闲端口（不写死，避免和开发机上跑着的服务撞车） */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/** 统计监听某端口的进程数（用于断言「没有起第二个实例」） */
function countListeners(port) {
  try {
    const win = process.platform === 'win32';
    const r = spawnSync(win ? 'netstat' : 'ss', win ? ['-ano'] : ['-ltn'], { encoding: 'utf8' });
    const re = new RegExp('[:.]' + port + '\\b');
    return (r.stdout || '').split('\n').filter(l => /LISTENING|LISTEN/.test(l) && re.test(l)).length;
  } catch { return -1; }
}

function runDevUp(port, dbPath) {
  const r = spawnSync(NODE, [path.join(ROOT, 'tools', 'dev-up.js'), '--port', String(port), '--json', '--wait', '15000'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 40000,
    env: Object.assign({}, process.env, { PORT: String(port), DB_PATH: dbPath, LOG_LEVEL: 'error' }),
  });
  const line = (r.stdout || '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* 解析失败按 null 处理 */ }
  return { raw: (r.stdout || '') + (r.stderr || ''), json: parsed, code: r.status };
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-devup-'));
  const dbPath = path.join(tmpDir, 'devup.db');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let pid = null;

  log('HR-Agent OS · 「打开项目即在线」链路验收');
  log(`临时端口 ${port} · 临时库 ${tmpDir}\n`);

  try {
    /* ---------- ① 首次启动：应该真的拉起来 ---------- */
    log('① tools/dev-up.js 幂等启动');
    const first = runDevUp(port, dbPath);
    if (first.json && first.json.started === true && first.json.pid) {
      pid = first.json.pid;
      ok(`首次调用启动了后端（pid ${pid}）`);
    } else {
      bad('首次调用没有启动后端：' + first.raw.trim().slice(0, 300));
    }
    if (first.json && first.json.health && first.json.health.ok) {
      ok(`/api/health 就绪（schema v${first.json.health.schemaVersion} · ${first.json.health.mode} 模式）`);
    } else {
      bad('健康检查未通过');
    }
    if (first.code === 0) ok('退出码 0（便利设施不该阻断会话启动）'); else bad('退出码 ' + first.code + '，应为 0');

    /* ---------- ② 二次调用：必须识别出「已在运行」，不能起第二个实例 ---------- */
    const second = runDevUp(port, dbPath);
    if (second.json && second.json.started === false && second.json.reason === 'already-running') {
      ok('二次调用识别为 already-running（没有起第二个实例）');
    } else {
      bad('二次调用行为不对：' + JSON.stringify(second.json));
    }
    /* 直连计数：监听该端口的进程只应有 1 个 */
    const listeners = countListeners(port);
    if (listeners === 1) ok(`端口 ${port} 只有 1 个监听者`); else bad(`端口 ${port} 有 ${listeners} 个监听者（应唯一）`);

    /* ---------- ③ CORS：跨源探测必须可行，但不能对外站开口 ---------- */
    log('\n③ CORS 白名单（决定 file:// 与预览面板能否发现后端）');
    const corsCases = [
      ['http://127.0.0.1:29815', 'http://127.0.0.1:29815', '预览面板（本机任意端口）'],
      ['null', 'null', 'file:// 双击打开'],
      ['http://evil.example', null, '外部站点（必须拿不到 ACAO）'],
    ];
    for (const [originHeader, expect, label] of corsCases) {
      const r = await fetch(origin + '/api/health', { headers: { Origin: originHeader } });
      const acao = r.headers.get('access-control-allow-origin');
      if (expect === null) {
        if (!acao) ok(`${label}：未回显 ACAO（正确拒绝）`);
        else bad(`${label}：竟然回显了 ACAO=${acao}`);
      } else if (acao === expect) {
        ok(`${label}：ACAO=${acao}`);
      } else {
        bad(`${label}：ACAO 期望 ${expect}，实际 ${acao}`);
      }
    }
    /* 带凭据的跨源必须同时给 ACAC，否则浏览器会丢掉 Cookie/令牌 */
    const cred = await fetch(origin + '/api/health', { headers: { Origin: 'http://127.0.0.1:29815' } });
    if (cred.headers.get('access-control-allow-credentials') === 'true') ok('跨源响应带 Allow-Credentials: true（会话可用）');
    else bad('跨源响应缺少 Allow-Credentials');

    /* ---------- ④ 接线：项目级 SessionStart hook ---------- */
    log('\n④ 项目级 SessionStart hook 接线');
    const settingsPath = path.join(ROOT, '.workbuddy', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      bad('缺少 <项目>/.workbuddy/settings.json —— 打开项目不会自动启动后端');
    } else {
      let cfg = null;
      try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { bad('settings.json 不是合法 JSON：' + e.message); }
      const hookCmd = cfg && cfg.hooks && cfg.hooks.SessionStart
        && cfg.hooks.SessionStart[0] && cfg.hooks.SessionStart[0].hooks
        && cfg.hooks.SessionStart[0].hooks[0] && cfg.hooks.SessionStart[0].hooks[0].command;
      if (hookCmd && /dev-up\.sh/.test(hookCmd)) ok('SessionStart 已接线到 tools/dev-up.sh：' + hookCmd);
      else bad('SessionStart hook 缺失或未指向 dev-up.sh：' + JSON.stringify(hookCmd));
    }
    const shPath = path.join(ROOT, 'tools', 'dev-up.sh');
    if (fs.existsSync(shPath) && fs.readFileSync(shPath, 'utf8').indexOf('dev-up.js') > -1) {
      ok('tools/dev-up.sh 存在且转交 dev-up.js');
    } else {
      bad('tools/dev-up.sh 缺失或未转交 dev-up.js');
    }
    /* 刻意不使用 dirname/sed：本机 bash 里这些外部命令可能不在 PATH。
       检查前先剥掉**整行注释**与**行尾注释** —— 否则
       「注释里声明自己不用 dirname」和「行尾注释里提到 sed」都会被误判成用了。 */
    const shSrc = fs.existsSync(shPath)
      ? fs.readFileSync(shPath, 'utf8').split('\n')
        .filter(l => !/^\s*#/.test(l))        // 去掉整行注释
        .map(l => String(l).split(/\s#/)[0])  // 去掉行尾注释
        .join('\n')
      : '';
    if (/dirname|readlink|\bsed\b|\bawk\b|\bcygpath\b/.test(shSrc)) {
      bad('dev-up.sh 的可执行代码里出现了 dirname/readlink/sed/awk/cygpath —— 本机 bash 可能没有这些命令');
    } else {
      ok('dev-up.sh 只用 bash 内建（不依赖 dirname/sed/awk/cygpath）');
    }
  } finally {
    if (pid) {
      try { process.kill(pid); } catch { /* 已退出 */ }
      await sleep(500);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 文件锁，忽略 */ }
  }

  if (pid) {
    const still = countListeners(port);
    if (still === 0) ok('收尾：临时后端已停止');
    else bad(`收尾：端口 ${port} 仍有 ${still} 个监听者`);
  }

  /* ---------- ⑤ 预览面板场景：页面不在后端源上，但本机后端可达 ----------
     这是最容易被忽略、却最常发生的一种打开方式（WorkBuddy 预览面板跑在
     127.0.0.1:<随机端口> 上）。过去相对路径的 fetch 打到预览服务 → 404 → 静默离线。
     现在应改成：先探当前源失败 → 再探本机后端 → **跨源直连**（不导航，避免白屏）。 */
  log('\n⑤ 预览面板场景（跨源直连，且不做导航）');
  const BACKEND_ORIGIN = 'http://127.0.0.1:8788';
  let hasJsdom = true;
  try { require.resolve('jsdom'); } catch { hasJsdom = false; }
  if (!hasJsdom) {
    log('  − 跳过：未安装 jsdom（属可选依赖，install 时跳过不算失败）');
  } else {
    const { JSDOM, VirtualConsole } = require('jsdom');
    const html = fs.readFileSync(path.join(ROOT, '平台原型', 'index.html'), 'utf8');
    const calls = [];
    const navErrors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => navErrors.push(String(e && e.message)));
    vc.on('error', () => {});
    vc.on('warn', () => {});
    const dom = new JSDOM(html, {
      url: 'http://127.0.0.1:29815/static-html/preview/index.html',   // 模拟预览面板的随机端口
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(window) {
        window.fetch = url => {
          const u = String(url);
          calls.push(u);
          if (u.indexOf(BACKEND_ORIGIN) === 0 && u.indexOf('/api/health') > -1) {
            return Promise.resolve(new Response(JSON.stringify({
              ok: true, mode: 'rule', authMode: 'strict', schemaVersion: 6,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return Promise.reject(new Error('stub: 该源上没有后端'));
        };
      },
    });
    await sleep(1000);

    const doc = dom.window.document;
    /* 先同源后跨源的探测顺序：不能一上来就打绝对地址（同源能通时不该跨源） */
    if (calls.length && calls[0] === '/api/health') ok('先探当前源（相对路径 /api/health）');
    else bad('首个探测请求不是当前源：' + JSON.stringify(calls.slice(0, 3)));
    if (calls.some(u => u.indexOf(BACKEND_ORIGIN) === 0)) ok('当前源失败后回退探测 127.0.0.1:8788');
    else bad('没有回退探测本机后端：' + JSON.stringify(calls));

    const bar = doc.getElementById('connBar');
    if (bar && !bar.hidden && /在线模式/.test(bar.textContent)) {
      ok('状态条切到「在线模式」（而不是留在离线演示态）');
    } else {
      bad('状态条未切到在线模式：' + (bar ? JSON.stringify(bar.textContent.slice(0, 80)) : '缺少 #connBar'));
    }

    /* 预览面板里**绝不能导航**：后端带 X-Frame-Options: SAMEORIGIN，跳过去是白屏 */
    const here = dom.window.location.href;
    if (here.indexOf('127.0.0.1:29815') > -1) ok('没有发生导航（仍停在预览源上）');
    else bad('页面被导航到了 ' + here);
    if (!navErrors.some(m => /navigation/i.test(m))) ok('没有产生 navigation 相关错误');
    else bad('出现 navigation 错误：' + navErrors.join(' | ').slice(0, 200));

    try { dom.window.close(); } catch { /* 忽略 */ }
  }

  log('\n===== 结果 =====');
  log(`通过 ${pass} · 失败 ${fail}`);
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  lines.push('\n[FATAL] ' + e.message + '\n' + (e.stack || ''));
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(2);
});
