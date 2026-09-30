#!/usr/bin/env node
/* ===========================================================
   HR-Agent OS · 上线前自检（preflight）
   ---------------------------------------------------------------
   在把地址发出去之前跑一遍。它只做**只读**检查，不改任何东西。

   为什么需要它：下面这几条每一条都「知道就不会错，不知道就一定会错」——
     · 演示口令还是 Demo@2026（公网 = 谁都能登录）
     · COOKIE_SECURE 与访问协议不配对（表现成「登录后立刻掉线」）
     · 库路径指向代码目录（容器重建 = 数据全丢）
     · 从来没有过备份
   手册容易漏读，脚本不会。

   退出码：0 = 可以上线；1 = 存在阻断项（必须先处理）。
   用法：node --experimental-sqlite tools/preflight.js
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { config, validate } = require('../server/config.js');
const { verifyPassword } = require('../server/security.js');

const ROOT = path.join(__dirname, '..');
const C = process.stdout.isTTY
  ? { g: '\u001b[32m', r: '\u001b[31m', y: '\u001b[33m', d: '\u001b[2m', x: '\u001b[0m' }
  : { g: '', r: '', y: '', d: '', x: '' };

const rows = [];
const pass = n => rows.push({ lvl: 'ok', msg: n });
const warn = n => rows.push({ lvl: 'warn', msg: n });
const fail = n => rows.push({ lvl: 'fail', msg: n });
const info = n => rows.push({ lvl: 'info', msg: n });

/* ---------- 1. 配置校验（与启动时同一函数） ---------- */
try { validate(); pass('配置校验通过'); }
catch (e) { fail('配置校验失败：' + String(e.message).replace(/^\[config\] 配置校验失败：\s*/, '').replace(/\n\s*-\s*/g, '；')); }

/* ---------- 2. Cookie 传输与访问协议是否配对 ---------- */
if (config.env === 'production' && config.auth.cookieSecure) {
  pass('生产环境已启用 COOKIE_SECURE —— 请确认访问入口是 https');
} else if (config.env !== 'production' && config.auth.cookieSecure) {
  warn('开发环境开启了 COOKIE_SECURE：若用 http 打开，浏览器不会发送会话 Cookie（表现为「登录后立刻掉线」）');
} else if (config.env === 'production') {
  fail('生产环境未启用 COOKIE_SECURE（会话 Cookie 会明文传输）');
} else {
  info('开发环境 · COOKIE_SECURE 关闭（本地 http 演示的正确取值）');
}

/* ---------- 3. 监听地址 ---------- */
if (config.http.host === '0.0.0.0' && !config.auth.cookieSecure) {
  warn('监听 0.0.0.0 但未启用 TLS/COOKIE_SECURE：同一网段可明文抓取会话');
} else {
  info(`监听 ${config.http.host}:${config.http.port}`);
}

/* ---------- 4. 演示重置开关 ---------- */
if (config.admin.allowReset && config.env === 'production') {
  fail('生产环境开启了 ALLOW_RESET：/api/reset 会清空运行期表，公网暴露等于对外开放一个清库按钮');
} else if (config.admin.allowReset) {
  info('演示重置已开启（非生产环境，符合预期）');
} else {
  pass('演示重置已关闭（/api/reset 与 --reset 均被拒）');
}

/* ---------- 5. 会话密钥 ---------- */
if (config.auth.secretSource === 'generated') {
  warn('会话密钥是本次启动新生成的：重启后所有人会被登出。多实例/容器部署请设 SESSION_SECRET 或 SESSION_SECRET_FILE');
} else {
  pass(`会话密钥来源：${config.auth.secretSource}（重启不掉线）`);
}

/* ---------- 6. 数据库位置与可写性 ---------- */
const dbFile = config.db.file;
const dbDir = path.dirname(dbFile);
if (!fs.existsSync(dbFile)) {
  warn(`库文件尚不存在：${dbFile}（首次启动会自动建库并灌种子）`);
} else {
  pass(`库文件存在：${path.relative(ROOT, dbFile).split(path.sep).join('/')}（${(fs.statSync(dbFile).size / 1024).toFixed(0)} KB）`);
}
try { fs.accessSync(fs.existsSync(dbDir) ? dbDir : path.dirname(dbDir), fs.constants.W_OK); pass('数据目录可写'); }
catch { fail(`数据目录不可写：${dbDir}`); }
if (dbFile.startsWith(config.serverDir)) {
  warn('库文件在代码目录内：容器/重建部署会连数据一起丢掉，建议 DB_PATH 指向挂载卷');
}

/* ---------- 7. 演示口令是否还在用（公网环境下的头号风险） ---------- */
const DEMO_PW = process.env.DEMO_PASSWORD || 'Demo@2026';
if (fs.existsSync(dbFile)) {
  let db = null;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    const users = db.prepare('SELECT id, name, role, password_hash, must_change_password FROM users').all();
    const stillDemo = users.filter(u => u.password_hash && verifyPassword(DEMO_PW, u.password_hash));
    if (stillDemo.length) {
      /* 只监听本机 + 非生产的实例里，共享演示口令是**刻意的**（文档里就是这么写的），
         判成阻断会淹没真正的阻断项。一对外可达就要升级成阻断。 */
      const localOnly = config.http.host === '127.0.0.1' || config.http.host === 'localhost' || config.http.host === '::1';
      const who = stillDemo.slice(0, 6).map(u => `${u.id} ${u.name}(${u.role})`).join('、') + (stillDemo.length > 6 ? ' 等' : '');
      if (localOnly && config.env !== 'production') {
        warn(`${stillDemo.length} 个账号仍在使用演示口令「${DEMO_PW}」（${who}）：本机演示是预期状态；**实例对外可达前必须改掉**`);
      } else {
        fail(`${stillDemo.length} 个账号仍在使用演示口令「${DEMO_PW}」（${who}）`
          + ' —— 对外可达的实例上，这等于把账号公开。登录每个账号点右上角 🔑 改掉');
      }
    } else {
      pass('没有账号还在使用演示口令');
    }
    const mustChange = users.filter(u => u.must_change_password).length;
    if (mustChange) info(`${mustChange} 个账号标记为「待改密」（首次登录后应强制修改）`);
  } catch (e) {
    warn('无法读取账号表做口令检查：' + e.message);
  } finally { try { db && db.close(); } catch { /* ignore */ } }
}

/* ---------- 8. 备份 ---------- */
const bkDir = path.join(ROOT, 'backups');
const bks = fs.existsSync(bkDir) ? fs.readdirSync(bkDir).filter(f => /^hr_agent_\d{8}-\d{6}\.db$/.test(f)).sort() : [];
if (!bks.length) {
  fail('从未备份过（backups/ 为空）：库文件是本平台唯一的数据副本。先跑 npm run backup');
} else {
  const newest = bks[bks.length - 1];
  const ageDays = (Date.now() - fs.statSync(path.join(bkDir, newest)).mtimeMs) / 86400000;
  if (ageDays > 7) fail(`最近一次备份在 ${ageDays.toFixed(1)} 天前（${newest}）：请立即备份并把目录挪到另一块盘`);
  else if (ageDays > 1) warn(`最近一次备份在 ${ageDays.toFixed(1)} 天前（${newest}）：建议纳入每日定时任务`);
  else pass(`最近备份 ${newest}（${ageDays < 0.05 ? '刚刚' : ageDays.toFixed(1) + ' 天前'}）· 共 ${bks.length} 份`);
}

/* ---------- 9. 运行模式 ---------- */
info(config.llm.url ? `LLM 已接入（${config.llm.model}）` : '规则模式：未配 LLM_API_URL，打分与润色全走确定性规则（离线可用、可回归）');
if (config.env === 'production' && !config.log.file) info('日志只输出到 stdout（容器部署的正确取值）');

/* ===========================================================
   输出
   =========================================================== */
const ICON = { ok: C.g + '✓' + C.x, warn: C.y + '⚠' + C.x, fail: C.r + '✗' + C.x, info: C.d + '·' + C.x };
console.log('\nHR-Agent OS · 上线前自检（只读）');
console.log('  ' + '─'.repeat(60));
rows.forEach(r => console.log(`  ${ICON[r.lvl]} ${r.msg}`));
console.log('  ' + '─'.repeat(60));

const fails = rows.filter(r => r.lvl === 'fail').length;
const warns = rows.filter(r => r.lvl === 'warn').length;
if (fails) {
  console.log(`  ${C.r}${fails} 项阻断${C.x}${warns ? `，${warns} 项提醒` : ''} —— 处理完再上线。\n`);
} else if (warns) {
  console.log(`  ${C.y}${warns} 项提醒${C.x} —— 没有阻断项，可以上线；提醒项建议在正式对外前处理。\n`);
} else {
  console.log(`  ${C.g}全部通过${C.x} —— 可以上线。\n`);
}
process.exit(fails ? 1 : 0);
