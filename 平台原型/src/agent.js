/* ===========================================================
   HR-Agent OS · Agent 引擎（原型模拟实现）
   真实系统中：规划器调用 LLM 产出 Task Plan，执行器逐个调工具。
   原型中：计划与结果均为预置内容 + 逐步动画，用于演示完整链路。
   演示重点：拆解 → 工具调用 → 脱敏 → 高风险闸门 → 人工确认
   =========================================================== */
window.Agent = (function () {

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ============ 任务计划库 ============ */
  const PLANS = {
    screening: {
      title: '简历筛选 Agent',
      goal: '帮我筛一下「高级 Java 工程师」这个岗位近 3 天的新简历',
      model: 'llm-router: 抽取模型 → 推理模型',
      steps: [
        { intent: '读取岗位要求与打分维度', tool: 'ats.get_job', risk: 0, ms: 420, tokens: 0,
          out: '{ job_id: "J-2026-118", title: "高级 Java 工程师",\n  must_have: ["3年以上Java","本科及以上"], rubric: {技能:40, 业务:30, 稳定性:15, 加分:15} }' },
        { intent: '拉取近 3 日新增简历', tool: 'ats.list_resumes', risk: 0, ms: 560, tokens: 0,
          out: '{ since: "2026-09-20", count: 86, files: ["resume_2081.pdf", ...] }' },
        { intent: '解析简历为结构化字段（含扫描件 OCR）', tool: 'resume.parse', risk: 0, ms: 900, tokens: 1840,
          out: '解析完成 86 份 → 成功 84 / 失败 2（扫描件模糊，已标记需人工补录）' },
        { intent: '⚙️ 反歧视处理：物理剔除受保护字段', tool: 'guard.strip_protected', risk: 0, ms: 180, tokens: 0, rule: true,
          out: '已移除字段：gender, birth_date, marital_status, hukou, photo\n→ 模型入参中以上字段不存在（不是「提示模型别考虑」，是物理删除）' },
        { intent: '⚙️ 硬性门槛规则前置判断（不消耗模型）', tool: 'rule.gate', risk: 0, ms: 140, tokens: 0, rule: true,
          out: '规则拦截 9 份（年限/学历不达标）→ 剩余 77 份进入模型打分\n节省模型调用 9 次 ≈ ¥0.36' },
        { intent: '按岗位维度逐项打分并生成理由', tool: 'llm.score_resume', risk: 0, ms: 1400, tokens: 12400,
          out: '输出结构化 JSON：77 份 × 4 维度，全部附 evidence 简历原句\nstrong 12 / ok 31 / no 34' },
        { intent: '⚙️ PII 脱敏（写入前）', tool: 'guard.mask_pii', risk: 0, ms: 160, tokens: 0, rule: true,
          out: '手机号 → [PHONE]　邮箱 → [EMAIL]　薪资期望 → [SALARY]' },
        { intent: '将筛选结果写回 ATS 并生成推荐表', tool: 'ats.update_stage', risk: 1, ms: 600, tokens: 0,
          out: '⚠️ 写操作：将更新 86 条候选人阶段记录' }
      ]
    },
    jd: {
      title: 'JD 生成 Agent',
      goal: '生成「高级 Java 工程师」的岗位 JD，并检查合规',
      model: 'llm-router: 通用模型',
      steps: [
        { intent: '理解岗位需求并补全结构', tool: 'llm.compose_jd', risk: 0, ms: 900, tokens: 1600,
          out: '生成岗位职责 6 条、任职要求 5 条、团队与福利介绍' },
        { intent: '歧视性用语扫描', tool: 'guard.bias_scan', risk: 0, ms: 260, tokens: 0, rule: true,
          out: '命中 3 处风险表述（详见下方扫描结果）' },
        { intent: '违法表述检查（对照劳动合同法口径）', tool: 'guard.legal_scan', risk: 0, ms: 240, tokens: 0, rule: true,
          out: '命中 1 处：「试用期不合格不支付工资」违反工资支付相关规定' },
        { intent: '输出待发布 JD（人工确认后发布）', tool: 'ats.publish_jd', risk: 1, ms: 500, tokens: 0,
          out: '等待人工确认后写入 ATS 并同步招聘渠道' }
      ]
    },
    selfservice: {
      title: '员工自助 Agent',
      goal: '员工提问：我还有几天年假？',
      model: 'llm-router: 通用模型 + 向量检索',
      steps: [
        { intent: '问题分类：个人数据 / 制度解释 / 超范围', tool: 'router.classify', risk: 0, ms: 300, tokens: 120,
          out: 'route = personal_data（查业务系统，权威数据）\n置信度 0.96' },
        { intent: '查询 HR 系统实时数据（本人权限）', tool: 'hr.get_leave_balance', risk: 0, ms: 380, tokens: 0,
          out: '{ user_id: "E-1042", annual_total: 10, used: 6.5, remaining: 3.5, carryover: 2.0 }' },
        { intent: '检索制度依据（说明计算口径）', tool: 'kb.search', risk: 0, ms: 460, tokens: 0,
          out: '命中《假期管理制度》v2.6 第 3 章 · 相似度 0.89（阈值 0.55）' },
        { intent: '组织回答并附依据来源', tool: 'llm.compose', risk: 0, ms: 620, tokens: 780,
          out: '回答已生成：含数字、计算口径、依据来源、更新时间、转人工入口' }
      ]
    },
    onboarding: {
      title: '入职流程 Agent',
      goal: '为方舟（9/22 入职）执行入职材料收集',
      model: '规则引擎（不调用大模型）',
      steps: [
        { intent: '生成个性化材料清单', tool: 'hr.material_checklist', risk: 0, ms: 320, tokens: 0, rule: true,
          out: '按岗位与职级生成 6 项：身份证、学历证、离职证明、体检报告、银行卡、紧急联系人' },
        { intent: 'OCR 校验已上传材料类型', tool: 'doc.classify', risk: 0, ms: 540, tokens: 640,
          out: '已收到 1 项（身份证）→ 识别通过；其余 5 项缺失' },
        { intent: '发送催收提醒（企微 + 邮件）', tool: 'msg.send_reminder', risk: 0, ms: 400, tokens: 0,
          out: '第 1 次催收已发送，抄送直属上级；未按期将每 2 天重复 1 次' },
        { intent: '材料齐备后发起账号开通审批', tool: 'oa.create_approval', risk: 1, ms: 0, tokens: 0,
          out: '⏸ 材料未收齐（1/6），本步骤挂起，等条件满足后自动继续' }
      ]
    }
  };

  /* ============ 渲染并执行计划 ============ */
  async function run(planKey, host, opts = {}) {
    const plan = PLANS[planKey];
    if (!plan || !host) return;
    host.innerHTML = `
      <div class="callout" style="margin-top:0">
        <b>🧭 任务目标</b>：${plan.goal}<br>
        <span class="muted small">模型路由：${plan.model} · 共 ${plan.steps.length} 步 · 高风险步骤 ${plan.steps.filter(s => s.risk).length} 个</span>
      </div>
      <div id="planlist"></div>
      <div id="planfoot" class="small muted" style="margin-top:10px"></div>`;
    const list = host.querySelector('#planlist');
    const foot = host.querySelector('#planfoot');

    plan.steps.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'plan-step pending';
      d.id = `ps-${planKey}-${i}`;
      d.innerHTML = `
        <div class="step-ico">${i + 1}</div>
        <div class="sbody">
          <div class="stitle">${s.intent}</div>
          <div class="smeta">
            <span>🔧 ${s.tool}</span>
            ${s.rule ? '<span style="color:var(--pur)">规则/代码（0 token）</span>' : ''}
            <span class="st">等待中</span>
          </div>
        </div>`;
      list.appendChild(d);
    });

    let totalMs = 0, totalTok = 0;
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      const el = host.querySelector(`#ps-${planKey}-${i}`);
      el.classList.remove('pending'); el.classList.add('run');
      el.querySelector('.st').textContent = '执行中…';
      await sleep(Math.max(320, opts.speed ? s.ms * 0.35 : s.ms));
      totalMs += s.ms; totalTok += s.tokens;

      // 高风险步骤：挂起等人工
      if (s.risk) {
        el.classList.remove('run'); el.classList.add('wait');
        el.querySelector('.step-ico').textContent = '!';
        el.querySelector('.st').innerHTML = '<span style="color:var(--yel)">⏸ 已挂起 · 等待人工审核</span>';
        el.querySelector('.sbody').insertAdjacentHTML('beforeend',
          `<div class="sout" style="border-color:rgba(245,185,66,.4)">${esc(s.out)}</div>
           <div class="scanwarn">🛡️ 该工具被标记为「需人工审核」，Agent 已停止执行并进入审核队列。
             审核通过后任务将从此处继续，不会重跑前面的步骤。</div>`);
        foot.innerHTML = `<span style="color:var(--yel)">任务状态：waiting_approval</span> · 已耗时 ${(totalMs / 1000).toFixed(1)}s · 已消耗 ${totalTok.toLocaleString()} tokens · 点击「去审核」处理`;
        if (opts.onGate) opts.onGate(host, i);
        return { status: 'waiting_approval', step: i, ms: totalMs, tokens: totalTok };
      }

      el.classList.remove('run'); el.classList.add('done');
      el.querySelector('.step-ico').textContent = '✓';
      el.querySelector('.st').innerHTML = `<span style="color:var(--grn)">✓ ${s.ms}ms</span>${s.tokens ? ` · <span class="muted">${s.tokens} tok</span>` : ''}`;
      el.querySelector('.sbody').insertAdjacentHTML('beforeend', `<div class="sout">${esc(s.out)}</div>`);
      foot.innerHTML = `已执行 ${i + 1}/${plan.steps.length} 步 · ${(totalMs / 1000).toFixed(1)}s · ${totalTok.toLocaleString()} tokens`;
      if (opts.onStep) opts.onStep(i);
    }
    foot.innerHTML = `<span style="color:var(--grn)">任务状态：done</span> · 总耗时 ${(totalMs / 1000).toFixed(1)}s · 共消耗 ${totalTok.toLocaleString()} tokens ≈ ¥${(totalTok * 0.000004).toFixed(3)}`;
    if (opts.onDone) opts.onDone();
    return { status: 'done', ms: totalMs, tokens: totalTok };
  }

  function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  /* ============ JD 生成 + 合规扫描（跨行业；规则与后端 engine.js 同源） ============ */
  const JD_DUTY_TPL = {
    '互联网': ['负责业务系统的设计、开发与持续迭代；', '参与需求评审与技术方案设计，产出可维护的代码与文档；', '保障线上服务稳定性，参与性能优化与线上问题排查；', '与产品、测试、运维协作，推动需求按期交付。'],
    '制造业': ['负责生产计划的组织与人员调度，保障计划按期达成；', '执行精益生产与 5S 现场管理，持续改善作业效率；', '组织安全生产检查与员工技能培训，落实安全责任制；', '对接质量与设备部门，处理产线异常并推动闭环整改。'],
    '零售连锁': ['负责门店整体经营管理，达成销售、毛利与成本控制目标；', '负责门店团队招聘、排班、培训与绩效考核；', '执行商品陈列、库存周转与损耗管理标准；', '处理顾客投诉与突发状况，维护门店品牌形象。'],
    '医疗健康': ['负责护理团队的日常工作组织与人员排班；', '落实护理质量控制标准，定期开展护理质量检查与整改；', '负责院感防控措施的培训、监督与执行记录；', '组织护理人员业务培训与考核，提升团队专业能力。'],
    '教育培训': ['负责潜在学员的课程咨询、需求分析与学习方案设计；', '完成电话邀约、到访接待与试听转化，达成业绩目标；', '跟进在读学员学习进度，推动续费与转介绍；', '维护学员及家长关系，及时处理投诉与异议。'],
    '金融': ['负责信贷业务的资料审核、风险识别与授信建议；', '识别欺诈风险特征，参与反欺诈规则与策略优化；', '开展存量客户风险监测，出具风险预警与处置建议；', '配合合规与审计部门完成检查与整改工作。'],
    '销售': ['负责目标行业的大客户开发与关系维护；', '组织需求调研与方案讲解，主导商务谈判与合同签署；', '协调售前与交付团队推进项目落地，负责回款跟进；', '维护重点客户关系，挖掘续约与增购机会。'],
    '人力资源': ['作为业务伙伴，提供组织与人才方面的解决方案；', '负责所支持团队的人才盘点、继任梯队与关键岗位补位；', '推动绩效管理落地，参与组织诊断与变革项目；', '处理员工关系问题，提升团队敬业度与稳定性。'],
    /* v0.9.6 新增行业（与后端 server/engine.js 的 JD_DUTIES 同源） */
    '建筑工程': ['负责工程项目的施工组织与进度管控，保障按合同节点交付；', '编制并执行施工方案与技术交底，落实施工质量标准；', '负责工程造价预算、结算与成本控制，审核工程量与变更；', '落实安全生产与文明施工管理，组织安全检查与隐患整改。'],
    '物流运输': ['负责运输计划制定与线路调度，保障货物按时送达；', '负责仓储日常作业与库存管理，保障账实一致；', '负责承运商的开发、考核与合作管理，优化运力结构；', '跟踪并处理运输与配送异常，降低货损与客户投诉。'],
    '酒店餐饮': ['负责餐厅／酒店的日常运营与现场管理，保障服务与出品质量；', '负责菜品出品与卫生标准的执行与检查，落实食品安全规范；', '负责食材与物料的采购验收、库存与损耗管理；', '负责一线员工的排班、培训与带教。'],
    '医药健康': ['负责药品／器械的学术推广与客户拜访，完成区域或品类目标；', '开展产品与疾病领域知识的学术沟通，传递合规的医学信息；', '负责药品注册申报资料的准备与法规符合性审核；', '维护医院、连锁与渠道客户关系，推动准入与复购。'],
    '游戏': ['负责游戏玩法与系统设计，输出策划案并推动实现；', '负责数值与经济系统设计，平衡成长曲线与付费体验；', '参与版本规划与上线节奏管理，跟进研发与验收；', '分析玩家行为与反馈数据，输出调优方案。'],
    '能源电力': ['负责发输配电系统或新能源场站的运行监控与巡检；', '负责电气设备的检修、消缺与故障处理，保障系统稳定；', '执行电力安全工作规程与作业票制度，组织安全检查；', '编制运维方案与应急预案，组织抢修与演练。'],
    '传媒文化': ['负责内容的选题策划、采编与稿件撰写；', '负责稿件编辑、校对与终审，确保事实准确、表述规范；', '负责视频、音频内容的拍摄、剪辑与后期制作；', '分析内容数据表现，输出复盘结论并优化选题方向。'],
    '专业服务': ['负责合同的起草、审核与履约管理，出具法律意见并控制条款风险；', '负责核算、报表与财务分析工作，确保数据准确及时；', '开展尽职调查与合规审查，支持业务方案落地；', '维护客户关系并推动项目按期交付。'],
    '物业管理': ['负责物业项目的日常运营管理，保障服务标准与业主满意度；', '负责设施设备的巡检维护与维修派工，保障正常运行；', '负责安保与秩序维护，落实门禁、巡逻与应急预案；', '负责物业费收缴与项目成本、外包供应商管理。'],
    '通用': ['负责相关日常工作，按岗位目标完成交付；', '参与部门内部协作，及时反馈进展与风险；', '持续优化工作方法，提升交付质量与效率。']
  };

  /* ---- 任职要求六维度扩充（与后端 server/engine.js 同源规则，离线也真扩充） ---- */
  const INDUSTRY_CORE = {
    '互联网': { core: ['Java', 'Spring Boot', 'MySQL', 'Redis', '微服务', '高并发', '分布式', 'Kafka', 'Docker', 'Kubernetes', 'React', 'Vue', 'TypeScript', 'Node.js', '性能优化', '系统设计'], plus: ['开源项目', '大厂背景', '架构设计'] },
    '制造业': { core: ['精益生产', '5S', '排产', 'TPM', '标准工时', '工艺优化', 'SOP', '质量管控', '设备维护', '班组长管理', '安全生产', '数控编程'], plus: ['六西格玛', '降本增效', '产线改造'] },
    '零售连锁': { core: ['门店运营', '团队管理', '销售达成', '商品陈列', '库存管理', '客户服务', '会员运营', '排班管理', '损耗控制', '促销活动', '坪效管理'], plus: ['新店开业', '标杆店'] },
    '医疗健康': { core: ['护理管理', '院感控制', '护理质控', '临床护理', '急救技能', '护理文书', '患者沟通', '护理排班', '护理计划', '不良事件管理'], plus: ['专科护士认证', '护理带教', '质控项目'] },
    '教育培训': { core: ['课程规划', '客户沟通', '续费转化', '电话邀约', '学习方案设计', '家长沟通', '试听转化', '学员管理', '招生渠道'], plus: ['销冠', '转介绍转化', '社群运营'] },
    '金融': { core: ['风险识别', '信贷审核', '反欺诈', '数据分析', 'SQL', '财务分析', '合规审查', '尽职调查', '授信审批', '反洗钱', '逾期催收'], plus: ['风控模型', '持证（FRM/CPA）', '审计经验'] },
    '销售': { core: ['大客户开发', '商务谈判', '解决方案销售', '招投标', '客户关系维护', '销售漏斗管理', '回款管理', '客户拜访', '渠道管理', '业绩达成'], plus: ['行业资源', '标杆客户案例', '团队管理'] },
    '人力资源': { core: ['HRBP', '组织发展', '人才盘点', '绩效管理', '员工关系', '招聘管理', '薪酬设计', '劳动法', '招聘渠道'], plus: ['组织变革项目', '人才发展体系'] },
    /* v0.9.6 新增行业（与后端 server/db.js 的 INDUSTRY_SKILLS 同源） */
    '建筑工程': { core: ['施工组织设计', '工程造价', '工程预算', '施工质量控制', '安全文明施工', '图纸会审', '工程资料管理', '分包管理', '测量放线', '竣工验收', 'CAD'], plus: ['一级建造师', '注册造价工程师', '大型项目经验'] },
    '物流运输': { core: ['运输调度', '路线规划', '仓储管理', '库存盘点', '配送时效管理', '承运商管理', '物流成本控制', 'WMS', 'TMS', '货运单据', '安全生产'], plus: ['物流师认证', '降本成果', '网络规划经验'] },
    '酒店餐饮': { core: ['门店运营', '菜品出品管理', '食品安全管理', '顾客满意度', '成本与毛利管控', '排班管理', '物料与库房管理', '服务流程标准', '卫生管理'], plus: ['食品安全管理员证', '扭亏经验', '连锁标准化经验'] },
    '医药健康': { core: ['学术推广', '产品知识', '临床数据解读', '药品注册法规', 'GSP', 'GMP', '药品效期管理', '临床试验', '不良反应监测', '客户拜访', '医院渠道'], plus: ['医药代表备案', '医院资源', '注册项目经验'] },
    '游戏': { core: ['玩法设计', '数值设计', '关卡设计', '系统策划', '剧情文案', '版本规划', '玩家数据分析', '游戏运营活动', 'Unity', 'UE'], plus: ['上线项目经验', '爆款玩法案例', '海外发行经验'] },
    '能源电力': { core: ['电气设备运行', '电力系统', '变配电运维', '继电保护', '电气试验', '新能源（光伏／风电／储能）', '能效分析', '电力安全工作规程', '作业票管理', '并网与电价', '高压电工'], plus: ['注册电气工程师', '电工进网作业许可', '节能改造经验'] },
    '传媒文化': { core: ['选题策划', '采访写作', '编辑校对', '视频剪辑', '摄影摄像', '后期制作', '内容分发', '新媒体平台运营', '版权管理', '数据复盘'], plus: ['爆款作品', '剪辑后期能力', '内容矩阵经验'] },
    '专业服务': { core: ['合同审核', '法律意见出具', '尽职调查', '案件跟进', '知识产权', '合规审查', '项目交付管理', '客户沟通', '文档撰写', '财务分析', '审计'], plus: ['法律职业资格证', '注册会计师', '行业客户资源'] },
    '物业管理': { core: ['物业项目运营', '设施设备维护', '安保与秩序管理', '保洁绿化管理', '业主投诉处理', '物业费收缴', '消防安全管理', '外包供应商管理', '应急预案'], plus: ['物业管理师', '创优项目经验', '收缴率提升成果'] },
    '通用': { core: ['沟通协作', '项目管理', '数据分析', 'Office', '汇报能力'], plus: [] }
  };
  const INDUSTRY_REQ = {
    '互联网': { majors: '计算机、软件工程、信息工程、电子信息等相关专业', expHint: '有互联网产品研发经历，完整参与过从需求评审到上线运维的迭代周期',
      general: ['逻辑清晰，能把模糊需求拆解为可落地的技术方案，并说明方案取舍理由', '对技术有持续热情，关注业界主流方案与工程实践的演进', '能独立承接模块，对交付质量、进度与线上稳定性负责'],
      soft: ['能与产品、测试、运维等角色高效协作，把技术结论翻译成业务语言', '学习能力强，能快速上手不熟悉的技术栈与业务域', '有一定抗压能力，能应对版本冲刺与线上故障处理'],
      nice: ['有开源项目贡献、技术博客或专利沉淀', '有高并发、大流量系统的实战经验', '有技术带人或架构设计经验'] },
    '制造业': { majors: '机械工程、自动化、工业工程、材料成型等相关专业', expHint: '有制造业现场工作经历，熟悉车间组织方式与生产节拍',
      general: ['现场问题解决能力：面对设备异常与交期压力，能快速定位并推动闭环整改', '质量与安全意识强，熟悉安全生产规范，无重大安全责任事故记录', '结果导向，对产量、良率、成本等现场指标负责'],
      soft: ['能与生产、质量、设备、工艺等多部门顺畅对接，推动跨工序协同', '沟通务实，能用现场语言向一线班组交代任务与标准', '能适应生产现场环境与旺季加班、倒班节奏'],
      nice: ['有六西格玛绿带／黑带或精益改善项目经验', '主导过降本增效或产线改造项目', '持特种作业、注册安全工程师等相关资质'] },
    '零售连锁': { majors: '市场营销、工商管理、连锁经营管理等相关专业', expHint: '有连锁零售门店运营经历，熟悉门店日常经营与排班管理',
      general: ['客户导向，能从顾客体验出发发现问题并推动改进', '经营意识强，关注销售、毛利、损耗、坪效等核心指标', '执行落地扎实，能把总部标准动作在门店端稳定复现'],
      soft: ['亲和力强，善于与顾客、店员及商圈伙伴建立信任', '能带动门店氛围，激励团队共同完成销售目标', '抗压能力好，能接受轮班、周末与节假日排班'],
      nice: ['有新店开业或标杆店打造经验', '所辖门店曾获区域业绩排名前列', '有会员运营或社群营销实操经验'] },
    '医疗健康': { majors: '护理学、临床医学、康复治疗学等相关专业', expHint: '有临床护理或护理管理经历，熟悉科室护理工作流程与排班机制',
      general: ['责任心与同理心强，尊重患者及家属，注重患者隐私保护', '严谨细致，严格执行护理操作规程与查对制度', '风险意识强，能及时识别并上报不良事件与安全隐患'],
      soft: ['情绪稳定，能在急救与突发状况下保持清晰判断', '善于与医生、患者及家属沟通，妥善处理医患关系', '能接受夜班轮值与科室排班安排'],
      nice: ['持护士执业资格证或专科护士认证', '有护理带教或护理质量控制项目经验', '参与过院感防控或护理质量改进项目'] },
    '教育培训': { majors: '教育学、心理学、市场营销、汉语言文学等相关专业', expHint: '有教育咨询或招生转化经历，熟悉试听—到访—成交流程',
      general: ['目标导向，对邀约量、到访率、转化率等过程指标负责', '客户意识强，能站在学员与家长立场设计学习方案', '对教育产品有理解，能把课程价值讲清楚、讲准确'],
      soft: ['亲和力与感染力强，能在电话与面谈中快速建立信任', '表达有条理，能从容应对家长对课程效果与费用的质疑', '抗压能力好，能适应业绩考核与周末排班'],
      nice: ['有个人销售冠军或团队业绩标杆经历', '有转介绍与社群运营实操经验', '持教师资格证或心理咨询相关证书'] },
    '金融': { majors: '金融学、经济学、统计学、会计学、法学等相关专业', expHint: '有金融机构风控、信贷或合规相关岗位经历',
      general: ['严谨细致，对数据与口径准确度要求高，不放过异常波动', '合规意识强，熟悉监管要求，能坚持原则守住业务红线', '风险敏感度高，能从业务表象中识别潜在的欺诈与信用风险'],
      soft: ['沟通有分寸，能在业务诉求与风险控制之间做好平衡', '保密意识强，严格遵守客户信息与业务数据保密要求', '有一定抗压能力，能承受审件峰值与合规检查压力'],
      nice: ['持有 FRM、CPA、法律职业资格等专业证书', '有风控模型或策略优化经验', '有审计、监管报送或反洗钱项目经验'] },
    '销售': { majors: '市场营销、工商管理、国际贸易等相关专业（能力突出者可不限专业）', expHint: '有 B2B 大客户销售经历，独立完成过完整销售周期',
      general: ['目标感强、自驱力足，能主动开拓而非被动等单', '商务敏感度高，能判断客户真实需求与决策链条', '对结果负责，能承担明确的业绩指标与回款责任'],
      soft: ['沟通说服力强，能在谈判中把握节奏与让步边界', '韧性好，能承受长期跟单与阶段性业绩压力', '善于经营长期客户关系，注重口碑与复购'],
      nice: ['有目标行业客户资源或标杆客户案例', '有千万级项目签约经历', '有销售团队管理或渠道拓展经验'] },
    '人力资源': { majors: '人力资源管理、心理学、管理学、劳动与社会保障等相关专业', expHint: '有 HRBP 或全模块人力工作经验，能独立支持业务团队',
      general: ['服务意识与同理心强，能同时理解业务诉求与员工感受', '逻辑清晰，能用数据说明人力现状与问题', '原则性强，能在合规底线与业务灵活性之间把好尺度'],
      soft: ['跨部门沟通顺畅，能与业务负责人建立可信赖的合作关系', '保密意识与职业操守良好，妥善处理敏感人事信息', '情绪稳定，能应对员工关系中的冲突与突发状况'],
      nice: ['有组织变革、人才盘点或任职资格体系搭建项目经验', '熟悉劳动法与用工合规实务', '有人力数据分析或 HR 系统实施经验'] },
    /* v0.9.6 新增行业（与后端 server/engine.js 的 INDUSTRY_REQ 同源） */
    '建筑工程': { majors: '土木工程、工程管理、工程造价、建筑学、市政工程等相关专业', expHint: '有完整参与工程项目从开工到竣工的经历，能说明负责的标段规模与管控结果',
      general: ['安全意识强，熟悉施工现场安全规范，对安全事故零容忍', '现场协调能力强，能在多方交叉作业中推进进度、化解冲突', '成本意识强，能在不牺牲质量的前提下控制工程成本'],
      soft: ['能与业主、监理、分包与施工班组顺畅沟通，把问题解决在现场', '抗压能力强，能应对赶工期、恶劣天气与材料延误', '能适应工地现场环境与常驻项目的工作方式'],
      nice: ['持一级／二级建造师、造价工程师等执业资格', '有独立负责完整工程项目的经历', '有大型项目或地标工程经验'] },
    '物流运输': { majors: '物流管理、交通运输、供应链管理等相关专业', expHint: '有独立负责运输或仓储作业的经验，能说明时效、成本或货损的改善数据',
      general: ['时效意识强，对交付时间与货物安全高度负责', '成本意识强，能在保证时效的同时持续优化运输与仓储成本', '安全意识强，严格执行运输与现场作业规范'],
      soft: ['能与司机、仓管、承运商与客户多方协调，推动异常及时解决', '抗压能力强，能应对旺季爆仓、突发延误等高压场景', '能适应不定时工作与仓库、场站等现场作业环境'],
      nice: ['有物流网络规划或降本项目经验', '熟悉 WMS／TMS 等物流系统', '持货运从业资格或特种运输资质'] },
    '酒店餐饮': { majors: '酒店管理、旅游管理、烹饪工艺与营养、食品科学等相关专业', expHint: '有餐饮或酒店一线运营经验，能说明负责的业态、规模与管理结果',
      general: ['服务意识强，在快节奏与高峰期仍能照顾到顾客体验', '标准意识强，能坚持出品与卫生标准不走样', '成本意识强，关注毛利、损耗与人力成本'],
      soft: ['沟通有亲和力，能处理顾客投诉并安抚现场情绪', '带队能力强，能带住一线员工并在旺季保持队伍稳定', '能适应排班、节假日与高峰时段的工作强度'],
      nice: ['持健康证、食品安全管理员等资质', '有门店或酒店扭亏、口碑提升的经验', '有连锁体系标准化落地经验'] },
    '医药健康': { majors: '药学、临床医学、生物制药、药物制剂、市场营销等相关专业', expHint: '有医药行业相关岗位经验，能说明负责的产品线、区域或项目范围',
      general: ['合规意识强，严格遵守药品推广与销售法规，不做违规承诺', '学习能力强，能快速掌握产品与疾病领域的专业知识', '结果导向，对区域或品类的业绩与项目进度负责'],
      soft: ['沟通专业且有分寸，能与医生、药师、客户建立长期信任', '抗压能力强，能适应出差、拜访与业绩压力', '保密意识强，妥善处理临床与客户数据'],
      nice: ['有药品注册或临床项目经验', '熟悉 NMPA／GSP／GMP 相关法规', '有医院或连锁药店渠道资源'] },
    '游戏': { majors: '数字媒体、游戏设计、计算机、动画、美术等相关专业', expHint: '有完整参与游戏从立项到上线的经历，能说明负责的系统与上线表现',
      general: ['对游戏有真实理解，能说清玩家的爽点与痛点，而不是只会背术语', '数据意识强，能用留存、付费等指标验证设计判断', '有审美与创新意识，能提出差异化的玩法或表达'],
      soft: ['能与策划、程序、美术等角色高效协作，把设计意图讲清楚', '抗压能力强，能应对版本冲刺与上线期的强度', '沟通有分寸，能在评审中接受不同意见并推动收敛'],
      nice: ['有已上线游戏的完整项目经验', '有爆款玩法或长线运营案例', '有海外发行或多语言版本经验'] },
    '能源电力': { majors: '电气工程及其自动化、电力系统、新能源科学与工程、能源与动力工程等相关专业', expHint: '有电力或新能源项目的运行、检修或建设经验，能说明负责的设备与安全记录',
      general: ['安全责任意识极强，严格执行电力安全工作规程，不走捷径', '动手能力强，能到现场处理设备与系统异常', '严谨细致，对参数、记录与操作票保持零差错要求'],
      soft: ['能与调度、施工、运维与外部单位顺畅对接，推动问题闭环', '应变能力强，能处理停电、跳闸等突发情况', '能适应野外站点、夜班值守与抢修节奏'],
      nice: ['持电工进网作业许可、注册电气工程师等资质', '有新能源项目建设或运维经验', '有节能降碳或能效提升项目经验'] },
    '传媒文化': { majors: '新闻传播、汉语言文学、广播电视编导、数字媒体、广告学等相关专业', expHint: '有独立完成内容从选题到发布的完整经验，能给出作品的传播数据',
      general: ['对内容与舆论敏感，能快速判断选题价值与潜在风险', '有原创能力，不靠洗稿和搬运', '细节严谨，对事实、措辞与版权保持敬畏'],
      soft: ['沟通与采访能力强，能快速获取关键信息并核实', '审美在线，能把内容表达得既清楚又有质感', '节奏适应性强，能应对突发热点与截稿压力'],
      nice: ['有爆款内容或高传播量作品', '有成熟的拍摄剪辑与后期能力', '有内容矩阵或账号运营经验'] },
    '专业服务': { majors: '法学、会计学、工商管理、经济类等相关专业', expHint: '有专业服务机构（律所、会计师事务所、咨询公司）或企业法务／财务岗经历',
      general: ['专业严谨，结论有依据、过程有留痕，能对交付质量负责', '风险意识强，能在业务诉求与合规底线之间给出可执行方案', '时间管理能力强，能同时推进多个并行项目并守住节点'],
      soft: ['书面与口头表达都严谨，能把专业语言翻译成客户听得懂的建议', '保密意识强，妥善处理客户敏感信息与商业机密', '抗压能力强，能应对项目高峰期与客户临时需求'],
      nice: ['持法律职业资格、注册会计师、税务师等专业证书', '有独立承办项目或案件的经验', '有行业客户资源或标杆案例'] },
    '物业管理': { majors: '物业管理、工程管理、消防工程、酒店管理等相关专业', expHint: '有物业项目一线管理经验，能说明负责的业态、管理面积与业主满意度结果',
      general: ['服务意识强，能耐心处理业主各类诉求与邻里纠纷', '安全责任意识强，对消防与治安隐患保持高度敏感', '执行扎实，能把日常巡检与整改真正落到记录和闭环'],
      soft: ['沟通有耐心，能在业主、住户与外包单位之间做好协调', '应变能力强，能处理停水停电、群诉等突发情况', '能适应轮班值守与现场巡查的工作方式'],
      nice: ['持物业管理师、消防设施操作员等资质', '有创优／标杆项目经验', '有提升物业费收缴率或满意度的成果'] },
    '通用': { majors: '相关专业', expHint: '有同岗位或相近岗位从业经历，能独立承担岗位职责',
      general: ['责任心强，对负责模块的产出质量与进度负责', '结果导向，能在目标压力下主动推进并闭环', '风险意识强，问题暴露及时、处理有始有终'],
      soft: ['表达清晰、善于倾听，能与多部门高效对接', '学习能力强，能快速适应业务与工具变化', '情绪稳定，能承担阶段性高强度工作'],
      nice: ['有同行业头部企业从业经历', '有跨部门项目或带团队经验', '有可量化的业绩改善案例'] }
  };
  /* 已填内容 → 条目数组（v0.9.8，与后端 engine.js 同一套规则）：
     字符串输入不再按「，；」切开 —— 它们是句中标点，不是条目分隔符。
     旧写法会把「和顶尖算法、工程团队并肩，把想法快速上线」劈成两条。 */
  const parseReqInput = (v, fallback) => {
    const empty = { lead: [], duty: [], must: [], nice: [], benefit: [], heads: 0 };
    const RL = window.ReqLib;
    if (Array.isArray(v)) { empty[fallback || 'must'] = v.map(s => String(s).trim()).filter(Boolean); return empty; }
    if (!RL || !RL.parseReqText) { empty[fallback || 'must'] = String(v == null ? '' : v).split(/[,，;；\n]/).map(s => s.trim()).filter(Boolean); return empty; }
    const p = RL.parseReqText(v);
    if (!p.heads) { empty[fallback || 'must'] = p.must; return empty; }
    return p;
  };
  const splitReqInput = (must, nice) => {
    const a = parseReqInput(must, 'must'), b = parseReqInput(nice, 'nice');
    return { lead: a.lead.concat(b.lead), duty: a.duty.concat(b.duty), must: a.must.concat(b.must),
      nice: a.nice.concat(b.nice), benefit: a.benefit.concat(b.benefit), heads: a.heads + b.heads };
  };
  /* v14：整段 JD「分栏回填」—— 用户在任一 JD 输入框粘入完整 JD 时，
     把职责 / 任职要求 / 加分项分派到各自输入框，而不是只取一栏、静默丢弃其余。
     与后端 engine.js 的 splitReqInput 同源；lead（引言）仅在 ≥2 个小标题时独立存在。
     返回：已清理（去序号、去尾标点）并去重的多行字段数组。 */
  function splitJdFields(text) {
    const p = splitReqInput(text, '');
    const cl = arr => dedupeReq((arr || []).map(cleanReq).filter(Boolean));
    return {
      lead: cl(p.lead), duty: cl(p.duty), must: cl(p.must),
      nice: cl([].concat(p.nice || [], p.benefit || [])),
      heads: p.heads
    };
  }
  const toReqs = v => parseReqInput(v, 'must').must;
  const cleanReq = s => String(s).replace(/[。；;，,、\s]+$/, '').trim();
  /* 维度归位判据（与后端 engine.js 同源；v12 起 REQ_EXP 含「实习」） */
  const REQ_EDU = /学历|本科|大专|硕士|博士|统招|学士|毕业|专业不限|\d{2}\s*届/;
  const REQ_EXP = /年以上|经验|从事|任职经历|工作经历|实习/;
  const REQ_SOFT = /热爱|热情|同理心|好奇|主动|抗压|扛得住|沟通|表达|责任心|学习能力|自驱|踏实|细心|耐心|团队协作|上进/;
  const dedupeReq = arr => { const seen = new Set(); return arr.filter(t => { const k = String(t).replace(/\s/g, ''); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
  const bigrams = s => { const t = String(s).replace(/[\s，,。；;、（）()：:／/·-]/g, ''); const o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
  const similarReq = (a, b, th) => {
    const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return false;
    let n = 0; A.forEach(g => { if (B.has(g)) n++; });
    return n / Math.min(A.size, B.size) >= (th || 0.34);
  };
  /* 阈值更松的「用户已经写过这件事」判断，专用于技能补位（与后端 engine.js 同源） */
  const coveredByUser = (k, userTexts) => userTexts.some(u => similarReq(u, k, 0.28) || similarReq(k, u, 0.28));
  /* 自动补位产物的固定句式；清除「跨职能族的历史错配产物」——见后端 engine.js 同名函数注释。
     离线侧同样需要：JD 草稿生成后会把扩充结果写回表单，反复编辑会累积错配条目。 */
  /* 尾缀轮换与句式族：与后端 engine.js 同源同款（新增尾缀两处必须同步） */
  const SKILL_TAILS = ['能独立应用于实际业务场景', '并在真实业务中完整落地过', '能独立完成该方向的日常工作', '并了解常见的实践方法与工具'];
  const JUNIOR_NICE = ['有相关岗位的实习经历者优先', '有学生干部或社团组织经历者优先', '在校期间有相关项目或竞赛经历者优先'];
  const AUTO_FILL_RE = /^熟悉\s?.{1,40}，(?:能独立应用于实际业务场景|并在真实业务中完整落地过|能独立完成该方向的日常工作|并了解常见的实践方法与工具)$/;
  function stripMisfitAutoFill(arr, keepFnKey) {
    const RL = window.ReqLib;
    if (!RL || !Array.isArray(arr)) return Array.isArray(arr) ? arr : [];
    return arr.filter(t => {
      if (!AUTO_FILL_RE.test(String(t).trim())) return true;
      const misfit = Object.keys(RL.FUNCTIONS).some(k => k !== keepFnKey
        && RL.FUNCTIONS[k].core.some(c => String(t).indexOf(c) >= 0));
      return !misfit;
    });
  }
  const eduRequirement = (eduRank, majors) => {
    const r = Number(eduRank), m = (!majors || majors === '相关专业') ? '' : majors;
    if (!r || r <= 0) return m ? `学历不限，${m.replace(/等相关专业$/, '')}等专业背景者优先；以实际能力与项目经验为主要评估依据`
      : '学历不限，以实际能力与项目经验为主要评估依据';
    const level = r === 1 ? '大专' : r === 2 ? '本科' : r === 3 ? '硕士' : '博士';
    const head = m ? `${level}及以上学历，${m}` : `${level}及以上学历`;
    const tail = r <= 1 ? '；具备扎实实操经验者可适当放宽' : r === 2 ? '；专业技能突出者可放宽至大专' : '；研究方向与本岗位高度相关者优先';
    return head + tail;
  };
  /* 把已填的任职要求按维度归位 → 补齐缺失维度 → 六维度结构 */
  function expandReqs(input) {
    const RL = window.ReqLib;
    const industry = input.industry || '通用';
    const title = (input.title || '').trim();
    const y = Number(input.years) || 2;
    /* 原文还原 + 小标题归位：整段粘进来的 JD 会在这里被拆回
       职责 / 任职要求 / 加分项 / 福利，而不是变成一堆半句碎片。 */
    const blob = splitReqInput(input.must, input.nice);
    const userMust = blob.must.map(cleanReq).filter(Boolean);
    const userNice = blob.nice.map(cleanReq).filter(Boolean);
    /* 职能族优先、行业兜底 —— 与后端 engine.js 同一套规则，词库同为 shared/req-lib.js。
       旧版按行业补位，导致互联网行业的非技术岗（如 AI 产品经理）被补上「熟悉 Java」。 */
    const fnKey = RL ? RL.detectFunction(title, [...userMust, ...userNice]) : null;
    const fn = fnKey ? RL.FUNCTIONS[fnKey] : null;
    /* ⚠️ 与后端 engine.js 同一条规则：只有认出职能族才允许用行业素材。
       行业表是按「该行业的主力职能」写的（互联网＝技术岗口径），拿它给
       认不出职能的岗位兜底，会把「储备干部」补成程序员。 */
    const R = fn || INDUSTRY_REQ['通用'];
    const lib = fn || INDUSTRY_CORE['通用'];
    /* 归位前先剔除跨职能族的错配产物（如非技术岗里的「熟悉 Java」） */
    const uMust = stripMisfitAutoFill(userMust, fnKey);
    const uNice = stripMisfitAutoFill(userNice, fnKey);
    /* 软素质单列一桶：把「对 AI 是真热爱」塞进「专业技能」整段就不着调了。
       v12：已填内容「保留核心信息 → 书面化润色」后再落桶。
       ⚠️ 维度判定用**润色前**的原文 —— 润色会换词（「聪明有灵气」→「思维敏捷」），
       拿新词去判维度会把条目分错桶。与后端 engine.js 同一套规则。 */
    const s1 = [], s2 = [], s3 = [], s4 = [];
    uMust.forEach(t => {
      const p = (RL && RL.polishMustItem) ? RL.polishMustItem(t) : t;
      if (REQ_EDU.test(t)) s3.push(p);
      else if (REQ_EXP.test(t)) s2.push(p);
      else if (REQ_SOFT.test(t)) s4.push(p);
      else s1.push(p);
    });
    const userAll = [...uMust, ...uNice];
    const bench = fn ? dedupeReq(lib.core).filter(k => !coveredByUser(k, userAll)) : [];
    const kwWord = (k, i) => `熟悉${/^[A-Za-z]/.test(k) ? ' ' : ''}${k}，${SKILL_TAILS[i % SKILL_TAILS.length]}`;
    bench.slice(0, Math.max(0, 4 - s1.length)).forEach((k, i) => s1.push(kwWord(k, i)));
    if (!s1.length) s1.push(`掌握${title || '本岗位'}所需的核心专业技能，能独立完成岗位交付`);
    /* 工作经验：管培生 / 实习 / 应届岗不设年限门槛（与后端 engine.js 同口径）
       ⚠️ 判重扫**全部已填内容**而非只看 s2 —— 二次展开时「有 1–2 段…实习经历」
       会落进专业技能桶，只看 s2 会再补一遍，凭空多出一条要求。 */
    const junior = RL ? RL.detectJunior(title, [...userMust, ...userNice]) : false;
    if (!s2.length) {
      s2.push(junior ? '无需相关工作经验，欢迎应届毕业生投递'
        : `${y} 年以上${title || '相关岗位'}经验，有完整项目或业务周期经历`);
    }
    const filledAll = [...s1, ...s2, ...s3, ...s4];
    if (junior) {
      if (!filledAll.some(t => /实习/.test(t))) s2.push('有 1–2 段与岗位方向对口的实习经历者优先');
    } else if (!filledAll.some(t => t.includes(R.expHint.slice(0, 10)))) {
      s2.push(R.expHint);
    }
    if (!s3.length) s3.push(eduRequirement(input.eduRank, R.majors));
    else if (!/专业/.test(s3.join('')) && R.majors !== '相关专业') s3.push(`专业方向：${R.majors}`);
    const general = dedupeReq(R.general), softTpl = dedupeReq(R.soft);
    const softSelf = dedupeReq([...s4, ...softTpl]);
    /* v12：加分项最终统一美化为「…者优先」的对外句式（连模板补位项一起，
       一段里语气才一致；老岗位自愈重算时也分不清哪条是 HR 写的）。
       改变的只是句式收尾，模板的选取逻辑一概未动。
       去重放在**美化之前**：若先加「者优先」再查重，「有 X 者优先」会和
       模板里的「有 X」因表述不同而躲过 similarReq。 */
    const niceList = dedupeReq((RL && RL.polishNiceItem) ? uNice.map(RL.polishNiceItem) : uNice);
    const niceTarget = niceList.length >= 3 ? niceList.length : 4;
    /* 管培生／实习岗不得补资深口径的加分项（与后端 engine.js 同一条规则） */
    const SENIOR_NICE_RE = /从\s*0\s*到\s*1|主导|独立负责|独立完成|带店|扭亏|多年|资深|搭建.{0,6}(体系|团队)/;
    let nicePool = !fn ? [] : (R.nice.length ? R.nice : lib.plus.map(p => /^[有主]/.test(p) ? p : `有${p}相关经历`));
    if (junior && fn) {
      nicePool = nicePool.filter(t => !SENIOR_NICE_RE.test(t));
      JUNIOR_NICE.forEach(t => { if (!nicePool.some(x => similarReq(x, t))) nicePool.push(t); });
    }
    nicePool.forEach(t => {
      if (niceList.length >= niceTarget) return;
      if (niceList.some(x => similarReq(x, t))) return;
      niceList.push(t);
    });
    /* polishNiceItem 幂等，重复展开不会叠成「者优先者优先」 */
    const niceOut = (RL && RL.polishNiceItem) ? dedupeReq(niceList.map(RL.polishNiceItem)) : niceList;
    const d1 = dedupeReq(s1), d2 = dedupeReq(s2), d3 = dedupeReq(s3), d4 = dedupeReq(s4);
    /* 岗位职责：职能族优先，识别不出才退回行业模板。
       v0.9.6 起每族职责池扩到 8 条，由 pickDuties 按子方向挑最贴近的 6 条 ——
       与后端 engine.js 同一套规则、同一份词库，保证离线/在线产出一致。 */
    const dutyPicked = (RL && RL.pickDuties) ? RL.pickDuties(fn, title, [...uMust, ...uNice], 6) : [];
    let dutyList = dutyPicked.length ? dutyPicked : (JD_DUTY_TPL[industry] || JD_DUTY_TPL['通用']);
    /* 行业语境句（v0.9.7）：职能给「职责骨架」，行业补一句「盯什么指标、
       说什么行话」；与已选职责去重后追加。与后端 engine.js 同源规则 + 同一份
       词库，保证离线 / 在线产出一致。 */
    if (dutyPicked.length && RL && RL.industryDuty) {
      const ctx = RL.industryDuty(industry, dutyPicked, fnKey);
      if (ctx) dutyList = dutyPicked.concat([ctx]);
    }
    return {
      must: [...d1, ...d2, ...d3], soft: [...general, ...softSelf], nice: niceOut,
      fnKey: fnKey, fnName: fn ? fn.name : null, source: fn ? 'function' : 'industry', junior: junior,
      duties: dutyList,
      /* 整段 JD 粘进来时才有值：引言与职责按原文归位（同后端 engine.js） */
      lead: blob.lead, userDuties: blob.duty, userBenefits: blob.benefit, headings: blob.heads,
      dims: [{ name: '专业技能', items: d1 }, { name: '工作经验', items: d2 }, { name: '学历背景', items: d3 },
        { name: '综合素质', items: general }, { name: '软技能', items: softSelf }]
    };
  }
  /* 维度小标题 + 自然行文段落（v0.9.8 起不再逐条编号）
     为什么改：逐条编号 + 每条半句，读起来是「零散堆砌」；同一维度的若干要求
     本来就是一整段话的并列成分，用「；」串起来即可。实现只在 shared/req-lib.js。 */
  function renderReqs(dims) {
    const RL = window.ReqLib;
    if (RL && RL.renderReqDims) return RL.renderReqDims(dims);
    const out = [];
    (dims || []).forEach((d, i) => {
      if (!d.items || !d.items.length) return;
      out.push('**（' + (i + 1) + '）' + d.name + '**', d.items.join('；') + '。', '');
    });
    if (out.length) out.pop();
    return out;
  }
  const BIAS_RULES = [
    [/限?男性|仅限男|男生优先|只招男|男士优先/, '男性限定', '《就业促进法》第 27 条：招聘不得以性别为由拒绝录用或提高录用标准。', '删除性别限定，改为岗位真实需要的条件（如「需适应倒班／可搬运 20kg 物料」）'],
    [/限?女性|仅限女|女生优先|只招女|女士优先/, '女性限定', '性别不属岗位胜任要件，写入即构成就业歧视。', '删除性别限定，改为与工作内容直接相关的能力要求'],
    [/已婚已育|已婚优先|要求已婚|须已婚/, '婚育状况要求', '以婚育状况作为录用条件构成就业歧视，也易引发三期内权益争议。', '整句删除，招聘环节不得询问或要求婚育信息'],
    [/未婚优先|优先考虑未婚/, '婚姻状况偏好', '婚姻状况与岗位胜任力无关，属于就业歧视范畴。', '整句删除'],
    [/\d{2}\s*岁?(以下|以内)|年龄\s*\d{2}\s*[-—~]\s*\d{2}\s*岁|限\s*\d{2}\s*岁|年龄不超过\s*\d{2}/, '年龄限制', '除特殊工种法定限制外，设置年龄门槛构成年龄歧视。', '删除年龄区间，改为「具备 X 年以上相关经验」的能力口径'],
    [/仅限本地户口|本地户口优先|不招外地人|限京籍/, '户籍限制', '以户籍限制就业违反平等就业原则。', '删除户籍要求；如需处理社保关系，可在入职环节说明办理方式'],
    [/仅限\s*985|仅限\s*211|985\s*\/\s*211|统招全日制本科/, '院校／学历形式限定', '限定毕业院校层次或统招形式，属不合理的差别对待。', '改为「本科及以上学历，专业能力突出者可放宽」，按能力而非学校出身评估'],
    [/无(残疾|传染性疾病)|不招残疾人|身体健康.{0,8}(无残疾|无疾病)/, '身体状况歧视', '除岗位确有特殊健康要求外，排斥残障人士违反平等就业规定。', '删除该表述；如岗位存在法定健康标准，须明确写出依据与范围'],
    [/形象好|气质佳|五官端正|形象气质佳|身高\s*1[5-9]\d/, '外貌／身高要求', '除确有职业需要（如模特、演员），外貌身高要求构成就业歧视。', '删除，改为岗位真正需要的沟通表达或体力要求'],
    [/不要.{0,3}(河南|东北|安徽|某省)|某省人勿投/, '地域歧视', '按地域排斥求职者构成就业歧视，且可能引发舆情风险。', '整句删除'],
    [/不招.{0,4}(应届|35|女性|残疾人)/, '群体排斥表述', '对特定群体的一票否决表述构成就业歧视。', '删除，改为对岗位胜任力的客观描述']
  ];
  const LEGAL_RULES = [
    [/试用期.{0,8}(不缴|不交|无需缴|无需缴纳).{0,5}社保|转正后.{0,6}再缴社保/, '试用期不缴社保', '《社会保险法》第 58 条：自用工之日起 30 日内应办理社保登记，试用期同样必须缴纳。', '改为「入职即依法缴纳五险一金」'],
    [/(不签|无需签|免签).{0,5}(劳动)?合同|转正后.{0,4}签合同/, '不签订劳动合同', '《劳动合同法》第 10 条：建立劳动关系即应订立书面劳动合同（超 1 个月未签需付双倍工资）。', '改为「入职当日签订书面劳动合同」'],
    [/押金|保证金|风险金|扣押.{0,5}(身份证|证件|毕业证)/, '收取押金／扣押证件', '《劳动合同法》第 9 条：不得要求劳动者提供担保或以其他名义收取财物，不得扣押证件。', '删除，改为「入职材料仅核验原件并留存复印件」'],
    [/加班.{0,6}(无|没有|不发).{0,5}(加班费|加班工资)|自愿放弃.{0,5}(加班费|社保)|无加班费/, '不支付加班费', '《劳动法》第 44 条：延长工作时间应支付加班工资或依法安排调休。', '改为「加班依法支付加班费或安排调休」'],
    [/月休\s*[1-4]\s*天|每周工作\s*6\s*天|每周单休|单休制/, '超法定工时', '《劳动法》第 36 条：每日工作不超 8 小时、平均每周不超 44 小时。', '改为「标准工时制，周末双休」'],
    [/离职.{0,8}(扣|罚).{0,5}(工资|押金)|擅自离职.{0,6}(不发|扣发)工资/, '离职扣发工资', '劳动报酬不得以离职为由克扣，此类条款无效。', '整句删除；如需约定服务期，须符合《劳动合同法》第 22 条'],
    [/工伤.{0,8}(概不负责|与公司无关|自行承担|自负)/, '工伤免责约定', '工伤为法定责任，约定免除无效，属典型无效条款。', '删除，改为「依法为员工缴纳工伤保险」'],
    [/试用期.{0,6}(不合格|不通过).{0,6}不(支付|发).{0,2}工资/, '试用期不发工资', '违法：试用期工资不得低于约定工资的 80%，且不得低于当地最低工资标准。', '改为「试用期工资按约定标准的 100% 发放」'],
    [/(女员工|女职工).{0,10}(入职.{0,4}不|承诺.{0,4}不)生育|三年内.{0,4}不得生育/, '限制生育', '限制生育权违反《妇女权益保障法》，此类约定无效。', '整句删除']
  ];
  function scanJD(text) {
    const flagged = [], legal = [];
    String(text || '').split('\n').forEach((line, i) => {
      BIAS_RULES.forEach(([re, word, why, fix]) => { if (re.test(line)) flagged.push({ word, why, fix, line: i + 1, hit: line.trim().slice(0, 60) }); });
      LEGAL_RULES.forEach(([re, word, why, fix]) => { if (re.test(line)) legal.push({ word, why, fix, line: i + 1, hit: line.trim().slice(0, 60) }); });
    });
    return { flagged, legal };
  }

  function generateJD(input) {
    const title = (input.title || '').trim() || '待填写岗位';
    const industry = input.industry || '通用';
    const dept = input.dept || '待填写部门';
    /* 任职要求：在已填内容基础上，按六维度扩充（同后端 engine.js 规则） */
    const reqs = expandReqs({ title, industry, dept, years: input.years, eduRank: input.eduRank, must: input.must, nice: input.nice });
    /* 「岗位职责」栏（v13）：HR 单独填写、优先级最高的职责来源（与后端 runJD 同口径） */
    let userDutyItems = [];
    if (input.duty && String(input.duty).trim() && window.ReqLib && window.ReqLib.parseReqText) {
      const dp = window.ReqLib.parseReqText(String(input.duty));
      const raw = (dp.heads ? dp.duty : dp.must).map(s => String(s).trim()).filter(Boolean);
      userDutyItems = raw.map(t => (window.ReqLib.polishMustItem ? window.ReqLib.polishMustItem(t) : t)).filter(Boolean);
    }
    /* 岗位职责同样「职能优先」：职责模板由 expandReqs 按职能族给出，识别不出才退回行业模板。
       若 HR 整段粘进来一份 JD 且写了「你会做什么」，以 HR 自己写的为准（≥3 条不再叠加模板）。 */
    const uDutySource = userDutyItems.length ? userDutyItems : (reqs.userDuties || []);
    const uDuty = uDutySource.map(d => String(d).replace('{title}', title));
    const tplDuty = (reqs.duties || (JD_DUTY_TPL[industry] || JD_DUTY_TPL['通用']))
      .map(d => d.replace('{title}', title).replace('{dept}', dept));
    const duties = !uDuty.length ? tplDuty
      : uDuty.length >= 3 ? uDuty
        : uDuty.concat(tplDuty.slice(0, Math.max(0, 6 - uDuty.length)));
    /* 引言：粘贴进来的 JD 首段（「我们在找一个…那我们在等你。」）*/
    const leadParas = (reqs.lead || []).slice(0, 3);
    const leadText = leadParas.length ? (window.ReqLib && window.ReqLib.paragraphize ? window.ReqLib.paragraphize(leadParas) : leadParas.join('')) : '';
    const benefits = (input.benefits && input.benefits.length) ? input.benefits
      : ['依法足额缴纳五险一金', '弹性工作制（10:00 前到岗，当日工作满 8 小时）', '带薪年假、法定节假日按国家规定执行'];
    const jd = [
      `# ${title}`, '',
      `**所属部门**：${dept}　|　**工作地点**：北京　|　**招聘人数**：${input.headcount || 1} 人`,
      `**薪资范围**：${input.salary || '面议'}　|　**岗位类型**：全职　|　**行业**：${industry}`, '',
      ...(leadText ? [leadText, ''] : []),
      '## 一、岗位职责',
      ...duties.map((d, i) => `${i + 1}. ${d}`), '',
      '## 二、任职要求',
      ...renderReqs(reqs.dims), '',
      '## 三、加分项',
      (reqs.nice.length ? (window.ReqLib && window.ReqLib.paragraphize ? window.ReqLib.paragraphize(reqs.nice) : reqs.nice.join('；') + '。') : '暂无特别加分项，如有相关经历欢迎在面试中说明。'), '',
      '## 四、我们提供',
      ...benefits.map(b => `- ${b}`), '',
      '## 五、平等就业机会声明',
      '本公司为所有求职者提供平等就业机会。招聘与录用不因性别、年龄、民族、宗教信仰、婚育状况、户籍、地域、院校背景、身体残障等因素而区别对待。',
      '我们承诺：本岗位描述不含任何歧视性用语，所有录用决定均基于岗位胜任力作出。'
    ].join('\n');
    const scan = scanJD(jd);
    /* 打分关键词：用与后端同源的抽取逻辑（职能族 ∪ 行业词库），保证离线/在线抽出的词一致 */
    const keywords = window.ReqLib
      ? window.ReqLib.extractKeywords([...reqs.must, ...reqs.nice], INDUSTRY_CORE)
      : [];
    return { jd, flagged: scan.flagged, legal: scan.legal, must: reqs.must, soft: reqs.soft, nice: reqs.nice, dims: reqs.dims,
      duties, userDuties: uDutySource,
      fnKey: reqs.fnKey, fnName: reqs.fnName, reqSource: reqs.source, junior: !!reqs.junior,
      keywords, industry, title };
  }

  /* ============ 简历打分（规则 + 关键词模拟） ============
     修正记录：旧版这里写死了一份 Java 技术词表（java/spring/kafka/mysql…），
     岗位要求只用来判「学历 / 年限」两个闸门，**技术关键词完全不跟着岗位走**。
     后果：任何非 Java 岗位的简历都是 0/40 —— 把一份 AI 产品经理简历
     （正文明确写着 LLM、RAG、Agent、Prompt）拿去评「了解LLM RAG」的岗位，
     技能匹配 0 分，总分 16，判「不合适」。这不叫严格，叫尺子拿错了。

     现在：岗位关键词一律从「岗位硬性要求」里抽，复用 shared/req-lib.js
     （与 server/engine.js 同源），四个维度的映射口径也与后端 scoreOne 对齐：
       技能匹配 = 命中岗位关键词的比例 → 系数
       业务匹配 = 命中的业务域标签条数
       稳定性   = 工作年限 vs 岗位要求年限
       加分项   = 开源 / 专利 / 带人 / 大厂等标签条数
     ============================================================ */
  /* 通用加分标签：与岗位无关的「额外亮点」，短词形态，可直接在简历原文里检索 */
  const PLUS_GENERIC = ['开源', 'GitHub', '专利', '论文', '大厂', '团队管理', '带团队',
    '技术负责人', 'star', '内推', '从 0 到 1', '获奖', '一等奖', '认证', '标杆'];

  function scoreResume(text, jobMust) {
    const t = String(text || '');
    const req = String(jobMust || '');
    const RL = window.ReqLib;
    const hit = (hay, needle) => RL ? RL.kwContains(hay, needle)
      : hay.toLowerCase().indexOf(String(needle).toLowerCase()) >= 0;
    const hitAny = (pool) => pool.filter(w => hit(t, w) || hit(w, t));

    /* ① 岗位关键词：抽自岗位硬性要求（词库术语 + 拉丁技术名词兜底） */
    const kws = RL ? RL.extractKeywords([req]) : [];
    const kHit = kws.filter(w => hit(t, w));
    const coverage = kws.length ? kHit.length / kws.length : 0;
    /* 系数一律取自 shared/score-why.js 的阶梯（与后端同一份）。
       写死在这里的后果：阶梯改了它不改，界面上「为什么是这个分」就开始说谎。 */
    const SW = window.ScoreWhy;
    const r1 = SW ? SW.coefOf('skill', coverage)
      : (coverage >= 0.7 ? 0.95 : coverage >= 0.5 ? 0.85 : coverage >= 0.35 ? 0.7 : coverage >= 0.2 ? 0.55 : 0.35);
    const s1 = Math.round(40 * r1);

    /* ② 业务语境标签：取岗位所属职能族的业务标签（AI 产品经理 ≠ 后端研发） */
    const fnKey = RL ? RL.detectFunction('', req) : null;
    const fn = (fnKey && RL) ? RL.FUNCTIONS[fnKey] : null;
    const bizPool = fn ? fn.biz : [];
    const bizHits = hitAny(bizPool);
    const r2 = SW ? SW.coefOf('biz', bizHits.length)
      : (bizHits.length >= 4 ? 1 : bizHits.length === 3 ? 0.9 : bizHits.length === 2 ? 0.72 : bizHits.length === 1 ? 0.55 : 0.2);
    const s2 = Math.round(30 * r2);

    /* ③ 加分项：职能族加分项 + 通用亮点标签 */
    const plusPool = [...(fn ? fn.plus : []), ...PLUS_GENERIC];
    const plusHits = hitAny(plusPool);
    const r4 = SW ? SW.coefOf('plus', plusHits.length)
      : (plusHits.length >= 3 ? 1 : plusHits.length === 2 ? 0.85 : plusHits.length === 1 ? 0.55 : 0);
    const s4 = Math.round(15 * r4);

    /* ④ 稳定性：年限（岗位不设年限门槛时按 0.8 计，与后端一致）
       识别顺序：明确的「N 年经验」→ 文本里的 N 年（0<N<60，排除「2018 年毕业」这类年份）
       → 起止年份推算（2018-2022 / 2022 至今）。
       旧版只做 /(\d+)\s*年/，会把「2018 年毕业」读成 2018 年工作经验。 */
    const cleanYears = (v) => { const n = parseFloat(v); return (n > 0 && n < 60) ? n : 0; };
    const explicit = t.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?[^。\n；;]{0,8}?(?:经验|经历)/);
    let years = explicit ? cleanYears(explicit[1]) : 0;
    if (!years) {
      const cands = [...t.matchAll(/(\d+(?:\.\d+)?)\s*年/g)].map(x => cleanYears(x[1])).filter(Boolean);
      years = cands.length ? Math.max(...cands) : 0;
    }
    if (!years) {
      let sum = 0;
      [...t.matchAll(/((?:19|20)\d{2})\s*[-–—~至到]\s*((?:19|20)\d{2}|至今|现在|今)/g)].forEach(x => {
        const a = +x[1], b = /^\d{4}$/.test(x[2]) ? +x[2] : 2026;
        if (b > a && b - a < 40) sum += b - a;
      });
      years = sum;
    }
    const ny = req.match(/(\d+)\s*年/);
    const needMust = ny ? parseFloat(ny[1]) : 0;
    const r3 = SW ? SW.coefOf('stab', years, needMust)
      : (needMust <= 0 ? 0.8 : years >= needMust * 2 ? 1 : years >= needMust * 1.3 ? 0.87 : years >= needMust ? 0.75 : 0.5);
    const s3 = Math.round(15 * r3);

    const eduRank = /博士|硕士|研究生/.test(t) ? 3 : /本科|学士/.test(t) ? 2 : /大专|专科/.test(t) ? 1 : 0;
    const needEdu = /本科/.test(req) ? 2 : /大专|专科/.test(req) ? 1 : 0;

    // 硬性门槛：规则判定，不调模型（命中即出局，不进入逐维打分）
    if (needMust && years && years < needMust)
      return { gate: true, reason: `工作年限 ${years} 年 < 岗位要求 ${needMust} 年（规则判定，未调用模型）`, score: 0, grade: 'no', dims: [], hits: { kws, kHit, bizHits, plusHits } };
    if (eduRank && needEdu && eduRank < needEdu)
      return { gate: true, reason: `学历不满足硬性要求（要求 ${needEdu === 2 ? '本科' : '大专'}及以上，规则判定）`, score: 0, grade: 'no', dims: [], hits: { kws, kHit, bizHits, plusHits } };

    /* 相关性门槛（v16）：岗位抽出了关键词，但简历一个都没命中 → 出局。
       与后端 server/engine.js:skillGate 同一口径 —— 两边必须一起改，否则同一份简历
       在离线演示与在线筛选下会得到不同档位。离线端只能看简历原文，所以
       「简历有没有列技能」由关键词抽取侧保证；条件同样保守：kws 为空时不触发。 */
    if (kws.length && !kHit.length)
      return { gate: true, reason: `岗位要求的 ${kws.length} 个关键词（${kws.slice(0, 4).join('、')}）在简历中一个都未命中（规则判定，未调用模型）`, score: 0, grade: 'no', dims: [], hits: { kws, kHit, bizHits, plusHits } };

    const total = Math.min(100, s1 + s2 + s3 + s4);
    const 在读 = /在读|应届|在校|实习|202\d\s*[/\-．.]\s*\d+\s*[-–—]\s*202\d/.test(t);
    const dims = [
      { dim: '技能匹配', score: s1, max: 40, coef: r1,
        ev: !kws.length
          ? '岗位要求里没识别出可打分的技术词，本维度按底分计（建议在要求里写明技术栈）'
          : kHit.length
            ? `命中岗位关键词 ${kHit.length}/${kws.length} 项：${kHit.slice(0, 6).join('、')}`
            : `命中岗位关键词 0/${kws.length} 项（${kws.slice(0, 4).join('、')}）—— 完全未命中，本维度按底分计` },
      { dim: '业务匹配', score: s2, max: 30, coef: r2,
        ev: bizHits.length ? `业务语境命中：${bizHits.join('、')}` : `未命中${fnKey ? RL.FUNCTIONS[fnKey].name : ''}类业务标签，本维度按底分计` },
      { dim: '稳定性', score: s3, max: 15, coef: r3,
        ev: years ? `总工作年限约 ${years} 年（岗位要求 ${needMust || '未设'} 年）`
          : 在读 ? `在校生 / 应届，简历无全职工作年限（岗位要求 ${needMust || '未设'} 年）`
            : `简历未体现工作年限（岗位要求 ${needMust || '未设'} 年），按未达标计` },
      { dim: '加分项', score: s4, max: 15, coef: r4, ev: plusHits.length ? plusHits.join('、') : '无开源/专利/大厂/带人经验' }
    ];
    /* 归因（「为什么是这个分」）。与后端 scoreOne 调的是同一份 explain()，
       所以同一个分数在两个入口下的解释不会出现两套说法。 */
    const why = SW ? SW.explain({
      score: total, dims,
      ctx: {
        kws, kHit, cov: coverage,
        fnName: fn ? fn.name : '',
        bizHits, bizPool, plusHits, plusPool,
        years, needYears: needMust, inSchool: 在读,
      },
    }) : null;
    return { gate: false, score: total, grade: total >= 78 ? 'strong' : total >= 60 ? 'ok' : 'no', dims, why, hits: { kws, kHit, bizHits, plusHits } };
  }

  /* ============ 员工自助问答引擎 ============ */
  /* 员工本人数据（离线演示固定值，与后端 seed 的 U-003 视角一致；口径与 engine.js 同源） */
  const SELF_DATA = {
    U003: {
      leave:      { annualRemain: '3.5', annualCarry: '2.0', compRemain: '1.5' },
      attendance: { month: '2026-09', normal: 22, actual: 21, late: 1, absent: 0,
                    abnormal: [{ date: '2026-09-12', type: '迟到', note: '09:58 打卡，迟到 2 分钟' }] },
      payslip:    { month: '2026-09', gross: 21800, deductions: 3680, net: 18120, payment: '2026-10-10',
                    path: 'OA → 我的薪资 → 薪资条（选择 2026-09 月）' },
      social:     { month: '2026-09', base: 24000, items: [
                      { cat: '养老', personal: 1920, company: 3840 },
                      { cat: '医疗', personal: 480, company: 1920 },
                      { cat: '失业', personal: 120, company: 120 },
                      { cat: '公积金', personal: 2880, company: 2880 },
                    ] },
    },
  };

  /* 制度解释类知识（policy）：仅承载「制度规则」，不承载个人数字。
     个人数字（年假/调休/考勤/薪资/社保）一律走 personal 查本人数据，与后端事实分层铁律一致。 */
  const KB = [
    { k: ['报销', '发票', '差旅', '出差'], route: 'policy', src: '《员工手册（2026 修订版）》v3.2 第 6 章', eff: '2026-01-01',
      ans: () => `报销流程：在 OA 提交报销单 → 上传发票原件照片 → 直属上级审批 → 财务复核 → 每月 25 日统一打款。
差旅需提前提交出差申请，未经审批的差旅费用原则上不予报销。
发票抬头请填写公司全称，个人抬头发票无法报销。` },
    { k: ['试用期', '转正'], route: 'policy', src: '《试用期与转正管理规定》v1.4 第 2、3 章', eff: '2026-03-01',
      ans: () => `试用期为 3 个月（特殊岗位可约定 6 个月）。试用期工资按约定标准的 100% 发放。
转正流程：试用期结束前 15 天，系统自动提醒直属上级发起转正考核；考核通过后次月 1 日转正。
如需延长试用期，须在到期前 7 天由直属上级提出申请并经 HRD 审批，且延长后总时长不得超过法定上限。` },
    { k: ['加班', '调休怎么', '调休规则', '加班怎么'], route: 'policy', src: '《考勤与加班管理办法》v2.1 第 2、4 章', eff: '2026-05-01',
      ans: () => `公司实行弹性工作制：每个工作日 10:00 前打卡到岗，当日工作满 8 小时即可。
加班需提前在系统提交申请，经直属上级审批后生效；加班可申请调休，调休需在 3 个月内使用。
每月迟到累计 3 次以上将影响当月考勤考核评分。` },
  ];
  const REFUSE = [
    { k: ['仲裁', '起诉', '劳动纠纷', '违法解除', '律师', '劳动法', '工伤赔偿', '索要赔偿'], type: '法律意见',
      msg: '这个问题涉及劳动关系法律判断，超出我的授权范围，我不能给出意见（避免给你造成误导）。已为你转接 HR，并同步法务同事跟进。' },
    { k: ['涨薪', '谈薪', '加薪', '调薪', '降薪', '薪资调整', '薪资谈判'], type: '薪酬个案',
      msg: '薪资调整属于个案沟通事项，需要结合你的岗位、绩效与公司政策综合判断，不适合由我直接回答。已为你转接你的 HRBP，通常在 1 个工作日内联系你。' },
    { k: ['张三', '李四', '王五', '赵六', '某某', '别人的', '他人的', '其他人的', '同事的'], type: '他人隐私',
      msg: '我只能查询你本人的数据，无法查询或推算其他同事的任何信息（这是制度与法律的硬性要求，不是权限设置问题）。如需了解相关制度，我可以为你解释。' }
  ];

  /* 个人数据意图识别：与后端 engine.js 的 detectPersonalIntent 同源。 */
  function detectPersonalIntent(q) {
    if (/年假|假期余额|剩.*天.*假|调休余额|我的调休|还剩.*调休|几天调休|调休几|带薪假|年假余额/.test(q)) return 'leave';
    if (/考勤|迟到|缺勤|漏打卡|打卡.*(异常|记录)|本月考勤|出勤|旷工/.test(q)) return 'attendance';
    if (/薪资条|工资条|到手|实发|发了多少|这个月.*(发|工资)|上月.*(发|工资)|几号发.*(工资|薪)|我的.*(工资|薪资)/.test(q)) return 'payslip';
    if (/社保|公积金|五险一金|缴纳|基数|参保|交社保/.test(q)) return 'social';
    return null;
  }

  /* 主动提醒意图识别：与后端 engine.js 的 detectAlertIntent 同源。 */
  function detectAlertIntent(q) {
    if (/提醒|待办|预警|要注意|到期|清零|别忘了|待办事项|我要注意|有什么.*(提醒|待办)|近期.*(安排|事项)|我该.*(做|办)/.test(q)) return true;
    return false;
  }

  function classify(q) {
    if (REFUSE.some(r => r.k.some(k => q.indexOf(k) > -1))) return 'refuse';
    if (detectAlertIntent(q)) return 'alert';
    if (detectPersonalIntent(q)) return 'personal';
    if (KB.some(b => b.k.some(k => q.indexOf(k) > -1))) return 'policy';
    return 'nomatch';
  }

  function answer(q) {
    const route = classify(q);
    if (route === 'refuse') {
      const r = REFUSE.find(r => r.k.some(k => q.indexOf(k) > -1));
      return { route: 'escalated', type: r.type, text: r.msg,
        foot: '已转人工 · 记录到「未解答问题」不适用（属于授权范围外，已按规则分流）',
        cites: [] };
    }
    if (route === 'alert') {
      const d = SELF_DATA.U003;
      const annualRemain = d.leave.annualRemain;
      const compRemain = d.leave.compRemain;
      const carry = d.leave.annualCarry || 0;
      const today = new Date();
      const yearEnd = new Date(today.getFullYear(), 11, 31);
      const daysToYearEnd = Math.max(0, Math.ceil((yearEnd - today) / 86400000));
      const lines = ['📌 你的近期待办提醒（以下数字来自 HR 系统实时数据，非文档说明）：'];
      if (carry > 0) lines.push(`· 年假结转 ${carry} 天将于 ${today.getFullYear()}-12-31 清零，还剩约 ${daysToYearEnd} 天，请尽快安排休假，逾期清零不补。`);
      else lines.push(`· 年假剩余 ${annualRemain} 天（本年度额度，无结转待清）。`);
      lines.push(`· 调休剩余 ${compRemain} 天，调休自加班日起 3 个月内有效，逾期自动失效，建议尽快申请使用。`);
      lines.push(`· 试用期：按《试用期与转正管理规定》为 3 个月，到期前 15 天系统会自动提醒你的上级发起转正考核（演示数据未记录入职日期，无法计算具体到期日）。`);
      return { route: 'alert', text: lines.join('\n'),
        cites: [{ t: '《假期管理制度》v2.6 第 3 章', eff: '2026-04-01', note: '数字来源：HR 系统实时查询（权威事实）' }],
        badge: '🔔 主动提醒（基于本人实时数据）' };
    }
    if (route === 'personal') {
      const intent = detectPersonalIntent(q);
      const d = SELF_DATA.U003;
      let text, src, eff;
      if (intent === 'leave') {
        text = `你当前年假余额为 ${d.leave.annualRemain} 天（2026 年度剩余 ${d.leave.annualRemain} 天${d.leave.annualCarry ? ` + 上年度结转 ${d.leave.annualCarry} 天，结转部分需在本年度 12 月 31 日前使用` : ''}）。\n调休余额为 ${d.leave.compRemain} 天（加班换休，3 个月内有效）。\n（以上数字来自 HR 系统实时查询，不是文档说明）`;
        src = '《假期管理制度》v2.6 第 3 章'; eff = '2026-04-01';
      } else if (intent === 'attendance') {
        const a = d.attendance;
        const ab = a.abnormal.length
          ? `异常明细：${a.abnormal.map(x => `${x.date} ${x.type}（${x.note}）`).join('；')}`
          : '本月无异常记录。';
        text = `你最近考勤（${a.month}）：应出勤 ${a.normal} 天，实际 ${a.actual} 天，迟到 ${a.late} 次${a.absent ? `，缺勤 ${a.absent} 天` : ''}。\n${ab}\n（以上数字来自 HR 系统实时查询）`;
        src = '《考勤与加班管理办法》v2.1'; eff = '2026-05-01';
      } else if (intent === 'payslip') {
        const p = d.payslip;
        text = `你的薪资条可在「${p.path}」查看。\n最近一期（${p.month} 月）：应发 ${p.gross} 元，扣款 ${p.deductions} 元，实发 ${p.net} 元，已于 ${p.payment} 打款。\n（以上数字来自 HR 系统实时查询，不是文档说明）`;
        src = '薪资条（HR 系统）'; eff = p.payment;
      } else if (intent === 'social') {
        const ssn = d.social;
        text = `你最近社保缴纳（${ssn.month} 月，基数 ${ssn.base} 元）：\n` +
          ssn.items.map(x => `· ${x.cat}：个人缴 ${x.personal} 元，单位缴 ${x.company} 元`).join('\n') +
          `\n（以上数字来自 HR 系统实时查询）`;
        src = '《社保公积金缴纳说明（北京）》v1.9'; eff = '2026-07-01';
      }
      return { route: 'personal_data', text,
        cites: [{ t: src, eff, note: '数字来源：HR 系统实时查询（权威事实）' }],
        badge: '🔎 已查询 HR 系统实时数据' };
    }
    if (route === 'policy') {
      const b = KB.find(x => x.k.some(k => q.indexOf(k) > -1));
      return { route: 'policy', text: b.ans(),
        cites: [{ t: b.src, eff: b.eff, note: '回答完全基于该文档，未做任何推断' }],
        badge: '📚 已检索企业知识库' };
    }
    return { route: 'no_match', text: `我在公司制度文档里没有找到与「${q}」相关的内容，为避免给你错误信息，我不做推测回答。
你可以选择：① 点击下方「转人工」由 HR 答复；② 换个说法再问一次；③ 试着问我这些我能准确回答的问题：
  · 我的年假 / 调休还剩多少天
  · 我最近的考勤怎么样
  · 我的薪资条在哪看
  · 报销流程是怎样的
  · 试用期 / 转正有什么规定
  · 有什么要提醒我的（待办 / 到期 / 清零）
你这次的问题已被记录，HR 会据此补充知识库。`,
      cites: [], badge: '⚠️ 知识库无匹配（相似度低于阈值 0.55）' };
  }

  return { PLANS, run, generateJD, expandReqs, renderReqs, INDUSTRY_CORE, INDUSTRY_REQ, scoreResume, answer, classify, sleep, splitJdFields };
})();
