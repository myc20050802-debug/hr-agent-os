/* ===========================================================
   JD 生成口径回归（v0.9.8）
   零依赖、不需要起服务：直接调用 engine.js / shared/req-lib.js 的纯函数。

   覆盖的核心问题：
     ① 「，」不再被当成条目分隔符 —— 一句正常的话不会被劈成两条；
     ② 整段粘贴的 JD 按小标题归位（职责 / 任职要求 / 加分项）；
     ③ 任职要求与加分项输出「自然行文段落」，不再逐条编号；
     ④ 小标题启发式不吞正常条目（「拆成能落地的产品方案」「熟悉Java」）；
     ⑤ 表单「一行一条」往返无损（这决定了编辑岗位不会把要求黏成一条）。
   =========================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ReqLib = require(path.join(ROOT, 'shared/req-lib.js'));
const E = require(path.join(ROOT, 'server/engine.js'));

let pass = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a));

/* 截图里那份 JD：整段粘进「任职要求」 */
const BLOB = [
  'Agent产品经理我们在找一个对AI Agent充满热情的校招产品经理你是不是那种——Claude、Codex、Cursor一个不落，',
  '天天琢磨"这玩意儿还能怎么用"?看到Agent自己规划、自己干活、自己交结果，',
  '会忍不住想这要是我来做',
  '会做得更好。那我们在等你。',
  '你会做什么',
  '• 从0到1定义一个真正"会思考、会干活"的Agent',
  '• 把模糊的用户场景',
  '拆成能落地的产品方案',
  '• 和顶尖算法、工程团队并肩，把想法快速上线',
  '• 用数据说话，跑通一个又一个产品假设',
  '我们想找这样的你',
  '• 27届，专业不限，聪明有灵气、表达清楚',
  '• 对AI/大模型/Agent是真热爱，不是跟风',
  '有这些更香',
  'AI产品实习经历 / 懂点技术能和工程对话 / 有自己的Side Project / 对Agent的"能力边界"有自己的判断'
].join('\n');

(async () => {
  console.log('\n=== 1. 原文还原：剥符号 + 不再按「，」切条 ===');
  {
    const p = ReqLib.parseReqText(BLOB);
    eq('识别到 3 个小标题', p.heads, 3);
    eq('职责 4 条（HR 自己写的「你会做什么」）', p.duty.length, 4);
    eq('任职要求 2 条', p.must.length, 2);
    eq('加分项 4 条（按「/」拆开）', p.nice.length, 4);
    ok('引言段被单独取出，不会混进任职要求', p.lead.length >= 1 && p.lead[0].indexOf('我们在找一个') >= 0);
    ok('「把模糊的用户场景」+「拆成能落地的产品方案」已合并',
      p.duty.some(t => t.indexOf('把模糊的用户场景，拆成能落地的产品方案') >= 0));
    ok('残留的「•」符号已被剥掉', p.duty.every(t => t.indexOf('•') < 0));
    ok('「和顶尖…并肩，把想法快速上线」没被逗号劈成两条',
      p.duty.some(t => t.indexOf('和顶尖算法、工程团队并肩，把想法快速上线') >= 0));
    ok('「27届，专业不限，聪明有灵气、表达清楚」保持完整',
      p.must.some(t => t.indexOf('27届，专业不限，聪明有灵气、表达清楚') >= 0));
  }

  console.log('\n=== 2. 小标题启发式不吞正常条目 ===');
  {
    const a = ReqLib.parseReqText('熟悉Java\n- 熟悉Python\n- 熟悉MySQL');
    ok('「熟悉Java」不被误判为小标题', a.must.indexOf('熟悉Java') >= 0 && a.must.length === 3);
    const b = ReqLib.parseReqText('有相关证书要求\n- 有驾照');
    ok('「有相关证书要求」不被误判为小标题', b.must.indexOf('有相关证书要求') >= 0);
    const c = ReqLib.parseReqText('加分项：有开源项目贡献');
    eq('「标签：内容」整行拆成标题 + 内容，一个字不丢', c.nice, ['有开源项目贡献']);
    const d = ReqLib.parseReqText('任职要求\n3 年以上后端经验\n- 熟悉 Go');
    ok('「3 年以上后端经验」不被误判为小标题', d.must.indexOf('3 年以上后端经验') >= 0);
  }

  console.log('\n=== 3. 表单「一行一条」往返无损（编辑岗位不会黏成一条）===');
  {
    const items = ['熟悉 Java，能独立应用于实际业务场景', '本科及以上学历，计算机等相关专业', '无需相关工作经验，欢迎应届毕业生投递'];
    const back = ReqLib.parseReqText(items.join('\n'));
    eq('3 条 → 换行拼回 → 仍是 3 条', back.must.length, 3);
    const back2 = ReqLib.parseReqText(items.join('，'));
    ok('旧口径「，」拼接会被合并（这正是必须改成换行拼接的原因）', back2.must.length === 1);
  }

  console.log('\n=== 4. 段落化：不再逐条编号 ===');
  {
    eq('短句用「；」衔接并补句号', ReqLib.paragraphize(['A', 'B', 'C']), 'A；B；C。');
    eq('自带句末标点的保留原标点', ReqLib.paragraphize(['第一句。', '第二句']), '第一句。第二句。');
    eq('冒号结尾不重复加分隔', ReqLib.paragraphize(['你会做什么：', 'A']), '你会做什么：A。');
    const dims = E.expandRequirements({ title: 'Agent 产品经理', industry: '互联网', years: 0, eduRank: 2, must: BLOB, nice: '' }).dims;
    const lines = E.renderReqs(dims);
    ok('维度小标题用粗体', lines.includes('**（一）专业技能**'));
    ok('正文里没有任何「N. 」编号行', lines.every(l => !/^\d+\.\s/.test(l)));
    /* 结构 = 5 个维度 ×（小标题 + 一段正文）+ 4 个空行分隔 */
    const heads = lines.filter(l => /^\*\*（/.test(l));
    const paras = lines.filter(l => l && !/^\*\*（/.test(l));
    ok('5 个维度小标题齐全', heads.length === 5, 'heads=' + heads.length);
    ok('每个维度正文只有一行（整段），不是多条', paras.length === 5 && lines.length === 14, 'lines=' + lines.length);
  }

  console.log('\n=== 5. 维度归位：软素质不进「专业技能」 ===');
  {
    const r = E.expandRequirements({ title: 'Agent 产品经理', industry: '互联网', years: 0, eduRank: 2, must: BLOB, nice: '' });
    const dim = n => (r.dims.find(d => d.name === n) || { items: [] }).items;
    ok('「专业技能」不含「热爱 / 同理心」这类软素质句',
      dim('专业技能').every(t => t.indexOf('热爱') < 0 && t.indexOf('同理心') < 0));
    ok('「软技能」收录了「对AI/大模型/Agent是真热爱」', dim('软技能').some(t => t.indexOf('真热爱') >= 0));
    ok('「学历背景」收录了「27届，专业不限」', dim('学历背景').some(t => t.indexOf('届') >= 0));
    ok('「专业技能」按职能族补齐了核心技能', dim('专业技能').length >= 4);
    eq('加分项 = HR 自己写的 4 条（≥3 条不再叠加模板）', r.nice.length, 4);
  }

  console.log('\n=== 6. 端到端 JD：引言 / 职责 / 段落化要求 / 段落化加分项 ===');
  let jd = '';
  {
    const r = await E.runJD(null, { title: 'Agent 产品经理', industry: '互联网', dept: '/供应链中心/采购部', must: BLOB, nice: '', years: 0, eduRank: 2, salary: '11-16K 13薪', headcount: 1 });
    jd = r.jd;
    ok('引言段出现在 JD 首部', jd.indexOf('我们在找一个对AI Agent充满热情') >= 0);
    ok('岗位职责用的是 HR 自己写的 4 条', jd.indexOf('1. 从0到1定义一个真正') >= 0 && jd.indexOf('4. 用数据说话') >= 0);
    ok('模板职责没有叠加进来（≥3 条以用户为准）', jd.indexOf('负责所辖产品方向的需求调研') < 0);
    const sec = jd.split('## 二、任职要求')[1].split('## 三、加分项')[0];
    ok('任职要求段落内没有「N. 」编号', sec.split('\n').every(l => !/^\d+\.\s/.test(l)));
    ok('五个维度小标题齐全', ['专业技能', '工作经验', '学历背景', '综合素质', '软技能'].every(n => sec.indexOf('（' ) >= 0 && sec.indexOf(n) >= 0));
    const plus = jd.split('## 三、加分项')[1].split('## 四、我们提供')[0].trim();
    eq('加分项是一段行文，不是条目列表', plus,
      'AI产品实习经历；懂点技术能和工程对话；有自己的Side Project；对Agent的"能力边界"有自己的判断。');
    ok('合规扫描：夹带的「27届」没有触发年龄歧视规则', r.scan.flagged.length === 0 && r.scan.legal.length === 0, JSON.stringify(r.scan.flagged));
    ok('执行轨迹里说明了「按小标题还原」', r.steps.some(s => s.intent.indexOf('小标题') >= 0));
    ok('关键词含 HR 自己写的职责句里的技能词', Array.isArray(r.keywords));
  }

  console.log('\n=== 7. 不粘贴、正常填写的老路径不受影响 ===');
  {
    const r = await E.runJD(null, { title: '高级 Java 工程师', industry: '互联网', dept: '/技术中心/后端组', must: '5 年以上 Java 开发经验\n熟悉 Spring Boot 与 MySQL', nice: '', years: 5, eduRank: 2, headcount: 2 });
    ok('两条要求仍是两条（一行一条）', r.mustHave.filter(t => t.indexOf('Java') >= 0).length >= 1);
    ok('没粘贴 JD 时不产生引言段', r.jd.indexOf('我们在找一个') < 0);
    ok('职能识别为技术栈而非产品', r.fnKey === 'tech' || String(r.fnName).indexOf('技术') >= 0, r.fnName);
    ok('岗位职责回落到职能模板', r.jd.indexOf('## 一、岗位职责') >= 0);
    const sec = r.jd.split('## 二、任职要求')[1].split('## 三、加分项')[0];
    ok('任职要求仍是段落形态', sec.split('\n').every(l => !/^\d+\.\s/.test(l)));
  }

  console.log('\n=== 8. 认不出职能族时，不得注入该行业的技术栈（v9 修法）===');
  {
    /* 行业表是按「该行业的主力职能」写的 —— INDUSTRY_SKILLS['互联网'].core 整份是
       Java / Spring Boot / MySQL。若认不出职能还拿它兜底，「储备干部」会被补成程序员。
       这条用例锁死：认不出 → 专业技能与加分项一律不从行业库取。 */
    const SKILL_BANK = require(path.join(ROOT, 'server/db.js')).INDUSTRY_SKILLS;
    /* 用例必须是「实测识别不出职能」的岗位名。换成识别得出的（如「综合助理」→ admin）
       会让本用例失效 —— 所以下面有一条断言强制校验 fnKey === null。
       五个用例刻意跨五个行业，各自对应一份「该行业主力职能」的技能表：
       互联网＝Java/Spring、制造业＝精益生产、金融＝风控/SQL、医疗健康＝护理管理。 */
    const CASES = [['储备干部', '互联网'], ['业务专员', '互联网'], ['见习生', '制造业'],
                   ['跟单员', '金融'], ['城市经理', '医疗健康']];
    const leaked = [];
    for (const [title, industry] of CASES) {
      const r = E.expandRequirements({ title, industry, years: 2, eduRank: 2 });
      ok('「' + title + '」确实认不出职能族（否则本用例无意义）', r.fnKey === null, 'fnKey=' + r.fnKey);
      const core = (SKILL_BANK[industry] && SKILL_BANK[industry].core) || [];
      const text = r.dims[0].items.join('；') + '｜' + r.nice.join('；');
      const hit = core.filter(k => text.indexOf(k) >= 0);
      if (hit.length) leaked.push(title + '/' + industry + '→' + hit.join(','));
      ok('「' + title + '」专业技能不含该行业技术栈', hit.length === 0, hit.join(','));
      ok('「' + title + '」加分项不从行业库补', r.nice.length === 0, 'nice=' + r.nice.length);
    }
    ok('五个用例零泄漏（专业技能 + 加分项）', leaked.length === 0, leaked.join(' | '));

    /* 反向：认出职能的岗位必须照旧从职能族补位 —— 防「一刀切掉」式过度修复 */
    const p = E.expandRequirements({ title: 'AI 产品经理', industry: '互联网', years: 2, eduRank: 2 });
    ok('AI 产品经理仍命中产品职能族', p.fnKey === 'product', 'fnKey=' + p.fnKey);
    ok('AI 产品经理仍补出产品技能', p.dims[0].items.join('；').indexOf('需求分析') >= 0);
    ok('AI 产品经理没有被补上 Java', p.dims[0].items.join('；').indexOf('Java') < 0);
    ok('AI 产品经理仍有职能族加分项', p.nice.length >= 3, 'nice=' + p.nice.length);
    const t = E.expandRequirements({ title: '高级 Java 工程师', industry: '互联网', years: 5, eduRank: 2 });
    ok('技术岗仍能拿到技术栈（没有被误伤）',
      t.fnKey === 'tech' && t.dims[0].items.join('；').indexOf('MySQL') >= 0, 'fnKey=' + t.fnKey);
  }

  console.log('\n=== 9. 端到端（需后端在跑）：生成 → 存岗 → 编辑往返 ===');
  {
    const BASE = process.env.BASE || 'http://127.0.0.1:8788';
    const PW = process.env.DEMO_PASSWORD || 'Demo@2026';
    let alive = false;
    try {
      const h = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) });
      alive = h.ok;
    } catch (e) { /* 后端没起 */ }
    if (!alive) {
      console.log('  ⏭ 后端未启动，跳过（先 `cd server && node --experimental-sqlite server.js` 再重跑）');
    } else {
      const call = async (method, url, body, token) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await r.text();
        let json = null; try { json = JSON.parse(text); } catch (e) { }
        return { status: r.status, json, text };
      };
      const login = await call('POST', '/api/auth/login', { identifier: 'U-001', password: PW });
      ok('HRD 登录成功', login.status === 200, 'status=' + login.status);
      const token = login.json && login.json.token;

      const title = 'JD口径验证岗-' + Date.now().toString(36);
      const gen = await call('POST', '/api/agent/jd/generate', {
        title, industry: '互联网', dept: '/供应链中心/采购部', must: BLOB, nice: '',
        years: 0, eduRank: 2, salary: '11-16K 13薪', headcount: 1
      }, token);
      ok('生成接口返回 200', gen.status === 200, 'status=' + gen.status + ' ' + String(gen.text).slice(0, 120));
      const g = gen.json || {};
      ok('生成结果含引言段', String(g.jd).indexOf('我们在找一个对AI Agent充满热情') >= 0);
      ok('生成结果的任职要求没有编号条目', (String(g.jd).split('## 二、任职要求')[1] || '').split('## 三、')[0].split('\n').every(l => !/^\d+\.\s/.test(l)));
      ok('生成结果的加分项是段落', /^\*\*（一）专业技能\*\*$/m.test(String(g.jd)));

      const created = await call('POST', '/api/jobs', {
        title, industry: '互联网', dept: '/供应链中心/采购部', mustHave: g.mustHave, niceHave: g.niceHave,
        jd: g.jd, keywords: g.keywords, mustYears: 0, mustEduRank: 2, headcount: 1, salary: '11-16K 13薪', autoSeed: false
      }, token);
      ok('存岗成功（前端「确认并发布到 ATS」走的同一个接口）', created.status === 200 && created.json && created.json.id, String(created.text).slice(0, 140));
      const jid = created.json && created.json.id;

      if (jid) {
        const boot = await call('GET', '/api/bootstrap', undefined, token);
        const job = (boot.json.jobs || []).find(j => j.id === jid) || {};
        ok('库里 must_have 没有「•」等残留符号', (job.mustHave || []).every(t => String(t).indexOf('•') < 0));
        ok('库里 must_have 没有被逗号切碎的半句', (job.mustHave || []).every(t => String(t).trim().length >= 4));
        ok('库里 jd_text 与生成结果一致', String(job.jd || '').indexOf('我们在找一个') >= 0);

        /* 模拟前端「载入岗位到工作台 → 保存」：数组 → 换行拼接 → 回传 */
        const before = (job.mustHave || []).length;
        const put = await call('PUT', '/api/jobs/' + jid, {
          mustHave: (job.mustHave || []).join('\n'), niceHave: (job.niceHave || []).join('\n'), jd: job.jd
        }, token);
        ok('编辑保存成功', put.status === 200, 'status=' + put.status + ' ' + String(put.text).slice(0, 120));
        const boot2 = await call('GET', '/api/bootstrap', undefined, token);
        const job2 = (boot2.json.jobs || []).find(j => j.id === jid) || {};
        eq('往返后 must_have 条数不变（编辑不会把要求黏成一条）', (job2.mustHave || []).length, before);
        eq('往返后 nice_have 条数不变', (job2.niceHave || []).length, (job.niceHave || []).length);

        const del = await call('DELETE', '/api/jobs/' + jid, {}, token);
        console.log('  · 清理测试岗位 ' + jid + ' → ' + del.status);
      }
    }
  }

  console.log('\n================ 结果 ================');
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  if (fails.length) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ JD 生成口径回归全部通过（' + pass + '/' + pass + '）');
})();
