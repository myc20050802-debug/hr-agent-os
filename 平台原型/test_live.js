/* 无头回归（真实后端模式）：页面加载自 http://127.0.0.1:8788
   验证：LIVE 模式自动切换 + 全页渲染 + 岗位可自建/可切换 + 关键链路走真 API
   用法：先启动 server/，再 NODE_PATH=<workspace>/node_modules node test_live.js
   输出同时写入 ../_test_out.txt（UTF8），避免控制台编码问题 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const OUT = path.join(__dirname, '..', '_test_out.txt');
const lines = [];
const log = (...a) => lines.push(a.map(x => String(x)).join(' '));
process.on('exit', () => { try { fs.writeFileSync(OUT, lines.join('\n'), 'utf8'); } catch (e) {} });

const file = path.resolve(__dirname, 'index.html');
const errors = [];

/* ---------- 真实后端已启用身份认证（strict），测试必须真登录 ----------
   原来测试用无鉴权的裸 fetch，v0.10.0 之后这些请求会一律 401。
   这里统一：先登录取令牌，之后所有请求都带 Bearer。 */
let TOKEN = null;
const api = (url, opts = {}) => {
  const headers = Object.assign({}, opts.headers || {});
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  return fetch(new URL(url, BASE).toString(), Object.assign({}, opts, { headers }));
};
async function apiJson(url, opts) { const r = await api(url, opts); return r.json(); }

/* ---------- jsdom realm 的 AbortSignal 不能直接喂给 Node 的 fetch ----------
   页面代码（平台原型/src/app.js 的 probeHealth）在 jsdom 里 new AbortController()，
   那个 signal 属于 **jsdom 的 realm**，不是 Node 的。Node >=24 的 undici 会做同 realm 校验：

     TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.

   这条错误会被 probeHealth() 的 catch 静默吞掉（它本来就是「探不到就返回 null」的语义），
   于是页面降级成「离线演示态」—— 断言「同源在线不该显示连接状态条」在 Node 26 上假红。
   **产品代码没问题，是这里把信号原样透传坏了**；Node 22 的 undici 还不校验，所以一直没暴露。
   翻译成原生 signal 而不是直接删掉：前端那个 1200ms 超时断言在测试里依然真实生效。 */
function toNativeSignal(sig) {
  if (sig instanceof AbortSignal) return sig;
  const ac = new AbortController();
  if (sig.aborted) ac.abort();
  else if (typeof sig.addEventListener === 'function') sig.addEventListener('abort', () => ac.abort());
  return ac.signal;
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('[jsdomError] ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('[console.error] ' + a.join(' ')));
vc.on('warn', () => { });
vc.on('log', () => { });

const html = fs.readFileSync(file, 'utf8');

(async () => {
  const dom = await new Promise(resolve => {
    const d = new JSDOM(html, {
      url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(window) {
        /* 前端自身发出的请求也要带令牌（登录前 TOKEN 为空，登录接口本身是公开的）。
           注意：**不能覆盖前端已经显式设置的 Authorization** —— 否则「切换到员工身份」
           那一步（前端自己登录成 U-003）会被测试的 U-001 令牌悄悄顶掉，
           403 用例就变成了假绿（server 看到的仍是 HRD，返回 200）。 */
        window.fetch = (url, opts) => {
          const o = Object.assign({}, opts || {});
          o.headers = Object.assign({}, (opts && opts.headers) || {});
          if (TOKEN && !o.headers.Authorization) o.headers.Authorization = 'Bearer ' + TOKEN;
          if (o.signal) o.signal = toNativeSignal(o.signal);   /* 见文件上方说明：跨 realm 信号会被 Node >=24 拒收 */
          return fetch(new URL(url, BASE).toString(), o);
        };
      }
    });
    resolve(d);
  });

  const { window } = dom;
  const $ = s => window.document.querySelector(s);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* 自检：桩必须把跨 realm 的 signal 换成原生的。
     观测点刻意选在「真正到达 Node fetch 的那个 signal」，这样在 Node 22 上也能锁住这条回归
     —— 只靠行为差异的话，这个坑只有 Node >=24 会红，而 CI 恰好只跑 Node 22，
       这正是它能潜伏至今的原因。

     ⚠️ 两个细节必须守住，否则这条断言会退化成「空断言」（比没有断言更危险）：
     ① Node 的 `globalThis.fetch` 是**惰性访问器**，`globalThis.fetch = fn` 在 sloppy 模式下
        **静默失败**（不抛错、也不生效）。挂探针必须用 `Object.defineProperty`。
        这条断言的第一版就是这么写错的：探针从没被调用，它却一路绿灯。
     ② 还要显式断言「确实观测到了**我们这一次**调用」（called），并且只认打标记的那一次请求：
        页面并发的请求会把「最后一次调用」覆盖掉，第二版就是栽在这个上。
        否则将来桩改成不经过全局 fetch 时，这条断言又会悄悄退化成一个永远为真的检查。 */
  await (async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const gfetch = globalThis.fetch;
    /* 只认「我们这一次」的请求 —— 用查询串打标记。
       用「最后一次调用」当观测值的写法会空转：页面自己启动时并发发出的请求不带 signal，
       它们会在 await 期间把观测值覆盖成 undefined（这条自检的第二个版本就是这么失效的：
       called=true、seen 却是 undefined，于是它又一次一路绿灯）。 */
    const MARK = '/api/health?selfcheck=1';
    let seen, called = false;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true, writable: true,
      value: (u, o) => {
        if (String(u).indexOf(MARK) !== -1) { called = true; seen = o && o.signal; }
        return gfetch(u, o);
      }
    });
    try {
      await window.fetch(BASE + MARK, { signal: new window.AbortController().signal });
    } catch (e) {
      log('❌ fetch 桩自检请求失败: ' + (e && e.message));
      process.exit(1);
    } finally {
      Object.defineProperty(globalThis, 'fetch', desc);
    }
    if (!called) {
      log('❌ 自检没观测到任何 fetch 调用 —— 这条断言形同虚设，先修好它再谈通过');
      process.exit(1);
    }
    if (seen && !(seen instanceof AbortSignal)) {
      log('❌ fetch 桩把跨 realm 的 AbortSignal 透传给了 Node（Node >=24 会抛错，页面会静默降级成离线态）');
      process.exit(1);
    }
  })();
  await wait(1500);

  const app = window.__app;
  if (!app) { log('❌ window.__app 未暴露'); process.exit(1); }

  /* 0. 真实身份认证：先登录（这一步本身就是 M1 的验收点） */
  log('0. 身份认证');
  const health = await apiJson('/api/health');
  log('  ✓ /api/health 无需登录：authMode=' + health.authMode + ' schema=v' + health.schemaVersion);
  const anonProbe = await fetch(new URL('/api/bootstrap', BASE).toString());
  log(anonProbe.status === 401 ? '  ✓ 匿名访问 /api/bootstrap → 401（不再默认 HRD）'
    : '  ✗ 匿名访问竟然返回 ' + anonProbe.status);

  let me = null;
  try {
    me = await app.login('U-001', 'Demo@2026');
    TOKEN = app.AUTH.token;
    log('  ✓ 已登录：' + me.name + '（' + me.roleLabel + '）· 能力 ' + me.abilities.length + ' 项 · 数据范围 ' + me.scope);
  } catch (e) { errors.push('[login] ' + e.message); log('  ✗ 登录失败：' + e.message); }

  /* 0. LIVE 模式 */
  const badge = $('#liveBadge');
  const liveOn = badge && badge.style.display !== 'none' && badge.textContent.indexOf('真实后端') > -1;
  log(liveOn ? '  ✓ 已连接真实后端：' + badge.textContent : '  ⚠️ 未进入 LIVE 模式（离线兜底）');
  /* 1. 逐页渲染
     页面清单**从 app.PAGES 派生**，不再手写。
     教训：这里原来是 23 个写死的 id，本项目新增「岗位资料库」页后它被静默漏掉 ——
     在线套件少测一页却仍打印「全部通过」，比测试失败更危险（假绿）。
     现在与 test_prototype.js 共用同一份事实源（PAGES），两边不可能再不同步。 */
  const ids = Object.keys(app.PAGES);
  if (!ids.length) { log('❌ app.PAGES 为空，无法确定页面清单'); process.exit(1); }

  /* 导航按能力裁剪：HRD 应看到全部页面（页面节点 + 「招聘 Agent」目录节点） */
  const navItems = $('#nav').querySelectorAll('.navitem').length;
  log('  ✓ 导航项 ' + navItems + ' 个（HRD 应按能力显示全部页面；当前 ' + ids.length + ' 页 + 目录节点）');
  let bad = 0;
  for (const id of ids) {
    app.state.page = id;
    try {
      app.render();
      const host = $('#pageHost');
      const len = host.innerHTML.length;
      const hasUndef = /undefined|\[object Object\]|NaN/.test(host.textContent || '');
      if (len < 400 || hasUndef) { bad++; log(`  ⚠️  ${id}: len=${len} 可疑=${hasUndef}`); }
    } catch (e) { bad++; errors.push(`[render:${id}] ` + e.message); log(`  ✗ [render:${id}] ` + (e.stack || e.message)); }
  }
  log('  ✓ ' + ids.length + ' 个页面渲染：异常 ' + bad + ' 个');

  let okCount = 0;
  const tryAsync = async (name, fn) => {
    try { await fn(); okCount++; log('  ✓ ' + name); } catch (e) { errors.push('[' + name + '] ' + e.message); log('  ✗ ' + name + ' → ' + e.message); }
  };

  /* 2. 岗位库：多行业 + 可切换 */
  await tryAsync('岗位管理页：多行业岗位 + 可切换', async () => {
    app.state.page = 'jobs'; app.render();
    const t = $('#pageHost').textContent;
    if (t.indexOf('岗位管理') === -1) throw new Error('未渲染岗位管理页');
    const r = await api('/api/jobs'); const b = await r.json();
    if (!b.jobs || b.jobs.length < 5) throw new Error('岗位数过少：' + (b.jobs || []).length);
    const inds = [...new Set(b.jobs.map(x => x.industry))];
    if (inds.length < 4) throw new Error('行业覆盖不足：' + inds.join('/'));
    if (b.jobs.every(x => /Java/i.test(x.title))) throw new Error('岗位仍全是 Java 岗');
    log('      岗位 ' + b.jobs.length + ' 个 / 行业 ' + inds.length + ' 个：' + inds.join('、'));
    if (!$('[data-act="newJob"]')) throw new Error('缺少「新建岗位」入口');
  });

  await tryAsync('切换岗位后筛选台跟随该岗位', async () => {
    const r = await api('/api/jobs'); const b = await r.json();
    const target = b.jobs.find(x => x.industry !== '互联网') || b.jobs[b.jobs.length - 1];
    app.state.page = 'screen'; app.state.jobId = target.id; app.render();
    const t = $('#pageHost').textContent;
    if (t.indexOf(target.title) === -1) throw new Error('筛选台未显示所选岗位：' + target.title);
    if (t.indexOf(target.industry) === -1) throw new Error('筛选台未显示岗位行业');
    const sel = $('#scJob');
    if (!sel || sel.value !== target.id) throw new Error('岗位下拉未选中当前岗位');
    log('      已切到「' + target.title + '」（' + target.industry + '），下拉选中值 = ' + sel.value);
  });

  /* 3. 新建岗位 → 自动简历 → 跑到闸门 */
  let newJobId = null;
  await tryAsync('HR 自建岗位（任意行业）', async () => {
    app.state.page = 'jobs'; app.state.jobForm = null; app.render();
    $('[data-act="newJob"]').click();
    await wait(150);
    const title = '测试岗位·设备维保工程师' + Date.now().toString(36).slice(-3);
    if (!$('#jfTitle')) throw new Error('新建表单未展开');
    $('#jfTitle').value = title;
    $('#jfIndustry').value = '制造业';
    $('#jfDept').value = '/制造中心/设备部';
    $('#jfYears').value = '2';
    $('#jfEdu').value = '1';
    $('#jfHead').value = '2';
    $('#jfSalary').value = '9-13K·13薪';
    $('#jfMust').value = '2 年以上设备维护经验，熟悉 TPM 与设备保养，大专及以上学历';
    $('#jfNice').value = '有产线改造经验';
    $('[data-act="saveJob"]').click();
    await wait(2500);
    const r = await api('/api/bootstrap'); const b = await r.json();
    const nj = b.jobs.find(x => x.title === title);
    if (!nj) throw new Error('后端未创建该岗位');
    if (!(nj.pending > 0)) throw new Error('未自动生成演示简历（pending=' + nj.pending + '）');
    newJobId = nj.id;
    log('      已创建 ' + nj.id + '「' + nj.title + '」行业=' + nj.industry + ' 关键词=' + nj.keywords.join('/') + ' 简历=' + nj.applicants);
    if (($('#pageHost').textContent || '').indexOf(title) === -1) throw new Error('新岗位未出现在页面列表');
  });

  await tryAsync('新岗位可跑筛选并停在闸门', async () => {
    if (!newJobId) throw new Error('上一步未创建岗位，跳过');
    app.state.jobId = newJobId; app.state.page = 'screen'; app.render();
    $('[data-act="runScreen"]').click();
    await wait(8000);
    const t = $('#drawerBody').textContent;
    if (t.indexOf('物理剔除') === -1) throw new Error('未见反歧视处理步骤');
    const kws = (t.match(/打分关键词库/) || []).length;
    if (!kws) throw new Error('Agent 步骤未带出岗位关键词');
    $('[data-act="closeDrawer"]').click();
  });

  /* 4. JD 生成：任意岗位 + 行业 + 歧视性用语拦截 */
  await tryAsync('JD 生成：任意岗位/行业 + 合规拦截', async () => {
    app.state.page = 'jd'; app.render();
    $('#jdTitle').value = '门店店长';
    $('#jdIndustry').value = '零售连锁';
    $('#jdDept').value = '零售运营中心/华东区';
    $('#jdYears').value = '3';
    $('#jdMust').value = '3 年以上门店管理经验，限男性，35 岁以下，北京户口优先';
    $('[data-act="runJD"]').click();
    await wait(4000);
    const t = $('#jdBody').textContent;
    if (t.indexOf('已阻止直接发布') === -1) throw new Error('未阻止发布异常 JD');
    if (t.indexOf('男性限定') === -1) throw new Error('未命中「男性限定」');
    if (t.indexOf('年龄限制') === -1) throw new Error('未命中「年龄限制」');
    if (!/门店店长/.test(t)) throw new Error('JD 未体现所填岗位名');
    if (!/零售连锁/.test(t)) throw new Error('JD 未体现所选行业');
    log('      命中：' + (t.match(/歧视性表述：[^\n（]+/g) || []).join('、'));
  });

  /* 5. JD 可存为岗位 */
  await tryAsync('JD 可存为岗位（带入岗位表单）', async () => {
    const btn = $('[data-act="saveJdAsJob"]');
    if (!btn) throw new Error('缺少「存为岗位」入口');
    btn.click();
    await wait(400);
    if (!$('#jfTitle')) throw new Error('未跳转到岗位表单');
    const v = $('#jfTitle').value;
    if (v !== '门店店长') throw new Error('岗位名未带入：' + v);
    if (($('#jfMust').value || '').indexOf('限男性') === -1) throw new Error('任职要求未带入');
    $('[data-act="cancelJobForm"]').click();
    await wait(200);
  });

  /* 5c. 职能族识别：互联网行业的非技术岗不应被补上技术栈技能（回归守卫）
     背景：旧版按「行业」补位，AI 产品经理（互联网）会被补上「熟悉 Java」「熟悉 Spring Boot」。
     放在「存为岗位」之后，避免覆盖前一项依赖的表单状态。 */
  await tryAsync('职能族识别：非技术岗不被补技术栈 + JD 正文渲染', async () => {
    const payload = { title: 'AI 产品经理', industry: '互联网', dept: '/产品部', years: 3, eduRank: 2,
      must: '3 年以上 AI 产品经验，熟悉模型评测与 Badcase 调优' };
    app.state.page = 'jd'; app.render();
    $('#jdTitle').value = payload.title;
    $('#jdIndustry').value = payload.industry;
    $('#jdDept').value = payload.dept;
    $('#jdYears').value = '3';
    $('#jdEdu').value = '2';
    $('#jdMust').value = payload.must;
    $('#jdNice').value = '';
    $('[data-act="runJD"]').click();
    await wait(4000);
    const t = $('#jdBody').textContent;
    ['Java', 'Spring', 'MySQL', 'Redis', '微服务', '高并发', '保障线上服务稳定性'].forEach(w => {
      if (t.indexOf(w) >= 0) throw new Error('非技术岗出现了技术栈内容：' + w);
    });
    if (t.indexOf('需求分析') === -1) throw new Error('未按「产品」职能补齐专业技能');
    if (t.indexOf('模型评测') === -1) throw new Error('HR 已填内容未被保留');
    if (t.indexOf('**') >= 0) throw new Error('JD 正文 Markdown 标记未渲染（出现裸 **）');
    const r = await (await api('/api/agent/jd/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })).json();
    if (r.fnName !== '产品') throw new Error('后端职能识别错误：' + r.fnName);
    if (/Java|Spring|保障线上服务/.test(r.jd)) throw new Error('后端 JD 仍含技术栈内容');
    const kws = (r.keywords || []).join('、');
    if (/Java|Spring|MySQL/.test(kws)) throw new Error('打分关键词被污染：' + kws);
    log('      职能=' + r.fnName + '｜维度 ' + r.dims.length + ' 个｜关键词：' + (kws || '（空）'));
  });

  /* 5b. 任职要求六维度扩充：只填一条也能生成完整版（并原样保留已填内容） */
  await tryAsync('任职要求六维度扩充（单条 → 完整版）', async () => {
    const one = '3 年以上采购经验，熟悉供应商开发与成本管控';
    const payload = { title: '供应链采购专员', industry: '制造业', dept: '/供应链中心/采购部', years: 3, eduRank: 1, must: one };
    const r = await (await api('/api/agent/jd/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })).json();
    if (r.status !== 'done') throw new Error('后端未正常生成：' + JSON.stringify(r).slice(0, 160));
    if (!r.dims || r.dims.length !== 5) throw new Error('后端维度数异常：' + ((r.dims || []).length));
    if (!/（一）专业技能/.test(r.jd) || !/（五）软技能/.test(r.jd)) throw new Error('JD 正文缺少维度小标题');
    if (r.jd.indexOf('3 年以上采购经验') === -1 || r.jd.indexOf('熟悉供应商开发与成本管控') === -1) throw new Error('已填内容未被保留');
    if (r.jd.indexOf('大专及以上学历') === -1) throw new Error('学历维度未按所选学历生成');
    if (!r.steps.some(s => s.intent.indexOf('在已填任职要求基础上扩充') >= 0)) throw new Error('Agent 未体现「在原基础上扩充」步骤');
    /* 前端路径也验一遍 */
    app.state.page = 'jd'; app.render();
    $('#jdTitle').value = payload.title; $('#jdIndustry').value = payload.industry;
    $('#jdYears').value = '3'; $('#jdEdu').value = '1'; $('#jdMust').value = one; $('#jdNice').value = '';
    $('[data-act="runJD"]').click();
    await wait(4000);
    const t = $('#jdBody').textContent;
    ['（一）专业技能', '（二）工作经验', '（三）学历背景', '（四）综合素质', '（五）软技能'].forEach(d => {
      if (t.indexOf(d) === -1) throw new Error('页面 JD 缺少维度：' + d);
    });
    log('      ' + r.dims.length + ' 个维度｜硬性条件 ' + r.mustHave.length + ' 条 + 综合素质/软技能 ' + r.softHave.length + ' 条｜加分项 ' + r.niceHave.length + ' 条');
  });

  /* 5d. 实施交付族 + 管培生层级（回归守卫）
     背景1：'实施' / '交付' 曾被误放进「客服族」识别词 → 「软件实施管培生」被判成客服岗，
            生成出「客户咨询的受理与响应」这种完全跑偏的职责与技能。
     背景2：工作经验曾被硬写成「N 年以上」，管培生 / 实习岗会因此把应届生全部拦在门外。
     只用 API（不动表单），避免污染后续用例。 */
  await tryAsync('实施交付族识别 + 管培生免年限（不误判为客服）', async () => {
    const payload = { title: '软件实施管培生', industry: '互联网', dept: '产品部门', years: 3, eduRank: 2, must: '', nice: '' };
    const r = await (await api('/api/agent/jd/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })).json();
    if (r.status !== 'done') throw new Error('后端未正常生成：' + JSON.stringify(r).slice(0, 160));
    if (r.fnName !== '实施交付') throw new Error('职能识别错误（疑似误判为客服）：' + r.fnName);
    ['客户咨询的受理与响应', '服务话术', '客户满意度', '呼叫中心'].forEach(w => {
      if (r.jd.indexOf(w) >= 0) throw new Error('实施岗出现了客服话术：' + w);
    });
    if (r.jd.indexOf('部署') === -1 && r.jd.indexOf('系统实施与交付') === -1) throw new Error('职责未按实施交付族生成');
    if (r.jd.indexOf('无需相关工作经验') === -1) throw new Error('管培生岗仍写了工作年限要求');
    if (/\d+\s*年以上/.test(r.jd)) throw new Error('管培生岗 JD 里出现了「X 年以上」年限门槛');
    if (r.jd.indexOf('实习') === -1) throw new Error('管培生岗未给出对口实习口径');
    if (!r.junior) throw new Error('后端未标记 junior 层级');
    const kws = (r.keywords || []).join('、');
    if (/客户满意度|服务话术|投诉处理/.test(kws)) throw new Error('打分关键词混入客服词：' + kws);
    log('      职能=' + r.fnName + '｜junior=' + r.junior + '｜关键词：' + (kws || '（空）'));
  });

  /* 6. 重置到初始状态 */
  await tryAsync('重置到初始种子状态', async () => {
    $('[data-act="resetDemo"]').click();
    await wait(1800);
    const r = await api('/api/bootstrap');
    const b = await r.json();
    if (b.candidates.filter(c => c.score == null).length !== b.candidates.length) throw new Error('候选人未恢复为待评分');
    if (b.approvals.length !== 0) throw new Error('审批未清空');
    if (b.jobs.length < 5) throw new Error('岗位库未随重置恢复');
  });

  /* 6b. 显示语义：「未评分」≠「不合适」
     重置后候选人处于「从未被筛选」状态（ai_score / ai_grade 均为 NULL）。
     旧实现里 gradeTag(null) 落到最后一个 else 分支 → 全库渲染红标「不合适」，
     把「还没看过这个人」说成「看过并且否了」。对招聘场景这是会误导决策的语义事故，
     所以单独锁一条：未评分必须显示为中性「待评分」，且页面要给出原因与去处。 */
  await tryAsync('候选人库：未评分显示为「待评分」而非「不合适」', async () => {
    app.state.page = 'candidates'; app.render();
    const host = $('#pageHost');
    const rows = [...host.querySelectorAll('table tbody tr')];
    if (!rows.length) throw new Error('候选人库表格为空');
    if (/>null</.test(host.innerHTML)) throw new Error('候选人库把空分数渲染成了字面 null');
    let un = 0;
    rows.forEach(tr => {
      const txt = tr.textContent;
      if (txt.indexOf('待评分') !== -1) {
        un++;
        if (txt.indexOf('不合适') !== -1) throw new Error('未评分被渲染成「不合适」：' + txt.slice(0, 50));
        if (!/tag n/.test(tr.innerHTML)) throw new Error('「未评分」未使用中性标签（不得沿用红色）');
      }
    });
    if (un !== rows.length) throw new Error('刚重置过，全库应均为未评分；实得 ' + un + '/' + rows.length);
    if (host.textContent.indexOf('尚未评分') === -1) throw new Error('存在未评分候选人，但页面未说明原因与运行入口');
    log('      全库 ' + rows.length + ' 位：均显示「待评分」，0 条「不合适」');
  });

  /* 7. 筛选 Agent 真实执行 → 闸门 */
  await tryAsync('筛选Agent真实执行并停在闸门', async () => {
    const rb = await (await api('/api/bootstrap')).json();
    log('      当前岗位 id=' + app.state.jobId + ' 是否有效=' + rb.jobs.some(x => x.id === app.state.jobId));
    if (!rb.jobs.some(x => x.id === app.state.jobId)) app.state.jobId = rb.jobs[0].id;
    app.state.page = 'screen'; app.render();
    $('[data-act="runScreen"]').click();
    await wait(8000);
    const t = $('#drawerBody').textContent;
    if (t.indexOf('物理剔除') === -1) throw new Error('未见反歧视处理步骤（内容：' + t.slice(0, 120) + '）');
    const foot = $('#drawerFoot').textContent;
    if (foot.indexOf('去审核') === -1 && t.indexOf('没有待处理简历') === -1) throw new Error('未生成审核入口');
    $('[data-act="closeDrawer"]').click();
  });

  /* 8. 审核：批准真实写回 */
  await tryAsync('审核中心批准后真实写回', async () => {
    app.state.page = 'approvals'; app.render();
    const btn = $('[data-act="approveOne"]');
    if (!btn) throw new Error('没有待批准项（可能已全部处理）');
    btn.click();
    await wait(1200);
    if (($('#pageHost').textContent || '').indexOf('已批准') === -1) throw new Error('批准后状态未回写页面');
  });

  /* 8.5 打分归因（放在筛选与批准之后：此时候选人刚被打分、前端数据也刚刷新过）。
     这条同时守住两件事：① 后端确实产出了 why 并随候选人下发；
     ② 前端详情抽屉真的把它渲染出来了 —— 只存不显示等于没做。 */
  await tryAsync('打分归因：后端下发 why 且与分数同源 + 详情抽屉渲染', async () => {
    const withWhy = (window.DB.candidates || []).filter(c => c.why && c.why.terms);
    if (!withWhy.length) throw new Error('后端没有下发任何打分归因（why）');
    const c = withWhy[0];
    const sum = c.why.terms.reduce((a, t) => a + t.score, 0);
    if (sum !== c.score) throw new Error(`归因之和 ${sum} ≠ 后端分数 ${c.score}`);
    c.why.terms.forEach(t => {
      if (Math.round(t.max * t.coef) !== t.score) {
        throw new Error(`维度「${t.dim}」算式 ${t.max} × ${t.coef} 算不出 ${t.score}`);
      }
    });
    /* 详情抽屉里必须能看到这一块（「每个分数都要有原因」的界面约定）。
       详情入口在「筛选」页、且按当前选中岗位过滤，所以要先把岗位切到这位候选人的岗。 */
    app.state.jobId = c.jobId; app.state.page = 'screen'; app.render();
    const btn = $(`[data-act="candDetail"][data-id="${c.id}"]`);
    if (!btn) throw new Error('找不到候选人详情入口：' + c.id + '（岗位 ' + c.jobId + '）');
    btn.click();
    await wait(120);
    const body = $('#drawerBody');
    if (!body.querySelector('.why')) throw new Error('候选人详情里没有归因块');
    if (!/为什么是\s*\d+\s*分/.test(body.textContent)) throw new Error('详情归因块缺少「为什么是 N 分」');
    const closer = $('[data-act="closeDrawer"]');
    if (closer) closer.click();
    await wait(80);
  });

  /* 9. 驳回必填原因 */
  await tryAsync('驳回必须填原因（服务端规则）', async () => {
    await api('/api/reset', { method: 'POST' });
    const rb = await (await api('/api/bootstrap')).json();
    app.state.jobId = rb.jobs.find(x => x.title.indexOf('Java') > -1) ? rb.jobs.find(x => x.title.indexOf('Java') > -1).id : rb.jobs[0].id;
    app.state.page = 'screen'; app.render();
    $('[data-act="runScreen"]').click();
    await wait(8000);
    $('[data-act="closeDrawer"]').click();
    app.state.page = 'approvals'; app.render();
    const rj = $('[data-act="reject"]');
    if (!rj) throw new Error('没有待处理审批可驳回');
    rj.click();
    await wait(200);
    $('[data-act="doReject"]').click();
    await wait(200);
    if (($('#toast').textContent || '').indexOf('原因必填') === -1) throw new Error('未拦截空原因驳回');
    $('#rjReason').value = '维度权重需调整，先不执行';
    $('[data-act="doReject"]').click();
    await wait(1200);
    if (($('#pageHost').textContent || '').indexOf('已驳回') === -1) throw new Error('驳回状态未回写');
  });

  /* 10. 员工自助 */
  await tryAsync('员工自助真实问答', async () => {
    app.state.page = 'selfservice'; app.render();
    const chip = $('.qchip');
    if (!chip) throw new Error('未找到快捷问题 chip');
    chip.click();
    await wait(3000);
    const clog = $('#chatlog').textContent;
    if (!clog || clog.length < 40) throw new Error('未生成回答');
    if (!$('#routeBox').textContent.trim()) throw new Error('路由面板为空');
  });

  /* 11. 越权 403 */
  await tryAsync('越权导出被 403 拦截（切到员工身份）', async () => {
    app.state.page = 'risks'; app.render();
    const btn = $('[data-act="tryExport"]');
    if (!btn) throw new Error('LIVE 模式未出现越权演示入口');
    btn.click();
    await wait(1500);
    const t1 = $('#drawerBody').textContent || '';
    if (t1.indexOf('403') === -1) throw new Error('HRD 身份不应被拦截（预期 200 并提示切换身份）');
    log('      HRD 身份：请求通过（具备 employee:export 能力）');
    $('[data-act="closeDrawer"]').click();

    /* 以员工身份重试同一条请求 —— 这才是真实的权限差异 */
    $('[data-act="tryExport"]').click();
    await wait(1200);
    const alt = $('[data-act="tryExportAsEmployee"]');
    if (!alt) throw new Error('未提供「切换到员工身份重试」入口');
    alt.click();
    await wait(2500);
    const t2 = $('#drawerBody').textContent || '';
    /* 断言要看**判定分支**而不是文案里有没有「403」这两个字 ——
       200 分支的说明文字里也写了「换个身份就会变成 403」，只查子串会假绿。 */
    if (!$('#expOut .scanwarn')) throw new Error('员工身份未渲染 403 拦截分支（内容：' + t2.slice(0, 120) + '）');
    if (t2.indexOf('403 Forbidden') === -1) throw new Error('拦截提示里没有 403 Forbidden');
    if (t2.indexOf('result = blocked') === -1) throw new Error('未提示该次尝试已写入审计（result=blocked）');
    log('      员工身份：403 拦截 + 审计留痕');
    $('[data-act="closeDrawer"]').click();

    /* 403 之后改用管理员继续跑完剩余用例（否则后续步骤会因缺能力失败） */
    TOKEN = null;
    await app.login('U-001', 'Demo@2026').catch(() => {});
    TOKEN = app.AUTH.token;
  });

  await tryAsync('审计 append-only 与越权留痕可查', async () => {
    const a = await apiJson('/api/audit?limit=200');
    if (!a.appendOnly) throw new Error('审计接口未声明 append-only');
    if (!(a.stats.blocked > 0)) throw new Error('没有 blocked 记录（越权未留痕）');
    /* 必须能定位到「刚才那次员工越权导出」这条具体记录 —— 只统计 blocked 总数不够：
       种子数据里本来就有一条演示用的 blocked（actor_type='system'），
       所以这里要求 actor_type='user' + detail 以「被拦截：」开头，才算真链路留痕。 */
    const denied = a.logs.filter(l => l.result === 'blocked'
      && l.actor_type === 'user'
      && /^被拦截：/.test(l.detail || '')
      && /employees\/export/.test(l.object_id || ''));
    if (!denied.length) throw new Error('未找到「员工越权导出」的真实 blocked 明细');
    log('      审计：共 ' + a.stats.total + ' 条，blocked ' + a.stats.blocked + ' 条；示例 → ' + denied[0].detail.slice(0, 56));
  });

  await tryAsync('数据治理：留存策略 / 授权 / 到期巡检', async () => {
    const g = await apiJson('/api/governance/summary');
    if (!g.summary.policies || g.summary.policies.length < 3) throw new Error('留存策略未初始化');
    const sw = await apiJson('/api/governance/sweep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"dryRun":true}' });
    if (typeof sw.due !== 'number') throw new Error('留存巡检返回异常');
    log('      留存策略 ' + g.summary.policies.length + ' 条；候选人 ' + g.summary.candidates
      + ' 人 / 无有效授权 ' + g.summary.noConsent + ' 人 / 到期待清 ' + g.summary.dueForDeletion + ' 人');
  });

  await tryAsync('统一错误契约（404/405/401 带 code 与 requestId）', async () => {
    const r404 = await api('/api/not-exist');
    if (r404.status !== 404) throw new Error('未知接口未返回 404');
    const j = await r404.json();
    if (!j.error || !j.error.code || !j.requestId) throw new Error('错误体缺少 code/requestId');
    const r401 = await fetch(new URL('/api/jobs', BASE).toString());
    if (r401.status !== 401) throw new Error('无令牌访问 /api/jobs 未返回 401');
    const r405 = await api('/api/bootstrap', { method: 'DELETE' });
    if (r405.status !== 405) throw new Error('方法不允许未返回 405');
  });

  /* 12. 人工推翻 AI（必须先选原因码，再填说明；两者都会落库） */
  await tryAsync('人工推翻AI结论（须选原因码 + 填说明）', async () => {
    /* 前置：推翻的对象必须先有 AI 结论，所以这里先重置+跑一轮筛选。
       （不能复用前面用例的状态：驳回会把本轮打分一并作废，属于有意设计） */
    await api('/api/reset', { method: 'POST' });
    const rb = await (await api('/api/bootstrap')).json();
    if (!rb.jobs.some(x => x.id === app.state.jobId)) app.state.jobId = rb.jobs[0].id;
    app.state.page = 'screen'; app.render();
    $('[data-act="runScreen"]').click();
    await wait(8000);
    $('[data-act="closeDrawer"]').click();

    app.state.page = 'screen'; app.render();
    const d = $('[data-act="candDetail"]');
    if (!d) throw new Error('无候选人可点开');
    d.click();
    await wait(200);

    /* 空提交：原因码缺失应先被拦下 */
    $('#toast').innerHTML = '';
    $('[data-act="override"]').click();
    await wait(200);
    if (($('#toast').textContent || '').indexOf('必须选择原因码') === -1) throw new Error('未拦截空原因码推翻');

    /* 只填说明、不选码：仍应被拦（这一步保证「可统计」不被自由文本绕开） */
    $('#toast').innerHTML = '';
    $('#ovReason').value = '跳槽过于频繁，与岗位稳定性要求不符';
    $('[data-act="override"]').click();
    await wait(200);
    if (($('#toast').textContent || '').indexOf('必须选择原因码') === -1) throw new Error('未拦截缺原因码的推翻');

    /* 选码 + 说明：通过并落库 */
    const sel = $('#ovCode');
    if (!sel || sel.options.length < 2) throw new Error('原因码下拉未渲染');
    if (!sel.options[1].value) throw new Error('原因码选项为空值');
    sel.value = sel.options[1].value;
    $('#toast').innerHTML = '';
    $('[data-act="override"]').click();
    await wait(1400);
    if (($('#toast').textContent || '').indexOf('已推翻') === -1) throw new Error('推翻未成功');
  });

  /* 12a. 人工确认 AI 结论（真实落库 —— 一致率的分母就来自这里） */
  await tryAsync('人工确认AI结论（计入一致率）', async () => {
    app.state.page = 'screen'; app.render();
    /* 必须换一个人：同一候选人只能有一个当前结论，重复操作是「改结论」而非新增样本 */
    const all = window.document.querySelectorAll('[data-act="candDetail"]');
    const d = all[1] || all[0];
    if (!d) throw new Error('无候选人可点开');
    d.click();
    await wait(200);
    const btn = $('[data-act="confirmAI"]');
    if (!btn) throw new Error('未渲染「确认 AI 判断」按钮（候选人可能尚未评分）');
    $('#toast').innerHTML = '';
    btn.click();
    await wait(1400);
    if (($('#toast').textContent || '').indexOf('已确认') === -1) throw new Error('确认未成功');
  });

  /* 12b. 一致率接口：样本应随上面的操作增长（确认 1 + 推翻 1） */
  await tryAsync('一致率接口反映真实人工样本', async () => {
    const r = await api('/api/metrics/agreement');
    if (r.status !== 200) throw new Error('一致率接口状态 ' + r.status);
    const a = (await r.json()).agreement;
    if (!a) throw new Error('返回体缺 agreement');
    if (a.samples < 2) throw new Error('样本数应 ≥2，实际 ' + a.samples);
    if (a.agreementRate == null) throw new Error('有样本时一致率不应为 null');
    if (!Array.isArray(a.byCode)) throw new Error('byCode 应为数组');
    log('      一致率 ' + (a.agreementRate * 100).toFixed(1) + '% · 样本 ' + a.samples
      + '（确认 ' + a.confirmed + ' / 过严 ' + a.humanOverrodeUp + ' / 过宽 ' + a.humanOverrodeDown + '）');
  });

  /* 12b. 招聘链路闭环（本轮新增）
     「已邀约」之后以前是断的 —— 没有 interviews 表、没有面试官账号，
     走到这里就停了。现在用**三个真人身份**把整条链走完：
       招聘专员排期 → 面试官开场+给结论 → 招聘专员起草 Offer → HRD 批准发出 → 登记接受 → 已入职
     顺带验证两条最关键的规则：① 起草人不能批自己起草的 Offer；② 低于最低工资直接阻断。 */
  const loginAs = async (id) => { const m = await app.login(id, 'Demo@2026'); TOKEN = app.AUTH.token; return m; };

  await tryAsync('招聘链路闭环：排期 → 面试 → Offer → 入职', async () => {
    /* 前置：重置 → 跑筛选 → HRD 批准 → 候选人进入「已邀约」 */
    await loginAs('U-001');
    await api('/api/reset', { method: 'POST' });
    let rb = await (await api('/api/bootstrap')).json();
    const javaJob = rb.jobs.find(x => /Java/.test(x.title)) || rb.jobs[0];
    app.state.jobId = javaJob.id; app.state.page = 'screen'; app.render();
    $('[data-act="runScreen"]').click();
    await wait(8000);
    $('[data-act="closeDrawer"]').click();
    app.state.page = 'approvals'; app.render();
    const ap = $('[data-act="approveOne"]');
    if (!ap) throw new Error('没有待批准项');
    ap.click();
    await wait(1500);
    rb = await (await api('/api/bootstrap')).json();
    const invited = rb.candidates.filter(c => c.stage === '已邀约');
    if (!invited.length) throw new Error('批准后无人进入「已邀约」；现有阶段=' + [...new Set(rb.candidates.map(c => c.stage))].join('/'));
    const cand = invited[0];
    log('      HRD 批准 → 「已邀约」' + invited.length + ' 人，取 ' + cand.name);

    /* ① 招聘专员排期 → 待面试 */
    await loginAs('U-002');
    app.state.page = 'invite'; app.render();
    if (!$('[data-act="schedForm"]')) throw new Error('招聘专员看不到「安排面试」入口');
    $('[data-act="schedForm"]').click();
    await wait(250);
    if (!$('#schItv') || !$('#schAt')) throw new Error('排期表单未展开');
    $('#schAt').value = '2026-09-30 10:00';
    $('[data-act="schedSubmit"]').click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    let iv = (rb.interviews || [])[0];
    if (!iv) throw new Error('排期后后端没有面试记录（interviews 表未落库）');
    let st = rb.candidates.find(c => c.id === iv.candidateId);
    if (!st || st.stage !== '待面试') throw new Error('排期后阶段应为「待面试」，实际=' + (st && st.stage));
    log('      已排期：' + iv.candidate + ' 第' + iv.round + '轮 · 面试官 ' + iv.interviewer + ' · 阶段=' + st.stage);

    /* ② 面试官开场 + 第 1 轮通过 → 待复试（行级：面试官只该看到自己的面试） */
    await loginAs(iv.interviewerId || 'U-007');
    app.state.page = 'interview'; app.render();
    if (!$('[data-act="itvStart"]')) throw new Error('面试官看不到「开始面试」按钮（行级数据没给他）');
    $('[data-act="itvStart"]').click();
    await wait(1300);
    rb = await (await api('/api/bootstrap')).json();
    if ((rb.interviews || []).find(x => x.id === iv.id).status !== 'in_progress') throw new Error('开始面试后状态应为 in_progress');
    $('[data-act="itvFeedback"]').click();
    await wait(250);
    if (!$('#fbResult')) throw new Error('结论表单未展开');
    $('#fbResult').value = 'pass';
    $('#fbText').value = '第 1 轮技术面：并发与缓存答得扎实，追问有压测数据支撑。';
    $('#fbScore').value = '84';
    $('[data-act="itvFeedbackSubmit"]').click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    st = rb.candidates.find(c => c.id === cand.id);
    if (!st || st.stage !== '待复试') throw new Error('第 1 轮通过后应为「待复试」，实际=' + (st && st.stage));
    log('      第 1 轮通过 → 阶段=' + st.stage);

    /* ③ 第 2 轮：再排期 → 开场 → 通过 → 待发offer */
    await loginAs('U-002');
    app.state.page = 'invite'; app.render();
    $('[data-act="schedForm"]').click();
    await wait(250);
    $('#schAt').value = '2026-10-08 14:00';
    $('[data-act="schedSubmit"]').click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    iv = (rb.interviews || []).filter(x => x.candidateId === cand.id).sort((a, b) => b.round - a.round)[0];
    if (!iv || iv.round !== 2) throw new Error('第 2 轮未创建，实际 round=' + (iv && iv.round));

    await loginAs(iv.interviewerId || 'U-007');
    app.state.page = 'interview'; app.render();
    $('[data-act="itvStart"]').click();
    await wait(1300);
    $('[data-act="itvFeedback"]').click();
    await wait(250);
    $('#fbResult').value = 'pass';
    $('#fbText').value = '第 2 轮终面：协作与稳定性符合岗位要求，确认通过。';
    $('[data-act="itvFeedbackSubmit"]').click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    st = rb.candidates.find(c => c.id === cand.id);
    if (!st || st.stage !== '待发offer') throw new Error('第 2 轮通过后应为「待发offer」，实际=' + (st && st.stage));
    log('      第 2 轮通过 → 阶段=' + st.stage);

    /* ④ 合规红线：低于最低工资必须被阻断，且**不产生** Offer 记录 */
    await loginAs('U-002');
    app.state.page = 'offer'; app.render();
    if (!$('[data-act="offerForm"]')) throw new Error('招聘专员看不到「起草 Offer」入口');
    $('[data-act="offerForm"]').click();
    await wait(250);
    $('#ofSalary').value = '1000';   // 低于北京市最低工资 2420
    $('#ofProb').value = '3';
    $('[data-act="offerSubmit"]').click();
    await wait(1500);
    rb = await (await api('/api/bootstrap')).json();
    if ((rb.offers || []).length) throw new Error('合规校验应阻断创建，但后端仍产生了 Offer');
    if (($('#toast').textContent || '').indexOf('合规校验未通过') === -1) throw new Error('未提示合规阻断原因');
    log('      最低工资红线生效：1000 元被阻断，Offer 未创建');

    /* ⑤ 合法起草 → 待 HRD 审批；起草人自己看不到批准按钮 */
    $('[data-act="offerForm"]').click();
    await wait(250);
    $('#ofSalary').value = '32000';
    $('#ofProb').value = '3';
    $('#ofDate').value = '2026-11-02';
    $('[data-act="offerSubmit"]').click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    let of = (rb.offers || [])[0];
    if (!of || of.status !== 'pending_approval') throw new Error('Offer 起草后应为待审批，实际=' + (of && of.status));
    app.state.page = 'offer'; app.render();
    if ($('[data-act="offerApprove"]')) throw new Error('招聘专员竟能看到「批准并发出」按钮（起草人不能自批）');
    log('      已起草 ' + of.id + '（' + of.salary + ' 元）→ 待 HRD 审批；起草人无批准按钮 ✓');

    /* ⑥ HRD 批准并发出 → 已发offer；登记接受 → 已入职 */
    await loginAs('U-001');
    app.state.page = 'offer'; app.render();
    const apv = $('[data-act="offerApprove"]');
    if (!apv) throw new Error('HRD 看不到「批准并发出」按钮');
    apv.click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    of = (rb.offers || [])[0];
    if (of.status !== 'sent') throw new Error('批准后 Offer 状态应为 sent，实际=' + of.status);
    st = rb.candidates.find(c => c.id === cand.id);
    if (!st || st.stage !== '已发offer') throw new Error('批准后阶段应为「已发offer」，实际=' + (st && st.stage));
    log('      HRD 批准发出 → 阶段=' + st.stage);

    app.state.page = 'offer'; app.render();
    const acc = $('[data-act="offerAccept"]');
    if (!acc) throw new Error('HRD 看不到「登记接受」按钮');
    acc.click();
    await wait(1600);
    rb = await (await api('/api/bootstrap')).json();
    st = rb.candidates.find(c => c.id === cand.id);
    if (!st || st.stage !== '已入职') throw new Error('登记接受后阶段应为「已入职」，实际=' + (st && st.stage));
    log('      Offer 接受 → 阶段=' + st.stage + '（链路闭合，抵达入职前置）');
  });

  /* 12c. 面试官行级隔离：另一位面试官看不到、也改不了别人的面试 */
  await tryAsync('面试官行级隔离：看不到别人的面试', async () => {
    await loginAs('U-007');
    app.state.page = 'interview'; app.render();
    const mine = (await (await api('/api/bootstrap')).json()).interviews.length;
    await loginAs('U-008');
    app.state.page = 'interview'; app.render();
    const hers = (await (await api('/api/bootstrap')).json()).interviews.length;
    if (hers !== 0) throw new Error('U-008 不该看到 U-007 的面试，实际看到 ' + hers + ' 条');
    log('      U-007 看到 ' + mine + ' 条 / U-008 看到 ' + hers + ' 条（服务端按面试官过滤）');
    await loginAs('U-001');   // 交回 HRD 身份，收尾重置需要审批/管理能力
  });

  /* 13. 收尾重置 */
  await tryAsync('重置演示数据', async () => {
    $('[data-act="resetDemo"]').click();
    await wait(1500);
    app.state.page = 'screen'; app.render();
  });

  /* 14. 连接策略：后端自己托管原型时必须是「同源在线」——
     不显示连接状态条，也不该发生任何跳转（跳转=白屏或丢会话）。 */
  await tryAsync('连接策略：同源托管时直接进在线模式（无跳转 / 不显示状态条）', async () => {
    if (!app.LIVE.on) throw new Error('从后端源打开时 LIVE.on 应为 true');
    if (window.location.origin !== BASE) throw new Error('页面被意外跳转到 ' + window.location.origin);
    const bar = $('#connBar');
    if (!bar) throw new Error('缺少连接状态条 #connBar');
    if (!bar.hidden) throw new Error('同源在线时不应显示连接状态条：' + bar.textContent.slice(0, 60));
    /* 断言没有退化成跨源直连：跨源会把令牌/会话挂到别的源上，刷新即丢 */
    if (window.__app.LIVE.authMode !== 'strict') throw new Error('authMode 应为 strict，实际 ' + window.__app.LIVE.authMode);
  });

  log('\n================ 结果 ================');
  log('页面渲染异常：' + bad);
  log('运行时错误：' + errors.length);
  errors.forEach(e => log('  ✗ ' + e));
  if (!errors.length && !bad) log('✅ 全部通过：LIVE 模式下 ' + ids.length + ' 页渲染正常，' + okCount + ' 项真实链路交互无错误。');
  process.exit(errors.length || bad ? 1 : 0);
})().catch(e => { log('加载失败: ' + (e && e.stack || e)); process.exit(1); });
