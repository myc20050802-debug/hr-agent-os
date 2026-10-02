#!/usr/bin/env node
/**
 * 回归运行器自身的守卫：**有套件没跑，就不许报「通过」**。
 *
 * 背景（真踩过）：没装 jsdom 时 4 个前端套件会被静默跳过，而运行器照样打印绿色
 * 「全部通过」并 exit 0 —— 于是本地的「半跑」看起来是全绿。CI 里有一条独立的
 * require.resolve('jsdom') 断言兜底，本地没有，所以把运行器的行为锁在这里。
 *
 * 做法：用真运行器（子进程）跑 `--only frontend`，并打开 HR_SIMULATE_NO_JSDOM=1
 * 强制走跳过路径，断言三件事：
 *   ① 退出码 = 4（不是 0）；② 输出写明「结论不完整」；③ 输出里不再出现「全部通过」。
 * 绿路径（12 套件全跑、exit 0、打「全部通过」）由父运行器本身每轮验证，这里不重复跑。
 * 反向验证：把 run_all.js 的 `skipped ? 4 : 0` 改回 `0`（或去掉 else-if 分支），本套件立刻变红。
 */
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

let pass = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('HR-Agent OS · 回归运行器（防假绿）');
console.log('  隔离端口 8811（不抢父运行器的 8799）· 强制模拟「未安装 jsdom」\n');

const r = spawnSync(NODE, ['tools/run_all.js', '--only', 'frontend'], {
  cwd: ROOT,
  env: Object.assign({}, process.env, {
    HR_SIMULATE_NO_JSDOM: '1',
    TEST_PORT: '8811',
  }),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  timeout: 180000,
});
const out = (r.stdout || '') + (r.stderr || '');

ok(r.status === 4, '有套件未运行时，运行器退出码 = 4（不是 0）', '实际退出码 ' + r.status);
ok(/结论不完整/.test(out), '输出写明「结论不完整」');
ok(!/全部通过/.test(out), '不再出现「全部通过」字样');
ok(/未运行/.test(out), '逐个列出未运行的套件');
ok(/npm i -D jsdom/.test(out), '给出可执行的补救命令');

if (fails.length) {
  console.log('\n--- 子运行器输出（尾部 30 行）---');
  console.log(out.split('\n').slice(-30).join('\n'));
}

console.log('\n通过 ' + pass + ' 项' + (fails.length ? '，失败 ' + fails.length + ' 项' : ''));
process.exit(fails.length ? 1 : 0);
