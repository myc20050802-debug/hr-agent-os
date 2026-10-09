window.slideDataMap.set(17, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(820px 540px at 100% 100%, rgba(34,211,238,.12), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">17</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Self-Audit</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>12 / Self-Audit</div>
                <h2 class="ed-title">我审了一遍自己的项目</h2>
                <div class="ed-sub">交付之前，我先当了一遍最挑剔的用户 —— 按「用户会先撞到哪一处」排序，而不是按修复难度</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div style="flex:1;min-height:0;display:grid;grid-template-columns:262px 1fr;gap:48px;margin-top:6px;">
            <div style="display:flex;flex-direction:column;justify-content:center;">
                <div style="font-family:var(--font-title);font-size:116px;font-weight:700;line-height:.86;letter-spacing:-.055em;color:#F2F6FF;">12</div>
                <div class="ed-h3" style="margin-top:12px;font-size:20px;">项缺口审计</div>
                <div class="ed-p" style="margin-top:10px;font-size:13px;">全部写在 <span class="ed-cy">docs/</span> 里，可逐条核对；已修的补了回归用例，你可以自己验。</div>

                <!-- 标准 4「有归因」的顶配形态不是「我修好了」，而是「我发现了、
                     试了修法、修法更糟，于是明确保留并写下理由」。 -->
                <div style="margin-top:20px;padding-top:15px;border-top:1px solid var(--line2);">
                    <div class="ed-k" style="color:#FBBF24;">其中一条，我决定不修</div>
                    <div class="ed-p" style="margin-top:8px;font-size:12.5px;line-height:1.62;">
                        「业务匹配」只数标签个数 —— 会让「资深销售」这类无关背景被抬到 ok（实测 77 分）。
                        我按评测口径跑了一遍修法：一致率掉到 <span class="ed-warn">73.3%</span>、
                        漏筛 <span class="ed-warn">0% → 22.2%</span>，破了红线 —— 于是否决修法、保留原实现，
                        并把「为什么不修」写进口径文档。
                    </div>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;justify-content:space-between;">
                <div style="padding-bottom:14px;border-bottom:1px solid var(--line);">
                    <div class="ed-h3" style="font-size:17px;">虚报模型调用与成本</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;">筛选链路里其实 0 次模型调用，日志却记了模型工具名和 token 数。</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;color:#22D3EE;">✓ 已修：工具名不撒谎，用量取自真实网关</div>
                </div>
                <div style="padding:14px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-h3" style="font-size:17px;">「已进入优化数据集」是空话</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;">审计日志这么写，但那个数据集并不存在 —— 纯话术。</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;color:#22D3EE;">✓ 已修：改成可归因的原因码枚举 + 一致率接口</div>
                </div>
                <div style="padding:14px 0;border-bottom:1px solid var(--line);">
                    <div class="ed-h3" style="font-size:17px;">一个死按钮 + WAL 只增不减</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;">演示复跑必经路径点下去毫无反应；WAL 日志实测是主库的 11 倍，且从不 checkpoint。</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;color:#22D3EE;">✓ 已修：补后端接口；压测时顺手记录 P95 / P99</div>
                </div>
                <div style="padding-top:14px;">
                    <div class="ed-h3" style="font-size:17px;">无障碍为 0</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;">政府采购评标普遍含无障碍要求，而它一项都没做。</div>
                    <div class="ed-p" style="margin-top:6px;font-size:13px;color:#22D3EE;">✓ 已补最小集：弹窗语义 / 焦点管理 / 表格表头 / 减少动效</div>
                </div>
            </div>
        </div>

        <div class="ed-banner" style="margin-top:18px;">
            产品文档习惯只写「已完成」；我把「还没做好、以及我为什么知道」也摊开 ——
            <span class="ed-cy" style="font-weight:700;">缺陷由用户上线后自己撞见，比我先说贵得多</span>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>17</em> / 19</span>
    </div>
</div>
`);
