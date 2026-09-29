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

    /* 1. 逐页渲染 */
    const ids = ['dashboard', 'jobs', 'jd', 'screen', 'invite', 'interview', 'offer', 'onboarding', 'selfservice',
      'reports', 'orchestrate', 'candidates', 'employees', 'approvals', 'risks', 'permissions',
      'audit', 'privacy', 'integrations', 'kb', 'model', 'foundation', 'about'];
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

    log('\n================ 结果 ================');
    log('页面渲染异常：' + bad);
    log('运行时错误：' + errors.length);
    errors.forEach(e => log('  ✗ ' + e));
    if (errors.length === 0 && bad === 0) log('✅ 全部通过：' + ids.length + ' 个页面渲染正常，' + okCount + ' 项离线交互无运行时错误。');
    process.exit(errors.length || bad ? 1 : 0);
  })
  .catch(e => { log('加载失败: ' + (e && e.stack || e)); process.exit(1); });
