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

from playwright.sync_api import sync_playwright

# App 外壳选择器：这些元素属于「浏览界面」，不属于幻灯片设计
UI_CHROME_CSS = (
    "#prevBtn,#nextBtn,.nav-btn,.page-indicator,.progress-bar,.keyboard-hint"
    "{display:none !important;visibility:hidden !important;}"
)

WIDTH, HEIGHT = 1440, 810


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
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=2,  # 2x 高清
        )
        page = context.new_page()

        page.goto(f"{args.url}?page=1", wait_until="networkidle")
        page.wait_for_timeout(800)

        total = detect_total(page, args.pages)
        if total <= 0:
            print("ERROR: 无法确定页数", file=sys.stderr)
            browser.close()
            sys.exit(3)
        print(f"Found {total} slides")

        for i in range(1, total + 1):
            page.goto(f"{args.url}?page={i}", wait_until="networkidle")
            page.wait_for_timeout(450)
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
