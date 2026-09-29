#!/usr/bin/env node
/**
 * 把 src/ 下的 CSS/JS 内联进 shell.html，产出单文件 index.html。
 *
 * 为什么要打成单文件：
 *   1. 双击即可运行，不依赖任何服务器或网络；
 *   2. 发给客户/同事时只有一个文件，不会出现「样式丢了」；
 *   3. 内联后不存在跨域与相对路径问题。
 *
 * 为什么用 Node 而不是 Python：
 *   构建环节不该再引入第二个运行时依赖。服务端本身就是零依赖的 Node，
 *   构建脚本也用它 —— 克隆下来 `npm run build` 就能打包，机器上不需要 Python。
 *
 * 用法：npm run build   （等价于 node 平台原型/build.js）
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const SRC = path.join(HERE, 'src');
const SHARED = path.join(path.dirname(HERE), 'shared');
const OUT = path.join(HERE, 'index.html');

/* 统一按 UTF-8 读取并归一换行为 LF。
   源文件可能混着 CRLF/LF（.gitattributes 只在检出时归一），
   原样内联会让产物混着两种换行，diff 变得不可读。 */
const readLF = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const readSrc = n => readLF(path.join(SRC, n));

let shell = readSrc('shell.html');
shell = shell.replace('__CSS__', readSrc('app.css'));
/* req-lib 必须最先注入：data.js / agent.js 都要用 window.ReqLib */
shell = shell.replace('__REQLIB__', readLF(path.join(SHARED, 'req-lib.js')));
/* 推翻原因枚举：与后端同一份 shared/override-codes.js（避免前端能选、后端不认） */
shell = shell.replace('__OVERRIDECODES__', readLF(path.join(SHARED, 'override-codes.js')));
shell = shell.replace('__DATA__', readSrc('data.js'));
shell = shell.replace('__AGENT__', readSrc('agent.js'));
shell = shell.replace('__APP__', readSrc('app.js'));

/* 构建时间用北京时间（UTC+8），与全项目时间口径一致 */
const bj = new Date(Date.now() + 8 * 3600 * 1000);
const pad = n => String(n).padStart(2, '0');
const built = bj.getUTCFullYear() + '-' + pad(bj.getUTCMonth() + 1) + '-' + pad(bj.getUTCDate())
  + ' ' + pad(bj.getUTCHours()) + ':' + pad(bj.getUTCMinutes());
shell = shell.replace('__BUILT__', built);

/* 占位符必须全部被替换。
   漏一个的后果是「页面打开一片空白」，而且只有打开浏览器才会发现 ——
   构建期直接失败，比事后排查便宜得多。 */
const left = shell.match(/__[A-Z]+__/g);
if (left) {
  console.error('✗ 仍有未替换的占位符：' + Array.from(new Set(left)).join(', '));
  process.exit(1);
}
/* 四段脚本各自暴露的全局变量，少一个说明某段 src 没被真正内联进去 */
const MARKERS = ['window.ReqLib', 'window.OverrideCodes', 'window.DB', 'window.Agent', 'window.__app'];
const miss = MARKERS.filter(k => shell.indexOf(k) < 0);
if (miss.length) {
  console.error('✗ 产物里找不到预期内容（可能未内联成功）：' + miss.join(', '));
  process.exit(1);
}

fs.writeFileSync(OUT, shell, 'utf8');
console.log('OK -> ' + OUT + ' (' + shell.length.toLocaleString('en-US') + ' chars, built ' + built + ')');
