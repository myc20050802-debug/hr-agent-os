window.slideDataMap.set(14, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(820px 560px at 96% 100%, rgba(34,211,238,.12), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">14</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Discipline</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>09 / Engineering</div>
                <h2 class="ed-title">让文档不许撒谎</h2>
                <div class="ed-sub">不是「我写了文档」—— 是「我让文档没法骗人」</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 388px;gap:42px;margin-top:6px;">

            <div style="display:flex;flex-direction:column;justify-content:space-between;">
                <div class="ed-row" style="grid-template-columns:24px 104px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">1</div>
                    <div class="ed-k" style="padding-top:4px;">regression</div>
                    <div class="ed-p" style="font-size:13px;">12 个套件（后端 4 / 自包含 4 / 前端 4）一条命令全跑 —— 挡住「改 A 坏 B」</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 104px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">2</div>
                    <div class="ed-k" style="padding-top:4px;">doc-truth</div>
                    <div class="ed-p" style="font-size:13px;">从代码读出 24 页面 / 47 接口 / 545,169 字节 / schema v9，比对文档「现状句」—— 挡住「文档与代码不一致」</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 104px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">3</div>
                    <div class="ed-k" style="padding-top:4px;">neg-anchor</div>
                    <div class="ed-p" style="font-size:13px;">不只钉住「现在是多少」，还禁止<span class="ed-b">旧值复活</span> —— 挡住「修了一处、另外四篇还留旧数字」</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 104px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">4</div>
                    <div class="ed-k" style="padding-top:4px;">baseline</div>
                    <div class="ed-p" style="font-size:13px;">评测数字唯一源；守卫<span class="ed-b">单向</span>：质量 ≥ 基线、错误 ≤ 基线 —— 挡住「指标倒退悄悄过 CI」</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 104px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">5</div>
                    <div class="ed-k" style="padding-top:4px;">single-src</div>
                    <div class="ed-p" style="font-size:13px;">全部阅读版 HTML 由一条命令从 Markdown 重生，清单写在代码里 —— 挡住「md 改了、HTML 还是旧的」</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 104px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">6</div>
                    <div class="ed-k" style="padding-top:4px;">ci-matrix</div>
                    <div class="ed-p" style="font-size:13px;">Node 22 / 24 双矩阵 + Python 编译检查 + Pages 构建 —— 挡住「只在某一个 Node 版本上碰巧能跑」</div>
                </div>
            </div>

            <div class="ed-panel" style="padding:0;display:flex;flex-direction:column;background:rgba(6,9,16,.85);">
                <span class="ed-tick tl"></span><span class="ed-tick br"></span>
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);">
                    <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#93A4BF;">engineering-discipline.yml</span>
                    <span class="ed-chip cyan">6 guards · all green</span>
                </div>
                <div style="padding:16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.85;color:#7B8BA6;">
                    <div><span style="color:#39445A;">01</span> <span style="color:#5A6A85;"># 一次假红</span></div>
                    <div style="margin-top:10px;color:#93A4BF;">我曾把评测基线写成</div>
                    <div><span style="color:#FBBF24;">「四舍五入后」</span><span style="color:#93A4BF;">的值，</span></div>
                    <div style="color:#93A4BF;">而守卫是单向往上比 ——</div>
                    <div style="margin-top:10px;color:#93A4BF;">于是</div>
                    <div><span style="color:#FF6B4A;">真值 96.67%</span> <span style="color:#5A6A85;">vs</span> <span style="color:#FF6B4A;">基线 96.7%</span></div>
                    <div style="color:#93A4BF;">被判成「倒退」，</div>
                    <div style="color:#93A4BF;">报了一个<span style="color:#FBBF24;">假红</span>。</div>
                    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);color:#22D3EE;">修法：基线存「原始值」</div>
                    <div style="color:#5A6A85;">教训已写进贡献指南。</div>
                </div>
            </div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>14</em> / 19</span>
    </div>
</div>
`);
