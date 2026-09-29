/* ===========================================================
   HR-Agent OS · 数据库层（SQLite，node:sqlite 内置驱动，零依赖）
   表结构与 docs/02_搭建实操教程.md 第 2 步的 PostgreSQL 版本同源，
   字段做了 SQLite 适配（JSONB → TEXT 存 JSON，UUID → TEXT）。

   v0.9.1 变更：岗位表支持行业 / 自定义 JD / 编制 / 薪资 / 关键词。
   v0.10.0 变更：schema 管理移交 migrations.js（版本化迁移 + 审计 append-only 触发器）；
                 open() 启用 WAL；重置不再丢会话与留存策略。
   =========================================================== */
'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'hr_agent.db');

/* ---------- schema 由 migrations.js 统一管理 ----------
   v0.10.0 起，建表 / 补列 / 建索引 / 建触发器全部走**版本化迁移**，
   本文件不再维护 SCHEMA 常量，也不再做「探测缺列就 ALTER」的隐式升级。
   为什么必须改：旧做法表达不了「改默认值 / 加索引 / 加约束 / 数据回填」，
   且没有执行记录 —— 无法回答「这台机器的库是哪个版本」。详见 migrations.js 文件头。 */
const migrations = require('./migrations.js');

/** 当前库的 schema 版本（供 /api/health 与 /api/bootstrap 展示） */
function schemaVersion(db) {
  try { return migrations.currentVersion(db); } catch { return -1; }
}

/* ---------- 行业词库：打分与 JD 生成的共同依据 ---------- */
const INDUSTRY_SKILLS = {
  '互联网': { core: ['Java', 'Spring Boot', 'Spring Cloud', 'MySQL', 'Redis', '微服务', '高并发', '分布式', 'Kafka', 'Docker', 'Kubernetes', 'React', 'Vue', 'TypeScript', 'Node.js', 'Python', 'API 设计', '性能优化', '系统设计'],
    biz: ['电商', '交易', '订单', '支付', '内容', '社交', 'SaaS'], plus: ['开源项目', '大厂背景', '技术负责人', '架构设计'] },
  '制造业': { core: ['精益生产', '5S', '排产', 'TPM', '标准工时', '工艺优化', 'SOP', '质量管控', '设备维护', '班组长管理', '安全生产', '数控编程',
    '供应商开发', '成本管控', '采购谈判', 'ERP 系统', '来料检验', 'ISO9001', '生产计划'],
    biz: ['汽车零部件', '精密制造', '电子组装', '机械加工', '注塑成型'], plus: ['六西格玛', '黑带认证', '降本增效', '产线改造'] },
  '零售连锁': { core: ['门店运营', '团队管理', '销售达成', '商品陈列', '库存管理', '客户服务', '会员运营', '排班管理', '损耗控制', '促销活动', '坪效管理'],
    biz: ['快消零售', '连锁餐饮', '服装零售', '商超'], plus: ['新店开业', '标杆店', '区域 top 门店'] },
  '医疗健康': { core: ['护理管理', '院感控制', '护理质控', '临床护理', '急救技能', '护理文书', '患者沟通', '护理排班', '护理计划', '不良事件管理', '健康教育'],
    biz: ['三甲医院', '民营医院', '专科诊所', '康复机构'], plus: ['专科护士认证', '护理带教', '质控项目'] },
  '教育培训': { core: ['课程规划', '客户沟通', '续费转化', '电话邀约', '学习方案设计', '家长沟通', '试听转化', '学员管理', '招生渠道'],
    biz: ['K12 教育', '职业教育', '语言培训', '艺术教育'], plus: ['销冠', '转介绍转化', '社群运营'] },
  '金融': { core: ['风险识别', '信贷审核', '反欺诈', '数据分析', 'SQL', '财务分析', '合规审查', '尽职调查', '授信审批', '反洗钱', '逾期催收'],
    biz: ['银行', '消费金融', '保险', '证券', '融资租赁'], plus: ['风控模型', '持证（FRM/CPA）', '审计经验'] },
  '销售': { core: ['大客户开发', '商务谈判', '解决方案销售', '招投标', '客户关系维护', '销售漏斗管理', '回款管理', '客户拜访', '渠道管理', '业绩达成'],
    biz: ['企业软件', '工业品', '医疗器械', '系统集成'], plus: ['行业资源', '标杆客户案例', '团队管理'] },
  '人力资源': { core: ['HRBP', '组织发展', '人才盘点', '绩效管理', '员工关系', '招聘管理', '数据分析', '薪酬设计', '劳动法', '招聘渠道'],
    biz: ['技术团队', '互联网', '制造业'], plus: ['组织变革项目', '人才发展体系', '数据分析能力'] },
  /* ---------- v0.9.6 新增行业：与新增的 10 个职能族配套 ---------- */
  '建筑工程': { core: ['施工组织设计', '工程造价', '工程预算', '施工质量控制', '安全文明施工', '图纸会审', '工程资料管理', '分包管理', '测量放线', '竣工验收', 'CAD', '工程量清单'],
    biz: ['房建工程', '市政道路', '桥梁隧道', '装饰装修', '机电安装'], plus: ['一级建造师', '注册造价工程师', '大型项目经验'] },
  '物流运输': { core: ['运输调度', '路线规划', '仓储管理', '库存盘点', '配送时效管理', '承运商管理', '物流成本控制', 'WMS', 'TMS', '货运单据', '冷链管理', '安全生产'],
    biz: ['干线运输', '城市配送', '电商仓配', '冷链物流'], plus: ['物流师认证', '降本成果', '网络规划经验'] },
  '酒店餐饮': { core: ['门店运营', '菜品出品管理', '食品安全管理', '顾客满意度', '成本与毛利管控', '排班管理', '物料与库房管理', '服务流程标准', '卫生管理', '宴会与活动执行'],
    biz: ['连锁餐饮', '星级酒店', '咖啡烘焙', '团餐'], plus: ['食品安全管理员证', '扭亏经验', '连锁标准化经验'] },
  '医药健康': { core: ['学术推广', '产品知识', '临床数据解读', '药品注册法规', 'GSP', 'GMP', '药品效期管理', '临床试验', '不良反应监测', '客户拜访', '医院渠道', '招投标'],
    biz: ['处方药', 'OTC', '医疗器械', '生物制药'], plus: ['医药代表备案', '医院资源', '注册项目经验'] },
  '游戏': { core: ['玩法设计', '数值设计', '关卡设计', '系统策划', '剧情文案', '版本规划', '玩家数据分析', '游戏运营活动', 'Unity', 'UE', '原画协作', '留存与付费'],
    biz: ['手游', '端游', '休闲游戏', '二次元'], plus: ['上线项目经验', '爆款玩法案例', '海外发行经验'] },
  '能源电力': { core: ['电气设备运行', '电力系统', '变配电运维', '继电保护', '电气试验', '新能源（光伏／风电／储能）', '能效分析', '电力安全工作规程', '作业票管理', '并网与电价', '应急预案', '高压电工'],
    biz: ['电网', '光伏电站', '风力发电', '储能系统'], plus: ['注册电气工程师', '电工进网作业许可', '节能改造经验'] },
  '传媒文化': { core: ['选题策划', '采访写作', '编辑校对', '视频剪辑', '摄影摄像', '后期制作', '内容分发', '新媒体平台运营', '版权管理', '数据复盘', '栏目策划', '内容合规'],
    biz: ['新闻媒体', '短视频平台', '品牌内容', '出版发行'], plus: ['爆款作品', '剪辑后期能力', '内容矩阵经验'] },
  '专业服务': { core: ['合同审核', '法律意见出具', '尽职调查', '案件跟进', '知识产权', '合规审查', '项目交付管理', '客户沟通', '文档撰写', '风险识别', '财务分析', '审计'],
    biz: ['律师事务所', '会计师事务所', '管理咨询', '企业法务'], plus: ['法律职业资格证', '注册会计师', '行业客户资源'] },
  '物业管理': { core: ['物业项目运营', '设施设备维护', '安保与秩序管理', '保洁绿化管理', '业主投诉处理', '物业费收缴', '消防安全管理', '外包供应商管理', '应急预案', '社区活动', '巡检记录', '节能降耗'],
    biz: ['住宅物业', '商业物业', '写字楼物业', '产业园区'], plus: ['物业管理师', '创优项目经验', '收缴率提升成果'] },
  '通用': { core: ['沟通协作', '项目管理', '数据分析', 'Office', '汇报能力'],
    biz: [], plus: [] }
};
const INDUSTRIES = Object.keys(INDUSTRY_SKILLS);

/* 从 must_have / nice_have 文本里抽取技能关键词
   词库 = 职能族（shared/req-lib.js）∪ 行业词库（本文件）
   两者的定位不同：职能族负责「这个岗位干什么」，行业词库负责「这个行业常见技能」，
   合并成全集后按文本包含关系抽取，能同时覆盖两类写法。 */
const ReqLib = require('../shared/req-lib.js');
function extractKeywords(texts) {
  return ReqLib.extractKeywords(texts, INDUSTRY_SKILLS);
}

/* ---------- 确定性随机（同一 seed 结果可复现，便于演示与回归） ---------- */
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '曹', '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡', '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈'];
const GIVEN = ['思远', '书瑶', '天成', '一诺', '浩然', '雨薇', '子墨', '嘉宁', '宇轩', '晨曦', '志强', '雅静', '文博', '梦琪', '海洋', '静怡', '明轩', '佳琪', '若安', '亦航', '唯清', '知远', '慕白', '南舟', '以彤', '然然', '初晓', '念安', '野川', '歌遥', '云舒', '望舒', '拾一', '南屿', '霁月'];
const SOURCES = ['主动投递', '猎聘', 'BOSS直聘', '内部推荐', '脉脉', '智联招聘'];
const EDU_TXT = {
  1: ['大专 · 某职业技术学院', '大专 · 某职业院校', '大专 · 某成人高校'],
  2: ['本科 · 某 211 院校', '本科 · 某双非院校', '本科 · 某省属重点大学', '本科 · 某普通本科院校'],
  3: ['硕士 · 某 985 院校', '硕士 · 某 211 院校', '硕士 · 某省属重点大学']
};

/* 按岗位自动生成一批演示简历（用于：① 丰富种子库 ② 新建岗位后立刻能跑筛选） */
/**
 * 生成演示候选人（确定性：同一 job.id 永远得到同一批人）。
 * @param {object} job
 * @param {number} n
 * @param {object} [opt] { offset } —— **序号起点**。
 *   为什么需要 offset：候选人主键是 `C-<job>-<两位序号>`，建岗时已自动播种 5 份，
 *   若「补生成演示简历」再从 -01 编号就会主键冲突（真实可复现的 500）。
 *   offset 让续编从已有最大序号之后开始，使该操作可重复调用。
 *   同时 offset>0 时换一个随机种子，避免续编出来的人与第一批完全一样。
 */
function synthCandidates(job, n, opt = {}) {
  const offset = Math.max(0, Number(opt.offset) || 0);
  const rand = rng(offset ? String(job.id) + '#' + offset : String(job.id));
  const kw = (job.keywords && job.keywords.length) ? job.keywords : extractKeywords([...(job.must_have || []), ...(job.nice_have || [])]);
  const lib = INDUSTRY_SKILLS[job.industry] || INDUSTRY_SKILLS['通用'];
  /* 技能池兜底同样「职能优先」：岗位抽不出关键词时，按「这个岗位干什么」给技能，
     而不是按「公司在哪个行业」—— 否则互联网行业的非技术岗会收到一堆技术栈技能。 */
  const fnKey = ReqLib.detectFunction(job.title, [...(job.must_have || []), ...(job.nice_have || [])]);
  const fn = fnKey ? ReqLib.FUNCTIONS[fnKey] : null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const pool = kw.length ? kw : (fn ? fn.core : lib.core);
    // 四档画像，保证筛选结果有完整分层：
    // strong 强推荐 / ok 可聊 / weak 打分后不合格 / block 硬性条件不符（被规则前置拦截，0 token）
    const r0 = rand();
    const tier = r0 < 0.28 ? 'strong' : r0 < 0.68 ? 'ok' : r0 < 0.86 ? 'weak' : 'block';
    const shuffled = pool.slice().sort(() => rand() - 0.5);
    const hitN = tier === 'strong' ? 3 + Math.floor(rand() * 2)
      : tier === 'ok' ? 2 + Math.floor(rand() * 2)
        : 1 + Math.floor(rand() * 2);
    const skills = shuffled.slice(0, Math.max(1, Math.min(hitN, pool.length)));
    /* 掺入与岗位无关的技能，模拟真实简历（不提高岗位关键词命中率） */
    const noise = ['项目管理', '英语读写', 'Excel 数据处理', '跨部门协作', '文档撰写'].sort(() => rand() - 0.5);
    skills.push(...noise.slice(0, tier === 'strong' ? 1 : 2));
    const biz = lib.biz.slice().sort(() => rand() - 0.5).slice(0,
      tier === 'strong' ? 2 + Math.floor(rand() * 2) : tier === 'ok' ? 1 + Math.floor(rand() * 2) : Math.floor(rand() * 1.6));
    const plus = lib.plus.slice().sort(() => rand() - 0.5).slice(0,
      tier === 'strong' ? 1 + Math.floor(rand() * 2) : (tier === 'ok' && rand() < 0.5) ? 1 : 0);

    const yr = job.must_years || 2;
    const yearsExp = tier === 'strong' ? +(yr + 2 + rand() * 3).toFixed(1)
      : tier === 'ok' ? +(yr + rand() * 1.6).toFixed(1)
        : tier === 'weak' ? +(yr + rand() * 0.8).toFixed(1)        // 年限达标，但技能/业务偏弱 → 打分后不合格
          : +(Math.max(0.8, yr - 1 - rand() * 1.5)).toFixed(1);    // 硬性条件不符 → 被规则前置拦截
    const eduRank = tier === 'block' && rand() < 0.55 ? Math.max(1, (job.must_edu_rank || 2) - 1)
      : tier === 'strong' && rand() < 0.5 ? Math.min(3, (job.must_edu_rank || 2) + 1) : (job.must_edu_rank || 2);

    const birthY = 2026 - Math.round(yearsExp) - 22 - Math.floor(rand() * 4);
    const eduPool = EDU_TXT[eduRank] || EDU_TXT[2];
    out.push({
      id: job.id.replace('J-', 'C-') + '-' + String(offset + i + 1).padStart(2, '0'),
      name: SURNAMES[Math.floor(rand() * SURNAMES.length)] + GIVEN[Math.floor(rand() * GIVEN.length)],
      gender: rand() < 0.52 ? '男' : '女',
      birth: birthY + '-' + String(1 + Math.floor(rand() * 12)).padStart(2, '0'),
      years: yearsExp, eduRank,
      eduText: eduPool[Math.floor(rand() * eduPool.length)],
      company: (biz[0] || lib.biz[0] || '某企业') + '（' + Math.max(1, Math.round(yearsExp * 0.6 * 10) / 10) + '年）',
      skills, businessTags: biz, plusTags: plus,
      source: SOURCES[Math.floor(rand() * SOURCES.length)],
      parseOk: rand() < 0.88 ? 1 : 0
    });
  }
  return out;
}

/* ---------- 岗位库：覆盖 17 个行业、22 个岗位（种子的核心修正点） ---------- */
const JOBS = [
  ['J-118', '互联网', '高级 Java 工程师', '/技术中心/后端组', 3, 2, '25-40K·14薪', '2026-09-08', 2,
    ['3 年以上 Java 开发经验', '本科及以上学历', '熟悉 Spring 生态与 MySQL'],
    ['高并发或分布式经验', '开源项目贡献', '技术团队管理经验']],
  ['J-122', '互联网', '前端工程师', '/技术中心/前端组', 2, 2, '18-30K·14薪', '2026-09-10', 1,
    ['2 年以上前端开发经验', '本科及以上学历', '精通 React 或 Vue'],
    ['TypeScript 大型项目经验', '性能优化实践', '组件库建设经验']],
  /* 这个岗位同时是「职能族 vs 行业」的回归样例：
     它属于互联网行业，但岗位是产品而非研发 —— 按行业补位会错补 Java/Spring，
     按职能族补位才是需求分析 / PRD / 用户研究 / 模型评测。 */
  ['J-126', '互联网', 'AI 产品经理', '/产品中心/AI 产品组', 3, 2, '25-40K·14薪', '2026-09-14', 1,
    ['3 年以上 AI 产品经验', '本科及以上学历', '熟悉需求分析、PRD 撰写与模型评测'],
    ['有大模型 / Agent 产品落地经验', '具备 SQL 或数据分析能力', '有从 0 到 1 立项经历']],
  ['J-130', '制造业', '生产车间主管', '/制造中心/装配车间', 3, 1, '12-18K·13薪', '2026-08-20', 2,
    ['3 年以上制造业车间管理经验', '大专及以上学历', '熟悉精益生产与 5S 现场管理'],
    ['六西格玛绿带及以上', '产线改造或降本增效项目经验', '汽车零部件行业背景']],
  ['J-131', '制造业', '工艺工程师（IE）', '/制造中心/工艺部', 2, 2, '10-16K·13薪', '2026-09-02', 1,
    ['2 年以上工艺或工业工程经验', '本科及以上学历', '熟悉标准工时测定与 SOP 编制'],
    ['自动化产线导入经验', '数控编程能力', '工艺优化专利或论文']],
  ['J-140', '零售连锁', '门店店长', '/零售运营中心/华北区', 3, 1, '9-14K+提成', '2026-08-15', 3,
    ['3 年以上门店管理经验', '大专及以上学历', '有独立带店与销售达成经验'],
    ['新店开业经验', '会员运营体系搭建', '连锁快消或餐饮背景']],
  ['J-150', '医疗健康', '护理主管', '/医疗中心/护理部', 4, 1, '11-16K·13薪', '2026-07-28', 1,
    ['4 年以上临床护理经验', '大专及以上学历', '熟悉护理质控与院感控制'],
    ['主管护师及以上职称', '护理团队带教经验', '三甲医院工作经历']],
  ['J-160', '教育培训', '课程顾问', '/教培事业部/销售部', 1, 1, '6-10K+提成', '2026-09-12', 4,
    ['1 年以上教育行业销售或顾问经验', '大专及以上学历', '具备良好的客户沟通与转化能力'],
    ['K12 或职业教育背景', '社群运营经验', '续费转化达成率超目标']],
  ['J-170', '金融', '风控专员', '/风险管理部/信贷风控组', 2, 2, '13-20K·14薪', '2026-09-05', 2,
    ['2 年以上信贷审核或风控经验', '本科及以上学历', '熟悉风险识别与反欺诈手段'],
    ['掌握 SQL 与风控建模', '持 FRM 或 CPA 证书', '消费金融行业经验']],
  ['J-180', '销售', '大客户销售经理', '/销售中心/企业客户部', 4, 2, '15-25K+提成', '2026-08-08', 2,
    ['4 年以上 B 端大客户销售经验', '本科及以上学历', '具备解决方案销售与商务谈判能力'],
    ['有招投标项目经验', '工业品或企业软件行业资源', '单笔百万级以上签约案例']],
  ['J-121', '人力资源', 'HRBP（技术线）', '/人力资源中心', 2, 2, '15-22K·14薪', '2026-09-15', 1,
    ['2 年以上 HRBP 经验', '本科及以上学历', '支持过技术团队'],
    ['组织发展项目经验', '人才盘点与绩效体系搭建', '数据分析能力']],
  /* ---------- v0.9.6 新增：覆盖新拆出的职能族，让每族都有可演示的岗位 ---------- */
  ['J-190', '专业服务', '法务专员', '/法务部', 2, 2, '11-18K·14薪', '2026-09-11', 1,
    ['2 年以上企业法务或律所经验', '本科及以上学历，法学相关专业', '熟悉合同审核与法律风险识别'],
    ['通过法律职业资格考试', '有知识产权或投融资项目法务经验', '英语可作为工作语言']],
  ['J-192', '教育培训', '数学教师', '/教学中心/学科教研组', 2, 2, '9-15K·13薪', '2026-09-13', 2,
    ['2 年以上学科教学经验', '本科及以上学历，师范类或数学相关专业', '持教师资格证'],
    ['有毕业班或竞赛辅导经验', '有在线课程或教研产品经验', '家校沟通口碑良好']],
  ['J-194', '建筑工程', '土建工程师', '/工程管理部', 3, 2, '12-18K·13薪', '2026-08-25', 2,
    ['3 年以上土建施工管理经验', '本科及以上学历，土木工程相关专业', '熟悉施工规范与工程质量验收标准'],
    ['持一级或二级建造师证书', '有大型房建或市政项目经验', '熟悉 BIM 或工程管理软件']],
  ['J-196', '传媒文化', '短视频编导', '/内容中心/短视频组', 2, 2, '10-18K·13薪', '2026-09-16', 2,
    ['2 年以上短视频内容制作经验', '本科及以上学历', '具备选题策划、脚本撰写与剪辑成片能力'],
    ['有播放量百万级的作品案例', '熟悉主流平台内容算法与分发逻辑', '有账号从 0 到 1 运营经验']],
  ['J-198', '物流运输', '物流调度主管', '/物流中心/运输调度组', 3, 1, '10-15K·13薪', '2026-08-30', 1,
    ['3 年以上运输调度或物流管理经验', '大专及以上学历', '熟悉运输线路规划与承运商管理'],
    ['熟悉 TMS／WMS 等物流系统', '有物流降本项目经验', '有冷链或特种运输管理经验']],
  ['J-200', '酒店餐饮', '厨师长', '/餐饮运营部/中央厨房', 4, 1, '10-16K·13薪', '2026-08-18', 1,
    ['4 年以上后厨管理经验', '中专及以上学历', '熟悉菜品出品标准与食品安全管理'],
    ['有连锁餐饮标准化落地经验', '持食品安全管理员证', '有新店开业或菜品研发成果']],
  ['J-202', '物业管理', '物业项目经理', '/物业事业部/华北区域', 3, 1, '10-16K·13薪', '2026-08-28', 1,
    ['3 年以上物业项目管理经验', '大专及以上学历', '熟悉住宅或商业物业的运营与收费管理'],
    ['持物业管理师或消防设施操作员证', '有创优或标杆项目经验', '有提升收缴率与满意度的成果']],
  ['J-204', '医药健康', '医药代表', '/销售中心/处方药事业部', 1, 2, '8-14K+提成', '2026-09-17', 3,
    ['1 年以上医药推广或临床相关经验', '大专及以上学历，药学或临床相关专业优先', '熟悉合规推广要求'],
    ['有医院或连锁药店渠道资源', '有新品准入或区域开发经验', '持医药代表备案']],
  ['J-206', '游戏', '游戏数值策划', '/游戏研发部/策划组', 2, 2, '15-25K·13薪', '2026-09-09', 2,
    ['2 年以上游戏数值设计经验', '本科及以上学历', '熟悉成长曲线与付费数值设计'],
    ['有已上线手游的完整项目经验', '熟悉 Excel／Python 数值建模', '有二次元或海外发行项目经验']],
  ['J-208', '能源电力', '光伏运维工程师', '/新能源事业部/运维中心', 2, 2, '10-16K·13薪', '2026-09-06', 2,
    ['2 年以上光伏电站运维经验', '大专及以上学历，电气或新能源相关专业', '熟悉电气设备检修与安全规程'],
    ['持高压电工或进网作业许可', '有储能系统运维经验', '有电站能效提升项目经验']]
];

/* ---------- 种子数据 ---------- */
function seed(db) {
  const T = 'T-001';
  const ins = (sql, ...p) => db.prepare(sql).run(...p);

  /* ⚠️ 教训：这里必须写**显式列名**，不能用位置式 `VALUES (?,?,...)`。
     原因：v2 迁移给 users 加了 7 个认证字段，列数从 8 变 15；
     位置式插入在「老库（种子早已跑过）」上永远测不出来，
     只在**空库首次建库**时炸（table users has 15 columns but 8 values were supplied）。
     这个 bug 是「删库从零重建」这个测试动作抓出来的 —— 空库路径必须单独验。 */
  ins(`INSERT INTO tenants (id,name,plan,region) VALUES (?,?,?,?)`, T, '示例科技（600 人）', 'pilot', 'cn-north');

  const users = [
    ['U-001', T, '李静', 'hrd', '/人力资源中心', '人力资源总监', ''],
    ['U-002', T, '王强', 'recruiter', '/人力资源中心', '招聘专员', ''],
    ['U-003', T, '张一鸣', 'employee', '/技术中心/后端组', '初级 Java 工程师', ''],
    ['U-004', T, '林小雨', 'employee', '/产品中心', '产品经理', ''],
    ['U-005', T, '陈明', 'hrbp', '/人力资源中心', 'HRBP', '']
  ];
  users.forEach(u => ins(`INSERT INTO users (id,tenant_id,name,role,dept_path,title,external_id,is_active)
    VALUES (?,?,?,?,?,?,?,1)`, ...u));

  const jobRows = [];
  JOBS.forEach(j => {
    const [id, industry, title, dept, mustYears, eduRank, salary, openedAt, headcount, must, nice] = j;
    const keywords = extractKeywords([...must, ...nice]);
    const rubric = JSON.stringify({ 技能匹配: 40, 业务匹配: 30, 稳定性: 15, 加分项: 15 });
    const job = { id, industry, title, must_have: must, nice_have: nice, keywords, must_years: mustYears, must_edu_rank: eduRank };
    jobRows.push(job);
    ins(`INSERT INTO jobs (id,tenant_id,title,dept_path,must_have,nice_have,rubric,must_years,must_edu_rank,status,
          industry,jd_text,keywords,headcount,salary,opened_at,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,'open',?,NULL,?,?,?,?,'U-001')`,
      id, T, title, dept, JSON.stringify(must), JSON.stringify(nice), rubric,
      mustYears, eduRank, industry, JSON.stringify(keywords), headcount, salary, openedAt);
  });

  /* 主要演示岗位手写候选人（保留原有叙事：可追溯评分、扫描件解析失败、人工推翻） */
  const cands = [
    ['C-2081', 'J-118', '王思远', '男', '1995-03', 6.5, 3, '硕士 · 北京邮电大学 · 计算机', '某电商平台（4年2个月）',
      ['Java', 'Spring Cloud', 'MySQL', 'Redis', '微服务'], ['电商', '交易', '订单'], ['开源项目', '高并发'], '猎聘', '待人工复核', 1],
    ['C-2079', 'J-118', '陈书瑶', '女', '1993-11', 8.2, 2, '本科 · 某 211 · 软件工程', '某金融科技公司（5年）',
      ['Java', '分布式', 'Kafka', '架构设计'], ['金融', '交易'], ['技术负责人', '大厂背景'], '主动投递', '待人工复核', 1],
    ['C-2076', 'J-118', '刘天成', '男', '1999-07', 3.1, 2, '本科 · 某双非院校 · 计算机', '某 SaaS 公司（3年）',
      ['Java', 'Spring Boot', 'MySQL'], ['SaaS'], [], 'BOSS直聘', '待人工复核', 1],
    ['C-2074', 'J-118', '赵一诺', '女', '1992-02', 9.4, 3, '硕士 · 某 985 · 计算机', '某大厂（6年）',
      ['Java', '微服务', '高并发', '分布式'], ['电商', '交易', '订单'], ['大厂背景', '内部推荐', '技术负责人'], '内部推荐', '待人工复核', 1],
    ['C-2072', 'J-118', '郑云舒', '女', '1997-08', 4.2, 2, '本科 · 某省属重点大学 · 软件工程', '某中型互联网公司（4年）',
      ['Java', 'MySQL', 'Redis', '微服务'], ['电商'], ['开源项目'], '脉脉', '待人工复核', 1],
    ['C-2070', 'J-118', '孙浩然', '男', '2001-05', 2.2, 1, '大专 · 某职业院校', '某外包公司（2年）',
      ['Java'], [], [], '主动投递', '待人工复核', 1],
    ['C-2066', 'J-121', '周雨薇', '女', '1996-09', 4.3, 3, '硕士 · 某 211 · 人力资源管理', '某互联网公司（3年）',
      ['HRBP', '组织发展'], ['技术团队'], ['数据分析能力'], '猎聘', '待人工复核', 1],
    ['C-2063', 'J-121', '吴子墨', '男', '1997-12', 2.6, 2, '本科 · 某双非 · 行政管理', '某制造企业（2年）',
      ['招聘管理', '员工关系'], [], [], 'BOSS直聘', '待人工复核', 0]
  ];
  const insCand = (c, jobId, synth) => ins(
    `INSERT INTO candidates (id,tenant_id,job_id,name,gender,birth_date,years_exp,edu_rank,edu_text,company,
     skills,business_tags,plus_tags,source,stage,parse_ok,consent_given,synthesized,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,date('now','-1 day'))`,
    c[0], T, jobId, c[1], c[2], c[3], c[4], c[5], c[6], c[7],
    JSON.stringify(c[8]), JSON.stringify(c[9]), JSON.stringify(c[10]), c[11], c[12], c[13], synth ? 1 : 0);
  cands.forEach(c => insCand([c[0], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12], c[13], c[14]], c[1], false));

  /* 其余岗位：自动生成演示简历，保证任意岗位点「运行筛选 Agent」都有数据 */
  const handJobs = ['J-118', 'J-121'];
  jobRows.filter(j => !handJobs.includes(j.id)).forEach(j => {
    const r = rng(j.id);
    const n = 3 + Math.floor(r() * 3);
    synthCandidates(j, n).forEach(c => insCand(
      [c.id, c.name, c.gender, c.birth, c.years, c.eduRank, c.eduText, c.company,
        c.skills, c.businessTags, c.plusTags, c.source, '待人工复核', c.parseOk], j.id, true));
  });

  ins(`INSERT INTO leave_balance (user_id,annual_total,annual_used,carryover) VALUES ('U-003', 10, 6.5, 2.0)`);
  ins(`INSERT INTO leave_balance (user_id,annual_total,annual_used,carryover) VALUES ('U-004', 5, 1.0, 0)`);

  const docs = [
    ['KB-018', '员工手册（2026 修订版）', 'v3.2', '2026-01-01', 'all', '2026-08-14'],
    ['KB-021', '假期管理制度', 'v2.6', '2026-04-01', 'all', '2026-07-30'],
    ['KB-027', '社保公积金缴纳说明（北京）', 'v1.9', '2026-07-01', 'all', '2026-07-02'],
    ['KB-031', '试用期与转正管理规定', 'v1.4', '2026-03-01', 'all', '2026-06-11'],
    ['KB-035', '考勤与加班管理办法', 'v2.1', '2026-05-01', 'all', '2026-09-02']
  ];
  docs.forEach(d => ins(`INSERT INTO kb_documents (id,tenant_id,title,ver,effective_at,visibility,status,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`, d[0], T, d[1], d[2], d[3], 'all', 'active', d[5]));

  const chunks = [
    ['KB-021', '年假按入职年限计算：入职满 1 年享受 10 天年假，按在职月份折算。上年度未休年假最多可结转 5 天至本年度，结转部分须在本年度 12 月 31 日前使用完毕，逾期清零。', ['年假', '调休', '假期', '余额', '结转']],
    ['KB-021', '婚假 10 天（含法定与奖励假）；产假 158 天；陪产假 15 天；病假需提供二级以上医院证明，病假工资按北京市规定执行。', ['婚假', '产假', '病假', '陪产假']],
    ['KB-027', '公司按北京市规定足额缴纳五险一金，缴纳基数为本人上年度月平均工资（新入职员工按首月工资），每年 7 月随社平工资调整同步调基。', ['社保', '五险', '基数', '缴纳', '公积金']],
    ['KB-027', '公积金缴存比例为 12%（公司与个人同比例），每月 15 日前完成当月缴纳。户口在外地不影响在北京参保，社保转移可在北京人社线上渠道办理。', ['公积金', '比例', '缴纳', '户口', '转移']],
    ['KB-035', '公司实行弹性工作制：每个工作日 10:00 前打卡到岗，当日工作满 8 小时。加班需提前在系统提交申请并经直属上级审批，加班可申请调休，调休需在 3 个月内使用。', ['考勤', '打卡', '迟到', '加班', '调休', '弹性']],
    ['KB-035', '每月迟到累计 3 次以上影响当月考勤考核评分。出差需提前提交出差申请，未经审批的差旅费用原则上不予报销。', ['迟到', '出差', '报销']],
    ['KB-018', '报销流程：在 OA 提交报销单 → 上传发票原件照片 → 直属上级审批 → 财务复核 → 每月 25 日统一打款。发票抬头须为公司全称，个人抬头发票无法报销。', ['报销', '发票', '差旅']],
    ['KB-031', '试用期为 3 个月（特殊岗位可约定 6 个月），试用期工资按约定标准的 100% 发放。试用期结束前 15 天，系统自动提醒直属上级发起转正考核，考核通过后次月 1 日转正。', ['试用期', '转正', '考核']],
    ['KB-031', '如需延长试用期，须在到期前 7 天由直属上级提出申请并经 HRD 审批，延长后总时长不得超过法定上限。', ['试用期', '延长']]
  ];
  chunks.forEach(c => ins(`INSERT INTO kb_chunks (doc_id,content,keywords) VALUES (?,?,?)`,
    c[0], c[1], JSON.stringify(c[2])));

  const audits = [
    ['user', 'U-002', null, '查看候选人简历原文', 'candidate', 'C-2074', '招聘专员查看候选人简历', 'ok'],
    ['agent', 'U-001', null, '回答员工提问', 'user', 'U-003', '依据《假期管理制度》v2.6 · 引用 2 处', 'ok'],
    ['system', null, null, '生成人力日报', 'report', 'daily', '推送至飞书 HR 管理群', 'ok'],
    ['system', null, null, '拦截越权请求', 'api', '/employees/export', '员工角色尝试导出全公司花名册 → 403', 'blocked'],
    ['agent', 'U-001', null, '简历打分', 'job', 'J-118', 'PII 脱敏已生效；受保护字段已物理剔除', 'ok']
  ];
  audits.forEach((a, i) => ins(
    `INSERT INTO audit_logs (tenant_id,actor_type,actor_id,task_id,action,object_type,object_id,detail,result,created_at)
     VALUES (?,?,?,?,?,?,?,?,?, datetime('now','localtime','-${(i + 1) * 40} minutes'))`,
    T, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]));
}

/* ---------- 批量写入包一层事务 ----------
   node:sqlite 默认每条语句自动提交，在 Windows 上每写一条都要 fsync 一次。
   实测 seed（21 个岗位 + 79 份候选人 + 知识库 + 审计 ≈ 120 条写）要 6.8 秒 ——
   而这是同步阻塞事件循环的，期间 keep-alive 连接会被空闲超时掐断，
   客户端复用该连接的下一个请求就报 ECONNRESET（表现为「点重置后偶发 fetch failed」）。
   包成单事务后写入只提交一次，耗时降到 50ms 量级，根因一并消除。 */
function inTx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* 回滚失败不掩盖原始错误 */ } throw e; }
}

/* 重置：清空全部业务数据并重新写入种子（不删库文件，避免 Windows 文件锁 EBUSY） */
function reseedRuntime(db) {
  return inTx(db, () => {
    /* audit_logs 受 v4 迁移的「append-only 触发器」保护，物理上禁止 DELETE。
       「重置演示数据」是**唯一**允许越过它的场景，因此显式摘除再恢复 ——
       用一个带名字的函数把风险框住，比偷偷绕过约束诚实。
       注意：sessions 与 retention_policies 属于「配置/身份」而非「演示数据」，刻意保留，
       所以重置后不需要重新登录、留存策略也不丢。 */
    migrations.withoutAuditGuards(db, () => {
      db.exec(`DELETE FROM consents; DELETE FROM erasure_requests;
               DELETE FROM interviews; DELETE FROM offers;
               DELETE FROM candidates; DELETE FROM approvals; DELETE FROM agent_tasks; DELETE FROM tool_calls;
               DELETE FROM unanswered_questions; DELETE FROM audit_logs;
               DELETE FROM kb_chunks; DELETE FROM kb_documents; DELETE FROM leave_balance;
               DELETE FROM jobs; DELETE FROM users; DELETE FROM tenants;`);
    });
    seed(db);
  });
}

function open(reset) {
  if (reset && fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  const db = new DatabaseSync(DB_FILE);
  /* WAL：读写并发更友好（读不阻塞写），且写入提交不必每次都等全库 fsync。
     对「一个进程同步写 + 多个请求读」的本场景是实打实的改善。 */
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch { /* 不支持则退回默认日志模式 */ }
  try { db.exec('PRAGMA busy_timeout = 5000;'); } catch { /* 忽略 */ }

  /* 版本化迁移：可从**空库**一键建到最新版本；已有库只跑增量。 */
  const mig = migrations.run(db);

  const n = db.prepare(`SELECT COUNT(*) AS c FROM tenants`).get().c;
  if (n === 0) inTx(db, () => seed(db));
  db.__migration = mig;
  return db;
}

module.exports = { open, DB_FILE, reseedRuntime, migrate: (db) => migrations.run(db), schemaVersion,
  synthCandidates, extractKeywords, INDUSTRY_SKILLS, INDUSTRIES, migrations };
