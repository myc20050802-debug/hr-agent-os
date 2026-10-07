window.slideDataMap.set(10, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(800px 520px at 100% 0%, rgba(56,189,248,.13), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">10</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Golden Set</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>05 / Evaluation</div>
                <h2 class="ed-title">黄金集与标注口径</h2>
                <div class="ed-sub">标准答案该怎么造，才能让人信 —— 面试官一定会追问「你这个集子怎么来的」</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-tl" style="margin-top:20px;">
            <div class="ed-tl-item" style="display:grid;grid-template-columns:52px 160px 1fr;gap:24px;align-items:start;">
                <div class="ed-n">01</div>
                <div class="ed-h3" style="font-size:19px;">规模</div>
                <div class="ed-p" style="font-size:13.5px;">30 例（3 个岗位 × 各 10 例），人工标注，三档标签 <span class="ed-cy">strong / ok / no</span></div>
            </div>
            <div class="ed-tl-item" style="display:grid;grid-template-columns:52px 160px 1fr;gap:24px;align-items:start;">
                <div class="ed-n">02</div>
                <div class="ed-h3" style="font-size:19px;">判定顺序</div>
                <div class="ed-p" style="font-size:13.5px;">先过硬性门槛（年限 / 学历 / 技能相关性），再定档位 —— 顺序反了，会把「技能很全但年限不够」标成优秀。</div>
            </div>
            <div class="ed-tl-item" style="display:grid;grid-template-columns:52px 160px 1fr;gap:24px;align-items:start;">
                <div class="ed-n">03</div>
                <div class="ed-h3" style="font-size:19px;">证据来源</div>
                <div class="ed-p" style="font-size:13.5px;">只看简历原文 + 岗位要求，<span class="ed-warn">禁止偷看算法输出</span> —— 看一眼，就等于把规则抄成了答案。</div>
            </div>
            <div class="ed-tl-item" style="display:grid;grid-template-columns:52px 160px 1fr;gap:24px;align-items:start;">
                <div class="ed-n">04</div>
                <div class="ed-h3" style="font-size:19px;">口径冻结</div>
                <div class="ed-p" style="font-size:13.5px;">
                    <span class="ed-cy">rubricVersion = 1</span> 写进代码、可机器校验：枚举合法 / id 唯一 / jobId 无悬空 / 每岗位 ≥10 例 / 每岗 ≥1 陷阱探针 / 三档占比 ∈[20%,50%]。
                </div>
            </div>
            <div class="ed-tl-item" style="display:grid;grid-template-columns:52px 160px 1fr;gap:24px;align-items:start;">
                <div class="ed-n">05</div>
                <div class="ed-h3" style="font-size:19px;">扩样方案</div>
                <div class="ed-p" style="font-size:13.5px;">独立成文：7 个必须先拍死的决策、三层难度配额、一致性验证 —— <span class="ed-b">不拿规则输出当答案</span>。</div>
            </div>
        </div>

        <div class="ed-banner" style="margin-top:auto;">
            标准答案必须同时具备三个属性 —— <span class="ed-cy" style="font-weight:700;">独立性</span> ·
            <span class="ed-cy" style="font-weight:700;">稳定性</span> ·
            <span class="ed-cy" style="font-weight:700;">够难</span>；缺一个，评测数字就变成「自证」
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>10</em> / 19</span>
    </div>
</div>
`);
