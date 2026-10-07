#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""验证「单文件作品集」真的能跑：file:// 直开 + http:// 托管，两种都测。

为什么要两种都测：
  * file:// —— 面试官拿到附件双击就能看，这是单文件交付的核心卖点；
  * http:// —— 上传到静态空间后的真实形态。
  两者在浏览器里的约束不同（module 脚本、CORS），只测一种会漏。

踩过的坑（务必保留这两个 Chromium 参数）：
  * 本机被注入 HTTP_PROXY/HTTPS_PROXY，Chromium 连 127.0.0.1 也会走代理而卡死
    → 必须 --no-proxy-server --proxy-bypass-list=<-loopback>；
  * 本脚本不要放在 %TEMP%，那里残留的 inspect.py 会遮蔽标准库。

用法: python scripts/verify-single-file.py [<单文件路径>]
"""

import functools
import http.server
import json
import os
import pathlib
import sys
import threading
import urllib.parse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (
    ROOT / "artifacts" / "HR-Agent-OS_作品集_19页_单文件.html")
OUTDIR = HTML.parent / "_verify"
PORT = 5191


def main():
    if not HTML.is_file():
        print(u"✗ 找不到 %s" % HTML)
        return 1
    OUTDIR.mkdir(exist_ok=True)

    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                               directory=str(HTML.parent))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    # Chromium 会保持 keep-alive 连接；handler 线程默认非 daemon，
    # 不设这一行整个进程会一直挂到连接超时（真踩过：脚本跑完结论却不退出）。
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    targets = [
        ("file", HTML.as_uri()),
        ("http", "http://127.0.0.1:%d/%s" % (PORT, urllib.parse.quote(HTML.name))),
    ]
    bad = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-proxy-server", "--proxy-bypass-list=<-loopback>"])
        for tag, url in targets:
            page = browser.new_page(viewport={"width": 1600, "height": 900})
            errs = []
            page.on("console", lambda m: errs.append(u"%s: %s" % (m.type, m.text))
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append(u"pageerror: %s" % e))
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            # 不要等 "load"：那张 Google Fonts 样式表是唯一的外部请求，
            # 断网时它会一直挂到超时，但如果拿它当就绪信号就永远等不到
            # （其实它用 media="print" + onload 做渐进增强，不阻塞渲染）。
            # 正确的就绪信号 = 应用把 19 页塞进 slideDataMap。
            try:
                page.wait_for_function(
                    "() => window.slideDataMap && window.slideDataMap.size === 19",
                    timeout=15000)
            except Exception as e:
                print(u"[%s] 等待挂载超时：%s" % (tag, e))
            page.wait_for_timeout(600)

            info = page.evaluate("""() => ({
                title: document.title,
                slides: window.slideDataMap ? window.slideDataMap.size : -1,
                indicator: ((document.getElementById('pageIndicator')||{}).textContent||'').trim(),
                injected: document.querySelectorAll('.ppt-viewport *').length,
                hasLimitWord: document.body.innerText.indexOf('\u9650\u7537') >= 0,
                hasPlaceholder: document.body.innerText.indexOf('\u53d1\u9001\u524d\u8bf7\u66ff\u6362') >= 0,
                font: (document.querySelector('.ed-page')
                       ? getComputedStyle(document.querySelector('.ed-page')).fontFamily.split(',')[0].replace(/"/g,'')
                       : '(无 .ed-page)'),
            })""")
            print(u"[%s] %s" % (tag, json.dumps(info, ensure_ascii=False)))
            print(u"      控制台错误：%s" % (errs if errs else u"无"))
            page.screenshot(path=str(OUTDIR / ("p1-%s.png" % tag)))

            for _ in range(18):
                page.keyboard.press("ArrowRight")
                page.wait_for_timeout(70)
            page.wait_for_timeout(600)
            last = page.evaluate(
                "() => ((document.getElementById('pageIndicator')||{}).textContent||'').trim()")
            print(u"      末页指示器：%s" % last)
            page.screenshot(path=str(OUTDIR / ("p19-%s.png" % tag)))

            ok = (info["slides"] == 19 and last == u"19 / 19"
                  and not info["hasLimitWord"] and not info["hasPlaceholder"]
                  and not errs)
            if not ok:
                bad += 1
                print(u"      ✗ 未通过")
            else:
                print(u"      ✓ 通过")
            page.close()
        browser.close()
    srv.shutdown()
    srv.server_close()

    print(u"\n截图目录：%s" % OUTDIR)
    print(u"结论：%s" % (u"两种打开方式均通过 ✓" if bad == 0 else u"%d 种方式未通过 ✗" % bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
