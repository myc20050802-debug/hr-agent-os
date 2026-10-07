window.slideDataMap.set(11, `
<div class="ed-page">
    <div class="ed-glow" style="background:
        radial-gradient(680px 460px at 78% 96%, rgba(251,191,36,.12), transparent 70%),
        radial-gradient(680px 460px at 6% 0%, rgba(56,189,248,.12), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">11</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Metrics</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>06 / Metrics &nbsp;·&nbsp; n = 30 &nbsp;·&nbsp; rubric v1</div>
                <h2 class="ed-title">三个指标与一条红线</h2>
                <div class="ed-sub">说得出指标背后的业务取舍，比报一个漂亮数字更有说服力</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;">
        <div style="padding:40px 0 38px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);display:grid;grid-template-columns:repeat(4,1fr);">
            <div class="ed-cell">
                <div class="ed-num">96.7<span style="font-size:32px;">%</span></div>
                <div class="ed-k" style="color:#93A4BF;margin-top:16px;">Metric 01 · 档位一致率</div>
                <div class="ed-cap" style="margin-top:10px;">29 / 30，严格三档一致</div>
            </div>
            <div class="ed-cell">
                <div class="ed-num">100<span style="font-size:32px;">%</span></div>
                <div class="ed-k" style="color:#93A4BF;margin-top:16px;">Metric 02 · ±1 档一致率</div>
                <div class="ed-cap" style="margin-top:10px;">从没出现「差两档」的离谱判断</div>
            </div>
            <div class="ed-cell">
                <div style="display:flex;align-items:baseline;gap:12px;">
                    <div class="ed-num" style="color:#FBBF24;">0.0<span style="font-size:32px;">%</span></div>
                    <span class="ed-chip amber">红线</span>
                </div>
                <div class="ed-k" style="color:#FBBF24;margin-top:16px;">Metric 03 · 漏筛率</div>
                <div class="ed-cap" style="margin-top:10px;">把好简历判死的代价<br>远高于把差简历放进面试</div>
            </div>
            <div class="ed-cell">
                <div class="ed-num" style="color:#93A4BF;">8.3<span style="font-size:32px;">%</span></div>
                <div class="ed-k" style="color:#93A4BF;margin-top:16px;">Counterpart · 误筛率</div>
                <div class="ed-cap" style="margin-top:10px;">12 个应拒样本里放了 1 个进来<br>—— 宁可多聊一轮，不可错杀</div>
            </div>
        </div>

        <div style="margin-top:50px;display:grid;grid-template-columns:1fr 1fr;gap:44px;">
            <div style="padding-top:14px;border-top:1px solid var(--line2);">
                <div class="ed-k" style="color:#5A6A85;">统计诚实</div>
                <div class="ed-p" style="margin-top:8px;">
                    样本只有 30 例 —— 所以不只报点估计：同时给出 Wilson 95% 置信区间
                    <span class="ed-accent">[83.3%, 99.4%]</span>。主动暴露区间偏宽，比藏起来更可信。
                </div>
            </div>
            <div style="padding-top:14px;border-top:1px solid var(--line2);">
                <div class="ed-k" style="color:#5A6A85;">门槛拦截 9 例</div>
                <div class="ed-p" style="margin-top:8px;">
                    年限 <span class="ed-b">×2</span> · 学历 <span class="ed-b">×1</span> ·
                    技能零命中 <span class="ed-b">×6</span> —— 这些在看分数之前就被拦掉了。
                </div>
            </div>
        </div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>11</em> / 19</span>
    </div>
</div>
`);
