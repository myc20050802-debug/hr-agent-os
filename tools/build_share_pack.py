#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重新生成「分享包」—— 可发给别人的离线演示包（单文件 HTML + 使用说明 + zip）。

为什么要有这个脚本：
    分享包是本仓库**最容易过期**的产物 —— 它不在 git 里（`.gitignore` 忽略），
    没人会记得重新打包。实测证据：仓库已经到 24 页 / 527,133 字节了，
    分享包还停在 9-24 的 23 页 / 297,951 字节，`使用说明.txt` 里写「23 个页面」。
    根治办法：**页面数从代码读**，一句命令重新打包，不靠人记得。

页面数来源：`平台原型/src/app.js` 的 `PAGES.*` 定义去重计数（与 tools/check_docs.js 同源）。

用法（仓库根目录）：
    python tools/build_share_pack.py
输出：
    分享包/HR数字员工平台_原型演示.html
    分享包/HR数字员工平台_原型演示.zip
    分享包/使用说明.txt
"""
import io, os, re, sys, zipfile, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_HTML = os.path.join(ROOT, "平台原型", "index.html")
SRC_APP = os.path.join(ROOT, "平台原型", "src", "app.js")
OUT_DIR = os.path.join(ROOT, "分享包")
HTML_NAME = "HR数字员工平台_原型演示.html"
ZIP_NAME = "HR数字员工平台_原型演示.zip"
README_NAME = "使用说明.txt"


def page_count():
    """从 app.js 读「页面数」—— 唯一事实源，禁止手写。"""
    src = io.open(SRC_APP, encoding="utf-8").read()
    keys = {m.group(1) for m in re.finditer(r"PAGES\.([A-Za-z]+)\s*=", src)}
    if not keys:
        raise SystemExit("✗ 未能从 app.js 解析出 PAGES.*，页面数无法确定，已中止（不要手写数字）。")
    return len(keys), sorted(keys)


def build_readme(npages, nbytes, today):
    kb = round(nbytes / 1024)
    return """HR 数字员工平台 · 可点击原型（演示版）
=========================================

【怎么打开】
双击「{html_name}」，用 Chrome 或 Edge 打开效果最好。
不需要安装任何东西，不需要联网。

【里面有什么】
{npages} 个页面，完整覆盖 HR 的一天：
  · 招聘：岗位管理 / JD 工作台 / 简历筛选台 / 面试安排 / Offer
  · 岗位资料库：市场在招同类岗位参考（BOSS + 智联，共 183 条，其中 75 条带完整 JD）
  · 入转调离：入职、转正、调岗、离职
  · 员工自助问答
  · 人力报表
  · Agent 底座能力
  · 合规与安全：隐私与反歧视 / 角色与权限 / 操作审计日志 / 风险拦截记录

【数据说明（重要）】
· 本文件为「离线演示模式」：用的是内置演示数据，刷新页面即复原，
  不会保存你的任何操作，也不会上传任何信息。
· 页面里的百分比（如「省 70% 时间」）是产品设计目标，不是实测结果。
· 简历筛选、JD 生成等 Agent 是真的在按规则跑逻辑（结论与后端同源），
  只是数据是演示数据。
· 评分与分档 100% 由固定权重的规则算出（可复现、可解释、0 token）；
  接入模型时模型只负责「推荐理由的措辞」。这是设计选择，不是权宜之计。

【一句话背景】
面向 200–5000 人企业的 B 端 HR 数字员工平台，定位
「AI 自主执行 + 人审核确认」——能用规则的绝不用模型，该人签字的绝不交给 AI。
（HR 每天 80% 的时间在查资料 / 搬数据 / 催流程，只有 20% 在做判断；
  把这 80% 交给 AI，判断与签字权留给人。）

【注意】
本原型是用于沟通与评审的交互演示，非正式产品，其中的数据与指标不代表真实业务结果。

-----------------------------------------
本包生成日期：{today}
原型体积：{nbytes:,} bytes（约 {kb} KB，单文件、内联全部样式与脚本）
重新生成：仓库根目录执行 `python tools/build_share_pack.py`
""".format(html_name=HTML_NAME, npages=npages, nbytes=nbytes, kb=kb, today=today)


def main():
    if not os.path.exists(SRC_HTML):
        raise SystemExit("✗ 找不到 %s —— 先执行 `npm run build` 打包前端。" % SRC_HTML)

    npages, keys = page_count()
    nbytes = os.path.getsize(SRC_HTML)
    today = datetime.datetime.now().strftime("%Y-%m-%d")

    os.makedirs(OUT_DIR, exist_ok=True)
    html_out = os.path.join(OUT_DIR, HTML_NAME)
    txt_out = os.path.join(OUT_DIR, README_NAME)
    zip_out = os.path.join(OUT_DIR, ZIP_NAME)

    # 1) 单文件 HTML
    data = io.open(SRC_HTML, encoding="utf-8").read()
    io.open(html_out, "w", encoding="utf-8", newline="").write(data)

    # 2) 使用说明（页面数从代码读）
    io.open(txt_out, "w", encoding="utf-8", newline="").write(build_readme(npages, nbytes, today))

    # 3) zip（含以上两个文件；固定时间戳，便于比对内容是否真变了）
    stamp = (datetime.datetime.now().year, datetime.datetime.now().month,
             datetime.datetime.now().day, 0, 0, 0)
    with zipfile.ZipFile(zip_out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in (html_out, txt_out):
            info = zipfile.ZipInfo(os.path.basename(p), date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, io.open(p, encoding="utf-8").read())

    print("✓ 页面数（读自 app.js）：%d" % npages)
    print("✓ %s  %.0f KB" % (HTML_NAME, len(data.encode("utf-8")) / 1024))
    print("✓ %s" % README_NAME)
    print("✓ %s  %.0f KB" % (ZIP_NAME, os.path.getsize(zip_out) / 1024))
    print("  页面清单：" + ", ".join(keys))


main()
