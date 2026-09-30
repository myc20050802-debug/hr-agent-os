/* ===========================================================
   HR-Agent OS · 打分归因（前后端共用单一来源）
   -----------------------------------------------------------
   为什么要有这个文件：
     产品一直说「分数可解释」。但在此之前，界面上只有一张「维度 / 得分 / 依据」
     表格 —— 它解释的是**每一维**，没有解释**总分**。
     用户真正会问的是「为什么是 64 分」，而不是「技能为什么是 38 分」。
     两者差一层：总分 = 各维满分 × 达成系数，四维相加。少了这层算式，
     64 这个数字就只是四个数字的巧合，说服不了任何人（HR 看分数时第一反应就是「凭什么是这个数」）。

     所以这里做两件事：
       ① 把「系数阶梯」固化成唯一来源（原本前端 agent.js 与后端 engine.js
          各抄了一份，改一处忘一处就会两边口径分叉）；
       ② 从**已经算好的分数**反推归因 —— 不是另一套算法，而是同一组数字的
          另一种表述。这样解释永远不会和分数对不上。

   设计纪律（改之前先读）：
     ① 归因不许引入新的权重。`explain()` 只读 dims 里已经存在的 coef，
        不做二次计算 —— 否则它迟早会算出和总分不一致的结论。
     ② 不许编不存在的证据。所有文案里的数字（命中几项、差几分、缺几个标签）
        都必须由入参算出来，不能写死。
     ③ 分数变了、文案没变，是 bug。所以两侧打分函数都从 LADDERS 取系数。

   口径：与 server/engine.js 的 scoreOne、src/agent.js 的 scoreResume 一致。
   =========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScoreWhy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 归因结果的版本号。存库时一并写下来，将来判断「这条解释是不是旧口径」。 */
  const VER = 1;

  /* ---------- 一、四维系数阶梯（分数的唯一来源） ----------
     max  : 满分
     steps: 升序的 [阈值 → 系数]，取「小于等于当前值的最大阈值」那一档
     metric='years' 的维度不是阶梯而是比例，单独实现 */
  const LADDERS = {
    skill: {
      dim: '技能匹配', max: 40, metric: 'coverage', unit: '覆盖率',
      steps: [
        { at: 0, coef: 0.35 }, { at: 0.2, coef: 0.55 }, { at: 0.35, coef: 0.7 },
        { at: 0.5, coef: 0.85 }, { at: 0.7, coef: 0.95 },
      ],
    },
    biz: {
      dim: '业务匹配', max: 30, metric: 'hits', unit: '个业务标签',
      steps: [
        { at: 0, coef: 0.2 }, { at: 1, coef: 0.55 }, { at: 2, coef: 0.72 },
        { at: 3, coef: 0.9 }, { at: 4, coef: 1 },
      ],
    },
    stab: {
      dim: '稳定性', max: 15, metric: 'years', unit: '年', steps: [],
      /* 年限越富余系数越高；岗位不设年限门槛时固定 0.8（与后端一致） */
      coefOf(needYears, years) {
        if (!(needYears > 0)) return 0.8;
        return years >= needYears * 2 ? 1 : years >= needYears * 1.3 ? 0.87
          : years >= needYears ? 0.75 : 0.5;
      },
    },
    plus: {
      dim: '加分项', max: 15, metric: 'hits', unit: '个加分标签',
      steps: [{ at: 0, coef: 0 }, { at: 1, coef: 0.55 }, { at: 2, coef: 0.85 }, { at: 3, coef: 1 }],
    },
  };

  const DIM_KEY = { 技能匹配: 'skill', 业务匹配: 'biz', 稳定性: 'stab', 加分项: 'plus' };

  /** 取某维在给定取值下的系数。value 的含义随 metric：coverage 用比例，hits 用个数。 */
  function coefOf(key, value, needYears) {
    const L = LADDERS[key];
    if (!L) return 0;
    if (L.metric === 'years') return L.coefOf(needYears, value);
    let c = L.steps[0].coef;
    for (const s of L.steps) if (value >= s.at) c = s.coef;
    return c;
  }

  /* ---------- 二、档位 ---------- */
  const GRADES = [
    { key: 'strong', min: 78, name: '强烈推荐', range: '78–100' },
    { key: 'ok', min: 60, name: '可聊', range: '60–77' },
    { key: 'no', min: 0, name: '不合适', range: '0–59' },
  ];
  const gradeOf = s => (s >= 78 ? 'strong' : s >= 60 ? 'ok' : 'no');
  const gradeInfo = k => GRADES.find(g => g.key === k) || GRADES[GRADES.length - 1];
  /** 比当前档再高一级的档（已是最高档返回 null）—— 用于算「还差几分」 */
  const nextGradeOf = k => GRADES[GRADES.findIndex(g => g.key === k) - 1] || null;

  /* ---------- 三、逐维「为什么是这个系数」 ---------- */
  /* 「差哪几个关键词」两侧语义不同，统一走这里取：
     离线端命中集合里放的是**关键词**，后端放的是候选人**技能**，
     后端拿不到关键词差集时会显式传 ctx.kwsMiss。 */
  const missKeywords = ctx => (ctx.kwsMiss
    || (ctx.kws || []).filter(k => (ctx.kHit || []).indexOf(k) < 0));

  function dimReason(d, ctx) {
    const dim = d.dim;
    /* 反推模式：调用方只有「已存下来的四维分数」，没有当时的命中原句。
       此时唯一的诚实做法是回放当时存下的依据，而不是拿今天的上下文去编一个理由。 */
    if (ctx.derived) return d.ev || '（按已存分数反推的归因，当时的命中明细未保存）';
    if (dim === '技能匹配') {
      const kws = ctx.kws || [], kh = ctx.kHit || [];
      if (!kws.length) return '岗位要求里没识别出可打分的技术词 → 按底分系数计，建议在要求里写明技术栈';
      if (!kh.length) return `岗位关键词 ${kws.length} 个全部未命中（${kws.slice(0, 3).join('、')}）→ 触底系数`;
      const miss = missKeywords(ctx);
      return `命中 ${kh.length}/${kws.length} 个岗位关键词${miss.length ? `；未命中 ${miss.slice(0, 4).join('、')}` : '（全部命中）'}`;
    }
    if (dim === '业务匹配') {
      const h = ctx.bizHits || [], pool = ctx.bizPool || [];
      const who = ctx.fnName ? ctx.fnName + '类' : '';
      if (h.length) return `命中 ${h.length} 个${who}业务标签：${h.join('、')}`;
      if (ctx.noBizPool) return `${who || '该'}岗位没有业务标签口径 → 触底系数`;
      return `未命中任何${who}业务标签${pool.length ? `（该族可用标签：${pool.slice(0, 3).join('、')}）` : ''} → 触底系数`;
    }
    if (dim === '稳定性') {
      const n = ctx.needYears || 0;
      if (!(n > 0)) return '岗位未设年限门槛 → 固定系数 0.8（不是简历没写好，是岗位没提年限）';
      if (ctx.years) return `工作 ${ctx.years} 年 vs 岗位要求 ${n} 年`;
      if (ctx.inSchool) return `在校生 / 应届，无全职年限 vs 岗位要求 ${n} 年 → 系数 0.5`;
      return `简历未体现工作年限 vs 岗位要求 ${n} 年 → 系数 0.5`;
    }
    if (dim === '加分项') {
      const h = ctx.plusHits || [];
      if (h.length) return `命中 ${h.length} 个：${h.join('、')}`;
      return '无开源 / 专利 / 大厂 / 带人 / 获奖类标签 → 系数 0（四维里唯一没有底分的一维）';
    }
    return d.ev || '';
  }

  /* ---------- 四、「再往前一步」的可执行路径 ----------
     只说「业务经验不足」没用。要说「补 2 个业务标签 → +16 分 → 进强烈推荐」，
     并且这个数字必须从阶梯里算出来，不能拍。 */
  function liftText(key, step, cur, ctx) {
    const n = Math.max(1, step.at - cur);
    const who = ctx.fnName ? ctx.fnName + '类' : '';
    if (key === 'biz') {
      const miss = (ctx.bizPool || []).filter(w => (ctx.bizHits || []).indexOf(w) < 0);
      return `简历里补 ${n} 个${who}业务标签${miss.length ? `（如 ${miss.slice(0, 3).join('、')}）` : ''}`;
    }
    if (key === 'plus') {
      const miss = (ctx.plusPool || []).filter(w => (ctx.plusHits || []).indexOf(w) < 0);
      return `再补 ${n} 个加分标签${miss.length ? `（如 ${miss.slice(0, 3).join('、')}）` : '（开源 / 专利 / 大厂 / 带人 / 获奖）'}`;
    }
    if (key === 'skill') {
      const kws = ctx.kws || [], kh = ctx.kHit || [];
      const miss = missKeywords(ctx);
      /* 只有拿得到关键词清单时才能说清「差哪几个」；
         反推模式（老数据）没有清单，只能说方向，不能编具体词。 */
      if (!kws.length) return '简历里再多覆盖几个岗位要求中的技术词';
      const need = Math.max(1, Math.ceil(step.at * kws.length) - kh.length);
      return `简历里再命中 ${need} 个岗位关键词${miss.length ? `（还差：${miss.slice(0, 3).join('、')}）` : ''}`;
    }
    return '';
  }

  /** 列出所有「往上够一档」的可行路径，按代价（涨分）升序 */
  function liftOptions(dims, ctx) {
    const out = [];
    ['skill', 'biz', 'plus'].forEach(key => {
      const L = LADDERS[key];
      const d = dims.find(x => x.dim === L.dim);
      if (!d || !d.max) return;
      /* 当前落在阶梯哪一档 —— 以**这一维实际用的系数**为准，不猜。
         这一点在反推模式（只有已存分数、没有当时明细）下尤其关键：
         若拿 ctx 里的命中数去推，命中数缺省为 0，就会把「再补 1 个」说成「再补 2 个」。 */
      let idx = L.steps.findIndex(s => Math.abs(s.coef - d.coef) < 0.004);
      if (idx < 0) idx = L.steps.reduce((acc, s, i) => (s.coef <= d.coef + 0.004 ? i : acc), 0);
      const cur = L.steps[idx].at;
      L.steps.forEach((st, i) => {
        if (i <= idx) return;
        const newDim = Math.round(d.max * st.coef);
        const delta = newDim - d.score;
        if (delta > 0) out.push({ key, dim: d.dim, at: st.at, coef: st.coef, newDim, delta, text: liftText(key, st, cur, ctx) });
      });
    });
    return out.sort((a, b) => a.delta - b.delta);
  }

  /* ---------- 五、置信度：样本太少时分数不该被当真 ---------- */
  function confidenceOf(ctx) {
    /* 反推模式没有关键词明细，就不能假装评估得了样本量 —— 老实说「未记录」 */
    if (ctx.derived) return { level: '未记录', text: '这条打分发生在归因落库之前，当时的岗位关键词明细没有保存，无法评估样本充分度。' };
    const n = (ctx.kws || []).length;
    if (!n) return { level: '低', text: '岗位要求里没抽出技术词，技能维度按底分计 —— 这份打分的区分度主要来自其余三维。' };
    if (n <= 2) return { level: '偏低', text: `岗位要求只识别出 ${n} 个关键词，技能维度命中 ${n} 个就封顶 —— 样本越少，这一维越不具区分度。` };
    if (n <= 5) return { level: '中', text: `岗位要求识别出 ${n} 个关键词，技能维度有基本区分度。` };
    return { level: '高', text: `岗位要求识别出 ${n} 个关键词，技能维度区分度充分。` };
  }

  /** 四维全触底时的理论最低分（由阶梯算出，不写死） */
  function floorScore() {
    return Math.round(LADDERS.skill.steps[0].coef * LADDERS.skill.max)
      + Math.round(LADDERS.biz.steps[0].coef * LADDERS.biz.max)
      + Math.round(LADDERS.stab.coefOf(0, 0) * LADDERS.stab.max)
      + Math.round(LADDERS.plus.steps[0].coef * LADDERS.plus.max);
  }

  function notesOf(dims, ctx) {
    const notes = [];
    const at = d => dims.find(x => x.dim === d) || {};
    const bottoms = ['技能匹配', '业务匹配'].filter(d => (at(d).coef || 0) <= 0.36).length;
    if (bottoms >= 1) {
      notes.push({
        kind: '底分机制',
        text: `四维都设了底分，所以一份完全不相干的简历也能拿到 ${floorScore()} 分（技能 ${Math.round(LADDERS.skill.steps[0].coef * 40)} + 业务 ${Math.round(LADDERS.biz.steps[0].coef * 30)} + 稳定性 ${Math.round(LADDERS.stab.coefOf(0, 0) * 15)} + 加分 0）。这是与后端 scoreOne 保持同一口径的取舍，不是加分注水。`,
      });
    }
    if (ctx.juniorJob) {
      notes.push({ kind: '层级自适应', text: '这是一份实习 / 应届 / 管培类岗位，年限维度按「不设门槛」处理，不因无全职经验扣分。' });
    }
    if (ctx.derived) {
      notes.push({ kind: '归因来源', text: '这条打分发生在「归因落库」之前，当时的命中明细没有保存；此处是按已存下的四维分数反推，算式准确，逐维理由取自当时存下的依据原句。' });
    }
    return notes;
  }

  /* ---------- 六、主入口 ---------- */
  /**
   * 从已经算好的分数反推归因。
   * @param {{score:number, dims:Array, ctx?:object}} input
   *   dims 每项：{dim, score, max, coef?, ev?}
   * @returns {object} 可直接渲染、也可直接存库的结构化归因
   */
  function explain(input) {
    /* 未评分没有「为什么」可讲，直接返回 null，由调用方决定怎么呈现「尚未评分」。
       ⚠️ 不能让它往下落到 `|| 0`：那会把「还没打分」静默变成「0 分」，
       再经 gradeOf(0) 变成「不合适」，并**编出一份 0 分的算式** ——
       一份看起来完整、实则凭空生成的归因，比没有归因更糟。
       （0 分是合法分数，只有 null / 非数字才早退。） */
    if (!input || input.score == null || !Number.isFinite(Number(input.score))) return null;
    const score = Math.round(Number(input.score));
    const ctx = (input && input.ctx) || {};
    const dims = ((input && input.dims) || []).map(d => {
      const max = d.max == null ? 0 : d.max;
      const sc = d.score == null ? 0 : d.score;
      return {
        dim: d.dim, score: sc, max, ev: d.ev || '',
        /* 调用方给了 coef 就用它（可能走的是兜底分支）；
           没给就由分/满分反推 —— 保证归因与分数永远一致 */
        coef: d.coef != null ? d.coef : (max ? Number((sc / max).toFixed(3)) : 0),
      };
    });

    const grade = gradeOf(score);
    const gi = gradeInfo(grade);
    const next = nextGradeOf(grade);

    const sum = dims.reduce((a, d) => a + d.score, 0);
    const terms = dims.map(d => {
      const lost = Math.max(0, d.max - d.score);
      return {
        dim: d.dim, score: d.score, max: d.max, coef: d.coef, lost,
        share: sum > 0 ? Math.round((d.score / sum) * 100) : 0,
        reason: dimReason(d, ctx),
      };
    });

    /* 撑住分数的 / 拖下来的 —— 各挑一个，这是「为什么是这个数」的主因 */
    const strongest = terms.slice().sort((a, b) => b.score - a.score)[0] || null;
    const weakest = terms.slice().sort((a, b) => b.lost - a.lost)[0] || null;

    const options = liftOptions(dims, ctx);
    /* 只留每维一条路径：优先「最省力的达标路径」，否则取涨幅最大的一条。
       为什么按维度去重：同一维连推两条（先够档、再拉满）读起来像复读，
       而 HR 真正要的是「先做哪件事」。更高档位的信息降级成注脚（ceiling）。 */
    const picked = [];
    let top = null;
    if (next) {
      const cross = options.filter(o => score + o.delta >= next.min);
      if (cross.length) { top = Object.assign({ reaches: next.name }, cross[0]); picked.push(top); }
    }
    if (!picked.length) {
      const best = options.slice().sort((a, b) => b.delta - a.delta)[0];
      if (best) { top = best; picked.push(top); }
    }
    if (top) {
      const higher = options.filter(o => o.key === top.key && o.delta > top.delta).sort((a, b) => b.delta - a.delta)[0];
      if (higher) { top.ceiling = { newDim: higher.newDim, delta: higher.delta, total: score + higher.delta }; }
    }

    return {
      ver: VER,
      score, grade, gradeName: gi.name, gradeRange: gi.range,
      formula: dims.map(d => d.score).join(' + ') + ' = ' + score,
      terms,
      drivers: {
        up: strongest ? { dim: strongest.dim, score: strongest.score, max: strongest.max, share: strongest.share, text: `${strongest.dim}拿到 ${strongest.score}/${strongest.max}，占总分 ${strongest.share}% —— 这份分数主要靠它撑住` } : null,
        down: weakest && weakest.lost > 0 ? { dim: weakest.dim, lost: weakest.lost, text: `${weakest.dim}丢了 ${weakest.lost} 分（${weakest.score}/${weakest.max}）—— 这是它没往上走一档的主因` } : null,
      },
      lift: picked,
      threshold: next ? { name: next.name, min: next.min, need: Math.max(0, next.min - score) } : null,
      confidence: confidenceOf(ctx),
      notes: notesOf(dims, ctx),
    };
  }

  return {
    VER, LADDERS, DIM_KEY, GRADES,
    coefOf, gradeOf, gradeInfo, nextGradeOf, explain, floorScore,
  };
});
