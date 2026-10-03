/* 无头渲染测试（离线兜底模式）：逐页渲染 + 关键交互，抓取任何运行时错误
   用法：NODE_PATH=<workspace>/node_modules node test_prototype.js
   输出同时写入 ../_test_offline.txt（UTF8） */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.resolve(__dirname, 'index.html');
const OUT = path.join(__dirname, '..', '_test_offline.txt');
const lines = [];
const log = (...a) => lines.push(a.map(x => String(x)).join(' '));
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
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const app = window.__app;
    if (!app) { log('❌ window.__app 未暴露，脚本可能未执行'); process.exit(1); }

    /* 页面清单**从 app.PAGES 派生**，不再手写。
       这里原来是 24 个写死的 id —— 与 test_live.js 里那份 23 个的列表已经不同步过
       （新加的「岗位资料库」页在在线套件里被静默漏掉）。两份写死清单必然漂移，
       统一从 PAGES 派生后，新增页面自动进入两个套件的覆盖。 */
    const ids = Object.keys(app.PAGES);
    if (!ids.length) { log('❌ app.PAGES 为空，无法确定页面清单'); process.exit(1); }
    let bad = 0;
    for (const id of ids) {
      app.state.page = id;
      try {
        app.render();
        const host = $('#pageHost');
        const len = host.innerHTML.length;
        const hasUndef = /undefined|\[object Object\]|NaN/.test(host.textContent || '');
        if (len < 400 || hasUndef) { bad++; log(`  ⚠️  ${id}: len=${len} 可疑内容=${hasUndef}`); }
        else log(`  ✓ ${id.padEnd(14)} ${String(len).padStart(6)} 字符`);
      } catch (e) { bad++; errors.push(`[render:${id}] ` + e.message); }
    }

    /* 2. 关键交互 */
    const click = sel => { const el = $(sel); if (el) el.click(); else errors.push('未找到元素 ' + sel); };
    let okCount = 0;
    const tryAsync = async (name, fn) => {
      try { await fn(); okCount++; log(`  ✓ 交互 ${name}`); } catch (e) { errors.push(`[act:${name}] ` + e.message); }
    };

    await tryAsync('岗位管理：多行业列表 + 切换岗位', async () => {
      app.state.page = 'jobs'; app.render();
      const t = $('#pageHost').textContent;
      if (t.indexOf('岗位管理') === -1) throw new Error('未渲染岗位管理页');
      if (!/制造业|医疗健康|零售连锁/.test(t)) throw new Error('岗位列表未覆盖其他行业');
      const sel = $('#scJob');
      app.state.page = 'screen'; app.render();
      const s2 = $('#scJob');
      if (!s2) throw new Error('筛选台缺少岗位下拉');
      if (s2.options.length < 5) throw new Error('岗位下拉选项过少：' + s2.options.length);
    });

    await tryAsync('筛选台跟随岗位切换', async () => {
      app.state.page = 'screen'; app.render();
      const sel = $('#scJob');
      const target = [...sel.options].find(o => o.value !== app.state.jobId);
      if (!target) throw new Error('只有一个岗位可选');
      sel.value = target.value;
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await wait(300);
      if (app.state.jobId !== target.value) throw new Error('切换后 state.jobId 未更新');
      const t = $('#pageHost').textContent;
      if (t.indexOf(target.textContent.split(' · ')[0]) === -1) throw new Error('页面未显示新岗位');
    });

    await tryAsync('新建岗位（离线兜底）', async () => {
      app.state.page = 'jobs'; app.state.jobForm = null; app.render();
      click('[data-act="newJob"]');
      await wait(150);
      if (!$('#jfTitle')) throw new Error('新建表单未展开');
      $('#jfTitle').value = '离线测试岗位·仓储主管';
      $('#jfIndustry').value = '制造业';
      $('#jfDept').value = '/供应链中心';
      $('#jfYears').value = '3';
      $('#jfMust').value = '3 年以上仓储管理经验，熟悉库存管理';
      $('#jfNice').value = '有 ERP 系统经验';
      click('[data-act="saveJob"]');
      await wait(600);
      if (($('#pageHost').textContent || '').indexOf('离线测试岗位·仓储主管') === -1) throw new Error('新岗位未进入列表');
      if (app.state.jobForm) throw new Error('保存后表单未关闭');
    });

    await tryAsync('岗位表单：Agent 生成 JD 草稿', async () => {
      app.state.page = 'jobs'; app.state.jobForm = { mode: 'new', data: {} }; app.render();
      $('#jfTitle').value = '护理主管';
      $('#jfIndustry').value = '医疗健康';
      click('[data-act="genJobJD"]');
      await wait(1200);
      const must = $('#jfMust').value;
      if (!must || must.length < 10) throw new Error('未填充任职要求');
      if (!$('#jfJd').value) throw new Error('未填充 JD 正文');
      click('[data-act="cancelJobForm"]');
      await wait(150);
    });

    await tryAsync('粘贴简历打分', async () => {
      app.state.jobId = 'J-118';   // 回到有候选人的岗位（离线模式新岗位没有简历）
      app.state.page = 'screen'; app.render();
      click('[data-act="pasteScore"]');
      await wait(120);
      const btn = window.document.getElementById('psRun');
      if (!btn) throw new Error('psRun 按钮未生成');
      btn.click();
      await wait(60);
      const out = window.document.getElementById('psOut');
      if (!out || out.innerHTML.length < 80) throw new Error('打分结果为空');
      /* 每个分数都必须带「为什么是这个分」——这几条是那条界面约定的护栏。
         少了它，分数又变成一个凭空出现的数字（面试官的第一反应就是「凭什么是这个数」）。 */
      const why = out.querySelector('.why');
      if (!why) throw new Error('打分结果里没有归因块（.why）');
      const txt = why.textContent;
      if (!/为什么是\s*\d+\s*分/.test(txt)) throw new Error('归因块缺少「为什么是 N 分」标题');
      if (!/\d+\s*\+\s*\d+\s*\+\s*\d+\s*\+\s*\d+\s*=/.test(txt)) throw new Error('归因块缺少逐维相加的算式');
      if (!/决定性因素/.test(txt)) throw new Error('归因块缺少「决定性因素」');
      if (!/再往前一步/.test(txt)) throw new Error('归因块缺少「再往前一步」的提分路径');
      if (!/置信度/.test(txt)) throw new Error('归因块缺少置信度提醒');
      if (why.querySelectorAll('table tbody tr').length < 4) throw new Error('归因块未逐维给出系数算式');
    });

    await tryAsync('候选人详情抽屉', async () => {
      app.state.page = 'screen'; app.render();
      click('[data-act="candDetail"]');
      if (!$('#drawerBody').innerHTML.length) throw new Error('抽屉为空');
    });

    await tryAsync('敏感信息二次确认', async () => {
      app.state.page = 'candidates'; app.render();
      click('[data-act="reveal"]');
      if (!$('#modalBox').innerHTML.length) throw new Error('弹层为空');
      click('[data-act="closeModal"]');
    });

    /* 未评分 ≠ 不合适。
       离线种子候选人全部带分数，所以临时把一条置空来逼出兜底分支 —— 用 try/finally
       保证**无论断言成败都还原**，绝不把测试数据留在共享状态里污染后续用例。 */
    await tryAsync('候选人库：未评分不得渲染成「不合适」', async () => {
      app.state.page = 'candidates'; app.render();
      const probe = window.DB.candidates[0];
      const snap = { score: probe.score, grade: probe.grade };
      try {
        probe.score = null; probe.grade = null;
        app.render();
        const rows = [...$('#pageHost').querySelectorAll('table tbody tr')];
        const unRow = rows.find(tr => tr.textContent.indexOf('待评分') !== -1);
        if (!unRow) throw new Error('未评分候选人没有渲染成「待评分」');
        if (unRow.textContent.indexOf('不合适') !== -1) throw new Error('未评分被渲染成「不合适」：' + unRow.textContent.slice(0, 50));
        if (!/tag n/.test(unRow.innerHTML)) throw new Error('「未评分」未使用中性标签（不得沿用红色）');
        if ($('#pageHost').textContent.indexOf('尚未评分') === -1) throw new Error('存在未评分候选人，但页面未说明原因与运行入口');
      } finally {
        probe.score = snap.score; probe.grade = snap.grade;   /* 还原，勿留痕 */
      }
      app.render();
      if (/>null</.test($('#pageHost').innerHTML)) throw new Error('候选人库把空分数渲染成了字面 null');
    });

    await tryAsync('员工自助问答', async () => {
      app.state.page = 'selfservice'; app.render();
      click('.qchip');
      await wait(3200);
      const clog = $('#chatlog').textContent;
      if (clog.indexOf('年假') === -1) throw new Error('未生成回答');
      if (!$('#routeBox').textContent.trim()) throw new Error('路由面板为空');
    });

    await tryAsync('拒答与转人工', async () => {
      const chips = window.document.querySelectorAll('.qchip');
      chips[chips.length - 1].click();
      await wait(3200);
      const clog = $('#chatlog').textContent;
      if (clog.indexOf('只能查询你本人的数据') === -1) throw new Error('未触发拒答逻辑');
    });

    await tryAsync('审核批准/驳回', async () => {
      app.state.page = 'approvals'; app.render();
      click('[data-act="approveOne"]');
      click('[data-act="reject"]');
      await wait(60);
      if (!$('#modalBox').innerHTML.length) throw new Error('驳回弹层为空');
      click('[data-act="doReject"]');
    });

    await tryAsync('底座自检', async () => {
      app.state.page = 'foundation'; app.render();
      click('[data-act="selfTest"]');
      await wait(3200);
      if (($('#selfTestOut').textContent || '').indexOf('通过') === -1) throw new Error('自检未完成');
    });

    await tryAsync('JD 生成与合规扫描（岗位与行业自由填写）', async () => {
      app.state.page = 'jd'; app.render();
      const t0 = window.document.getElementById('jdTitle');
      if (!t0) throw new Error('未找到岗位名称输入框');
      if (t0.value !== '') throw new Error('岗位名称不应被写死（期望初始为空，实际=' + t0.value + '）');
      t0.value = '仓库管理员';
      window.document.getElementById('jdIndustry').value = '制造业';
      window.document.getElementById('jdMust').value = '2 年以上仓储管理经验，限男性，35 岁以下';
      click('[data-act="runJD"]');
      await wait(4200);
      const t = $('#jdBody').textContent;
      if (t.indexOf('仓库管理员') === -1) throw new Error('JD 未体现所填岗位名');
      if (t.indexOf('男性限定') === -1) throw new Error('未命中歧视性用语「男性限定」');
      if (t.indexOf('已阻止直接发布') === -1) throw new Error('未阻止直接发布');
    });

    await tryAsync('任职要求六维度扩充（单条 → 完整版）', async () => {
      app.state.page = 'jd'; app.render();
      window.document.getElementById('jdTitle').value = '供应链采购专员';
      window.document.getElementById('jdIndustry').value = '制造业';
      window.document.getElementById('jdYears').value = '3';
      window.document.getElementById('jdEdu').value = '1';
      window.document.getElementById('jdMust').value = '3 年以上采购经验，熟悉供应商开发与成本管控';
      window.document.getElementById('jdNice').value = '';
      click('[data-act="runJD"]');
      await wait(4200);
      const t = $('#jdBody').textContent;
      ['（一）专业技能', '（二）工作经验', '（三）学历背景', '（四）综合素质', '（五）软技能'].forEach(d => {
        if (t.indexOf(d) === -1) throw new Error('JD 缺少维度：' + d);
      });
      if (t.indexOf('熟悉供应商开发与成本管控') === -1) throw new Error('已填内容未被保留');
      if (t.indexOf('大专及以上学历') === -1) throw new Error('学历维度未按所选学历生成');
    });

    /* 回归守卫：互联网行业的非技术岗不应被补上技术栈技能（旧版按行业补位会补出 Java） */
    await tryAsync('职能族识别：非技术岗不被补技术栈 + JD 正文渲染', async () => {
      app.state.page = 'jd'; app.render();
      window.document.getElementById('jdTitle').value = 'AI 产品经理';
      window.document.getElementById('jdIndustry').value = '互联网';
      window.document.getElementById('jdYears').value = '3';
      window.document.getElementById('jdEdu').value = '2';
      window.document.getElementById('jdMust').value = '3 年以上 AI 产品经验，熟悉模型评测与 Badcase 调优';
      window.document.getElementById('jdNice').value = '';
      click('[data-act="runJD"]');
      await wait(4200);
      const t = $('#jdBody').textContent;
      ['Java', 'Spring', 'MySQL', 'Redis', '微服务', '高并发', '保障线上服务稳定性'].forEach(w => {
        if (t.indexOf(w) >= 0) throw new Error('非技术岗出现了技术栈内容：' + w);
      });
      if (t.indexOf('需求分析') === -1) throw new Error('未按「产品」职能补齐专业技能');
      if (t.indexOf('模型评测') === -1) throw new Error('HR 已填内容未被保留');
      if (t.indexOf('**') >= 0) throw new Error('JD 正文 Markdown 标记未渲染（出现裸 **）');
      const r = window.Agent.generateJD({ title: 'AI 产品经理', industry: '互联网', years: 3, eduRank: 2,
        must: '3 年以上 AI 产品经验，熟悉模型评测与 Badcase 调优' });
      if (r.fnName !== '产品') throw new Error('离线职能识别错误：' + r.fnName);
      if (/Java|Spring|保障线上服务/.test(r.jd)) throw new Error('离线 JD 仍含技术栈内容');
      const kws = (r.keywords || []).join('、');
      if (/Java|Spring|MySQL/.test(kws)) throw new Error('打分关键词被污染：' + kws);
    });

    /* 回归守卫：实施交付族 + 管培生免年限（'实施' / '交付' 曾被误归客服族，
       导致「软件实施管培生」生成出「客户咨询的受理与响应」） */
    await tryAsync('实施交付族识别 + 管培生免年限（不误判为客服）', async () => {
      app.state.page = 'jd'; app.render();
      window.document.getElementById('jdTitle').value = '软件实施管培生';
      window.document.getElementById('jdIndustry').value = '互联网';
      window.document.getElementById('jdYears').value = '3';
      window.document.getElementById('jdEdu').value = '2';
      window.document.getElementById('jdMust').value = '';
      window.document.getElementById('jdNice').value = '';
      click('[data-act="runJD"]');
      await wait(4200);
      const t = $('#jdBody').textContent;
      ['客户咨询的受理与响应', '服务话术', '客户满意度', '呼叫中心'].forEach(w => {
        if (t.indexOf(w) >= 0) throw new Error('实施岗出现了客服话术：' + w);
      });
      if (t.indexOf('无需相关工作经验') === -1) throw new Error('管培生岗仍写了工作年限要求');
      if (t.indexOf('实习') === -1) throw new Error('管培生岗未给出对口实习口径');
      const r = window.Agent.generateJD({ title: '软件实施管培生', industry: '互联网', years: 3, eduRank: 2, must: '', nice: '' });
      if (r.fnName !== '实施交付') throw new Error('离线职能识别错误（疑似误判为客服）：' + r.fnName);
      if (!r.junior) throw new Error('离线未标记 junior 层级');
      if (/\d+\s*年以上/.test(r.jd)) throw new Error('管培生岗 JD 里出现了「X 年以上」年限门槛');
    });

    await tryAsync('问数生成图表', async () => {
      app.state.page = 'reports'; app.render();
      click('[data-act="askData"]');
      await wait(1400);
      if ($('#askOut').innerHTML.indexOf('<svg') === -1) throw new Error('未生成图表');
    });

    await tryAsync('Agent 计划执行到闸门', async () => {
      app.state.page = 'screen'; app.render();
      click('[data-act="runScreen"]');
      await wait(9000);
      const t = $('#drawerBody').textContent;
      if (t.indexOf('等待人工审核') === -1) throw new Error('未触发人工审核闸门');
      if (t.indexOf('物理剔除') === -1) throw new Error('未展示反歧视处理步骤');
      click('[data-act="closeDrawer"]');
    });

    /* 离线态的招聘链路烟测：验证「已邀约」之后的三个页面在断网时也能把整条链点完。
       用的是内置 DEMO_INTERVIEWS / DEMO_OFFERS 样例（离线无服务端，不能真写库）。 */
    await tryAsync('招聘链路（离线）：面试开场/结论 + Offer 审批/应答', async () => {
      app.state.page = 'interview'; app.render();
      const st = $('[data-act="itvStart"]');
      if (!st) throw new Error('离线态面试页缺「开始面试」按钮');
      st.click(); await wait(300);
      const fb = $('[data-act="itvFeedback"]');
      if (!fb) throw new Error('开场后未出现「提交结论」按钮');
      fb.click(); await wait(200);
      if (!$('#fbText')) throw new Error('结论表单未展开');
      $('#fbResult').value = 'pass';
      $('#fbText').value = '离线烟测：技术面通过，追问有数据支撑。';
      click('[data-act="itvFeedbackSubmit"]');
      await wait(400);
      if (($('#pageHost').textContent || '').indexOf('离线烟测') === -1) throw new Error('结论提交后未回写到「已提交的面试结论」区');

      app.state.page = 'offer'; app.render();
      const ap = $('[data-act="offerApprove"]');
      if (!ap) throw new Error('离线态 Offer 页缺「批准并发出」按钮');
      ap.click(); await wait(400);
      const acc = $('[data-act="offerAccept"]');
      if (!acc) throw new Error('批准后未出现「登记接受」按钮');
      acc.click(); await wait(400);
      if (($('#pageHost').textContent || '').indexOf('已接受') === -1) throw new Error('应答登记后未回写为已接受');
    });

    /* 3. 无障碍最小集
       为什么单独断言：无障碍最容易被「看起来没问题」骗过 —— 视觉上一切正常，
       键盘用户与屏幕阅读器用户可能完全用不了。这里只覆盖最基本、可机检的部分
       （语义角色 / 可读名称 / 键盘可达 / 动效偏好），不假装做完了全部 WCAG。 */
    await tryAsync('无障碍最小集：语义角色 + 键盘可达 + 动效偏好', async () => {
      const doc = window.document;
      if (doc.documentElement.lang !== 'zh-CN') throw new Error('html lang 缺失或错误');
      const skip = doc.querySelector('a.skiplink');
      if (!skip || skip.getAttribute('href') !== '#pageHost') throw new Error('缺少「跳到主内容」链接');
      const toast = doc.getElementById('toast');
      if (toast.getAttribute('role') !== 'status' || toast.getAttribute('aria-live') !== 'polite') throw new Error('提示区未声明 live region');
      const dlg = doc.querySelector('#drawer .drawer');
      if (dlg.getAttribute('role') !== 'dialog' || dlg.getAttribute('aria-modal') !== 'true') throw new Error('抽屉未声明 dialog 角色');
      if (dlg.getAttribute('aria-labelledby') !== 'drawerTitle') throw new Error('抽屉未关联标题');
      const mb = doc.getElementById('modalBox');
      if (mb.getAttribute('role') !== 'dialog' || mb.getAttribute('aria-modal') !== 'true') throw new Error('弹层未声明 dialog 角色');
      if (!doc.getElementById('nav').getAttribute('aria-label')) throw new Error('导航未声明 aria-label');

      /* 图标按钮：只有图形没有文字，必须给出可读名称 */
      const iconBtns = Array.from(doc.querySelectorAll('.iconbtn'));
      if (!iconBtns.length) throw new Error('未找到图标按钮');
      const unnamed = iconBtns.filter(b => !b.getAttribute('aria-label'));
      if (unnamed.length) throw new Error(unnamed.length + ' 个图标按钮没有可读名称');

      /* 侧边导航项是 div，必须能被键盘聚焦到（Enter/空格 触发） */
      const navs = Array.from(doc.querySelectorAll('.navitem'));
      if (!navs.length) throw new Error('未渲染导航项');
      if (navs.some(x => x.getAttribute('role') !== 'button' || x.getAttribute('tabindex') !== '0')) throw new Error('存在不可键盘聚焦的导航项');
      if (!navs.some(x => x.getAttribute('aria-current') === 'page')) throw new Error('当前页未标记 aria-current');

      /* 表头必须绑定到列，否则读屏只念值不念列名 */
      app.state.page = 'screen'; app.render();
      const ths = Array.from(doc.querySelectorAll('#pageHost th'));
      if (!ths.length) throw new Error('筛选页未渲染表头');
      if (ths.some(t => t.getAttribute('scope') !== 'col')) throw new Error('存在未绑定列的表头');

      /* 动效偏好与焦点样式必须真的写进 CSS，而不是「说了会做」 */
      const css = doc.querySelector('style').textContent;
      if (css.indexOf('prefers-reduced-motion') === -1) throw new Error('未处理「减少动态效果」系统偏好');
      if (css.indexOf(':focus-visible') === -1) throw new Error('未提供可见的键盘焦点样式');

      /* 键盘实操：打开抽屉 → 焦点应移入 → Esc 应能关闭 */
      const cd = doc.querySelector('[data-act="candDetail"]');
      if (!cd) throw new Error('无候选人可点开');
      cd.click();
      await wait(180);
      if (!doc.getElementById('drawer').classList.contains('on')) throw new Error('抽屉未打开');
      if (!dlg.contains(doc.activeElement)) throw new Error('打开抽屉后焦点未移入（键盘用户会被卡在浮层外）');
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(180);
      if (doc.getElementById('drawer').classList.contains('on')) throw new Error('Esc 未关闭抽屉');
    });

    /* 连接策略：把「无论从哪儿打开都自动进在线模式」这条行为锁住。
       背景：原型有三种打开方式（后端托管 / 双击 file:// / 预览面板跨源），
       过去只有第一种是在线的，另外两种会静默落回离线演示 —— 用户看到的
       「怎么又是离线模式」就是这个。 */
    await tryAsync('连接策略：自动找后端 + 无头环境不误跳转 + 离线逃生开关', async () => {
      const doc = window.document;
      const bar = doc.getElementById('connBar');
      if (!bar) throw new Error('缺少连接状态条 #connBar');
      if (bar.getAttribute('role') !== 'status' || bar.getAttribute('aria-live') !== 'polite') {
        throw new Error('连接状态条未声明 live region');
      }

      const html = fs.readFileSync(file, 'utf8');
      if (html.indexOf('http://127.0.0.1:8788') === -1) throw new Error('内置后端地址缺失（从 file:// / 预览面板就找不到后端）');
      if (html.indexOf('.connbar') === -1) throw new Error('连接状态条样式缺失');
      if (html.indexOf('wantOffline') === -1) throw new Error('缺少离线逃生开关（?offline=1 / #offline）');
      if (html.indexOf('isHeadless') === -1) throw new Error('缺少无头环境识别（离线用例会被误跳转打穿）');

      /* 无头环境必须**停在离线态**：jsdom 没有 fetch、也没实现 navigation，
         一旦误触发 location.replace，测试会直接红。这条断言就是那根护栏。 */
      if (app.LIVE.on) throw new Error('无后端时应保持离线演示态');
      if (!/^file:/.test(window.location.href)) throw new Error('离线用例里发生了跳转：' + window.location.href);
    });

    /* 离线逃生开关：**后端可达时也必须离线**。
       这一条是真跑出来的，不是查字符串：
       原断言只检查源码里出现过 'wantOffline'，于是「开关在、但走不到」这种故障完全测不出来。
       实际故障：liveBootstrap 先探测当前源，后端托管原型时直接 return，
       ?offline=1 被无视 —— 页面照样弹登录闸门。
       构造方式：新开一个 JSDOM，把 URL 设成后端源 + ?offline=1，
       并注入一个「同源 /api/health 一定成功」的 fetch 桩，模拟最容易吃掉开关的环境。 */
    await tryAsync('离线逃生开关：后端可达时 ?offline=1 仍必须离线', async () => {
      const html = fs.readFileSync(file, 'utf8');
      const calls = [];
      const vc2 = new VirtualConsole();
      const dom2 = new JSDOM(html, {
        url: 'http://127.0.0.1:8788/?offline=1',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole: vc2,
        beforeParse(w) {
          /* 只实现 probeHealth 用到的形状：ok / json()。 */
          w.fetch = function (u) {
            calls.push(String(u));
            return Promise.resolve({
              ok: true, status: 200,
              json: () => Promise.resolve({ ok: true, mode: 'rule', schemaVersion: 9, authMode: 'strict' }),
              text: () => Promise.resolve(''),
            });
          };
        },
      });
      await wait(400);
      const app2 = dom2.window.__app;
      if (!app2) throw new Error('第二实例未暴露 window.__app');
      if (app2.LIVE.on) throw new Error('后端可达时 ?offline=1 被忽略 —— 仍然进了在线模式（逃生开关失效）');
      if (calls.length) throw new Error('显式离线时不应发起任何探测请求，实际发了 ' + calls.length + ' 次：' + calls.slice(0, 3).join(', '));
      dom2.window.close();
    });

    /* 岗位驱动的简历打分：把「关键词跟着岗位走」这条行为锁住。
       背景：scoreResume 曾经写死一份 Java 技术词表（java/spring/kafka/mysql…），
       岗位要求只用于判学历与年限。后果是任何非 Java 岗位的简历都是 0/40 ——
       一份正文写着 LLM、RAG、Agent 的 AI 产品经理简历，评「了解LLM RAG」的岗位
       拿到技能匹配 0 分、总分 16、判「不合适」。这是尺子拿错，不是严格。 */
    await tryAsync('简历打分：关键词抽自岗位要求（换岗位换尺子）', async () => {
      const A2 = window.Agent;
      if (!A2 || typeof A2.scoreResume !== 'function') throw new Error('缺少 scoreResume');

      const AI_RESUME = `马云冲 男 出生年月：2005/8/2 最高学历：本科（在读）
2023/9-2027/6 大连东软信息学院 电子信息工程，GPA 专业前 10%
自学方向：大模型评测方法、Badcase 归因、竞品分析、Prompt 工程、智能体搭建。
个人技能：了解 LLM 原理与能力边界及机器学习、Agent、RAG、微调等概念；熟练 SQL/Python 数据分析`;

      const hitReq = A2.scoreResume(AI_RESUME, '了解LLM RAG');
      const kws = (hitReq.hits && hitReq.hits.kws) || [];
      /* ① 关键词必须来自岗位要求本身 */
      if (!kws.includes('LLM') || !kws.includes('RAG')) {
        throw new Error('岗位关键词未从「了解LLM RAG」抽出 LLM/RAG，实得：' + JSON.stringify(kws));
      }
      if (kws.some(k => /^(java|spring|mysql|kafka|redis)$/i.test(k))) {
        throw new Error('岗位关键词里混进了 Java 栈（说明写死的技术词表又回来了）：' + JSON.stringify(kws));
      }
      /* ② 简历正文写着 LLM/RAG，技能匹配不能是 0 */
      const skill = hitReq.dims.find(d => d.dim === '技能匹配');
      if (!skill || skill.score <= 0) throw new Error('技能匹配为 0：AI 简历评 AI 岗位不应该 0 分');
      if (!/LLM/.test(skill.ev) || !/RAG/.test(skill.ev)) throw new Error('技能匹配依据未追溯到命中的关键词：' + skill.ev);

      /* ③ 换岗位要求 → 同一份简历的判定必须变（这条是「跟着岗位走」的判据）。
         v16 起，零命中会被**相关性门槛**直接出局（dims 为空、gate=true、档位 no）——
         这比「技能分掉下来」更彻底，两种结果都算「尺子跟着岗位走了」，
         所以判据写成「掉了分 **或** 被门槛拦下」，否则会把一次加强误报成回归。 */
      const javaReq = A2.scoreResume(AI_RESUME, '3 年以上 Java 开发经验，熟悉 Spring 与 MySQL');
      const javaSkill = javaReq.dims.find(d => d.dim === '技能匹配');
      const dropped = javaSkill ? javaSkill.score < skill.score : javaReq.gate === true;
      if (!dropped) {
        throw new Error('同一份简历评 Java 岗既没掉分也没被门槛拦下（关键词没跟着岗位走）：'
          + (javaSkill ? javaSkill.score : 'dims 为空但 gate=' + javaReq.gate) + ' vs ' + skill.score);
      }
      if (javaReq.gate) {
        if (javaReq.grade !== 'no' || javaReq.score !== 0) throw new Error('门槛例应为 no/0，实得 ' + javaReq.grade + '/' + javaReq.score);
        if (!/未命中/.test(javaReq.reason || '')) throw new Error('相关性门槛的原因没说清零命中：' + javaReq.reason);
      }

      /* ④ 依据文案不能与得分自相矛盾。
         旧版稳定性维度写「简历未体现工作年限，记 0 分并说明」，实际给了 8 分。 */
      [...hitReq.dims, ...javaReq.dims].forEach(d => {
        if (/记\s*0\s*分/.test(d.ev) && d.score !== 0) {
          throw new Error('维度「' + d.dim + '」文案说记 0 分但实得 ' + d.score + ' 分');
        }
      });

      /* ⑤ 命中 0 项必须如实处置：v16 起由相关性门槛判 no/0；
         若将来门槛被拿掉，则至少要如实说明「按底分计」而不是含糊说「未体现」却给分。 */
      const zero = A2.scoreResume('某某，大专，行政助理，负责会议安排与文件归档', '了解LLM RAG');
      const zeroSkill = zero.dims.find(d => d.dim === '技能匹配');
      if (zero.gate) {
        if (zero.grade !== 'no' || zero.score !== 0) throw new Error('零命中门槛例应为 no/0，实得 ' + zero.grade + '/' + zero.score);
        if (!/未命中/.test(zero.reason || '')) throw new Error('零命中门槛原因未说明：' + zero.reason);
      } else if (!zeroSkill || (zeroSkill.score !== 0 && !/底分/.test(zeroSkill.ev))) {
        throw new Error('零命中却给了 ' + (zeroSkill && zeroSkill.score) + ' 分，且未说明按底分计：' + (zeroSkill && zeroSkill.ev));
      }

      /* ⑥ 「2018 年毕业」是**年份**，不能被读成 2018 年工作经验 */
      /* 注意：这条要测的是「稳定性维度怎么读年限」，所以正文里补一个能命中的关键词（LLM），
         否则会被 v16 的相关性门槛在整个维度之前就截走，断言测不到东西。 */
      const years = A2.scoreResume('2018 年毕业，本科，参与过订单系统开发，了解 LLM', '了解LLM RAG')
        .dims.find(d => d.dim === '稳定性');
      if (/2018/.test(years.ev)) throw new Error('把毕业年份当成了工作年限：' + years.ev);

      /* ⑦ 纯拉丁关键词一律要词边界：短词 email↛AI / Django↛Go；
         长词同理 JavaScript↛Java / community↛Unity（v15：此前长词走裸子串匹配） */
      const RL = window.ReqLib;
      if (!RL || typeof RL.kwContains !== 'function') throw new Error('缺少 ReqLib.kwContains');
      if (RL.kwContains('email 邮箱', 'AI')) throw new Error('短英文关键词边界失效：email 命中了 AI');
      if (RL.kwContains('Django 后端开发', 'Go')) throw new Error('短英文关键词边界失效：Django 命中了 Go');
      if (RL.kwContains('JavaScript 开发', 'Java')) throw new Error('长英文关键词边界失效：JavaScript 命中了 Java');
      if (RL.kwContains('community 社区', 'Unity')) throw new Error('左边界失效：community 命中了 Unity');
      if (RL.kwContains('archive 归档', 'Hive')) throw new Error('左边界失效：archive 命中了 Hive');
      /* 反过来：真实命中不能被边界规则误杀（顿号分隔、复数、粘连、版本后缀都算命中） */
      if (!RL.kwContains('了解 LLM、RAG、Agent', 'RAG')) throw new Error('顿号分隔的 RAG 被判成无边界，漏命中');
      if (!RL.kwContains('熟练 Go 语言', 'Go')) throw new Error('独立的 Go 被判成无边界，漏命中');
      if (!RL.kwContains('nodejs 服务', 'Node')) throw new Error('粘连写法被误杀：nodejs 未命中 Node');
      if (!RL.kwContains('AI Agents 编排', 'Agent')) throw new Error('英文复数被误杀：Agents 未命中 Agent');
      if (!RL.kwContains('C++11 新特性', 'C++')) throw new Error('版本号后缀被误杀：C++11 未命中 C++');
    });

    /* 相关性门槛 · 离线镜像（v16）：与后端 server/engine.js:skillGate 同一口径。
       为什么离线端也必须有断言：两边口径一旦分叉，同一份简历在「离线演示」与
       「在线筛选」下会给出不同档位 —— 而两个入口各自看都「像是对的」，
       这类 bug 靠人眼复核几乎发现不了（同类问题见铁律 16 的写死页面清单）。 */
    await tryAsync('相关性门槛（离线镜像）：零命中出局，且不误伤边界情形', async () => {
      const A2 = window.Agent;
      /* 前端负责人投 Java 岗：一个岗位关键词都不命中 → 出局 */
      const ZERO = A2.scoreResume('某某，本科，8 年经验，精通前端与性能优化，有开源项目与专利',
        '3 年以上 Java 开发经验，熟悉 Spring 与 MySQL');
      if (!ZERO.gate) throw new Error('零命中未被门槛拦下：档位 ' + ZERO.grade + ' 分数 ' + ZERO.score);
      if (ZERO.grade !== 'no' || ZERO.score !== 0) throw new Error('门槛例应为 no/0，实得 ' + ZERO.grade + '/' + ZERO.score);
      if (!/未命中/.test(ZERO.reason || '')) throw new Error('门槛原因未说明零命中：' + ZERO.reason);
      if (ZERO.dims.length) throw new Error('门槛例不该返回四维明细（会渲染成「0 分却有完整归因」）');
      /* 命中 1 项不许拦（保守：宁可多聊一轮，不可误杀） */
      const ONE = A2.scoreResume('本科，5 年经验，做过 Java 后端开发', '3 年以上 Java 开发经验，熟悉 Spring 与 MySQL');
      if (ONE.gate) throw new Error('只命中 1 项就被拦下，过于激进：' + ONE.reason);
      /* 岗位没抽出关键词时不许拦（不把「判不了」当成「不匹配」） */
      const NOKW = A2.scoreResume('前端工程师，8 年经验', '');
      if (NOKW.gate) throw new Error('岗位要求为空时仍触发门槛：' + NOKW.reason);
    });

    /* 打分归因：把「解释不许和分数打架」这条锁住。
       归因是**从已算好的分数反推**的（系数取自 shared/score-why.js 的同一份阶梯），
       所以它的算式必须能逐位对上 —— 一旦有人另写一套归因算法，这里立刻红。 */
    await tryAsync('打分归因：算式与分数同源、可逐位核对', async () => {
      const A2 = window.Agent, SW = window.ScoreWhy;
      if (!SW || typeof SW.explain !== 'function') throw new Error('缺少 window.ScoreWhy.explain');

      const RESUME = '熟悉 LLM 与 RAG 应用设计，做过 Prompt 调优。获校级一等奖。本科（在读）';
      const r = A2.scoreResume(RESUME, '了解LLM RAG');
      const w = r.why;
      if (!w || !w.terms) throw new Error('scoreResume 没有返回 why');

      /* ① 总分的算式必须恰好等于各维之和，且等于真实分数 */
      const sum = w.terms.reduce((a, t) => a + t.score, 0);
      if (sum !== r.score) throw new Error(`归因算式之和 ${sum} ≠ 实际分数 ${r.score}`);
      if (!new RegExp(w.terms.map(t => t.score).join('\\s*\\+\\s*') + '\\s*=\\s*' + r.score).test(w.formula)) {
        throw new Error('formula 文案与 terms 不一致：' + w.formula);
      }

      /* ② 每一维的「满分 × 系数」必须能算出它自己的分数（系数不是装饰） */
      w.terms.forEach(t => {
        const calc = Math.round(t.max * t.coef);
        if (calc !== t.score) throw new Error(`维度「${t.dim}」算式 ${t.max} × ${t.coef} = ${calc}，与实际 ${t.score} 不符`);
        if (!t.reason) throw new Error(`维度「${t.dim}」没给出「为什么是这个系数」`);
      });

      /* ③ 系数必须真的来自共享阶梯 —— 否则说明有人又写死了一份 */
      if (SW.coefOf('biz', 0) !== 0.2 || SW.coefOf('biz', 4) !== 1) throw new Error('业务匹配系数阶梯与实现不符');
      if (SW.coefOf('plus', 0) !== 0) throw new Error('加分项触底应为 0（唯一没有底分的一维）');
      if (SW.coefOf('stab', 5, 0) !== 0.8) throw new Error('岗位未设年限门槛时应固定 0.8');
      const biz = r.dims.find(d => d.dim === '业务匹配');
      if (biz.coef !== SW.coefOf('biz', 0)) throw new Error('打分的系数没走共享阶梯');

      /* ④ 「还差几分」的算术要对得上 */
      if (w.threshold && w.threshold.need !== w.threshold.min - r.score) {
        throw new Error(`门槛差值算错：${JSON.stringify(w.threshold)} vs 实际 ${r.score}`);
      }
      /* ⑤ 提分路径必须给出可核对的新分数与增量 */
      w.lift.forEach(l => {
        const t = w.terms.find(x => x.dim === l.dim);
        if (l.delta !== l.newDim - t.score) throw new Error('提分增量与维度分数对不上：' + JSON.stringify(l));
      });

      /* ⑥ 关键词样本越少，越要主动提示置信度不足（本例只有 2 个） */
      if (w.confidence.level !== '偏低' && w.confidence.level !== '低') {
        throw new Error('2 个关键词时置信度应为偏低/低，实得：' + w.confidence.level);
      }

      /* ⑦ 反推模式（老数据只有已存分数）：不能编关键词，也要说清来源 */
      const d2 = SW.explain({ score: r.score, dims: r.dims.map(d => ({ dim: d.dim, score: d.score, max: d.max, ev: d.ev })), ctx: { derived: true } });
      if (d2.formula !== w.formula) throw new Error('反推模式的算式与实际打分的算式不一致');
      if (d2.confidence.level !== '未记录') throw new Error('反推模式不该假装评估得了样本充分度');
      if (!d2.notes.some(n => n.kind === '归因来源')) throw new Error('反推模式未标注归因来源');
      if (d2.lift.some(l => /还差：/.test(l.text))) throw new Error('反推模式编造了关键词清单');

      /* ⑧ 全触底的理论最低分必须由阶梯算出（四维底分 14+6+12+0），不是拍的数字 */
      if (SW.floorScore() !== 32) throw new Error('四维全触底最低分应为 32，实得 ' + SW.floorScore());
    });

    log('\n================ 结果 ================');
    log('页面渲染异常：' + bad);
    log('运行时错误：' + errors.length);
    errors.forEach(e => log('  ✗ ' + e));
    if (errors.length === 0 && bad === 0) log('✅ 全部通过：' + ids.length + ' 个页面渲染正常，' + okCount + ' 项离线交互无运行时错误。');
    process.exit(errors.length || bad ? 1 : 0);
  })
  .catch(e => { log('加载失败: ' + (e && e.stack || e)); process.exit(1); });
