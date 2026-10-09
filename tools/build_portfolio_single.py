#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 frontend/dist 的面试作品集打包成「单文件 HTML」—— 可直接上传、也可双击打开。

为什么需要这个脚本
------------------
作品集本体是 Vite 的多文件产物（index.html + assets/*.css + assets/*.js）。
发出去要么整目录上传、要么保持相对路径，面试官拿到单个附件就打不开。
本项目已有先例：平台原型/index.html 就是自包含单文件（Pages 上零依赖访问）。

做法（只搬运，不改一行内容）
---------------------------
1. Vite 注入的 `<link rel="stylesheet" href="/assets/*.css">`  → 内联 `<style>`
2. `<script type="module" src="/assets/*.js">`                  → 内联 `<script>`
   并移到 `</body>` 前，同时**去掉 type="module"**：
   打包产物是自执行 IIFE、无顶层 import/export，转成经典脚本才能在
   `file://` 下也直接跑起来（module 脚本在部分浏览器的 file:// 会被拦）。
3. 断言：源目录恰好 1 个 CSS / 1 个 JS；产物不留任何 /assets 引用；
   页数与关键数字各就位；敏感词（限男性 / 联系方式占位）为 0。
4. 顺手清掉多文件流水线留下的 4 处构建标记注释（`Vite Main Entry`、
   `开始/结束加载slide-N.js区域`、那行被注释掉的 `slide-{N}.js` 模板）——
   它们引用 `/src/...`，在单文件里已是死标记，留着只会让面试官以为缺文件。
   清理数量由断言守住（必须恰好 4 处），避免正则哪天悄悄失配。
5. **中和路由守卫的 404 跳转**（这个不改就白屏，实测踩过）：
   源工程 `src/js/route-handler.js` 只认 `/` 与 `/index.html`，其它路径一律
   `window.location.href = '/404.html'`。单文件被上传到任意位置（甚至 `file://`）
   时路径必然不在白名单 → 直接跳到不存在的 404 → **面试官看到空白页**。
   单文件版把该赋值替换为 `void 0`（保留原来的 console.warn，便于排查），
   并要求恰好命中 1 处。

单一源：产物由本脚本从 frontend/dist 重生，不要手改产物。
先构建：cd frontend && npm run build -- --outDir dist

用法： python tools/build_portfolio_single.py
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "frontend", "dist")
OUT_DIR = os.path.join(ROOT, "artifacts")
OUT = os.path.join(OUT_DIR, "HR-Agent-OS_作品集_19页_单文件.html")

PAGES = 19            # 作品集页数（改页数时同步这里 + 断言）
BYTES_ANCHOR = "545,169"   # 平台原型的字节数（与 tools/check_docs.js 的锚点同源）
# 交付件里绝不允许逐字出现的字样。
# 后三项是 2026-10-07 加的「不复现歧视原句」编辑红线：合规拦截这个卖点照样讲
#（讲成「命中就业歧视性表述（年龄／性别／户籍等）直接阻止发布」），但**不把
# 歧视句本身印在作品集上** —— 面试官扫一眼只会看到那句违规要求，看不到它被拦下。
FORBIDDEN = ("限男", "发送前请替换", "邮箱 / 微信", "岁以下", "本地户口", "已婚已育")

# 路由守卫里那句「跳 404」——单文件版必须中和掉，详见文件头 §5
ROUTE_REDIRECT_RE = re.compile(r'window\.location\.href\s*=\s*["\']/404\.html["\']')


def die(msg):
    print(u"✗ " + msg)
    sys.exit(1)


def read(p):
    return io.open(p, "r", encoding="utf-8", newline="").read()


def write(p, s):
    d = os.path.dirname(p)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    io.open(p, "w", encoding="utf-8", newline="").write(s)


def local_refs(html, ext):
    """取出指向本地产物的引用。

    要排除两类「假引用」：
      * https:// 外链（Google Fonts）—— 不参与内联，也不该导致 404；
      * HTML 注释里的模板行，例如 index.html 保留的
        `<!-- <script type="module" src="/src/slides/slide-{N}.js"></script> -->`
        —— 它不在浏览器解析树里，但正则会扫到（真踩过：被误判成第 2 个 JS 引用）。
    """
    comments = [(m.start(), m.end()) for m in re.finditer(r'<!--.*?-->', html, re.S)]
    out = []
    for m in re.finditer(u'<(link|script)[^>]*?(?:href|src)="([^"]+%s)"[^>]*>' % re.escape(ext), html):
        if re.match(r'^(https?:)?//', m.group(2)):
            continue
        if any(a <= m.start() < b for a, b in comments):
            continue
        out.append(m.group(0))
    return out


def strip_build_markers(html):
    """去掉多文件流水线留下的构建标记注释，返回 (新 html, 命中的注释列表)。

    只删「构件标记」这几条，其它注释（例如字体加载说明）原样保留。
    """
    hits = []

    def repl(m):
        s = m.group(0)
        if re.search(r'Vite Main Entry|开始加载slide-N|结束加载slide-N|slide-\{N\}\.js', s):
            hits.append(s.strip())
            return u""
        return s

    return re.sub(r'[ \t]*<!--.*?-->[ \t]*\r?\n?', repl, html, flags=re.S), hits


def main():
    src_html = os.path.join(DIST, "index.html")
    if not os.path.isfile(src_html):
        die(u"找不到 %s —— 先跑：cd frontend && npm run build -- --outDir dist" % src_html)

    html = read(src_html)
    src_len = len(html)

    # ---- 1. 定位本地 CSS / JS（必须各恰好 1 个，否则内联策略不成立）----
    css_tags = local_refs(html, ".css")
    js_tags = local_refs(html, ".js")
    if len(css_tags) != 1:
        die(u"本地产物 CSS 引用 %d 个（期望 1）：%s" % (len(css_tags), css_tags))
    if len(js_tags) != 1:
        die(u"本地产物 JS 引用 %d 个（期望 1）：%s" % (len(js_tags), js_tags))
    css_tag, js_tag = css_tags[0], js_tags[0]

    css_path = os.path.join(DIST, re.search(r'href="([^"]+)"', css_tag).group(1).lstrip("/"))
    js_path = os.path.join(DIST, re.search(r'src="([^"]+)"', js_tag).group(1).lstrip("/"))
    for p in (css_path, js_path):
        if not os.path.isfile(p):
            die(u"引用的产物不存在：%s" % p)

    css = read(css_path)
    js = read(js_path)

    # ---- 2. 内联前的安全扫描（否则会把 HTML 语法搞坏）----
    if "</style" in css:
        die(u"CSS 内含 </style —— 不能安全内联")
    if "</script" in js:
        die(u"JS 内含 </script —— 会被 HTML 解析器提前截断，不能内联")
    # `<!--` 本身是允许的（幻灯片模板里有 HTML 注释），但必须满足 HTML 词法规则：
    #   ① 成对闭合（否则解析器停在 script-data-escaped 态）
    #   ② 全篇不得出现 `<script`（那会进入 double-escaped 态，此时 </script> 不再终止脚本）
    if "<!--" in js:
        if js.count("<!--") != js.count("-->"):
            die(u"JS 内 <!-- 与 --> 不配对（%d : %d），不能安全内联"
                % (js.count("<!--"), js.count("-->")))
        if re.search(r"<script", js, re.I):
            die(u"JS 内同时存在 <!-- 与 <script —— 会触发 double-escaped 态，不能安全内联")
    if not css.strip():
        die(u"CSS 为空")
    if "slideDataMap.set(" not in js:
        die(u"JS 里找不到 slideDataMap.set( —— 产物不像作品集本体")

    # ---- 2b. 中和路由守卫的 404 跳转（单文件必须做，否则白屏）----
    n_redir = len(ROUTE_REDIRECT_RE.findall(js))
    if n_redir != 1:
        die(u"路由守卫的 404 跳转命中 %d 处（期望 1）—— 上游改写或措辞变了，"
            u"请核对 src/js/route-handler.js" % n_redir)
    js = ROUTE_REDIRECT_RE.sub(u"void 0", js)

    # ---- 3. 组装 ----
    out = html.replace(css_tag, u"<style>\n/* 内联自 %s */\n%s\n    </style>"
                       % (os.path.basename(css_path), css), 1)
    out = out.replace(js_tag, u"", 1)
    out = re.sub(r'[ \t]*<link[^>]*rel="modulepreload"[^>]*>\r?\n?', u"", out)
    out, markers = strip_build_markers(out)
    if len(markers) != 4:
        die(u"构建标记注释命中 %d 处（期望 4）：%s" % (len(markers), markers))
    # 经典脚本放在 </body> 前：DOM 已就绪，且 file:// 下也能执行
    inline_js = u"    <!-- 作品集本体（内联自 %s，单文件自包含）-->\r\n    <script>\r\n%s\r\n    </script>\r\n" % (
        os.path.basename(js_path), js)
    if "</body>" not in out:
        die(u"产物 HTML 里找不到 </body>")
    out = out.replace(u"</body>", inline_js + u"</body>", 1)

    # ---- 4. 断言 ----
    if re.search(r'(?:src|href)="/(?:assets|src)/', out):
        die(u"产物里仍残留 /assets 或 /src 引用，上传后会 404")
    if u'"/404.html"' in out or u"'/404.html'" in out:
        die(u"产物里仍有指向 /404.html 的引用（单文件不带 404 页，会被跳成白屏）")
    for ext in (".css", ".js"):
        left = local_refs(out, ext)
        if left:
            die(u"产物里仍有本地 %s 引用：%s" % (ext, left))
    n = out.count("slideDataMap.set(")
    if n != PAGES:
        die(u"幻灯片数量 = %d（期望 %d）" % (n, PAGES))
    for token in (u"<em>%d</em> / %d" % (PAGES, PAGES), BYTES_ANCHOR):
        if token not in out:
            die(u"产物缺少关键内容：%s" % token)
    for w in FORBIDDEN:
        if w in out:
            die(u"产物含不该出现的字样：%s" % w)

    write(OUT, out)

    print(u"✓ 单文件作品集已生成")
    print(u"  源：frontend/dist/index.html（%s 字符）+ %s + %s" % (
        format(src_len, ","), os.path.basename(css_path), os.path.basename(js_path)))
    print(u"  出：%s" % os.path.relpath(OUT, ROOT).replace("\\", "/"))
    print(u"  体积：%s 字符 / %s 字节" % (format(len(out), ","),
                                    format(len(out.encode("utf-8")), ",")))
    print(u"  改造：清理构建标记注释 %d 处 · 中和 404 跳转 %d 处" % (len(markers), n_redir))
    print(u"  断言：幻灯片 %d 页 · 页脚 %d/%d · 原型字节锚点 · 敏感词 0 · "
          u"无本地资源引用 · 无 404.html 引用" % (n, PAGES, PAGES))


if __name__ == "__main__":
    main()
