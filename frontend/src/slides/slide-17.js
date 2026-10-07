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
                <div class="ed-sub">假装我是面试官，而且我愿意翻代码 —— 并按「面试杀伤力」而不是「修复难度」排序</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div style="flex:1;min-height:0;display:grid;grid-template-columns:262px 1fr;gap:48px;margin-top:6px;">
            <div style="display:flex;flex-direction:column;justify-content:center;">
                <div style="font-family:var(--font-title);font-size:152px;font-weight:700;line-height:.86;letter-spacing:-.055em;color:#F2F6FF;">12</div>
                <div class="ed-h3" style="margin-top:14px;font-size:20px;">项缺口审计</div>
                <div class="ed-p" style="margin-top:12px;font-size:13px;">全部写在 <span class="ed-cy">docs/</span> 里，可逐条核对；修完的补了回归用例。</div>
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
            绝大多数候选人展示的是「我做成了什么」；我多展示一层 ——
            <span class="ed-cy" style="font-weight:700;">「我知道它哪里还不行、并且我说得出来」</span>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>17</em> / 19</span>
    </div>
</div>
`);
