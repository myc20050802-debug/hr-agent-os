#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把逐页截图（page-N.png）组装成 19 页 PDF —— 投递平台附件栏用这个。

为什么需要它
------------
招聘平台的「作品附件」栏对 `.html` 基本不友好（当纯文本贴出 / 只给下载 /
沙箱 iframe 禁脚本 → 白屏）。**PDF 是全平台都能在线预览的格式**，手机上也能翻。
而 HTML 单文件的正确定位是「微信 / 邮件私发给 HR，对方双击就开」。

单一源
------
不重新渲染任何东西：消费 `frontend/scripts/shoot-slides.py` 产出的同一批
page-N.png（与 PPTX 完全同源），所以 PDF 与 PPTX 的视觉必然一致。

用法
----
    # 1. 起服务：cd frontend && npx vite preview --port 5180 --strictPort
    # 2. 截图：  python frontend/scripts/shoot-slides.py --url http://127.0.0.1:5180 \
    #              -o frontend/public/assets/images/posters/pages
    # 3. 组装：  python tools/build_portfolio_pdf.py
"""

import argparse
import os
import re
import sys

def _load_pymupdf():
    """PyMuPDF 新名叫 pymupdf、老名叫 fitz，两个都试；都没有就给可操作的提示。

    这里刻意不打印任何本机绝对路径（仓库不变量：不得出现「本机盘符 + 用户名」）。
    """
    for name in ("pymupdf", "fitz"):
        try:
            return __import__(name)
        except ImportError:
            continue
    print(u"✗ 缺依赖 PyMuPDF（PDF 组装用）。安装后重试：")
    print(u"    python -m pip install pymupdf")
    print(u"  若系统 python 与项目用的不是同一个解释器，"
          u"请改用装了 PyMuPDF 的那个来执行本脚本。")
    sys.exit(2)


pymupdf = _load_pymupdf()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGES = 19                       # 作品集页数（与 build_portfolio_single.py 同源）
SLIDE_W, SLIDE_H = 1440, 810     # 截图逻辑尺寸（@2x 实际是 2880x1620）
# 1440x810 px @96DPI → 15in x 8.4375in → 1080 x 607.5 pt（与 PPTX 布局同尺寸）
PT_W, PT_H = 1080.0, 607.5

TITLE = "HR-Agent OS · 招聘全链路 AI Agent 平台"
AUTHOR = "马云冲 · AI 产品经理作品集"


def die(msg):
    print(u"✗ " + msg)
    sys.exit(1)


def collect(pages_dir):
    """按数字顺序取 page-N.png（不能用字典序：page-10 会排到 page-2 前面）。"""
    if not os.path.isdir(pages_dir):
        die(u"截图目录不存在：%s\n  先跑 frontend/scripts/shoot-slides.py" % pages_dir)
    items = []
    for f in os.listdir(pages_dir):
        m = re.match(r"^page-(\d+)\.png$", f, re.I)
        if m:
            items.append((int(m.group(1)), os.path.join(pages_dir, f)))
    items.sort(key=lambda x: x[0])
    if not items:
        die(u"%s 里没有 page-N.png" % pages_dir)
    return items


def main():
    ap = argparse.ArgumentParser(description="逐页截图 → 19 页 PDF（投递平台附件用）")
    ap.add_argument("--pages-dir", default=os.path.join(
        ROOT, "frontend", "public", "assets", "images", "posters", "pages"))
    ap.add_argument("--out", default=os.path.join(
        ROOT, "artifacts", u"HR-Agent-OS_作品集_%d页.pdf" % PAGES))
    ap.add_argument("--overview", default=os.path.join(
        ROOT, "artifacts", u"HR-Agent-OS_作品集_%d页_全览.png" % PAGES),
        help=u"额外输出一张「全览图」（把 19 页拼成一张 PNG）")
    ap.add_argument("--no-overview", action="store_true",
                    help=u"不要全览图")
    args = ap.parse_args()
    if args.no_overview:
        args.overview = None

    items = collect(args.pages_dir)

    # ---- 断言 1：页数必须对 ----
    if len(items) != PAGES:
        die(u"截图 %d 张（期望 %d）：%s" % (
            len(items), PAGES, [n for n, _ in items]))
    nums = [n for n, _ in items]
    if nums != list(range(1, PAGES + 1)):
        die(u"页码不连续或有重复：%s" % nums)

    # ---- 组装 ----
    doc = pymupdf.open()
    for n, path in items:
        if not os.path.isfile(path):
            die(u"缺文件：%s" % path)
        page = doc.new_page(width=PT_W, height=PT_H)
        page.insert_image(pymupdf.Rect(0, 0, PT_W, PT_H), filename=path)

    doc.set_metadata({"title": TITLE, "author": AUTHOR,
                      "subject": u"面试作品集 · %d 页" % PAGES})
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    doc.save(args.out, deflate=True, garbage=4)
    doc.close()

    # ---- 断言 2：读回来复核（不是「写完了就当成功」）----
    back = pymupdf.open(args.out)
    n_back = back.page_count
    r0 = back[0].rect
    imgs = sum(len(back[i].get_images(full=True)) for i in range(n_back))
    back.close()
    if n_back != PAGES:
        die(u"产物页数 = %d（期望 %d）" % (n_back, PAGES))
    if imgs != PAGES:
        die(u"产物内嵌图片 %d 张（期望 %d）—— 有页是空的" % (imgs, PAGES))

    size = os.path.getsize(args.out)
    print(u"✓ %d 页 PDF 已生成" % PAGES)
    print(u"  源：%s（%d 张 page-N.png）" % (
        os.path.relpath(args.pages_dir, ROOT).replace("\\", "/"), len(items)))
    print(u"  出：%s" % os.path.relpath(args.out, ROOT).replace("\\", "/"))
    print(u"  纸张：%.0f x %.0f pt（15 x 8.4375 in，与 PPTX 同尺寸）· 体积：%s 字节"
          % (r0.width, r0.height, format(size, ",")))
    print(u"  复核：页数 %d ✓ · 内嵌图 %d ✓" % (n_back, imgs))
    print(u"  注：内容为整页位图，**没有文本层**（所以「搜敏感词」这类检查必须在"
          u"生成前的 HTML 上做，不能靠 PDF 文本检索）。")

    if args.overview:
        build_overview(items, args.overview)


def build_overview(items, out_path):
    """把每一页缩略图拼成一张「全览图」，方便快速扫一眼整体。"""
    try:
        from PIL import Image
    except ImportError:
        print(u"  （没装 Pillow，跳过全览图）")
        return
    COLS, TW = 5, 400
    TH = int(TW * SLIDE_H / SLIDE_W)
    GAP, PAD = 14, 20
    rows = (len(items) + COLS - 1) // COLS
    W = PAD * 2 + COLS * TW + (COLS - 1) * GAP
    H = PAD * 2 + rows * TH + (rows - 1) * GAP
    sheet = Image.new("RGB", (W, H), (8, 11, 18))
    for i, (_n, path) in enumerate(items):
        im = Image.open(path).convert("RGB").resize((TW, TH), Image.LANCZOS)
        x = PAD + (i % COLS) * (TW + GAP)
        y = PAD + (i // COLS) * (TH + GAP)
        sheet.paste(im, (x, y))
    sheet.save(out_path, optimize=True)
    print(u"  全览：%s（%s 字节）" % (os.path.relpath(out_path, ROOT).replace("\\", "/"),
                                    format(os.path.getsize(out_path), ",")))


if __name__ == "__main__":
    main()
