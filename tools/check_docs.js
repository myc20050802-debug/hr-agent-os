#!/usr/bin/env node
/* ===========================================================
   HR-Agent OS · 文档与结构一致性守卫（doc-truth guard）
   -----------------------------------------------------------
   为什么需要它：
     文档与测试里写死的数字**没有单一数据源**，每次加一个页面都要人肉去 8 个地方改。
     人一定会忘。实测证据（本脚本上线前）：
       · 「页面数」在 4 篇文档里有 3 个不同值 —— README/docs.04/docs.09 写 23、
         docs/02 写 12，而代码事实是 24；
       · README 的原型体积停在 491,922，实际已 527,133（差 35 KB）；
       · `test_live.js` 写死 23 个页面 id，新加的「岗位资料库」页**被静默漏测**，
         而套件照样打印「全部通过」—— 假绿比失败更危险。

   ★ design：为什么用「锚点」而不是「正则扫描全文」
     试过扫描全文 —— 误报太多，因为文档里**合法地**存在历史数字：
       · `docs/09` 有一张体积演进表（436,610 → 468,655 → 491,922）
       · `docs/05` 的 159,744 是**数据库文件**大小，与原型无关
       · `docs/07` 的 389,471 是项目计划书里的规划值
     这些改了反而错。所以本守卫只断言**已知的「现状句」锚点**：
     每行算出「这句话现在应该长什么样」，然后要求文档真的含有它。
     好处：零误报；数字变了会指名道姓告诉你要改哪一句；历史记录不受影响。

   覆盖的事实源（全部从代码 / 文件系统读，不手写）：
     · 页面数          ← 平台原型/src/app.js 的 PAGES.* 定义去重计数
     · 导航项数        ← 页面数 + 目录节点数
     · 原型字节数      ← 平台原型/index.html 的实际大小
     · 后端接口数      ← server/routes.js 的 r.<verb>('<path>') 计数
     · 评测指标        ← tools/golden/baseline.json（test_eval.js --write-baseline 产出）
   覆盖的结构不变量：
     · 前端套件的页面清单必须**从 app.PAGES 派生**，禁止再写死 id 数组
     · PAGES 无重复定义；原型已打包

   用法：
     node tools/check_docs.js          # 校验；失败退出码 1（已接入 CI 与 npm test）
     node tools/check_docs.js --list   # 只打印真实值
   =========================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIST_ONLY = process.argv.includes('--list');

/* 前端套件：页面清单必须从 app.PAGES 派生，不许写死 */
const FRONTEND_SUITES = [
  '平台原型/test_prototype.js',
  '平台原型/test_live.js',
  '平台原型/test_pages.js',
];
const DERIVE_MARK = 'Object.keys(app.PAGES)';

/* ===========================================================
   一 · 事实源
   =========================================================== */
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function realFacts() {
  const app = read('平台原型/src/app.js');
  const pages = [...new Set([...app.matchAll(/PAGES\.([A-Za-z]+)\s*=/g)].map(m => m[1]))];

  const routes = read('server/routes.js');
  const api = [...routes.matchAll(/r\.(?:get|post|put|patch|delete)\('([^']+)'/g)].map(x => x[1]);

  const htmlBytes = fs.statSync(path.join(ROOT, '平台原型/index.html')).size;

  /* docs/ 顶层的源文档数（README 的「N 篇源文档」锚点用）。
     只数顶层 .md —— docs/html|archive|样例 下是生成物，不算「源文档」。 */
  const docMd = fs.readdirSync(path.join(ROOT, 'docs')).filter(n => n.endsWith('.md')).length;

  /* 导航项数 = 页面数 + 目录节点数。
     目录节点是「招聘 Agent」那个可折叠目录头：它自己是 .navitem 但没有对应 PAGES
     （子页面才对应）。结构由 tools/test_nav.js 的「flatNav 与 PAGES 一一对应」守住。
     在线实测：24 页 + 1 目录节点 = 25 个 .navitem。 */
  const NAV_CATALOG_NODES = 1;

  /* 回归套件数：从 run_all.js 的 SUITES 读（kind='load' 需 opt-in，不计入默认回归） */
  const runAll = read('tools/run_all.js');
  const suiteDefs = [...runAll.matchAll(/\{\s*id:\s*'([a-z]+)',\s*kind:\s*'([a-z]+)'/g)]
    .map(m => ({ id: m[1], kind: m[2] }));
  const suites = {
    total: suiteDefs.filter(s => s.kind !== 'load').length,
    backend: suiteDefs.filter(s => s.kind === 'backend').length,
    self: suiteDefs.filter(s => s.kind === 'self').length,
    frontend: suiteDefs.filter(s => s.kind === 'frontend').length,
  };

  /* 空库自建到的最新 schema 版本：取 migrations.js 里最大的 version */
  const schemaVer = Math.max(...[...read('server/migrations.js').matchAll(/version:\s*(\d+)/g)]
    .map(m => Number(m[1])));

  /* 前端套件是否都从 PAGES 派生页面清单（并检查有没有人又写死一份） */
  const derives = FRONTEND_SUITES.map(f => {
    const exists = fs.existsSync(path.join(ROOT, f));
    const src = exists ? read(f) : '';
    return {
      file: f, exists,
      derives: src.indexOf(DERIVE_MARK) !== -1,
      hardcoded: /const\s+ids\s*=\s*\[/.test(src),
    };
  });

  /* 评测指标：唯一源 = tools/golden/baseline.json（由 test_eval.js --write-baseline 产出）。
     这些数字过去是手抄进 README / 文档的，实测漂移过一次 ——
     README 表格已写 8.3%，同一篇正文仍写着「不回避 25% 的漏筛率」。 */
  const bPath = path.join(ROOT, 'tools', 'golden', 'baseline.json');
  const evalM = fs.existsSync(bPath) ? JSON.parse(fs.readFileSync(bPath, 'utf8')) : null;

  return {
    evalM,
    pages: pages.length,
    pageSet: pages,
    navItems: pages.length + NAV_CATALOG_NODES,
    htmlBytes,
    htmlKb: Math.round(htmlBytes / 1024),
    docMd,
    apiCount: api.length,
    suites,
    schemaVer,
    derives,
  };
}

const comma = n => n.toLocaleString('en-US');
/* 与 test_eval.js 的 pct() 同一口径（保留 1 位小数），否则文档锚点会差一个字 */
const pctOf = x => (x * 100).toFixed(1) + '%';

/* ===========================================================
   二 · 现状句锚点
   -----------------------------------------------------------
   每项 = 一个文件 + 一句「现在应该长什么样」（由事实算出）。
   要求文档里能找到这句话；找不到就是过期或写错。
   count = 期望出现次数（默认 ≥1）。
   =========================================================== */
const ANCHORS = [
  /* --- 主入口 --- */
  {
    file: 'README.md', count: 1, why: '交付物表里的原型规格',
    must: f => `单文件 **${comma(f.htmlBytes)} bytes（约 ${f.htmlKb}KB）**，${f.pages} 个页面`,
  },
  /* --- 手把手教程 --- */
  {
    file: 'docs/02_搭建实操教程.md', count: 1, why: '原型里可动手试的第 1 条',
    must: f => `左侧菜单切换 ${f.pages} 个页面`,
  },
  {
    file: 'docs/03_本地全栈版运行说明.md', count: 1, why: '目录树注释里的产物规格',
    must: f => `index.html              产物，${comma(f.htmlBytes)} bytes（约 ${f.htmlKb}KB）`,
  },
  /* --- 产品复盘 --- */
  {
    file: 'docs/04_产品复盘_从0到1怎么做出来的.md', count: 1, why: '「我做的动作」第 3 条',
    must: f => `**覆盖 ${f.pages} 个页面**`,
  },
  {
    file: 'docs/04_产品复盘_从0到1怎么做出来的.md', count: 1, why: '「我做的验证」第 1 条',
    must: f => `各自覆盖 **${f.pages} 个页面渲染`,
  },
  /* --- 验收报告 --- */
  {
    file: 'docs/09_实现说明与验收报告.md', count: 1, why: '段 B 无头回归输出（导航项 = 页面 + 目录节点）',
    must: f => `导航项 ${f.navItems} 个`,
  },
  {
    file: 'docs/09_实现说明与验收报告.md', count: 1, why: '段 B 无头回归输出',
    must: f => `${f.pages} 个页面渲染：异常 0 个`,
  },
  /* --- 合并阅读版（docs/html/ 下的生成物，与上面 md 同句，必须同步） --- */
  {
    file: 'docs/html/HR-AI-Agent平台_产品方案.html', count: 1, why: '= docs/01+02+03 合并阅读版',
    must: f => `左侧菜单切换 ${f.pages} 个页面`,
  },
  {
    /* 注意：HTML 里 `**覆盖 N 个页面**` 会被渲成 <strong> 包裹，所以锚点要带上 </strong>，
       否则会和下面那条「各自覆盖 <strong>N 个页面渲染」的句子混淆、少命中一次。 */
    file: 'docs/html/HR-AI-Agent平台_从0到1产品复盘.html', count: 1, why: '= docs/04 阅读版（「我做的动作」）',
    must: f => `覆盖 ${f.pages} 个页面</strong>`,
  },
  {
    file: 'docs/html/HR-AI-Agent平台_从0到1产品复盘.html', count: 1, why: '= docs/04 阅读版（「我做的验证」）',
    must: f => `${f.pages} 个页面渲染`,
  },
  {
    file: 'docs/html/HR-AI-Agent平台_实现验收报告.html', count: 1, why: '= docs/09 阅读版（导航项 = 页面 + 目录节点）',
    must: f => `导航项 ${f.navItems} 个`,
  },
  {
    file: 'docs/html/HR-AI-Agent平台_实现验收报告.html', count: 1, why: '= docs/09 阅读版',
    must: f => `${f.pages} 个页面渲染`,
  },
  /* --- 对外交付包（gitignore，但最容易过期：实测曾停在 9-24） --- */
  {
    file: '分享包/使用说明.txt', count: 1, why: '对外演示包说明（未入库，最易过期；用 npm run share 重新生成）',
    must: f => `${f.pages} 个页面`,
    optional: true,
  },
  /* --- README 的「测试」章节：套件数 / 页数 / schema 一律从代码读 ---
     这一段曾整段过期：套件数 10→11、--only backend 5→4、23 页→24 页、
     schemaVersion 6→9、表 19→20 / 索引 20→23。全是同一类病。 */
  {
    file: 'README.md', count: 1, why: '一键回归命令块里的套件数',
    must: f => `# 功能回归：${f.suites.total} 套件`,
  },
  {
    file: 'README.md', count: 1, why: '--only backend 的套件数',
    must: f => `# 只跑后端 ${f.suites.backend} 套件`,
  },
  {
    file: 'README.md', count: 1, why: '当前状态行',
    must: f => `**全部 0 失败 · ${f.suites.total} 套件全绿**`,
  },
  {
    file: 'README.md', count: 1, why: '离线套件的页数',
    must: f => `# 离线：${f.pages} 页渲染`,
  },
  {
    file: 'README.md', count: 1, why: '在线套件的页数',
    must: f => `# 真后端：${f.pages} 页渲染`,
  },
  {
    file: 'README.md', count: 1, why: '空库自建到的最新 schema 版本',
    must: f => `空库自动跑到 \`schemaVersion: ${f.schemaVer}\``,
  },
  /* --- README 的「质量与性能实测」：评测指标（唯一源 = tools/golden/baseline.json）
     这几行过去是手抄的，实测漂移过一次（表里 8.3% / 正文 25%）。
     现在数字一变，守卫会指名道姓告诉你该改成什么。 --- */
  {
    file: 'README.md', count: 1, why: '档位一致率（源：tools/golden/baseline.json）',
    must: f => `| 档位一致率 | **${pctOf(f.evalM.exactAgreement)}**（${f.evalM.same}/${f.evalM.n}） |`,
  },
  {
    file: 'README.md', count: 1, why: '±1 档一致率（源：baseline）',
    must: f => `| ±1 档一致率 | **${pctOf(f.evalM.within1Agreement)}**（${f.evalM.near}/${f.evalM.n}） |`,
  },
  {
    file: 'README.md', count: 1, why: '误筛率（源：baseline；安全红线）',
    must: f => `| 误筛率 | **${pctOf(f.evalM.missRate)}**（${f.evalM.missed}/${f.evalM.shouldPass}） |`,
  },
  {
    file: 'README.md', count: 1, why: '漏筛率（源：baseline）',
    must: f => `| 漏筛率 | **${pctOf(f.evalM.falsePassRate)}**（${f.evalM.overPassed}/${f.evalM.shouldReject}） |`,
  },
  {
    file: 'README.md', count: 1,
    why: '漏筛率的口径解释句（曾与上表自相矛盾：表里 8.3%、正文仍写 25%）',
    must: f => `不回避 **${pctOf(f.evalM.falsePassRate)}** 的漏筛率`,
  },
  {
    file: 'README.md', count: 1,
    why: 'docs/ 顶层的源文档数（一直靠手数；加 docs/20 时确实漂过 21→22）',
    must: f => `**${f.docMd} 篇源文档**`,
  },
];

/* ===========================================================
   二b · 负向锚点：过期数字不得在「现状类」文档里复活
   -----------------------------------------------------------
   正向锚点只能保证「该出现的那句话在」，管不住「别处又写错了」。
   实测：页面数 23 → 24 时，8 篇文档里残留 24 处「23 页」，
   而正向锚点总共只钉住其中 2 句 —— 剩下的要靠人眼看，必漏。
   所以补一条负向规则：**旧值不得出现**。

   ★ 豁免清单（这几个文件保存的是「当时是多少」的证据，改掉才是篡改）：
     · CHANGELOG.md            —— 它就是变更历史，其中记录了这次漂移
     · docs/07_项目计划书.md    —— 规划值与里程碑检查点
     · docs/08_架构设计文档.md  —— 设计时点的快照
     · docs/09_实现说明与验收报告.md —— 实跑记录（当时套件写死 23 个 id，真漏测了 1 页）
     · docs/15_产品经理视角项目评估.md —— 明确标注为「16:45 审计快照」的时点文档
   =========================================================== */
const STALE_SCAN_EXEMPT = [
  'CHANGELOG.md',
  'docs/07_项目计划书.md',
  'docs/08_架构设计文档.md',
  'docs/09_实现说明与验收报告.md',
  'docs/15_产品经理视角项目评估.md',
];

/* 过期串：由事实算出（页面数前一个值），以及历史上真出过错的口径表述 */
function staleStrings(f) {
  return [
    { s: (f.pages - 1) + ' 页', note: '旧页面数（现为 ' + f.pages + ' 页）' },
    { s: '25% 的漏筛', note: '旧漏筛率（现为 ' + pctOf(f.evalM.falsePassRate) + '）' },
    { s: (f.docMd - 1) + ' 篇源文档', note: '旧源文档数（现为 ' + f.docMd + ' 篇）' },
    // 原型字节数会随任意文案改动而变（只差 9 字节就漏过一次）——
    // 实测：537,842 → 537,851 时只有 README/docs/03 被改，另 6 处（含作品集幻灯片）残留。
    // 旧值永不会再次成为现状，故直接钉死；docs/09 属豁免（保存的是当时证据）。
    { s: '537,842', note: '旧原型字节数（现为 ' + comma(f.htmlBytes) + ' bytes）' },
  ];
}

function scanStale(f) {
  const files = ['README.md'];
  for (const n of fs.readdirSync(path.join(ROOT, 'docs'))) {
    if (n.endsWith('.md')) files.push('docs/' + n);
  }
  // 作品集幻灯片也是一等交付物：它同样引用「从代码算出」的事实，旧值在这儿复活过
  const slidesDir = path.join(ROOT, 'frontend', 'src', 'slides');
  if (fs.existsSync(slidesDir)) {
    for (const n of fs.readdirSync(slidesDir)) {
      if (n.endsWith('.js')) files.push('frontend/src/slides/' + n);
    }
  }
  const hits = [];
  for (const file of files.filter(x => !STALE_SCAN_EXEMPT.includes(x))) {
    const src = read(file);
    const lines = src.split(/\r?\n/);
    for (const { s, note } of staleStrings(f)) {
      lines.forEach((line, i) => {
        if (line.includes(s)) hits.push(file + ':' + (i + 1) + '（' + note + '）');
      });
    }
  }
  return hits;
}

/* ===========================================================
   三 · 校验
   =========================================================== */
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
const facts = realFacts();

console.log('\n===== 文档一致性守卫 · 事实源（全部从代码读取）=====');
console.log('  页面数（PAGES.* 定义）       ' + facts.pages);
console.log('  导航项数（页面 + 目录节点）    ' + facts.navItems);
console.log('  后端接口数（routes.js）       ' + facts.apiCount);
console.log('  原型字节数（index.html）      ' + comma(facts.htmlBytes) + '  (约 ' + facts.htmlKb + ' KB)');
console.log('  回归套件数（run_all.js）      ' + facts.suites.total
  + '  (后端 ' + facts.suites.backend + ' / 自包含 ' + facts.suites.self + ' / 前端 ' + facts.suites.frontend + ')');
console.log('  schema 版本（migrations）     ' + facts.schemaVer);
if (facts.evalM) {
  const e = facts.evalM;
  console.log('  评测基线（golden/baseline）   一致率 ' + pctOf(e.exactAgreement) + '（' + e.same + '/' + e.n
    + '） / 误筛 ' + pctOf(e.missRate) + ' / 漏筛 ' + pctOf(e.falsePassRate)
    + ' / 门槛 ' + e.gates + ' 例 · REQ_LIB_VER ' + e.reqLibVer);
} else {
  console.log('  评测基线（golden/baseline）   ⚠ 文件缺失');
}

if (LIST_ONLY) {
  console.log('\n' + C.d + '  --list 模式：跳过断言' + C.x + '\n');
  process.exit(0);
}

console.log('\n===== 现状句锚点校验 =====');
let bad = 0, pass = 0, skipped = 0;

for (const a of ANCHORS) {
  const p = path.join(ROOT, a.file);
  if (!fs.existsSync(p)) {
    if (a.optional) { skipped++; console.log('  ' + C.d + '○ ' + a.file + '（不存在，跳过 —— ' + a.why + '）' + C.x); }
    else { bad++; console.log('  ' + C.r + '✗ ' + a.file + ' 文件不存在（' + a.why + '）' + C.x); }
    continue;
  }
  const src = read(a.file);
  const want = a.must(facts);
  const n = src.split(want).length - 1;
  if (n >= a.count) {
    pass++;
    console.log('  ' + C.g + '✓ ' + a.file + C.x + C.d + '  ' + want + C.x);
  } else {
    bad++;
    console.log('  ' + C.r + '✗ ' + a.file + '（' + a.why + '）' + C.x);
    console.log('  ' + C.r + '    期望出现 ' + a.count + ' 次，实际 ' + n + ' 次。应写为：' + C.x);
    console.log('  ' + C.y + '    ' + want + C.x);
    /* 给出「这句现在实际长什么样」的线索，便于直接定位 */
    const probe = want.replace(/\d[\d,]*/g, '').replace(/\s+/g, '');
    const lines = src.split(/\r?\n/);
    const near = [];
    for (let i = 0; i < lines.length && near.length < 2; i++) {
      const flat = lines[i].replace(/\s+/g, '');
      if (probe && flat.includes(probe.slice(0, Math.min(20, probe.length)))) near.push((i + 1) + ': ' + lines[i].trim().slice(0, 110));
    }
    if (near.length) { console.log('  ' + C.d + '    近似命中：' + C.x); near.forEach(s => console.log('  ' + C.d + '      ' + s + C.x)); }
  }
}

/* ---------- 结构不变量（比数字更重要） ---------- */
/* 所有**入库的生成物 HTML** 是否都在 .gitattributes 标了 linguist-generated。
   这份清单**过期过一次**（原 7 条，漏了 4 个文件），所以让它自动校验 ——
   新增一篇文档的 HTML 时忘了登记，靠人记必漏。
   文档收敛后阅读版搬到了 docs/html、docs/archive、docs/样例，扫描面必须跟着扩大：
   只扫根目录的话，这个坑会以「新目录里的 HTML 没人标」的形式原样回来。 */
const attrPats = read('.gitattributes').split(/\r?\n/)
  .filter(l => l.includes('linguist-generated'))
  .map(l => l.trim().split(/\s+/)[0])
  .map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
function collectHtml(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'logs'].includes(e.name)) continue;
    /* artifacts / dist / dist-slides 是构建产物（.gitignore 已排除，不随仓库分发）。
       要求它们也标 linguist-generated 没有意义 —— 只会「本地一构建，守卫就假红」：
       实测 artifacts/index.html + artifacts/404.html 就这么把守卫顶红过。
       跟踪文件不会落在这些目录下（已用 git ls-files 断言），排除是安全的。 */
    if (['artifacts', 'dist', 'dist-slides'].includes(e.name)) continue;
    if (e.name === '分享包') continue;              /* 不入库（gitignore），不必标 */
    if (e.isDirectory() && e.name === 'src') continue; /* 平台原型/src 是源码，不是生成物 */
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectHtml(p, acc);
    else if (e.name.endsWith('.html')) acc.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return acc;
}
const unmarkedHtml = collectHtml(ROOT, []).filter(f => !attrPats.some(r => r.test(f)));

console.log('\n===== 结构不变量 =====');
const staleHits = facts.evalM ? scanStale(facts) : ['（跳过：评测基线缺失）'];

/* 「加粗符号紧贴网址」扫描：`**https://…**` 这种写法，在源码视图复制时会把 `**`
   一起带进地址栏 → 线上 404。实战踩过：README 的 demo 链接被面试官一点就 404。
   markdown 链接语法 `[文字](网址)` 才安全（网址两侧是 `(` 与 `)`，不与 `**` 相邻）。 */
function hasGluedUrl(file) {
  let txt; try { txt = read(file); } catch { return false; }
  let fence = false;
  for (const line of txt.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;                       /* 代码块内的示例不算命中 */
    if (/\*\*https?:\/\//.test(line)) return true;
  }
  return false;
}
const gluedUrlFiles = ['README.md',
  ...fs.readdirSync(path.join(ROOT, 'docs')).filter(n => n.endsWith('.md')).map(n => 'docs/' + n)]
  .filter(hasGluedUrl);

const invariants = [
  ['评测基线存在（tools/golden/baseline.json）', !!facts.evalM],
  ['「加粗符号紧贴网址」写法为零（否则复制会把 ** 带进地址栏 → 404）'
    + (gluedUrlFiles.length ? '（命中：' + gluedUrlFiles.join(', ') + '）' : ''),
    gluedUrlFiles.length === 0],
  ['旧值未在「现状类」文档里复活' + (staleHits.length ? '（命中：' + staleHits.join('、') + '）' : ''),
    staleHits.length === 0],
  ['PAGES 定义无重复', new Set(facts.pageSet).size === facts.pages],
  ['入库的生成物 HTML 全部标了 linguist-generated' + (unmarkedHtml.length ? '（缺：' + unmarkedHtml.join(', ') + '）' : ''),
    unmarkedHtml.length === 0],
  ['页面数 > 0', facts.pages > 0],
  ['原型已打包（index.html 存在且非空）', facts.htmlBytes > 1000],
  ['套件分类计数自洽（total = backend + self + frontend）',
    facts.suites.total === facts.suites.backend + facts.suites.self + facts.suites.frontend],
  [
    '前端套件的页面清单全部从 app.PAGES 派生（禁止写死 id 数组）',
    facts.derives.filter(d => d.exists).every(d => d.derives && !d.hardcoded),
  ],
];
for (const [name, ok] of invariants) {
  console.log('  ' + (ok ? C.g + '✓' : C.r + '✗') + ' ' + name + C.x);
  if (!ok) bad++;
}
/* 逐套件明细：写死了哪一份、或没派生，单独点出来 */
for (const d of facts.derives) {
  if (!d.exists) { console.log('  ' + C.d + '    ○ ' + d.file + '（不存在，跳过）' + C.x); continue; }
  if (d.derives && !d.hardcoded) continue;
  bad++;
  console.log('  ' + C.r + '    ✗ ' + d.file + C.x);
  if (d.hardcoded) console.log('  ' + C.r + '      仍存在写死的 `const ids = [` —— 新加页面会被静默漏测' + C.x);
  if (!d.derives) console.log('  ' + C.r + '      未使用 ' + DERIVE_MARK + ' 派生页面清单' + C.x);
}

console.log('\n========== 结果 ==========');
if (bad === 0) {
  console.log(C.g + '✅ 文档与代码一致（' + pass + ' 处锚点通过，' + skipped + ' 处跳过）' + C.x + '\n');
  process.exit(0);
}
console.log(C.r + '❌ ' + bad + ' 处不一致 —— 数字以代码为准，去掉那个多余的数字' + C.x);
console.log(C.d + '   页面数 = PAGES.* 定义数；字节数 = 平台原型/index.html 实际大小（改完前端记得 npm run build）。' + C.x);
console.log(C.d + '   评测指标 = tools/golden/baseline.json（跑 test_eval.js --write-baseline 刷新）。' + C.x);
console.log(C.d + '   改完字节数顺手执行 npm run share，让对外演示包同步。' + C.x + '\n');
process.exit(1);
