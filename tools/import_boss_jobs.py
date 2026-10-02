#!/usr/env python3
# -*- coding: utf-8 -*-
"""把 boss_company_scraper.py 的产物（boss_companies_*.json）导入 HR 平台的岗位资料库。

抓取脚本是 Python、产物是 JSON；本工具只做「读 JSON 写 SQLite」，不依赖 Node，独立可跑。
数据库用 Python 标准库 sqlite3 直接打开主库文件。

幂等：每行按 (租户, 岗位名, 公司, 地点, 来源URL) 计算稳定 id，INSERT OR REPLACE，
重复导入同一来源不会翻倍。

用法：
  python tools/import_boss_jobs.py --dir ~/.boss-company/company-result
  python tools/import_boss_jobs.py --file boss_companies_20260903_094303.json
  python tools/import_boss_jobs.py --dir <dir> --db /path/to/hr_agent.db
  python tools/import_boss_jobs.py --dir <dir> --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path

TENANT = "T-001"

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS reference_jobs (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL DEFAULT 'T-001',
  job_title       TEXT NOT NULL,
  job_description TEXT,
  salary_range    TEXT,
  location        TEXT,
  company_name    TEXT,
  company_industry TEXT,
  company_scale   TEXT,
  source_url      TEXT,
  skill_labels    TEXT,
  scraped_at      TEXT,
  raw_json        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_title   ON reference_jobs(job_title);
CREATE INDEX IF NOT EXISTS idx_ref_loc     ON reference_jobs(location);
CREATE INDEX IF NOT EXISTS idx_ref_scraped ON reference_jobs(scraped_at DESC);
"""


def stable_id(tenant, title, company, location, url):
    key = "||".join([tenant, title or "", company or "", location or "", url or ""])
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]


def fmt_skills(skill_labels):
    """skill_labels 可能是 list 或字符串，统一成逗号分隔。"""
    if not skill_labels:
        return ""
    if isinstance(skill_labels, list):
        return "，".join(str(x).strip() for x in skill_labels if str(x).strip())
    return str(skill_labels).strip()


def jobs_from_company(company, search):
    """从单个公司对象抽出逐岗位记录，兼容两种格式：
    - 扩展格式：company['jobs'] 是 list，每项含岗位级字段；
    - 现有格式：只有 company['matched_job_names']（岗位名列表），无逐岗位明细。
    返回 list[dict]。"""
    out = []
    city = (search.get("city") or {}).get("name", "")
    city_code = (search.get("city") or {}).get("code", "")
    # 行业/规模优先取公司维度（brand_industry），否则取搜索条件
    industry = (company.get("brand_industry") or "").strip()
    if not industry and search.get("industry"):
        industry = "，".join(
            it.get("name", "") for it in search["industry"] if isinstance(it, dict)
        ).strip()
    scale = (company.get("brand_scale_name") or "").strip()
    if not scale and search.get("scale"):
        scale = "，".join(
            it.get("name", "") for it in search["scale"] if isinstance(it, dict)
        ).strip()
    company_name = (company.get("brand_name") or "").strip()
    company_url = (company.get("company_url") or "").strip()
    base = {
        "company_name": company_name,
        "company_industry": industry,
        "company_scale": scale,
        "source_url": company_url,
    }

    jobs = company.get("jobs")
    if isinstance(jobs, list) and jobs:
        for j in jobs:
            if not isinstance(j, dict):
                continue
            title = (j.get("jobName") or "").strip()
            if not title:
                continue
            loc = (j.get("cityName") or city or "").strip()
            district = (j.get("areaDistrict") or "").strip()
            if district.startswith(loc) and loc:
                # 抓取源常把城市写进地址（「上海长宁区尚嘉中心」）——
                # 再前置城市会得到「上海·上海长宁区…」，此时以地址为准。
                loc = district
            elif loc and district and district not in loc:
                loc = f"{loc}·{district}"
            out.append({
                **base,
                "job_title": title,
                "job_description": (j.get("postDescription") or "").strip(),
                "salary_range": (j.get("salaryDesc") or "").strip(),
                "location": loc,
                "skill_labels": fmt_skills(j.get("skillLabels")),
                "job_url": (j.get("jobUrl") or "").strip(),
                "raw": j,
            })
        return out

    # 回退：现有格式（只得岗位名）
    names = company.get("matched_job_names") or []
    if isinstance(names, list):
        for title in names:
            title = str(title).strip()
            if not title:
                continue
            out.append({
                **base,
                "job_title": title,
                "job_description": "",
                "salary_range": "",
                "location": city,
                "skill_labels": "",
                "job_url": company_url,
                "raw": {"jobName": title, "note": "legacy matched_job_names"},
            })
    return out


def import_file(path: Path, db_path: Path, dry_run: bool):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"  跳过（解析失败）：{path.name} —— {exc}")
        return 0, 0
    companies = data.get("companies") or []
    search = data.get("search") or {}
    scraped_at = (data.get("created_at") or "").strip()
    rows = []
    for company in companies:
        if not isinstance(company, dict):
            continue
        rows.extend(jobs_from_company(company, search))
    if not rows:
        print(f"  空：{path.name}（{len(companies)} 家公司，无可用岗位）")
        return 0, 0

    inserted = 0
    if dry_run:
        for r in rows:
            rid = stable_id(TENANT, r["job_title"], r["company_name"], r["location"], r["job_url"])
            inserted += 1
        print(f"  预览：{path.name} → {inserted} 个岗位（不落库）")
        return inserted, 0

    conn = sqlite3.connect(str(db_path))
    conn.isolation_level = None
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        conn.executescript(CREATE_SQL)
        conn.execute("BEGIN")
        for r in rows:
            rid = stable_id(TENANT, r["job_title"], r["company_name"], r["location"], r["job_url"])
            conn.execute(
                """INSERT OR REPLACE INTO reference_jobs
                   (id, tenant_id, job_title, job_description, salary_range, location,
                    company_name, company_industry, company_scale, source_url, skill_labels, scraped_at, raw_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rid, TENANT, r["job_title"], r["job_description"], r["salary_range"],
                    r["location"], r["company_name"], r["company_industry"], r["company_scale"],
                    r["job_url"], r["skill_labels"], scraped_at,
                    json.dumps(r["raw"], ensure_ascii=False),
                ),
            )
            inserted += 1
        conn.execute("COMMIT")
    finally:
        conn.close()
    return inserted, 0


def main(argv=None) -> int:
    here = Path(__file__).resolve().parent
    default_db = here.parent / "server" / "hr_agent.db"
    default_dir = Path.home() / ".boss-company" / "company-result"

    ap = argparse.ArgumentParser(description="将 BOSS 抓取产物导入岗位资料库")
    ap.add_argument("--dir", type=str, default=str(default_dir), help="包含 boss_companies_*.json 的目录")
    ap.add_argument("--file", type=str, help="单个 JSON 文件路径")
    ap.add_argument("--db", type=str, default=str(default_db), help="主库 hr_agent.db 路径")
    ap.add_argument("--dry-run", action="store_true", help="只预览、不落库")
    args = ap.parse_args(argv)

    db_path = Path(args.db).expanduser().resolve()
    files = []
    if args.file:
        p = Path(args.file).expanduser().resolve()
        if p.is_file():
            files = [p]
        else:
            print(f"文件不存在：{p}")
            return 2
    else:
        d = Path(args.dir).expanduser()
        if not d.is_dir():
            print(f"目录不存在：{d}")
            return 2
        files = sorted(d.glob("boss_companies_*.json"), key=lambda x: x.name)

    if not files:
        print(f"未找到任何 boss_companies_*.json（目录：{args.dir}）")
        return 0

    print(f"目标库：{db_path}")
    print(f"待处理：{len(files)} 个文件（{'预览模式' if args.dry_run else '写入模式'}）")
    total = 0
    for f in files:
        total += import_file(f, db_path, args.dry_run)[0]

    if args.dry_run:
        print(f"\n预览合计：{total} 个岗位（未写入）")
        return 0

    # 写完后统计
    try:
        conn = sqlite3.connect(str(db_path))
        conn.execute("PRAGMA busy_timeout=30000")
        n = conn.execute("SELECT COUNT(*) FROM reference_jobs").fetchone()[0]
        conn.close()
        print(f"\n写入完成：本次 {total} 个岗位；资料库现有 {n} 条")
    except sqlite3.Error as exc:
        print(f"\n写入完成：本次 {total} 个岗位（统计失败：{exc}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
