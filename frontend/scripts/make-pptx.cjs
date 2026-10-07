/**
 * 用「逐页整图」方式生成 PPTX —— 保证与 HTML 版 100% 视觉一致
 *
 * 为什么不是 HTML→PPTX 原生转换：`html2pptx` 对自定义版式不可用（文字全堆左上角、
 * 版式全丢）。逐页整图 = 2x PNG 满版贴入，满分保真；代价是文字不可编辑。
 * 详见 .workbuddy/memory/MEMORY.md 的「面试 PPT 工坊」一节。
 *
 * 用法: node make-pptx.cjs <pagesDir> <pagesJson> <outPptx>
 *
 * 前置：先跑 frontend/scripts/shoot-slides.py 产出 page-N.png
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 定位 pptxgenjs。
 *
 * 这里刻意不写死任何本机路径 —— 仓库有一条不变量：**不得出现「本机盘符 + 用户名」
 * 形式的绝对路径**（提交前用 git grep 自查必须零命中），否则这份代码别人 clone
 * 下来跑不了，而作者本机却「看起来正常」。
 *
 * 也不写死版本号：专家包升级后目录名会从 1.0.13 变成别的，写死必坏。
 * 按 ① 环境变量 ② 本地 node_modules ③ 专家缓存里扫到的任意版本 依次尝试。
 */
function resolvePptxGenJS() {
  const candidates = [];

  if (process.env.PPTXGENJS_PATH) candidates.push(process.env.PPTXGENJS_PATH);

  const cacheRoot = path.join(
    os.homedir(), '.workbuddy', 'plugins', 'cache', 'experts', 'ppt-implement');
  if (fs.existsSync(cacheRoot)) {
    for (const ver of fs.readdirSync(cacheRoot)) {
      candidates.push(path.join(
        cacheRoot, ver, 'skills', 'ppt-implement', 'scripts', 'export',
        'node_modules', 'pptxgenjs'));
    }
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    return require.resolve('pptxgenjs');   // 若将来装进本地依赖
  } catch (e) { /* 落到下面的报错 */ }

  console.error('找不到 pptxgenjs。可任选一种方式：\n' +
    '  • 设环境变量 PPTXGENJS_PATH 指向 pptxgenjs 目录\n' +
    '  • 在 frontend/ 下 npm i -D pptxgenjs\n' +
    '  • 安装 WorkBuddy 专家包 ppt-implement');
  process.exit(4);
}

const PptxGenJS = require(resolvePptxGenJS());

const [pagesDir, pagesJson, outPptx] = process.argv.slice(2);
if (!pagesDir || !pagesJson || !outPptx) {
  console.error('usage: node make-pptx.cjs <pagesDir> <pagesJson> <outPptx>');
  process.exit(2);
}

// 1440x810 px @96DPI  → 15in x 8.4375in
const W = 15, H = 8.4375;

const titles = new Map();
try {
  for (const p of JSON.parse(fs.readFileSync(pagesJson, 'utf-8'))) {
    titles.set(p.pageNum, p.title || '');
  }
} catch (e) {
  console.warn('pages.json 读取失败，跳过备注:', e.message);
}

const pngs = fs.readdirSync(pagesDir)
  .filter(f => /^page-(\d+)\.png$/.test(f))
  .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10));

if (pngs.length === 0) {
  console.error('未找到 page-N.png');
  process.exit(3);
}

const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'DECK_16_9', width: W, height: H });
pptx.layout = 'DECK_16_9';
pptx.author = '马云冲';
pptx.title = 'HR-Agent OS · 招聘全链路 AI Agent 平台';

for (const f of pngs) {
  const n = parseInt(f.match(/(\d+)/)[1], 10);
  const slide = pptx.addSlide();
  slide.addImage({ path: path.join(pagesDir, f), x: 0, y: 0, w: W, h: H });
  const t = titles.get(n);
  if (t) slide.addNotes(`${n}. ${t}`);
}

pptx.writeFile({ fileName: outPptx })
  .then(fp => console.log(`OK slides=${pngs.length} -> ${fp}`))
  .catch(e => { console.error('ERR:', e.message); process.exit(1); });
