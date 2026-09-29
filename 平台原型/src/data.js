/* ===========================================================
   HR-Agent OS · 模拟数据层（Mock Data）
   真实系统中这些数据来自后端接口；原型里全部本地生成，
   用于演示「Agent 读数据 → 判断 → 人工确认」的完整链路。
   时间口径：北京时间（UTC+8），列表一律时间倒序。
   =========================================================== */
window.DB = (function () {

  const tenant = {
    name: '示例科技（600 人）',
    plan: 'Pilot 试用版',
    region: '数据存境内 · cn-north',
    me: { name: '李静', role: 'HRD（人力资源总监）', roleKey: 'hrd', dept: '/人力资源中心' }
  };

  /* ---------- 岗位（离线演示数据；真实岗位库在后端 SQLite，可自建） ---------- */
  const jobs = [
    {
      id: 'J-118', title: '高级 Java 工程师', dept: '/技术中心/后端组', industry: '互联网',
      mustHave: { years: 3, edu: '本科' },
      mustHaveText: ['3 年以上 Java 开发经验', '本科及以上学历', '熟悉 Spring 生态与 MySQL'],
      niceHave: ['高并发/分布式经验', '开源项目贡献', '技术团队管理经验'],
      keywords: ['Java', 'MySQL', '高并发', '分布式', '开源项目'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '25-40K·14薪', headcount: 2,
      status: '招聘中', applicants: 6, pending: 6, openedAt: '2026-09-08'
    },
    {
      /* 职能族 vs 行业的回归样例：互联网行业 + 产品职能。
         离线模式下它的 JD 由 Agent.generateJD 按「产品」职能族生成，
         不应出现 Java / Spring 这类技术栈技能。 */
      id: 'J-126', title: 'AI 产品经理', dept: '/产品中心/AI 产品组', industry: '互联网',
      mustHave: { years: 3, edu: '本科' },
      mustHaveText: ['3 年以上 AI 产品经验', '本科及以上学历', '熟悉需求分析、PRD 撰写与模型评测'],
      niceHave: ['有大模型 / Agent 产品落地经验', '具备 SQL 或数据分析能力', '有从 0 到 1 立项经历'],
      keywords: ['需求分析', 'PRD 撰写', '模型评测', 'SQL', '数据分析'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '25-40K·14薪', headcount: 1,
      status: '招聘中', applicants: 3, pending: 3, openedAt: '2026-09-14'
    },
    {
      id: 'J-121', title: 'HRBP（技术线）', dept: '/人力资源中心', industry: '人力资源',
      mustHave: { years: 2, edu: '本科' },
      mustHaveText: ['2 年以上 HRBP 经验', '本科及以上学历', '支持过技术团队'],
      niceHave: ['组织发展项目经验', '人才盘点与绩效体系搭建', '数据分析能力'],
      keywords: ['HRBP', '组织发展', '人才盘点', '绩效管理'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '15-22K·14薪', headcount: 1,
      status: '招聘中', applicants: 2, pending: 2, openedAt: '2026-09-15'
    },
    {
      id: 'J-130', title: '生产车间主管', dept: '/制造中心/装配车间', industry: '制造业',
      mustHave: { years: 3, edu: '大专' },
      mustHaveText: ['3 年以上制造业车间管理经验', '大专及以上学历', '熟悉精益生产与 5S 现场管理'],
      niceHave: ['六西格玛绿带及以上', '产线改造或降本增效项目经验'],
      keywords: ['精益生产', '5S', '班组长管理', '安全生产'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '12-18K·13薪', headcount: 2,
      status: '招聘中', applicants: 5, pending: 5, openedAt: '2026-08-20'
    },
    {
      id: 'J-150', title: '护理主管', dept: '/医疗中心/护理部', industry: '医疗健康',
      mustHave: { years: 4, edu: '大专' },
      mustHaveText: ['4 年以上临床护理经验', '大专及以上学历', '熟悉护理质控与院感控制'],
      niceHave: ['主管护师及以上职称', '护理团队带教经验'],
      keywords: ['护理管理', '院感控制', '护理质控', '临床护理'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '11-16K·13薪', headcount: 1,
      status: '招聘中', applicants: 3, pending: 3, openedAt: '2026-07-28'
    },
    {
      id: 'J-140', title: '门店店长', dept: '/零售运营中心/华北区', industry: '零售连锁',
      mustHave: { years: 3, edu: '大专' },
      mustHaveText: ['3 年以上门店管理经验', '大专及以上学历', '有独立带店与销售达成经验'],
      niceHave: ['新店开业经验', '会员运营体系搭建'],
      keywords: ['门店运营', '团队管理', '销售达成'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '9-14K+提成', headcount: 3,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-08-15'
    },
    {
      id: 'J-170', title: '风控专员', dept: '/风险管理部/信贷风控组', industry: '金融',
      mustHave: { years: 2, edu: '本科' },
      mustHaveText: ['2 年以上信贷审核或风控经验', '本科及以上学历', '熟悉风险识别与反欺诈手段'],
      niceHave: ['掌握 SQL 与风控建模', '持 FRM 或 CPA 证书'],
      keywords: ['风险识别', '信贷审核', '反欺诈', '数据分析'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '13-20K·14薪', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-05'
    },
    {
      id: 'J-160', title: '课程顾问', dept: '/教培事业部/销售部', industry: '教育培训',
      mustHave: { years: 1, edu: '大专' },
      mustHaveText: ['1 年以上教育行业销售或顾问经验', '大专及以上学历', '具备良好的客户沟通与转化能力'],
      niceHave: ['K12 或职业教育背景', '社群运营经验'],
      keywords: ['课程规划', '客户沟通', '续费转化', '试听转化'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '6-10K+提成', headcount: 4,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-12'
    },
    {
      id: 'J-180', title: '大客户销售经理', dept: '/销售中心/企业客户部', industry: '销售',
      mustHave: { years: 4, edu: '本科' },
      mustHaveText: ['4 年以上 B 端大客户销售经验', '本科及以上学历', '具备解决方案销售与商务谈判能力'],
      niceHave: ['有招投标项目经验', '工业品或企业软件行业资源'],
      keywords: ['大客户开发', '商务谈判', '解决方案销售', '招投标'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '15-25K+提成', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-08-08'
    },
    /* ---------- v0.9.6 新增：覆盖新拆出的职能族，离线演示也每族有岗 ---------- */
    {
      id: 'J-190', title: '法务专员', dept: '/法务部', industry: '专业服务',
      mustHave: { years: 2, edu: '本科' },
      mustHaveText: ['2 年以上企业法务或律所经验', '本科及以上学历，法学相关专业', '熟悉合同审核与法律风险识别'],
      niceHave: ['通过法律职业资格考试', '有知识产权或投融资项目法务经验'],
      keywords: ['合同审核', '法律意见出具', '知识产权', '合规审查'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '11-18K·14薪', headcount: 1,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-11'
    },
    {
      id: 'J-192', title: '数学教师', dept: '/教学中心/学科教研组', industry: '教育培训',
      mustHave: { years: 2, edu: '本科' },
      mustHaveText: ['2 年以上学科教学经验', '本科及以上学历，师范类或数学相关专业', '持教师资格证'],
      niceHave: ['有毕业班或竞赛辅导经验', '有在线课程或教研产品经验'],
      keywords: ['课程规划', '教学', '教研', '家校沟通'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '9-15K·13薪', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-13'
    },
    {
      id: 'J-194', title: '土建工程师', dept: '/工程管理部', industry: '建筑工程',
      mustHave: { years: 3, edu: '本科' },
      mustHaveText: ['3 年以上土建施工管理经验', '本科及以上学历，土木工程相关专业', '熟悉施工规范与工程质量验收标准'],
      niceHave: ['持一级或二级建造师证书', '有大型房建或市政项目经验'],
      keywords: ['施工组织设计', '工程造价', '施工质量控制', '安全文明施工'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '12-18K·13薪', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-08-25'
    },
    {
      id: 'J-196', title: '短视频编导', dept: '/内容中心/短视频组', industry: '传媒文化',
      mustHave: { years: 2, edu: '本科' },
      mustHaveText: ['2 年以上短视频内容制作经验', '本科及以上学历', '具备选题策划、脚本撰写与剪辑成片能力'],
      niceHave: ['有播放量百万级的作品案例', '有账号从 0 到 1 运营经验'],
      keywords: ['选题策划', '采访写作', '视频剪辑', '内容分发'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '10-18K·13薪', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-16'
    },
    {
      id: 'J-198', title: '物流调度主管', dept: '/物流中心/运输调度组', industry: '物流运输',
      mustHave: { years: 3, edu: '大专' },
      mustHaveText: ['3 年以上运输调度或物流管理经验', '大专及以上学历', '熟悉运输线路规划与承运商管理'],
      niceHave: ['熟悉 TMS／WMS 等物流系统', '有物流降本项目经验'],
      keywords: ['运输调度', '路线规划', '承运商管理', '物流成本控制'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '10-15K·13薪', headcount: 1,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-08-30'
    },
    {
      id: 'J-200', title: '厨师长', dept: '/餐饮运营部/中央厨房', industry: '酒店餐饮',
      mustHave: { years: 4, edu: '中专' },
      mustHaveText: ['4 年以上后厨管理经验', '中专及以上学历', '熟悉菜品出品标准与食品安全管理'],
      niceHave: ['有连锁餐饮标准化落地经验', '持食品安全管理员证'],
      keywords: ['菜品出品管理', '食品安全管理', '成本与毛利管控', '排班管理'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '10-16K·13薪', headcount: 1,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-08-18'
    },
    {
      id: 'J-202', title: '物业项目经理', dept: '/物业事业部/华北区域', industry: '物业管理',
      mustHave: { years: 3, edu: '大专' },
      mustHaveText: ['3 年以上物业项目管理经验', '大专及以上学历', '熟悉住宅或商业物业的运营与收费管理'],
      niceHave: ['持物业管理师或消防设施操作员证', '有创优或标杆项目经验'],
      keywords: ['物业项目运营', '设施设备维护', '物业费收缴', '消防安全管理'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '10-16K·13薪', headcount: 1,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-08-28'
    },
    {
      id: 'J-204', title: '医药代表', dept: '/销售中心/处方药事业部', industry: '医药健康',
      mustHave: { years: 1, edu: '大专' },
      mustHaveText: ['1 年以上医药推广或临床相关经验', '大专及以上学历，药学或临床相关专业优先', '熟悉合规推广要求'],
      niceHave: ['有医院或连锁药店渠道资源', '有新品准入或区域开发经验'],
      keywords: ['学术推广', '产品知识', '医院渠道', '临床数据解读'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '8-14K+提成', headcount: 3,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-17'
    },
    {
      id: 'J-206', title: '游戏数值策划', dept: '/游戏研发部/策划组', industry: '游戏',
      mustHave: { years: 2, edu: '本科' },
      mustHaveText: ['2 年以上游戏数值设计经验', '本科及以上学历', '熟悉成长曲线与付费数值设计'],
      niceHave: ['有已上线手游的完整项目经验', '有二次元或海外发行项目经验'],
      keywords: ['数值设计', '玩法设计', '版本规划', '玩家数据分析'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '15-25K·13薪', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-09'
    },
    {
      id: 'J-208', title: '光伏运维工程师', dept: '/新能源事业部/运维中心', industry: '能源电力',
      mustHave: { years: 2, edu: '大专' },
      mustHaveText: ['2 年以上光伏电站运维经验', '大专及以上学历，电气或新能源相关专业', '熟悉电气设备检修与安全规程'],
      niceHave: ['持高压电工或进网作业许可', '有储能系统运维经验'],
      keywords: ['变配电运维', '电气试验', '新能源（光伏／风电／储能）', '作业票管理'],
      rubric: { 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 },
      salary: '10-16K·13薪', headcount: 2,
      status: '招聘中', applicants: 0, pending: 0, openedAt: '2026-09-06'
    }
  ];

  /* ---------- 候选人（含 AI 打分结果与人工推翻记录） ---------- */
  const candidates = [
    /* --- AI 产品经理（J-126）的三档演示简历，用于验证「非技术岗不被技术栈词库污染」 --- */
    { id: 'C-3011', name: '林佳琪', job: 'AI 产品经理', gender: '女', birth: '1996-08', years: 4.5,
      edu: '硕士 · 某 985 院校 · 工业设计', company: '某大模型创业公司（2年3个月）',
      tags: ['需求分析', '模型评测', 'Badcase 归因', 'Prompt 工程', '数据分析'],
      phone: '139****3082', email: 'linjq***@example.com',
      score: 86, grade: 'strong', stage: '待人工复核', parseOk: true, source: 'BOSS直聘',
      reasons: [
        { dim: '技能匹配', score: 35, max: 40, ev: '主导对话产品评测体系搭建，Badcase 归因后意图识别准确率从 82% 提升至 94%' },
        { dim: '业务匹配', score: 26, max: 30, ev: '2 年多大模型应用产品经验，覆盖需求定义到上线复盘的完整链路' },
        { dim: '稳定性', score: 13, max: 15, ev: '两段经历均 ≥ 2 年，无频繁跳槽' },
        { dim: '加分项', score: 12, max: 15, ev: '具备 SQL 能力，可独立完成取数分析' }
      ] },
    { id: 'C-3012', name: '周子墨', job: 'AI 产品经理', gender: '男', birth: '1998-02', years: 3.2,
      edu: '本科 · 某 211 院校 · 软件工程', company: '某 SaaS 公司（2年1个月）',
      tags: ['需求分析', 'PRD 撰写', '竞品分析', 'SQL'],
      phone: '137****4419', email: 'zhouzm***@example.com',
      score: 74, grade: 'ok', stage: '待人工复核', parseOk: true, source: '主动投递',
      reasons: [
        { dim: '技能匹配', score: 28, max: 40, ev: '有完整 PRD 与竞品分析沉淀，但缺少 AI 产品方向的落地案例' },
        { dim: '业务匹配', score: 22, max: 30, ev: 'B 端 SaaS 产品经验可迁移，与本岗位业务场景部分重合' },
        { dim: '稳定性', score: 13, max: 15, ev: '两段经历均 ≥ 1.5 年' },
        { dim: '加分项', score: 11, max: 15, ev: '具备 SQL 能力，可独立完成取数分析' }
      ] },
    { id: 'C-3013', name: '高晓宁', job: 'AI 产品经理', gender: '女', birth: '2000-11', years: 1.5,
      edu: '大专 · 某职业学院 · 电子商务', company: '某互联网公司（1年2个月）',
      tags: ['用户研究', '需求文档撰写'],
      phone: '135****7708', email: 'gaoxn***@example.com',
      score: 52, grade: 'no', stage: '待人工复核', parseOk: true, source: '智联招聘',
      reasons: [
        { dim: '技能匹配', score: 18, max: 40, ev: '仅命中「用户研究」一项，未见模型评测 / Badcase 相关经验' },
        { dim: '业务匹配', score: 16, max: 30, ev: '产品经历偏运营支撑，AI 产品方向经验不足' },
        { dim: '稳定性', score: 12, max: 15, ev: '在职 1 年 2 个月，时长偏短但无频繁跳槽' },
        { dim: '加分项', score: 6, max: 15, ev: '未见加分项证据' }
      ] },
    { id: 'C-2081', name: '王思远', job: '高级 Java 工程师', gender: '男', birth: '1995-03', years: 6.5,
      edu: '硕士 · 北京邮电大学 · 计算机', company: '某电商平台（4年2个月）', tags: ['Java', 'Spring Cloud', '高并发', 'MySQL', 'Redis'],
      phone: '138****6217', email: 'wangsy***@qq.com',
      score: 88, grade: 'strong', stage: '待人工复核', parseOk: true, source: '猎聘',
      reasons: [
        { dim: '技能匹配', score: 37, max: 40, ev: '主导订单中心重构，QPS 从 3k 提升至 12k' },
        { dim: '业务匹配', score: 26, max: 30, ev: '4 年电商交易链路经验，与本岗位业务高度一致' },
        { dim: '稳定性', score: 12, max: 15, ev: '两段经历均 ≥ 3 年，无频繁跳槽' },
        { dim: '加分项', score: 13, max: 15, ev: 'GitHub 有 1.2k star 的开源中间件项目' }
      ],
      aiNote: '硬性条件全部满足；技能与业务经验匹配度高。存在 3 个月职业空窗（2025.06-2025.09），建议面试确认。'
    },
    { id: 'C-2079', name: '陈ᅳ', job: '高级 Java 工程师', gender: '女', birth: '1993-11', years: 8.2,
      edu: '本科 · 某 211 · 软件工程', company: '某金融科技公司（5年）', tags: ['Java', '分布式', 'Kafka', '架构设计'],
      phone: '139****3082', email: 'chen***@163.com',
      score: 84, grade: 'strong', stage: '已邀约', parseOk: true, source: '主动投递',
      reasons: [
        { dim: '技能匹配', score: 35, max: 40, ev: '负责核心交易系统分布式改造，熟悉 Kafka 与分库分表' },
        { dim: '业务匹配', score: 24, max: 30, ev: '金融行业背景，与电商业务有差异但技术栈可迁移' },
        { dim: '稳定性', score: 14, max: 15, ev: '最近一段任职 5 年，稳定性好' },
        { dim: '加分项', score: 11, max: 15, ev: '技术团队 TL 经验 2 年' }
      ],
      aiNote: '技术深度达标，管理经验可复用。注意：金融行业合规经验与本公司差异，面试可了解其迁移意愿。'
    },
    { id: 'C-2076', name: '刘ᅳᅳ', job: '高级 Java 工程师', gender: '男', birth: '1999-07', years: 3.1,
      edu: '本科 · 某双非院校 · 计算机', company: '某 SaaS 公司（3年）', tags: ['Java', 'Spring Boot', 'MySQL'],
      phone: '137****9903', email: 'liu***@foxmail.com',
      score: 62, grade: 'ok', stage: '待人工复核', parseOk: true, source: 'BOSS直聘',
      reasons: [
        { dim: '技能匹配', score: 26, max: 40, ev: '熟悉 Spring Boot 常规开发，简历未体现高并发场景' },
        { dim: '业务匹配', score: 21, max: 30, ev: 'SaaS 后台业务经验，与交易链路部分相关' },
        { dim: '稳定性', score: 12, max: 15, ev: '单段任职 3 年 1 个月，稳定' },
        { dim: '加分项', score: 3, max: 15, ev: '无开源、无大厂、无专利' }
      ],
      aiNote: '经验年限刚过门槛（3.1 年），技术深度待面试验证；可作备选。'
    },
    { id: 'C-2074', name: '赵ᅳᅳ', job: '高级 Java 工程师', gender: '女', birth: '1992-02', years: 9.4,
      edu: '硕士 · 某 985 · 计算机', company: '某大厂（6年）', tags: ['Java', '中间件', '高并发', '团队管理'],
      phone: '135****4471', email: 'zhao***@gmail.com',
      score: 91, grade: 'strong', stage: '已邀约', parseOk: true, source: '内部推荐',
      reasons: [
        { dim: '技能匹配', score: 39, max: 40, ev: '自研中间件并支撑日均 2 亿请求' },
        { dim: '业务匹配', score: 27, max: 30, ev: '交易类系统经验丰富' },
        { dim: '稳定性', score: 14, max: 15, ev: '大厂单段 6 年' },
        { dim: '加分项', score: 11, max: 15, ev: '内推渠道 + 团队管理经验' }
      ],
      aiNote: '综合最优。需注意：期望薪资可能高于岗位带宽上限，建议提前沟通预算。'
    },
    { id: 'C-2070', name: '孙ᅳᅳ', job: '高级 Java 工程师', gender: '男', birth: '2001-05', years: 2.2,
      edu: '大专 · 某职业院校', company: '某外包公司（2年）', tags: ['Java', 'SSM'],
      phone: '136****2211', email: 'sun***@163.com',
      score: 34, grade: 'no', stage: '已淘汰', parseOk: true, source: '主动投递',
      reasons: [
        { dim: '硬性门槛', score: 0, max: 0, ev: '工作年限 2.2 年 < 岗位要求 3 年（规则判定，未调用模型）' },
        { dim: '技能匹配', score: 22, max: 40, ev: '技术栈偏传统，无分布式经验' }
      ], ruleHit: '工作年限不满足硬性要求',
      aiNote: '硬性条件不满足，已被规则前置拦截（未消耗模型调用）。'
    },
    { id: 'C-2066', name: '周ᅳᅳ', job: 'HRBP（技术线）', gender: '女', birth: '1996-09', years: 4.3,
      edu: '硕士 · 某 211 · 人力资源管理', company: '某互联网公司（3年）', tags: ['HRBP', '组织发展', '数据分析'],
      phone: '133****7765', email: 'zhou***@qq.com',
      score: 82, grade: 'strong', stage: '待人工复核', parseOk: true, source: '猎聘',
      reasons: [
        { dim: '技能匹配', score: 36, max: 45, ev: '支持过 300 人技术团队，主导过两次组织盘点' },
        { dim: '业务匹配', score: 27, max: 30, ev: '技术线 HRBP 经验完全对口' },
        { dim: '稳定性', score: 12, max: 15, ev: '任职 3 年' },
        { dim: '加分项', score: 7, max: 10, ev: '具备 SQL 取数能力' }
      ],
      aiNote: '对口度高，建议优先安排面试。'
    },
    { id: 'C-2063', name: '吴ᅳᅳ', job: 'HRBP（技术线）', gender: '男', birth: '1997-12', years: 2.6,
      edu: '本科 · 某双非 · 行政管理', company: '某制造企业（2年）', tags: ['招聘', '员工关系'],
      phone: '188****3344', email: 'wu***@sina.com',
      score: 58, grade: 'ok', stage: '待人工复核', parseOk: false, parseNote: 'PDF 为扫描件，工作经历时间解析不确定，需人工补录',
      source: 'BOSS直聘',
      reasons: [
        { dim: '技能匹配', score: 24, max: 45, ev: '偏招聘执行，HRBP 综合能力待确认' },
        { dim: '业务匹配', score: 19, max: 30, ev: '制造业背景，无技术团队支持经验' },
        { dim: '稳定性', score: 12, max: 15, ev: '任职 2 年' },
        { dim: '加分项', score: 3, max: 10, ev: '无' }
      ],
      aiNote: '⚠️ 简历解析存在不确定字段（任职起止时间），评分置信度低，建议人工核对后再决策。'
    }
  ];

  /* ---------- 待人工审核队列（HITL 闸门） ---------- */
  const approvals = [
    {
      id: 'AP-3391', task: 'T-77120', risk: 'high', type: 'mail.send_offer',
      title: '向候选人发送 Offer 邮件',
      who: '招聘 Agent（发起人：李静）', ago: '4 分钟前', created: '2026-09-23 11:37',
      target: '赵ᅳᅳ · 高级 Java 工程师',
      preview: `赵女士您好：
感谢您参加我司「高级 Java 工程师」岗位面试。经综合评估，我们诚挚邀请您加入示例科技。

【Offer 摘要】
职位：高级 Java 工程师（P6）   部门：技术中心 / 后端组
月薪：32,000 元（税前）· 14 薪  试用期：3 个月，试用期薪资 100%
入职日期：2026-10-15（可协商）
工作地点：北京·海淀

请您于 3 个工作日内回复确认。如有疑问可随时联系我。`,
      basis: '① 面试评分 4.6/5（3 位面试官）② 薪资 32,000 处于该岗位带宽 28k-38k 内 ③ 候选人已口头接受',
      impact: '影响 1 人 · 发出后不可撤回，但可在 24 小时内补发更正邮件',
      checks: ['薪资处于岗位带宽内 ✓', '未低于公司薪资红线 ✓', '已过预算审批线（HRD）✓']
    },
    {
      id: 'AP-3388', task: 'T-77098', risk: 'high', type: 'mail.send_bulk',
      title: '批量发送面试邀约（14 人）',
      who: '招聘 Agent（发起人：王强）', ago: '26 分钟前', created: '2026-09-23 11:15',
      target: '高级 Java 工程师 · 初筛通过 14 人',
      preview: `【示例科技】面试邀约
您好，您投递的「高级 Java 工程师」岗位已通过初筛，现邀请您参加线上面试。
可选时段：9/24 14:00 / 9/25 10:00 / 9/25 16:00
形式：飞书视频会议，约 60 分钟
请回复您方便的时段，我们会发送会议链接。
如您已无求职意愿，回复「T」即可停止后续联系。`,
      basis: '根据 ATS 中 14 位候选人的初筛状态（grade = strong/ok）生成邀约名单',
      impact: '影响 14 人 · 批量外发，发出后不可撤回',
      checks: ['含退订说明 ✓', '邮箱域名校验通过 ✓', '14 人中有 2 人邮箱为空，已自动排除 ✓']
    },
    {
      id: 'AP-3385', task: 'T-77081', risk: 'medium', type: 'data.export',
      title: '导出候选人名单（含联系方式）',
      who: '招聘 Agent（发起人：王强）', ago: '1 小时前', created: '2026-09-23 10:31',
      target: '高级 Java 工程师 · 86 人',
      preview: '导出字段：姓名、手机号（明文）、邮箱（明文）、当前阶段、AI 评分\n用途：线下人才盘点会（王强填写）',
      basis: '发起人王强为招聘专员，对「高级 Java 工程师」岗位有数据范围权限',
      impact: '影响 86 条敏感记录 · 导出内容将记录水印与访问日志，7 天后自动失效',
      checks: ['⚠️ 含 86 条手机号明文，属于 S3 级敏感数据', '⚠️ 已超出「单次 ≤ 50 条」的默认限额']
    }
  ];

  /* ---------- 员工（入转调离用） ---------- */
  const employees = [
    { id: 'E-1042', name: '张一鸣', dept: '/技术中心/后端组', title: '初级 Java 工程师', joinedAt: '2026-06-24',
      probationEnd: '2026-09-24', stage: '转正', daysLeft: 1, materials: { got: 2, need: 4 },
      flow: ['入职', '试用期考核', '转正审批', '正式员工'] },
    { id: 'E-1051', name: '林小雨', dept: '/产品中心', title: '产品经理', joinedAt: '2026-09-15',
      probationEnd: '2026-12-15', stage: '入职', daysLeft: 92, materials: { got: 4, need: 6 },
      flow: ['入职材料', '账号开通', '导师分配', '试用期'] },
    { id: 'E-1033', name: '黄志强', dept: '/技术中心/前端组', title: '前端工程师', joinedAt: '2026-03-10',
      probationEnd: '2026-06-10', stage: '调岗', daysLeft: null, materials: { got: 3, need: 3 },
      flow: ['原岗位', '调岗审批', '目标部门确认', '新岗位'] },
    { id: 'E-1018', name: '徐雅', dept: '/市场中心', title: '市场专员', joinedAt: '2024-05-06',
      probationEnd: null, stage: '离职', daysLeft: null, materials: { got: 1, need: 5 },
      flow: ['离职申请', '工作交接', '资产归还', '账号回收', '离职证明'] },
    { id: 'E-1060', name: '方舟', dept: '/技术中心/数据组', title: '数据分析师', joinedAt: '2026-09-22',
      probationEnd: '2026-12-22', stage: '入职', daysLeft: 90, materials: { got: 1, need: 6 },
      flow: ['入职材料', '账号开通', '导师分配'] }
  ];

  const onboardingTasks = {
    '入职': [
      { n: '方舟', t: '数据分析师', m: '材料 1/6 · 入职日期 9/22', warn: true },
      { n: '林小雨', t: '产品经理', m: '材料 4/6 · 入职日期 9/15', warn: false }
    ],
    '转正': [
      { n: '张一鸣', t: '初级 Java 工程师', m: '试用期剩 1 天 · 考核表未提交', warn: true }
    ],
    '调岗': [
      { n: '黄志强', t: '前端工程师 → 高级前端', m: '调岗审批已通过 · 9/25 生效', warn: false }
    ],
    '离职': [
      { n: '徐雅', t: '市场专员', m: '交接 1/5 · 最后工作日 9/30', warn: true }
    ]
  };

  /* ---------- 知识库 ---------- */
  const kbDocs = [
    { id: 'KB-018', title: '员工手册（2026 修订版）', ver: 'v3.2', eff: '2026-01-01', scope: '全员可见',
      chunks: 142, updated: '2026-08-14', covers: ['年假', '考勤', '报销', '行为规范'] },
    { id: 'KB-021', title: '假期管理制度', ver: 'v2.6', eff: '2026-04-01', scope: '全员可见',
      chunks: 58, updated: '2026-07-30', covers: ['年假', '婚假', '产假', '病假', '调休'] },
    { id: 'KB-027', title: '社保公积金缴纳说明（北京）', ver: 'v1.9', eff: '2026-07-01', scope: '全员可见',
      chunks: 34, updated: '2026-07-02', covers: ['社保基数', '公积金比例', '缴纳时间'] },
    { id: 'KB-031', title: '试用期与转正管理规定', ver: 'v1.4', eff: '2026-03-01', scope: 'HR 及管理者',
      chunks: 21, updated: '2026-06-11', covers: ['试用期', '转正考核', '延长试用'] },
    { id: 'KB-035', title: '考勤与加班管理办法', ver: 'v2.1', eff: '2026-05-01', scope: '全员可见',
      chunks: 47, updated: '2026-09-02', covers: ['打卡', '加班', '出差', '调休'] }
  ];

  const kbUnanswered = [
    { q: '公司能不能帮忙办北京市工作居住证？', dept: '/技术中心', cnt: 7, first: '2026-09-08', last: '2026-09-22' },
    { q: '出差补贴的餐补标准和报销凭证要求？', dept: '/市场中心', cnt: 5, first: '2026-09-11', last: '2026-09-21' },
    { q: '体检套餐可以自费升级吗？怎么补差价？', dept: '/产品中心', cnt: 4, first: '2026-09-15', last: '2026-09-20' },
    { q: '公积金可以按月提取吗？公司出什么材料？', dept: '/技术中心', cnt: 3, first: '2026-09-16', last: '2026-09-19' },
    { q: '内部转岗需要满足什么条件？满多久可以申请？', dept: '/客服中心', cnt: 6, first: '2026-09-10', last: '2026-09-18' }
  ];

  /* ---------- 审批与审计 ---------- */
  const auditLogs = [
    { t: '2026-09-23 11:37:42', actor: 'Agent（招聘）', ai: true, act: '生成 Offer 邮件草稿', obj: 'candidate:C-2074',
      task: 'T-77120', res: 'ok', note: '触发高风险闸门 → 进入待审核队列 AP-3391' },
    { t: '2026-09-23 11:36:18', actor: '李静', ai: false, act: '批准邀请调度', obj: 'task:T-77119',
      task: 'T-77119', res: 'ok', note: '批量邀约 14 人 → 已入队 AP-3388' },
    { t: '2026-09-23 11:15:03', actor: 'Agent（招聘）', ai: true, act: '简历打分（86 份）', obj: 'job:J-2026-118',
      task: 'T-77098', res: 'ok', note: 'PII 脱敏已生效；受保护字段已物理剔除；模型调用 86 次' },
    { t: '2026-09-23 11:14:47', actor: '系统', ai: false, act: '拦截越权请求', obj: 'api:/employees/export',
      task: '—', res: 'blocked', note: '发起人黄志强（员工角色）尝试导出全公司花名册 → 403，已记录' },
    { t: '2026-09-23 10:31:22', actor: '王强', ai: false, act: '提交数据导出申请', obj: 'export:C-88records',
      task: 'T-77081', res: 'pending', note: '含 86 条手机号明文，超出默认限额 → 转 HRD 审批' },
    { t: '2026-09-23 09:42:10', actor: 'Agent（自助）', ai: true, act: '回答员工提问', obj: 'user:E-1042',
      task: 'T-77055', res: 'ok', note: '依据《假期管理制度》v2.6 第 3 章；引用 2 处' },
    { t: '2026-09-23 09:41:58', actor: 'Agent（自助）', ai: true, act: '拒答并转人工', obj: 'user:E-1033',
      task: 'T-77054', res: 'ok', note: '问题涉及劳动纠纷法律咨询（超出授权范围）→ 转 HR + 法务' },
    { t: '2026-09-23 09:00:02', actor: '系统', ai: false, act: '生成人力日报', obj: 'report:daily',
      task: '—', res: 'ok', note: '推送至飞书「HR 管理群」，含 4 项待办预警' },
    { t: '2026-09-22 18:03:41', actor: 'Agent（流程）', ai: true, act: '发起材料催收', obj: 'user:E-1060',
      task: 'T-76990', res: 'ok', note: '缺 5 项材料，第 1 次催收，已抄送直属上级' },
    { t: '2026-09-22 16:20:09', actor: '陈明（HRBP）', ai: false, act: '驳回 AI 筛选结论', obj: 'candidate:C-2063',
      task: 'T-76933', res: 'ok', note: '驳回原因：「制造业背景但招聘方法论扎实，值得面聊」→ 已进入优化数据集' }
  ];

  const riskBlocks = [
    { t: '2026-09-23 11:14:47', type: '越权访问', detail: '员工角色尝试导出全公司花名册', action: '403 拦截 + 通知管理员' },
    { t: '2026-09-23 10:31:22', type: '超额导出', detail: '单次导出 86 条敏感数据（限额 50）', action: '转 HRD 审批' },
    { t: '2026-09-22 14:02:55', type: 'PII 外泄拦截', detail: '模型输出中出现疑似手机号', action: '输出拦截 + 重新生成' },
    { t: '2026-09-21 17:44:12', type: '高风险动作', detail: 'Agent 尝试不经审核调用 send_offer', action: '强制挂起，进入审核队列' }
  ];

  /* ---------- 报表 ---------- */
  const funnel = [
    { stage: '简历投递', n: 268, color: '#4c8dff' },
    { stage: 'AI 初筛通过', n: 86, color: '#5c9dff' },
    { stage: 'HR 复核通过', n: 42, color: '#7aa9ff' },
    { stage: '一面', n: 26, color: '#a78bfa' },
    { stage: '二面', n: 14, color: '#c99cf5' },
    { stage: 'Offer', n: 5, color: '#f5b942' },
    { stage: '已入职', n: 3, color: '#3ddc97' }
  ];

  const weeklyNumbers = [
    { k: '新增投递', v: 268, d: '+18%' }, { k: '完成面试', v: 34, d: '+9%' },
    { k: '发出 Offer', v: 5, d: '+2' }, { k: '入职', v: 3, d: '+1' },
    { k: '离职', v: 2, d: '持平' }, { k: '在编人数', v: 612, d: '+1' }
  ];

  const reportLog = [
    { t: '2026-09-23 09:00', name: '人力日报 · 9月23日', to: '飞书「HR 管理群」', status: '已送达' },
    { t: '2026-09-22 09:00', name: '人力日报 · 9月22日', to: '飞书「HR 管理群」', status: '已送达' },
    { t: '2026-09-21 09:00', name: '周报 · 9/15-9/21', to: '飞书 + 邮件（HRD/CEO）', status: '已送达' },
    { t: '2026-09-19 09:00', name: '人力日报 · 9月19日', to: '飞书「HR 管理群」', status: '已送达' },
    { t: '2026-09-18 09:00', name: '人力日报 · 9月18日', to: '飞书「HR 管理群」', status: '已送达' }
  ];

  /* ---------- 编排模板 ---------- */
  const templates = [
    { id: 'TP-01', name: '试用期到期提醒', trig: '定时 · 每天 09:00', steps: 3, used: 128, desc: '试用期剩 15/7/3/1 天时提醒直属上级与 HRBP' },
    { id: 'TP-02', name: '简历自动初筛', trig: '事件 · ATS 有新简历', steps: 5, used: 412, desc: '解析 → 规则前置过滤 → 打分 → 脱敏 → 生成推荐表（人工确认）' },
    { id: 'TP-03', name: '入职欢迎与材料催收', trig: '事件 · Offer 已接受', steps: 4, used: 37, desc: '发欢迎信 → 生成材料清单 → 按天催收 → 收齐后触发账号开通审批' },
    { id: 'TP-04', name: '离职交接跟踪', trig: '事件 · 离职审批通过', steps: 5, used: 21, desc: '生成交接清单 → 资产归还提醒 → 账号回收审批 → 离职证明草稿' },
    { id: 'TP-05', name: '招聘漏斗周报', trig: '定时 · 每周一 09:30', steps: 3, used: 12, desc: '拉取数据 → 计算转化率 → 生成并推送周报' }
  ];

  const integrations = [
    { name: '飞书', cat: '消息与审批', status: 'ok', detail: '已授权 · 消息/审批/通讯录', last: '2026-09-23 11:38' },
    { name: '钉钉', cat: '消息与审批', status: 'off', detail: '未连接', last: '—' },
    { name: '企业微信', cat: '消息与审批', status: 'off', detail: '未连接', last: '—' },
    { name: 'Moka ATS', cat: '招聘系统', status: 'ok', detail: '已授权 · 候选人/岗位/阶段读写', last: '2026-09-23 11:37' },
    { name: '北森 HRIS', cat: '人力资源系统', status: 'warn', detail: '令牌将于 3 天后过期', last: '2026-09-23 09:00' },
    { name: '邮件（SMTP）', cat: '沟通渠道', status: 'ok', detail: 'hr@example-tech.com', last: '2026-09-23 11:15' },
    { name: '飞书日历', cat: '日程', status: 'ok', detail: '已授权 · 只读忙闲', last: '2026-09-23 11:12' },
    { name: '考勤系统（只读）', cat: '考勤假期', status: 'ok', detail: '只读 · 不支持写入（一期策略）', last: '2026-09-23 08:30' },
    { name: 'e签宝', cat: '电子签', status: 'off', detail: '二期规划', last: '—' },
    { name: '内部知识库', cat: '知识库', status: 'ok', detail: '5 份文档 · 302 个切片已同步', last: '2026-09-23 07:00' }
  ];

  /* ---------- 角色权限矩阵 ---------- */
  const roles = ['企业管理员', 'HRD', 'HRBP', '招聘专员', '面试官', '普通员工', '审计员', 'Agent（招聘）'];
  const perms = [
    { r: '查看候选人简历原文', v: ['全部', '全部', '所辖部门', '所辖岗位', '仅面试对象', '—', '只读', '继承发起人'] },
    { r: '查看候选人手机号（明文）', v: ['可', '可', '可', '可', '—', '—', '只读', '永不'] },
    { r: '执行 AI 简历筛选', v: ['可', '可', '可', '可', '—', '—', '—', '可'] },
    { r: '手动推翻 AI 结论', v: ['可', '可', '可', '可', '—', '—', '—', '不可（需人执行）'] },
    { r: '查看员工薪资', v: ['可', '可', '—', '—', '—', '仅自己', '只读', '永不'] },
    { r: '导出名单', v: ['无限制', '≤200', '≤100', '≤50', '—', '—', '只读', '不可'] },
    { r: '审批高风险动作', v: ['可', '可', '部分', '—', '—', '—', '—', '不可'] },
    { r: '配置 Agent 编排', v: ['可', '可', '可', '可', '—', '—', '—', '不可'] },
    { r: '查看审计日志', v: ['可', '可', '所辖', '—', '—', '—', '全部', '不可'] },
    { r: '管理第三方集成', v: ['可', '—', '—', '—', '—', '—', '—', '不可'] }
  ];

  /* ---------- Agent 底座能力（第 4 部分的可视化） ---------- */
  const foundation = [
    { icon: '🧭', name: '任务规划拆解', en: 'Planner',
      desc: '把「帮我筛一下这批简历」拆成可执行的步骤序列，每步指明用什么工具、依赖哪一步。',
      must: ['计划落库，可完整回放', '支持串行 / 并行 / 条件分支', '每任务设 token、时间、调用次数上限'],
      proof: '每次运行都生成 Task Plan，右侧抽屉可看每一步的输入输出' },
    { icon: '🔧', name: '工具调用', en: 'Tool Calling',
      desc: 'Agent 的「手」。查考勤、发邮件、改 ATS 阶段，都必须通过注册过的工具，不允许自由发挥。',
      must: ['JSON Schema 强约束参数', '幂等键防重复发送', '失败指数退避重试 3 次后转人工', '高风险工具打标'],
      proof: '工具注册中心统一管理，每次调用留完整入参出参' },
    { icon: '🧠', name: '长期记忆', en: 'Memory',
      desc: '分五层：会话 / 用户偏好 / 任务状态 / 业务事实 / 企业知识。不是把聊天记录全存下来。',
      must: ['记忆不得覆盖权威业务事实', '敏感信息不入长期记忆', '可查看、可删除（合规）', '写入前过脱敏网关'],
      proof: '记忆冲突时以 HR 系统数据为准，并提示文档可能过期' },
    { icon: '🔐', name: '权限隔离', en: 'Permission Isolation',
      desc: '四层隔离：租户 → 角色 → 数据范围 → Agent 代理。Agent 永远以「发起人身份」执行。',
      must: ['数据库行级安全（RLS）兜底', 'Agent 不使用超级账号', '薪资字段对 Agent 永久不可见'],
      proof: '越权测试用例 100% 拦截，任何越权都会写入审计日志' },
    { icon: '🛡️', name: '敏感数据脱敏', en: 'PII Masking',
      desc: '三道关：入模型前替换占位符、模型输出后扫描拦截、用于优化前二次脱敏。',
      must: ['手机号/身份证/薪资默认打码', '受保护字段在打分前物理剔除', '靠代码而非提示词实现合规'],
      proof: '模型入参中永远看不到手机号原文，看到的是 [PHONE]' },
    { icon: '✋', name: '高风险人工审核', en: 'Human-in-the-loop',
      desc: '发 Offer、改薪资、删数据、批量外发、导出敏感名单——必须先过人这一关。',
      must: ['审核卡展示真实内容全文', '驳回必须填原因（进优化集）', '超时自动升级', '任何代码路径不得绕过'],
      proof: '审核中心统一队列，超时 2 小时自动升级到上级' }
  ];

  /* ---------- 工作台活动流 ---------- */
  const activity = [
    { t: '11:37', txt: '招聘 Agent 生成 1 份 Offer 草稿，等待你审批', type: 'warn' },
    { t: '11:15', txt: '招聘 Agent 完成 86 份简历打分，其中 12 份建议淘汰', type: 'ok' },
    { t: '11:14', txt: '拦截 1 次越权导出请求（员工角色尝试导出花名册）', type: 'dang' },
    { t: '10:31', txt: '数据导出申请超出限额，已转 HRD 审批', type: 'warn' },
    { t: '09:42', txt: '员工自助 Agent 回答 23 个问题，自助解决率 68%', type: 'ok' },
    { t: '09:00', txt: '人力日报已推送到飞书「HR 管理群」', type: 'ok' },
    { t: '08:30', txt: '流程 Agent 发出 2 条材料催收提醒', type: 'ok' }
  ];

  /* 统一关联：候选人补 jobId（按岗位标题匹配），让「按岗位筛选」在离线模式下同样可用 */
  candidates.forEach(c => { const j = jobs.find(x => x.title === c.job); c.jobId = j ? j.id : null; });

  return { tenant, jobs, candidates, approvals, employees, onboardingTasks, kbDocs, kbUnanswered,
           auditLogs, riskBlocks, funnel, weeklyNumbers, reportLog, templates, integrations,
           roles, perms, foundation, activity,
           industries: ['互联网', '制造业', '零售连锁', '医疗健康', '教育培训', '金融', '销售', '人力资源',
             '建筑工程', '物流运输', '酒店餐饮', '医药健康', '游戏', '能源电力', '传媒文化', '专业服务', '物业管理', '通用'] };
})();
