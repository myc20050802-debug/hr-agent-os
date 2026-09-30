/* 导航结构回归：目录（catalog）→ 模块（module）→ Agent（页）
   用法：NODE_PATH=<workspace>/node_modules node tools/test_nav.js（或由 tools/run_all.js 调用）
   输出同时写入 ../_test_nav.txt（UTF8）

   为什么单独成一套：招聘域按「目录 + 业务流程模块」组织，最容易悄悄坏掉的是
   ① 新增 Agent 时忘了归到模块里；② 可见性聚合写错导致「有权限的页面被连带隐藏」。
   这两类问题都不会让页面渲染报错，只会让菜单少一项 —— 功能回归抓不到，必须专门断言。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.resolve(__dirname, '..', '平台原型', 'index.html');
const OUT = path.resolve(__dirname, '..', '_test_nav.txt');
const lines = [];
const log = (...a) => {
  const s = a.map(String).join(' ');
  lines.push(s);
  process.stdout.write(s + '\n');
};
process.on('exit', () => { try { fs.writeFileSync(OUT, lines.join('\n'), 'utf8'); } catch (e) {} });

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('[jsdomError] ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('[console.error] ' + a.join(' ')));
vc.on('warn', () => {});
vc.on('log', () => {});

JSDOM.fromFile(file, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc })
  .then(async dom => {
    const { window } = dom;
    await new Promise(r => setTimeout(r, 600));
    const $ = s => window.document.querySelector(s);
    const $$ = s => Array.from(window.document.querySelectorAll(s));
    const app = window.__app;
    if (!app) { log('❌ window.__app 未暴露'); process.exit(1); }

    let ok = 0;
    const t = (name, fn) => {
      try { fn(); ok++; log('  ✓ ' + name); }
      catch (e) { errors.push('[' + name + '] ' + e.message); log('  ✗ ' + name + ' → ' + e.message); }
    };

    app.state.page = 'jd'; app.render();

    t('侧边栏出现「招聘 Agent」目录节点', () => {
      const c = $('.navcatalog');
      if (!c) throw new Error('没有 .navcatalog');
      const head = $('.navcat-head');                     // data-catalog 挂在内层可点击的头上
      if (!head) throw new Error('缺少目录头 .navcat-head');
      if (head.dataset.catalog !== 'recruiting') throw new Error('目录 id 异常：' + head.dataset.catalog);
      if (head.querySelector('.navtext').textContent.trim() !== '招聘 Agent') throw new Error('目录名异常');
    });

    t('目录内按招聘流程分 4 个模块且顺序正确', () => {
      const want = ['岗位与需求', '筛选与评估', '面试与协调', '录用与入职'];
      const got = $$('.navmodule-title').map(x => x.textContent.trim());
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(JSON.stringify(got));
    });

    t('5 个招聘 Agent 全部归入目录，页面 id 一个没变', () => {
      const ids = $$('.navcatalog .navitem[data-page]').map(x => x.dataset.page).sort();
      const want = ['interview', 'invite', 'jd', 'offer', 'screen'];
      if (JSON.stringify(ids) !== JSON.stringify(want)) throw new Error(JSON.stringify(ids));
    });

    t('每个模块下的归属与设计一致', () => {
      const mods = $$('.navcatalog .navsub').map(sub =>
        Array.from(sub.querySelectorAll('.navitem[data-page]')).map(x => x.dataset.page));
      const want = [['jd'], ['screen'], ['invite', 'interview'], ['offer']];
      if (JSON.stringify(mods) !== JSON.stringify(want)) throw new Error(JSON.stringify(mods));
    });

    t('侧边栏显示短名（「招聘 Agent ·」前缀收进目录名，不再逐条重复）', () => {
      const names = $$('.navcatalog .navitem[data-page] .navtext').map(x => x.textContent.trim());
      const dup = names.filter(n => n.indexOf('招聘 Agent') !== -1);
      if (dup.length) throw new Error('叶子仍带前缀：' + JSON.stringify(dup));
      if (names.indexOf('JD 工作台') === -1) throw new Error(JSON.stringify(names));
    });

    t('面包屑把目录前缀补回来（不然用户不知道在哪个 Agent 里）', () => {
      const c = $('#crumbPage').textContent.trim();
      if (c !== '招聘 Agent · JD 工作台') throw new Error('面包屑 = ' + c);
    });

    t('目录头键盘可达且默认展开（aria-expanded）', () => {
      const h = $('.navcat-head');
      if (h.getAttribute('role') !== 'button') throw new Error('role 不是 button');
      if (h.getAttribute('tabindex') !== '0') throw new Error('tabindex 不是 0');
      if (h.getAttribute('aria-expanded') !== 'true') throw new Error('默认未展开');
    });

    /* 注意：jsdom 以 file:// 加载，origin 为 opaque，localStorage 访问会抛异常。
       真实环境里双击 index.html（file://）也一样 —— 所以代码必须 try/catch 兜底，
       这里同时验证「拿不到 localStorage 也不能崩」。 */
    const ls = (() => { try { return window.localStorage; } catch (e) { return null; } })();

    t('点击目录头可折叠 / 展开，状态写入 state' + (ls ? ' 并持久化' : '（本环境无 localStorage，仅验 state 兜底）'), () => {
      $('.navcat-head').click();
      if ($('.navcat-head').getAttribute('aria-expanded') !== 'false') throw new Error('点击后未折叠');
      if ($('.navcatalog').classList.contains('open')) throw new Error('折叠后仍带 open 类');
      if (app.state.catalogs.recruiting !== false) throw new Error('折叠状态未记录到 state');
      if (ls && ls.getItem('hr.nav.cat.recruiting') !== '0') throw new Error('未持久化到 localStorage');
      $('.navcat-head').click();
      if ($('.navcat-head').getAttribute('aria-expanded') !== 'true') throw new Error('再次点击未展开');
      if (ls && ls.getItem('hr.nav.cat.recruiting') !== '1') throw new Error('展开状态未持久化');
      if (app.state.catalogs.recruiting !== true) throw new Error('展开状态未记录到 state');
    });

    t('localStorage 不可用时折叠仍生效（file:// 双击演示场景不崩）', () => {
      if (ls) throw new Error('本环境 localStorage 可用，该兜底分支未被覆盖');
      $('.navcat-head').click();
      if ($('.navcat-head').getAttribute('aria-expanded') !== 'false') throw new Error('无 localStorage 时折叠失效');
      $('.navcat-head').click();
    });

    t('折叠后跳到目录内页面会自动展开（否则当前页在侧栏「隐身」）', () => {
      $('.navcat-head').click();                                  // 先折叠
      app.state.page = 'dashboard'; app.render();
      const leaf = $('.navcatalog .navitem[data-page="screen"]');
      if (!leaf) throw new Error('折叠状态下叶子节点被删掉了（应只隐藏样式）');
      leaf.click();
      if (app.state.page !== 'screen') throw new Error('未跳转到 screen');
      if ($('.navcat-head').getAttribute('aria-expanded') !== 'true') throw new Error('跳转后目录未自动展开');
      if ($('#crumbPage').textContent.trim() !== '招聘 Agent · 简历筛选台') throw new Error('面包屑未跟随');
    });

    t('折叠交互只重绘侧边栏，不重建页面', () => {
      app.state.page = 'jd'; app.render();
      const hostBefore = $('#pageHost').firstElementChild;
      $('.navcat-head').click();
      if ($('#pageHost').firstElementChild !== hostBefore) throw new Error('页面被整块重建了（表单会被冲掉）');
    });

    t('flatNav 覆盖全部页面 id，与 PAGES 一一对应', () => {
      const flat = app.flatNav(), pages = Object.keys(app.PAGES);
      if (flat.length !== pages.length) throw new Error(`flat=${flat.length} pages=${pages.length}`);
      const miss = pages.filter(p => !flat.some(x => x.id === p));
      if (miss.length) throw new Error('flatNav 漏页：' + miss.join(','));
    });

    t('目录可见性由子项聚合（不做成目录自身的 perm，避免连带丢页）', () => {
      const keys = Object.keys(app.NAV.flatMap(g => g.items).find(n => n.catalog) || {});
      if (keys.indexOf('perm') !== -1) throw new Error('目录节点挂了 perm，会造成连带隐藏');
    });

    /* 按能力裁剪是新增的聚合逻辑，最容易被写错的地方：
       招聘专员只有 screen:run 时，必须「目录留着、只见简历筛选台」，
       而不是「目录连同他能用的页面一起消失」。临时切到在线态验证后立刻还原。 */
    t('按能力裁剪：只有筛选权限时，目录保留且只显示对应模块', () => {
      const liveOn = app.LIVE.on, me = app.AUTH.me;
      try {
        app.LIVE.on = true; app.AUTH.me = { abilities: ['screen:run'] };
        app.state.page = 'dashboard'; app.render();
        const mods = $$('.navmodule-title').map(x => x.textContent.trim());
        const leaves = $$('.navcatalog .navitem[data-page]').map(x => x.dataset.page);
        if (!$('.navcatalog')) throw new Error('目录整体消失了（可见页被连带隐藏）');
        if (JSON.stringify(mods) !== JSON.stringify(['筛选与评估'])) throw new Error('模块：' + JSON.stringify(mods));
        if (JSON.stringify(leaves) !== JSON.stringify(['screen'])) throw new Error('叶子：' + JSON.stringify(leaves));
      } finally { app.LIVE.on = liveOn; app.AUTH.me = me; }
    });

    t('按能力裁剪：无任何招聘权限时整个目录隐藏（不留空壳）', () => {
      const liveOn = app.LIVE.on, me = app.AUTH.me;
      try {
        app.LIVE.on = true; app.AUTH.me = { abilities: ['report:read'] };
        app.state.page = 'dashboard'; app.render();
        if ($('.navcatalog')) throw new Error('无招聘权限却仍显示目录');
        if ($$('.navmodule-title').length) throw new Error('残留模块标题');
        /* 非招聘页不应被误伤 */
        const nav = $$('.navitem[data-page]').map(x => x.dataset.page);
        if (nav.indexOf('reports') === -1) throw new Error('把无关页面也裁掉了：' + JSON.stringify(nav));
      } finally { app.LIVE.on = liveOn; app.AUTH.me = me; app.render(); }
    });

    log('\n================ 结果 ================');
    log((errors.length ? '❌' : '✅') + ' 通过 ' + ok + ' 项，失败 ' + errors.length);
    errors.forEach(e => log('  ✗ ' + e));
    process.exit(errors.length ? 1 : 0);
  })
  .catch(e => { console.error('加载失败: ' + (e && e.stack || e)); process.exit(1); });
