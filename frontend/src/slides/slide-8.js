window.slideDataMap.set(8, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(820px 520px at 100% 6%, rgba(34,211,238,.13), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">08</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Capabilities</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>04 / Capabilities</div>
                <h2 class="ed-title">五个核心能力</h2>
                <div class="ed-sub">每条都写明「为什么它是真的」—— 不是话术</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-rows" style="justify-content:space-between;">
            <div class="ed-row" style="grid-template-columns:54px 248px 1fr;">
                <div class="ed-n">01</div>
                <div class="ed-h3" style="font-size:19px;">分数可解释</div>
                <div class="ed-p" style="font-size:13.5px;">
                    逐维算式（技能匹配 40 × 0.95 = 38）+ 决定性因素 + 还差几分进下一档；测试锁死「分项之和 == 总分」「满分 × 系数 == 该维得分」。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:54px 248px 1fr;">
                <div class="ed-n">02</div>
                <div class="ed-h3" style="font-size:19px;">规则与模型分工明确</div>
                <div class="ed-p" style="font-size:13.5px;">
                    分档 <span class="ed-accent">100% 规则</span>（可复现、可签字）；模型只做措辞与语言组织 —— 「不配大模型也能跑通全流程」是设计选择，不是降级方案。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:54px 248px 1fr;">
                <div class="ed-n">03</div>
                <div class="ed-h3" style="font-size:19px;">权限真的在服务端</div>
                <div class="ed-p" style="font-size:13.5px;">
                    24 能力 × 7 角色 + 行级范围 + PII 脱敏，全部在出数据之前生效；员工身份导出全公司花名册是 <span class="ed-warn">真 403</span>，前端按钮显隐只是体验层。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:54px 248px 1fr;">
                <div class="ed-n">04</div>
                <div class="ed-h3" style="font-size:19px;">审计改不掉</div>
                <div class="ed-p" style="font-size:13.5px;">
                    应用层只插不改 + 数据库触发器 <span class="ed-cy">RAISE(ABORT)</span> —— 审计日志无法被应用层篡改。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:54px 248px 1fr;">
                <div class="ed-n">05</div>
                <div class="ed-h3" style="font-size:19px;">JD 接地真实市场 + 合规红线</div>
                <div class="ed-p" style="font-size:13.5px;">
                    按「标题优先」检索市场在招同类岗位（自带 <span class="ed-b">183 条</span>抓取快照）；命中「35 岁以下」「仅限本地户口」
                    <span class="ed-warn">直接阻止发布</span>，每条给法条依据与建议改法。
                </div>
            </div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>08</em> / 19</span>
    </div>
</div>
`);
