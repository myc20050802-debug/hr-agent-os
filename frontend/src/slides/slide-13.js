window.slideDataMap.set(13, `
<div class="ed-page">
    <div class="ed-glow" style="background:radial-gradient(820px 520px at 100% 8%, rgba(56,189,248,.13), transparent 70%);"></div>
    <div class="ed-grid"></div>
    <div class="ed-vig"></div>

    <div class="ed-rail">
        <span class="ed-rail-num">13</span>
        <span class="ed-rail-line"></span>
        <span class="ed-rail-label">Architecture</span>
    </div>

    <div class="ed-body">
        <div class="ed-head">
            <div>
                <div class="ed-eyebrow"><i></i>08 / Architecture</div>
                <h2 class="ed-title">技术实现概览</h2>
                <div class="ed-sub">每一行都带一条「为什么这么选」—— 技术选型也是产品决策</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div class="ed-rows" style="justify-content:space-between;">
            <div class="ed-row" style="grid-template-columns:86px 168px 1fr;">
                <div class="ed-chip cyan" style="justify-self:start;">L5</div>
                <div class="ed-h3" style="font-size:19px;">运行时</div>
                <div class="ed-p" style="font-size:13.5px;">
                    Node 22 原生 http + 内置 node:sqlite → <span class="ed-b">零依赖</span>，clone 下来一条命令就能起，PoC 阶段把「环境问题」这个变量彻底消掉。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:86px 168px 1fr;">
                <div class="ed-chip cyan" style="justify-self:start;">L4</div>
                <div class="ed-h3" style="font-size:19px;">前端</div>
                <div class="ed-p" style="font-size:13.5px;">
                    单文件 HTML（内联全部 CSS/JS）→ 断网可演示、双击即开；代价我主动说：没法按需加载、没有构建期校验。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:86px 168px 1fr;">
                <div class="ed-chip cyan" style="justify-self:start;">L3</div>
                <div class="ed-h3" style="font-size:19px;">分层</div>
                <div class="ed-p" style="font-size:13.5px;">
                    后端 16 个模块按 L0–L5 分层 → 依赖方向单向，改一层不会牵连全栈。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:86px 168px 1fr;">
                <div class="ed-chip cyan" style="justify-self:start;">L2</div>
                <div class="ed-h3" style="font-size:19px;">来源单一</div>
                <div class="ed-p" style="font-size:13.5px;">
                    <span class="ed-cy">shared/</span> 三个文件是前后端共用数据源 → 改一处，离线端与后端同时生效，避免两套逻辑漂移。
                </div>
            </div>
            <div class="ed-row" style="grid-template-columns:86px 168px 1fr;">
                <div class="ed-chip cyan" style="justify-self:start;">L1</div>
                <div class="ed-h3" style="font-size:19px;">数据库</div>
                <div class="ed-p" style="font-size:13.5px;">
                    schema v9，版本化迁移 → 空库自动迁移 + 种子，不提交任何数据文件。
                </div>
            </div>
        </div>

        <div style="margin-top:auto;padding-top:16px;border-top:1px solid var(--line2);display:flex;justify-content:space-between;align-items:baseline;gap:30px;">
            <div class="ed-statbar" style="font-size:13px;">
                <span class="ed-b">24</span> 页面 · <span class="ed-b">47</span> 接口 ·
                <span class="ed-b">约 19,400</span> 行 JS · <span class="ed-b">10,300+</span> 行文档
            </div>
            <div class="ed-cap">全部由脚本从代码算出 —— 写进文档的数字，有守卫盯着</div>
        </div>
    </div>

    <div class="ed-foot">
        <span>HR-AGENT OS · 作品集</span>
        <span><em>13</em> / 19</span>
    </div>
</div>
`);
