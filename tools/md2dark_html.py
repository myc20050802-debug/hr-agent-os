#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把多份 Markdown 合并渲染为一个暗色单文件 HTML（零外部依赖、可搜索、可切换文档）。

用法:
    python md2dark_html.py --out ../HR-AI-Agent平台_产品方案.html \
        --title "..." docs/01.md docs/02.md
"""
import argparse, html, os, re, json
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))


def esc(t: str) -> str:
    return html.escape(t, quote=False)


def inline(t: str) -> str:
    """行内语法：行内代码 -> 加粗 -> 斜体 -> 链接"""
    t = esc(t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" target="_blank" rel="noreferrer">\1</a>', t)
    return t


def slug_id(text: str, used: dict) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text).strip("-")[:60] or "sec"
    n = used.get(s, 0)
    used[s] = n + 1
    return s if n == 0 else f"{s}-{n}"


def convert(md: str, doc_key: str):
    """返回 (html_body, toc_items)"""
    lines = md.split("\n")
    out, toc = [], []
    used = {}
    i, n = 0, len(lines)
    in_code = False
    code_buf, code_lang = [], ""
    list_stack = []  # 'ul' / 'ol'

    def close_lists():
        while list_stack:
            out.append(f"</{list_stack.pop()}>")

    while i < n:
        line = lines[i]

        # 代码块
        if line.strip().startswith("```"):
            if not in_code:
                in_code, code_lang, code_buf = True, line.strip()[3:].strip(), []
            else:
                body = esc("\n".join(code_buf))
                out.append(
                    f'<div class="codeblock"><div class="codetop">'
                    f'<span class="lang">{esc(code_lang or "text")}</span>'
                    f'<button class="copybtn" onclick="copyCode(this)">复制</button></div>'
                    f"<pre><code>{body}</code></pre></div>"
                )
                in_code = False
            i += 1
            continue
        if in_code:
            code_buf.append(line)
            i += 1
            continue

        s = line.strip()

        # 表格
        if s.startswith("|") and i + 1 < n and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1].strip()):
            header = [c.strip() for c in s.strip("|").split("|")]
            rows = []
            j = i + 2
            while j < n and lines[j].strip().startswith("|"):
                rows.append([c.strip() for c in lines[j].strip().strip("|").split("|")])
                j += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in header)
            trs = []
            for r in rows:
                tds = "".join(f"<td>{inline(c)}</td>" for c in r)
                trs.append(f"<tr>{tds}</tr>")
            out.append(
                f'<div class="tablewrap"><table><thead><tr>{th}</tr></thead>'
                f'<tbody>{"".join(trs)}</tbody></table></div>'
            )
            i = j
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            close_lists()
            lvl = len(m.group(1))
            text = m.group(2).strip()
            hid = slug_id(text, used)
            anchor = f"{doc_key}--{hid}"
            if lvl <= 3:
                toc.append({"id": anchor, "text": re.sub(r"[*`]", "", text), "lvl": lvl, "doc": doc_key})
            out.append(f'<h{lvl} id="{anchor}">{inline(text)}</h{lvl}>')
            i += 1
            continue

        # 分隔线
        if re.match(r"^-{3,}$", s) or re.match(r"^\*{3,}$", s):
            close_lists()
            out.append('<hr class="sep">')
            i += 1
            continue

        # 引用
        if s.startswith(">"):
            close_lists()
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            body = " ".join(x for x in buf if x)
            out.append(f'<blockquote>{inline(body)}</blockquote>')
            continue

        # 列表
        m_ul = re.match(r"^[-*+]\s+(.*)$", s)
        m_ol = re.match(r"^(\d+)[.)]\s+(.*)$", s)
        if m_ul or m_ol:
            want = "ul" if m_ul else "ol"
            if not list_stack or list_stack[-1] != want:
                close_lists()
                out.append(f"<{want}>")
                list_stack.append(want)
            content = m_ul.group(1) if m_ul else m_ol.group(2)
            out.append(f"<li>{inline(content)}</li>")
            i += 1
            continue

        # 空行
        if not s:
            close_lists()
            i += 1
            continue

        # 普通段落
        close_lists()
        out.append(f"<p>{inline(s)}</p>")
        i += 1

    close_lists()
    if in_code and code_buf:
        out.append(f"<pre><code>{esc(chr(10).join(code_buf))}</code></pre>")
    return "\n".join(out), toc


def build(paths, title, subtitle):
    docs, all_toc = [], []
    for p in paths:
        raw = open(p, encoding="utf-8").read()
        name = os.path.splitext(os.path.basename(p))[0]
        # 第一篇的一级标题当文档名
        first_h1 = next((l.lstrip("# ").strip() for l in raw.split("\n") if l.startswith("# ")), name)
        key = f"doc{len(docs)}"
        body, toc = convert(raw, key)
        docs.append({"key": key, "name": first_h1, "file": os.path.basename(p), "body": body})
        all_toc.append({"doc": key, "name": first_h1, "items": toc})

    now = datetime.now(CST).strftime("%Y-%m-%d %H:%M")
    tabs = "".join(
        f'<button class="tab{" active" if idx == 0 else ""}" data-doc="{d["key"]}">{esc(d["name"])}</button>'
        for idx, d in enumerate(docs)
    )
    navs = "".join(
        f'<div class="tocgroup" data-doc="{g["doc"]}"{" style=\"display:none\"" if gi else ""}>'
        + "".join(
            f'<a class="toclink lvl{t["lvl"]}" href="#{t["id"]}" data-text="{esc(t["text"])}">{esc(t["text"])}</a>'
            for t in g["items"]
        )
        + "</div>"
        for gi, g in enumerate(all_toc)
    )
    bodies = "".join(
        f'<article class="doc" data-doc="{d["key"]}"{" style=\"display:none\"" if idx else ""}>'
        f'<div class="docmeta">{esc(d["file"])}</div>{d["body"]}</article>'
        for idx, d in enumerate(docs)
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<style>
:root{{
  --bg:#0d0f14; --bg2:#12151c; --panel:#161a23; --panel2:#1b2029;
  --line:#262c39; --line2:#323a4b;
  --tx:#e7eaf1; --tx2:#a8b1c2; --tx3:#6f7a8d;
  --ac:#4c8dff; --ac2:#7aa9ff; --grn:#3ddc97; --yel:#f5b942; --red:#ff6b6b; --pur:#a78bfa;
  --mono:ui-monospace,SFMono-Regular,"Cascadia Mono","JetBrains Mono",Consolas,monospace;
}}
*{{box-sizing:border-box}}
html{{scroll-behavior:smooth}}
body{{margin:0;background:var(--bg);color:var(--tx);
  font:15px/1.78 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}}
header{{position:sticky;top:0;z-index:50;background:rgba(13,15,20,.92);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--line);padding:14px 26px 0}}
.hrow{{display:flex;align-items:center;gap:14px;flex-wrap:wrap}}
h1.brand{{font-size:17px;margin:0;letter-spacing:.3px}}
.sub{{color:var(--tx3);font-size:12.5px}}
.searchbox{{margin-left:auto;display:flex;align-items:center;gap:8px}}
input#q{{background:var(--panel2);border:1px solid var(--line2);color:var(--tx);border-radius:9px;
  padding:8px 12px;width:240px;font-size:13px;outline:none}}
input#q:focus{{border-color:var(--ac)}}
.hint{{font-size:12px;color:var(--tx3)}}
.tabs{{display:flex;gap:6px;margin-top:12px;overflow-x:auto}}
.tab{{background:transparent;border:none;border-bottom:2px solid transparent;color:var(--tx2);
  padding:9px 14px;font-size:13.5px;cursor:pointer;white-space:nowrap;font-family:inherit}}
.tab:hover{{color:var(--tx)}}
.tab.active{{color:var(--ac2);border-bottom-color:var(--ac);font-weight:600}}
.wrap{{display:grid;grid-template-columns:290px minmax(0,1fr);gap:0;max-width:1560px;margin:0 auto}}
aside{{position:sticky;top:112px;align-self:start;height:calc(100vh - 112px);overflow-y:auto;
  padding:22px 14px 60px 26px;border-right:1px solid var(--line)}}
.tocgroup{{display:flex;flex-direction:column;gap:1px}}
.toclink{{display:block;color:var(--tx2);text-decoration:none;font-size:13px;padding:5px 9px;
  border-radius:7px;line-height:1.45}}
.toclink:hover{{background:var(--panel2);color:var(--tx)}}
.toclink.lvl2{{padding-left:20px}}
.toclink.lvl3{{padding-left:32px;font-size:12.5px;color:var(--tx3)}}
main{{padding:26px 34px 120px;min-width:0}}
.docmeta{{font:12px var(--mono);color:var(--tx3);margin-bottom:18px;
  border:1px dashed var(--line2);border-radius:8px;padding:6px 10px;display:inline-block}}
article h1{{font-size:27px;margin:26px 0 16px;padding-bottom:12px;border-bottom:1px solid var(--line)}}
article h2{{font-size:21px;margin:38px 0 14px;padding:9px 0 9px 13px;border-left:3px solid var(--ac);
  background:linear-gradient(90deg,rgba(76,141,255,.09),transparent);border-radius:0 8px 8px 0}}
article h3{{font-size:17px;margin:28px 0 10px;color:var(--ac2)}}
article h4{{font-size:15px;margin:20px 0 8px;color:var(--tx2)}}
p{{margin:9px 0}}
a{{color:var(--ac2)}}
strong{{color:#fff;font-weight:650}}
em{{color:var(--yel);font-style:normal}}
code{{font:12.6px var(--mono);background:var(--panel2);border:1px solid var(--line);
  padding:1.5px 5px;border-radius:5px;color:#ffd479}}
.codeblock{{margin:14px 0;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:#0a0c11}}
.codetop{{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;
  background:var(--panel);border-bottom:1px solid var(--line);font:11.5px var(--mono);color:var(--tx3)}}
.copybtn{{background:var(--panel2);border:1px solid var(--line2);color:var(--tx2);font-size:11.5px;
  padding:3px 10px;border-radius:6px;cursor:pointer;font-family:inherit}}
.copybtn:hover{{color:var(--tx);border-color:var(--ac)}}
pre{{margin:0;padding:14px 16px;overflow-x:auto}}
pre code{{background:none;border:none;padding:0;color:#cfd8e6;font-size:12.6px;line-height:1.62}}
blockquote{{margin:14px 0;padding:13px 16px;background:linear-gradient(90deg,rgba(167,139,250,.10),rgba(167,139,250,.02));
  border-left:3px solid var(--pur);border-radius:0 10px 10px 0;color:#d9def0}}
blockquote p{{margin:4px 0}}
.tablewrap{{overflow-x:auto;margin:14px 0;border:1px solid var(--line);border-radius:11px}}
table{{border-collapse:collapse;width:100%;font-size:13.4px;min-width:520px}}
th{{background:var(--panel);text-align:left;padding:10px 12px;font-weight:640;color:var(--ac2);
  border-bottom:1px solid var(--line2);white-space:nowrap}}
td{{padding:9px 12px;border-bottom:1px solid var(--line);color:var(--tx2);vertical-align:top}}
tbody tr:last-child td{{border-bottom:none}}
tbody tr:hover td{{background:rgba(76,141,255,.05);color:var(--tx)}}
ul,ol{{margin:9px 0;padding-left:24px}}
li{{margin:5px 0;color:var(--tx2)}}
li strong{{color:var(--tx)}}
hr.sep{{border:none;border-top:1px solid var(--line);margin:26px 0}}
mark{{background:rgba(245,185,66,.34);color:#fff;border-radius:3px;padding:0 2px}}
.hidden{{display:none !important}}
footer{{border-top:1px solid var(--line);padding:18px 26px;color:var(--tx3);font-size:12.5px;text-align:center}}
@media(max-width:1080px){{.wrap{{grid-template-columns:1fr}}aside{{display:none}}main{{padding:20px 16px 90px}}}}
</style>
</head>
<body>
<header>
  <div class="hrow">
    <h1 class="brand">{esc(title)}</h1>
    <span class="sub">{esc(subtitle)}</span>
    <div class="searchbox">
      <span class="hint" id="hint">全文搜索</span>
      <input id="q" placeholder="输入关键词，如「脱敏」「MVP」" autocomplete="off">
    </div>
  </div>
  <div class="tabs">{tabs}</div>
</header>
<div class="wrap">
  <aside>{navs}</aside>
  <main id="main">{bodies}</main>
</div>
<footer>生成时间：{now}（北京时间） · 单文件离线可读 · 共 {len(docs)} 篇文档</footer>
<script>
const docs = {json.dumps([{"key": d["key"], "name": d["name"]} for d in docs], ensure_ascii=False)};

function copyCode(btn) {{
  const code = btn.closest('.codeblock').querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(() => {{
    btn.textContent = '已复制'; setTimeout(() => btn.textContent = '复制', 1400);
  }});
}}

function showDoc(key) {{
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.doc === key));
  document.querySelectorAll('article.doc').forEach(a => a.style.display = (a.dataset.doc === key ? '' : 'none'));
  document.querySelectorAll('.tocgroup').forEach(g => g.style.display = (g.dataset.doc === key ? '' : 'none'));
  resetHighlight();
}}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => showDoc(t.dataset.doc));

// 滚动高亮目录
const links = () => Array.from(document.querySelectorAll('.tocgroup:not([style*="none"]) .toclink'));
window.addEventListener('scroll', () => {{
  const actives = links();
  let cur = null;
  for (const a of actives) {{
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el && el.getBoundingClientRect().top < 180) cur = a;
  }}
  actives.forEach(a => a.style.color = '');
  if (cur) {{ cur.style.color = 'var(--ac2)'; }}
}});

// 全文搜索 + 高亮
let marks = [];
function resetHighlight() {{
  document.querySelectorAll('mark').forEach(m => {{
    const p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
  }});
  marks = [];
  document.getElementById('hint').textContent = '全文搜索';
  document.getElementById('hint').style.color = 'var(--tx3)';
}}
document.getElementById('q').addEventListener('input', e => {{
  const kw = e.target.value.trim();
  resetHighlight();
  if (kw.length < 2) return;
  const activeArt = document.querySelector('article.doc:not([style*="none"])') || document.body;
  let count = 0, first = null;
  const walker = document.createTreeWalker(activeArt, NodeFilter.SHOW_TEXT, {{
    acceptNode: n => (n.nodeValue.trim().length > 1 && !/^(SCRIPT|STYLE|MARK)$/.test(n.parentNode.nodeName))
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  }});
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {{
    const low = node.nodeValue.toLowerCase(), k = kw.toLowerCase();
    if (low.indexOf(k) === -1) return;
    const frag = document.createDocumentFragment();
    let rest = node.nodeValue;
    while (true) {{
      const idx = rest.toLowerCase().indexOf(k); if (idx === -1) break;
      frag.appendChild(document.createTextNode(rest.slice(0, idx)));
      const m = document.createElement('mark'); m.textContent = rest.slice(idx, idx + kw.length);
      frag.appendChild(m); marks.push(m); count++;
      rest = rest.slice(idx + kw.length);
    }}
    frag.appendChild(document.createTextNode(rest));
    node.parentNode.replaceChild(frag, node);
  }});
  const h = document.getElementById('hint');
  h.textContent = count ? `命中 ${{count}} 处` : '无匹配';
  h.style.color = count ? 'var(--grn)' : 'var(--red)';
  if (count) {{ first = marks[0]; first.scrollIntoView({{behavior:'smooth', block:'center'}}); }}
}});
document.addEventListener('keydown', e => {{
  if (e.key === '/' && document.activeElement.id !== 'q') {{ e.preventDefault(); document.getElementById('q').focus(); }}
  if (e.key === 'Escape') {{ document.getElementById('q').value = ''; resetHighlight(); }}
}});
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="产品方案")
    ap.add_argument("--subtitle", default="")
    a = ap.parse_args()
    htmlout = build(a.files, a.title, a.subtitle)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, "w", encoding="utf-8").write(htmlout)
    print(f"OK -> {a.out} ({len(htmlout):,} chars)")


if __name__ == "__main__":
    main()
