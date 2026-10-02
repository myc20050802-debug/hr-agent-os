# GitHub 开源前 · 改进清单

> 审计对象：`hr平台`（HR-Agent OS）本地仓库 · 审计时间 2026-09-30 15:57（北京时间）
> 方法：实际检查 83 个已跟踪文件、git 历史、依赖声明、路径硬编码、仓库体积、CI 可行性。
> **不是通用建议清单** —— 每条都带证据（文件:行号 / 实测数字）。
> **进度更新（2026-09-30 16:30）**：§1 的四个 P0 项**已全部落地**，完成情况见文末「附」。下面保留原始审计内容作为记录。

---

## 零、先给判断

**底子比多数开源项目干净。** 先说好的，因为这几件事你已经做对了、别退回去：

| 项 | 实测 | 说明 |
|---|---|---|
| 敏感文件未入库 | ✅ | 已跟踪文件里**没有** `.env` / `.session_secret` / `*.db` / `backups/`（我逐个查过 `git ls-files`） |
| 忽略清单质量 | ✅ 67 行，分 6 类带理由 | 不只写规则，每条注释都解释了「为什么忽略」 |
| 依赖极简 | ✅ `dependencies: {}` | 运行时零依赖（Node 原生 http + 内置 sqlite），只有 `jsdom` 一个 devDependency |
| Commit 历史 | ✅ 可读 | `feat(scoring):` / `fix(tools):` / `docs:` 前缀规范，每条讲一件事 |
| `.gitattributes` | ✅ 有想法 | 用 `linguist-generated=true` 标记生成物，让 GitHub 折叠 diff（但列表已过期，见 §3.2） |
| 仓库体积 | ✅ 8.1 MB | 已跟踪最大文件 516 KB（生成的原型 HTML），**不需要 Git LFS** |
| 工程化文档 | ✅ | `.env.example` 逐项写了「为什么」，`npm run preflight` 有只读自检，README 结构完整 |

**但有 4 个必须在上传前解决**（§1），否则别人 clone 下来跑不起来、或者法律上不能用。

---

## 一、P0 · 必须改（会直接坏事）

### 1.1 没有 LICENSE —— 而且是「默认最严」状态 · ✅ 已解决（选了 MIT）

**证据**：`package.json` → `"license": "UNLICENSED"`，仓库根目录**没有** `LICENSE` 文件。

**为什么这是 P0**：在 GitHub 上，**没有 license = 保留所有权利**（Berne 公约默认）。所以现在的实际效果是「公开给人看，但谁都不能合法使用/修改/分发」。这很可能不是你的本意。

**要先做一个决定**：

| 你的意图 | 该做什么 |
|---|---|
| 让别人能自由参考/使用 | 加 `LICENSE`（MIT 最省事；Apache-2.0 更正式，含专利授权） |
| 只想展示、不许使用 | **保留现状**，但在 README 顶部和 `LICENSE` 里用大白话写清楚「仅供阅读参考」 |
| 自己也要商用、不想别人抄 | 建议**先私有仓库**，等商用路径定了再开源 |

顺带：`"private": true` 只影响 `npm publish`，**不影响 GitHub 可见性**，可以留着。

---

### 1.2 有 10 套回归套件，但没有 CI · ✅ 已解决（`.github/workflows/test.yml`）

**证据**：
- `package.json` → `"test": "node tools/run_all.js"`，实际 **10 套件**（后端契约 / 招聘链路 / JD 口径 / 筛选评测 / 筛选运行 / 打开即在线 / 运维面 / 前端离线 / 导航 / 前端在线）
- README 写着「10 套件全绿」「一致率 90.0%」「误筛率 25.0%」这些数字
- 仓库里**没有 `.github/` 目录**（`ls .github` → 不存在）

**为什么这是 P0**：这些数字目前**全靠你口头保证**。访客无法自己验证。而把「我测过」变成「任何人都能验证」，只需要 15 行 YAML —— 这是整个清单里性价比最高的一个动作。

**可行性我已经验证过了**：`tools/run_all.js` 用的是普通 `spawn` / `spawnSync`（第 16 / 53 / 81 行），**没有任何平台特定调用**；Windows 专属代码只存在于 `tools/dev-up.js`（WMI 拉进程），而 CI 根本用不到它。所以 `ubuntu-latest` 上能跑。

需要 Node ≥ 22.5（`--experimental-sqlite`），`engines` 字段已经写对了。

**可直接用**（`.github/workflows/test.yml`）：

```yaml
name: test
on:
  push:
    branches: [main]
  pull_request:

jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci || npm install
      - name: 一键回归（11 套件 · 隔离实例 + 临时库）
        run: npm test
```

> 注：`run_all.js` 自带「隔离实例 127.0.0.1:8799 + 临时库」，**不会碰演示库**，天生适合 CI。

---

### 1.3 Python 抓取脚本：依赖没声明，缺依赖时抛裸回溯栈 · ✅ 已解决

**证据**：
- `tools/scrape_boss_jobs.py:40` → `from scrapling.fetchers import StealthyFetcher`（**模块顶层，无 try/except**）
- `tools/scrape_zhaopin_jobs.py:36` → 同上
- 仓库里**没有** `requirements.txt` / `pyproject.toml`（`ls` 均不存在）

**为什么是 P0**：这两个脚本是「岗位资料库」的**唯一数据入口**，`docs/13` 和前端「岗位资料库」页都在教用户怎么跑它们。别人 clone 后执行，拿到的是一个 `ModuleNotFoundError` 回溯栈，不知道要装什么、装哪个版本。

**改法**（两件小事）：
1. 新增 `tools/requirements-scrape.txt`，内容一行：`scrapling>=0.4.15`
2. 把 import 包起来，给一句人话：

```python
try:
    from scrapling.fetchers import StealthyFetcher
except ImportError:  # 依赖缺失时给可用信息，而不是回溯栈
    raise SystemExit(
        "缺少 scrapling。请先装依赖：\n"
        "  python -m pip install -r tools/requirements-scrape.txt\n"
        "注意：抓取脚本与后端（Node）无关，后端零依赖照常运行。"
    )
```

---

### 1.4 `C:\Users\<用户名>\...` 硬编码 12 处，横跨 8 个文件 · ✅ 已清零

**证据**（原审计时扫描本机绝对路径）：

| 文件 | 次数 | 位置性质 |
|---|---|---|
| `docs/02_搭建实操教程.md` | 3 | **第 58 / 62 / 63 行 —— 是「怎么跑起来」的操作步骤** |
| `HR-AI-Agent平台_产品方案.html` | 3 | 生成物（该篇无 md 源，直接改 HTML） |
| `JD生成口径修复说明.md` | 1 | 第 3 行文档抬头「平台：」路径 |
| `JD生成口径说明_v12_已填内容润色.md` | 1 | 第 3 行同上 |
| `面试前缺口审计_待补清单.md` | 1 | 第 4 行「审计对象：」路径 |
| 对应 3 个 `.html` | 3 | 生成物 |

**为什么是 P0**：两个后果 —— ① **泄露本机用户名**；② **复制粘贴必断**，`docs/02` 是唯一的「手把手搭建」文档，别人照着做 100% 失败。

**改法**：
- 代码路径一律改仓库相对路径（`平台原型/`、`tools/`、`server/`）
- Python 解释器改成 `python` / `python3`，并注明「任意 3.9+ 均可」
- 文档抬头的「平台：」路径删掉或改成 `<仓库根>`
- 改完**重跑 `tools/md2dark_html.py` 重新生成 HTML**（否则改了的 md 与 HTML 不一致）

**完成情况**：12 处已全部替换为仓库相对路径 / `python`；涉及 md 的 5 篇 HTML 已重新生成，`git grep -nE 'C:[\\/]Users|/Users/'` 现在无输出。

---

## 二、P1 · 强烈建议（性价比高）

### 2.1 根目录堆了 21 个散落文档，而且同类文档分了两处

**证据**：
- 根目录：15 个 `.html` + 6 个 `.md`（不含 README）= **21 个散落文件**
- `docs/`：`01_`~`13_` 编号文档 + 1 个未编号的
- **最刺眼的一处**：`JD生成口径修复说明.md` 在**根目录**，而它的后继版本 `docs/JD生成口径v13修复说明_岗位职责栏与语义分段.md` 在 **docs/**。同一个主题的前后两版，分居两处。

**建议**：
- 根目录**只留 `README.md`**
- 散落的 `.md` 收进 `docs/`；历史版本进 `docs/archive/`
- HTML 阅读版统一放 `docs/html/`（或按 §2.2 决定不入库）

> 理由：访客打开仓库第一屏看到的是 21 个文件，而不是「这是个什么项目、怎么跑」。

**✅ 落地（2026-10-02）**：已按上面的建议收敛 —— 16 个阅读版进 `docs/html/`、2 组历史口径说明进 `docs/archive/`、2 组 JD 样例进 `docs/样例/`，`面试前缺口审计_待补清单.md` 归入 `docs/`。根目录只剩 `README` / `LICENSE` / `CHANGELOG` / `CONTRIBUTING` / `SECURITY` + 代码目录。守卫的扫描面也从「根目录」扩到「全仓库入库的 HTML」，否则这个坑只会换个目录重新出现。

---

### 2.2 15 个「暗色 HTML 阅读版」要不要入库 —— 得做个明确决定

**证据**：约 **900 KB 生成物**已入库；`.gitattributes` 里有 `linguist-generated=true` 标记。

`linguist-generated` 这个做法**本身很聪明**（GitHub 会折叠 diff，避免把打包产物误读成手写代码）。**但列表已经过期** —— 这批不在里面：
- `岗位资料库与Boss抓取接入.html`（本轮新生成）
- `JD生成口径v13修复说明_岗位职责栏与语义分段.html`

**两条路二选一，别含糊**：

| 方案 | 要做的事 |
|---|---|
| **① 继续入库**（我倾向这个） | 把 `linguist-generated` 列表补全；README 写明「改了 md 必须重跑 `tools/md2dark_html.py` 重新生成」 |
| **② 不入库** | 加进 `.gitignore`，README 给生成命令，让别人自己生成 |

倾向 ① 的理由：HTML 是你对外演示的主要形态。但它需要**纪律** —— 现在就已经出现「md 更新了、HTML 还是旧的」的情况了。

**✅ 落地（2026-10-02）**：选方案 ①，并把纪律做成机制 ——
① `.gitattributes` 由**逐文件列举**改为**目录通配**（`docs/html/*.html` 等），新增文档时结构上不可能再漏登记；
② 新增 `tools/build_docs_html.py`，把「哪个 HTML ← 哪几篇 md + 什么标题」固化成 MANIFEST，重生 = 一条命令；`--check` 已在 CI 里断言「产物未登记 / 源文件缺失 / 改了名没改清单」都会红；
③ 20 个产物已全量重生成一遍，md 与 HTML 回到同步。

---

### 2.3 README 30 KB，长得有点过头

**结构本身很好**（一分钟跑起来 / 交付物 / M1 可信底座 / 打分可解释 / 两种运行模式 / 五分钟演示路径 / 技术选型 / 测试 / 质量与性能实测 / 这不是什么）。

**问题**：根目录已经有「产品方案」「从 0 到 1 复盘」「实现验收报告」等长文，README 里再塞长论证就是**重复**。

**建议压到「一屏看懂 + 一屏跑起来」**：保留 `一分钟跑起来`、`交付物`、`技术选型`、`测试`、`这不是什么`，长论证下沉 docs 并给链接。

**另外建议补三样**：
1. **一张界面截图或 30 秒 GIF** —— 现在纯文字，访客无法「一眼看到产品长什么样」，这是当前 README 最大的短板
2. **Badges** —— CI 状态（做完 §1.2 就有了）+ Node ≥ 22.5 + 零运行时依赖
3. **最前面一句显著声明**：这是 PoC，不是生产系统

---

### 2.4 没有 `.github/`

除了 CI，建议加：
- **`SECURITY.md`** —— 说清「这是 PoC / 演示口令 `Demo@2026` / 不要用于真实候选人 PII」，性价比最高
- `CONTRIBUTING.md`（可选）、PR/Issue 模板（可选）

对一个主打「可信底座、合规红线」的项目，`SECURITY.md` 的存在本身就在传递信号。

---

## 三、P2 · 打磨

### 3.1 演示口令 `Demo@2026` 明文出现在多处
对 PoC 完全合理，而且 `npm run preflight` 已经会检查它。但开源后建议在 README 顶部用醒目 blockquote 声明「**演示口令仅供本地，部署即改**」，避免有人 clone 完直接上线。

### 3.2 `.gitattributes` 的 `linguist-generated` 列表同步
见 §2.2 —— 补上新生成的 HTML，否则 GitHub 的语言统计和 diff 折叠不准。

### 3.3 文档命名统一
`docs/` 是 `01_`~`13_` 编号，但 `docs/JD生成口径v13修复说明_岗位职责栏与语义分段.md` 没编号。要么给编号，要么整体放弃编号 —— 现在是「两套规矩」。

### 3.4 `package.json` 元数据
- 缺 `repository`（有 `description`，写得不错）
- 建议补 `repository` / `homepage` / `bugs`
- GitHub 仓库建议设 `topics`：`hr-tech`、`ai-agent`、`poc`、`nodejs`、`zero-dependency`、`node-sqlite`

---

## 四、提交策略（重要）

**现在堆了两批未提交改动，建议拆成 2~3 个语义化提交，别一次性糊上去。**

| 批次 | 内容 |
|---|---|
| **① v13 岗位职责栏 + 语义分段** | `shared/req-lib.js`、`server/engine.js`、`server/migrations.js`、`tools/test_jd.js`、`平台原型/src/{app.js,agent.js,app.css}`、`平台原型/test_prototype.js`、`docs/JD生成口径v13修复说明…md` |
| **② 岗位资料库 v9 + 抓取链路** | `server/referenceJobs.js`(新)、`server/routes.js`、`tools/scrape_boss_jobs.py`(新)、`tools/scrape_zhaopin_jobs.py`(新)、`tools/import_boss_jobs.py`、`docs/13…md`、重打包的 `平台原型/index.html`、`岗位资料库与Boss抓取接入.html` |
| **③ （可选）开源前收尾** | 审计清单、LICENSE、CI workflow、requirements、路径清理 |

**理由**：你的 commit 历史质量很高（每条讲一件事），一次性巨型提交会破坏可读性 —— 而**历史本身就是这个仓库被参观的一部分**。

---

## 五、上传前自检清单

```bash
# 1. 敏感文件确认没被跟踪（当前是干净的，改完再确认一次）
git ls-files | grep -iE "\.env$|secret|\.db$|backups/"

# 2. 本机路径残留清零
git grep -nE 'C:[\\/]Users|/Users/'      # 期望：无输出

# 3. 一键回归 + 上线自检
npm install
npm test                          # 期望：11 套件全绿
npm run preflight                 # 期望：本地演示两项是 ⚠（预期），退出码 0

# 4. 确认 .gitignore 仍生效（工具产物不该进库）
git status --porcelain            # 期望：只有你要提交的文件，无 _*.json / _*.txt / *.log

# 5. 分支名与首次推送
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

---

## 附：优先级速览

| 优先级 | 事项 | 工作量 |
|---|---|---|
| **P0** | ✅ 加 LICENSE | 已完成 · MIT |
| **P0** | ✅ 加 CI workflow | 已完成 · `.github/workflows/test.yml` |
| **P0** | ✅ 抓取脚本依赖声明 + 友好报错 | 已完成 · `tools/requirements-scrape.txt` |
| **P0** | ✅ 清掉 12 处本机路径硬编码 + 重生成 HTML | 已完成 |
| **P1** | 根目录文档收敛到 `docs/` | 30 分钟 |
| **P1** | README 精简 + 补截图/badges | 1~2 小时（截图是主要成本） |
| **P1** | 加 `SECURITY.md` | 15 分钟 |
| **P2** | 命名统一 / 元数据 / topics | 15 分钟 |

**最小可行上线路径**：P0 四项做完（约 1 小时）就可以安心公开 —— 别人能跑起来、能验证、法律上不尴尬。其余都是打磨。

> **2026-09-30 更新**：P0 四项已全部完成，仓库现在可以公开。剩下的是 P1（文档收敛 / README 截图 / SECURITY.md）与 P2（命名与元数据）打磨。
