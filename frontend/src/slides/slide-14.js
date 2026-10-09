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
                <div class="ed-sub">文档里的每个数字，都由程序自己核对过 —— 不是「我写完了」，是「我赖不掉」</div>
            </div>
        </div>

        <div class="ed-hr"></div>

        <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 388px;gap:42px;margin-top:6px;">

            <div style="display:flex;flex-direction:column;justify-content:space-between;">
                <div class="ed-row" style="grid-template-columns:24px 124px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">1</div>
                    <div class="ed-k" style="font-size:12px;letter-spacing:.02em;padding-top:4px;">改一处 · 全部重跑</div>
                    <div class="ed-p" style="font-size:13px;">12 组测试一条命令跑完 —— 不会「修好这里、弄坏那里」</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 124px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">2</div>
                    <div class="ed-k" style="font-size:12px;letter-spacing:.02em;padding-top:4px;">数字 · 机器替你对</div>
                    <div class="ed-p" style="font-size:13px;">从代码里数出 24 页面 / 47 接口 / 545,169 字节，与文档逐个比 —— 对不上就报错</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 124px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">3</div>
                    <div class="ed-k" style="font-size:12px;letter-spacing:.02em;padding-top:4px;">旧数据 · 不许复活</div>
                    <div class="ed-p" style="font-size:13px;">不只查现在写对没，还查改过的地方有没有变回老数据</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 124px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">4</div>
                    <div class="ed-k" style="font-size:12px;letter-spacing:.02em;padding-top:4px;">分数 · 不许倒退</div>
                    <div class="ed-p" style="font-size:13px;">效果指标存一条基准线，一旦退步就卡住，过不了关</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 124px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">5</div>
                    <div class="ed-k" style="font-size:12px;letter-spacing:.02em;padding-top:4px;">网页 · 一条命令重生</div>
                    <div class="ed-p" style="font-size:13px;">改了文字，阅读版网页一条命令重生 —— 不会新旧两版并存</div>
                </div>
                <div class="ed-row" style="grid-template-columns:24px 124px 1fr;gap:16px;padding:11px 0;">
                    <div class="ed-n" style="padding-top:2px;">6</div>
                    <div class="ed-k" style="font-size:12px;letter-spacing:.02em;padding-top:4px;">换机器 · 照样能跑</div>
                    <div class="ed-p" style="font-size:13px;">两个 Node 版本各跑一遍 + Python 语法检查 —— 不靠「我机器上能跑」</div>
                </div>
            </div>

            <div class="ed-panel" style="padding:0;display:flex;flex-direction:column;background:rgba(6,9,16,.85);">
                <span class="ed-tick tl"></span><span class="ed-tick br"></span>
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);">
                    <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#93A4BF;">案例 01 · 一次误判</span>
                    <span class="ed-chip cyan">6 项守则 · 全绿</span>
                </div>
                <div style="padding:16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.85;color:#7B8BA6;">
                    <div><span style="color:#39445A;">01</span> <span style="color:#5A6A85;">我曾把评测基线，写成</span></div>
                    <div><span style="color:#FBBF24;">「四舍五入后」</span><span style="color:#93A4BF;">的值 ——</span></div>
                    <div style="color:#93A4BF;">而守则是单向往上比的。</div>
                    <div style="margin-top:10px;color:#93A4BF;">于是</div>
                    <div><span style="color:#FF6B4A;">真值 96.67%</span> <span style="color:#5A6A85;">vs</span> <span style="color:#FF6B4A;">基线 96.7%</span></div>
                    <div style="color:#93A4BF;">被程序判成<span style="color:#FBBF24;">「退步」</span>，</div>
                    <div style="color:#93A4BF;">报了一次误判。</div>
                    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);color:#22D3EE;">修法：基线只存原始值，</div>
                    <div style="color:#22D3EE;">不存四舍五入后的结果。</div>
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
