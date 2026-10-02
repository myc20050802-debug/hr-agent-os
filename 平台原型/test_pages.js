/* 无头回归 · GitHub Pages 静态托管分支
   验证「零安装在线 demo」这条链路，以及它最容易悄悄坏掉的三个地方：

     ① 自包含 —— 一旦有人在 shell.html 里加外部 <script src>/<link href>，
        Pages 上会 404 白屏，而本地 file:// 打开完全看不出来（外链在本地也许能连上）。
     ② 宿主分流 —— 同一个「探测不到后端」的分支，本机用户该看到「双击 server/start.bat」，
        静态托管的访客该看到「在线预览 · 离线模式」。给错话术就是把人引到一条走不通的路上。
     ③ 离线可渲染 —— 没有后端时 24 个页面仍要全部渲染、0 运行时错误
        （不然「零安装 demo」就是个打不开的白页）。

   用法：NODE_PATH=<workspace>/node_modules node test_pages.js
   输出同时写入 ../_test_pages.txt（UTF8），避免控制台编码问题 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.resolve(__dirname, 'index.html');
const OUT = path.join(__dirname, '..', '_test_pages.txt');
const lines = [];
const log = (...a) => lines.push(a.map(x => String(x)).join(' '));
process.on('exit', () => { try { fs.writeFileSync(OUT, lines.join('\n'), 'utf8'); } catch (e) { } });

const fails = [];
const ok = (name, cond, extra) => {
  log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) fails.push(name);
};
const section = t => log('\n=== ' + t + ' ===');

const html = fs.readFileSync(file, 'utf8');

/* ---------- ① 自包含（静态检查，不需要跑） ---------- */
section('① 原型自包含（Pages 上不依赖任何外部文件）');
const extRefs = [...html.matchAll(/<script[^>]+src="([^"]+)"|<link[^>]+href="([^"]+)"/g)].map(m => m[1] || m[2]);
ok('无外部 <script src> / <link href> 引用', extRefs.length === 0, extRefs.join(', ') || '0 处');
ok('内联了样式块', /<style[\s>]/.test(html), (html.match(/<style[\s>]/g) || []).length + ' 个');
/* 词库必须已被 build.js 真正内联，而不是留着占位符 */
const ph = ['__REQLIB__', '__AGENT__', '__SCOREWHY__', '__DATA__'].filter(p => html.indexOf(p) !== -1);
ok('构建占位符已全部替换（无 __REQLIB__ 等残留）', ph.length === 0, ph.join(', ') || '0 处');

/* ---------- 通用：以某个 url 加载并等待启动 ---------- */
async function boot(url, label) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('[jsdomError] ' + (e.stack || e.message)));
  vc.on('error', (...a) => errors.push('[console.error] ' + a.join(' ')));
  vc.on('warn', () => { });
  vc.on('log', () => { });

  const dom = await new Promise((resolve, reject) => {
    const d = new JSDOM(html, {
      url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    });
    d.window.addEventListener('load', () => resolve(d));
    setTimeout(() => resolve(d), 3000);
  });
  await new Promise(r => setTimeout(r, 700));   /* 让 liveBootstrap 的探测（1.2s 超时）走完 */
  return { dom, window: dom.window, errors, label };
}

/* ---------- ② 宿主分流 ---------- */
(async () => {
  /* 场景 A：静态托管（GitHub Pages 形态）—— hostname 不是本机 */
  const R = await boot('https://demo.example.org/hr-agent-os/', '远端静态托管');
  const barR = R.window.document.getElementById('connBar');
  const txtR = (barR && barR.textContent) || '';

  section('② 宿主分流：静态托管（模拟 GitHub Pages）');
  ok('window.__app 已暴露（脚本真的跑了）', !!R.window.__app);
  ok('连接状态条可见（必须向访客解释当前是离线演示）', !!barR && !barR.hidden, barR ? 'hidden=' + barR.hidden : '无 #connBar');
  ok('文案标明这就是「在线预览 · 离线模式」', txtR.indexOf('在线预览 · 离线模式') !== -1, txtR.slice(0, 70));
  ok('不把访客引向他不存在的 server/start.bat', txtR.indexOf('start.bat') === -1,
    txtR.indexOf('start.bat') === -1 ? '未出现' : '出现了 start.bat');
  ok('说明了「这里没有后端」这一事实', /没有后端|跑不起来/.test(txtR));

  /* 场景 B：本机 file:// 双击 —— 应保留原有引导 */
  const L = await boot('file:///' + file.replace(/\\/g, '/'), '本机 file://');
  const barL = L.window.document.getElementById('connBar');
  const txtL = (barL && barL.textContent) || '';

  section('② 宿主分流：本机 file:// 双击');
  ok('window.__app 已暴露', !!L.window.__app);
  ok('连接状态条可见', !!barL && !barL.hidden);
  ok('文案为「离线演示态」并引导启动后端', txtL.indexOf('离线演示态') !== -1, txtL.slice(0, 70));
  ok('本机文案与托管文案确实不同（分流真的生效）', txtL !== txtR);

  /* ---------- ③ 两种宿主下都要能渲染全部页面 ---------- */
  for (const [ctx, tag] of [[R, '静态托管'], [L, '本机 file://']]) {
    section('③ 离线可渲染 · ' + tag);
    const app = ctx.window.__app;
    /* 页面清单从 PAGES 派生 —— 与 test_prototype.js/test_live.js 同一事实源，不会漏页 */
    const ids = Object.keys(app.PAGES);
    ok('页面清单非空', ids.length > 0, ids.length + ' 页');
    let bad = 0;
    for (const id of ids) {
      try {
        app.state.page = id;
        app.render();
        const host = ctx.window.document.querySelector('#pageHost');
        const len = host.innerHTML.length;
        const hasUndef = /undefined|\[object Object\]|NaN/.test(host.textContent || '');
        if (len < 400 || hasUndef) { bad++; log('      ⚠️ ' + id + ' len=' + len + ' 可疑=' + hasUndef); }
      } catch (e) { bad++; log('      ✗ [render:' + id + '] ' + e.message); }
    }
    ok(ids.length + ' 个页面全部渲染无异常', bad === 0, bad + ' 个可疑');
    ok('无运行时错误', ctx.errors.length === 0, ctx.errors.slice(0, 2).join(' | ') || '0 条');
  }

  /* ---------- 结果 ---------- */
  log('\n================ 结果 ================');
  if (fails.length) {
    log('❌ 失败 ' + fails.length + ' 项：');
    fails.forEach(f => log('   · ' + f));
    process.exit(1);
  }
  log('✅ 全部通过：自包含 + 宿主分流 + 两种宿主下离线渲染均正常');
  process.exit(0);
})().catch(e => { log('加载失败: ' + (e && e.stack || e)); process.exit(1); });
