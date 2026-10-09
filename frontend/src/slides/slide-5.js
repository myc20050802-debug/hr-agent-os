window.slideDataMap.set(5, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(820px 520px at 100% 0%, rgba(255,107,74,.11), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">05</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Pain Points</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>02 / Pain Points</div>
                <h2 class="ed-title">三条真实痛点</h2>
                <div class="ed-sub">每一处设计都对应其中一条 —— 依据是法务实务与工程实测，不是凭空假设</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-rows" style="justify-content:space-between;">
            <div class="ed-row" style="grid-template-columns:54px 300px 1fr;align-items:start;">
                <div class="ed-n">01</div>
                <div>
                    <div class="ed-h3">结论不敢签字</div>
                    <div class="ed-p" style="margin-top:7px;">分数是黑盒，出了问题无法追溯 —— 业务方凭什么签？</div>
                    <div class="ed-cap" style="margin-top:7px;">依据 · 招聘流程实务：争议发生在「凭什么信」，不是「准不准」</div>
                </div>
                <div style="border-left:2px solid rgba(56,189,248,.30);padding-left:18px;">
                    <div class="ed-k">→ 解法</div>
                    <div class="ed-p" style="margin-top:7px;font-size:15px;color:#C6D3E8;">
                        分数 100% 由确定性规则算出（可复现、可追溯）；分数下面常驻一栏
                        <span class="ed-accent">「为什么是这个分」</span> —— 逐维算式 + 决定性因素 + 还差几分进下一档。
                    </div>
                </div>
            </div>

            <div class="ed-row" style="grid-template-columns:54px 300px 1fr;align-items:start;">
                <div class="ed-n">02</div>
                <div>
                    <div class="ed-h3">敏感数据没权限</div>
                    <div class="ed-p" style="margin-top:7px;">权限只写在页面上，数据早已出了库 —— 等于没权限。</div>
                    <div class="ed-cap" style="margin-top:7px;">依据 · 可当场复现：员工身份导出全公司花名册 → 真 403</div>
                </div>
                <div style="border-left:2px solid rgba(56,189,248,.30);padding-left:18px;">
                    <div class="ed-k">→ 解法</div>
                    <div class="ed-p" style="margin-top:7px;font-size:15px;color:#C6D3E8;">
                        权限 <span class="ed-b">在出数据之前生效</span>：24 能力 × 7 角色 + 行级范围（all / dept / self）+ PII 物理脱敏；
                        越权是 <span class="ed-warn">真 403</span>，前端按钮显隐只是体验层。
                    </div>
                </div>
            </div>

            <div class="ed-row" style="grid-template-columns:54px 300px 1fr;align-items:start;">
                <div class="ed-n">03</div>
                <div>
                    <div class="ed-h3">JD 即法律风险</div>
                    <div class="ed-p" style="margin-top:7px;">一句涉及年龄、性别或户籍的老措辞，写的人不觉得有问题，HR 也未必逐句审。</div>
                    <div class="ed-cap" style="margin-top:7px;">依据 · 执业法律背景 +《就业促进法》第 27 条（举证责任在企业）</div>
                </div>
                <div style="border-left:2px solid rgba(56,189,248,.30);padding-left:18px;">
                    <div class="ed-k">→ 解法</div>
                    <div class="ed-p" style="margin-top:7px;font-size:15px;color:#C6D3E8;">
                        生成前检索市场在招同类岗位「接地」，生成后做合规扫描 —— 命中就业歧视性表述（年龄／性别／户籍等）
                        <span class="ed-warn">直接阻止发布</span>，每条给法条依据 + 建议改法。
                    </div>
                </div>
            </div>
        </div>

        <div style="padding-top:16px;border-top:1px solid var(--line2);">
            <div class="ed-k">目标用户</div>
            <div class="ed-p" style="margin-top:6px;">中大型企业 HR 部门 / 招聘团队（私有化、数据不出境）</div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>05</em> / 19</span>
    </div>
</div>
`);
