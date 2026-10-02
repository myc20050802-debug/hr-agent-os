#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BOSS 直聘岗位抓取（免登录）→ 产出可导入岗位资料库的 JSON。

为什么能免登录抓：BOSS 的**岗位详情页是公开的**（搜索引擎可索引），且每页底部渲染
若干「相似职位」+「推荐职位」的详情页链接，于是可以从任意一个公开岗位页出发做 BFS，
自动扩出成百上千个真实在招岗位。

为什么不走 BOSS 的搜索接口：`/wapi/zpgeek/search/joblist.json` 需要 JS 生成的
`__zp_stoken__` cookie，未登录直接返回 code 37「您的环境存在异常」；搜索页同理。

反爬处理：BOSS 在正文里插 `<span class="随机类名">boss</span>` 这类**隐藏干扰字符**
（隐藏规则写在页面 `<style>` 里）。本脚本先从 `<style>` 解析出隐藏类名，再把这些
span 摘掉，否则会得到「职位描boss述」这种破碎文本。

已知限制（不粉饰）：
- **薪资抓不到**：未登录时薪资节点为空 —— BOSS 把薪资放在登录后。
  要薪资请用智联通道：tools/scrape_zhaopin_jobs.py（列表页公开带薪资）。
- 少数岗位 JD 尾部被截断（页面提示「登录查看完整内容」），抓到多少存多少。

用法：
  python tools/scrape_boss_jobs.py --seed <job_detail_url> --max-jobs 60 --out tools/_boss_out.json
  python tools/scrape_boss_jobs.py --seed u1 --seed u2 --max-jobs 120
  python tools/scrape_boss_jobs.py --seed u1 --no-expand          # 只抓种子页

导入资料库：
  python tools/import_boss_jobs.py --file tools/_boss_out.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import re
import time
from urllib.parse import urljoin

try:
    import lxml.html
    from scrapling.fetchers import StealthyFetcher
except ImportError:  # 缺依赖时给一句人话，而不是一屏回溯栈
    raise SystemExit(
        "缺少抓取依赖（scrapling / lxml）。请先安装：\n"
        "  python -m pip install -r tools/requirements-scrape.txt\n"
        "  scrapling install        # 首次运行还需下载浏览器内核\n"
        "注意：抓取脚本与后端（Node）无关，后端零依赖照常运行。"
    )

BASE = "https://www.zhipin.com"
HIDDEN_DEF_RE = re.compile(
    r"\.([A-Za-z][\w-]*)\s*\{[^}]*?(?:visibility\s*:\s*hidden|font-size\s*:\s*0|display\s*:\s*none)",
    re.I,
)
TRUNC_RE = re.compile(r"登录查看完整内容|查看完整内容|登录后查看")


def hidden_class_names(tree) -> set[str]:
    style_text = "".join(tree.xpath("//style//text()"))
    return set(HIDDEN_DEF_RE.findall(style_text))


def drop_keep_tail(el) -> None:
    """删除元素但**保留它的 tail 文本**。

    lxml 的 remove() 会连同该元素的 tail（紧随其后的文本）一起丢掉 —— 反爬 span
    恰好是插在词中间（「职位描<span>boss</span>述：」），直接 remove 会把「述：」吃掉。
    必须先把 tail 并到前一个兄弟（或父元素）的文本上，再删。
    """
    parent = el.getparent()
    if parent is None:
        return
    tail = el.tail
    if tail:
        prev = el.getprevious()
        if prev is not None:
            prev.tail = (prev.tail or "") + tail
        else:
            parent.text = (parent.text or "") + tail
    parent.remove(el)


def denoise(node, hidden: set[str]) -> None:
    """就地摘掉 <style> 与隐藏干扰 span，并把 <br> 转成换行。"""
    for st in node.xpath(".//style"):
        drop_keep_tail(st)
    for span in node.xpath(".//span"):
        classes = set((span.get("class") or "").split())
        if classes & hidden:
            drop_keep_tail(span)
    for br in node.xpath(".//br"):
        br.tail = "\n" + (br.tail or "")


def text_of(node, hidden: set[str], keep_newlines: bool = True) -> str:
    if node is None:
        return ""
    denoise(node, hidden)
    txt = node.text_content()
    txt = txt.replace("\u200b", "").replace("\ufeff", "").replace("\u00a0", " ")
    txt = TRUNC_RE.sub("", txt)
    if keep_newlines:
        txt = re.sub(r"[ \t]+", " ", txt)
        txt = re.sub(r"\n\s*\n+", "\n", txt)
        txt = "\n".join(ln.strip() for ln in txt.split("\n") if ln.strip())
    else:
        txt = re.sub(r"\s+", " ", txt)
    return txt.strip()


def parse_job(html: str, url: str) -> dict | None:
    try:
        tree = lxml.html.fromstring(html)
    except Exception:
        return None
    hidden = hidden_class_names(tree)

    def css(sel):
        try:
            return tree.cssselect(sel)
        except Exception:
            return []

    title = ""
    for sel in ("h1", ".job-banner .name h1"):
        nodes = css(sel)
        if nodes:
            title = (nodes[0].text_content() or "").strip()
            if title:
                break
    if not title:
        return None

    # 头部：城市用专门节点；经验/学历在 banner 文本里按正则捞（无专属 class）
    banner = css(".job-banner")
    banner_txt = text_of(banner[0], hidden, keep_newlines=False) if banner else ""
    city = ""
    for sel in (".text-city", ".job-banner .text-city"):
        nodes = css(sel)
        if nodes:
            city = text_of(nodes[0], hidden, keep_newlines=False)
            if city:
                break
    if not city:
        m = re.search(r"(北京|上海|天津|重庆|广州|深圳|杭州|成都|武汉|南京|西安|苏州|郑州|长沙|青岛|合肥|厦门|福州|济南|沈阳|大连|宁波|无锡|昆明|南昌|贵阳|南宁|哈尔滨|长春|石家庄|太原|乌鲁木齐|兰州|银川|西宁|呼和浩特|海口|拉萨)[^\s]*", banner_txt)
        city = m.group(0) if m else ""
    m = re.search(r"(在校生?|应届生?|经验不限|\d+\s*[-~]\s*\d+\s*年|\d+年以内|\d+-\d+年|10年以上)", banner_txt)
    exp = m.group(1) if m else ""
    m = re.search(r"(初中及以下|中专/中技|高中|大专|本科|硕士|博士|学历不限)", banner_txt)
    degree = m.group(1) if m else ""
    if not degree:
        nodes = css(".text-degree")
        degree = text_of(nodes[0], hidden, keep_newlines=False) if nodes else ""

    salary = ""
    for sel in (".job-banner .salary", ".salary"):
        for node in css(sel):
            t = text_of(node, hidden, keep_newlines=False)
            if t and t not in ("元", "-", "--"):
                salary = t
                break
        if salary:
            break

    # JD 正文：.job-sec-text 是唯一干净入口
    jd = ""
    nodes = css(".job-sec-text")
    if nodes:
        jd = text_of(nodes[0], hidden)
    if not jd:  # 兜底：老结构
        for node in css(".job-detail-section"):
            t = text_of(node, hidden)
            if re.search(r"职位描述|岗位职责|工作内容|任职要求|岗位要求", t):
                jd = t
                break

    # 公司
    company = industry = scale = company_url = ""
    side = css(".sider-company")
    if side:
        node = side[0]
        links = node.cssselect(".company-info a[href*='/gongsi/']")
        if links:
            company = (links[-1].text_content() or "").strip()
            company_url = urljoin(BASE, links[-1].get("href") or "")
        for p in node.cssselect("p"):
            t = text_of(p, hidden, keep_newlines=False)
            if not t or t == "公司基本信息":
                continue
            if re.search(r"人$|人以上", t) and not scale:
                scale = t
            elif not industry:
                industry = t

    address = ""
    for sel in (".location-address", ".job-location .text", ".location .text"):
        nodes = css(sel)
        if nodes:
            address = text_of(nodes[0], hidden, keep_newlines=False)
            if address:
                break

    return {
        "jobName": title,
        "salaryDesc": salary,
        "cityName": city,
        "areaDistrict": address,
        "experience": exp,
        "degree": degree,
        "skillLabels": [],
        "postDescription": jd,
        "jobUrl": url,
        "brand_name": company,
        "brand_industry": industry,
        "brand_scale_name": scale,
        "company_url": company_url,
    }


def next_links(html: str) -> list[str]:
    try:
        tree = lxml.html.fromstring(html)
    except Exception:
        return []
    out = []
    for a in tree.cssselect("a[href*='/job_detail/']"):
        ka = a.get("ka") or ""
        if ka.startswith("job_sug") or ka.startswith("job_recommend"):
            href = (a.get("href") or "").split("?")[0]
            if href:
                out.append(urljoin(BASE, href))
    return out


def fetch(url: str, tries: int = 3):
    for i in range(tries):
        try:
            # disable_resources：图片/字体/媒体全不加载，单页从 ~30s 降到几秒。
            # 需要的只有 HTML 文本，样式/图片对本任务没有价值。
            page = StealthyFetcher.fetch(
                url, headless=True, network_idle=True, timeout=60000,
                disable_resources=True,
            )
            if page.status == 200 and page.html_content:
                return page.html_content
            print(f"    ! HTTP {page.status}，重试 {i + 1}/{tries}")
        except Exception as e:
            print(f"    ! {type(e).__name__}: {str(e)[:90]}，重试 {i + 1}/{tries}")
        time.sleep(2 + i * 2)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="BOSS 直聘岗位抓取（免登录 BFS）")
    ap.add_argument("--seed", action="append", required=True, help="起始岗位详情页 URL（可重复）")
    ap.add_argument("--max-jobs", type=int, default=60, help="最多抓多少个岗位（默认 60）")
    ap.add_argument("--out", default="tools/_boss_out.json", help="输出 JSON 路径")
    ap.add_argument("--no-expand", action="store_true", help="只抓种子页，不做 BFS 扩展")
    ap.add_argument("--delay", type=float, default=1.5, help="请求间基础间隔秒（默认 1.5）")
    args = ap.parse_args()

    queue = [u.strip() for u in args.seed if u.strip()]
    seen: set[str] = set()
    jobs: list[dict] = []
    started = dt.datetime.now()

    while queue and len(jobs) < args.max_jobs:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        print(f"[{len(jobs) + 1}/{args.max_jobs}] {url}")
        html = fetch(url)
        if not html:
            print("    × 抓取失败，跳过")
            continue
        job = parse_job(html, url)
        if not job:
            print("    × 解析不出岗位（可能已下架）")
            continue
        jobs.append(job)
        print(f"    ✓ {job['jobName']} | {job['brand_name'] or '?'} | {job['cityName'] or '?'} | JD {len(job['postDescription'])} 字")
        if not args.no_expand:
            fresh = [u for u in next_links(html) if u not in seen]
            random.shuffle(fresh)
            queue.extend(fresh)
            print(f"    → 队列 +{len(fresh)}，当前 {len(queue)}")
        time.sleep(args.delay + random.random())

    by_company: dict[str, dict] = {}
    for j in jobs:
        c = by_company.setdefault(j["brand_name"] or "(未知公司)", {
            "brand_name": j["brand_name"], "brand_industry": j["brand_industry"],
            "brand_scale_name": j["brand_scale_name"], "company_url": j["company_url"], "jobs": [],
        })
        c["jobs"].append({
            "jobName": j["jobName"], "salaryDesc": j["salaryDesc"],
            "cityName": j["cityName"], "areaDistrict": j["areaDistrict"],
            "experience": j["experience"], "degree": j["degree"],
            "skillLabels": j["skillLabels"], "postDescription": j["postDescription"],
            "jobUrl": j["jobUrl"],
        })

    now = dt.datetime.now()
    payload = {
        "schema_version": 1,
        "source": "boss",
        "created_at": now.isoformat(timespec="seconds"),
        "search": {"keyword": "", "city": {"name": ""}},
        "summary": {
            "jobs": len(jobs), "companies": len(by_company),
            "with_jd": sum(1 for j in jobs if j["postDescription"]),
            "with_salary": sum(1 for j in jobs if j["salaryDesc"]),
            "elapsed_sec": round((now - started).total_seconds(), 1),
        },
        "companies": list(by_company.values()),
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    s = payload["summary"]
    print("\n======== 汇总 ========")
    print(f"岗位 {s['jobs']} / 公司 {s['companies']} / 含 JD {s['with_jd']} / 含薪资 {s['with_salary']}")
    print(f"耗时 {s['elapsed_sec']}s → {args.out}")
    print(f"\n导入资料库：\n  python tools/import_boss_jobs.py --file {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
