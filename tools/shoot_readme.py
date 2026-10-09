#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为 README 生成产品截图（真实后端态，且**真跑一遍**核心流程）。

依赖：playwright（本项目运行时零依赖，这只是文档工具，按需安装）：
    pip install playwright && playwright install chromium
运行前提：后端已在 http://127.0.0.1:8788 跑着（`npm run dev`）。

为什么不能只截空态：门面图里出现「尚未评分」「尚未生成」等于自曝其短。
所以脚本会真的跑一次筛选 Agent、真的生成一份 JD（并故意带一条违规表述，
把「合规扫描拦下第一版 JD」这个能力截进图里）。

为什么不用 scrapling MCP 的 screenshot 工具：它只把图返回给对话，不落盘，
而 README 需要仓库内的静态资源文件。
"""
import os
import pathlib
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

# 浏览器路径留空时由 playwright 自己找（playwright install chromium 装的位置）。
# 设这个变量是为了复用本机已有的 chromium 缓存，避免重复下载。
CHROME = os.environ.get("README_SHOT_CHROME", "")
BASE = os.environ.get("README_SHOT_BASE", "http://127.0.0.1:8788")


def assert_no_warn_bar(page, where):
    bar = page.evaluate("""() => {
        const b = document.getElementById('connBar');
        return b ? { cls: b.className, text: (b.textContent || '').trim() } : null;
    }""")
    if bar and (bar["text"] or "on" in (bar["cls"] or "").split()):
        raise SystemExit("✗ %s 出现了连接状态条：%r" % (where, bar))


def goto_page(page, pid):
    return page.evaluate(
        """(pid) => {
            const a = window.__app;
            if (!a || !a.PAGES[pid]) return false;
            a.state.page = pid; a.render(); window.scrollTo(0, 0);
            return true;
        }""", pid)


def clear_overlays(page):
    """跑完 Agent 后可能停在人工闸门（浮层），会挡住后续点击。
    先按 Esc（应用自身实现了 Esc 关闭），再兜底点掉浮层上的关闭按钮。"""
    for _ in range(3):
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
    page.evaluate("""() => {
        const b = document.querySelector('[data-act="closeModal"]');
        if (b) { try { b.click(); } catch (e) {} }
    }""")
    page.wait_for_timeout(300)


def shot(page, name, label):
    page.screenshot(path=str(OUT / (name + ".png")))
    print("  ✓ %-22s %s" % (name + ".png", label))


def main():
    with sync_playwright() as p:
        launch = {"headless": True}
        # 本机会注入 HTTP_PROXY（沙箱代理）。Chromium 会连 127.0.0.1 也走代理，
        # 表现是脚本静默卡死、没有任何报错 —— shoot-slides.py 踩过同一个坑。
        # 目标是回环地址时一律绕过代理。
        host = (urlsplit(BASE).hostname or "").lower()
        if host in ("127.0.0.1", "localhost", "::1", "0.0.0.0", "[::1]") or host.endswith(".localhost"):
            launch["args"] = ["--no-proxy-server"]
        if os.path.exists(CHROME):
            launch["executable_path"] = CHROME
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(viewport={"width": 1600, "height": 1000},
                                 device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.on("dialog", lambda d: d.accept())

        # ---------- A. 登录闸门（权限模型 + 8 个演示角色） ----------
        page.goto(BASE + "/", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1800)
        shot(page, "login", "登录闸门（8 个演示角色）")

        # ---------- 登录 U-001 ----------
        page.click("#accGo")
        page.wait_for_function(
            "() => window.__app && window.__app.LIVE && window.__app.LIVE.on === true", timeout=30000)
        page.wait_for_timeout(2200)
        assert_no_warn_bar(page, "登录后")
        print("  · 已登录：", page.evaluate("() => (window.__app.AUTH.me || {}).name || ''"))
        shot(page, "hero_dashboard", "工作台")

        # ---------- B. 筛选台：真跑 Agent，拿到真实分数与归因 ----------
        goto_page(page, "screen")
        page.wait_for_timeout(800)
        clear_overlays(page)
        # 固定用 J-118（高级 Java 工程师）：数据齐、且是「市场接地」的对照岗位。
        page.evaluate("""() => { const a = window.__app; a.state.jobId = 'J-118'; a.render(); }""")
        page.wait_for_timeout(600)

        done = False
        for attempt in range(2):
            page.click('[data-act="runScreen"]')
            page.wait_for_selector("#drawerFoot button", timeout=60000)
            page.wait_for_timeout(900)
            # 「运行筛选」只处理未评分的人。同一岗位第二次演示时，
            # 抽屉会给出「重置本岗位评分后重跑」——脚本要自己接上，否则跨次运行不幂等。
            if not page.evaluate("""() => !!document.querySelector('#drawerFoot [data-act="resetJobScores"]')"""):
                done = True
                break
            print("  · 该岗位已全部评分，先重置再跑（第 %d 次）" % (attempt + 1))
            page.click('#drawerFoot [data-act="resetJobScores"]')
            page.wait_for_timeout(1800)
        if not done:
            raise SystemExit("✗ 反复运行后仍无可筛选候选人")

        page.wait_for_function(
            """() => !!document.querySelector('#drawerFoot [data-act="goApproval"]')""", timeout=60000)
        page.wait_for_timeout(1500)
        shot(page, "screening_agent", "Agent 执行轨迹（8 步 · 规则前置 0 token）")

        # 关掉抽屉再看结果表：Esc 会触发重渲染，所以放在填表类步骤之后
        clear_overlays(page)
        page.wait_for_timeout(5000)          # 等 toast（4.2s）自然淡出
        goto_page(page, "screen")
        page.wait_for_timeout(900)
        assert_no_warn_bar(page, "筛选台")
        shot(page, "screening", "简历筛选台（真实评分 + 可解释归因）")

        # ---------- C. JD 工作台：真生成一份 JD（含违规表述，验证合规拦截） ----------
        goto_page(page, "jd")
        page.wait_for_timeout(800)
        # 顺序很重要：先清浮层再填表。
        # 反过来做的话，Esc 关闭浮层引发的重渲染会把刚填的输入框冲成空值，
        # 点「生成」时被前端校验拦住 —— 结果面板永远不出内容（表现为干等超时）。
        clear_overlays(page)
        page.wait_for_timeout(400)
        page.fill("#jdTitle", "AI 产品经理")
        try:
            page.select_option("#jdIndustry", label="互联网")
        except Exception:
            pass          # 选项文案可能变，行业不是关键路径，选不上就保持默认
        page.fill("#jdMust", "试用期不缴社保；3 年以上 AI 产品经验，了解 LLM 与 RAG")
        page.fill("#jdNice", "有大模型应用落地经验者优先")
        page.wait_for_timeout(300)
        vals = page.evaluate("""() => ({
            t: (document.getElementById('jdTitle') || {}).value || '',
            m: (document.getElementById('jdMust') || {}).value || '',
        })""")
        if not vals["t"] or not vals["m"]:
            raise SystemExit("✗ 表单没填进去（被重渲染冲掉了）：" + repr(vals))
        try:
            page.click('[data-act="runJD"]', timeout=15000)
        except Exception:
            page.screenshot(path=str(OUT / "_fail_jd.png"))
            diag = page.evaluate("""() => ({
                overlays: Array.from(document.querySelectorAll('.drawer,.modal,.mask,.overlay'))
                    .filter(e => e.classList.contains('on') || getComputedStyle(e).display !== 'none')
                    .map(e => e.className),
                btn: !!document.querySelector('[data-act="runJD"]'),
                page: window.__app.state.page,
            })""")
            raise SystemExit("✗ 点不到「生成 JD」按钮，诊断：" + repr(diag))
        page.wait_for_function(
            "() => { const o = document.getElementById('jdOut'); return o && (o.innerText || '').length > 300; }",
            timeout=60000)
        page.wait_for_timeout(5000)
        assert_no_warn_bar(page, "JD 工作台")
        shot(page, "jd_workbench", "JD 工作台（真实生成 + 合规扫描）")

        # ---------- D. 岗位资料库 ----------
        goto_page(page, "reference")
        page.wait_for_timeout(1500)
        shot(page, "reference_jobs", "岗位资料库（市场在招岗位快照）")

        # ---------- E. 审计日志 ----------
        goto_page(page, "audit")
        page.wait_for_timeout(1200)
        shot(page, "audit_log", "操作审计日志（append-only）")

        ctx.close()
        browser.close()

    print("\n产出目录：", OUT)
    for f in sorted(OUT.glob("*.png")):
        print("  %-24s %8.0f KB" % (f.name, f.stat().st_size / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
