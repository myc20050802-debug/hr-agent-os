#!/usr/bin/env node
/* ===========================================================
   HR-Agent OS · 数据库备份 / 校验 / 恢复
   ---------------------------------------------------------------
   为什么需要它：库文件是本平台**唯一**的真实数据（候选人、岗位、审批、
   审计）。没有备份脚本的部署，本质上是「数据只有一份」——
   一次误删、一次磁盘故障、一次错误的 SQL，就没有然后了。

   三种做法里为什么选 `VACUUM INTO`：
     ① 直接 `fs.copyFile` 三个文件（db/wal/shm）——WAL 模式下复制到一半
        就是不一致快照，恢复后可能报 database disk image is malformed；
     ② `db.backup()`（node:sqlite 的在线备份 API）——本机 Node 22 **没有**
        （已实测 `DatabaseSync.prototype.backup === undefined`）；
     ③ `VACUUM INTO 'file'` ——SQLite 原生能力，**只读连接即可执行**，
        产出的是一个重新整理过的、内部一致的完整库文件。
        这就是这里用的方式：**不用停服**，也不会拖住写者。

   用法：
     node tools/backup.js                    备份（默认 backups/，保留 14 份）
     node tools/backup.js --keep 30          自定义保留份数
     node tools/backup.js --dir D:/hr-backup 自定义目录（建议挂到别的盘）
     node tools/backup.js --list             列出已有备份
     node tools/backup.js --verify <file>    校验某份备份能否用（完整性 + 计数）
     node tools/backup.js --restore <file>   用备份覆盖当前库（需先停服）
     node tools/backup.js --restore <f> --force   服务在跑也强行恢复（危险）

   环境变量：DB_PATH（与 server 一致）—— 恢复目标 = 服务实际读的那个库。
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('../server/config.js');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : (argv[i + 1] === undefined ? true : argv[i + 1]);
};
const has = name => argv.includes(name);

const DB_FILE = config.db.file;
const BACKUP_DIR = path.resolve(arg('--dir', path.join(ROOT, 'backups')));
const KEEP = Math.max(1, Number(arg('--keep', 14)) || 14);
const NAME_RE = /^hr_agent_(\d{8}-\d{6})\.db$/;

const C = process.stdout.isTTY
  ? { g: '\u001b[32m', r: '\u001b[31m', y: '\u001b[33m', d: '\u001b[2m', x: '\u001b[0m' }
  : { g: '', r: '', y: '', d: '', x: '' };
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

const kb = n => (n / 1024).toFixed(0) + ' KB';
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const stamp = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** 库结构可能随版本变化，计数失败不算错（只影响清单信息量） */
function counts(file) {
  const out = {};
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    for (const t of ['jobs', 'candidates', 'users', 'audit_logs']) {
      try { out[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { /* 表不存在 */ }
    }
    try { out.schemaVersion = db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v; }
    catch { out.schemaVersion = null; }
  } catch { /* 打不开就只返回空 */ }
  finally { try { db && db.close(); } catch { /* ignore */ } }
  return out;
}

function integrity(file) {
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const r = db.prepare('PRAGMA integrity_check').get();
    return r && r.integrity_check === 'ok';
  } catch { return false; }
  finally { try { db && db.close(); } catch { /* ignore */ } }
}

function existingBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => NAME_RE.test(f))
    .sort()                      // 时间戳格式天然按字典序 = 时间序
    .map(f => {
      const full = path.join(BACKUP_DIR, f);
      const st = fs.statSync(full);
      let meta = null;
      const mf = full + '.json';
      if (fs.existsSync(mf)) { try { meta = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { /* 忽略坏清单 */ } }
      return { file: full, name: f, bytes: st.size, mtimeMs: st.mtimeMs, meta };
    });
}

/** 服务是否在跑 —— 恢复前必须确认，否则会把「正在被写入的库」替换掉 */
function serverAlive(port, host) {
  return new Promise(resolve => {
    const s = net.connect({ port, host: host === '0.0.0.0' ? '127.0.0.1' : host });
    const done = ok => { try { s.destroy(); } catch { /* ignore */ } resolve(ok); };
    s.setTimeout(400);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

/* ===========================================================
   命令实现
   =========================================================== */
function doBackup() {
  if (!fs.existsSync(DB_FILE)) {
    log(`${C.r}✗ 找不到库文件：${DB_FILE}${C.x}`);
    log(`  ${C.d}先启动一次服务（npm run dev）让它建库，再用本工具备份。${C.x}`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `hr_agent_${stamp()}.db`);
  if (fs.existsSync(target)) fs.unlinkSync(target);          // VACUUM INTO 要求目标不存在

  let db = null;
  try {
    db = new DatabaseSync(DB_FILE, { readOnly: true });
    /* 路径里的单引号要按 SQL 规则转义成两个；反斜杠在字符串字面量里不是转义符，
       但统一成正斜杠可避开各平台差异 */
    db.exec(`VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  } catch (e) {
    log(`${C.r}✗ 备份失败：${e.message}${C.x}`);
    process.exitCode = 1;
    return;
  } finally { try { db && db.close(); } catch { /* ignore */ } }

  const buf = fs.readFileSync(target);
  const info = counts(target);
  const manifest = {
    file: path.basename(target),
    createdAt: new Date().toISOString(),
    source: DB_FILE,
    bytes: buf.length,
    sha256: sha256(buf),
    integrity: integrity(target),
    counts: info,
  };
  fs.writeFileSync(target + '.json', JSON.stringify(manifest, null, 2), 'utf8');

  log(`${C.g}✓ 备份完成${C.x}  ${target}`);
  log(`   ${C.d}大小 ${kb(buf.length)} · 岗位 ${info.jobs ?? '-'} · 候选人 ${info.candidates ?? '-'} · 用户 ${info.users ?? '-'} · 审计 ${info.audit_logs ?? '-'} · schema v${info.schemaVersion ?? '-'}${C.x}`);
  log(`   ${C.d}校验值 sha256 ${manifest.sha256.slice(0, 16)}…（同目录 .json 清单）${C.x}`);

  /* 保留策略：只保留最近 KEEP 份。备份不删就一定会把磁盘吃满，
     而「三个月前那份」在真正需要恢复时通常也帮不上忙。 */
  const all = existingBackups();
  const stale = all.slice(0, Math.max(0, all.length - KEEP));
  stale.forEach(b => {
    for (const f of [b.file, b.file + '.json']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  });
  if (stale.length) log(`   ${C.d}已清理 ${stale.length} 份超出保留策略（--keep ${KEEP}）的旧备份${C.x}`);
  log(`   ${C.d}当前共 ${existingBackups().length} 份备份${C.x}`);
}

function doList() {
  const all = existingBackups();
  if (!all.length) { log(`（${BACKUP_DIR} 下还没有备份）`); return; }
  log(`${C.d}目录${C.x} ${BACKUP_DIR}  ${C.d}共 ${all.length} 份${C.x}\n`);
  all.slice().reverse().forEach(b => {
    const c = (b.meta && b.meta.counts) || {};
    log(`  ${b.name.replace(/^hr_agent_|\.db$/g, '')}  ${kb(b.bytes).padStart(8)}  `
      + `${C.d}岗位 ${c.jobs ?? '?'} · 候选人 ${c.candidates ?? '?'} · schema v${c.schemaVersion ?? '?'}`
      + (b.meta && b.meta.integrity === false ? ` ${C.r}（当时校验未通过）${C.x}` : '') + `${C.x}`);
    log(`  ${C.d}${b.file}${C.x}`);
  });
}

function resolveBackup(p) {
  const candidates = [path.resolve(p), path.join(BACKUP_DIR, p)];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function doVerify(p) {
  const file = resolveBackup(p);
  if (!file) { log(`${C.r}✗ 找不到备份文件：${p}${C.x}`); process.exitCode = 1; return; }
  const okIntegrity = integrity(file);
  const buf = fs.readFileSync(file);
  const info = counts(file);
  const mf = file + '.json';
  let same = null;
  if (fs.existsSync(mf)) {
    try { same = JSON.parse(fs.readFileSync(mf, 'utf8')).sha256 === sha256(buf); } catch { same = null; }
  }
  log(`文件     ${file}`);
  log(`大小     ${kb(buf.length)}`);
  log(`完整性   ${okIntegrity ? C.g + 'ok' + C.x : C.r + '失败（该备份不可用）' + C.x}`);
  log(`sha256   ${sha256(buf)}`);
  if (same !== null) log(`与清单一致 ${same ? C.g + '是' + C.x : C.r + '否（文件被改动过）' + C.x}`);
  log(`内容     岗位 ${info.jobs ?? '-'} · 候选人 ${info.candidates ?? '-'} · 用户 ${info.users ?? '-'} · 审计 ${info.audit_logs ?? '-'} · schema v${info.schemaVersion ?? '-'}`);
  if (!okIntegrity || same === false) process.exitCode = 1;
}

async function doRestore(p) {
  const file = resolveBackup(p);
  if (!file) { log(`${C.r}✗ 找不到备份文件：${p}${C.x}`); process.exitCode = 1; return; }

  /* 先验证再恢复：用一份坏掉的备份覆盖掉现在还能用的库，
     是能让事故从「有救」变成「没救」的那一步。 */
  if (!integrity(file)) { log(`${C.r}✗ 该备份未通过完整性检查，拒绝用它覆盖现有库。${C.x}`); process.exitCode = 1; return; }

  const alive = await serverAlive(config.http.port, config.http.host);
  if (alive && !has('--force')) {
    log(`${C.r}✗ 服务正在运行（${config.http.host}:${config.http.port}），拒绝恢复。${C.x}`);
    log(`  ${C.d}恢复必须独占访问这个库文件：先停服务（Ctrl+C 或 npm run dev 的窗口），再重跑本命令。${C.x}`);
    log(`  ${C.d}确认服务已停但仍检测到端口占用时，可用 --force 跳过本检查。${C.x}`);
    process.exitCode = 1;
    return;
  }
  if (alive && has('--force')) log(`${C.y}⚠ 服务仍在运行，--force 生效 —— 恢复后请立刻重启服务。${C.x}`);

  const ts = stamp();
  const aside = DB_FILE + '.pre-restore-' + ts;
  const moved = [];
  if (fs.existsSync(DB_FILE)) { fs.copyFileSync(DB_FILE, aside); moved.push(aside); }

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.copyFileSync(file, DB_FILE);

  /* WAL/SHM 是**旧库**的附带状态，必须删掉：
     留着它们等于让 SQLite 用旧事务日志去修补新库文件 —— 结果是损坏。 */
  const removed = [];
  for (const f of [DB_FILE + '-wal', DB_FILE + '-shm']) {
    if (fs.existsSync(f)) { fs.rmSync(f); removed.push(f); }
  }

  const info = counts(DB_FILE);
  log(`${C.g}✓ 已从备份恢复${C.x}  ${path.basename(file)} → ${DB_FILE}`);
  log(`   岗位 ${info.jobs ?? '-'} · 候选人 ${info.candidates ?? '-'} · 用户 ${info.users ?? '-'} · schema v${info.schemaVersion ?? '-'}`);
  if (moved.length) log(`   ${C.d}原库已另存为 ${path.basename(moved[0])}（确认无误后可手动删除）${C.x}`);
  if (removed.length) log(`   ${C.d}已清理 ${removed.map(f => path.basename(f)).join(' / ')}${C.x}`);
  log(`   ${C.d}下一步：启动服务（npm run dev）并用原账号登录验证。${C.x}`);
}

function usage() {
  log('用法：');
  log('  node tools/backup.js                     备份（保留最近 14 份）');
  log('  node tools/backup.js --keep 30           备份并保留 30 份');
  log('  node tools/backup.js --dir D:/hr-backup  备份到指定目录');
  log('  node tools/backup.js --list              列出已有备份');
  log('  node tools/backup.js --verify <file>     校验备份可用性');
  log('  node tools/backup.js --restore <file>    从备份恢复（需先停服，--force 可跳过检查）');
  log(`\n当前库：${DB_FILE}`);
  log(`备份目录：${BACKUP_DIR}`);
}

(async () => {
  if (has('--help') || has('-h')) return usage();
  if (has('--list')) return doList();
  if (has('--verify')) return doVerify(arg('--verify'));
  if (has('--restore')) return doRestore(arg('--restore'));
  return doBackup();
})();
