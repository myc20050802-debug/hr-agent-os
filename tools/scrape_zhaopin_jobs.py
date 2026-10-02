#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""智联招聘岗位抓取（免登录）→ 产出可导入岗位资料库的 JSON。

为什么另开一条智联通道：
- BOSS 的岗位**薪资字段在登录后才可见**（未登录一律为空），而智联的**列表页完全公开**
  且直接带薪资区间、地点、经验、学历、公司规模与行业。
- 智联的岗位详情页也公开，能拿到完整的「岗位职责 / 岗位要求」正文。
于是：列表页拿「薪资+元信息」，详情页拿「JD 正文」，两边都免登录。

用法：
  # 先看列表页结构（调试用）
  python tools/scrape_zhaopin_jobs.py --probe --kw 产品经理 --jl 530

  # 正式抓取：关键词「产品经理」、北京(jl=530)、前 2 页列表 → 逐个详情页取 JD
  python tools/scrape_zhaopin_jobs.py --kw 产品经理 --jl 530 --pages 2 \
      --max-jobs 40 --out tools/_zhaopin_out.json

  # 只抓列表（不要 JD 正文，快很多）
  python tools/scrape_zhaopin_jobs.py --kw 律师 --jl 530 --pages 2 --list-only

导入资料库：
  python tools/import_boss_jobs.py --file tools/_zhaopin_out.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import re
import time
from urllib.parse import quote, urljoin

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

BASE = "https://www.zhaopin.com"
LIST_TPL = "https://www.zhaopin.com/sou/?kw={kw}&jl={jl}&p={p}"
UA = None


def fetch(url: str, tries: int = 3, disable_resources: bool = True):
    for i in range(tries):
        try:
            page = StealthyFetcher.fetch(
                url, headless=True, network_idle=True, timeout=60000,
                disable_resources=disable_resources, useragent=UA,
            )
            if page.status == 200 and page.html_content:
                return page.html_content
            print(f"    ! HTTP {page.status}，重试 {i + 1}/{tries}")
        except Exception as e:
            print(f"    ! {type(e).__name__}: {str(e)[:90]}，重试 {i + 1}/{tries}")
        time.sleep(2 + i * 2)
    return None


def one(el, sels):
    for s in sels:
        try:
            n = el.cssselect(s)
        except Exception:
            continue
        if n:
            t = re.sub(r"\s+", " ", n[0].text_content()).strip()
            if t:
                return t
    return ""


def parse_list(html: str) -> list[dict]:
    """解析列表页 → [{job_title, job_url, salary, location, exp, degree, company, company_url, industry, scale, tags}]

    卡片容器 `.joblist-box__iteminfo` 内字段固定：
      .jobinfo__name / .jobinfo__salary / .jobinfo__other-info-item[地点,经验,学历]
      .companyinfo__name / .companyinfo__tag .joblist-box__item-tag[性质,规模,行业]
    取不到容器时退回「从标题链接向上找 4 层」的兜底策略。
    """
    tree = lxml.html.fromstring(html)
    cards = tree.cssselect(".joblist-box__iteminfo")
    if not cards:
        seen_up: set[int] = set()
        for a in tree.cssselect("a[href*='/jobdetail/']"):
            node = a
            for _ in range(4):
                if node.getparent() is None:
                    break
                node = node.getparent()
            if id(node) not in seen_up:
                seen_up.add(id(node))
                cards.append(node)

    out: list[dict] = []
    seen: set[str] = set()
    for card in cards:
        a = card.cssselect("a[href*='/jobdetail/']")
        if not a:
            continue
        href = (a[0].get("href") or "").split("?")[0]
        if not href or href in seen:
            continue
        title = one(card, [".jobinfo__name"]) or re.sub(r"\s+", " ", a[0].text_content()).strip()
        if not title or len(title) > 60:
            continue
        seen.add(href)

        salary = one(card, [".jobinfo__salary"])
        if not salary:
            m = re.search(r"(\d+(?:\.\d+)?\s*[-~]\s*\d+(?:\.\d+)?\s*[万千]|\d+\s*元/[时天月]|\d+\s*[-~]\s*\d+\s*元)(·\d+薪)?",
                          re.sub(r"\s+", " ", card.text_content()))
            if m:
                salary = re.sub(r"\s+", "", m.group(0))

        others = [one(it, []) or re.sub(r"\s+", " ", it.text_content()).strip()
                  for it in card.cssselect(".jobinfo__other-info-item")]
        others = [x for x in others if x]
        loc = next((x for x in others if re.search(r"[\u4e00-\u9fa5]{2,8}·|北京|上海|广州|深圳", x)), "")
        exp = next((x for x in others if re.search(r"经验不限|在校|应届|\d+年", x)), "")
        deg = next((x for x in others if re.search(r"初中|中专|高中|大专|本科|硕士|博士|学历不限", x)), "")

        comp = card.cssselect(".companyinfo__name") or card.cssselect("a[href*='/companydetail/'], a[href*='/company/']")
        company = ""
        company_url = ""
        if comp:
            company = re.sub(r"\s+", " ", comp[0].text_content()).strip()
            company_url = urljoin(BASE, (comp[0].get("href") or "").split("?")[0])

        tags = [re.sub(r"\s+", " ", t.text_content()).strip()
                for t in card.cssselect(".companyinfo__tag .joblist-box__item-tag")]
        tags = [t for t in tags if t]
        scale = next((t for t in tags if re.search(r"\d+人|人以上|人以下", t)), "")
        # 行业 = 标签里既不是公司性质也不是规模的最后一个（如「日化制造」）
        nature = ("民营", "国企", "外资", "合资", "上市公司", "已上市", "事业单位", "政府机关", "不需要融资")
        industry = next((t for t in reversed(tags) if t != scale and t not in nature and "融资" not in t and "轮" not in t), "")

        out.append({
            "job_title": title, "job_url": urljoin(BASE, href), "salary": salary,
            "location": loc, "experience": exp, "degree": deg,
            "company": company, "company_url": company_url,
            "scale": scale, "industry": industry, "tags": [],
        })
    return out


def parse_detail(html: str) -> dict:
    """详情页 → 完整 JD 正文 + 更精确的地点/公司信息。"""
    tree = lxml.html.fromstring(html)
    for st in tree.xpath("//style"):
        st.getparent().remove(st)

    def txt_of(el):
        if el is None:
            return ""
        for br in el.xpath(".//br"):
            br.tail = "\n" + (br.tail or "")
        t = el.text_content().replace("\u00a0", " ").replace("\u200b", "")
        t = re.sub(r"[ \t]+", " ", t)
        t = re.sub(r"\n\s*\n+", "\n", t)
        return "\n".join(x.strip() for x in t.split("\n") if x.strip()).strip()

    jd = ""
    for sel in (".describtion__detail-content", ".job-description", "[class*=describtion]", ".summary-plane__detail"):
        n = tree.cssselect(sel)
        if n:
            t = txt_of(n[0])
            t = re.sub(r"登录查看完整内容.*$", "", t, flags=re.S).strip()
            if len(t) > 30:
                jd = t
                break

    addr = ""
    for sel in ("[class*=address]", ".location-address"):
        n = tree.cssselect(sel)
        if n:
            addr = re.sub(r"\s+", " ", n[0].text_content()).strip()
            if addr:
                break
    return {"postDescription": jd, "address": addr}


def build_payload(jobs: list[dict], kw: str, jl: str, src: str) -> dict:
    by_company: dict[str, dict] = {}
    for j in jobs:
        c = by_company.setdefault(j["company"] or "(未知公司)", {
            "brand_name": j["company"], "brand_industry": j["industry"],
            "brand_scale_name": j["scale"], "company_url": j["company_url"], "jobs": [],
        })
        c["jobs"].append({
            "jobName": j["job_title"], "salaryDesc": j["salary"],
            "cityName": (j["location"].split("·")[0] if j["location"] else ""),
            "areaDistrict": j.get("address") or j["location"],
            "experience": j["experience"], "degree": j["degree"],
            "skillLabels": j["tags"], "postDescription": j["postDescription"],
            "jobUrl": j["job_url"],
        })
    now = dt.datetime.now()
    return {
        "schema_version": 1, "source": src,
        "created_at": now.isoformat(timespec="seconds"),
        "search": {"keyword": kw, "city": {"name": jl}},
        "summary": {
            "jobs": len(jobs), "companies": len(by_company),
            "with_jd": sum(1 for j in jobs if j.get("postDescription")),
            "with_salary": sum(1 for j in jobs if j["salary"]),
        },
        "companies": list(by_company.values()),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="智联招聘岗位抓取（免登录）")
    ap.add_argument("--kw", default="律师", help="搜索关键词")
    ap.add_argument("--jl", default="530", help="城市编码，默认 530=北京")
    ap.add_argument("--pages", type=int, default=1, help="抓前 N 页列表")
    ap.add_argument("--max-jobs", type=int, default=40, help="最多抓多少个岗位详情")
    ap.add_argument("--out", default="tools/_zhaopin_out.json", help="输出 JSON")
    ap.add_argument("--list-only", action="store_true", help="只抓列表，不进详情页")
    ap.add_argument("--probe", action="store_true", help="打印列表页卡片结构后退出")
    ap.add_argument("--delay", type=float, default=1.2, help="请求间隔秒")
    args = ap.parse_args()

    if args.probe:
        html = fetch(LIST_TPL.format(kw=quote(args.kw), jl=args.jl, p=1))
        if not html:
            print("抓取失败")
            return 1
        tree = lxml.html.fromstring(html)
        cards = tree.cssselect("a[href*='/jobdetail/']")
        print("jobdetail 链接数:", len(cards))
        print("--- 解析结果 ---")
        rows = parse_list(html)
        for r in rows[:6]:
            print(json.dumps(r, ensure_ascii=False))
        if cards:
            card = cards[0]
            for _ in range(4):
                if card.getparent() is None:
                    break
                card = card.getparent()
            open("_zhaopin_card.html", "w", encoding="utf-8").write(lxml.html.tostring(card, encoding="unicode"))
            print("首卡 HTML → _zhaopin_card.html")
        return 0

    rows: list[dict] = []
    for p in range(1, args.pages + 1):
        url = LIST_TPL.format(kw=quote(args.kw), jl=args.jl, p=p)
        print(f"[列表 p{p}] {url}")
        html = fetch(url)
        if not html:
            continue
        got = parse_list(html)
        print(f"    ✓ 解析出 {len(got)} 个岗位卡片")
        rows.extend(got)
        time.sleep(args.delay + random.random())

    if args.list_only:
        payload = build_payload(rows, args.kw, args.jl, "zhaopin-list")
    else:
        seen = set()
        out_rows = []
        for r in rows:
            if r["job_url"] in seen or len(out_rows) >= args.max_jobs:
                continue
            seen.add(r["job_url"])
            print(f"[详情 {len(out_rows) + 1}/{min(args.max_jobs, len(rows))}] {r['job_title']}")
            h = fetch(r["job_url"])
            if h:
                d = parse_detail(h)
                r["postDescription"] = d["postDescription"]
                if d["address"] and not r["location"]:
                    r["location"] = d["address"]
            else:
                r["postDescription"] = ""
            print(f"    ✓ JD {len(r.get('postDescription') or '')} 字 / 薪资 {r['salary'] or '—'}")
            out_rows.append(r)
            time.sleep(args.delay + random.random())
        payload = build_payload(out_rows, args.kw, args.jl, "zhaopin")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    s = payload["summary"]
    print(f"\n======== 汇总 ========\n岗位 {s['jobs']} / 公司 {s['companies']} / 含 JD {s['with_jd']} / 含薪资 {s['with_salary']}")
    print(f"→ {args.out}")
    print(f"\n导入资料库：\n  python tools/import_boss_jobs.py --file {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
