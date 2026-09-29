/* ===========================================================
   HR-Agent OS · 人工推翻原因枚举（前后端共用单一数据源）
   -----------------------------------------------------------
   为什么要有这个文件：
     产品文案一直承诺「推翻原因会进入优化数据集」。但在枚举出现之前，
     原因只是一段自由文本 —— 存得下、**用不了**：没法统计、没法排序、
     没法回答「我们的规则最常错在哪」。于是那句承诺是空的。
     把它变成枚举之后，原因可以被聚合，直接产出「下一步该修什么」的清单。

   为什么抽成独立文件（与 shared/req-lib.js 同样理由）：
     后端（server/routes.js）要校验，离线原型（src/app.js）要渲染下拉，
     两边必须是同一份枚举，否则会出现「前端能选、后端不认」。

   两条纪律（写在文件里，改之前先读）：
     ① human_decision 只有三个合法值，且语义互斥：
        confirmed           = 人工确认 AI 结论（→ 这是一条「一致」样本）
        approved_by_human   = 人工推进  （AI 判不合适，人认为该聊 → 不一致）
        rejected_by_human   = 人工否决  （AI 判合适，人认为不该推 → 不一致）
     ② 原因码只对**推翻**要求；确认无需原因（确认本身就是「无异议」）。
   =========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OverrideCodes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 人工结论（方向） ---------- */
  const DECISIONS = [
    { value: 'confirmed',         label: '确认 AI 结论', short: '确认' },
    { value: 'approved_by_human', label: '人工推进（AI 判不合适，人认为该聊）', short: '推翻·推进' },
    { value: 'rejected_by_human', label: '人工否决（AI 判合适，人认为不该推）', short: '推翻·否决' },
  ];

  /* ---------- 推翻原因码 ----------
     每一条都对应一种「算法为什么错」的可解释假设，
     而不是「不喜欢这个人」这类无法归因的说法。 */
  const CODES = [
    { code: 'keyword_fuzzy',   label: '关键词误命中（近似词被算作命中，如 JavaScript 命中 Java）' },
    { code: 'keyword_miss',    label: '关键词漏命中（真实具备但用词不同，如「分布式」对应「微服务」）' },
    { code: 'experience_lost', label: '经验价值未被算法捕捉（项目成果 / 影响面未结构化）' },
    { code: 'gate_too_strict', label: '硬性门槛过严（年限 / 学历误杀）' },
    { code: 'biz_overrated',   label: '业务背景被高估（标签命中但深度不足）' },
    { code: 'plus_overrated',  label: '加分项被高估（证书 / 竞赛与实际能力不符）' },
    { code: 'parse_failed',    label: '简历解析失败导致误判' },
    { code: 'compliance',      label: '合规 / 歧视风险，人工直接干预' },
    { code: 'other',           label: '其他（必须在原因中写清）' },
  ];

  const CODE_SET = new Set(CODES.map(c => c.code));
  const DECISION_SET = new Set(DECISIONS.map(d => d.value));

  const isValidCode = c => c != null && CODE_SET.has(String(c));
  const isValidDecision = d => d != null && DECISION_SET.has(String(d));
  const labelOfCode = c => {
    const x = CODES.find(y => y.code === c);
    return x ? x.label : '未分类';
  };
  const labelOfDecision = d => {
    const x = DECISIONS.find(y => y.value === d);
    return x ? x.label : String(d == null ? '' : d);
  };

  /** AI 档位是否「建议推进」（strong / ok 都算建议推进）。 */
  const aiAdvisesAdvance = g => g === 'strong' || g === 'ok';

  /**
   * 人工结论是否与 AI 结论**一致**。
   *
   * 只可能有两种结果，因为记录只在人工主动表态时发生：
   *   confirmed                  → 一致（人工为 AI 背书）
   *   approved / rejected_by_human → 不一致（就是一次推翻）
   *
   * aiGrade 只用来判断「推翻往哪个方向」（见 oppositeOf / aiAdvisesAdvance），
   * 不参与「是否一致」—— 一旦推翻，无论方向，答案都是不一致。
   * 之所以仍保留这个入参：调用点天然拿着 aiGrade，且需要它做空值守卫。
   *
   * @returns {boolean|null} null = 样本缺失，不计入一致率
   */
  function agrees(aiGrade, humanDecision) {
    if (!aiGrade || !humanDecision) return null;
    return humanDecision === 'confirmed';
  }

  /** 由 AI 档位推出「若不认同 AI，人工应该往哪个方向走」。用于前端按钮语义。 */
  function oppositeOf(aiGrade) {
    return aiAdvisesAdvance(aiGrade) ? 'rejected_by_human' : 'approved_by_human';
  }

  return {
    DECISIONS, CODES, CODE_SET, DECISION_SET,
    isValidCode, isValidDecision, labelOfCode, labelOfDecision,
    aiAdvisesAdvance, agrees, oppositeOf,
  };
});
