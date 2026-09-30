#!/usr/bin/env node
/**
 * A 档「可以给别人用」的运维面回归：静态资源 / CORS / 重置开关 / 备份恢复
 *
 * 为什么单独一个套件：
 *   功能回归（auth/hiring/jd/eval）跑得再绿，也测不到「静态资源每次重传 500KB」
 *   「预检放行了一个早就删掉的身份头」「公网上留着一个清库按钮」这类问题 ——
 *   它们不在业务语义里，而在「怎么被访问」里。
 *
 * 四段：
 *   ① 静态资源：gzip / ETag 协商缓存 / 源码目录隔离 / 目录穿越
 *   ② CORS 预检：允许头与 extractToken 对齐（不含 X-User，含 X-Session-Token）
 *   ③ 演示重置：开发开放、生产默认关闭；命令行 --reset 受同一开关约束
 *   ④ 备份：在线快照 / 校验 / 恢复 / 保留策略 / 服务在跑时拒绝恢复
 *
 * 零依赖，直接：node --experimental-sqlite tools/test_ops.js
 *   两个实例各用独立 DB（DB_PATH 指向临时目录），不碰演示库。
 */
'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT_DEV = 8896;      // 开发环境实例（重置开放）
const PORT_PROD = 8897;     // 生产环境实例（重置关闭）
const PW = process.env.DEMO_PASSWORD || 'Demo@2026';

let pass = 0; const fails = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
};
const section = t => console.log('\n=== ' + t + ' ===');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-ops-'));
const children = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(port, dbFile, extraEnv) {
  const p = spawn(NODE, ['--experimental-sqlite', 'server.js'], {
    cwd: path.join(ROOT, 'server'),
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbFile, LOG_LEVEL: 'warn' }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(p);
  let err = '';
  p.stderr.on('data', d => { err += d.toString(); });
  return { proc: p, stderr: () => err };
}

async function waitHealthy(port, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return await r.json(); }
    catch { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error(`实例 :${port} 未在 ${timeoutMs}ms 内就绪`);
}

/** 原始请求：fetch 会把 `/../x` 与 `/%2e%2e/` 在客户端就规范化掉，测不出服务端防护 */
function rawGet(port, rawPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: rawPath, headers: headers || {} }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function client(port) {
  let cookie = '';
  return async (method, url, body, extraHeaders) => {
    const h = Object.assign({ 'content-type': 'application/json' }, extraHeaders || {});
    if (cookie) h.cookie = cookie;
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map(x => x.split(';')[0]).join('; ');
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* 非 JSON */ }
    return { status: r.status, json, headers: r.headers, text: txt };
  };
}

/* ---------- 备份工具的调用封装 ---------- */
function runBackup(args, dbPath, extraEnv) {
  return spawnSync(NODE, ['--experimental-sqlite', path.join('tools', 'backup.js'), ...args], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { DB_PATH: dbPath, LOG_LEVEL: 'warn', PORT: '8899' }, extraEnv || {}),
    encoding: 'utf8',
  });
}

/** 直接数库里的候选人（用来验证恢复是否真的把数据带回来了） */
function countRows(dbFile, table) {
  const { DatabaseSync } = require('node:sqlite');
  let db = null;
  try { db = new DatabaseSync(dbFile, { readOnly: true }); return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c; }
  catch { return -1; }
  finally { try { db && db.close(); } catch { /* ignore */ } }
}

function cleanup() {
  children.forEach(p => { try { p.kill(); } catch { /* ignore */ } });
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

(async () => {
  console.log('验证 A 档运维面：静态资源 / CORS / 重置开关 / 备份恢复');

  const devDb = path.join(tmpDir, 'dev.db');
  startServer(PORT_DEV, devDb, { NODE_ENV: 'development' });
  /* 生产环境实例：COOKIE_SECURE=1 是 config.validate() 的硬要求，
     不给它会在启动期直接拒绝启动 —— 那正是「配错就别启动」的设计 */
  startServer(PORT_PROD, path.join(tmpDir, 'prod.db'), { NODE_ENV: 'production', COOKIE_SECURE: '1' });
  try {
    await waitHealthy(PORT_DEV);
    await waitHealthy(PORT_PROD);
    const dev = client(PORT_DEV);
    const prod = client(PORT_PROD);

    /* ================= ① 静态资源 ================= */
    section('静态资源：gzip / ETag / 源码隔离 / 目录穿越');

    const plain = await rawGet(PORT_DEV, '/');
    ok('GET / 返回 200 且是 HTML', plain.status === 200 && /text\/html/.test(plain.headers['content-type'] || ''),
      'status=' + plain.status + ' ct=' + plain.headers['content-type']);
    ok('静态资源带 ETag', !!plain.headers.etag, String(plain.headers.etag));
    ok('静态资源的 Cache-Control 不继承 API 的 no-store',
      !!plain.headers['cache-control'] && !/no-store/.test(plain.headers['cache-control']),
      String(plain.headers['cache-control']));
    ok('HTML 用 no-cache（发版后刷新立即生效）', /no-cache/.test(plain.headers['cache-control'] || ''),
      String(plain.headers['cache-control']));

    const gz = await rawGet(PORT_DEV, '/', { 'accept-encoding': 'gzip' });
    ok('声明 gzip 时返回 Content-Encoding: gzip', gz.headers['content-encoding'] === 'gzip',
      String(gz.headers['content-encoding']));
    ok('gzip 体积显著小于原文', gz.body.length < plain.body.length / 2,
      `${gz.body.length} vs ${plain.body.length}`);
    let gunzipped = null;
    try { gunzipped = zlib.gunzipSync(gz.body); } catch { /* 解不开 */ }
    ok('gzip 内容解压后与原文逐字节一致',
      !!gunzipped && gunzipped.length === plain.body.length && gunzipped.equals(plain.body),
      gunzipped ? `${gunzipped.length} vs ${plain.body.length}` : 'gunzip 失败');
    ok('带 Vary: Accept-Encoding（否则代理会把压缩版发给不支持的客户端）',
      /accept-encoding/i.test(String(gz.headers.vary || '')), String(gz.headers.vary));

    const cached = await rawGet(PORT_DEV, '/', { 'if-none-match': String(plain.headers.etag) });
    ok('ETag 命中返回 304 且无 body', cached.status === 304 && cached.body.length === 0,
      'status=' + cached.status + ' len=' + cached.body.length);

    for (const p of ['/src/app.js', '/build.js', '/test_live.js', '/index.html.bak']) {
      const r = await rawGet(PORT_DEV, p);
      ok(`源码/脚本不可下载：${p} → 404`, r.status === 404, 'status=' + r.status);
    }

    /* 目录穿越：URL 规范化吃掉明文 `../`，所以用 `%2f` 编码的斜杠绕开它，
       让服务端真的收到一个「解码后越出静态根」的路径。 */
    const canary = path.join(ROOT, '__ops_traversal_canary.html');
    fs.writeFileSync(canary, '<b>should not be reachable</b>', 'utf8');
    try {
      const esc = await rawGet(PORT_DEV, '/..%2f__ops_traversal_canary.html');
      ok('编码斜杠的目录穿越被拦（不得返回静态根之外的文件）',
        esc.status === 404, 'status=' + esc.status + ' body=' + esc.body.toString().slice(0, 40));
      const plainEsc = await rawGet(PORT_DEV, '/../package.json');
      ok('明文 ../ 穿越被拦', plainEsc.status === 404, 'status=' + plainEsc.status);
    } finally { try { fs.unlinkSync(canary); } catch { /* ignore */ } }

    /* ================= ② CORS ================= */
    section('CORS 预检：允许头与实际认证方式对齐');

    const pre = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: PORT_DEV, method: 'OPTIONS', path: '/api/bootstrap',
        headers: { origin: `http://127.0.0.1:${PORT_DEV}`, 'access-control-request-method': 'GET' } }, res => {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      });
      req.on('error', reject); req.end();
    });
    const allowHeaders = String(pre.headers['access-control-allow-headers'] || '');
    ok('预检放行 X-Session-Token（server.js extractToken 认的第三种携带方式）',
      /x-session-token/i.test(allowHeaders), allowHeaders);
    ok('预检不再放行 X-User（legacy 身份头的残留）',
      !/x-user/i.test(allowHeaders.replace(/x-session-token/gi, '')), allowHeaders);
    const foreign = await rawGet(PORT_DEV, '/api/health', { origin: 'http://evil.example.com' });
    ok('非本机来源不返回 Access-Control-Allow-Origin',
      !foreign.headers['access-control-allow-origin'], String(foreign.headers['access-control-allow-origin']));

    /* ================= ③ 重置开关 ================= */
    section('演示重置：开发开放 / 生产默认关闭');

    const ldev = await dev('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
    ok('开发实例 HRD 登录成功', ldev.status === 200 && ldev.json && ldev.json.ok === true, 'status=' + ldev.status);
    const bdev = await dev('GET', '/api/bootstrap');
    ok('开发实例 bootstrap.caps.reset === true',
      !!(bdev.json && bdev.json.caps && bdev.json.caps.reset === true),
      JSON.stringify(bdev.json && bdev.json.caps));
    const rdev = await dev('POST', '/api/reset', {});
    ok('开发实例 POST /api/reset 放行', rdev.status === 200, 'status=' + rdev.status);

    const lprod = await prod('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
    ok('生产实例 HRD 登录成功（Cookie 走 Secure，服务端仍认 Bearer）',
      lprod.status === 200 && lprod.json && lprod.json.ok === true, 'status=' + lprod.status);
    const bprod = await prod('GET', '/api/bootstrap');
    ok('生产实例 bootstrap.caps.reset === false',
      !!(bprod.json && bprod.json.caps && bprod.json.caps.reset === false),
      JSON.stringify(bprod.json && bprod.json.caps));
    const rprod = await prod('POST', '/api/reset', {});
    ok('生产实例 POST /api/reset 被拒（403，且文案说明开关而非权限）',
      rprod.status === 403 && /ALLOW_RESET/.test(JSON.stringify(rprod.json)),
      'status=' + rprod.status + ' body=' + JSON.stringify(rprod.json).slice(0, 120));

    /* 命令行入口必须受**同一个**开关约束 —— 关掉接口却留着 --reset 是最容易漏的一半 */
    const cliProd = spawnSync(NODE, ['--experimental-sqlite', 'server.js', '--reset'], {
      cwd: path.join(ROOT, 'server'),
      env: Object.assign({}, process.env, { NODE_ENV: 'production', COOKIE_SECURE: '1', DB_PATH: path.join(tmpDir, 'cli.db'), PORT: '8898', LOG_LEVEL: 'error' }),
      encoding: 'utf8', timeout: 20000,
    });
    const cliOut = (cliProd.stdout || '') + (cliProd.stderr || '');
    ok('生产环境 --reset 被拒且直接退出', cliProd.status !== 0 && /拒绝执行|ALLOW_RESET/.test(cliOut),
      'code=' + cliProd.status + ' out=' + cliOut.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 100));

    const cliProdOn = spawnSync(NODE, ['-e', 'const c=require("./server/config.js");console.log(JSON.stringify({r:c.config.admin.allowReset,env:c.config.env}))'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { NODE_ENV: 'production', ALLOW_RESET: '1' }),
      encoding: 'utf8', timeout: 20000,
    });
    ok('显式 ALLOW_RESET=1 可重新开放（开关不是不可逆的）',
      /"r":true/.test(cliProdOn.stdout || ''), (cliProdOn.stdout || '').trim());

    /* ================= ⑤ 口令治理 ================= */
    section('口令治理：上线清单要你改的东西，接口层面必须真的改得掉');

    /* 用生产实例：改口令这件事本来就是「对外可达之前」的动作。
       另起 client 是因为改密会吊销该账号的全部会话 —— 不能污染前面还在用的那个。 */
    const pw1 = client(PORT_PROD);
    const canLoginDemo = await pw1('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
    ok('改密前：初始口令仍可登录（这正是 preflight 判定为阻断的那件事）',
      canLoginDemo.status === 200, 'status=' + canLoginDemo.status);

    const badOld = await pw1('POST', '/api/auth/change-password', { oldPassword: 'definitely-wrong', newPassword: 'Ops-2026!changed' });
    ok('当前密码不对 → 拒绝改密（否则会话被盗可以先改密永久占号）',
      badOld.status === 403, 'status=' + badOld.status);

    const tooShort = await pw1('POST', '/api/auth/change-password', { oldPassword: PW, newPassword: 'ab12' });
    ok('新密码不足 8 位 → 拒绝', tooShort.status === 400, 'status=' + tooShort.status);

    const sameAsOld = await pw1('POST', '/api/auth/change-password', { oldPassword: PW, newPassword: PW });
    ok('新旧密码相同 → 拒绝（否则「已改密」是假的）',
      sameAsOld.status === 400, 'status=' + sameAsOld.status);

    const NEW_PW = 'Ops-2026!changed';
    const changed = await pw1('POST', '/api/auth/change-password', { oldPassword: PW, newPassword: NEW_PW });
    ok('改密成功，并返回被吊销的会话数',
      changed.status === 200 && typeof ((changed.json || {}).revokedSessions) === 'number',
      'status=' + changed.status + ' body=' + (changed.text || '').slice(0, 90));

    const oldAgain = await client(PORT_PROD)('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
    ok('改密后旧口令立即失效', oldAgain.status !== 200, 'status=' + oldAgain.status);

    const newAgain = await client(PORT_PROD)('POST', '/api/auth/login', { identifier: 'U-001', password: NEW_PW });
    ok('新口令可以登录', newAgain.status === 200, 'status=' + newAgain.status);
    ok('登录响应里的「待改密」标记已清零（preflight 的判定依据）',
      !!(newAgain.json && newAgain.json.mustChangePassword === false),
      JSON.stringify(newAgain.json && newAgain.json.mustChangePassword));

    /* ================= ④ 备份 / 恢复 ================= */
    section('数据库备份：在线快照 / 校验 / 恢复 / 保留策略');

    const bkDir = path.join(tmpDir, 'bk');
    const b1 = runBackup(['--dir', bkDir], devDb);
    ok('backup.js 对**正在被写入**的库执行成功（在线快照，未停服）',
      b1.status === 0 && /备份完成/.test(b1.stdout || ''),
      'code=' + b1.status + ' ' + (b1.stdout || b1.stderr || '').split('\n')[1]);
    const files = fs.existsSync(bkDir) ? fs.readdirSync(bkDir) : [];
    const dbFiles = files.filter(f => /^hr_agent_\d{8}-\d{6}\.db$/.test(f));
    ok('产出备份库文件 + json 清单', dbFiles.length === 1 && files.some(f => f.endsWith('.db.json')),
      files.join(', '));
    const bkFile = dbFiles.length ? path.join(bkDir, dbFiles[0]) : null;
    const bkCands = bkFile ? countRows(bkFile, 'candidates') : -1;
    ok('备份里确实有数据（非空快照）', bkCands > 0, 'candidates=' + bkCands);

    const v1 = runBackup(['--verify', bkFile || 'none'], devDb);
    ok('--verify 通过（完整性 ok + 与清单 sha256 一致）',
      v1.status === 0 && /完整性\s+ok/.test(v1.stdout || ''), (v1.stdout || '').split('\n')[2]);

    /* 恢复演练：在**独立副本**上做，避免影响正在跑的实例 */
    const target = path.join(tmpDir, 'restore_target.db');
    fs.copyFileSync(devDb, target);
    for (const f of [target + '-wal', target + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    const rb = runBackup(['--dir', path.join(tmpDir, 'bk2')], target);
    const rbFile = fs.existsSync(path.join(tmpDir, 'bk2'))
      ? fs.readdirSync(path.join(tmpDir, 'bk2')).filter(f => f.endsWith('.db')).map(f => path.join(tmpDir, 'bk2', f))[0] : null;
    ok('对独立副本也能备份（--dir 生效）', rb.status === 0 && !!rbFile, 'code=' + rb.status);

    if (rbFile) {
      const before = countRows(target, 'candidates');
      /* 模拟事故：把库清空 */
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(target); d.exec('DELETE FROM candidates'); d.close();
      ok('模拟事故：副本候选人已清空', countRows(target, 'candidates') === 0, 'rows=' + countRows(target, 'candidates'));

      const rs = runBackup(['--restore', rbFile], target);
      ok('--restore 成功执行', rs.status === 0 && /已从备份恢复/.test(rs.stdout || ''),
        'code=' + rs.status + ' ' + (rs.stdout || rs.stderr || '').slice(0, 120));
      ok('恢复后数据回到备份时的状态（数据真的回来了）',
        countRows(target, 'candidates') === before, `${countRows(target, 'candidates')} vs ${before}`);
      ok('原库被另存为 .pre-restore-* （恢复可回退）',
        fs.readdirSync(tmpDir).some(f => /^restore_target\.db\.pre-restore-\d{8}-\d{6}$/.test(f)),
        fs.readdirSync(tmpDir).filter(f => f.includes('pre-restore')).join(', ') || '（无）');
      ok('旧库的 -wal / -shm 已被清理（留着会让 SQLite 拿旧事务日志修补新库）',
        !fs.existsSync(target + '-wal') && !fs.existsSync(target + '-shm'));

      /* 服务在跑时不得恢复：这条保护比恢复本身更重要。
         PORT 必须指向**真的在监听**的那个实例（dev 实例 :8896），
         否则这条断言测的是「端口没人听 → 直接放行」，等于没测。 */
      const busy = runBackup(['--restore', bkFile || rbFile], devDb, { PORT: String(PORT_DEV) });
      ok('服务在运行时拒绝恢复（避免覆盖正在被写入的库）',
        busy.status !== 0 && /服务正在运行/.test(busy.stdout || ''),
        'code=' + busy.status + ' ' + (busy.stdout || '').slice(0, 100));

      /* 保留策略 */
      const keepDir = path.join(tmpDir, 'bk3');
      for (let i = 0; i < 3; i++) { runBackup(['--dir', keepDir, '--keep', '2'], target); await sleep(1100); }
      const kept = fs.existsSync(keepDir) ? fs.readdirSync(keepDir).filter(f => f.endsWith('.db')).length : 0;
      ok('保留策略生效（--keep 2 后只留 2 份）', kept === 2, 'kept=' + kept);
      ok('清理旧备份时连 .json 清单一起删（不留孤儿文件）',
        fs.readdirSync(keepDir).filter(f => f.endsWith('.json')).length === 2,
        fs.readdirSync(keepDir).join(', '));

      const noExist = runBackup(['--verify', 'no-such-file.db'], target);
      ok('校验不存在的备份 → 非 0 退出且给出原因',
        noExist.status !== 0 && /找不到备份文件/.test(noExist.stdout || ''), 'code=' + noExist.status);
    }
  } catch (e) {
    fails.push('套件异常：' + e.message);
    console.log('  ✗ 套件异常 → ' + e.message);
  } finally {
    cleanup();
  }

  console.log(`\n=== 结果 ===\n通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length) { fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
})();
