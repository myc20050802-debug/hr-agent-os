window.slideDataMap.set(16, `
<div class="ed-page">
    <div class="ed-glow" style="background:
        radial-gradient(700px 460px at 6% 0%, rgba(255,107,74,.11), transparent 70%),
        radial-gradient(700px 460px at 100% 96%, rgba(56,189,248,.11), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">16</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Incidents</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>11 / Incidents</div>
                <h2 class="ed-title">三次真实翻车</h2>
                <div class="ed-sub">每一次都留了回归用例 —— 演进是真的，不是一次写成</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-rows" style="justify-content:space-between;">
            <div class="ed-row" style="grid-template-columns:212px 1fr 1fr;gap:34px;padding:18px 0;">
                <div>
                    <div class="ed-k" style="color:#FF6B4A;">Incident 01</div>
                    <div class="ed-h3" style="margin-top:8px;">「测试全绿」其实是假的</div>
                </div>
                <div>
                    <div class="ed-k" style="color:#5A6A85;">根因</div>
                    <div class="ed-p" style="margin-top:7px;">前端套件把页面 id 写死成数组，新增页面时静默漏测，却照打「全部通过」。</div>
                </div>
                <div>
                    <div class="ed-k" style="color:#5A6A85;">修法</div>
                    <div class="ed-p" style="margin-top:7px;">改为从页面注册表 <span class="ed-b">派生</span>，并由守卫禁止再写死。</div>
                    <div class="ed-cap" style="margin-top:7px;font-family:ui-monospace,Menlo,Consolas,monospace;">→ tools/test_nav.js + 文档守卫不变量</div>
                </div>
            </div>

            <div class="ed-row" style="grid-template-columns:212px 1fr 1fr;gap:34px;padding:18px 0;">
                <div>
                    <div class="ed-k" style="color:#FF6B4A;">Incident 02</div>
                    <div class="ed-h3" style="margin-top:8px;">离线端与后端逻辑漂移</div>
                </div>
                <div>
                    <div class="ed-k" style="color:#5A6A85;">根因</div>
                    <div class="ed-p" style="margin-top:7px;">同一个判定在两处实现，改了一处、忘了另一处。</div>
                </div>
                <div>
                    <div class="ed-k" style="color:#5A6A85;">修法</div>
                    <div class="ed-p" style="margin-top:7px;">抽 <span class="ed-cy">shared/</span> 单一数据源；离线端必须镜像同一份词库与口径，改完跑对应套件。</div>
                    <div class="ed-cap" style="margin-top:7px;font-family:ui-monospace,Menlo,Consolas,monospace;">→ tools/test_jd.js（改一处必须同改两处，否则红）</div>
                </div>
            </div>

            <div class="ed-row" style="grid-template-columns:212px 1fr 1fr;gap:34px;padding:18px 0;">
                <div>
                    <div class="ed-k" style="color:#FF6B4A;">Incident 03</div>
                    <div class="ed-h3" style="margin-top:8px;">规则模式下却报了 token 与成本</div>
                </div>
                <div>
                    <div class="ed-k" style="color:#5A6A85;">根因</div>
                    <div class="ed-p" style="margin-top:7px;">想让演示「看起来完整」，于是显示了一个凭空算出的金额。</div>
                </div>
                <div>
                    <div class="ed-k" style="color:#5A6A85;">修法</div>
                    <div class="ed-p" style="margin-top:7px;">规则模式一律显示 <span class="ed-b">0</span>，成本卡改「试算」并注明来源。</div>
                    <div class="ed-cap" style="margin-top:7px;font-family:ui-monospace,Menlo,Consolas,monospace;">→ tools/test_screening.js（规则模式 token 必须为 0）</div>
                </div>
            </div>
        </div>

        <div class="ed-banner" style="margin-top:auto;">
            一个 AI 产品如果连自己的成本数字都不可信，业务方 <span class="ed-warn" style="font-weight:700;">不会信它的任何输出</span>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>16</em> / 19</span>
    </div>
</div>
`);
