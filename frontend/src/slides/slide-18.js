window.slideDataMap.set(18, `
<div class="ed-page">
    <div class="ed-glow" style="background:
        radial-gradient(700px 460px at 100% 0%, rgba(251,191,36,.10), transparent 70%),
        radial-gradient(620px 460px at 0% 100%, rgba(56,189,248,.10), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">18</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Known Limits</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>13 / Known Limits</div>
                <h2 class="ed-title">已知边界（不藏着）</h2>
                <div class="ed-sub">说得清边界，比假装没有边界更有说服力</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-panel" style="margin-top:20px;padding:0;background:rgba(6,9,16,.7);flex:1;min-height:0;display:flex;flex-direction:column;">
            <span class="ed-tick tl"></span><span class="ed-tick br"></span>

            <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 20px;border-bottom:1px solid var(--line2);">
                <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#93A4BF;">known-limitations.md</span>
                <span class="ed-chip amber">6 items · openly listed</span>
            </div>

            <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:2px 20px;">
                <div style="display:grid;grid-template-columns:38px 190px 1fr;gap:20px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-n" style="color:#39445A;">01</div>
                    <div class="ed-h3" style="font-size:16px;">黄金集 30 例</div>
                    <div class="ed-p" style="font-size:13px;">置信区间偏宽 <span class="ed-accent">[83.3%, 99.4%]</span> · 扩样必须<span class="ed-b">独立标注</span>才有效</div>
                </div>
                <div style="display:grid;grid-template-columns:38px 190px 1fr;gap:20px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-n" style="color:#39445A;">02</div>
                    <div class="ed-h3" style="font-size:16px;">单租户</div>
                    <div class="ed-p" style="font-size:13px;">租户标识写死 · 多租户涉及数据隔离模型重设计，属企业级门槛，不在 PoC 范围</div>
                </div>
                <div style="display:grid;grid-template-columns:38px 190px 1fr;gap:20px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-n" style="color:#39445A;">03</div>
                    <div class="ed-h3" style="font-size:16px;">无真实简历入口</div>
                    <div class="ed-p" style="font-size:13px;">目前走演示数据 · 真实简历涉及个人信息合规，需先定数据来源与授权链路</div>
                </div>
                <div style="display:grid;grid-template-columns:38px 190px 1fr;gap:20px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-n" style="color:#39445A;">04</div>
                    <div class="ed-h3" style="font-size:16px;">模型未接入默认链路</div>
                    <div class="ed-p" style="font-size:13px;">规则模式跑全流程 · <span class="ed-b">这是设计选择</span>（可复现、可签字）；接模型是替换一个函数，不改架构</div>
                </div>
                <div style="display:grid;grid-template-columns:38px 190px 1fr;gap:20px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-n" style="color:#39445A;">05</div>
                    <div class="ed-h3" style="font-size:16px;">并发天花板未压到极限</div>
                    <div class="ed-p" style="font-size:13px;">已测到 20 并发 0 错误 · SQLite 单写者，需在真实部署形态下再压</div>
                </div>
                <div style="display:grid;grid-template-columns:38px 190px 1fr;gap:20px;align-items:baseline;padding:13px 0;">
                    <div class="ed-n" style="color:#39445A;">06</div>
                    <div class="ed-h3" style="font-size:16px;">无障碍仅最小集</div>
                    <div class="ed-p" style="font-size:13px;">已补语义与焦点管理 · 完整 WCAG 审计未做，<span class="ed-warn">不能当合规</span></div>
                </div>
            </div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>18</em> / 19</span>
    </div>
</div>
`);
