# 岗位资料库与市场岗位抓取接入（BOSS + 智联 · 免登录）

> 本文记录「外部市场在招岗位 → 平台资料库 → JD 生成参考」这条链路的设计与操作。
>
> **当前状态（2026-09-30 更新）**：资料库 `reference_jobs` 已入库 **183 条**真实在招岗位
> （BOSS 直聘 147 条 + 智联招聘 36 条），其中 **69 条带完整 JD 正文、36 条带真实薪资**；
> 抓取已改为 **scrapling 连接器免登录**方案，**不再需要人工扫码登录**。
> JD 生成侧已接入读取，命中结果注入引言做「市场接地」。

---

## 一、它是什么，不是什么

| | 说明 |
|---|---|
| **是什么** | 外部市场（BOSS 直聘 / 智联招聘）公开在招岗位的**只读参考库**，供 JD 生成做「市场接地」 |
| **不是什么** | ❌ 不是本公司在招岗位（那是 `jobs` 表）<br>❌ 不参与简历打分，**不进关键词通道**<br>❌ 不参与招聘流程（面试/Offer/入职） |

**为什么坚决不让它进打分通道**：拿外部公司的岗位要求去筛本公司候选人，等于用别人的尺子量自己的人。资料库唯一的用途是「生成 JD 之前先看看真实市场怎么写」。

> ⚠️ 这是资料库接入时就被写死的红线，`buildJD()` 纯函数不接收资料库参数，只有 `runJD()` 层读它。

---

## 二、数据落在哪

**表 `reference_jobs`**（迁移 **v9**，见 `server/migrations.js`）：

| 字段 | 含义 | 当前填充（183 条） |
|---|---|---|
| `job_title` | 岗位名称 | 183/183 |
| `company_name` / `company_industry` / `company_scale` | 公司名 / 行业 / 规模 | 183/183 |
| `location` | 工作地点（城市·区域） | 183/183 |
| `salary_range` | 薪资区间 | **36/183**（智联批次全带；BOSS 免登录列表页拿不到薪资） |
| `job_description` | 完整 JD 正文 | **69/183**（BOSS 40 + 智联 29） |
| `skill_labels` | 技能标签 | 少量 |
| `source_url` | 来源链接 | 183/183 |
| `scraped_at` | 抓取时间 | 183/183 |

幂等键 = `sha1(租户 + 岗位名 + 公司 + 地点 + 来源URL)`，`INSERT OR REPLACE` —— **重复导入同一份产物不会翻倍**；同一岗位再次抓到会按同键**覆盖更新**（拿到更新薪资/JD 时是期望行为）。

> 与既有 `kb_documents`/`kb_chunks` 的区别：那两张表是**员工手册/制度文档**库（给员工自助 Agent 回答制度问题用），不是岗位库。两者互不干扰。

**当前分布（按行业）**：法律 80 / 互联网 23 / 咨询 20 / 未融资 14 / 不需要融资 14 / 计算机软件 8……

---

## 三、怎么抓（免登录 · scrapling 连接器）

### 3.0 为什么不用原来那套「专用 Chrome + 扫码登录」

原 `boss-company` skill 走 CDP 抓登录态，**必须人工扫码、默认等 600 秒**，无法无人值守。2026-09-30 改用
WorkBuddy 本机已装的 **scrapling MCP 连接器**（`~/.workbuddy/mcp-servers/scrapling/venv/`，v0.4.15）：

- **BOSS 免登录可行**：岗位详情页（`/job_detail/<id>.html`）是**公开 SEO 页**，未登录可直接渲染，
  页面里的「相似职位 / 推荐职位」链接可做 **BFS 扩展**，从一个种子岗位滚到几十个同类岗位。
- **智联免登录更彻底**：列表页**公开带薪资**，详情页公开带完整 JD。
- 两个抓取脚本都在 `tools/` 下，用 scrapling venv 的 python 直接跑，**不依赖 Node**。

### 3.1 BOSS 直聘：`tools/scrape_boss_jobs.py`

策略：给若干**种子岗位详情页**，抓完正文后顺着「相似/推荐职位」链接 BFS 扩展。

```bash
# 用「装了 scrapling 的那个 Python」即可（venv / conda / 系统 Python 都行）
# Windows venv 是 Scripts/python.exe，Linux / macOS 是 bin/python
P="python"

# 从种子页出发，最多 40 个岗位，默认会顺链接扩展
"$P" tools/scrape_boss_jobs.py \
  --seed "https://www.zhipin.com/job_detail/xxxx.html" \
  --seed "https://www.zhipin.com/job_detail/yyyy.html" \
  --max-jobs 40 --out tools/_boss_out.json
```

| 参数 | 说明 |
|---|---|
| `--seed`（可重复） | 种子岗位详情页 URL，至少一个 |
| `--max-jobs` | 硬上限（含扩展出来的） |
| `--no-expand` | 关闭 BFS，只抓种子 |
| `--delay` | 每次请求间隔秒数（默认自带节流） |
| `--out` | 产物 JSON 路径 |

**抽字段**：`.job-banner`（标题/城市/经验/学历/公司）、`.job-sec-text`（JD 正文）、`.sider-company`（行业/规模/地址）。

**两个必须做的清洗**（踩过的坑）：

1. **隐藏噪声 span**：BOSS 在正文里注入随机类名的 `<span>`（里面塞 `boss` 之类的字），
   靠页面 `<style>` 里的 `visibility:hidden` / `font-size:0` / `display:none` 规则隐藏。
   不处理就会读出「职位描**boss**述」这种断句垃圾。
   → 用 `HIDDEN_DEF_RE` 从 `<style>` 里抠出隐藏类名，再全部剔除。
2. **lxml 删元素会吞掉 tail 文本**：`getparent().remove(span)` 会把 `<span>boss</span>述：` 里的「述：」一起删掉。
   → 封装 `drop_keep_tail(el)`：先把 `el.tail` 前插到前一个兄弟节点（或父节点）文本尾部，再删元素。

### 3.2 智联招聘：`tools/scrape_zhaopin_jobs.py`

策略：按**关键词 + 城市**搜列表页 → 逐条进详情页取完整 JD。

```bash
"$P" tools/scrape_zhaopin_jobs.py --kw 律师   --jl 530 --pages 2 --max-jobs 18 --out tools/_zp_law.json
"$P" tools/scrape_zhaopin_jobs.py --kw 产品经理 --jl 530 --pages 2 --max-jobs 18 --out tools/_zp_pm.json
```

| 参数 | 说明 |
|---|---|
| `--kw` | 搜索关键词（岗位名） |
| `--jl` | 城市码（**530 = 北京**） |
| `--pages` | 抓列表前几页 |
| `--max-jobs` | 上限 |
| `--list-only` | 只抓列表（不要 JD，快很多） |
| `--probe` | 探针模式：只验证选择器是否命中，不落盘 |
| `--out` | 产物 JSON 路径 |

**抽字段**：列表卡 `.joblist-box__iteminfo` → `.jobinfo__name` / `.jobinfo__salary` / `.jobinfo__other-info-item` /
`.companyinfo__name` / `.companyinfo__tag .joblist-box__item-tag`（规模、行业）；详情页 JD 取
`.describtion__detail-content` / `.job-description`。

### 3.3 导入资料库

两个脚本的产物结构不同（BOSS 是扁平 `jobs[]`；智联是按公司分组的 `companies[].jobs[]`），
**导入器都能吃**：

```bash
# 导入器只依赖标准库 sqlite3，任意 Python 3.9+ 均可
PY="python"
"$PY" tools/import_boss_jobs.py --file tools/_boss_out.json
"$PY" tools/import_boss_jobs.py --file tools/_zp_law.json
"$PY" tools/import_boss_jobs.py --file tools/_zp_pm.json
```

- 脚本**自带 `CREATE TABLE IF NOT EXISTS`**，表不存在也能跑（不依赖迁移是否已应用）。
- 后端服务在运行中导入也正常（SQLite WAL 支持一写多读），**无需停服**。
- `--dir <目录>` 批量导、`--dry-run` 只解析不落库、`--db` 指定库。

---

## 四、JD 生成如何读取它

链路：`engine.runJD()` → `ReferenceJobs.loadReference(db, {title, industry})` → `marketNote(refs)` → 拼进 JD 引言。

**接地文案示例**（实测「专职律师」岗，读到 12 个同类岗位）：

> 已参考市场在招同类岗位 12 个，真实岗位名如「执业律师」「诉讼律师」「法务专员」，主要集中在北京；岗位要求与薪资口径已对齐真实在招市场。

同时 `runJD` 返回体新增 `reference` 块（命中条数 + `withJd` / `withSalary` 计数 + Top 岗位名 + 薪资/地点），前端「Agent 依据」可展示。

### 4.1 匹配口径（2026-09-30 修正）

**旧口径的 bug**：只按「行业」打分，导致「Java 后端工程师」匹配到一堆互联网行业的「漫剧师」「主播」——
**行业相同不等于岗位同类**。

**新口径（`server/referenceJobs.js`）**：

1. **标题必须命中**才算候选，三种命中方式之一：
   - 完全相同
   - 互相包含（如「产品经理」⊂「高级产品经理」）
   - **2-gram 重叠**（`titleGrams()`：把标题切成二元组，剔除 `工程师/经理/专员/设计/运营…` 这类通用后缀词，避免「XX工程师」之间互相误配）
2. **行业只做加分**，不再作为独立入选条件。
3. **城市走 `cityOf()` 归一**（`referenceJobs.js`）：库里两个来源存的地址粒度不同 ——
   智联是「北京·朝阳·建外」（有分隔符），BOSS 是「上海长宁区尚嘉中心」（无分隔符的完整地址）。
   直接取第一段会把 BOSS 那条长地址原样拼进引言。
   `cityOf()` 先用城市名单前缀匹配，再退化到「…市」截取，**认不出一律返回空串**（宁缺勿糙：
   宁可少一句「主要集中在」，也不写错地名）。实测 `上海长宁区尚嘉中心 → 上海`、
   `北京·丰台·看丹 → 北京`、`中国香港中环 → 中国香港`。
   `/api/reference-jobs/stats` 的 `byCity` 也走同一函数聚合，否则「北京」与「北京·朝阳·建外」
   会各占一个桶，KPI 看起来像数据脏了（归一后：北京 145 / 上海 38）。
   有薪资时追加薪资口径说明。

修正后实测：产品经理命中 12 个**真同类**且城市名干净；Java 后端只命中 1 个相关；专职律师命中「专职/独立/提成/合伙人律师」——不再出现跨职能误配。

### 4.2 四条设计约束（写进代码注释了）

1. **静默降级**：表不存在 / 查询异常 → 返回空数组，生成照常出 JD。增强项绝不能拖垮主流程。
2. **不破坏确定性**：`buildJD()` 保持纯函数（测试直连），资料库只在 `runJD` 层参与。资料库为空时行为与改动前**逐字节一致**。
3. **匹配在内存做**：全量拉取后在内存打分排序，**不用 SQL `LIKE`** —— 避免中文分词问题。表只有几百~几千行，足够。
4. **接入点单一**：只有 `runJD` 一处读取，便于日后换成向量检索。

---

## 五、看数据

- **页面**：左侧导航「人才与员工 → 岗位资料库」🗂️（权限 `job:read`）。含 4 个 KPI、逐岗位表格、按岗位名/公司/地点即时筛选的空态与满态两套渲染。
- **接口**：`GET /api/reference-jobs?limit=&q=` 列表检索、`GET /api/reference-jobs/stats` 统计（按城市/行业/公司）。
- **快照**：`/api/bootstrap` 下发 `refJobs`（最近 200 条）+ `refStats`，按 `job:read` 门控。

> ⚠️ **往快照加字段要改对地方**：bootstrap 实际下发的是 `routes.js` 的 `scopeSnapshot()`，**不是** `engine.bootstrap()` 的直接返回。只改 engine 不会到前端。

⚠️ 离线单文件原型（`平台原型/index.html`）**不含**资料库数据——它存在服务端 SQLite 里。连上本地后端后页面才有内容。

---

## 六、已知限制（不粉饰）

1. **BOSS 免登录拿不到薪资**：列表/详情页对未登录用户不展示薪资，`salary_range` 为空（页面显示「未抓取」而不是留白或编造）。要薪资就得走登录态或换智联这类公开薪资的源。
2. **JD 覆盖率不均衡**：法律岗（智联 18 条）与产品经理岗（智联 18 条）JD 基本全带；BOSS 那 147 条是**旧版产物**，只有岗位名/公司/行业/地点，**没有 JD**——本次新增的 40 条 BOSS 带 JD，但旧 107 条仍缺，需要时用 `scrape_boss_jobs.py` 按岗位名重新抓。
3. **详情页偶发超时**：智联个别 `jobdetail` 页 60s 超时（律师批次 18 条里 1 条 JD 为空），可重跑补齐。
4. **无增量去重时间窗**：幂等键不含时间，同一岗位多次抓取按「同键覆盖」更新（期望行为）。但若岗位换 URL 会算作新行。
5. **合规**：只抓页面**公开展示**的招聘信息，不抓个人简历/联系方式；抓取频率受脚本自身节流约束。商业化使用前请自行确认目标站点 ToS 与当地法规。

---

## 七、验证记录（2026-09-30 更新）

| 项 | 结果 |
|---|---|
| 迁移 v7→v9 | 副本库实测通过；本机演示库已升 v9 |
| 导入 9 份历史产物 | 解析 127 条 → 去重入库 **107 条** |
| BOSS 免登录抓取（scrapling） | **40 条**，JD 100% 捕获，**0 条 CSS/boss 噪声污染** |
| 智联免登录抓取 · 律师 | 18 条，薪资 18/18，JD 17/18 |
| 智联免登录抓取 · 产品经理 | 18 条，薪资 18/18，JD 18/18 |
| **资料库合计** | **183 条**（BOSS 147 + 智联 36）｜带 JD 69｜带薪资 36 |
| 地点字段无「城市重复前缀」 | 校验 0 条异常 |
| 城市归一 `cityOf()` | 单测 11 例通过；stats `byCity` 由散列桶收敛为 **北京 145 / 上海 38** |
| 匹配口径修正（标题优先） | 跨职能误配清零；产品经理 12 命中全同类 |
| `runJD` 读取并接地 | 引言注入市场口径，返回体含 `reference` 块 |
| `/api/reference-jobs`、`/stats`、bootstrap 下发 | 全部通过 |
| 全量回归 `run_all` | **11 套件全绿** |

改动文件：`server/migrations.js`（v9）、`server/referenceJobs.js`（新）、`server/engine.js`、`server/routes.js`、
`tools/import_boss_jobs.py`、`tools/scrape_boss_jobs.py`（新）、`tools/scrape_zhaopin_jobs.py`（新）、
`平台原型/src/app.js`（导航+页面）、`平台原型/test_prototype.js`（页面注册）。
