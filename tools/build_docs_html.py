#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文档阅读版（docs/html、docs/archive、docs/样例 下的暗色单文件 HTML）一键重生。

为什么需要这个脚本：
  这些 HTML 是 md 的生成物，而**生成参数（标题 / 副标题 / 合并了哪几篇 md）过去只存在于
  历史命令里** —— 没有单一源。结果是两件真发生过的事：
    ① 新增文档后忘了登记到 .gitattributes，产物被当成手写代码算进语言统计；
    ② md 改了、HTML 还是旧的（文档与产物静默不一致）。
  现在把「哪个产物 ← 哪几篇 md + 什么标题」固化成下面的 MANIFEST，
  重生 = 一条命令；--check 用来断言清单没漏、源文件都在（已接入 CI）。

用法：
    python tools/build_docs_html.py            # 重生全部
    python tools/build_docs_html.py --check    # 只校验清单与源文件（CI 用）
    python tools/build_docs_html.py --list     # 列出清单
    python tools/build_docs_html.py --only 产品方案   # 只重生路径含该子串的产物
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from md2dark_html import build  # noqa: E402  （同目录的渲染器，零外部依赖）

# ---------------------------------------------------------------------------
# MANIFEST —— 生成物的单一源。sources 里的文件名按「产物同目录 → docs/」顺序查找。
# 改标题 / 增删合并篇目，改这里，然后重跑本脚本。
# ---------------------------------------------------------------------------
MANIFEST = [
    {'out': 'docs/html/作品集_面试版.html', 'title': 'HR-Agent OS · 作品集（面试版）',
     'subtitle': '一个能真跑起来的 B 端 HR AI Agent 平台 · 24 页面 / 47 接口 / 一致率 96.7% / 漏筛 0%',
     'sources': ['21_作品集_面试版.md']},
    {'out': 'docs/html/GitHub开源前改进清单.html', 'title': 'GitHub 开源前 · 改进清单',
     'subtitle': 'HR-Agent OS · 基于实际仓库审计（88 个跟踪文件）',
     'sources': ['14_GitHub开源前改进清单.md']},
    {'out': 'docs/html/HR-AI-Agent平台_JD素材扩充清单.html', 'title': 'HR-Agent OS · JD 生成素材扩充清单',
     'subtitle': '20 职能族职责池 4→10 · 9 行业语境词表 · 纯填词，不接模型',
     'sources': ['06_JD素材扩充清单.md']},
    {'out': 'docs/html/HR-AI-Agent平台_产品方案.html', 'title': 'HR-AI-Agent 平台 · 产品方案（PRD + 搭建教程 + 运行说明）',
     'subtitle': 'docs/01 + docs/02 + docs/03 合并暗色阅读版',
     'sources': ['01_产品需求草稿PRD.md', '02_搭建实操教程.md', '03_本地全栈版运行说明.md']},
    {'out': 'docs/html/HR-AI-Agent平台_从0到1产品复盘.html', 'title': 'HR-Agent OS · 从 0 到 1 产品复盘',
     'subtitle': '我作为产品经理，这个产品是怎么做出来的',
     'sources': ['04_产品复盘_从0到1怎么做出来的.md']},
    {'out': 'docs/html/HR-AI-Agent平台_从PoC到企业级.html', 'title': 'HR-Agent OS · 从 PoC 到企业级',
     'subtitle': '差距清单 · 8 项按 P0/P1/P2 分级 · 含改法与验收口径',
     'sources': ['05_从PoC到企业级的差距清单.md']},
    {'out': 'docs/html/HR-AI-Agent平台_实现验收报告.html', 'title': 'HR-AI-Agent 平台 · 实现说明与验收报告',
     'subtitle': 'docs/09 · 含本轮追加：打分归因（每个分数都要有原因）',
     'sources': ['09_实现说明与验收报告.md']},
    {'out': 'docs/html/HR-AI-Agent平台_项目计划与架构.html', 'title': 'HR-Agent OS · 项目计划书与架构设计',
     'subtitle': '',
     'sources': ['07_项目计划书.md', '08_架构设计文档.md']},
    {'out': 'docs/html/JD生成口径v13修复说明_岗位职责栏与语义分段.html',
     'title': 'JD 生成口径 v13 · 岗位职责栏与语义分段修复', 'subtitle': '',
     'sources': ['JD生成口径v13修复说明_岗位职责栏与语义分段.md']},
    {'out': 'docs/html/JD粘贴解析口径v14修复说明.html', 'title': 'JD 粘贴解析口径 v14 修复说明', 'subtitle': '',
     'sources': ['17_JD粘贴解析口径_v14修复说明.md']},
    {'out': 'docs/html/打分口径v16_相关性门槛.html', 'title': '打分口径 v16 · 相关性门槛（技能零命中即出局）',
     'subtitle': 'HR-Agent OS · 5 个候选方案的实测对照 · 为什么改判定链条而不是改业务维度计数',
     'sources': ['18_打分口径v16_相关性门槛.md']},
    {'out': 'docs/html/从0到1全流程与风险台账.html', 'title': '平台从 0 到 1 · 全流程与风险台账',
     'subtitle': 'HR-Agent OS · 9 个阶段 / 39 条风险 / GitHub 作品化指南',
     'sources': ['19_从0到1全流程与风险台账.md']},
    {'out': 'docs/html/黄金集标注口径与扩样方案.html', 'title': '黄金集标注口径与扩样方案（SOP）',
     'subtitle': 'HR-Agent OS · rubric v1 · 7 个决策 / 冻结档位定义 / 60+ 例配额 / 反循环论证纪律',
     'sources': ['20_黄金集标注口径与扩样方案.md']},
    {'out': 'docs/html/上线部署手册_A档.html', 'title': 'HR-Agent OS · A 档上线手册', 'subtitle': '',
     'sources': ['12_上线部署手册_A档.md']},
    {'out': 'docs/html/产品经理视角项目评估.html', 'title': '产品经理视角 · 项目全面评估',
     'subtitle': 'HR-Agent OS · 实测 83 文件 / 47 接口 / 16,465 行 / 16 篇文档',
     'sources': ['15_产品经理视角项目评估.md']},
    {'out': 'docs/html/从PoC到可用软件的落地路径.html', 'title': '从 PoC 到可用软件的落地路径',
     'subtitle': 'HR-Agent OS · 三档可用性路径 / 部署 / 备份 / 真实数据入口',
     'sources': ['11_从PoC到可用软件的落地路径.md']},
    {'out': 'docs/html/岗位资料库与Boss抓取接入.html', 'title': '岗位资料库与市场岗位抓取接入',
     'subtitle': 'BOSS 直聘 + 智联招聘 · 免登录抓取链路',
     'sources': ['13_岗位资料库与Boss抓取接入.md']},
    {'out': 'docs/html/招聘Agent目录与模块组织结构.html', 'title': '招聘 Agent 目录与模块组织结构',
     'subtitle': 'HR-Agent OS · 智能体中心导航层 · 目录 / 模块 / Agent 三级模型',
     'sources': ['10_招聘Agent目录与模块组织结构.md']},
    {'out': 'docs/html/规则与LLM双模式对照评测.html', 'title': '规则 × LLM 双模式对照评测',
     'subtitle': 'HR-Agent OS · AI 到底在哪一步 · 30 例黄金集实跑',
     'sources': ['16_规则与LLM双模式对照评测.md']},
    {'out': 'docs/html/面试前缺口审计_待补清单.html', 'title': 'HR-Agent OS · 面试前缺口审计',
     'subtitle': '12 项缺口 · 按面试杀伤力排序 · 含修复进度（2026-09-29）',
     'sources': ['面试前缺口审计_待补清单.md']},
    {'out': 'docs/archive/JD生成口径修复说明.html', 'title': '岗位 JD 生成口径修复 · 前后对比与结果',
     'subtitle': '', 'sources': ['JD生成口径修复说明.md']},
    {'out': 'docs/archive/JD生成口径说明_v12_已填内容润色.html', 'title': 'JD 已填内容润色口径 v12',
     'subtitle': 'HR-Agent OS · 招聘 Agent · 规则打底 + LLM 增强',
     'sources': ['JD生成口径说明_v12_已填内容润色.md']},
    {'out': 'docs/样例/AI-Agent产品经理_校招JD_排版版.html', 'title': 'Agent 产品经理 · 27 届校招 JD',
     'subtitle': '', 'sources': ['AI-Agent产品经理_校招JD_排版版.md']},
    {'out': 'docs/样例/AI产品经理JD_模板结构.html', 'title': 'AI 产品经理 · 岗位 JD 模板结构',
     'subtitle': '', 'sources': ['AI产品经理JD_模板结构.md']},
]


def resolve(entry, name):
    """源 md 查找：先找产物同目录（archive / 样例），再找 docs/。"""
    outdir = os.path.join(ROOT, os.path.dirname(entry['out']))
    for cand in (os.path.join(outdir, name), os.path.join(ROOT, 'docs', name)):
        if os.path.exists(cand):
            return cand
    return None


def scan_html():
    """仓库里所有入库的生成物 HTML（排除 分享包 —— 它不入库）。"""
    found = []
    for base in ('docs', ''):
        root = os.path.join(ROOT, base) if base else ROOT
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', '分享包', 'src')]
            if os.path.basename(dirpath) in ('平台原型',):
                continue
            for f in filenames:
                if not f.endswith('.html'):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT).replace(os.sep, '/')
                if rel.startswith('分享包/') or rel == '平台原型/index.html':
                    continue
                found.append(rel)
    return sorted(set(found))


def do_check():
    bad = 0
    covered = set()
    for e in MANIFEST:
        covered.add(e['out'])
        miss = [s for s in e['sources'] if not resolve(e, s)]
        if miss:
            print('  ✗ %s：找不到源 %s' % (e['out'], '、'.join(miss)))
            bad += 1
    on_disk = set(scan_html())
    unlisted = sorted(on_disk - covered)
    ghost = sorted(covered - on_disk)
    for f in unlisted:
        print('  ✗ %s：在磁盘上，但 MANIFEST 里没有登记' % f)
        bad += 1
    for f in ghost:
        print('  ✗ %s：MANIFEST 里有，但磁盘上没有（改过文件名？）' % f)
        bad += 1
    if bad:
        print('\n❌ 生成物清单与磁盘不一致（%d 处）—— 改 MANIFEST，别绕过它' % bad)
        return 1
    print('✅ 生成物清单自洽：%d 个产物，源文件齐全，无未登记项' % len(MANIFEST))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只校验 MANIFEST 与磁盘是否自洽')
    ap.add_argument('--list', action='store_true', help='列出清单')
    ap.add_argument('--only', default='', help='只重生路径含该子串的产物')
    a = ap.parse_args()

    if a.check:
        return do_check()
    if a.list:
        for e in MANIFEST:
            print('%s  ←  %s' % (e['out'], ' + '.join(e['sources'])))
        return 0

    todo = [e for e in MANIFEST if a.only in e['out']] if a.only else MANIFEST
    if not todo:
        print('没有匹配 --only %r 的产物' % a.only)
        return 1
    for e in todo:
        paths = [resolve(e, s) for s in e['sources']]
        if any(p is None for p in paths):
            print('  ✗ %s：源文件缺失，跳过' % e['out'])
            continue
        html = build(paths, e['title'], e['subtitle'])
        out = os.path.join(ROOT, e['out'])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8', newline='') as f:
            f.write(html)
        print('  ✓ %-58s %8d bytes  ← %s' % (e['out'], len(html.encode('utf-8')), ' + '.join(e['sources'])))
    print('\n完成：%d 个产物' % len(todo))
    print('提示：改过生成逻辑或标题后请重跑 npm run check:docs（页面数 / 字节数锚点）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
