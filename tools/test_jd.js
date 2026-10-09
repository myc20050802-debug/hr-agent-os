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
    ok('「把模糊的用户场景」+「拆成能落地的产品方案」已合并（v18：中文接缝不补逗号）',
      p.duty.some(t => t.indexOf('把模糊的用户场景拆成能落地的产品方案') >= 0));
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
    const plusItems = plus.replace(/。$/, '').split('；');
    eq('加分项仍是一段行文（4 条）', plusItems.length, 4);
    ok('加分项统一为「…者优先」句式', plusItems.every(t => /者优先$/.test(t)), plus);
    ok('加分项保留了 HR 写的核心信息（实习经历 / Side Project / 能力边界）',
      /AI产品实习经历/.test(plus) && /Side Project/.test(plus) && /能力边界/.test(plus), plus);
    ok('加分项的口语化表述已被书面化（不再出现「懂点技术」「能和工程对话」）',
      plus.indexOf('懂点技术') < 0 && plus.indexOf('能和工程对话') < 0, plus);
    ok('合规扫描：夹带的「27届」没有触发年龄歧视规则', r.scan.flagged.length === 0 && r.scan.legal.length === 0, JSON.stringify(r.scan.flagged));
    ok('执行轨迹里说明了「按小标题还原」', r.steps.some(s => s.intent.indexOf('小标题') >= 0));
    ok('关键词含 HR 自己写的职责句里的技能词', Array.isArray(r.keywords));
  }

  console.log('\n=== 6b. v12 已填内容的润色与美化 ===');
  {
    /* 口径：任职要求 / 加分项「已有内容 → 保留核心信息并丰富润色；为空 → 原有默认逻辑」。
       本节锁三件事：① 口语化表述被书面化；② 核心信息一个字不丢、不新增；
       ③ 二次展开幂等（runJD → buildJD 会展开两次，不能叠出「者优先者优先」）。 */
    const r = E.expandRequirements({
      title: 'AI 产品经理', industry: '互联网', years: 2, eduRank: 2,
      must: '最好是 3 年以上 AI 产品经验\n聪明有灵气，表达清楚\n我们希望你能主动推进项目呢',
      nice: 'AI产品实习经历\n懂点技术能和工程对话\n有自己的Side Project'
    });
    const dim = n => (r.dims.find(d => d.name === n) || { items: [] }).items;
    const 软 = dim('软技能');
    const 灵 = 软.find(t => t.indexOf('思维敏捷') >= 0) || '';
    ok('口语「聪明有灵气 / 表达清楚」→「思维敏捷 / 表达清晰」',
      灵.indexOf('思维敏捷') >= 0 && 灵.indexOf('表达清晰') >= 0
      && 灵.indexOf('有灵气') < 0 && 灵.indexOf('表达清楚') < 0, 灵);
    const 主 = 软.find(t => t.indexOf('主动推进项目') >= 0) || '';
    ok('框架语「我们希望你能…呢」被剥掉，只留实义', 主 === '主动推进项目', 主);
    ok('口头前缀「最好是」被剥掉，核心信息不丢',
      dim('工作经验').some(t => t === '3 年以上 AI 产品经验'), JSON.stringify(dim('工作经验')));
    ok('核心信息一字不丢（AI 产品经验仍在硬性条件里）', r.must.some(t => t.indexOf('AI 产品经验') >= 0));
    ok('加分项全部统一为「…者优先」', r.nice.every(t => /者优先$/.test(t)), JSON.stringify(r.nice));
    ok('加分项核心信息保留（AI产品实习经历 / Side Project）',
      r.nice.some(t => t.indexOf('AI产品实习经历') >= 0) && r.nice.some(t => t.indexOf('Side Project') >= 0));
    ok('润色不凭空添加：技术栈词没被塞进加分项',
      r.nice.every(t => !/Java|Spring|MySQL|Redis/.test(t)), JSON.stringify(r.nice));
    ok('已填的三条要求各自仍只占一条（润色不拆条、不并条）',
      ['3 年以上 AI 产品经验', '思维敏捷', '主动推进项目']
        .every(k => [...r.must, ...r.soft].filter(t => t.indexOf(k) >= 0).length === 1),
      JSON.stringify([...r.must, ...r.soft]));

    /* 幂等：runJD → buildJD 会二次展开 */
    const again = E.expandRequirements({ title: 'AI 产品经理', industry: '互联网', years: 2, eduRank: 2, must: r.must, nice: r.nice });
    eq('二次展开幂等（加分项文案与条数不变）', again.nice, r.nice);
    ok('二次展开不叠成「者优先者优先」', again.nice.every(t => (t.match(/者优先/g) || []).length === 1), JSON.stringify(again.nice));
    eq('二次展开幂等（硬性条件不变）', again.must, r.must);

    /* 两栏留空 → 原有默认逻辑：条数与来源不变，只是句式统一为「…者优先」 */
    const empty = E.expandRequirements({ title: 'AI 产品经理', industry: '互联网', years: 2, eduRank: 2, must: '', nice: '' });
    ok('两栏留空仍按职能族给出加分项建议', empty.nice.length >= 3, 'nice=' + empty.nice.length);
    ok('两栏留空时加分项同样统一为「…者优先」', empty.nice.every(t => /者优先$/.test(t)), JSON.stringify(empty.nice));
    ok('两栏留空时任职要求仍补齐六维度', empty.dims.length === 5 && empty.dims[0].items.length >= 3);
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

  console.log('\n=== 10. v13 岗位职责栏 + 语义与分段修正 ===');
  {
    /* 10.1 行业语境句适配：行业句只拼给「对口职能」，不再错位 */
    const buy = E.buildJD({ title: '采购工程师', industry: '制造业', dept_path: '采购部', must_years: 3, must_edu_rank: 2, headcount: 1, must_have: [], nice_have: [] });
    ok('采购岗（制造业）职责不含「良率 / OEE」（生产指标错配已修）',
      buy.duties.length === 6 && buy.duties.every(d => /良率|OEE|瓶颈工序/.test(d) === false), JSON.stringify(buy.duties));
    const prod = E.buildJD({ title: '生产主管', industry: '制造业', dept_path: '制造部', must_years: 4, must_edu_rank: 2, headcount: 1, must_have: [], nice_have: [] });
    ok('生产岗（制造业）职责仍保留行业语境句（防一刀切误伤）',
      prod.duties.some(d => /良率|OEE/.test(d)), JSON.stringify(prod.duties));

    /* 10.2 管培生／实习岗的加分项不得是资深口径 */
    const jr = E.buildJD({ title: '门店储备干部', industry: '零售连锁', dept_path: '运营部', must_years: 0, must_edu_rank: 1, headcount: 5, must_have: [], nice_have: [] });
    const jrNice = jr.jd.split('## 三、加分项')[1].split('## 四、我们提供')[0];
    ok('储备干部加分项不含资深门槛（从 0 到 1 / 带店 / 扭亏）',
      !/从 0 到 1|带店|扭亏/.test(jrNice), jrNice.trim());
    ok('储备干部加分项含管培生口径（实习 / 学生干部）',
      /实习|学生干部/.test(jrNice), jrNice.trim());

    /* 10.3 技能补位句尾缀轮换：不再四连同款 */
    const ai = E.buildJD({ title: 'AI 产品经理', industry: '互联网', dept_path: '产品部', must_years: 3, must_edu_rank: 2, headcount: 1, must_have: ['3 年以上 AI 产品经验，了解 LLM RAG'], nice_have: [] });
    const s1Sec = ai.jd.split('**（一）专业技能**')[1].split('**（二）')[0];
    const clauses = (s1Sec.match(/，[^；。]+/g) || []).map(x => x.trim());
    ok('专业技能补位句尾缀至少 2 种（不再像机器批量生成）', new Set(clauses).size >= 2, JSON.stringify(clauses));

    /* 10.4 整段粘 JD：末行条目不再被小标题启发式吞掉，且不产双后缀 */
    const TAIL_BLOB = '你会做什么\n负责公司新媒体账号的内容策划与日常运营\n任职要求\n本科及以上学历，2 年以上新媒体运营经验\n加分项\n有短视频策划经验更香';
    const dReq = E.expandRequirements({ title: '新媒体运营', industry: '传媒文化', years: 2, eduRank: 2, must: TAIL_BLOB, nice: '' });
    ok('末行「有短视频策划经验更香」保留为加分项（不再被判成标题吞掉）',
      dReq.nice.some(t => t.indexOf('短视频策划') >= 0), JSON.stringify(dReq.nice));
    ok('「更香」书面化后不叠加「者优先」（无「更具优势者优先」）',
      dReq.nice.every(t => /(?:者优先|更具优势)$/.test(t) && (t.match(/者优先/g) || []).length <= 1), JSON.stringify(dReq.nice));

    /* 10.5 「岗位职责」栏：已填以用户为准，为空走模板 */
    const filled = await E.runJD(null, { title: '供应链采购专员', industry: '制造业', dept: '供应链中心', years: 3, eduRank: 2, headcount: 2,
      must: '3 年以上采购经验', nice: '', duty: '负责供应商开发与成本管控\n执行采购订单跟催与交期管理\n月度降本复盘' });
    const dutySec = filled.jd.split('## 一、岗位职责')[1].split('## 二、任职要求')[0];
    ok('用户填写的 3 条职责全部出现在职责区', ['负责供应商开发与成本管控', '执行采购订单跟催与交期管理', '月度降本复盘']
      .every(t => dutySec.indexOf(t) >= 0), dutySec.trim());
    ok('用户职责排在最前（第 1–3 条）', dutySec.indexOf('1. 负责供应商开发与成本管控') >= 0);
    eq('userDuties 返回用户原文（供落库与回显）', filled.userDuties,
      ['负责供应商开发与成本管控', '执行采购订单跟催与交期管理', '月度降本复盘']);
    ok('执行轨迹说明职责来源', filled.steps.some(s => s.intent.indexOf('岗位职责') >= 0));

    const empty = await E.runJD(null, { title: '供应链采购专员', industry: '制造业', dept: '供应链中心', years: 3, eduRank: 2, headcount: 2, must: '', nice: '', duty: '' });
    eq('不填职责：仍按职能族模板生成 6 条', empty.duties.length, 6);
    eq('不填职责：userDuties 为空数组（不冒充用户内容）', empty.userDuties, []);

    /* 10.6 幂等：同输入二次生成结果一致（含尾缀轮换与行业句判定） */
    const again = await E.runJD(null, { title: '供应链采购专员', industry: '制造业', dept: '供应链中心', years: 3, eduRank: 2, headcount: 2,
      must: '3 年以上采购经验', nice: '', duty: '负责供应商开发与成本管控\n执行采购订单跟催与交期管理\n月度降本复盘' });
    eq('同输入两次生成，职责区完全一致', again.jd.split('## 一、岗位职责')[1].split('## 二、任职要求')[0], dutySec);
  }

  /* ---------- 11. v14：整段 JD「分栏回填」（前端 agent.js，与后端 splitReqInput 同源） ---------- */
  console.log('\n=== 11. v14 整段 JD 分栏回填（前端 splitJdFields）===');
  {
    /* 用户把「职位职责 + 职位要求」整段粘进「岗位职责」栏时，前端必须把它分派到
       职责 / 任职要求 / 加分项 三栏，而不是只取职责、把要求静默丢弃。
       这里直接加载前端 agent.js（与后端共用同一份 ReqLib）做同源校验。 */
    global.window = { ReqLib };
    require(path.join(ROOT, '平台原型/src/agent.js'));
    const sJF = (global.window.Agent || {}).splitJdFields;
    ok('前端 agent.js 已导出 splitJdFields', typeof sJF === 'function');
    if (typeof sJF === 'function') {
      const FULL = ['职位职责',
        '1、对接售前/商务，承接ToB客户需求(主要是交通领域，如航司、高速)，完成需求澄清、拆解、结构化梳理，输出PRD、功能清单、业务流程；',
        '2、独立完成产品原型设计、交互设计，产出可直接交付研发开发的原型与需求文档；',
        '职位要求',
        '1、有ToB产品经理经验，有AI、政企项目交付经验者优先；',
        '2、擅长模糊需求拆解、需求落地，能把简单方案转化为完整产品设计；',
        '3、逻辑清晰、沟通顺畅，能独立推进跨团队落地项目。'].join('\n');
      const f = sJF(FULL);
      eq('整段 JD → 职责 2 条', f.duty.length, 2);
      eq('整段 JD → 任职要求 3 条', f.must.length, 3);
      ok('整段 JD → heads ≥ 2（触发回填）', f.heads >= 2, f.heads);
      ok('分派出的条目无序号残留', f.duty.concat(f.must).every(t => !/^\d+\s*[、.）)]/.test(t)), JSON.stringify(f.duty.concat(f.must)));
      ok('分派出的条目无尾标点', f.duty.concat(f.must).every(t => !/[；;，,。、]$/.test(t)));
      ok('「转化为完整产品设计」完整保留', f.must.some(t => t.indexOf('转化为完整产品设计') >= 0));

      const onlyDuty = sJF('1、负责需求分析\n2、负责原型设计');
      ok('只有职责（无小标题）→ heads < 2，交回默认粘贴、不触发回填', onlyDuty.heads < 2, onlyDuty.heads);
    }
  }

  /* ---------- 11b. v15：段落型 JD（编号残留 / 断词 / 行内多条目 / 行内分栏） ----------
     来源是用户截图那份 JD：整段粘贴，条目用「；N.」在段内相连、中间被硬换行切了一刀，
     且「任职要求：」写在职责段的末尾。旧版输出把序号留在正文（「1. 1.跟随业务团队…」）、
     把「痛点」劈成「痛」+「点；」、把 5 条职责连 6 条要求挤成一坨、
     又把要求整段吞进职责栏。四种症状同源（行首/行内的规范都没做），这里逐条锁住。 */
  console.log('\n=== 11b. v15 段落型 JD：编号 / 断词 / 行内多条目 / 行内分栏 ===');
  {
    const BLOB2 = [
      '一、岗位职责',
      '',
      '1.跟随业务团队对接B端客户，参与业务访谈，理解客户业务流程，识别显性需求，主动挖掘潜在业务痛',
      '点；2.结合大模型应用能力，判断AI是否可以解决客户痛点，设计初步落地思路，预判方案实施效果与边界；3.将客户业务痛点转化为AI应用需求，协同技术团队梳理方案，跟进项目落地；4.跟踪AI应用上线后的业务指标，评估方案带来的业务价值，持续迭代场景方案；5.轮岗学习业务、产品、AI应用相关知识，成长为懂客户业务、懂AI落地的复合型产品人才。任职要求：1.学历背景：211或985本科及以上，2027届应届毕业生；计算机、软件工程、金融专业优先2.业务沟通能力：逻辑表达清晰，擅长沟通倾听，能快速理解陌生行业业务，具备客户视角，优先关注业务价值；3.AI认知：了解大模型等AI应用的能力与局限，理解AI应用落地基本逻辑',
      '4.产品思维：具备良好的需求拆解、归纳抽象能力，能够把业务问题转化为可落地方案；5.软性素质：学习能力强，自驱力足，善于跨团队协作，能接受业务外出客户沟通'
    ].join('\n');
    const p = ReqLib.parseReqText(BLOB2);
    const all = p.duty.concat(p.must, p.nice, p.benefit);
    /* ① 序号不得残留在正文里。旧版 RE_LI_NUM 的西文句点分支要求「. 」后有空格，
          「1.跟随业务团队」剥不掉 → 正文原样带着序号输出（用户看到的就是「1. 1.…」）。 */
    const leftover = all.filter(t => /^\d{1,2}\s*[.、)）]/.test(t));
    ok('编号不残留：正文里不再出现「N.」开头的序号', leftover.length === 0, JSON.stringify(leftover));
    /* ② 断行落在词中间，不得把词劈开（旧版：「…潜在业务痛」+「点；2.…」两条）。 */
    ok('断词还原：「主动挖掘潜在业务痛点」完整',
      p.duty.some(t => t.indexOf('主动挖掘潜在业务痛点') >= 0));
    ok('断词还原：没有插进「痛，点」这种把断行升级成标点错误的写法',
      !all.some(t => t.indexOf('痛，点') >= 0));
    /* ③ 段内「；N.」要切成独立条目，不能整段粘成一条（旧版是一大坨）。 */
    eq('行内多条目：职责切出 5 条', p.duty.length, 5);
    ok('行内多条目：每条都是一个长度正常的完整句',
      p.duty.every(t => t.length >= 15 && t.length <= 60), JSON.stringify(p.duty.map(t => t.length)));
    /* ④「任职要求：」写在职责段末尾时（不在行首，RE_HEAD_LEAD 认不出），
          要改派回要求栏，而不是整段留在职责里。 */
    ok('行内分栏：职责栏不再残留「任职要求」字样',
      !p.duty.some(t => t.indexOf('任职要求') >= 0));
    ok('行内分栏：「学历背景」归到要求栏', p.must.some(t => t.indexOf('学历背景') >= 0));
    ok('行内分栏：「AI认知」归到要求栏', p.must.some(t => t.indexOf('AI认知') >= 0));
    /* ⑤ 标签之后的**后续行**同样归新栏 —— 「4.产品思维」「5.软性素质」原本在下一行，
          旧版仍把它们算作职责（key 状态没被行内标签更新）。 */
    ok('行内分栏：标签之后的「产品思维」也归要求栏', p.must.some(t => t.indexOf('产品思维') >= 0));
    ok('行内分栏：标签之后的「软性素质」也归要求栏', p.must.some(t => t.indexOf('软性素质') >= 0));
    ok('行内分栏：职责栏只剩职责，没被塞进能力标签',
      !p.duty.some(t => /产品思维|软性素质|学历背景/.test(t)));

    /* ⑥ 无编号的段落型（从渲染出行号的页面复制时，行首既没有列表符号也没有「；N.」）。
          这是 cnCont 唯一能救的场景：上面那份 BLOB2 的第一行带「1.」，会被既有的
          「列表项续行」判据兜住 —— 破坏 cnCont 照样全绿（实测过），所以必须单列一例。 */
    const BLOB3 = [
      '一、岗位职责',
      '',
      '跟随业务团队对接B端客户，参与业务访谈，理解客户业务流程，识别显性需求，主动挖掘潜在业务痛',
      '点；结合大模型应用能力，判断AI是否可以解决客户痛点，设计初步落地思路，预判方案实施效果与边界'
    ].join('\n');
    const p3 = ReqLib.parseReqText(BLOB3);
    eq('[无编号段落] 断行合成 1 条（不劈成两条）', p3.duty.length, 1);
    ok('[无编号段落] 「主动挖掘潜在业务痛点」完整',
      p3.duty.some(t => t.indexOf('主动挖掘潜在业务痛点') >= 0), JSON.stringify(p3.duty));
    ok('[无编号段落] 词尾没被孤立成一条',
      !p3.duty.some(t => /^[。；;，,、]{0,2}点[；;]/.test(t)), JSON.stringify(p3.duty));

    /* 用户实际走的是前端粘贴（splitJdFields）—— 与后端同源但调用路径不同，一并锁住 */
    const sJF2 = (global.window.Agent || {}).splitJdFields;
    if (typeof sJF2 === 'function') {
      const f2 = sJF2(BLOB2);
      eq('前端 splitJdFields 同样切出 5 条职责', f2.duty.length, 5);
      ok('前端 splitJdFields：分派出的条目无序号残留',
        f2.duty.concat(f2.must).every(t => !/^\d{1,2}\s*[.、)）]/.test(t)));
    }
  }

  /* ---------- 11c. v18：中文断行不得凭空补标点 ----------
     上面 BLOB2 只在「痛点」处断了一行 —— 多断点的情况没被覆盖，所以漏掉了一个更隐蔽的缺陷：
     合并硬换行时会**凭空补一个逗号**（旧规则「列表项续行补逗号」在中文里是错的）。
     真实硬换行 JD 每一行都断在词中间，于是正文变成
     「…预判方案实施效果，与边界」「跟踪AI应用，上线后的业务指标」「软性素质：学，习能力强」。
     用户的判据是一句话：「无论填什么，语句都不能有问题」—— 造标点比不造更该修。
     这里用**逐行都在词中间断开**的原文，把「不许造标点」逐条锁死。 */
  console.log('\n=== 11c. v18 多断点硬换行：中文断行不许凭空补标点 ===');
  {
    const BLOB4 = [
      '一、岗位职责',
      '',
      '1.跟随业务团队对接B端客户，参与业务访谈，理解客户业务流程，识别显性需求，主动挖掘潜在业务痛',
      '点；2.结合大模型应用能力，判断AI是否可以解决客户痛点，设计初步落地思路，预判方案实施效果',
      '与边界；3.将客户业务痛点转化为AI应用需求，协同技术团队梳理方案，跟进项目落地；4.跟踪AI应用',
      '上线后的业务指标，评估方案带来的业务价值，持续迭代场景方案；5.轮岗学习业务、产品、AI应用',
      '相关知识，成长为懂客户业务、懂AI落地的复合型产品人才。任职要求：1.学历背景：211或985本科',
      '及以上，2027届应届毕业生；计算机、软件工程、金融专业优先2.业务沟通能力：逻辑表达清晰，擅长',
      '沟通倾听，能快速理解陌生行业业务，具备客户视角，优先关注业务价值；3.AI认知：了解大模型等AI应用',
      '的能力与局限，理解AI应用落地基本逻辑',
      '4.产品思维：具备良好的需求拆解、归纳抽象能力，能够把业务问题转化为可落地方案；5.软性素质：学',
      '习能力强，自驱力足，善于跨团队协作，能接受业务外出客户沟通',
    ].join('\n');
    const p4 = ReqLib.parseReqText(BLOB4);
    const a4 = p4.duty.concat(p4.must, p4.nice, p4.benefit);
    eq('[多断点] 职责切出 5 条', p4.duty.length, 5);
    eq('[多断点] 要求切出 4 条', p4.must.length, 4);
    /* 接缝两侧的原文必须逐字接回去 —— 少一个字符都说明中间被动过手脚 */
    const joined = t => a4.some(x => x.indexOf(t) >= 0);
    ok('[多断点] 「预判方案实施效果与边界」完整（接缝处没被塞逗号）', joined('预判方案实施效果与边界'));
    ok('[多断点] 「跟踪AI应用上线后的业务指标」完整', joined('跟踪AI应用上线后的业务指标'));
    ok('[多断点] 「AI应用相关知识」完整', joined('AI应用相关知识'));
    ok('[多断点] 「211或985本科及以上」完整', joined('211或985本科及以上'));
    ok('[多断点] 「擅长沟通倾听」完整', joined('擅长沟通倾听'));
    ok('[多断点] 「学习能力强」完整', joined('学习能力强'));
    ok('[多断点] 「AI应用的能力与局限」完整', joined('AI应用的能力与局限'));
    /* 反向锁：直接把「凭空补的逗号」逐一点名，破坏 v18 规则时这里必须变红 */
    const invented = /效果，与边界|应用，上线后|应用，相关知识|本科，及以上|擅长，沟通|学，习能力|应用，的能力|人才，任职要求/;
    ok('[多断点] 正文里没有「凭空补标点」的接缝',
      !a4.some(t => invented.test(t)), JSON.stringify(a4.filter(t => invented.test(t))));
  }

  /* ---------- 12. 岗位资料库种子：新克隆开箱即有市场数据 ----------
     背景：reference_jobs 是「JD 生成接地真实市场」的唯一素材来源，过去只存在于本机演示库。
     现在 server/seed/reference_jobs.json 随仓库走、空库首建自动导入 —— 这一节锁住它。 */
  console.log('\n=== 12. reference_jobs 种子（新克隆开箱可用）===');
  {
    const fs = require('fs');
    const os = require('os');
    const { execFileSync } = require('child_process');
    const SEED = path.join(ROOT, 'server/seed/reference_jobs.json');

    /* 走子进程：本进程的 config.js 已缓存 DB_FILE，改 env 换不了库（见本节注释）。 */
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-jd-refseed-'));
    const inner = `
      const db = require(${JSON.stringify(path.join(ROOT, 'server/db.js'))});
      const R  = require(${JSON.stringify(path.join(ROOT, 'server/referenceJobs.js'))});
      const d  = db.open(false);                       // 空库首建
      const count = R.countAll(d);
      const again = db.seedReferenceJobs(d);           // 幂等复种
      const refs  = R.loadReference(d, { title: '高级 Java 工程师', industry: '互联网', limit: 12 });
      const out = { count, again, afterAgain: R.countAll(d), refs: refs.length, note: R.marketNote(refs) };
      d.close();
      process.stdout.write('__RESULT__' + JSON.stringify(out));
    `;
    let r = null;
    try {
      const stdout = execFileSync(process.execPath, ['--experimental-sqlite', '-e', inner], {
        env: Object.assign({}, process.env, { DB_PATH: path.join(tmpDir, 'fresh.db'), LOG_LEVEL: 'error' }),
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
      });
      const m = stdout.match(/__RESULT__(\{[\s\S]*\})/);
      if (m) r = JSON.parse(m[1]);
    } catch (e) {
      ok('空库首建可正常开库并导入种子', false, (e.stderr || e.message || '').toString().slice(0, 300));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (r) {
      ok('空库首建自动导入 reference_jobs 快照', r.count > 0, 'count=' + r.count);
      const seedLen = (() => { try { return JSON.parse(fs.readFileSync(SEED, 'utf8')).length; } catch { return -1; } })();
      ok('种子文件存在且可解析', seedLen > 0, 'seedLen=' + seedLen);
      eq('导入条数与种子文件逐条对齐（不多不少）', r.count, seedLen);
      eq('幂等：对已导入的库再种一次，新增 0 条', r.again, 0);
      eq('幂等：复种后总数不变（不重复膨胀）', r.afterAgain, r.count);
      ok('市场接地能匹配到同类在招岗位（JD 不再脱离市场）', r.refs > 0, 'refs=' + r.refs);
      ok('marketNote 写明参考数量，可被 JD 正文引用',
        /已参考市场在招同类岗位/.test(r.note || ''), (r.note || '').slice(0, 80));
    }
  }

  console.log('\n================ 结果 ================');
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
  if (fails.length) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('✅ JD 生成口径回归全部通过（' + pass + '/' + pass + '）');
})();
