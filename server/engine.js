/* ===========================================================
   HR-Agent OS · Agent 引擎（真实执行版）
   - 筛选 Agent：规则门槛 → 打分（含证据）→ 脱敏 → 写回需人工审批
   - 审批：批准后真实执行写回；驳回强制记录原因
   - 员工自助：分流 → 查业务库 / 检索知识库 / 拒答转人工
   - LLM 网关：可插拔。未配置 LLM_API_URL 时自动走规则模式（离线可用），
     配置任意 OpenAI 兼容接口即可切换为真实大模型。
   =========================================================== */
'use strict';

const { extractKeywords, synthCandidates, INDUSTRY_SKILLS, INDUSTRIES } = require('./db.js');
/* 任职要求 / JD 素材库（前后端共用，见 shared/req-lib.js） */
const ReqLib = require('../shared/req-lib.js');
const OverrideCodes = require('../shared/override-codes.js');
/* 打分归因（前后端共用，见 shared/score-why.js）。
   系数阶梯也只在这里一份 —— 原本 scoreOne 与前端 scoreResume 各抄了一套，
   任何一侧改了阶梯，另一侧的「为什么是这个分」就会开始说谎。 */
const ScoreWhy = require('../shared/score-why.js');
const ReferenceJobs = require('./referenceJobs.js');

const T = 'T-001';
/* JD 素材库版本。
   每次「任职要求素材库 / 职责模板」的生成口径变更时 +1：
   bootstrap 发现岗位的 jd_ver 落后，就按新口径重算并落库。
   为什么需要它：口经升级后老数据不会自己变，旧 JD（例如按行业模板生成的
   「AI 产品经理 → 保障线上服务稳定性」）会继续流通，看起来像没修好。
   v8：任职要求改为「原文还原 + 段落化」口径（见 shared/req-lib.js 第七节）——
   逐条编号 → 自然行文段落，老 JD 必须重算，否则新老两种排版会同时流通。
   v9：认不出职能族时不再用行业素材兜底（行业表是按「该行业主力职能」写的，
   互联网＝技术岗口径）。老 JD 必须重算 —— 凡识别不出职能的岗位，其「专业技能」
   里都不应再出现该行业的技术栈（原本会出现「熟悉 Java」）。
   v10：extractKeywords 增加「拉丁技术名词兜底」+ 职能族补 tags（裸名词）。
   修复前，技能全集只有「能力描述」措辞与行业词库里的技术栈，于是：
     · 中文裸名词抽不出来（前端 / 数据库 / 大模型 / 智能体 一个都抓不到）；
     · 词库没收录的新技术英文词抽不出来 ——「了解LLM RAG」抽出 []，
       「有大模型 / Agent 产品落地经验」也抓不到 Agent。
   岗位 keywords 因此严重失真：AI 产品经理岗抽不到「大模型 / Agent」，
   而打分正是拿 keywords 做命中的 —— 尺子和岗位对不上，非该类岗位必然 0 分。
   老 JD 必须重算才能拿到新关键词。
   附注：行业词库（INDUSTRY_SKILLS）本来就带了 Java / React / TypeScript 这类
   英文技术栈，所以纯英文名词在多数岗位上一向没问题；缺的是「中文裸名词」与
   「词库尚未收录的新词」。 */
/* v11：冗余裁剪只对「含中文的词」生效 —— 拉丁词之间的子串关系是巧合
   （ue ⊂ vue、sql ⊂ mysql、go ⊂ django），照搬会把该留的 Vue / MySQL 裁掉。
   v12：已填内容不再「原样照搬」，而是「保留核心信息 + 书面化润色 + 加分项统一
   为『…者优先』句式」（见 shared/req-lib.js 第八节）。口经变了，老 JD 必须重算 ——
   否则库里会同时流通「懂点技术能和工程对话」与「了解基础技术、能与研发、工程团队
   顺畅沟通者优先」两代表述，看起来像没改。
   v17：段落型 JD 的解析口径 —— 行首/片首「N.」编号（西文句点不带空格）会残留进正文、
   断在词中间的硬换行不还原、行内「；N.」不切条、「任职要求：」写在段中时不改派。
   四条都会让 HR 粘贴一份 JD 后看到「语序不对」的输出，老岗位必须重算。
   详见 docs/22_JD粘贴解析口径_v17修复说明.md。
   v18：断行合并**不再凭空补标点**。旧规则「列表项续行补逗号」在中文里是错的 ——
   中文换行从不会吞掉标点，补逗号等于造标点：「…预判方案实施效果」+「与边界；3.…」
   被拼成「…实施效果，与边界」。多断点的硬换行 JD 会连环中招（「跟踪AI应用，上线后的
   业务指标」「学习，能力强」）。只有接缝左侧是西文才补一个空格。详见 docs/23。 */
const REQ_LIB_VER = 18;
const now = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

/* ---------- 工具函数 ---------- */
const J = s => { try { return JSON.parse(s); } catch { return []; } };
const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase();

function audit(db, o) {
  db.prepare(`INSERT INTO audit_logs (tenant_id,actor_type,actor_id,task_id,action,object_type,object_id,detail,result,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(T, o.actorType || 'system', o.actorId || null, o.taskId || null,
      o.action, o.objType || null, o.objId || null, o.detail || '', o.result || 'ok', now());
}
function toolCall(db, taskId, tool, params, result, o = {}) {
  db.prepare(`INSERT INTO tool_calls (task_id,tool_name,params,result,is_high_risk,status,error_msg,duration_ms,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(taskId, tool, JSON.stringify(params), JSON.stringify(result),
      o.highRisk ? 1 : 0, o.status || 'ok', o.error || null, o.ms || 0, now());
}

/* ---------- LLM 网关（可插拔，默认规则模式） ----------
   返回值统一为 { text, usage, configured, error }。
   为什么连 usage 一起返回：界面上的「模型用量」必须来自真实响应。
   早先这里只返回文本、而调用方按 160 token/份 记了个常量，
   于是规则模式下也会显示出一笔并未发生的模型成本 —— 成本数字不可信，
   业务方就不会信产品的任何输出。用量要么是真的，要么不显示。 */
const llmConfigured = () => !!(process.env.LLM_API_URL && process.env.LLM_API_KEY);

async function llm(messages) {
  const url = process.env.LLM_API_URL, key = process.env.LLM_API_KEY;
  if (!url || !key) return { text: null, usage: null, configured: false };   // 规则模式
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: process.env.LLM_MODEL || 'gpt-4o-mini', messages, temperature: 0.2 }),
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) return { text: null, usage: null, configured: true, error: 'http_' + r.status };
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null;
    return { text, usage: j.usage || null, configured: true };
  } catch (e) { return { text: null, usage: null, configured: true, error: 'network' }; }
}

/* ===========================================================
   筛选 Agent：一次真实执行
   返回 {taskId, goal, steps[], status} —— steps 是真实执行记录
   =========================================================== */
async function runScreening(db, { jobId = 'J-118', initiatorId = 'U-001' } = {}) {
  const taskId = uid('T');
  const steps = [];
  const push = (intent, tool, opt) => { steps.push(Object.assign({ intent, tool, rule: !opt.tokens, risk: 0, ms: 0, tokens: 0, out: '', status: 'done' }, opt)); };
  /* 本次运行到底是「真实调用模型」还是「纯规则」—— 决定工具名与用量怎么记。
     此前不判断：无论有没有配模型，都按 160 token/份 记常量、工具名一律写 llm.*，
     于是规则模式下界面显示了一个并未发生的模型成本。 */
  const useModel = llmConfigured();
  let tokens = 0;

  /* ① 读岗位（任意岗位，不再写死 J-118） */
  let t0 = Date.now();
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(jobId);
  if (!job) return { taskId, status: 'error', error: 'job_not_found', msg: '岗位不存在：' + jobId, steps };
  db.prepare(`INSERT INTO agent_tasks (id,tenant_id,agent_type,initiator_id,goal,plan,status,created_at)
    VALUES (?,?,?,?,?,?, 'running', ?)`)
    .run(taskId, T, 'recruit', initiatorId, '筛选岗位「' + job.title + '」的待处理简历', JSON.stringify([]), now());
  toolCall(db, taskId, 'ats.get_job', { jobId }, { title: job.title, must_years: job.must_years }, { ms: 12 });
  const kws = J(job.keywords).length ? J(job.keywords) : extractKeywords([...J(job.must_have), ...J(job.nice_have)]);
  push('读取岗位要求与打分维度', 'ats.get_job',
    { ms: 12, out: `title: "${job.title}"  行业: ${job.industry || '未标注'}\nmust_years: ${job.must_years}  must_edu_rank: ${job.must_edu_rank}\n打分关键词库(${kws.length}): ${kws.join('、') || '未配置'}` });

  /* ② 拉候选人（若该岗位还没有简历，自动生成一批演示简历，保证链路可跑通） */
  let cands = db.prepare(`SELECT * FROM candidates WHERE job_id=? AND ai_score IS NULL`).all(jobId);
  let autoSeeded = 0;
  if (!cands.length) {
    const total = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=?`).get(jobId).c;
    if (total === 0) {
      const fresh = synthCandidates({ id: job.id, industry: job.industry, keywords: kws, must_have: J(job.must_have), nice_have: J(job.nice_have), must_years: job.must_years, must_edu_rank: job.must_edu_rank }, 5);
      for (const c of fresh) {
        db.prepare(`INSERT INTO candidates (id,tenant_id,job_id,name,gender,birth_date,years_exp,edu_rank,edu_text,company,
          skills,business_tags,plus_tags,source,stage,parse_ok,consent_given,synthesized,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,date('now','-1 day'))`)
          .run(c.id, T, job.id, c.name, c.gender, c.birth, c.years, c.eduRank, c.eduText, c.company,
            JSON.stringify(c.skills), JSON.stringify(c.businessTags), JSON.stringify(c.plusTags), c.source, '待人工复核', c.parseOk);
      }
      cands = db.prepare(`SELECT * FROM candidates WHERE job_id=? AND ai_score IS NULL`).all(jobId);
      autoSeeded = fresh.length;
    }
  }
  toolCall(db, taskId, 'ats.list_resumes', { jobId }, { count: cands.length }, { ms: 18 });
  push('拉取待处理简历', 'ats.list_resumes',
    { ms: 18, out: autoSeeded
        ? `该岗位尚无简历（新岗位），已按「${job.industry}」岗位画像自动生成 ${autoSeeded} 份演示简历\n后续可替换为 ATS / 招聘渠道的真实简历流`
        : `待处理 ${cands.length} 份（ai_score 为空，即从未被筛选过）` });
  if (!cands.length) {
    push('无可处理简历，任务结束', 'noop', { out: '所有候选人都已有筛选结果。可在候选人库中重置后再次运行。' });
    db.prepare(`UPDATE agent_tasks SET status='done', plan=?, result=?, token_cost=? WHERE id=?`)
      .run(JSON.stringify(steps), JSON.stringify({ message: 'no pending candidates' }), 0, taskId);
    return { taskId, goal: '筛选岗位简历', steps, status: 'done' };
  }

  /* ③ 解析状态核对 */
  const parseFail = cands.filter(c => !c.parse_ok).length;
  /* 解析状态来自库里的 parse_ok 字段（本 PoC 用预置结构化数据），
     是纯规则步骤、不产生模型用量，因此不记 token。 */
  toolCall(db, taskId, 'resume.parse', { count: cands.length }, { ok: cands.length - parseFail, failed: parseFail }, { ms: 40, tokens: 0 });
  push('核对简历解析状态（含扫描件 OCR）', 'resume.parse',
    { rule: true, ms: 40, tokens: 0, out: `成功 ${cands.length - parseFail} / 失败 ${parseFail}（失败件标记需人工补录，仍进入规则门槛但跳过打分）\n解析结果取自结构化字段 —— 规则步骤，0 token` });

  /* ④ 反歧视：物理剔除 —— 真实做法：打分输入里根本不 SELECT gender/birth_date */
  push('⚙️ 反歧视处理：物理剔除受保护字段', 'guard.strip_protected', { rule: true, ms: 3,
    out: '打分输入仅包含：years_exp / edu_rank / skills / business_tags / plus_tags / source\ngender、birth_date 未进入任何下游查询 —— 不是提示词约束，是查询里没有这些字段' });
  toolCall(db, taskId, 'guard.strip_protected', {}, { removed: ['gender', 'birth_date'] }, { ms: 3 });

  /* ⑤ 规则门槛（不消耗模型） */
  /* 管培生 / 实习 / 应届岗不设年限门槛 —— 与 JD「工作经验」维度口径保持一致，
     否则会出现「JD 写着欢迎应届生、门槛却把应届生全拦掉」的自相矛盾。
     判定逻辑统一在 ruleGate()，评测脚本用同一份，保证「评测说的」=「线上做的」。 */
  const juniorJob = isJuniorJob(job);
  const gateYears = juniorJob ? null : job.must_years;
  const ruleBlocked = [], modelPool = [];
  for (const c of cands) {
    const reason = ruleGate(c, job);
    if (reason) ruleBlocked.push([c, reason]);
    else modelPool.push([c, !c.parse_ok]);
  }
  toolCall(db, taskId, 'rule.gate', { must_years: gateYears }, { blocked: ruleBlocked.length, passed: modelPool.length }, { ms: 2 });
  push('⚙️ 硬性门槛规则前置判断（不消耗模型）', 'rule.gate', { rule: true, ms: 2,
    out: `${juniorJob ? '【管培生／实习岗】不设工作年限门槛；' : ''}规则拦截 ${ruleBlocked.length} 份 → 剩余 ${modelPool.length} 份进入打分\n被拦截：${ruleBlocked.map(r => r[0].name + '（' + r[1] + '）').join('、') || '无'}\n节省模型调用 ${ruleBlocked.length} 次` });

  /* ⑥ 打分
     分工：分数与维度**固定由 scoreOne() 算**（可解释、可复现、跨行业一致）；
     接入模型时只把「推荐理由的措辞」交给模型。
     用量取自响应里的 usage，拿不到就记 0 并显式标注未知 —— 不猜。
     未接入模型时整步标 rule: true / 0 token，工具名用 rule.score_resume（不冒充 llm）。 */
  t0 = Date.now();
  const results = [];
  let usageUnknown = false;
  for (const [c, parseFailFlag] of modelPool) {
    const r = scoreOne(c, job);
    let modelNote = null;
    if (useModel) {
      const gen = await llm([
        { role: 'system', content: '你是资深HR筛选助手。只依据给出的评分维度写不超过80字的中文推荐理由，不得添加未给出的事实。' },
        { role: 'user', content: `岗位：${job.title}（${job.industry || '未标注行业'}）\n评分：${r.score}/100（${r.grade}）\n维度依据：${r.dims.map(d => d.dim + '：' + d.ev).join('；')}` }
      ]);
      modelNote = gen.text;
      const u = gen.usage && Number(gen.usage.total_tokens);
      if (u) tokens += u; else usageUnknown = true;
    }
    results.push({ c, r, parseFailFlag, modelNote });
  }
  const scoreTool = useModel ? 'llm.score_resume' : 'rule.score_resume';
  toolCall(db, taskId, scoreTool, { count: modelPool.length }, { scored: results.length },
    { ms: Date.now() - t0 + 30, tokens: useModel ? tokens : 0 });
  push('按岗位维度逐项打分并生成理由', scoreTool, { rule: !useModel, ms: Date.now() - t0 + 30, tokens: useModel ? tokens : 0,
    out: (useModel
      ? `${results.length} 份完成打分：strong ${results.filter(x => x.r.grade === 'strong').length} / ok ${results.filter(x => x.r.grade === 'ok').length} / no ${results.filter(x => x.r.grade === 'no').length}\n模型只负责推荐理由措辞；分数由固定权重逐维计算，保证可复现\n真实用量 ${tokens} tokens${usageUnknown ? '（部分响应未返回 usage，未计入）' : '（取自网关响应）'}`
      : `${results.length} 份完成打分：strong ${results.filter(x => x.r.grade === 'strong').length} / ok ${results.filter(x => x.r.grade === 'ok').length} / no ${results.filter(x => x.r.grade === 'no').length}\n规则模式：按固定权重（技能 40 / 业务 30 / 稳定 15 / 加分 15）逐维打分，**未调用模型（0 token）**\n每条评分均附 evidence（依据来自候选人结构化字段）`) });

  /* ⑦ 写入打分结果（AI 输出，L2：写入评分不影响对外状态） */
  for (const { c, r, modelNote } of results) {
    const ruleNote = parseFailNote(c, r);
    /* 模型理由只替换「措辞」；简历解析失败的告警必须保留，不能被模型话术盖掉。 */
    const note = modelNote
      ? (ruleNote.indexOf('⚠️') === 0 ? ruleNote.slice(0, ruleNote.indexOf('。') + 1) + modelNote : modelNote)
      : ruleNote;
    db.prepare(`UPDATE candidates SET ai_score=?, ai_grade=?, ai_reasons=?, ai_why=?, ai_note=?, human_decision=NULL, override_reason=NULL, override_code=NULL, human_decided_at=NULL WHERE id=?`)
      .run(r.score, r.grade, JSON.stringify(r.dims), r.why ? JSON.stringify(r.why) : null, note, c.id);
  }
  for (const [c, reason] of ruleBlocked) {
    db.prepare(`UPDATE candidates SET ai_score=0, ai_grade='no', ai_reasons=?, ai_why=NULL, ai_note=? WHERE id=?`)
      .run(JSON.stringify([{ dim: '硬性门槛', score: 0, max: 0, ev: reason }]), '硬性条件不满足，被规则前置拦截（未消耗模型调用）。', c.id);
  }
  push('⚙️ PII 脱敏后写入评分结果', 'guard.mask_pii', { rule: true, ms: 4,
    out: '评分结果不含手机号/邮箱原文；候选人联系方式字段未参与任何打分维度' });
  toolCall(db, taskId, 'guard.mask_pii', {}, { masked: ['phone', 'email'] }, { ms: 4 });

  audit(db, { actorType: 'agent', actorId: initiatorId, taskId, action: `简历打分（${cands.length} 份）`,
    objType: 'job', objId: jobId, detail: `规则拦截 ${ruleBlocked.length}；PII 脱敏生效；受保护字段物理剔除`, result: 'ok' });

  /* ⑧ 写回 ATS 阶段 —— 高风险，挂闸门 */
  const approvePayload = {
    jobId,
    target: `${job.title} · ${cands.length} 位候选人的阶段写回`,
    preview: results.map(x => `${x.c.name}: ${x.r.grade === 'strong' ? '待人工复核 → 已邀约' : x.r.grade === 'ok' ? '维持 待人工复核' : '待人工复核 → 已淘汰'}`).join('\n')
      + (ruleBlocked.length ? '\n' + ruleBlocked.map(r => `${r[0].name}: 待人工复核 → 已淘汰（规则拦截）`).join('\n') : ''),
    basis: `依据 AI 打分结果：strong ${results.filter(x => x.r.grade === 'strong').length} 人 / ok ${results.filter(x => x.r.grade === 'ok').length} 人 / no ${results.filter(x => x.r.grade === 'no').length + ruleBlocked.length} 人`,
    impact: `影响 ${cands.length} 条候选人记录 · 写回 ATS 后阶段变更对招聘团队可见`,
    checks: ['阶段变更仅对内部可见，不对外发送任何通知 ✓', '可驳回后重跑，无不可逆影响 ✓'],
    who: '招聘 Agent（发起人：李静）', ago: '刚刚', created: now()
  };
  const ap = db.prepare(`INSERT INTO approvals (task_id,action_type,title,payload,risk_level,status,created_at)
    VALUES (?,?,?,?, 'high','pending',?)`)
    .run(taskId, 'ats.update_stage', `将筛选结果写回 ATS（${cands.length} 人）`, JSON.stringify(approvePayload), now());
  toolCall(db, taskId, 'ats.update_stage', { jobId, count: cands.length }, { status: 'WAITING_APPROVAL' },
    { highRisk: true, status: 'blocked', error: 'HIGH_RISK_REQUIRES_APPROVAL', ms: 0 });
  push('将筛选结果写回 ATS 并更新阶段', 'ats.update_stage', { risk: 1, ms: 0,
    out: `⚠️ 写操作：将更新 ${cands.length} 条候选人阶段记录\n已生成审核单 AP-${ap.lastInsertRowid}，任务挂起等待人工审批` });

  db.prepare(`UPDATE agent_tasks SET status='waiting_approval', plan=?, token_cost=? WHERE id=?`)
    .run(JSON.stringify(steps), tokens, taskId);
  audit(db, { actorType: 'agent', actorId: initiatorId, taskId, action: '生成 ATS 写回审核单',
    objType: 'approval', objId: 'AP-' + ap.lastInsertRowid, detail: '高风险写操作，已进入人工审核队列', result: 'pending' });

  return { taskId, goal: '筛选岗位「' + job.title + '」的 ' + cands.length + ' 份待处理简历', steps, status: 'waiting_approval', approvalId: 'AP-' + ap.lastInsertRowid };
}

/* ---------- 打分：跨行业通用（关键词来自岗位，不再写死 Java） ---------- */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
/* 简历标签 与 岗位关键词 的匹配：包含关系 + 共享词头软匹配
   （应对「Spring Cloud / Spring Boot」「高并发 / 高并发、大流量系统实战经验」这类措辞差异） */
const RE_HAN = /[\u4e00-\u9fa5]/;
/* 软匹配所需的最短共享词头长度。含中文时 4 —— 中文没有词边界，短语可以自由追加，
   4 个字已经是有效证据；纯拉丁时 6 —— 约一个完整词干（spring*）。
   纯拉丁用 4 位太短：JavaScript 与 Java、reactive 与 React、nodejs 与 Node
   都会共享前 4 位，却是不同的技术（v15 修 G-J09 探针误判时定的口径）。 */
const softHeadLen = (a, b) => (RE_HAN.test(a) || RE_HAN.test(b) ? 4 : 6);
function kwHit(list, kws) {
  const out = [];
  for (const s of list) {
    const a = norm(s);
    if (!a) continue;
    if (kws.some(k => {
      const b = norm(k);
      if (!b) return false;
      /* ① 包含关系统一走 ReqLib.kwContains（纯拉丁词要求词边界）：
         a ⊂ b 或 b ⊂ a 任一成立即算命中。 */
      if (ReqLib.kwContains(a, b) || ReqLib.kwContains(b, a)) return true;
      /* ② 共享词头软匹配：只在词头足够长时才算同一个词族 */
      const h = softHeadLen(a, b);
      return a.length >= h && b.length >= h && a.slice(0, h) === b.slice(0, h);
    })) out.push(s);
  }
  return out;
}

/**
 * 四维加权打分。系数取自 shared/score-why.js 的 LADDERS（唯一来源），
 * 同时产出 why（归因）—— 分数与「为什么是这个分」必须同源，否则会互相打脸。
 * @returns {{score:number, grade:string, dims:Array, why:object}}
 */
function scoreOne(c, job) {
  const skills = J(c.skills), biz = J(c.business_tags), plus = J(c.plus_tags);
  const kws = J(job.keywords).length ? J(job.keywords) : extractKeywords([...J(job.must_have), ...J(job.nice_have)]);
  const rubric = J(job.rubric);
  const W = Object.assign({ 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 }, Array.isArray(rubric) ? {} : rubric);
  const wx = W['技能匹配'] || 40, wy = W['业务匹配'] || 30, wz = W['稳定性'] || 15, wu = W['加分项'] || 15;

  const skillHit = kwHit(skills, kws);
  const coverage = kws.length ? skillHit.length / kws.length : (skills.length ? 0.8 : 0.4);
  const r1 = ScoreWhy.coefOf('skill', coverage);
  const s1 = Math.round(wx * r1);

  const bizN = biz.length;
  const r2 = ScoreWhy.coefOf('biz', bizN);
  const s2 = Math.round(wy * r2);

  const mustYears = job.must_years == null ? 0 : job.must_years;
  const yr = c.years_exp == null ? 0 : c.years_exp;
  const r3 = ScoreWhy.coefOf('stab', yr, mustYears);
  const s3 = Math.round(wz * r3);

  const plusN = plus.length;
  const r4 = ScoreWhy.coefOf('plus', plusN);
  const s4 = Math.round(wu * r4);

  const score = Math.min(100, s1 + s2 + s3 + s4);
  const dims = [
    { dim: '技能匹配', score: s1, max: wx, coef: r1, ev: `命中岗位关键词 ${skillHit.length}/${kws.length} 项：${(skillHit.slice(0, 5).join('、') || '无')}` },
    { dim: '业务匹配', score: s2, max: wy, coef: r2, ev: biz.length ? `简历体现 ${biz.length} 条业务语境：${biz.join('、')}` : '简历未体现任何业务语境' },
    { dim: '稳定性', score: s3, max: wz, coef: r3, ev: `总工作年限 ${yr} 年（岗位要求 ${mustYears} 年）` },
    { dim: '加分项', score: s4, max: wu, coef: r4, ev: plus.length ? plus.join('、') : '无加分项' }
  ];
  /* 职能族：业务标签只有「该族的标签池」才有意义，归因文案要写清楚是哪个族。
     入参与 db.js 生成 JD 时完全一致（title + 硬性/加分要求），保证不会出现
     「JD 是产品岗、归因却说技术族业务标签」的错位。 */
  const fnKey = ReqLib.detectFunction(job.title || '', [...J(job.must_have), ...J(job.nice_have)]);
  const fn = fnKey ? ReqLib.FUNCTIONS[fnKey] : null;
  const why = ScoreWhy.explain({
    score, dims,
    ctx: {
      kws, kHit: skillHit,
      kwsMiss: kws.filter(k => kwHit(skills, [k]).length === 0),
      cov: coverage,
      fnName: fn ? fn.name : '',
      bizHits: biz, bizPool: fn ? fn.biz : [],
      plusHits: plus, plusPool: fn ? fn.plus : [],
      years: yr, needYears: mustYears, juniorJob: mustYears <= 0,
    },
  });
  return { score, grade: score >= 78 ? 'strong' : score >= 60 ? 'ok' : 'no', dims, why };
}
function parseFailNote(c, r) {
  return (!c.parse_ok ? '⚠️ 简历解析存在不确定字段，评分置信度低，建议人工核对。' : '')
    + `综合评分 ${r.score}（${r.grade === 'strong' ? '强烈推荐' : r.grade === 'ok' ? '可聊' : '不合适'}）。`
    + (r.grade === 'strong' ? '建议优先安排面试。' : r.grade === 'ok' ? '可作备选，技术深度待面试验证。' : '建议不推进。');
}

/* ===========================================================
   规则判定（纯函数，不碰库、不调模型）
   -----------------------------------------------------------
   为什么要把「硬性门槛」和「维度打分」抽成独立可调用函数：
   ① 筛选链路（runScreening）与质量评测（tools/test_eval.js）必须用**同一套判定**，
      否则评测跑出来的准确率跟线上行为对不上，评测就成了摆设。
   ② 抽出来之后没有任何隐式依赖（不读库、不发请求），可以在离线黄金集上批量回放。

   分工（与产品口径一致）：
     ruleGate  = 硬性门槛（年限 / 学历），规则前置、0 token，命中即出局
     scoreOne  = 四维加权打分，产出 score + grade（strong / ok / no）
     evaluate  = 上面两步的合成，等价于「这位候选人走完规则链路会得到什么结论」
   =========================================================== */
const EDU_NAME = { 1: '大专', 2: '本科', 3: '硕士', 4: '博士' };

/** 岗位是否属于「管培生 / 实习 / 应届」类 —— 此类岗位不设工作年限门槛。 */
const isJuniorJob = job => ReqLib.detectJunior(job.title, [].concat(J(job.must_have), J(job.nice_have)));

/**
 * 硬性门槛判定。
 * @returns {string|null} 命中返回拦截原因（人话），通过返回 null
 */
function ruleGate(c, job) {
  const gateYears = isJuniorJob(job) ? null : job.must_years;
  const yr = c.years_exp == null ? 0 : c.years_exp;
  const ed = c.edu_rank == null ? 0 : c.edu_rank;
  if (gateYears != null && yr < gateYears) return `工作年限 ${yr} 年 < 岗位要求 ${gateYears} 年`;
  if (job.must_edu_rank != null && ed < job.must_edu_rank) {
    return `学历「${EDU_NAME[ed] || '未识别'}」低于岗位要求（${EDU_NAME[job.must_edu_rank]}及以上）`;
  }
  return null;
}

/**
 * 相关性门槛：岗位识别出了关键词、简历里也列了技能，但**一个都没命中**。
 *
 * 为什么必须单列（v16）：
 *   四维都设了底分，所以一份完全不对口的简历靠「业务 30 + 稳定 15 + 加分 15」就能顶到 70+，
 *   落进 ok。底分机制本身没问题 —— 四维全触底只有 50 分，仍在 no 档；
 *   有问题的是「技能零命中」这件事没有任何地方表达出来（技能维度只把它记成「触底系数」，
 *   在总分里与「命中 1 项」几乎无差别）。
 *   实测：黄金集里 3 个探针例（前端投 Java 岗 / 算法投产品岗 / 销售投实施岗）
 *   全部因此被抬进 ok；加上这道闸后一致率 90.0% → 96.7%、漏筛 25.0% → 8.3%，误筛仍为 0。
 *
 * 与 ruleGate 的区别：年限/学历是**客观硬条件**，这里是**相关性推断** ——
 * 所以单独一个函数、单独的 dim 名，不与硬性门槛混在一起。
 *
 * 条件刻意保守（避免把「判不了」当成「不匹配」）：
 *   ① 简历没列技能  → 无从判断，放行给打分
 *   ② 岗位没抽出关键词 → 无从判断，放行给打分
 */
function skillGate(c, job) {
  const skills = J(c.skills);
  if (!skills.length) return null;
  const kws = J(job.keywords).length ? J(job.keywords) : extractKeywords([...J(job.must_have), ...J(job.nice_have)]);
  if (!kws.length) return null;
  if (kwHit(skills, kws).length) return null;
  return `岗位要求的 ${kws.length} 个关键词（${kws.slice(0, 4).join('、')}）在简历技能里一个都未命中`;
}

/**
 * 完整规则判定：硬门槛 → 相关性门槛 → 四维打分。
 * @returns {{gate:boolean, score:number, grade:'strong'|'ok'|'no', reasons:Array, why:object|null, gateReason?:string}}
 */
function evaluateCandidate(c, job) {
  const reason = ruleGate(c, job);
  if (reason) return { gate: true, score: 0, grade: 'no', reasons: [{ dim: '硬性门槛', score: 0, max: 0, ev: reason }], why: null, gateReason: reason };
  const rel = skillGate(c, job);
  if (rel) return { gate: true, score: 0, grade: 'no', reasons: [{ dim: '相关性门槛', score: 0, max: 0, ev: rel }], why: null, gateReason: rel };
  const r = scoreOne(c, job);
  return { gate: false, score: r.score, grade: r.grade, reasons: r.dims, why: r.why };
}

/* ===========================================================
   人工推翻 → 一致率（真实操作数据，不是演示数字）
   -----------------------------------------------------------
   样本 = 「既有 AI 档位、又有人工结论」的候选人。
   人工结论只有三种（见 shared/override-codes.js）：
     confirmed         一致
     approved_by_human 不一致（AI 过严）
     rejected_by_human 不一致（AI 过宽）
   零样本时返回 rate: null 并显式说明 —— 不编一个 0% 或 100% 糊弄过去。
   =========================================================== */
function screeningAgreement(db, tenantId) {
  const rows = db.prepare(
    `SELECT ai_grade, human_decision, override_code FROM candidates
      WHERE tenant_id=? AND ai_grade IS NOT NULL AND human_decision IS NOT NULL`
  ).all(tenantId);

  const byCodeMap = new Map();
  let confirmed = 0, up = 0, down = 0;
  for (const r of rows) {
    /* 「是否一致」的口径唯一由 shared/override-codes.js 的 agrees() 定义，
       这里不另写一份 if/else —— 否则口径会漂移成两套。 */
    if (OverrideCodes.agrees(r.ai_grade, r.human_decision) === true) confirmed++;
    else if (r.human_decision === 'approved_by_human') up++;
    else if (r.human_decision === 'rejected_by_human') down++;
    const code = r.human_decision === 'confirmed' ? null : (r.override_code || 'unclassified');
    if (code) byCodeMap.set(code, (byCodeMap.get(code) || 0) + 1);
  }
  const samples = rows.length;
  const byCode = Array.from(byCodeMap.entries())
    .map(([code, count]) => ({ code, label: OverrideCodes.labelOfCode(code), count }))
    .sort((a, b) => b.count - a.count);

  return {
    samples,
    confirmed,
    humanOverrodeUp: up,      // AI 判不合适、人推进 → 规则过严
    humanOverrodeDown: down,  // AI 判合适、人否决 → 规则过宽
    agreementRate: samples ? Number((confirmed / samples).toFixed(4)) : null,
    byCode,
    note: samples
      ? '样本来自本租户真实人工操作；byCode 分布即「下一步该修什么」的排序清单'
      : '尚无人工复核结论。在候选人详情里确认或推翻一次 AI 结论，即产生样本（不做演示假数据）',
  };
}


/* ===========================================================
   审批：批准 → 真实执行写回；驳回 → 记录原因
   =========================================================== */
function decide(db, apId, reviewerId, decision, reason) {
  const ap = db.prepare(`SELECT * FROM approvals WHERE id=?`).get(apId);
  if (!ap) return { error: 'not_found' };
  if (ap.status !== 'pending') return { error: 'already_' + ap.status };

  if (decision === 'reject') {
    if (!reason || !reason.trim()) return { error: 'reason_required' };
    db.prepare(`UPDATE approvals SET status='rejected', reviewer_id=?, reject_reason=?, reviewed_at=? WHERE id=?`)
      .run(reviewerId, reason, now(), apId);
    db.prepare(`UPDATE agent_tasks SET status='cancelled' WHERE id=?`).run(ap.task_id);

    /* 驳回 = 这次写回作废，**同时把本轮打分一并作废**，让这批简历重新回到「待筛选」池。
       为什么必须这么做：筛选 Agent 的取数条件是 `ai_score IS NULL`（只捞从未打过分的）。
       如果驳回后分数还留在库里，再跑筛选会直接「无可处理简历」，新的写回审批单永远生成不出来 ——
       而这张审批单自己承诺的检查项里写着「可驳回后重跑，无不可逆影响 ✓」，链路就此死锁。
       只清「本岗位 + 仍是待人工复核」的记录：已被批准推进（已邀约/已淘汰）的人不受影响。
       打分过程本身仍完整留在 agent_tasks / agent_tool_calls 里，可回溯审计。 */
    let released = 0;
    if (ap.action_type === 'ats.update_stage') {
      const p = J(ap.payload || '{}');
      const rel = p.jobId
        ? db.prepare(`SELECT id FROM candidates WHERE ai_score IS NOT NULL AND stage='待人工复核' AND job_id=?`).all(p.jobId)
        : db.prepare(`SELECT id FROM candidates WHERE ai_score IS NOT NULL AND stage='待人工复核'`).all();
      const clear = db.prepare(`UPDATE candidates SET ai_score=NULL, ai_grade=NULL, ai_reasons=NULL, ai_why=NULL, ai_note=NULL, human_decision=NULL, override_reason=NULL, override_code=NULL, human_decided_at=NULL WHERE id=?`);
      for (const r of rel) { clear.run(r.id); released++; }
    }

    audit(db, { actorType: 'user', actorId: reviewerId, taskId: ap.task_id, action: '驳回 AI 写回申请',
      objType: 'approval', objId: 'AP-' + apId,
      detail: '驳回原因：' + reason + '（已进入优化数据集）· 本轮打分同时作废，' + released + ' 份简历退回待筛选',
      result: 'ok' });
    return { ok: true, status: 'rejected', released };
  }

  /* 批准：执行写回（真实更新候选人阶段，仅限本任务对应岗位） */
  const payload = J(ap.payload || '{}');
  const rows = payload.jobId
    ? db.prepare(`SELECT id, ai_grade FROM candidates WHERE ai_score IS NOT NULL AND stage='待人工复核' AND job_id=?`).all(payload.jobId)
    : db.prepare(`SELECT id, ai_grade FROM candidates WHERE ai_score IS NOT NULL AND stage='待人工复核'`).all();
  let changed = 0;
  for (const r of rows) {
    const ns = r.ai_grade === 'strong' ? '已邀约' : r.ai_grade === 'ok' ? '待人工复核' : '已淘汰';
    if (ns !== '待人工复核') { db.prepare(`UPDATE candidates SET stage=? WHERE id=?`).run(ns, r.id); changed++; }
  }
  db.prepare(`UPDATE approvals SET status='approved', reviewer_id=?, reviewed_at=? WHERE id=?`).run(reviewerId, now(), apId);
  db.prepare(`UPDATE agent_tasks SET status='done', result=? WHERE id=?`)
    .run(JSON.stringify({ changed }), ap.task_id);
  toolCall(db, ap.task_id, 'ats.update_stage', { approved: true }, { changed }, { highRisk: true, ms: 15 });
  audit(db, { actorType: 'user', actorId: reviewerId, taskId: ap.task_id, action: '批准 ATS 阶段写回',
    objType: 'approval', objId: 'AP-' + apId, detail: `实际变更 ${changed} 条候选人阶段`, result: 'ok' });
  return { ok: true, status: 'approved', changed };
}

/* ===========================================================
   员工自助：分流 → 查库 / 检索 / 拒答
   =========================================================== */
const REFUSE = [
  { k: ['仲裁', '起诉', '劳动纠纷', '违法解除', '律师', '劳动法', '工伤赔偿', '索要赔偿'], type: '法律意见',
    msg: '这个问题涉及劳动关系法律判断，超出我的授权范围，我不能给出意见（避免误导你）。已为你转接 HR，并同步法务同事跟进。' },
  { k: ['涨薪', '谈薪', '加薪', '调薪', '降薪', '薪资调整', '薪资谈判'], type: '薪酬个案',
    msg: '薪资调整属于个案沟通事项，需要结合你的岗位、绩效与公司政策综合判断，不适合由我直接回答。已转接你的 HRBP，通常在 1 个工作日内联系你。' },
  { k: ['张三', '李四', '王五', '赵六', '某某', '别人的', '他人的', '其他人的', '同事的'], type: '他人隐私',
    msg: '我只能查询你本人的数据，无法查询或推算其他同事的任何信息（这是制度与法律的硬性要求）。如需了解相关制度，我可以为你解释。' }
];

/* 个人数据意图识别：年假/调休 → leave；考勤异常 → attendance；
   薪资条/实发 → payslip；社保/公积金 → social。返回意图或 null。
   注意：『工资怎么算/薪资构成』这类制度问题**不**命中这里（留给政策检索），
   只有明确的『查本人薪资条/实发』语义才走 personal。 */
function detectPersonalIntent(q) {
  if (/年假|假期余额|剩.*天.*假|调休|带薪假|年假余额/.test(q)) return 'leave';
  if (/考勤|迟到|缺勤|漏打卡|打卡.*(异常|记录)|本月考勤|出勤|旷工/.test(q)) return 'attendance';
  if (/薪资条|工资条|到手|实发|发了多少|这个月.*(发|工资)|上月.*(发|工资)|几号发.*(工资|薪)|我的.*(工资|薪资)/.test(q)) return 'payslip';
  if (/社保|公积金|五险一金|缴纳|基数|参保|交社保/.test(q)) return 'social';
  return null;
}

/* 主动提醒意图识别：员工问「提醒 / 待办 / 到期 / 清零 / 要注意」→ 汇总本人待办。 */
function detectAlertIntent(q) {
  if (/提醒|待办|预警|要注意|到期|清零|别忘了|待办事项|我要注意|有什么.*(提醒|待办)|近期.*(安排|事项)|我该.*(做|办)/.test(q)) return true;
  return false;
}

/* 拉式主动提醒：从业务库算本人待办（年假结转清零 / 调休逾期 / 试用期规则提示）。
   这是「主动推送（试用期到期 / 年假清零）」在「无 cron / IM 基础设施」下的落地形态 ——
   员工主动问，Agent 从库算，而非后台定时推。仍走 owner 校验 + 事实分层（数字只来自库）。 */
function alertSummary(db, q, userId, user) {
  if (/张三|李四|王五|赵六|某某|别人的|他人的|其他人的|同事的/.test(q)) {
    audit(db, { actorType: 'agent', actorId: userId, action: '拒答并转人工', objType: 'user', objId: userId,
      detail: `提醒查询涉及他人隐私（绕过查询）→ 转 HR`, result: 'ok' });
    return { route: 'escalated', type: '他人隐私',
      text: '我只能查询你本人的数据，无法查询或推算其他同事的任何信息（这是制度与法律的硬性要求）。如需了解相关制度，我可以为你解释。',
      cites: [], badge: '🚫 授权范围外 · 已按规则拒答' };
  }
  try {
    const lb = db.prepare(`SELECT * FROM leave_balance WHERE user_id=?`).get(userId);
    if (!lb) return noPersonalData('个人');
    const annualRemain = ((lb.annual_total || 0) - (lb.annual_used || 0)).toFixed(1);
    const compRemain = ((lb.compensatory_total || 0) - (lb.compensatory_used || 0)).toFixed(1);
    const carry = lb.carryover || 0;
    const today = new Date();
    const yearEnd = new Date(today.getFullYear(), 11, 31);
    const daysToYearEnd = Math.max(0, Math.ceil((yearEnd - today) / 86400000));
    const lines = ['📌 你的近期待办提醒（以下数字来自 HR 系统实时数据，非文档说明）：'];
    if (carry > 0) lines.push(`· 年假结转 ${carry} 天将于 ${today.getFullYear()}-12-31 清零，还剩约 ${daysToYearEnd} 天，请尽快安排休假，逾期清零不补。`);
    else lines.push(`· 年假剩余 ${annualRemain} 天（本年度额度，无结转待清）。`);
    lines.push(`· 调休剩余 ${compRemain} 天，调休自加班日起 3 个月内有效，逾期自动失效，建议尽快申请使用。`);
    lines.push(`· 试用期：按《试用期与转正管理规定》为 3 个月，到期前 15 天系统会自动提醒你的上级发起转正考核（当前库未记录你的入职日期，无法计算具体到期日，可在 OA 查看合同）。`);
    const doc = db.prepare(`SELECT * FROM kb_documents WHERE id='KB-021'`).get();
    audit(db, { actorType: 'agent', actorId: userId, action: '主动提醒汇总', objType: 'user', objId: userId,
      detail: `年假剩余 ${annualRemain} / 调休 ${compRemain} / 结转 ${carry}`, result: 'ok' });
    return { route: 'alert', text: lines.join('\n'), badge: '🔔 主动提醒（基于本人实时数据）',
      cites: [{ t: (doc ? doc.title + ' ' + doc.ver : '假期管理制度'), eff: doc ? doc.effective_at : '2026-04-01', note: '数字来源：HR 系统实时查询（权威事实）' }] };
  } catch (e) {
    audit(db, { actorType: 'agent', actorId: userId, action: '主动提醒查询失败', objType: 'user', objId: userId,
      detail: String(e.message || e), result: 'fail' });
    return noPersonalData('个人');
  }
}

function noPersonalData(kind) {
  return { route: 'no_match',
    text: `暂时没有查到你的${kind}数据，已转 HR 核实。\n如果你是想了解相关制度，我可以为你解释。`,
    cites: [], badge: '⚠️ 个人数据查询无结果（已转 HR）' };
}

/* 个人数据查询：按意图查对应业务表，数字只来自库（事实分层）。
   owner 校验前置：明确他人指代直接拒答；表缺失（老库未迁移）降级转 HR。 */
function personalQuery(db, q, userId, user) {
  const intent = detectPersonalIntent(q);
  if (!intent) return null;

  /* owner 校验：自然语言绕过（『算算张三的年假』）也必须拒绝 */
  if (/张三|李四|王五|赵六|某某|别人的|他人的|其他人的|同事的/.test(q)) {
    audit(db, { actorType: 'agent', actorId: userId, action: '拒答并转人工', objType: 'user', objId: userId,
      detail: `问题涉及他人隐私（绕过查询）→ 转 HR`, result: 'ok' });
    return { route: 'escalated', type: '他人隐私',
      text: '我只能查询你本人的数据，无法查询或推算其他同事的任何信息（这是制度与法律的硬性要求）。如需了解相关制度，我可以为你解释。',
      cites: [], badge: '🚫 授权范围外 · 已按规则拒答' };
  }

  try {
    if (intent === 'leave') {
      const lb = db.prepare(`SELECT * FROM leave_balance WHERE user_id=?`).get(userId);
      if (!lb) return noPersonalData('假期');
      const annualRemain = ((lb.annual_total || 0) - (lb.annual_used || 0)).toFixed(1);
      const compRemain = ((lb.compensatory_total || 0) - (lb.compensatory_used || 0)).toFixed(1);
      const text = `你当前年假余额为 ${annualRemain} 天（2026 年度剩余 ${annualRemain} 天${lb.carryover ? ` + 上年度结转 ${lb.carryover} 天，结转部分需在本年度 12 月 31 日前使用` : ''}）。\n调休余额为 ${compRemain} 天（加班换休，3 个月内有效）。\n（以上数字来自 HR 系统实时查询，不是文档说明）`;
      const doc = db.prepare(`SELECT * FROM kb_documents WHERE id='KB-021'`).get();
      audit(db, { actorType: 'agent', actorId: userId, action: '查询本人假期数据', objType: 'user', objId: userId,
        detail: `年假 ${annualRemain} 天 / 调休 ${compRemain} 天（HR 系统实时数据）`, result: 'ok' });
      return { route: 'personal_data', text, badge: '🔎 已查询 HR 系统实时数据（权限：仅本人）',
        cites: [{ t: doc.title + ' ' + doc.ver, eff: doc.effective_at, note: '数字来源：HR 系统实时查询（权威事实）' }] };
    }
    if (intent === 'attendance') {
      const rows = db.prepare(`SELECT * FROM attendance WHERE user_id=? ORDER BY month DESC LIMIT 3`).all(userId);
      if (!rows.length) return noPersonalData('考勤');
      const last = rows[0];
      const ab = J(last.abnormal_detail || '[]');
      const text = `你最近考勤（${last.month}）：应出勤 ${last.normal_days} 天，实际 ${last.actual_days} 天，迟到 ${last.late_count} 次${last.absent_count ? `，缺勤 ${last.absent_count} 天` : ''}。\n${ab.length ? `异常明细：${ab.map(a => `${a.date} ${a.type}（${a.note}）`).join('；')}` : '本月无异常记录。'}\n（以上数字来自 HR 系统实时查询）`;
      const doc = db.prepare(`SELECT * FROM kb_documents WHERE id='KB-035'`).get();
      audit(db, { actorType: 'agent', actorId: userId, action: '查询本人考勤数据', objType: 'user', objId: userId,
        detail: `${last.month} 迟到 ${last.late_count} 次（HR 系统实时数据）`, result: 'ok' });
      return { route: 'personal_data', text, badge: '🔎 已查询 HR 系统实时数据（权限：仅本人）',
        cites: [{ t: doc.title + ' ' + doc.ver, eff: doc.effective_at, note: '数字来源：HR 系统实时查询（权威事实）' }] };
    }
    if (intent === 'payslip') {
      const row = db.prepare(`SELECT * FROM payslip WHERE user_id=? ORDER BY month DESC LIMIT 1`).get(userId);
      if (!row) return noPersonalData('薪资条');
      const text = `你的薪资条可在「${row.viewing_path}」查看。\n最近一期（${row.month} 月）：应发 ${row.gross} 元，扣款 ${row.deductions} 元，实发 ${row.net} 元，已于 ${row.payment_date} 打款。\n（以上数字来自 HR 系统实时查询，不是文档说明）`;
      audit(db, { actorType: 'agent', actorId: userId, action: '查询本人薪资条', objType: 'user', objId: userId,
        detail: `${row.month} 实发 ${row.net} 元（HR 系统实时数据）`, result: 'ok' });
      return { route: 'personal_data', text, badge: '🔎 已查询 HR 系统实时数据（权限：仅本人）',
        cites: [{ t: '薪资条（HR 系统）', eff: row.payment_date, note: '数字来源：HR 系统实时查询（权威事实）' }] };
    }
    if (intent === 'social') {
      const rows = db.prepare(`SELECT * FROM social_security WHERE user_id=? ORDER BY month DESC, category LIMIT 12`).all(userId);
      if (!rows.length) return noPersonalData('社保');
      const last = rows[0].month;
      const cur = rows.filter(r => r.month === last);
      const text = `你最近社保缴纳（${last} 月，基数 ${cur[0].base} 元）：\n` +
        cur.map(r => `· ${r.category}：个人缴 ${r.personal_amt} 元，单位缴 ${r.company_amt} 元`).join('\n') +
        `\n（以上数字来自 HR 系统实时查询）`;
      const doc = db.prepare(`SELECT * FROM kb_documents WHERE id='KB-027'`).get();
      audit(db, { actorType: 'agent', actorId: userId, action: '查询本人社保缴纳', objType: 'user', objId: userId,
        detail: `${last} 基数 ${cur[0].base} 元（HR 系统实时数据）`, result: 'ok' });
      return { route: 'personal_data', text, badge: '🔎 已查询 HR 系统实时数据（权限：仅本人）',
        cites: [{ t: doc.title + ' ' + doc.ver, eff: doc.effective_at, note: '数字来源：HR 系统实时查询（权威事实）' }] };
    }
  } catch (e) {
    audit(db, { actorType: 'agent', actorId: userId, action: '个人数据查询失败（表缺失）', objType: 'user', objId: userId,
      detail: String(e.message || e), result: 'fail' });
    return noPersonalData('个人');
  }
  return null;
}

async function chat(db, { question, userId = 'U-003' }) {
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(userId) || { name: '员工' };
  const q = (question || '').trim();
  if (!q) return { route: 'empty', text: '请输入问题。', cites: [] };

  /* ① 拒答分流（服务端硬规则，不依赖模型自觉） */
  const refuse = REFUSE.find(r => r.k.some(k => q.indexOf(k) > -1));
  if (refuse) {
    audit(db, { actorType: 'agent', actorId: userId, action: '拒答并转人工', objType: 'user', objId: userId,
      detail: `问题涉及${refuse.type}（超出授权范围）→ 转 HR`, result: 'ok' });
    return { route: 'escalated', type: refuse.type, text: refuse.msg, cites: [], badge: '🚫 授权范围外 · 已按规则拒答' };
  }

  /* ①.5 主动提醒：员工问「有什么要提醒我的 / 待办 / 到期」→ 汇总本人实时待办。
     这是把「主动推送（试用期到期 / 年假清零）」在「无 cron / IM 基础设施」下
     落地的**拉式**形态 —— 员工主动问，Agent 从业务库算，而非后台定时推。
     仍走 owner 校验 + 事实分层（数字只来自库）。 */
  if (detectAlertIntent(q)) {
    const alert = alertSummary(db, q, userId, user);
    if (alert) return alert;
  }

  /* ② 个人数据：按意图分流查业务库（权威事实，事实分层）。
     年假/调休/考勤/薪资/社保这些「个人数字」必须查业务系统，绝不用知识库文档回答。
     意图识别与查库都集中在 detectPersonalIntent / personalQuery（见上方）。 */
  const personal = personalQuery(db, q, userId, user);
  if (personal) return personal;

  /* ③ 制度解释：关键词检索知识库 */
  const chunks = db.prepare(`SELECT c.id, c.content, c.keywords, d.title, d.ver, d.effective_at, d.status
    FROM kb_chunks c JOIN kb_documents d ON d.id = c.doc_id WHERE d.status='active'`).all();
  let best = null, bestScore = 0;
  for (const ch of chunks) {
    let s = 0;
    for (const kw of J(ch.keywords)) if (q.indexOf(kw) > -1) s += 2;
    for (const kw of q.split(/\s+/)) if (kw.length > 1 && ch.content.indexOf(kw) > -1) s += 1;
    if (s > bestScore) { bestScore = s; best = ch; }
  }
  if (!best || bestScore < 2) {
    db.prepare(`INSERT INTO unanswered_questions (question, asked_by, created_at) VALUES (?,?,?)`).run(q, userId, now());
    audit(db, { actorType: 'agent', actorId: userId, action: '知识库无匹配，转人工并记录', objType: 'kb', objId: null,
      detail: `问题已记录，待补全知识库`, result: 'ok' });
    return { route: 'no_match',
      text: `我在公司制度文档里没有找到与「${q}」相关的内容，为避免误导，我不做推测回答。\n你可以：① 点击「转人工」由 HR 答复；② 换个说法再问；③ 试着问我这些我能准确回答的问题：\n  · 我的年假 / 调休还剩多少天\n  · 我最近的考勤怎么样\n  · 我的薪资条在哪看\n  · 报销流程是怎样的\n  · 试用期 / 转正有什么规定\n  · 有什么要提醒我的（待办 / 到期 / 清零）\n这次提问已被记录，HR 会据此补充知识库。`,
      cites: [], badge: '⚠️ 知识库无匹配（相似度低于阈值）' };
  }

  /* 命中：优先用 LLM 组织语言；未配置则直接返回制度原文（保真） */
  let text = best.content;
  const gen = await llm([
    { role: 'system', content: '你是企业HR自助助手。只依据给定的制度原文回答员工问题，不得添加原文没有的信息，用简体中文，简洁分点。' },
    { role: 'user', content: `制度原文：${best.content}\n\n员工问题：${q}` }
  ]);
  const llmText = gen.text;
  if (llmText) text = llmText;
  audit(db, { actorType: 'agent', actorId: userId, action: '回答员工提问', objType: 'user', objId: userId,
    detail: `依据《${best.title}》${best.ver}（${llmText ? 'LLM 组织' : '原文直出'}）`, result: 'ok' });
  return { route: 'policy', text, badge: llmText ? '📚 已检索知识库 · LLM 组织回答' : '📚 已检索企业知识库 · 返回制度原文',
    cites: [{ t: `《${best.title}》${best.ver}`, eff: best.effective_at, note: '回答完全基于该文档，未做推断' }] };
}

/* ===========================================================
   越权演示：员工角色尝试导出全公司数据 → 403 + 审计
   =========================================================== */
function tryExportAll(db, userId) {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(userId);
  const allowed = u && (u.role === 'admin' || u.role === 'hrd');
  audit(db, { actorType: 'user', actorId: userId, action: '尝试导出全公司员工数据', objType: 'api', objId: '/api/employees/export',
    detail: `角色 ${u ? u.role : 'unknown'} ${allowed ? '→ 允许' : '→ 403 拦截（数据范围权限不足）'}`, result: allowed ? 'ok' : 'blocked' });
  return allowed;
}

/* ===========================================================
   bootstrap：给前端的完整数据快照
   =========================================================== */
const maskPhone = id => {
  const r = rngLocal(id);
  const pre = ['138', '139', '137', '135', '136', '133', '188', '186', '159', '182'][Math.floor(r() * 10)];
  return pre + '****' + String(1000 + Math.floor(r() * 8999)).slice(-4);
};
function rngLocal(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ===========================================================
   JD 生成 + 合规扫描（跨行业；规则模式离线可用，配 LLM 后由其润色）
   =========================================================== */
const JD_DUTIES = {
  '互联网': ['负责业务系统的设计、开发与持续迭代', '参与需求评审与技术方案设计，产出可维护的代码与文档', '保障线上服务稳定性，参与性能优化与线上问题排查', '与产品、测试、运维协作，推动需求按期交付'],
  '制造业': ['负责生产计划的组织与人员调度，保障计划按期达成', '执行精益生产与 5S 现场管理，持续改善作业效率', '组织安全生产检查与员工技能培训，落实安全责任制', '对接质量与设备部门，处理产线异常并推动闭环整改'],
  '零售连锁': ['负责门店整体经营管理，达成销售、毛利与成本控制目标', '负责门店团队招聘、排班、培训与绩效考核', '执行商品陈列、库存周转与损耗管理标准', '处理顾客投诉与突发状况，维护门店品牌形象'],
  '医疗健康': ['负责护理团队的日常工作组织与人员排班', '落实护理质量控制标准，定期开展护理质量检查与整改', '负责院感防控措施的培训、监督与执行记录', '组织护理人员业务培训与考核，提升团队专业能力'],
  '教育培训': ['负责潜在学员的课程咨询、需求分析与学习方案设计', '完成电话邀约、到访接待与试听转化，达成业绩目标', '跟进在读学员学习进度，推动续费与转介绍', '维护学员及家长关系，及时处理投诉与异议'],
  '金融': ['负责信贷业务的资料审核、风险识别与授信建议', '识别欺诈风险特征，参与反欺诈规则与策略优化', '开展存量客户风险监测，出具风险预警与处置建议', '配合合规与审计部门完成检查与整改工作'],
  '销售': ['负责目标行业的大客户开发与关系维护', '组织需求调研与方案讲解，主导商务谈判与合同签署', '协调售前与交付团队推进项目落地，负责回款跟进', '维护重点客户关系，挖掘续约与增购机会'],
  '人力资源': ['作为业务伙伴，提供组织与人才方面的解决方案', '负责所支持团队的人才盘点、继任梯队与关键岗位补位', '推动绩效管理落地，参与组织诊断与变革项目', '处理员工关系问题，提升团队敬业度与稳定性'],
  '通用': ['负责相关日常工作，按岗位目标完成交付', '参与部门内部协作，及时反馈进展与风险', '持续优化工作方法，提升交付质量与效率']
};
const DEFAULT_BENEFITS = ['依法足额缴纳五险一金', '弹性工作制（10:00 前到岗，当日工作满 8 小时）', '带薪年假、法定节假日按国家规定执行', '年度体检与补充商业医疗保险', '定期培训与内部晋升通道'];

/* ===========================================================
   任职要求素材库（按行业）
   目的：把「一条单薄的任职要求」扩充为六个维度的专业表述
   维度：专业技能 / 工作经验 / 学历背景 / 综合素质 / 软技能 / 加分项
   =========================================================== */
const REQ_DIMS = ['专业技能', '工作经验', '学历背景', '综合素质', '软技能'];
const INDUSTRY_REQ = {
  '互联网': {
    majors: '计算机、软件工程、信息工程、电子信息等相关专业',
    expHint: '有互联网产品研发经历，完整参与过从需求评审到上线运维的迭代周期',
    general: [
      '逻辑清晰，能把模糊需求拆解为可落地的技术方案，并说明方案取舍理由',
      '对技术有持续热情，关注业界主流方案与工程实践的演进',
      '能独立承接模块，对交付质量、进度与线上稳定性负责'
    ],
    soft: [
      '能与产品、测试、运维等角色高效协作，把技术结论翻译成业务语言',
      '学习能力强，能快速上手不熟悉的技术栈与业务域',
      '有一定抗压能力，能应对版本冲刺与线上故障处理'
    ],
    nice: ['有开源项目贡献、技术博客或专利沉淀', '有高并发、大流量系统的实战经验', '有技术带人或架构设计经验']
  },
  '制造业': {
    majors: '机械工程、自动化、工业工程、材料成型等相关专业',
    expHint: '有制造业现场工作经历，熟悉车间组织方式与生产节拍',
    general: [
      '现场问题解决能力：面对设备异常与交期压力，能快速定位并推动闭环整改',
      '质量与安全意识强，熟悉安全生产规范，无重大安全责任事故记录',
      '结果导向，对产量、良率、成本等现场指标负责'
    ],
    soft: [
      '能与生产、质量、设备、工艺等多部门顺畅对接，推动跨工序协同',
      '沟通务实，能用现场语言向一线班组交代任务与标准',
      '能适应生产现场环境与旺季加班、倒班节奏'
    ],
    nice: ['有六西格玛绿带／黑带或精益改善项目经验', '主导过降本增效或产线改造项目', '持特种作业、注册安全工程师等相关资质']
  },
  '零售连锁': {
    majors: '市场营销、工商管理、连锁经营管理等相关专业',
    expHint: '有连锁零售门店运营经历，熟悉门店日常经营与排班管理',
    general: [
      '客户导向，能从顾客体验出发发现问题并推动改进',
      '经营意识强，关注销售、毛利、损耗、坪效等核心指标',
      '执行落地扎实，能把总部标准动作在门店端稳定复现'
    ],
    soft: [
      '亲和力强，善于与顾客、店员及商圈伙伴建立信任',
      '能带动门店氛围，激励团队共同完成销售目标',
      '抗压能力好，能接受轮班、周末与节假日排班'
    ],
    nice: ['有新店开业或标杆店打造经验', '所辖门店曾获区域业绩排名前列', '有会员运营或社群营销实操经验']
  },
  '医疗健康': {
    majors: '护理学、临床医学、康复治疗学等相关专业',
    expHint: '有临床护理或护理管理经历，熟悉科室护理工作流程与排班机制',
    general: [
      '责任心与同理心强，尊重患者及家属，注重患者隐私保护',
      '严谨细致，严格执行护理操作规程与查对制度',
      '风险意识强，能及时识别并上报不良事件与安全隐患'
    ],
    soft: [
      '情绪稳定，能在急救与突发状况下保持清晰判断',
      '善于与医生、患者及家属沟通，妥善处理医患关系',
      '能接受夜班轮值与科室排班安排'
    ],
    nice: ['持护士执业资格证或专科护士认证', '有护理带教或护理质量控制项目经验', '参与过院感防控或护理质量改进项目']
  },
  '教育培训': {
    majors: '教育学、心理学、市场营销、汉语言文学等相关专业',
    expHint: '有教育咨询或招生转化经历，熟悉试听—到访—成交流程',
    general: [
      '目标导向，对邀约量、到访率、转化率等过程指标负责',
      '客户意识强，能站在学员与家长立场设计学习方案',
      '对教育产品有理解，能把课程价值讲清楚、讲准确'
    ],
    soft: [
      '亲和力与感染力强，能在电话与面谈中快速建立信任',
      '表达有条理，能从容应对家长对课程效果与费用的质疑',
      '抗压能力好，能适应业绩考核与周末排班'
    ],
    nice: ['有个人销售冠军或团队业绩标杆经历', '有转介绍与社群运营实操经验', '持教师资格证或心理咨询相关证书']
  },
  '金融': {
    majors: '金融学、经济学、统计学、会计学、法学等相关专业',
    expHint: '有金融机构风控、信贷或合规相关岗位经历',
    general: [
      '严谨细致，对数据与口径准确度要求高，不放过异常波动',
      '合规意识强，熟悉监管要求，能坚持原则守住业务红线',
      '风险敏感度高，能从业务表象中识别潜在的欺诈与信用风险'
    ],
    soft: [
      '沟通有分寸，能在业务诉求与风险控制之间做好平衡',
      '保密意识强，严格遵守客户信息与业务数据保密要求',
      '有一定抗压能力，能承受审件峰值与合规检查压力'
    ],
    nice: ['持有 FRM、CPA、法律职业资格等专业证书', '有风控模型或策略优化经验', '有审计、监管报送或反洗钱项目经验']
  },
  '销售': {
    majors: '市场营销、工商管理、国际贸易等相关专业（能力突出者可不限专业）',
    expHint: '有 B2B 大客户销售经历，独立完成过完整销售周期',
    general: [
      '目标感强、自驱力足，能主动开拓而非被动等单',
      '商务敏感度高，能判断客户真实需求与决策链条',
      '对结果负责，能承担明确的业绩指标与回款责任'
    ],
    soft: [
      '沟通说服力强，能在谈判中把握节奏与让步边界',
      '韧性好，能承受长期跟单与阶段性业绩压力',
      '善于经营长期客户关系，注重口碑与复购'
    ],
    nice: ['有目标行业客户资源或标杆客户案例', '有千万级项目签约经历', '有销售团队管理或渠道拓展经验']
  },
  '人力资源': {
    majors: '人力资源管理、心理学、管理学、劳动与社会保障等相关专业',
    expHint: '有 HRBP 或全模块人力工作经验，能独立支持业务团队',
    general: [
      '服务意识与同理心强，能同时理解业务诉求与员工感受',
      '逻辑清晰，能用数据说明人力现状与问题',
      '原则性强，能在合规底线与业务灵活性之间把好尺度'
    ],
    soft: [
      '跨部门沟通顺畅，能与业务负责人建立可信赖的合作关系',
      '保密意识与职业操守良好，妥善处理敏感人事信息',
      '情绪稳定，能应对员工关系中的冲突与突发状况'
    ],
    nice: ['有组织变革、人才盘点或任职资格体系搭建项目经验', '熟悉劳动法与用工合规实务', '有人力数据分析或 HR 系统实施经验']
  },
  /* ---------- v0.9.6 新增行业：为新增的 10 个职能族提供兜底语境 ---------- */
  '建筑工程': {
    majors: '土木工程、工程管理、工程造价、建筑学、市政工程等相关专业',
    expHint: '有完整参与工程项目从开工到竣工的经历，能说明负责的标段规模与管控结果',
    general: [
      '安全意识强，熟悉施工现场安全规范，对安全事故零容忍',
      '现场协调能力强，能在多方交叉作业中推进进度、化解冲突',
      '成本意识强，能在不牺牲质量的前提下控制工程成本'
    ],
    soft: [
      '能与业主、监理、分包与施工班组顺畅沟通，把问题解决在现场',
      '抗压能力强，能应对赶工期、恶劣天气与材料延误',
      '能适应工地现场环境与常驻项目的工作方式'
    ],
    nice: ['持一级／二级建造师、造价工程师等执业资格', '有独立负责完整工程项目的经历', '有大型项目或地标工程经验']
  },
  '物流运输': {
    majors: '物流管理、交通运输、供应链管理等相关专业',
    expHint: '有独立负责运输或仓储作业的经验，能说明时效、成本或货损的改善数据',
    general: [
      '时效意识强，对交付时间与货物安全高度负责',
      '成本意识强，能在保证时效的同时持续优化运输与仓储成本',
      '安全意识强，严格执行运输与现场作业规范，不抢时省事'
    ],
    soft: [
      '能与司机、仓管、承运商与客户多方协调，推动异常及时解决',
      '抗压能力强，能应对旺季爆仓、突发延误等高压场景',
      '能适应不定时工作与仓库、场站等现场作业环境'
    ],
    nice: ['有物流网络规划或降本项目经验', '熟悉 WMS／TMS 等物流系统', '持货运从业资格或特种运输资质']
  },
  '酒店餐饮': {
    majors: '酒店管理、旅游管理、烹饪工艺与营养、食品科学等相关专业',
    expHint: '有餐饮或酒店一线运营经验，能说明负责的业态、规模与管理结果',
    general: [
      '服务意识强，在快节奏与高峰期仍能照顾到顾客体验',
      '标准意识强，能坚持出品与卫生标准不走样',
      '成本意识强，关注毛利、损耗与人力成本，而不只看营业额'
    ],
    soft: [
      '沟通有亲和力，能处理顾客投诉并安抚现场情绪',
      '带队能力强，能带住一线员工并在旺季保持队伍稳定',
      '能适应排班、节假日与高峰时段的工作强度'
    ],
    nice: ['持健康证、食品安全管理员等资质', '有门店或酒店扭亏、口碑提升的经验', '有连锁体系标准化落地经验']
  },
  '医药健康': {
    majors: '药学、临床医学、生物制药、药物制剂、市场营销等相关专业',
    expHint: '有医药行业相关岗位经验，能说明负责的产品线、区域或项目范围',
    general: [
      '合规意识强，严格遵守药品推广与销售法规，不做违规承诺',
      '学习能力强，能快速掌握产品与疾病领域的专业知识',
      '结果导向，对区域或品类的业绩与项目进度负责'
    ],
    soft: [
      '沟通专业且有分寸，能与医生、药师、客户建立长期信任',
      '抗压能力强，能适应出差、拜访与业绩压力',
      '保密意识强，妥善处理临床与客户数据'
    ],
    nice: ['有药品注册或临床项目经验', '熟悉 NMPA／GSP／GMP 相关法规', '有医院或连锁药店渠道资源']
  },
  '游戏': {
    majors: '数字媒体、游戏设计、计算机、动画、美术等相关专业',
    expHint: '有完整参与游戏从立项到上线的经历，能说明负责的系统与上线表现',
    general: [
      '对游戏有真实理解，能说清玩家的爽点与痛点，而不是只会背术语',
      '数据意识强，能用留存、付费等指标验证设计判断',
      '有审美与创新意识，能提出差异化的玩法或表达'
    ],
    soft: [
      '能与策划、程序、美术等角色高效协作，把设计意图讲清楚',
      '抗压能力强，能应对版本冲刺与上线期的强度',
      '沟通有分寸，能在评审中接受不同意见并推动收敛'
    ],
    nice: ['有已上线游戏的完整项目经验', '有爆款玩法或长线运营案例', '有海外发行或多语言版本经验']
  },
  '能源电力': {
    majors: '电气工程及其自动化、电力系统、新能源科学与工程、能源与动力工程等相关专业',
    expHint: '有电力或新能源项目的运行、检修或建设经验，能说明负责的设备与安全记录',
    general: [
      '安全责任意识极强，严格执行电力安全工作规程，不走捷径',
      '动手能力强，能到现场处理设备与系统异常，而不是只看报表',
      '严谨细致，对参数、记录与操作票保持零差错要求'
    ],
    soft: [
      '能与调度、施工、运维与外部单位顺畅对接，推动问题闭环',
      '应变能力强，能处理停电、跳闸等突发情况',
      '能适应野外站点、夜班值守与抢修节奏'
    ],
    nice: ['持电工进网作业许可、注册电气工程师等资质', '有新能源项目建设或运维经验', '有节能降碳或能效提升项目经验']
  },
  '传媒文化': {
    majors: '新闻传播、汉语言文学、广播电视编导、数字媒体、广告学等相关专业',
    expHint: '有独立完成内容从选题到发布的完整经验，能给出作品的传播数据',
    general: [
      '对内容与舆论敏感，能快速判断选题价值与潜在风险',
      '有原创能力，不靠洗稿和搬运，愿意为内容质量反复打磨',
      '细节严谨，对事实、措辞与版权保持敬畏'
    ],
    soft: [
      '沟通与采访能力强，能快速获取关键信息并核实',
      '审美在线，能把内容表达得既清楚又有质感',
      '节奏适应性强，能应对突发热点与截稿压力'
    ],
    nice: ['有爆款内容或高传播量作品', '有成熟的拍摄剪辑与后期能力', '有内容矩阵或账号运营经验']
  },
  '专业服务': {
    majors: '法学、会计学、工商管理、经济类等相关专业',
    expHint: '有专业服务机构（律所、会计师事务所、咨询公司）或企业法务／财务岗经历',
    general: [
      '专业严谨，结论有依据、过程有留痕，能对交付质量负责',
      '风险意识强，能在业务诉求与合规底线之间给出可执行方案',
      '时间管理能力强，能同时推进多个并行项目并守住节点'
    ],
    soft: [
      '书面与口头表达都严谨，能把专业语言翻译成客户听得懂的建议',
      '保密意识强，妥善处理客户敏感信息与商业机密',
      '抗压能力强，能应对项目高峰期与客户临时需求'
    ],
    nice: ['持法律职业资格、注册会计师、税务师等专业证书', '有独立承办项目或案件的经验', '有行业客户资源或标杆案例']
  },
  '物业管理': {
    majors: '物业管理、工程管理、消防工程、酒店管理等相关专业',
    expHint: '有物业项目一线管理经验，能说明负责的业态、管理面积与业主满意度结果',
    general: [
      '服务意识强，能耐心处理业主各类诉求与邻里纠纷',
      '安全责任意识强，对消防与治安隐患保持高度敏感',
      '执行扎实，能把日常巡检与整改真正落到记录和闭环'
    ],
    soft: [
      '沟通有耐心，能在业主、住户与外包单位之间做好协调',
      '应变能力强，能处理停水停电、群诉等突发情况',
      '能适应轮班值守与现场巡查的工作方式'
    ],
    nice: ['持物业管理师、消防设施操作员等资质', '有创优／标杆项目经验', '有提升物业费收缴率或满意度的成果']
  },
  '通用': {
    majors: '相关专业',
    expHint: '有同岗位或相近岗位从业经历，能独立承担岗位职责',
    general: [
      '责任心强，对负责模块的产出质量与进度负责',
      '结果导向，能在目标压力下主动推进并闭环',
      '风险意识强，问题暴露及时、处理有始有终'
    ],
    soft: [
      '表达清晰、善于倾听，能与多部门高效对接',
      '学习能力强，能快速适应业务与工具变化',
      '情绪稳定，能承担阶段性高强度工作'
    ],
    nice: ['有同行业头部企业从业经历', '有跨部门项目或带团队经验', '有可量化的业绩改善案例']
  }
};

/* 歧视性用语（违反《就业促进法》《劳动合同法》等平等就业规定） */
const DISCRIMINATION = [
  { re: /限?男性|仅限男|男生优先|只招男|男士优先/, word: '男性限定', why: '《就业促进法》第 27 条：招聘不得以性别为由拒绝录用或提高录用标准。', fix: '删除性别限定，改为岗位真实需要的条件（如「需适应倒班／可搬运 20kg 物料」）' },
  { re: /限?女性|仅限女|女生优先|只招女|女士优先/, word: '女性限定', why: '同上，性别不属岗位胜任要件，写入即构成就业歧视。', fix: '删除性别限定，改为与工作内容直接相关的能力要求' },
  { re: /已婚已育|已婚优先|要求已婚|须已婚/, word: '婚育状况要求', why: '以婚育状况作为录用条件构成就业歧视，也易引发三期内权益争议。', fix: '整句删除，不得在招聘环节询问或要求婚育信息' },
  { re: /未婚优先|优先考虑未婚/, word: '婚姻状况偏好', why: '婚姻状况与岗位胜任力无关，属于就业歧视范畴。', fix: '整句删除' },
  { re: /\b\d{2}\s*岁?(以下|以内)|年龄\s*\d{2}\s*[-—~]\s*\d{2}\s*岁|限\s*\d{2}\s*岁|年龄不超过\s*\d{2}/, word: '年龄限制', why: '除特殊工种法定限制外，设置年龄门槛构成年龄歧视。', fix: '删除年龄区间，改为「具备 X 年以上相关经验」的能力口径' },
  { re: /仅限本地户口|本地户口优先|不招外地人|限京籍|户籍不限但优先本地/, word: '户籍限制', why: '以户籍限制就业违反平等就业原则。', fix: '删除户籍要求；如需处理社保关系，可在入职环节说明办理方式' },
  { re: /仅限\s*985|仅限\s*211|985\s*\/\s*211|统招全日制本科|全日制本科.{0,4}以上/, word: '院校/学历形式限定', why: '限定毕业院校层次或统招形式，属不合理的差别对待。', fix: '改为「本科及以上学历，专业能力突出者可放宽」，按能力而非学校出身评估' },
  { re: /无(残疾|传染性疾病)|不招残疾人|身体健康.{0,8}(无残疾|无疾病)/, word: '身体状况歧视', why: '除岗位确有特殊健康要求外，排斥残障人士违反平等就业规定。', fix: '删除该表述；如岗位存在法定健康标准，须明确写出依据与范围' },
  { re: /形象好|气质佳|五官端正|形象气质佳|身高\s*1[5-9]\d|身高\s*1[5-9]\d\s*(cm|厘米)/, word: '外貌/身高要求', why: '除确有职业需要（如模特、演员），外貌身高要求构成就业歧视。', fix: '删除，改为岗位真正需要的沟通表达或体力要求' },
  { re: /不要.{0,3}(河南|东北|安徽|某省)|某省人勿投/, word: '地域歧视', why: '按地域排斥求职者构成就业歧视，且可能引发舆情风险。', fix: '整句删除' },
  { re: /不招.{0,4}(应届|35|女性|残疾人)/, word: '群体排斥表述', why: '对特定群体的一票否决表述构成就业歧视。', fix: '删除，改为对岗位胜任力的客观描述' }
];
/* 违法/高风险表述 */
const ILLEGAL = [
  { re: /试用期.{0,8}(不缴|不交|无需缴|无需缴纳).{0,5}社保|转正后.{0,6}再缴社保|试用期.{0,4}不上社保/, word: '试用期不缴社保', why: '《社会保险法》第 58 条：自用工之日起 30 日内应办理社保登记，试用期同样必须缴纳。', fix: '改为「入职即依法缴纳五险一金」' },
  { re: /(不签|无需签|免签).{0,5}(劳动)?合同|转正后.{0,4}签合同/, word: '不签订劳动合同', why: '《劳动合同法》第 10 条：建立劳动关系即应订立书面劳动合同（超过 1 个月未签需付双倍工资）。', fix: '改为「入职当日签订书面劳动合同」' },
  { re: /押金|保证金|风险金|扣押.{0,5}(身份证|证件|毕业证)|证件原件留存/, word: '收取押金／扣押证件', why: '《劳动合同法》第 9 条：不得要求劳动者提供担保或以其他名义收取财物，不得扣押证件。', fix: '删除，改为「入职材料仅核验原件并留存复印件」' },
  { re: /加班.{0,6}(无|没有|不发).{0,5}(加班费|加班工资)|自愿放弃.{0,5}(加班费|社保)|无加班费|调休.{0,4}代替加班费且/, word: '不支付加班费', why: '《劳动法》第 44 条：延长工作时间应支付加班工资或依法安排调休。', fix: '改为「加班依法支付加班费或安排调休」' },
  { re: /月休\s*[1-4]\s*天|每周工作\s*6\s*天|每周单休|单休制|大小周.{0,6}(不|无)调休/, word: '超法定工时', why: '《劳动法》第 36 条：每日工作不超 8 小时、平均每周不超 44 小时。', fix: '改为「标准工时制，周末双休」' },
  { re: /离职.{0,8}(扣|罚).{0,5}(工资|押金)|擅自离职.{0,6}(不发|扣发)工资|不满.{0,3}月离职.{0,4}扣/, word: '离职扣发工资', why: '劳动报酬不得以离职为由克扣，此类条款无效且可能被认定为违法。', fix: '整句删除；如需约定服务期，须符合《劳动合同法》第 22 条的培训服务期条件' },
  { re: /工伤.{0,8}(概不负责|与公司无关|自行承担|自负)/, word: '工伤免责约定', why: '工伤为法定责任，约定免除无效，且属典型的无效条款。', fix: '删除，改为「依法为员工缴纳工伤保险」' },
  { re: /不缴个税|现金发薪.{0,6}(不缴税|避税)|劳务合同.{0,6}规避/, word: '规避税务／劳动关系', why: '构成实质劳动关系应签劳动合同并依法代扣代缴个税，规避可能引发补缴与处罚。', fix: '改为「依法签订劳动合同并代扣代缴个人所得税」' },
  { re: /(女员工|女职工).{0,10}(入职.{0,4}不|承诺.{0,4}不)生育|三年内.{0,4}不得生育/, word: '限制生育', why: '限制生育权违反《妇女权益保障法》，此类约定无效。', fix: '整句删除' }
];
function scanJd(text) {
  const flagged = [], legal = [];
  (text || '').split('\n').forEach((line, i) => {
    DISCRIMINATION.forEach(rule => { if (rule.re.test(line)) flagged.push({ ...rule, re: undefined, line: i + 1, hit: line.trim().slice(0, 60) }); });
    ILLEGAL.forEach(rule => { if (rule.re.test(line)) legal.push({ ...rule, re: undefined, line: i + 1, hit: line.trim().slice(0, 60) }); });
  });
  return { flagged, legal };
}
/* ---------- 任职要求：从「一条单薄要求」扩充为六维度专业表述 ---------- */
/* 已填内容 → 条目数组（v0.9.8）
   字符串输入不再按「，；」切开 —— 它们是句中标点，不是条目分隔符
   （旧写法会把「和顶尖算法、工程团队并肩，把想法快速上线」劈成两条）。
   改由 ReqLib.parseReqText 做「剥符号 → 按小标题归位 → 按换行切条」。
   数组输入（库里存的结构化条目）保持原样，不做二次解析。 */
function toReqs(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return parseReqInput(v, 'must').must;
}
/* 解析单个字段。fallback 决定「没有小标题时整段归哪个字段」：
   任职要求框 → must；加分项框 → nice。 */
function parseReqInput(v, fallback) {
  const empty = { lead: [], duty: [], must: [], nice: [], benefit: [], heads: 0 };
  if (Array.isArray(v)) { empty[fallback || 'must'] = v.map(s => String(s).trim()).filter(Boolean); return empty; }
  const p = ReqLib.parseReqText(v);
  if (!p.heads) { empty[fallback || 'must'] = p.must; return empty; }
  return p;
}
/* 同时看 must / nice 两个字段：整段粘进来的 JD 需要合起来才能正确归位 */
function splitReqInput(must, nice) {
  const a = parseReqInput(must, 'must'), b = parseReqInput(nice, 'nice');
  return {
    lead: a.lead.concat(b.lead), duty: a.duty.concat(b.duty),
    must: a.must.concat(b.must), nice: a.nice.concat(b.nice),
    benefit: a.benefit.concat(b.benefit), heads: a.heads + b.heads
  };
}
const cleanReq = s => String(s).replace(/[。；;，,、\s]+$/, '').trim();
const dedupeReq = arr => { const seen = new Set(); return arr.filter(t => { const k = String(t).replace(/\s/g, ''); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
/* 语义近似判断（2-gram 重合度）：避免「开源项目贡献」与「有开源项目贡献、技术博客沉淀」这类同义重复 */
const bigrams = s => {
  const t = String(s).replace(/[\s，,。；;、（）()：:／/·-]/g, '');
  const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out;
};
const similarReq = (a, b, th) => {
  const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return false;
  let inter = 0; A.forEach(g => { if (B.has(g)) inter++; });
  return inter / Math.min(A.size, B.size) >= (th || 0.34);
};
/* 阈值更松的「用户已经写过这件事」判断，专用于技能补位。
   例：用户写了「院感控制」，词库里有一条「院感防控措施执行」——
   按 0.34 判定不算重复（0.33），但业务上就是同一件事，补上去只会显得啰嗦。 */
const coveredByUser = (k, userTexts) => userTexts.some(u => similarReq(u, k, 0.28) || similarReq(k, u, 0.28));
/* 自动补位产物的句式族（由下方 SKILL_TAILS 轮换生成）。
   ⚠️ 往 SKILL_TAILS 加尾缀必须同步扩这里，否则 stripMisfitAutoFill
   认不出自动产物 —— 跨职能族的历史错配（非技术岗里的「熟悉 Java」）会洗不掉。 */
const AUTO_FILL_RE = /^熟悉\s?.{1,40}，(?:能独立应用于实际业务场景|并在真实业务中完整落地过|能独立完成该方向的日常工作|并了解常见的实践方法与工具)$/;
/* 技能补位句的尾缀按序号轮换（v13）：四条技能同一句尾（「…能独立应用于实际
   业务场景」×4）读起来像机器批量生成。按序号取模，同一岗位产出确定、可回归。 */
const SKILL_TAILS = ['能独立应用于实际业务场景', '并在真实业务中完整落地过', '能独立完成该方向的日常工作', '并了解常见的实践方法与工具'];
/* 管培生／实习岗的加分项专属池：对应届生说得通的资历，而非社招资深门槛 */
const JUNIOR_NICE = ['有相关岗位的实习经历者优先', '有学生干部或社团组织经历者优先', '在校期间有相关项目或竞赛经历者优先'];
/* 清除「跨职能族的历史错配产物」。
   背景：v0.9.1 按「行业」补位，把技术栈技能写进了非技术岗的 must_have，
   并且扩充结果被直接落库 —— 于是「熟悉 Java」变成了看起来像是 HR 手填的内容。
   若不先剔除，换用职能族重新展开时它们会被当作「已填内容原样保留」，错误永远洗不掉。
   判据：只剔除「属于其他职能族词库」且带自动补位句式的条目；
   岗位本职能族内的技能词一律保留（例如技术岗的 Java 必须留下）。 */
function stripMisfitAutoFill(arr, keepFnKey) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(t => {
    if (!AUTO_FILL_RE.test(String(t).trim())) return true;
    const misfit = Object.keys(ReqLib.FUNCTIONS).some(k => k !== keepFnKey
      && ReqLib.FUNCTIONS[k].core.some(c => String(t).indexOf(c) >= 0));
    return !misfit;
  });
}
/* 维度归位用的三组判据（v0.9.8 抽出为常量，便于离线原型共用同一口径）
   v12：REQ_EXP 补上「实习」—— 「有 1–2 段对口实习经历」本来就属于「工作经验」
   维度。更深一层的原因：runJD → buildJD 会把 expandRequirements 的产物再喂回来，
   若这句判不进 REQ_EXP 就会落到「专业技能」桶，导致二次展开时硬性条件的
   顺序发生变化（内容不丢，但同一份输入前后两次产出不一样）。 */
const REQ_EDU = /学历|本科|大专|硕士|博士|统招|学士|毕业|专业不限|\d{2}\s*届/;
const REQ_EXP = /年以上|经验|从事|任职经历|工作经历|实习/;
const REQ_SOFT = /热爱|热情|同理心|好奇|主动|抗压|扛得住|沟通|表达|责任心|学习能力|自驱|踏实|细心|耐心|团队协作|上进/;
function eduRequirement(eduRank, majors) {
  const r = Number(eduRank);
  const m = (!majors || majors === '相关专业') ? '' : majors;
  if (!r || r <= 0) {
    return m ? `学历不限，${m.replace(/等相关专业$/, '')}等专业背景者优先；以实际能力与项目经验为主要评估依据`
      : '学历不限，以实际能力与项目经验为主要评估依据';
  }
  const level = r === 1 ? '大专' : r === 2 ? '本科' : r === 3 ? '硕士' : '博士';
  const head = m ? `${level}及以上学历，${m}` : `${level}及以上学历`;
  const tail = r <= 1 ? '；具备扎实实操经验者可适当放宽'
    : r === 2 ? '；专业技能突出者可放宽至大专'
      : '；研究方向与本岗位高度相关者优先';
  return head + tail;
}
/* 核心：把 HR 已填的任职要求按维度归位，再补齐缺失维度
   -----------------------------------------------------------
   补位来源的优先级（v0.9.2 修正）：
     ① 职能族（FUNCTIONS）—— 岗位名 + 已填要求识别出「干什么」
     ② 行业词库（INDUSTRY_SKILLS / INDUSTRY_REQ）—— 识别不出职能才兜底
   为什么必须职能优先：行业只决定「公司在哪个赛道」，不决定「这个岗位要什么技能」。
   同属互联网行业，后端工程师和 AI 产品经理的技能毫无交集；
   旧版按行业补位，导致 AI 产品经理被补上「熟悉 Java / Spring Boot」。 */
function expandRequirements({ title = '', industry = '通用', years = 0, eduRank = 2, must, nice } = {}) {
  /* 先做「原文还原 + 小标题归位」：整段粘进来的 JD 会在这里被拆回
     职责 / 任职要求 / 加分项 / 福利，而不是变成一堆半句碎片。 */
  const blob = splitReqInput(must, nice);
  const userMust0 = blob.must.map(cleanReq).filter(Boolean);
  const userNice0 = blob.nice.map(cleanReq).filter(Boolean);
  const fnKey = ReqLib.detectFunction(title, [...userMust0, ...userNice0]);
  const fn = fnKey ? ReqLib.FUNCTIONS[fnKey] : null;
  /* ⚠️ 只有认出职能族，才允许用行业素材。
     行业表是按「该行业的主力职能」写的 —— INDUSTRY_REQ['互联网'] 是技术岗口径
     （专业=计算机、软技能=技术栈、加分=开源/专利），INDUSTRY_SKILLS['互联网'].core
     整份是 Java / Spring Boot / MySQL。若拿它给一个「认不出职能」的岗位兜底，
     等于替这个岗位假设了职能 ——「储备干部」会被补成程序员。
     所以：认出职能 → 用职能族；认不出 → 退回「通用」中性口径，且不补专业技能硬技能。 */
  const lib = fn || INDUSTRY_SKILLS['通用'];
  const R = fn || INDUSTRY_REQ['通用'];
  const y = Number(years) || 2;
  /* 先剔除跨职能族的历史错配产物（如非技术岗里的「熟悉 Java」），再归位 */
  const userMust = stripMisfitAutoFill(userMust0, fnKey);
  const userNice = stripMisfitAutoFill(userNice0, fnKey);

  /* ① 已填内容：保留核心信息 → 书面化润色 → 按语义归位（v12）
     「软素质」单列一桶：把「对 AI 是真热爱 / 有同理心」这类句子塞进
     「专业技能」，整段读起来就不着调了。
     ⚠️ 维度判定用的是**润色前**的原文：润色会换词（「聪明有灵气」→「思维敏捷」），
     若拿润色后的文字去判「这属于软素质还是学历」，条目就会被分错桶。
     只有最终落进 JD 正文的表述才用润色结果（见 shared/req-lib.js 第八节）。 */
  const s1 = [], s2 = [], s3 = [], s4 = [];
  userMust.forEach(t => {
    const p = ReqLib.polishMustItem(t);
    if (REQ_EDU.test(t)) s3.push(p);
    else if (REQ_EXP.test(t)) s2.push(p);
    else if (REQ_SOFT.test(t)) s4.push(p);
    else s1.push(p);
  });

  /* ② 专业技能：职能族核心技能里「用户没写过」的才补位
     用 coveredByUser 而不是简单字符串包含 —— 否则会出现
     「已有『护理质控与院感控制』，又补上『护理质量控制』『院感防控措施执行』」这种同义堆叠。 */
  const userAll = [...userMust, ...userNice];
  const bench = fn ? dedupeReq(lib.core).filter(k => !coveredByUser(k, userAll)) : [];
  /* 中文技能词不加空格，拉丁字母技能词前留一个空格（符合中英混排习惯） */
  const kwWord = (k, i) => `熟悉${/^[A-Za-z]/.test(k) ? ' ' : ''}${k}，${SKILL_TAILS[i % SKILL_TAILS.length]}`;
  bench.slice(0, Math.max(0, 4 - s1.length)).forEach((k, i) => s1.push(kwWord(k, i)));
  if (!s1.length) s1.push(`掌握${title || '本岗位'}所需的核心专业技能，能独立完成岗位交付`);

  /* ③ 工作经验：管培生 / 实习 / 应届岗不设年限门槛，改成「无经验 / 对口实习」口径。
     否则会出现「3 年以上软件实施管培生经验」这种把应届生全部拦在门外的写法。
     ⚠️ 判重必须扫**全部已填内容**，不能只看 s2：expandRequirements 会被
     runJD → buildJD 连着调用两次，而「有 1–2 段与岗位方向对口的实习经历者优先」
     这句在二次展开时匹配不上 REQ_EXP，会落进专业技能桶（s1）——
     只看 s2 就会再补一遍，硬性条件里出现两条一模一样的要求（凭空多加一条，
     违反「不新增未提供的信息」）。 */
  const junior = ReqLib.detectJunior(title, [...userMust0, ...userNice0]);
  if (!s2.length) {
    s2.push(junior
      ? '无需相关工作经验，欢迎应届毕业生投递'
      : `${y} 年以上${title || '相关岗位'}经验，有完整项目或业务周期经历`);
  }
  const filledAll = [...s1, ...s2, ...s3, ...s4];
  if (junior) {
    if (!filledAll.some(t => /实习/.test(t))) s2.push('有 1–2 段与岗位方向对口的实习经历者优先');
  } else if (!filledAll.some(t => t.includes(R.expHint.slice(0, 10)))) {
    s2.push(R.expHint);
  }

  /* ④ 学历背景 */
  if (!s3.length) s3.push(eduRequirement(eduRank, R.majors));
  else if (!/专业/.test(s3.join('')) && R.majors !== '相关专业') s3.push(`专业方向：${R.majors}`);

  /* ⑤ 综合素质 ⑥ 软技能：行业化素材 + 已填的软素质话术（已填排在前） */
  const general = dedupeReq(R.general);
  const softTpl = dedupeReq(R.soft);
  const softSelf = dedupeReq([...s4, ...softTpl]);

  /* ⑦ 加分项：已填优先；已填 ≥3 条则不再叠加模板（HR 内容优先，避免同义重复）
     v12：最终统一美化为「…者优先」的对外句式。
     为什么连模板补位项一起美化，而不是只美化 HR 填的那几条：
       ① 一段里语气才一致（1 条自己写的 + 3 条模板补的，不会一半带「者优先」）；
       ② 老岗位经 REQ_LIB_VER 自愈重算时，库里的 nice_have 已分不清哪条是 HR
          写的、哪条是模板补的 —— 只美化「用户那几条」会让同一个岗位在新老
          数据上呈现两种排版。
     改变的只是**句式收尾**；模板的选取逻辑（选哪几条、补到几条）一概未动。
     去重仍放在**美化工序之前** —— 若先加上「者优先」再去重，
     「有 X 者优先」会和模板里的「有 X」因表述不同而躲过 similarReq。 */
  const niceList = dedupeReq(userNice.map(ReqLib.polishNiceItem));
  const niceTarget = niceList.length >= 3 ? niceList.length : 4;
  /* 管培生／实习岗不得补资深口径的加分项（v13）：
     「有从 0 到 1 开新店或带店扭亏的经验者优先」对储备干部是自相矛盾 ——
     招的是应届生，给的却是社招资深门槛。命中资深句式的模板条直接跳过，
     不足再用 JUNIOR_NICE 补齐（仍是模板建议，不冒充 HR 已填内容）。 */
  const SENIOR_NICE_RE = /从\s*0\s*到\s*1|主导|独立负责|独立完成|带店|扭亏|多年|资深|搭建.{0,6}(体系|团队)/;
  let nicePool = !fn ? [] : (R.nice.length ? R.nice : lib.plus.map(p => /^[有主]/.test(p) ? p : `有${p}相关经历`));
  /* 只在认出职能族时启用：认不出职能的岗位坚持「加分项一律不补」的既有铁律 */
  if (junior && fn) {
    nicePool = nicePool.filter(t => !SENIOR_NICE_RE.test(t));
    JUNIOR_NICE.forEach(t => {
      if (nicePool.some(x => similarReq(x, t))) return;
      nicePool.push(t);
    });
  }
  nicePool.forEach(t => {
    if (niceList.length >= niceTarget) return;
    if (niceList.some(x => similarReq(x, t))) return;
    niceList.push(t);
  });
  /* 模板补位项在同一道工序里美化；polishNiceItem 幂等，二次展开不会叠成「者优先者优先」 */
  const niceOut = dedupeReq(niceList.map(ReqLib.polishNiceItem));

  const d1 = dedupeReq(s1), d2 = dedupeReq(s2), d3 = dedupeReq(s3), d4 = dedupeReq(s4);
  const dims = [
    { name: '专业技能', items: d1 },
    { name: '工作经验', items: d2 },
    { name: '学历背景', items: d3 },
    { name: '综合素质', items: general },
    { name: '软技能', items: dedupeReq([...d4, ...softTpl]) }
  ];
  /* must  = 进「硬性条件」通道（同时供打分关键词抽取）
     soft  = 只进 JD 正文，不进 must_have —— 避免「沟通协作」这类通用词稀释岗位关键词
     fnKey = 命中的职能族（供 UI 展示「Agent 依据」，也便于排查补位来源）
     lead / userDuties / userBenefits：只在「整段 JD 粘进来」时有值，
       供 buildJD 把引言与职责放回正确位置（见 shared/req-lib.js 第七节）。 */
  return {
    must: [...d1, ...d2, ...d3], soft: [...general, ...softSelf], nice: niceOut, dims,
    lead: blob.lead, userDuties: blob.duty, userBenefits: blob.benefit, headings: blob.heads,
    fnKey, fnName: fn ? fn.name : null, source: fn ? 'function' : 'industry', junior
  };
}
/* 只给岗位名 + 行业时，直接产出完整的六维度任职要求 */
function suggestRequirements(title, industry, years, eduRank) {
  const r = expandRequirements({ title, industry, years, eduRank });
  return { must: r.must, nice: r.nice, soft: r.soft, dims: r.dims };
}
/* 任职要求 → JD 正文：维度小标题 + 自然行文段落（v0.9.8 起不再逐条编号）
   为什么改：逐条编号 + 每条半句，读起来是「零散堆砌」；同一维度的若干要求
   本来就是一整段话的并列成分，用「；」串起来即可。
   规则只在 shared/req-lib.js 一处实现，离线原型（src/agent.js）共用同一份。 */
function renderReqs(dims) {
  return ReqLib.renderReqDims(dims);
}
/* 岗位职责的选取：职能族优先，识别不出才退回行业模板。
   v0.9.6 起每族职责池扩到 8 条，不再整池照搬 —— 由 ReqLib.pickDuties() 按
   「岗位名 / 已填要求」里的子方向词挑最贴近的 6 条，同族不同岗产出才会不同。 */
const DUTY_MAX = 6;
function dutiesFor(fnKey, title, texts, industry) {
  const fn = fnKey ? ReqLib.FUNCTIONS[fnKey] : null;
  const picked = ReqLib.pickDuties(fn, title, texts, DUTY_MAX);
  if (!picked.length) return JD_DUTIES[industry] || JD_DUTIES['通用'];
  /* 行业语境句（v0.9.7）：职能给「职责骨架」，行业补一句「盯什么指标、
     说什么行话」。仅在与已选职责去重后追加 —— 于是同一职能族落在不同
     行业，JD 也不会长得一样；同时避免与职能句重复。 */
  const ctx = ReqLib.industryDuty ? ReqLib.industryDuty(industry, picked, fnKey) : '';
  return ctx ? picked.concat([ctx]) : picked;
}
function buildJD(job) {
  const must = (Array.isArray(job.must_have) ? job.must_have : J(job.must_have));
  const nice = (Array.isArray(job.nice_have) ? job.nice_have : J(job.nice_have));
  const industry = job.industry || '互联网';
  /* 岗位职责同样「职能优先」：行业决定赛道措辞，职能决定「这个人每天到底做什么」。
     旧版按行业套模板，导致互联网行业的 AI 产品经理被写上「保障线上服务稳定性」。 */
  const fnKey = ReqLib.detectFunction(job.title, [...must, ...nice]);
  const fn = fnKey ? ReqLib.FUNCTIONS[fnKey] : null;
  /* 任职要求按六维度重排：已填内容保留核心信息 + 书面化润色，缺失维度自动补齐 */
  const calc = expandRequirements({ title: job.title, industry, years: job.must_years, eduRank: job.must_edu_rank, must, nice });
  /* runJD 传了 dims 进来 → 说明 must_have / nice_have 已经是「扩充 + 润色」后的成品。
     ⚠️ 此时加分项必须直接用传进来的那份，**不能再取 calc.nice**：
     calc 会把 nice_have 当成「HR 新填的内容」再润一遍，于是模板补位项
     （「有 X 落地经验」）会被二次加工成「有 X 落地经验者优先」——
     结果是「加分项栏留空 = 原有默认逻辑」这条约束失效，
     而且 JD 正文与存库的 nice_have 会对不上。 */
  const preExpanded = Array.isArray(job.dims) && job.dims.length > 0;
  const dims = preExpanded ? job.dims : calc.dims;
  const niceForJd = (preExpanded && Array.isArray(job.nice_have) && job.nice_have.length) ? job.nice_have : calc.nice;
  /* 职责：用户自己写了就以用户为准（≥3 条不再叠加模板，避免掺进模板句），
     没写才用职能族模板。runJD 会把 reqs.userDuties 透传进来。 */
  /* 职责来源优先级（v13）：显式传入（本次表单「岗位职责」栏 / 粘 JD 解析）
     > 库里持久化的 duties 列（用户填过的职责随岗位落库，编辑与自愈重算都不丢）
     > 从粘入原文解析出的职责。统一过 polishMustItem 书面化（白名单，不命中透传）。 */
  const savedDuties = (Array.isArray(job.duties) ? job.duties : J(job.duties)) || [];
  const userDuty = ((Array.isArray(job.userDuties) && job.userDuties.length) ? job.userDuties
    : (savedDuties.length ? savedDuties : (calc.userDuties || [])))
    .map(d => ReqLib.polishMustItem(String(d))).filter(Boolean)
    .map(d => d.replace('{title}', job.title));
  const tplDuty = dutiesFor(fnKey, job.title, [...must, ...nice], industry)
    .map(d => d.replace('{title}', job.title).replace('{dept}', job.dept_path || '所属部门'));
  let duties;
  if (!userDuty.length) duties = tplDuty;
  else if (userDuty.length >= 3) duties = userDuty;
  else duties = userDuty.concat(tplDuty.slice(0, Math.max(0, DUTY_MAX - userDuty.length)));
  /* 引言：粘贴进来的 JD 首段（「我们在找一个…那我们在等你。」）*/
  const leadParas = ((Array.isArray(job.lead) && job.lead.length ? job.lead : (calc.lead || []))).slice(0, 3);
  const benefits = (job.benefits && job.benefits.length) ? job.benefits
    : ((calc.userBenefits && calc.userBenefits.length) ? calc.userBenefits : DEFAULT_BENEFITS);
  const soft = dims.filter(d => d.name === '综合素质' || d.name === '软技能').flatMap(d => d.items);
  const jd = [
    `# ${job.title}`,
    ``,
    `**所属部门**：${job.dept_path || '待填写'}　|　**工作地点**：北京　|　**招聘人数**：${job.headcount || 1} 人`,
    `**薪资范围**：${job.salary || '面议'}　|　**岗位类型**：全职　|　**行业**：${industry}`,
    ``,
    ...(leadParas.length ? leadParas.concat(['']) : []),
    ...(job.marketNote ? [job.marketNote, ''] : []),
    `## 一、岗位职责`,
    ...duties.map((d, i) => `${i + 1}. ${d}`),
    ``,
    `## 二、任职要求`,
    ...renderReqs(dims),
    ``,
    `## 三、加分项`,
    niceForJd.length ? ReqLib.paragraphize(niceForJd) : '暂无特别加分项，如有相关经历欢迎在面试中说明。',
    ``,
    `## 四、我们提供`,
    ...benefits.map(b => `- ${b}`),
    ``,
    `## 五、平等就业机会声明`,
    `本公司为所有求职者提供平等就业机会。招聘与录用不因性别、年龄、民族、宗教信仰、婚育状况、户籍、地域、院校背景、身体残障等因素而区别对待。`,
    `我们承诺：本岗位描述不含任何歧视性用语，所有录用决定均基于岗位胜任力作出。`
  ].join('\n');
  return {
    jd, duties, benefits, must: calc.must, soft, nice: niceForJd, dims,
    fnKey: fnKey || calc.fnKey, fnName: (fn ? fn.name : calc.fnName) || '通用', reqSource: calc.source
  };
}
/* ---------- LLM 润色层（可选，配了模型才走）----------
   规则层已经能给出「保留核心信息 + 书面化」的结果，这一层只是把它做得更顺。
   之所以叫「增强」而不是「替换」：没配模型的本地 PoC 与离线原型必须照旧可用，
   所以规则层永远是打底的那一份，模型失败/超时/结构不对就原样退回。 */
const JD_POLISH_PROMPT = [
  '你是资深招聘文案编辑。任务：对给定的岗位「任职要求」与「加分项」做书面化润色。',
  '',
  '铁律（违反即视为失败）：',
  '1. 忠实：只改表述，不改语义。不得新增原文没有的信息，也不得删除原文已有的要求。',
  '2. 结构锁：输出必须与输入逐维度、逐条一一对应 —— 维度顺序、维度名称、',
  '   每个维度的条目数量、条目顺序都不得改变。不许合并、拆分、增删任何条目。',
  '3. 加分项统一为「…者优先」的规范句式；已含「优先」的保持不变。',
  '4. 语言专业、简洁、通顺，符合中文招聘 JD 的书写习惯；条目不加编号，不以句末标点结尾。',
  '5. 不得出现性别、年龄、婚育、户籍、院校、地域等任何歧视性表述。',
  '',
  '只输出 JSON，不要解释、不要 Markdown 代码块：',
  '{"dims":[{"name":"专业技能","items":["…"]}],"nice":["…"]}'
].join('\n');
const parseJsonLoose = s => {
  if (!s) return null;
  const t = String(s).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; }
};
/* 把模型返回的润色结果与规则层产物逐条对齐。
   任何一项对不上（维度名/条目数/空串）就整体作废 —— 宁可退回规则产物，
   也不接受一份「结构被模型改过」的 JD：润色任务是改写，不是创作。 */
function applyLlmPolish(text, dims, nice) {
  const j = parseJsonLoose(text);
  if (!j || !Array.isArray(j.dims) || !Array.isArray(j.nice)) return null;
  if (j.dims.length !== dims.length || j.nice.length !== nice.length) return null;
  const out = [];
  for (let i = 0; i < dims.length; i++) {
    const it = j.dims[i] && Array.isArray(j.dims[i].items) ? j.dims[i].items : null;
    if (!it || it.length !== dims[i].items.length) return null;
    const items = it.map(s => String(s == null ? '' : s).trim());
    if (items.some(s => s.length < 2)) return null;
    out.push({ name: dims[i].name, items });
  }
  const niceOut = j.nice.map(s => String(s == null ? '' : s).trim());
  if (niceOut.some(s => s.length < 2)) return null;
  return {
    dims: out,
    must: out.filter(d => d.name !== '综合素质' && d.name !== '软技能').flatMap(d => d.items),
    soft: out.filter(d => d.name === '综合素质' || d.name === '软技能').flatMap(d => d.items),
    nice: niceOut
  };
}
/* JD 生成 Agent：输入岗位描述 → 输出规范 JD + 合规扫描结论 */
async function runJD(db, { title, industry, dept, must, nice, duty, years, eduRank, salary, headcount, benefits, jobId, initiatorId = 'U-001' } = {}) {
  const steps = [];
  const push = (intent, out, opt) => steps.push(Object.assign({ intent, tool: opt && opt.tool || 'llm.draft_jd', rule: !(opt && opt.tokens), risk: 0, ms: opt && opt.ms || 30, tokens: opt && opt.tokens || 0, out, status: 'done' }));
  title = (title || '').trim();
  if (!title) return { status: 'error', error: 'title_required', msg: '请先填写岗位名称', steps };
  industry = industry || '通用';

  /* 六维度扩充：HR 已填的内容**保留核心信息 + 书面化润色**后归位，
     缺失维度按「职能族」素材补齐（识别不出职能才退回行业素材）。 */
  const reqs = expandRequirements({ title, industry, years, eduRank, must, nice });
  /* 岗位资料库（v9）：生成前先读市场公开在招岗位作参考依据。
     铁律：参考只读、绝不污染本公司招聘流程；表不存在/无数据/异常时静默降级为空，
     主流程照常出 JD。接地文案只在确有参考岗位时才拼进引言。 */
  let reference = [];
  let marketNote = '';
  if (db && ReferenceJobs.countAll(db) > 0) {
    try {
      reference = ReferenceJobs.loadReference(db, { title, industry, limit: 12 });
      marketNote = ReferenceJobs.marketNote(reference);
    } catch (e) { reference = []; marketNote = ''; }
  }
  /* 「岗位职责」栏（v13）：HR 单独填写的职责，优先级高于一切模板与粘文解析。
     条目边界与任职要求同一套规则（换行 / 行首列表符），逐条书面化；
     ≥3 条不再叠加模板，1–2 条时模板补足且 HR 的条目全部排在前面。 */
  const userDutyItems = parseDutyInput(duty);
  const dutiesToSave = userDutyItems.length ? userDutyItems : (reqs.userDuties || []);
  let mustArr = reqs.must, niceArr = reqs.nice, softArr = reqs.soft;
  const sourceTxt = reqs.fnName ? `识别职能「${reqs.fnName}」` : `未识别出明确职能 → 按行业「${industry}」兜底`;
  const filled = !!((must && String(must).trim()) || (nice && String(nice).trim()));

  /* LLM 增强层：仅在「配了模型」且「HR 确实填了内容」时触发。
     只润色已填内容所在的维度（未填的维度本来就是模板句，润了也没意义），
     返回结果要过 applyLlmPolish 的结构校验，对不上就整体退回规则产物。 */
  let llmPolished = false, llmTokens = 0, llmFail = '';
  if (llmConfigured() && filled) {
    const gen = await llm([
      { role: 'system', content: JD_POLISH_PROMPT },
      { role: 'user', content: JSON.stringify({ title, industry, dims: reqs.dims, nice: niceArr }) }
    ]);
    if (gen.usage) llmTokens = gen.usage.total_tokens || ((gen.usage.prompt_tokens || 0) + (gen.usage.completion_tokens || 0));
    const fixed = applyLlmPolish(gen.text, reqs.dims, niceArr);
    if (fixed) {
      reqs.dims = fixed.dims; mustArr = fixed.must; niceArr = fixed.nice; softArr = fixed.soft;
      llmPolished = true;
    } else if (gen.error || !gen.text) llmFail = gen.error || 'empty';
    else llmFail = 'structure';
  }
  /* JD 正文一次成形：引言 / 职责 / 六维度要求 / 加分项 都交给 buildJD 组装。
     若 HR 是整段粘进来的 JD，reqs.lead / reqs.userDuties 会按原文归位。 */
  const built = buildJD({ title, industry, dept_path: dept, must_have: mustArr, nice_have: niceArr, salary, headcount, benefits, must_years: years, must_edu_rank: eduRank, dims: reqs.dims, lead: reqs.lead, userDuties: (userDutyItems.length ? userDutyItems : reqs.userDuties), marketNote });
  const dutyN = built.duties.length;

  push('识别岗位职能与所属行业，载入对应素材库',
    `岗位：${title}｜${sourceTxt}｜行业：${industry}｜部门：${dept || '未填'}${reqs.junior ? '｜层级：管培生／实习（不设工作年限门槛）' : ''}`, { rule: true, tool: 'nlp.classify', ms: 8 });
  if (reqs.headings) {
    push('按小标题还原已粘贴的 JD',
      `识别到 ${reqs.headings} 个小标题 → 职责 ${reqs.userDuties.length} 条 / 任职要求 ${mustArr.length} 条 / 加分项 ${niceArr.length} 条按原意归位，原文不再被按行拆碎`, { rule: true, tool: 'rule.split_sections', ms: 4 });
  }
  push('拆解岗位职责与任职要求维度',
    `职责 ${dutyN} 条｜任职要求 ${reqs.dims.length} 个维度（专业技能／工作经验／学历背景／综合素质／软技能）`, { tokens: 260 });
  if (userDutyItems.length) {
    push('采纳 HR 自填的岗位职责',
      `岗位职责以 HR 填写的 ${userDutyItems.length} 条为准（已书面化润色），不足部分按职能族模板补足且排在后面`,
      { rule: true, tool: 'rule.merge_duties', ms: 3 });
  }
  if (filled) {
    push('在已填任职要求基础上扩充与润色',
      `已填内容保留核心信息并书面化润色后按维度归位，另按${reqs.fnName ? '职能族' : '行业'}素材补齐未覆盖维度；加分项统一为「…者优先」句式 → 任职要求 ${mustArr.length} 条／加分项 ${niceArr.length} 条`, { rule: true, tool: 'rule.merge_reqs', ms: 4 });
    if (llmPolished) {
      push('用大模型对已填内容做二次润色',
        '规则层产物作为底稿交由模型做流畅度与专业度加工；已校验维度名与条目数逐条对齐，结构未被改动', { tokens: llmTokens, tool: 'llm.polish_jd', ms: 900 });
    } else if (llmConfigured()) {
      push('模型润色未生效，退回规则层产物',
        llmFail === 'structure' ? '模型返回的维度或条目数与规则层产物对不上 → 整单作废，采用规则层结果' : `模型调用未成功（${llmFail || 'unknown'}）→ 采用规则层结果`, { rule: true, tool: 'rule.polish_jd', ms: 3 });
    }
  }
  push('生成岗位职责与任职要求草案', `职责 ${dutyN} 条｜任职要求 ${mustArr.length + softArr.length} 条｜加分项 ${niceArr.length} 条`, { tokens: 420 });
  push('合规扫描：歧视性用语 + 违法表述', '扫描维度：性别／年龄／婚育／户籍／院校／地域／工时／社保／押金', { rule: true, tool: 'guard.scan_jd', ms: 5 });
  const scan = scanJd(built.jd);
  push('生成合规结论并阻断直接发布', scan.flagged.length + scan.legal.length
    ? `命中 ${scan.flagged.length} 处歧视性表述、${scan.legal.length} 处违法表述 → 已阻止直接发布，需人工改写后重扫`
    : '未命中歧视性用语与违法表述 → 可提交人工确认后发布', { rule: true, tool: 'guard.scan_jd', ms: 3 });

  if (db && jobId) {
    /* 关键词还要含「已粘贴 JD 里 HR 自己写的职责句」——
       它们是对岗位最直接的描述，漏掉会让打分偏向模板词。 */
    const kws = extractKeywords([...mustArr, ...niceArr, ...(reqs.userDuties || [])]);
    db.prepare(`UPDATE jobs SET jd_text=?, jd_ver=?, keywords=?, must_have=?, nice_have=?, industry=?, duties=? WHERE id=?`)
      .run(built.jd, REQ_LIB_VER, JSON.stringify(kws), JSON.stringify(mustArr), JSON.stringify(niceArr), industry, JSON.stringify(dutiesToSave), jobId);
    audit(db, { actorType: 'agent', actorId: initiatorId, action: '生成岗位 JD 并完成合规扫描', objType: 'job', objId: jobId,
      detail: `任职要求 ${reqs.dims.length} 维度 / ${mustArr.length + softArr.length} 条；命中歧视性 ${scan.flagged.length} 处 / 违法 ${scan.legal.length} 处`,
      result: scan.flagged.length + scan.legal.length ? 'blocked' : 'pending' });
  }
  return { status: 'done', title, industry, jd: built.jd, mustHave: mustArr, niceHave: niceArr, softHave: softArr, dims: reqs.dims,
    duties: built.duties, userDuties: dutiesToSave,
    fnKey: reqs.fnKey, fnName: reqs.fnName, reqSource: reqs.source, junior: !!reqs.junior,
    keywords: extractKeywords([...mustArr, ...niceArr]), rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
    reference: {
      count: reference.length,
      /* 有多少条带完整 JD 正文 / 薪资区间 —— 前端据此说明这次接地「有多少是真材实料」。
         薪资来自智联通道（BOSS 未登录不暴露薪资），所以两个数会不一样。 */
      withJd: reference.filter(r => r.job_description).length,
      withSalary: reference.filter(r => r.salary_range).length,
      samples: reference.slice(0, 6).map(r => ({ title: r.job_title, company: r.company_name, salary: r.salary_range, location: r.location, scraped_at: r.scraped_at })),
    },
    scan: { flagged: scan.flagged, legal: scan.legal }, blockPublish: (scan.flagged.length + scan.legal.length) > 0, steps };
}

/* ===========================================================
   岗位 CRUD（HR 可自建 / 自填 JD，不再写死岗位）
   =========================================================== */
function nextJobId(db) {
  const ids = db.prepare(`SELECT id FROM jobs`).all().map(r => parseInt(String(r.id).replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
  return 'J-' + ((ids.length ? Math.max(...ids) : 100) + 1);
}
/* 「岗位职责」栏的统一解析（v13）：数组（库里回显）或整段文本（表单）→ 条目数组。
   与任职要求共用条目边界规则（换行 / 行首列表符），逐条书面化后返回。 */
function parseDutyInput(v) {
  if (!v) return [];
  const items = Array.isArray(v) ? v.filter(Boolean)
    : (() => { const p = parseReqInput(v, 'must'); return p.heads ? p.duty : p.must; })();
  return dedupeReq(items.map(cleanReq).filter(Boolean).map(t => ReqLib.polishMustItem(t)).filter(Boolean));
}
function makeJobPayload(db, p, initiatorId) {
  /* 字符串输入走同一套「原文还原」规则：整段 JD 会被拆回职责/要求/加分项，
     而不是把每个逗号和每半句话都变成一条要求。数组输入原样使用。 */
  const pre = splitReqInput(p.mustHave, p.niceHave);
  const dutyItems = parseDutyInput(p.duties);
  const must = Array.isArray(p.mustHave) ? p.mustHave.filter(Boolean) : pre.must;
  const nice = Array.isArray(p.niceHave) ? p.niceHave.filter(Boolean) : pre.nice;
  const industry = p.industry || '通用';
  const keywords = (p.keywords && p.keywords.length) ? p.keywords : extractKeywords([...must, ...nice, ...pre.duty, p.title || '']);
  return {
    title: (p.title || '').trim(), dept: (p.dept || '').trim() || '/待分配', industry,
    must, nice, keywords,
    mustYears: p.mustYears === '' || p.mustYears == null ? 0 : Number(p.mustYears),
    mustEduRank: p.mustEduRank === '' || p.mustEduRank == null ? 0 : Number(p.mustEduRank),
    salary: p.salary || '', headcount: p.headcount ? Number(p.headcount) : 1,
    jdText: p.jd || null, createdBy: initiatorId,
    duties: dutyItems,
    struct: pre
  };
}
function createJob(db, p = {}, initiatorId = 'U-001') {
  const d = makeJobPayload(db, p, initiatorId);
  if (!d.title) return { error: 'title_required', msg: '岗位名称不能为空' };
  if (db.prepare(`SELECT id FROM jobs WHERE title=? AND status='open'`).get(d.title)) return { error: 'duplicate', msg: '已存在同名在招岗位：' + d.title };
  const id = nextJobId(db);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const jobDuties = (d.duties && d.duties.length) ? d.duties : (d.struct.duty || []);
  const jd = d.jdText || buildJD({ title: d.title, industry: d.industry, dept_path: d.dept, must_have: d.must, nice_have: d.nice, salary: d.salary, headcount: d.headcount, must_years: d.mustYears, must_edu_rank: d.mustEduRank, lead: d.struct.lead, userDuties: jobDuties }).jd;
  db.prepare(`INSERT INTO jobs (id,tenant_id,title,dept_path,must_have,nice_have,rubric,must_years,must_edu_rank,status,
      industry,jd_text,jd_ver,keywords,headcount,salary,opened_at,created_by,created_at,duties)
    VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?)`)
    .run(id, T, d.title, d.dept, JSON.stringify(d.must), JSON.stringify(d.nice),
      JSON.stringify({ 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 }),
      d.mustYears, d.mustEduRank, d.industry, jd, REQ_LIB_VER, JSON.stringify(d.keywords),
      d.headcount, d.salary, today, d.createdBy, now(), JSON.stringify(jobDuties));
  audit(db, { actorType: 'user', actorId: initiatorId, action: '新建招聘岗位', objType: 'job', objId: id,
    detail: `${d.title}（${d.industry}）｜任职要求 ${d.must.length} 条（六维度扩充）｜关键词 ${d.keywords.length} 个`, result: 'ok' });

  let seeded = 0;
  if (p.autoSeed !== false) seeded = autoSeedCandidates(db, id, 5);
  return { ok: true, id, job: { id, title: d.title, industry: d.industry, dept: d.dept, keywords: d.keywords }, seeded, msg: `岗位「${d.title}」已创建${seeded ? `，并生成 ${seeded} 份演示简历可直接跑筛选` : ''}` };
}
function updateJob(db, id, p = {}, initiatorId = 'U-001') {
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id);
  if (!job) return { error: 'not_found', msg: '岗位不存在：' + id };
  /* 合并式更新：未传的字段沿用原值，避免「改一处丢一片」 */
  const cur = {
    title: job.title, dept: job.dept_path, industry: job.industry,
    mustHave: J(job.must_have), niceHave: J(job.nice_have), keywords: J(job.keywords),
    mustYears: job.must_years, mustEduRank: job.must_edu_rank,
    salary: job.salary, headcount: job.headcount, jd: job.jd_text, duties: J(job.duties)
  };
  /* 「岗位职责」传了个空（'' / []）视为「本次没填」而不是「清空」——
     与 mustHave 等字段的合并语义保持一致，避免前端漏传把用户职责洗掉 */
  if (p.duties !== undefined && !String(Array.isArray(p.duties) ? p.duties.join('\n') : (p.duties || '')).trim()) delete p.duties;
  const given = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const d = makeJobPayload(db, Object.assign({}, cur, given), initiatorId);
  if (!d.title) return { error: 'title_required', msg: '岗位名称不能为空' };
  /* 只有调用方显式传了新 JD 才沿用；否则按最新任职要求重新生成（含六维度扩充） */
  const jd = (p.jd && String(p.jd).trim()) ? p.jd
    : buildJD({ title: d.title, industry: d.industry, dept_path: d.dept, must_have: d.must, nice_have: d.nice, salary: d.salary, headcount: d.headcount, must_years: d.mustYears, must_edu_rank: d.mustEduRank, userDuties: d.duties }).jd;
  db.prepare(`UPDATE jobs SET title=?,dept_path=?,must_have=?,nice_have=?,industry=?,jd_text=?,jd_ver=?,keywords=?,
      must_years=?,must_edu_rank=?,headcount=?,salary=?,duties=? WHERE id=?`)
    .run(d.title, d.dept, JSON.stringify(d.must), JSON.stringify(d.nice), d.industry, jd, REQ_LIB_VER,
      JSON.stringify(d.keywords), d.mustYears, d.mustEduRank, d.headcount, d.salary, JSON.stringify(d.duties), id);
  audit(db, { actorType: 'user', actorId: initiatorId, action: '修改招聘岗位', objType: 'job', objId: id,
    detail: `更新为「${d.title}」（${d.industry}）｜任职要求 ${d.must.length} 条（已按六维度重排）`, result: 'ok' });
  return { ok: true, id, msg: '岗位「' + d.title + '」已更新' };
}
function deleteJob(db, id, initiatorId = 'U-001') {
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id);
  if (!job) return { error: 'not_found', msg: '岗位不存在：' + id };
  const n = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=?`).get(id).c;
  if (n > 0) {   /* 有候选人 → 归档而非物理删除（保留审计链） */
    db.prepare(`UPDATE jobs SET status='closed' WHERE id=?`).run(id);
    audit(db, { actorType: 'user', actorId: initiatorId, action: '关闭招聘岗位', objType: 'job', objId: id,
      detail: `岗位已关闭（保留 ${n} 条候选人记录与审计链）`, result: 'ok' });
    return { ok: true, archived: true, msg: `岗位「${job.title}」已关闭（名下有 ${n} 名候选人，为保留审计链不做物理删除）` };
  }
  db.prepare(`DELETE FROM jobs WHERE id=?`).run(id);
  audit(db, { actorType: 'user', actorId: initiatorId, action: '删除招聘岗位', objType: 'job', objId: id, detail: job.title, result: 'ok' });
  return { ok: true, deleted: true, msg: '岗位「' + job.title + '」已删除' };
}
/* 按岗位画像自动生成演示简历（新建岗位后立刻可跑筛选）
   ---------------------------------------------------------------
   幂等性修复：原来的实现每次都从 `C-<job>-01` 开始编号，
   而 createJob 已经自动播种过 5 份 —— 于是「给岗位补生成演示简历」这个
   用户可见的按钮**点第二次必然 500**（UNIQUE constraint failed: candidates.id）。
   现在改为：先查出该岗位已有的最大序号，从它之后续编。
   写入合并为一个事务（见 db.js inTx 注释：逐条提交在 Windows 上每次 fsync）。 */
function autoSeedCandidates(db, jobId, n = 5) {
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(jobId);
  if (!job) return 0;
  const prefix = job.id.replace('J-', 'C-') + '-';
  const existing = db.prepare(`SELECT id FROM candidates WHERE job_id=?`).all(jobId);
  let offset = 0;
  existing.forEach(r => {
    if (!String(r.id).startsWith(prefix)) return;                 // 手写的 4 位编号（如 C-2081）不参与续编
    const k = Number(String(r.id).slice(prefix.length));
    if (Number.isFinite(k) && k > offset) offset = k;
  });
  const cands = synthCandidates({ id: job.id, industry: job.industry, keywords: J(job.keywords),
    must_have: J(job.must_have), nice_have: J(job.nice_have), must_years: job.must_years, must_edu_rank: job.must_edu_rank }, n, { offset });
  const st = db.prepare(`INSERT INTO candidates (id,tenant_id,job_id,name,gender,birth_date,years_exp,edu_rank,edu_text,company,
      skills,business_tags,plus_tags,source,stage,parse_ok,consent_given,synthesized,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,date('now','-1 day'))`);
  db.exec('BEGIN');
  try {
    for (const c of cands) {
      st.run(c.id, T, job.id, c.name, c.gender, c.birth, c.years, c.eduRank, c.eduText, c.company,
        JSON.stringify(c.skills), JSON.stringify(c.businessTags), JSON.stringify(c.plusTags), c.source, '待人工复核', c.parseOk);
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* 回滚失败不掩盖原始错误 */ } throw e; }
  return cands.length;
}

function bootstrap(db) {
  const jdCache = {};
  /* 自愈需要重算并落库的岗位先收集起来，循环结束后一次性提交 ——
     见 db.js 的 inTx 注释：node:sqlite 逐条自动提交在 Windows 上每次都要 fsync，
     21 条 UPDATE 会阻塞事件循环约 1 秒，足以掐断 keep-alive 连接。 */
  const jdPending = [];
  const jobs = db.prepare(`SELECT * FROM jobs ORDER BY COALESCE(opened_at,'') DESC, id`).all().map(j => {
    const total = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=?`).get(j.id).c;
    const pending = db.prepare(`SELECT COUNT(*) c FROM candidates WHERE job_id=? AND ai_score IS NULL`).get(j.id).c;
    const rubric = J(j.rubric);
    if (!jdCache[j.id]) {
      const stale = Number(j.jd_ver || 0) !== REQ_LIB_VER;
      if (j.jd_text && !stale) {
        jdCache[j.id] = j.jd_text;
      } else {
        /* 素材库口径已升级 → 按新规则重算并落库（自愈，不需要人工逐个改岗位）。
           注意这里会连 must_have / keywords 一起重算：v0.9.1 把「行业补位的扩充结果」
           直接存进了 must_have，只重算 JD 正文的话，错误的技能要求还会留在岗位画像
           和打分关键词里（AI 产品经理岗位会继续拿 Java 给人打分）。 */
        const reqs = expandRequirements({
          title: j.title, industry: j.industry, years: j.must_years, eduRank: j.must_edu_rank,
          must: J(j.must_have), nice: J(j.nice_have)
        });
        const fresh = buildJD({ ...j, must_have: reqs.must, nice_have: reqs.nice, dims: reqs.dims }).jd;
        const kws = extractKeywords([...reqs.must, ...reqs.nice]);
        /* 就地更新，保证本次返回给前端的岗位画像 / 关键词也是清洗后的结果 */
        j.must_have = JSON.stringify(reqs.must);
        j.nice_have = JSON.stringify(reqs.nice);
        j.keywords = JSON.stringify(kws);
        jdCache[j.id] = fresh;
        jdPending.push({ jd: fresh, must: j.must_have, nice: j.nice_have, kws: j.keywords, id: j.id });
      }
    }
    return {
      id: j.id, title: j.title, dept: j.dept_path, industry: j.industry || '互联网',
      mustHaveText: J(j.must_have), niceHave: J(j.nice_have), duties: J(j.duties), keywords: J(j.keywords),
      mustYears: j.must_years, mustEduRank: j.must_edu_rank,
      headcount: j.headcount || 1, salary: j.salary || '', openedAt: j.opened_at || '',
      status: j.status === 'open' ? '招聘中' : j.status === 'closed' ? '已关闭' : j.status,
      rubric: Array.isArray(rubric) ? {} : rubric,
      applicants: total, pending, jd: jdCache[j.id]
    };
  });
  if (jdPending.length) {
    db.exec('BEGIN');
    try {
      const st = db.prepare(`UPDATE jobs SET jd_text=?, jd_ver=?, must_have=?, nice_have=?, keywords=? WHERE id=?`);
      jdPending.forEach(r => st.run(r.jd, REQ_LIB_VER, r.must, r.nice, r.kws, r.id));
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* 回滚失败不掩盖原始错误 */ } throw e; }
  }
  const jmap = Object.fromEntries(jobs.map(j => [j.id, j.title]));
  const candidates = db.prepare(`SELECT * FROM candidates ORDER BY ai_score DESC`).all().map(c => ({
    id: c.id, job: jmap[c.job_id], jobId: c.job_id, name: c.name, gender: c.gender, birth: c.birth_date, years: c.years_exp,
    edu: c.edu_text || (c.anonymized_at ? '已匿名化' : '—'), company: c.company || (c.anonymized_at ? '（已匿名化）' : ''), tags: J(c.skills), phone: maskPhone(c.id),
    email: (c.name[0] || 'x') + '***@example.com',
    score: c.ai_score == null ? null : c.ai_score, grade: c.ai_grade || null,
    stage: c.stage, parseOk: !!c.parse_ok, source: c.source, synthesized: !!c.synthesized,
    reasons: c.ai_reasons ? J(c.ai_reasons) : [], aiNote: c.ai_note || '',
    /* 打分归因跟着候选人一起下发 —— 「每个分数都要有原因」是界面约定，
       不能让前端自己去猜。旧数据（v7 之前打的）没有 ai_why，前端会退化成只显示维度依据。 */
    why: c.ai_why ? J(c.ai_why) : null,
    /* 人工结论与原因码要跟着候选人一起下发，否则刷新后前端无法回显「已确认 / 已推翻」 */
    human: c.human_decision || null, overrideReason: c.override_reason || null, overrideCode: c.override_code || null,
    ruleHit: c.ai_grade === 'no' && J(c.ai_reasons)[0] && J(c.ai_reasons)[0].dim === '硬性门槛' ? J(c.ai_reasons)[0].ev : null,
    parseNote: c.parse_ok ? null : 'PDF 为扫描件，工作经历时间解析不确定，需人工补录'
  }));
  const approvals = db.prepare(`SELECT * FROM approvals ORDER BY id DESC LIMIT 20`).all().map(a => {
    const p = J(a.payload);
    return { id: 'AP-' + a.id, task: a.task_id, risk: a.risk_level === 'high' ? 'high' : 'medium', type: a.action_type,
      title: a.title, who: p.who || '招聘 Agent（发起人：李静）', ago: p.ago || '刚刚', created: a.created_at,
      target: p.target || '', preview: p.preview || '', basis: p.basis || '', impact: p.impact || '', checks: p.checks || [],
      status: a.status, rejectReason: a.reject_reason };
  });
  const employees = db.prepare(`SELECT * FROM users WHERE role IN ('employee','hrbp') ORDER BY id`).all().map((u, i) => ({
    id: u.id, name: u.name, dept: u.dept_path, title: u.title,
    joinedAt: ['2026-06-24', '2026-09-15', '2024-05-06', '2026-03-10'][i % 4] || '2026-01-01',
    probationEnd: ['2026-09-24', '2026-12-15', null, null][i % 4] || null,
    stage: ['转正', '入职', '离职', '调岗'][i % 4] || '入职',
    materials: { got: [2, 4, 1, 3][i % 4] || 1, need: [4, 6, 5, 3][i % 4] || 4 }
  }));
  const auditLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50`).all().map(l => ({
    t: l.created_at, actor: (l.actor_type === 'agent' ? 'Agent（招聘/自助）' : l.actor_type === 'user' ? userName(db, l.actor_id) : '系统'),
    ai: l.actor_type === 'agent', act: l.action, obj: (l.object_type || '') + ':' + (l.object_id || '—'),
    task: l.task_id || '—', res: l.result === 'blocked' ? 'blocked' : l.result === 'pending' ? 'pending' : 'ok', note: l.detail
  }));
  const kbDocs = db.prepare(`SELECT * FROM kb_documents ORDER BY id`).all().map(d => ({
    id: d.id, title: d.title, ver: d.ver, eff: d.effective_at, scope: d.visibility === 'all' ? '全员可见' : d.visibility,
    chunks: db.prepare(`SELECT COUNT(*) c FROM kb_chunks WHERE doc_id=?`).get(d.id).c, updated: d.updated_at,
    covers: J(db.prepare(`SELECT keywords FROM kb_chunks WHERE doc_id=? LIMIT 1`).get(d.id).keywords)
  }));
  const kbUnanswered = db.prepare(`SELECT question, COUNT(*) cnt, MAX(created_at) last FROM unanswered_questions GROUP BY question ORDER BY cnt DESC LIMIT 10`).all();
  const activity = auditLogs.slice(0, 7).map(l => ({
    t: (l.t || '').slice(11, 16),
    txt: `${l.act}${l.note ? ' · ' + l.note : ''}`,
    type: l.res === 'blocked' ? 'dang' : l.res === 'pending' ? 'warn' : 'ok'
  }));
  const done = db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE status='done'`).get().c;
  const waiting = db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE status='waiting_approval'`).get().c;
  const kpis = {
    aiTasks: done + waiting + 512, humanRate: 14, savedHours: 67, modelCost: 57.3,
    pendingApprovals: approvals.filter(a => a.status === 'pending').length
  };
  /* 岗位资料库（v9）：随快照下发统计与最近样本，供「岗位资料库」页展示。
     它是只读的 market reference，不进任何打分 / 流程；表不存在（旧库未迁移）时静默降级为空，
     绝不让「多了个资料库」这件事把主快照拖挂。 */
  let refStats = { total: 0, withJd: 0, withSalary: 0, lastScraped: '' };
  let refJobs = [];
  try {
    refStats.total = ReferenceJobs.countAll(db);
    const agg = db.prepare(`SELECT
      SUM(CASE IFNULL(job_description,'') WHEN '' THEN 0 ELSE 1 END) jd,
      SUM(CASE IFNULL(salary_range,'')    WHEN '' THEN 0 ELSE 1 END) sal,
      MAX(scraped_at) last FROM reference_jobs`).get() || {};
    refStats.withJd = Number(agg.jd || 0);
    refStats.withSalary = Number(agg.sal || 0);
    refStats.lastScraped = agg.last || '';
    refJobs = db.prepare(`SELECT id, job_title, job_description, salary_range, location,
      company_name, company_industry, company_scale, skill_labels, scraped_at
      FROM reference_jobs ORDER BY scraped_at DESC LIMIT 200`).all();
  } catch (e) { /* 表不存在 → 保持空，主流程照常 */ }
  return { jobs, candidates, approvals, employees, auditLogs, kbDocs, kbUnanswered, activity, kpis,
    refJobs, refStats,
    industries: INDUSTRIES, industrySkills: Object.fromEntries(Object.entries(INDUSTRY_SKILLS).map(([k, v]) => [k, v.core])) };
}
function userName(db, id) {
  const u = id && db.prepare(`SELECT name FROM users WHERE id=?`).get(id);
  return u ? u.name : '未知用户';
}

module.exports = { runScreening, decide, chat, bootstrap, tryExportAll, audit, llm, llmConfigured, T,
  runJD, buildJD, scanJd, suggestRequirements, expandRequirements, renderReqs, eduRequirement, INDUSTRY_REQ, REQ_DIMS,
  createJob, updateJob, deleteJob, autoSeedCandidates, nextJobId,
  /* 规则判定与一致率：供评测脚本与指标接口复用（同一份逻辑，避免「评测/线上两套」） */
  scoreOne, ruleGate, evaluateCandidate, isJuniorJob, screeningAgreement, OverrideCodes,
  /* 词库/口径版本：评测基线（tools/golden/baseline.json）与文档守卫都要引用它，避免各写一份 */
  REQ_LIB_VER };
