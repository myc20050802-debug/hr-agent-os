#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
截取每一页幻灯片为 PNG（用于 PPTX / 作品集海报）。

与框架自带 screenshot-ppt.py 的差别：
  1. 截图前隐藏 App 外壳（左右导航按钮、页码徽标、进度条），
     避免「11 / 20」这类界面元素被烙进成品图片；
  2. 跨平台（Windows / macOS / Linux 均可运行）。

用法:
  python scripts/shoot-slides.py --url http://127.0.0.1:5173 \
         --output public/assets/images/posters/pages
"""

import argparse
import os
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

# App 外壳选择器：这些元素属于「浏览界面」，不属于幻灯片设计
UI_CHROME_CSS = (
    "#prevBtn,#nextBtn,.nav-btn,.page-indicator,.progress-bar,.keyboard-hint"
    "{display:none !important;visibility:hidden !important;}"
)

WIDTH, HEIGHT = 1440, 810

# 哪些主机算「本机」——命中时禁止 Chromium 走代理，详见 launch_args()
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1", "0.0.0.0", "[::1]")


def launch_args(url):
    """本机截图必须让 Chromium 直连，否则「连自己的 dev server 都连不上」。

    踩过的坑：开发环境常被注入 HTTP_PROXY（例如 127.0.0.1:13577），而 Chromium
    默认并不豁免 localhost —— 于是每一步 goto 都经由代理转发，表现为页面永远
    不 ready、脚本无限挂住（不是报错，是静默卡死，最难排查）。

    只在目标是回环地址时才强制直连，需要真实代理访问外网的场景不受影响。
    """
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host in LOOPBACK_HOSTS or host.endswith(".localhost"):
        return ["--no-proxy-server"]
    return []


def wait_ready(page, page_no=None):
    """等到「作品集本体已挂载且这一页已渲染」，而不是等网络静默。

    为什么不用 wait_until="networkidle"：页面里有一张 Google Fonts 样式表，
    在国内网络下会长时间挂起。挂起的连接会让 networkidle 永远等不到，
    于是 30s 后抛异常 —— 而这段时间页面其实早就渲染好了。
    这里断言的是真正的就绪条件：slideDataMap 有内容。
    """
    try:
        page.wait_for_function(
            "() => window.slideDataMap && window.slideDataMap.size > 0",
            timeout=20000)
    except Exception as e:
        print("WARN: 等待 slideDataMap 超时：%s" % e, file=sys.stderr)
    # 逐页时确认页码已切到目标页（避免截到上一页）
    if page_no is not None:
        try:
            page.wait_for_function(
                "n => { const el = document.getElementById('pageIndicator');"
                " return !!el && el.textContent.replace(/\\s/g,'').startsWith(n + '/'); }",
                arg=page_no, timeout=8000)
        except Exception:
            pass
    page.wait_for_timeout(500)


def detect_total(page, fallback=None):
    if fallback:
        return fallback
    try:
        text = page.locator("#pageIndicator").text_content(timeout=5000)
        if text and "/" in text:
            return int(text.split("/")[1].strip())
    except Exception:
        pass
    try:
        n = page.evaluate("() => window.slideDataMap ? window.slideDataMap.size : 0")
        if n:
            return int(n)
    except Exception:
        pass
    return 0


def main():
    ap = argparse.ArgumentParser(description="Capture slide screenshots (chrome hidden)")
    ap.add_argument("--url", default="http://127.0.0.1:5173")
    ap.add_argument("--output", "-o", required=True)
    ap.add_argument("--pages", "-p", type=int, default=None)
    args = ap.parse_args()

    os.makedirs(args.output, exist_ok=True)

    with sync_playwright() as p:
        # 注意别把变量命名成 args —— 会覆盖上面 argparse 的命名空间
        launch_flags = launch_args(args.url)
        if launch_flags:
            print("Chromium 直连（已禁用代理）：%s" % " ".join(launch_flags))
        browser = p.chromium.launch(headless=True, args=launch_flags)
        context = browser.new_context(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=2,  # 2x 高清
        )
        page = context.new_page()

        page.goto(f"{args.url}?page=1", wait_until="domcontentloaded", timeout=30000)
        wait_ready(page)

        total = detect_total(page, args.pages)
        if total <= 0:
            print("ERROR: 无法确定页数", file=sys.stderr)
            browser.close()
            sys.exit(3)
        print(f"Found {total} slides")

        for i in range(1, total + 1):
            page.goto(f"{args.url}?page={i}", wait_until="domcontentloaded", timeout=30000)
            wait_ready(page, page_no=i)
            page.add_style_tag(content=UI_CHROME_CSS)
            page.wait_for_timeout(150)

            out = os.path.join(args.output, f"page-{i}.png")
            try:
                page.locator("#ppt-viewport").screenshot(path=out)
            except Exception:
                page.screenshot(path=out, clip={"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT})
            print(f"  Capturing slide {i}/{total}...")

        browser.close()

    print(f"\nDone. {total} screenshots -> {args.output}")


if __name__ == "__main__":
    main()
