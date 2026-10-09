window.slideDataMap.set(12, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(820px 520px at 100% 0%, rgba(34,211,238,.13), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">12</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Iteration</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>07 / Iteration</div>
                <h2 class="ed-title">一次真实的迭代</h2>
                <div class="ed-sub">评测驱动，不是拍脑袋调阈值 —— 我改的是「判定链条」，不是「业务维度计数」</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div style="margin-top:22px;display:flex;flex-direction:column;">
            <div style="display:grid;grid-template-columns:230px 120px 54px 130px 1fr;align-items:center;padding:16px 0;border-bottom:1px solid var(--line);">
                <div class="ed-h3" style="font-size:19px;">档位一致率</div>
                <div style="font-family:var(--font-title);font-size:30px;font-weight:700;color:#5A6A85;text-decoration:line-through;text-decoration-color:rgba(90,106,133,.6);">90.0%</div>
                <div class="ed-cy" style="font-size:20px;">→</div>
                <div style="font-family:var(--font-title);font-size:32px;font-weight:700;color:#F2F6FF;">96.7%</div>
                <div class="ed-p">29 / 30，严格三档一致</div>
            </div>
            <div style="display:grid;grid-template-columns:230px 120px 54px 130px 1fr;align-items:center;padding:16px 0;border-bottom:1px solid var(--line);">
                <div class="ed-h3" style="font-size:19px;">误筛率</div>
                <div style="font-family:var(--font-title);font-size:30px;font-weight:700;color:#5A6A85;text-decoration:line-through;text-decoration-color:rgba(90,106,133,.6);">25.0%</div>
                <div class="ed-cy" style="font-size:20px;">→</div>
                <div style="font-family:var(--font-title);font-size:32px;font-weight:700;color:#F2F6FF;">8.3%</div>
                <div class="ed-p">应拒样本放进来的比例，大幅下降</div>
            </div>
            <div style="display:grid;grid-template-columns:230px 120px 54px 130px 1fr;align-items:center;padding:16px 0;border-bottom:1px solid var(--line);">
                <div>
                    <div class="ed-h3" style="font-size:19px;">漏筛率</div>
                    <span class="ed-chip amber" style="margin-top:6px;">红线</span>
                </div>
                <div style="font-family:var(--font-title);font-size:30px;font-weight:700;color:#5A6A85;">0%</div>
                <div class="ed-cy" style="font-size:20px;">→</div>
                <div style="font-family:var(--font-title);font-size:32px;font-weight:700;color:#FBBF24;">0%</div>
                <div class="ed-p">守住 —— 这是选方案时的硬约束，不是可选项</div>
            </div>
        </div>

        <div style="margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:26px;">
            <div class="ed-panel">
                <span class="ed-tick tl"></span><span class="ed-tick br"></span>
                <div class="ed-k">怎么选的</div>
                <div class="ed-p" style="margin-top:9px;">
                    5 个候选方案逐一实测，只有这一个同时满足「一致率不降 <b>且</b> 漏筛不涨」。
                    它带来的是 <span class="ed-b">一致率 +6.7pt · 误筛 −16.7pt · 漏筛不动</span> ——
                    三个数出自同一次改动、同一次跑分，不是分别调出来的。
                </div>
            </div>
            <div class="ed-panel alert">
                <span class="ed-tick tl"></span><span class="ed-tick br"></span>
                <div class="ed-k" style="color:#FBBF24;">被否决的方案</div>
                <div class="ed-p" style="margin-top:9px;">
                    「业务维度与职能族词表求交」看起来更聪明，实测一致率仅 73.3%、
                    <span class="ed-warn">漏筛 0% → 22.2%</span>，直接破了红线 —— 因此明确否决。
                </div>
            </div>
        </div>

        <div class="ed-banner" style="margin-top:auto;">
            评测的作用不是给一个分数，而是 <span class="ed-cy" style="font-weight:700;">帮我否决看起来更「聪明」的方案</span>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>12</em> / 19</span>
    </div>
</div>
`);
