/**
 * 用「逐页整图」方式生成 PPTX —— 保证与 HTML 版 100% 视觉一致
 * 用法: node make_pptx.cjs <pagesDir> <pagesJson> <outPptx>
 */
const fs = require('fs');
const path = require('path');

const PPTXGEN_PATH = 'C:/Users/mayunchong/.workbuddy/plugins/cache/experts/ppt-implement/1.0.13/skills/ppt-implement/scripts/export/node_modules/pptxgenjs';
const PptxGenJS = require(PPTXGEN_PATH);

const [pagesDir, pagesJson, outPptx] = process.argv.slice(2);
if (!pagesDir || !pagesJson || !outPptx) {
  console.error('usage: node make_pptx.cjs <pagesDir> <pagesJson> <outPptx>');
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
