'use strict';
/* ===========================================================
   L4 · 岗位资料库读取（referenceJobs）
   职责：把 BOSS 直聘抓取入库的「市场公开在招岗位」提供给 JD 生成链路作参考。

   设计要点：
   - 这张表是**只读参考**，不参与本公司招聘流程，也不进打分关键词通道。
   - 读取做了**静默降级**：表不存在 / 字段缺失 / 查询异常时返回空数组，
     绝不让「参考」这个增强项拖垮主流程（生成 JD 无论如何都要能出）。
   - 匹配用 JS 打分（标题包含 / 行业包含 / 词元重叠），不依赖 SQL LIKE，
     避免中文分词问题；表本身小（几百~几千行），全量拉后在内存排序足够。
   =========================================================== */
function norm(s) { return (s || '').toString().trim().toLowerCase(); }

const SELECT_COLS = [
  'id', 'job_title', 'job_description', 'salary_range', 'location',
  'company_name', 'company_industry', 'company_scale', 'source_url',
  'skill_labels', 'scraped_at'
].join(', ');

/** 资料库总条数（供自检 / 前端展示用） */
function countAll(db) {
  try {
    const r = db.prepare(`SELECT COUNT(*) c FROM reference_jobs`).get();
    return r ? Number(r.c) : 0;
  } catch { return 0; }
}

/** 职能后缀类 2-gram：太泛，不能作为「同类岗位」的判据 */
const GENERIC_GRAMS = new Set([
  '工程', '程师', '工程师', '经理', '专员', '主管', '顾问', '助理', '总监', '设计', '计师', '设计师',
  '开发', '发工', '运营', '销售', '实习', '实习', '岗位',
]);

/** 从中文标题里取 2-gram 关键词（用于「律师 ⊂ 执业律师」这类包含关系） */
function titleGrams(title) {
  const s = (title || '').replace(/[^\u4e00-\u9fa5]/g, '');
  const out = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s.slice(i, i + 2);
    if (!GENERIC_GRAMS.has(g)) out.push(g);
  }
  return out;
}

/** 常见城市名：用于把完整地址归一成「市级」 */
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '南京', '武汉', '西安', '苏州',
  '天津', '重庆', '长沙', '郑州', '青岛', '宁波', '东莞', '佛山', '合肥', '无锡', '厦门', '福州',
  '济南', '大连', '沈阳', '昆明', '哈尔滨', '长春', '石家庄', '南宁', '贵阳', '太原', '乌鲁木齐',
  '兰州', '海口', '呼和浩特', '银川', '西宁', '拉萨', '中国香港', '中国澳门', '中国台湾'];

/**
 * 地址 → 市级。BOSS 存的是「上海长宁区尚嘉中心」这类完整地址，智联存「北京·朝阳·建外」，
 * 直接拼进 JD 引言会变成一句难读的长串，所以统一归一。
 * 认不出城市时返回 ''（**宁缺勿糙**：宁可少一句「主要集中在」也不写错地名）。
 */
function cityOf(loc) {
  const head = (loc || '').toString().trim().split(/[·\s,，]/)[0];
  if (!head) return '';
  for (const c of CITIES) if (head.startsWith(c)) return c;
  const m = head.match(/^([\u4e00-\u9fa5]{2,4}?)市/);   // 「珠海市香洲区」→「珠海市」
  if (m) return m[1] + '市';
  return /^[\u4e00-\u9fa5]{2,4}$/.test(head) ? head : '';
}

/** 按标题 / 行业相关性从资料库取 Top-N 参考岗位 */
function loadReference(db, { title = '', industry = '', limit = 12 } = {}) {
  let rows = [];
  try {
    rows = db.prepare(`SELECT ${SELECT_COLS} FROM reference_jobs`).all();
  } catch { return []; }
  if (!rows.length) return [];

  const t = norm(title);
  const ind = norm(industry);
  const tTokens = t ? t.split(/\s+/).filter(Boolean) : [];
  const grams = titleGrams(title);

  const scored = rows.map(r => {
    const rt = norm(r.job_title);
    const ri = norm(r.company_industry);
    let score = 0;
    let hit = false;
    if (t && rt === t) { score += 6; hit = true; }
    else if (t && rt.includes(t)) { score += 4; hit = true; }
    for (const w of tTokens) {
      if (w.length >= 2 && rt.includes(w)) { score += 2; hit = true; }
    }
    /* 中文包含关系：整串对不上的时候，用 2-gram 兜底（「专职律师」↔「执业律师」共享「律师」）。
       泛后缀（工程师/经理…）已在 titleGrams 里剔除，避免「Java 后端工程师」被算成
       「AI Agent 开发工程师」的同类。 */
    if (!hit) {
      for (const g of grams) if (rt.includes(g)) { score += 1; hit = true; break; }
    }
    if (!hit) return null;                     // ★ 行业相同只是加分项，不能单独构成「同类岗位」
    if (ind && ri.includes(ind)) score += 3;
    if (ind && ri === ind) score += 2;
    return { ...r, score };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * 生成接地文案：把参考岗位浓缩成一句「已对齐真实在招口径」的说明。
 * 仅在确有参考岗位时返回非空字符串，调用方自行决定是否拼进 JD 引言。
 */
function marketNote(refs) {
  if (!refs || !refs.length) return '';
  const titles = [...new Set(refs.map(r => r.job_title).filter(Boolean))].slice(0, 4);
  const salaries = [...new Set(refs.map(r => r.salary_range).filter(Boolean))].slice(0, 3);
  /* 地点只取市级：库里混着「上海长宁区尚嘉中心」（BOSS）与「北京·朝阳·建外」（智联），
     直接拼会出长串/错串，统一走 cityOf() 归一。 */
  const cities = [...new Set(refs.map(r => cityOf(r.location)).filter(Boolean))].slice(0, 3);
  /* 措辞不写死「BOSS 直聘」：资料库同时收了 BOSS（JD 全）与智联（薪资全）两个来源，
     写死平台名会在只有智联数据时变成假话。 */
  const parts = [`已参考市场在招同类岗位 ${refs.length} 个`];
  if (titles.length) parts.push(`真实岗位名如「${titles.join('」「')}」`);
  if (salaries.length) parts.push(`常见薪资区间 ${salaries.join(' / ')}`);
  if (cities.length) parts.push(`主要集中在 ${cities.join('、')}`);
  return parts.join('，') + '；岗位要求与薪资口径已对齐真实在招市场。';
}

module.exports = { loadReference, countAll, marketNote, norm, titleGrams, cityOf };
