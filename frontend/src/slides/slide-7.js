window.slideDataMap.set(7, `
<div class="ed-page">
    <div class="ed-glow" style="background:
        radial-gradient(620px 520px at 6% 100%, rgba(56,189,248,.13), transparent 70%),
        radial-gradient(620px 520px at 96% 0%, rgba(251,191,36,.10), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">07</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Design Rules</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>03 / Design Rules</div>
                <h2 class="ed-title">三个「必须」× 三个「不做」</h2>
                <div class="ed-sub">先定不可妥协的边界，再谈功能</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-split">
            <div style="display:flex;flex-direction:column;">
                <div class="ed-k" style="color:#38BDF8;letter-spacing:.24em;">Must · 必须做到</div>
                <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;margin-top:18px;">
                    <div style="padding-bottom:16px;border-bottom:1px solid var(--line);">
                        <div class="ed-h3">必须可解释</div>
                        <div class="ed-p" style="margin-top:7px;">每个分数都能摊开算给业务方看；归因只读打分时已算出的系数、不做二次计算，测试锁死「分项之和 == 总分」。</div>
                    </div>
                    <div style="padding:16px 0;border-bottom:1px solid var(--line);">
                        <div class="ed-h3">必须可复现</div>
                        <div class="ed-p" style="margin-top:7px;">同一份简历跑两次，结果必须一致 —— 否则不能拿去和业务方对齐。</div>
                    </div>
                    <div style="padding-top:16px;">
                        <div class="ed-h3">必须留痕</div>
                        <div class="ed-p" style="margin-top:7px;">应用层只插不改，外加数据库触发器 <span class="ed-cy">RAISE(ABORT)</span> —— 想改审计，得先改 schema，而 schema 是版本化迁移管的。</div>
                    </div>
                </div>
            </div>

            <div class="divider"></div>

            <div style="display:flex;flex-direction:column;">
                <div class="ed-k" style="color:#FBBF24;letter-spacing:.24em;">Won't · 明确不做</div>
                <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;margin-top:18px;">
                    <div style="padding-bottom:16px;border-bottom:1px solid var(--line);">
                        <div class="ed-h3">不把判断权交给模型</div>
                        <div class="ed-p" style="margin-top:7px;">分数与档位全由确定性规则算出；模型只做措辞、语言组织、JD 润色。</div>
                    </div>
                    <div style="padding:16px 0;border-bottom:1px solid var(--line);">
                        <div class="ed-h3">不编硬数字</div>
                        <div class="ed-p" style="margin-top:7px;">成本与用量必须能指出来源；规则模式就是 0 调用、显示 0 —— 不拿「看起来合理」的试算值冒充真实用量。</div>
                    </div>
                    <div style="padding-top:16px;">
                        <div class="ed-h3">不让 AI 越过人工闸门</div>
                        <div class="ed-p" style="margin-top:7px;">Offer 决策、推翻 AI 结论这类高风险动作，必须留人工签批。</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>07</em> / 19</span>
    </div>
</div>
`);
