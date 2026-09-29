#!/usr/bin/env node
/* ===========================================================
   tools/dev-up.js · 确保本地后端在跑（幂等）
   ---------------------------------------------------------------
   用途：给两类入口共用
     ① WorkBuddy 项目级 SessionStart hook（<项目>/.workbuddy/settings.json）
        —— 每次打开这个项目就自动把后端拉起来，原型不再落到离线演示态
     ② 手动 `npm run dev`

   设计原则（三条都不能省）：
     · **幂等**：端口已在监听就直接返回，绝不启第二个实例（node:sqlite 同库双写会锁）
     · **非阻断**：永远 exit 0。启动失败只写日志，不阻断会话启动
     · **可观测**：写 logs/dev-up.log（子进程 stdout/stderr）与 logs/dev-up.pid，
        失败时人能查到原因，而不是「什么都没发生」

   零依赖：只用 node 内置模块 + 全局 fetch。
   =========================================================== */
'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const LOG_DIR = path.join(SERVER_DIR, 'logs');

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const QUIET = flag('--quiet');
const JSON_OUT = flag('--json');
const PORT = Number(process.env.PORT || opt('--port', 8788));
const HOST = process.env.HOST || opt('--host', '127.0.0.1');
const ORIGIN = `http://${HOST}:${PORT}`;
const WAIT_MS = Number(opt('--wait', 20000));

const say = msg => { if (!QUIET && !JSON_OUT) console.log(msg); };
const warn = msg => { if (!JSON_OUT) console.log(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function emit(obj) {
  if (JSON_OUT) console.log(JSON.stringify(obj));
}

/** 端口是否已有人在监听 */
function portBusy(port, host) {
  return new Promise(resolve => {
    const s = net.connect({ port, host });
    let settled = false;
    const done = ok => { if (settled) return; settled = true; s.destroy(); resolve(ok); };
    s.setTimeout(800);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

/** 是不是**我们**的后端（而不是别的程序占了 8788） */
async function healthOk() {
  try {
    const r = await fetch(ORIGIN + '/api/health', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch { return null; }
}

/** 当前代码期望的 schema 版本（纯常量，不需要连库） */
function expectedSchema() {
  try { return require(path.join(SERVER_DIR, 'migrations.js')).LATEST; } catch { return null; }
}

/** 谁在监听这个端口（Windows: netstat -ano 最后一列；*nix: ss -ltnp） */
function findListenerPid(port) {
  try {
    const win = process.platform === 'win32';
    const r = spawnSync(win ? 'netstat' : 'ss', win ? ['-ano'] : ['-ltnp'], { encoding: 'utf8' });
    const re = new RegExp('[:.]' + port + '\\b');
    for (const l of String(r.stdout || '').split('\n')) {
      if (!/LISTENING|LISTEN/.test(l) || !re.test(l)) continue;
      const pid = Number(String(l.trim().split(/\s+/).pop() || '').replace(/[^0-9]/g, ''));
      if (pid) return pid;
    }
  } catch { /* netstat 不可用：降级为「不知道 pid」 */ }
  return null;
}

/** 停掉在跑的实例并等端口释放（Windows 上 process.kill 会直接终止进程） */
async function stopPid(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { /* 已退出 */ }
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    await sleep(300);
    if (!(await portBusy(PORT, HOST))) return true;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ }
  await sleep(600);
  return !(await portBusy(PORT, HOST));
}

/* ===========================================================
   启动子进程：两条路，按「是不是常规启动」选
   ---------------------------------------------------------------
   ⚠️ 实测结论（本机 WorkBuddy 环境）：
     用 spawn(detached:true)+unref() 起的 node，**命令一结束就被回收**
     （日志停在「服务已启动」然后进程消失，端口不再监听）。原因是宿主用
     Job Object 管理进程树，DETACHED_PROCESS 不会脱离它。
     而走 WMI（Win32_Process.Create）创建的进程挂在 WmiPrvSE.exe 下，
     完全不在这个 job 里 —— 实测命令结束后仍在监听。

   因此：
     · 常规启动（端口/库都是默认值）→ 优先 WMI，让服务真的活下来
     · 带 PORT / DB_PATH / LOG_LEVEL 覆盖 → 退回普通 detached spawn
       （测试与一次性实例需要继承我们设的环境变量；而 WMI 创建的子进程
        继承的是 WMI 服务的环境，传不进去）
     · 非 Windows → 普通 detached spawn
   =========================================================== */
function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

/* 为什么要经 WMI + 一层隐藏窗口的 powershell：
   ① WMI 创建的进程挂在 WmiPrvSE.exe 下，**不在宿主的 Job Object 里** ——
      实测：直接 spawn(detached)+unref() 起的 node 在命令结束后被回收（端口消失、日志停在启动横幅），
      而 WMI 起的还在监听。这是这套方案能成立的关键。
   ② 但让 WMI 直接创建 node.exe 会新分配一个**可见的控制台窗口**（每次打开项目弹黑窗）。
      `powershell -WindowStyle Hidden` 自带一个隐藏控制台，node 作为其子进程继承它 → 什么都不弹。
   ③ 用 -EncodedCommand（UTF-16LE base64）而不是 -Command：彻底躲开「引号套引号 + 中文路径」的转义地狱。 */
function spawnViaWmi() {
  if (process.platform !== 'win32' || flag('--no-wmi')) return null;
  const script = 'Set-Location ' + psQuote(SERVER_DIR) + '; & '
    + psQuote(process.execPath) + ' --experimental-sqlite server.js';
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  const cmdline = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + b64;

  const ps = [
    '$ErrorActionPreference = "Stop"',
    '$p = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ '
      + 'CommandLine = ' + psQuote(cmdline) + '; CurrentDirectory = ' + psQuote(SERVER_DIR) + ' }',
    'if ($p.ReturnValue -ne 0) { Write-Error ("Win32_Process.Create ReturnValue=" + $p.ReturnValue); exit 1 }',
    'Write-Output $p.ProcessId',
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const pid = Number(String((r.stdout || '').trim()).split('\n').pop());
  if (r.status === 0 && Number.isFinite(pid) && pid > 0) return { pid, how: 'wmi(hidden)' };
  warn('[!] WMI 启动失败，退回普通 detached 启动：' + String((r.stderr || '').trim()).slice(0, 160));
  return null;
}

function spawnDetached() {
  const logPath = path.join(LOG_DIR, 'dev-up.log');
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n===== dev-up ${new Date().toISOString()} · ${ORIGIN} =====\n`);
  const child = spawn(process.execPath, ['--experimental-sqlite', 'server.js'], {
    cwd: SERVER_DIR,
    detached: true,                      // 自成进程组，父进程退出不影响它
    windowsHide: true,                   // 不要弹黑窗
    stdio: ['ignore', fd, fd],
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST }),
  });
  child.unref();
  return { pid: child.pid, how: 'detached' };
}

(async () => {
  const RESTART = flag('--restart');
  const want = expectedSchema();

  /* --- 情况 1：已经在跑 --- */
  if (await portBusy(PORT, HOST)) {
    const h = await healthOk();
    if (h) {
      /* 「在跑」不等于「就是当前这份代码」：进程比源码旧时，页面会连上一个
         缺列/缺接口的旧实例 —— 症状是「在线了但功能坏了」，比离线更难查。
         所以这里显式比对 schema 版本，落后就**大声说出来**。 */
      const stale = want != null && h.schemaVersion != null && h.schemaVersion < want;
      if (stale && !RESTART) {
        const pid = findListenerPid(PORT);
        warn(`[!] 在跑的实例是 schema v${h.schemaVersion}，当前代码是 v${want} —— 进程比代码旧。`);
        warn(`    带 --restart 重来会自动重启：node tools/dev-up.js --restart`);
        if (pid) warn(`    或手动结束 pid ${pid} 后重新打开项目。`);
        emit({ started: false, reason: 'stale', stale: true, pid, url: ORIGIN, expectedSchema: want, actualSchema: h.schemaVersion });
        return;
      }
      if (RESTART) {
        /* --restart 的语义是**无条件重来**，不只在 schema 落后时。
           为什么必须这样：改了 engine.js / 词库 / 打分口径但没改表结构时，
           schema 版本号不变（都是 v6），靠 schema 比对压根发现不了
           「进程比代码旧」—— 症状是「接口通、但跑的还是旧逻辑」，
           比离线更难查。词库改版（REQ_LIB_VER）就属于这一类：
           老进程不会重算老 JD，必须重启才生效。 */
        const pid = findListenerPid(PORT);
        if (!pid) {
          warn('[!] 要重启但拿不到监听进程的 pid（netstat 不可用），不冒险乱杀。');
          emit({ started: false, reason: 'restart-no-pid', url: ORIGIN, actualSchema: h.schemaVersion });
          return;
        }
        say(stale
          ? `[i] 版本落后（v${h.schemaVersion} → v${want}），重启 pid ${pid} …`
          : `[i] 强制重启 pid ${pid}（--restart：后端代码有变，表结构没变）…`);
        const stopped = await stopPid(pid);
        if (!stopped) {
          warn('[X] 端口没释放，放弃重启（可能有别的程序占着）。');
          emit({ started: false, reason: 'restart-failed', pid, url: ORIGIN });
          return;
        }
        /* 落到下面「情况 2」重新拉起 */
      } else {
        say(`[i] 后端已在运行 ${ORIGIN}（${h.mode || 'rule'} 模式 · schema v${h.schemaVersion ?? '?'}）`);
        emit({ started: false, reason: 'already-running', url: ORIGIN, health: h });
        return;
      }
    } else {
      /* 端口被别的东西占了 —— 明确说出来，不要假装成功 */
      warn(`[!] 端口 ${PORT} 已被占用，但它不是 HR-Agent OS 后端（/api/health 不匹配）。`);
      warn(`    换端口：PORT=8899 node tools/dev-up.js`);
      emit({ started: false, reason: 'port-taken-by-other', url: ORIGIN });
      return;
    }
  }

  /* --- 情况 2：拉起来 --- */
  fs.mkdirSync(LOG_DIR, { recursive: true });

  /* 「常规启动」才走 WMI：WMI 创建的子进程继承的是 WMI 服务的环境，传不进 PORT/DB_PATH，
     所以一旦有覆盖（测试实例、换端口），就必须退回能继承 env 的普通 detached 启动。 */
  const envOverride = PORT !== 8788 || !!process.env.PORT || !!process.env.DB_PATH || !!process.env.LOG_LEVEL;
  const started = envOverride
    ? spawnDetached()
    : (spawnViaWmi() || spawnDetached());
  try { fs.writeFileSync(path.join(LOG_DIR, 'dev-up.pid'), String(started.pid)); } catch { /* 忽略 */ }

  say(`[i] 正在启动后端（pid ${started.pid} · ${started.how}）… 日志：server/logs/dev-up.log`);

  /* --- 等健康检查 --- */
  const t0 = Date.now();
  for (;;) {
    await sleep(300);
    const h = await healthOk();
    if (h) {
      say(`[i] 已就绪 ${ORIGIN}（${h.mode || 'rule'} 模式 · ${Date.now() - t0}ms）`);
      emit({ started: true, pid: started.pid, how: started.how, url: ORIGIN, ms: Date.now() - t0, health: h });
      return;
    }
    if (Date.now() - t0 > WAIT_MS) {
      warn(`[X] 后端在 ${WAIT_MS}ms 内没有就绪。看 server/logs/dev-up.log 与 server/logs/app.log。`);
      emit({ started: true, pid: started.pid, how: started.how, url: ORIGIN, ready: false });
      return;
    }
  }
})().catch(e => {
  warn('[X] dev-up 异常（已忽略，不阻断会话）：' + (e && e.message));
  emit({ started: false, reason: 'error', error: String(e && e.message) });
}).finally(() => {
  /* 永远成功退出：这是「便利设施」，不该让会话启动失败 */
  process.exitCode = 0;
});
