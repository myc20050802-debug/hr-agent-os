# 章节规划 · HR-Agent OS 面试作品集

## 视觉系统（v2 · Editorial Dark）

> 2026-10 改版：内页由「圆角卡片堆叠」改为杂志编辑部式排版，目标是**耳目一新**而非更花哨。

- **底色**：`#060910` 近黑；方格纸底纹 5% 透明 + 径向暗角。
- **冷色承担结构**：主色 `#38BDF8`（蓝）、辅色 `#22D3EE`（青）——发丝分隔线、角标、页脚。
- **暖色只给情绪与红线**：`#FBBF24`（琥珀，红线/警告）、`#FF6B4A`（余烬，仅封面与过渡页的情绪符号）。
- **四件套母题**（全篇统一）：左侧竖脊（页码 + 章节英文名）· 发丝线（代替卡片边框）· 角标面板（只有两个 L 形直角）· 页脚 folio（`NN / 19`）。
- **版式原型**：
  - **索引页**（2 / 5 / 8 / 13 / 15）——发丝线分隔的信息行，编号用等宽字体。
  - **数据页**（3 / 11 / 12）——超大数字（`.ed-num`，62px）作为构图主体。
  - **对照页**（7 / 14）——左右分屏，中间一条渐隐竖线。
  - **叙事页**（10 / 16 / 17 / 18 / 19）——时间轴或引语式排版。
  - **情绪页**（1）与**过渡页**（4 / 6 / 9）——暖色光晕 + 幽灵巨字。
- **字号阶梯**：页标题 42px · 行标题 19–21px · 正文 13–14px · 小标签 10–11px 全大写等宽。

## Page 1: 封面
- **Page Type**: Cover
- **Page Title**: HR-Agent OS
- **Page Subtitle**: 招聘全链路 AI Agent 平台 · 让每个分数都答得上「为什么」
- **Selected Template**: cover/tech/046.tpl（骨架）→ 实际版式：情绪化叙事封面
- **Content Structure**:
  - **左侧 · 「HR 的一天」日志**：6 条带时间戳的等宽记录，最后一条用余烬色高亮（情绪落点）
  - **右侧 · 三段式叙事**：共情（一天里，80% 的活，不需要判断。）→ 事实（翻 80 份简历 3–4 小时 · 被问社保 20 次 · 拼周报 4 小时）→ 解法（HR-Agent OS）
  - **背景**：左下暖色光晕（人的疲惫）+ 右上冷色光晕（技术的冷静）+ 幽灵巨字 `80%`
  - **底部规格条**：0 依赖 · 分数 100% 可复现 · 漏筛 0% · 24 页面 / 47 接口
- **Content Density**: Light
- **Narrative Role**: 先让面试官「感到」问题，再给出解法——第一印象不是「又一个 HR 原型」，而是「这个人知道 HR 真正在痛什么」
- **Image Requirements**: 无（纯排版 + 光晕，不用任何配图）
- **Page Weight**: Core page
- **Notes**: 封面是情绪入口，不是结论页；硬指标退到底部规格条，不再挤压标题


## Page 2: 目录
- **Page Type**: TOC
- **Page Title**: 目录
- **Selected Template**: toc/tech/3579.tpl
- **Content Structure**:
  - 四个章节 + 收束：
    - 01 我在解决什么问题（真实痛点）
    - 02 产品设计：三个必须与三个不做
    - 03 怎么证明它有效：一套自己搭的评测
    - 04 工程与过程：让文档不许撒谎
    - 05 自审与边界：我知道它哪儿还不行
  - 每章下附 1 行小字说明该章回答的面试问题
- **Content Density**: Light
- **Narrative Role**: 给出全局路线图，让面试官建立预期
- **Image Requirements**: 无
- **Page Weight**: Secondary page

## Page 3: 30 秒速览
- **Page Type**: Content
- **Page Title**: 30 秒速览
- **Page Subtitle**: 如果只有半分钟，看这一页
- **Selected Template**: content/tech/1581.tpl
- **Content Structure**:
  - **核心信息卡（8 项）**：
    - 项目：HR-Agent OS · 招聘全链路 AI Agent 平台（PoC → 可演示档）
    - 我担任：产品定义 + 口径设计 + 工程落地 + 自建评测（独立完成）
    - 规模：24 个页面 · 47 个后端接口 · schema v9 · 12 个回归套件 · 约 19,400 行 JS
    - 筛选质量：档位一致率 **96.7%**（29/30）· ±1 档 **100%** · **漏筛 0%** · 误筛 8.3%
    - 运行时依赖：**0**（Node 22 原生 http + 内置 node:sqlite，dependencies 为空）
    - 在线 demo：GitHub Pages（零安装，点开即玩）
    - 源码 + 文档：github.com/myc20050802-debug/hr-agent-os
    - 目标用户：中大型企业 HR 部门 / 招聘团队（私有化、数据不出境）
  - **一句话差异**：原型是「点得动」，这个项目是「答得上」——答得上分数怎么来的、越权为什么被拒、JD 为什么这么写
- **Content Density**: Medium
- **Narrative Role**: 把全部关键事实压缩到一屏，供面试官快速建立判断
- **Image Requirements**: 无（数据卡片布局）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 面试场景下信息密度＝尊重对方时间；把「规模 / 质量 / 依赖 / 入口」四类事实一次给全

## Page 4: 过渡页 01
- **Page Type**: Transition
- **Page Title**: 01 我在解决什么问题
- **Selected Template**: transition/tech/517.tpl
- **Content Structure**:
  - 章节号 01
  - 章节名：我在解决什么问题
  - 副题：HR 场景里，AI 落地真正难的不是「接一个大模型」
- **Content Density**: Light
- **Narrative Role**: 从「是什么」转入「为什么」，建立问题的严肃性
- **Image Requirements**: 无
- **Page Weight**: Transition page

## Page 5: 三条真实痛点
- **Page Type**: Content
- **Page Title**: 三条真实痛点
- **Page Subtitle**: 每一处设计都对应其中一条
- **Selected Template**: content/tech/1582.tpl
- **Content Structure**:
  - **痛点 1 · AI 给的结论业务方不敢签字**：分数是黑盒，出了问题无法追溯。
    解法 → 分数与档位 100% 由确定性规则算出（可复现）；分数下常驻一栏「为什么是这个分」，含逐维算式 + 决定性因素 + 还差几分进下一档。
  - **痛点 2 · HR 系统天生处理敏感数据**：权限写在页面上、数据早出了库，等于没权限。
    解法 → 权限**在出数据之前生效**：24 能力 × 7 角色 + 行级范围（all/dept/self）+ PII 物理脱敏；越权是**真 403**。
  - **痛点 3 · JD 里一句「35 岁以下」就是法律风险**：写的人不觉得有问题，HR 也未必逐句审。
    解法 → 生成前检索市场在招同类岗位「接地」，生成后合规扫描，命中歧视性表述**直接阻止发布**，每条给法条依据 + 建议改法。
  - 底部一行：目标用户与 Non-goals（不做通用大模型 / 不做简历库买卖 / 不做 C 端求职产品）
- **Content Density**: Heavy（3 组「痛点 + 解法」，每组 3 行）
- **Narrative Role**: 用三组对照说明「问题是真的、解法是具体的」，为后续能力铺垫
- **Image Requirements**: 无（三列卡片 + 箭头指向解法）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 这是全篇的立论页——把「HR + AI」这个听起来很泛的领域，收敛到三条具体、可验证的痛点

## Page 6: 过渡页 02
- **Page Type**: Transition
- **Page Title**: 02 产品设计
- **Selected Template**: transition/tech/517.tpl
- **Content Structure**:
  - 章节号 02
  - 章节名：产品设计
  - 副题：三个「必须」与三个「不做」
- **Content Density**: Light
- **Narrative Role**: 提示进入方案层
- **Image Requirements**: 无
- **Page Weight**: Transition page

## Page 7: 三个必须 × 三个不做
- **Page Type**: Content
- **Page Title**: 三个必须 × 三个不做
- **Page Subtitle**: 先定不可妥协的边界，再谈功能
- **Selected Template**: content/tech/1581.tpl
- **Content Structure**:
  - **左栏 · 三个「必须」**（必须可解释 / 必须可复现 / 必须留痕）：
    - 必须可解释：每个分数都能摊开算给业务方看；归因只读打分时已算出的系数、不做二次计算，测试锁死「分项之和 == 总分」。
    - 必须可复现：同一份简历跑两次结果必须一致，否则不能拿去和业务方对齐。
    - 必须留痕：应用层只插不改，外加数据库触发器 RAISE(ABORT)——想改审计得先改 schema，而 schema 是版本化迁移管的。
  - **右栏 · 三个「不做」**（不把判断权交给模型 / 不编硬数字 / 不让 AI 越过人工闸门）：
    - 不把判断权交给模型：分数与档位全由确定性规则算出；模型只做措辞、语言组织、JD 润色。
    - 不编硬数字：页面上的成本/用量必须能指出来源；规则模式就是 0 调用、显示 0，不显示「看起来合理」的试算值冒充真实用量。
    - 不让 AI 越过人工闸门：高风险动作（Offer 决策、推翻 AI 结论）必须留人工签批。
- **Content Density**: Heavy（6 条原则并列）
- **Narrative Role**: 展示「先定边界再谈功能」的产品思维，这是 AI PM 岗位最看重的判断力
- **Image Requirements**: 无（左右两栏对照布局）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 用「必须 / 不做」的镜像结构，把抽象的价值观变成可检验的工程约束

## Page 8: 五个核心能力
- **Page Type**: Content
- **Page Title**: 五个核心能力
- **Page Subtitle**: 每条都写明「为什么它是真的」
- **Selected Template**: content/tech/1590.tpl
- **Content Structure**:
  - **能力 1 · 分数可解释**：分数下有「为什么是这个分」栏——逐维算式（技能匹配 40 × 0.95 = 38）+ 决定性因素 + 还差几分进下一档；测试锁死「分项之和 == 总分」「满分 × 系数 == 该维得分」。
  - **能力 2 · 规则与模型分工明确**：分档 100% 规则（可复现、可签字）；模型只做措辞与语言组织。「不配大模型也能跑通全流程」是设计选择，不是降级方案。
  - **能力 3 · 权限真的在服务端**：24 能力 × 7 角色 + 行级范围 + PII 脱敏，全部在出数据之前生效；员工身份导出全公司花名册是**真 403**，前端按钮显隐只是体验层。
  - **能力 4 · 审计改不掉**：应用层只插不改 + 数据库触发器 RAISE(ABORT)，审计日志无法被应用层篡改。
  - **能力 5 · JD 接地真实市场 + 合规红线**：按「标题优先」检索市场在招同类岗位（自带 183 条抓取快照），拼接前做最长公共子串 + bigram 双去重；命中「35 岁以下」「仅限本地户口」**直接阻止发布**，每条给法条依据与建议改法。
- **Content Density**: Heavy（5 张能力卡）
- **Narrative Role**: 从原则落到具体能力，用「为什么它是真的」对抗「话术感」
- **Image Requirements**: 无（五张卡片网格）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 每张卡都带「可被验证的证据」（测试锁死 / 真 403 / 183 条快照），避免空谈能力

## Page 9: 过渡页 03
- **Page Type**: Transition
- **Page Title**: 03 怎么证明它有效
- **Selected Template**: transition/tech/517.tpl
- **Content Structure**:
  - 章节号 03
  - 章节名：怎么证明它有效
  - 副题：AI 岗面试第一个技术问题，通常是「你怎么衡量效果」
- **Content Density**: Light
- **Narrative Role**: 转入评测章节，这是全篇最能体现 AI PM 专业度的一段
- **Image Requirements**: 无
- **Page Weight**: Transition page

## Page 10: 黄金集与标注口径
- **Page Type**: Content
- **Page Title**: 黄金集与标注口径
- **Page Subtitle**: 标准答案该怎么造，才能让人信
- **Selected Template**: content/tech/1584.tpl
- **Content Structure**:
  - **规模**：30 例（3 个岗位 × 各 10 例），人工标注、三档标签 strong / ok / no。
  - **判定顺序**：先过硬性门槛（年限 / 学历 / 技能相关性），再定档位——顺序反了会把「技能很全但年限不够」标成优秀。
  - **证据来源**：标注时只看简历原文 + 岗位要求，禁止偷看算法输出（看一眼 = 把规则抄成答案 = 循环论证）。
  - **口径冻结**：rubricVersion = 1，写进代码可机器校验——枚举合法 / id 唯一 / jobId 无悬空引用 / 每岗位 ≥10 例 / 每岗 ≥1 陷阱探针 / 三档占比 ∈[20%,50%]。
  - **扩样方案**：独立成文（7 个必须先拍死的决策、三层难度配额、一致性验证），**不拿规则输出当答案**。
  - 底部核心一句：**独立性 / 稳定性 / 够难——三个属性缺一个，评测数字就变成「自证」。**
- **Content Density**: Medium
- **Narrative Role**: 证明评测不是随便标几个数，而是有方法学的
- **Image Requirements**: 无（要点列表 + 底部强调条）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 面试官会追问「黄金集怎么来的」，这一页就是提前把答案摆出来

## Page 11: 三个指标与一条红线
- **Page Type**: Content
- **Page Title**: 三个指标与一条红线
- **Page Subtitle**: 说得出指标背后的业务取舍，比报一个漂亮数字更有说服力
- **Selected Template**: content/tech/1586.tpl
- **Content Structure**:
  - **指标 1 · 档位一致率 96.7%（29/30）**：严格三档一致。
  - **指标 2 · ±1 档一致率 100%**：从没出现「差两档」的离谱判断。
  - **指标 3 · 漏筛率 0.0%** ← **红线**：HR 场景里「把好简历判死」的代价远高于「把差简历放进面试」，所以这个数必须守 0。
  - **对照项 · 误筛率 8.3%**：12 个应拒样本里放了 1 个进来（宁可多聊一轮，不可错杀）。
  - **统计诚实**：样本只有 30 例，所以不只报点估计——同时给出 Wilson 95% 置信区间 [83.3%, 99.4%]。
  - **门槛拦截 9 例**：年限 ×2 / 学历 ×1 / 技能零命中 ×6。
- **Content Density**: Medium
- **Narrative Role**: 用一组指标 + 一个明确取舍，展示「指标是拿来用的，不是拿来看的」
- **Image Requirements**: 无（4 个大数字卡 + 底部样本量说明）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 主动暴露「区间偏宽」，把弱点说在前面，反而增强可信度

## Page 12: 一次真实的迭代
- **Page Type**: Content
- **Page Title**: 一次真实的迭代
- **Page Subtitle**: 评测驱动，不是拍脑袋调阈值
- **Selected Template**: content/tech/1585.tpl
- **Content Structure**:
  - **改什么**：改「判定链条」，而不是改「业务维度计数」。
  - **三个数的变化（Before → After）**：一致率 90.0% → **96.7%**；误筛率 25.0% → **8.3%**；漏筛率 **0% → 0%（守住）**。
  - **为什么这么选**：五个候选方案做了实测对照，选中的方案是**唯一一个**「一致率 ↑ 且 漏筛不 ↑」的。
  - **为什么不能改业务维度计数**：「与职能族词表求交」实测一致率仅 73.3%、**漏筛 0% → 22.2%，破了红线**，因此被明确否决。
  - 底部一句：**评测的作用不是给一个分数，是帮你否决看起来更「聪明」的方案。**
- **Content Density**: Medium
- **Narrative Role**: 用一次真实的方案否决过程，证明评测是决策工具
- **Image Requirements**: 无（Before→After 对比条）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 「否决了一个更复杂的方案」比「我调参调上去了」更能说明评测素养

## Page 13: 技术实现概览
- **Page Type**: Content
- **Page Title**: 技术实现概览
- **Page Subtitle**: 为什么「零依赖」是一个产品决策
- **Selected Template**: content/tech/1590.tpl
- **Content Structure**:
  - **运行时**：Node 22 原生 http + 内置 node:sqlite → **零依赖**，clone 下来一条命令就能起，PoC 阶段把「环境问题」这个变量彻底消掉。
  - **前端**：单文件 HTML（内联全部 CSS/JS）→ 断网可演示、双击即开；代价我主动说：没法按需加载、没有构建期校验。
  - **分层**：后端 16 个模块按 L0–L5 分层，依赖方向单向，改一层不会牵连全栈。
  - **来源单一**：shared/ 三个文件是前后端共用数据源，改一处离线端与后端同时生效，避免两套逻辑漂移。
  - **数据库**：schema v9，版本化迁移；空库自动迁移 + 种子，不提交任何数据文件。
  - **规模**：24 页面 / 47 接口 / 约 19,400 行 JS / 10,300+ 行文档——全部由脚本从代码算出。
- **Content Density**: Medium
- **Narrative Role**: 说明技术选型背后的产品理由，而不是罗列技术栈
- **Image Requirements**: 无（6 行对照表式卡片）
- **Page Weight**: Secondary page
- **Content Page Selection Rationale**: AI PM 岗面试官关心「你懂不懂工程约束」，这一页每行都带一条「为什么这么选」

## Page 14: 工程纪律：让文档不许撒谎
- **Page Type**: Content
- **Page Title**: 让文档不许撒谎
- **Page Subtitle**: 不是「我写了文档」，是「我让文档没法骗人」
- **Selected Template**: content/tech/1587.tpl
- **Content Structure**:
  - **回归套件**：12 个套件（后端 4 / 自包含 4 / 前端 4），一条命令全跑 → 挡住「改 A 坏 B」。
  - **文档真相守卫**：从代码读出 24 页面 / 47 接口 / 537,851 字节 / schema v9 等事实，比对文档里的「现状句」→ 挡住「文档与代码不一致」（真发生过：四份文档四个页面数）。
  - **负向锚点**：不只钉住「现在是多少」，还禁止**旧值复活** → 挡住「修了一处、另外四篇还留着旧数字」。
  - **评测基线单一源**：baseline.json 是评测数字的唯一源，守卫**单向**：质量 ≥ 基线、错误 ≤ 基线 → 挡住「指标倒退还悄悄过 CI」。
  - **生成物单一源**：全部阅读版 HTML 由一条命令从 Markdown 重生，清单写在代码里。
  - **CI**：Node 22 / 24 双矩阵 + Python 编译检查 + Pages 构建 → 挡住「只在某一个 Node 版本上碰巧能跑」。
  - 底部教训条：曾把基线写成**四舍五入后**的值，而守卫单向往上比 → 「真值 96.67% vs 基线 96.7%」被判倒退，**报了一个假红**；修法是把基线存**原始值**。
- **Content Density**: Heavy
- **Narrative Role**: 全篇最能体现工作方式的一页——把「诚信」变成可执行的机制
- **Image Requirements**: 无（机制清单 + 底部教训条）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 「让文档没法骗人」是本项目最差异化的工程实践，也是面试官最容易记住的记忆点

## Page 15: 从 0 到 1
- **Page Type**: Content
- **Page Title**: 从 0 到 1 的七个阶段
- **Page Subtitle**: 每个阶段的产出物都留在仓库里
- **Selected Template**: content/tech/1584.tpl
- **Content Structure**:
  - **立项**：定位 / 目标客户 / KPI 树 / Non-goals → 产品需求草稿。
  - **需求调研**：岗位词库（职能族 / 行业 / 技能尾巴）+ 市场岗位快照 → 183 条市场岗位。
  - **产品设计**：口径设计——打分维度与权重、判定链条、JD 生成与合规规则 → v13 / v14 / v16 三版口径修复说明。
  - **开发**：分层骨架、权限模型、状态机、审计触发器 → 24 页面 / 47 接口 / schema v9。
  - **测试**：契约测试 → 质量评测 → 压测 → 文档守卫 → 12 套件 + 黄金集 + 基线守卫。
  - **上线**：上线自检、备份恢复、三档可用性路径 → 上线手册、部署路径文档。
  - **运营准备**：自审（把自己当面试官翻自己的代码）→ 面试前缺口审计。
- **Content Density**: Medium
- **Narrative Role**: 给出过程的完整证据链——每一步都有可查的产出物
- **Image Requirements**: 无（7 行阶段表）
- **Page Weight**: Secondary page
- **Content Page Selection Rationale**: 面试官会问「你从哪一步开始做的」，这页用「阶段 → 产出」的对应关系回答

## Page 16: 三次真实翻过车的点
- **Page Type**: Content
- **Page Title**: 三次真实翻车
- **Page Subtitle**: 每一次都留了回归用例
- **Selected Template**: content/tech/1585.tpl
- **Content Structure**:
  - **翻车 1 ·「测试全绿」其实是假的**：根因——前端套件把页面 id 写死成数组，新增页面时静默漏测，却照打「全部通过」；修法——改为从页面注册表**派生**，并由守卫禁止再写死。
  - **翻车 2 · 离线端与后端两套逻辑漂移**：根因——同一个判定在两处实现，改了一处忘了另一处；修法——抽 shared/ 单一数据源，离线端必须镜像同一份词库与口径，改完跑对应套件。
  - **翻车 3 · 规则模式下却报了 token 与成本**：根因——想让演示「看起来完整」，于是显示了一个凭空算出的金额；修法——规则模式一律显示 0，成本卡改「试算」并注明来源。
  - 底部一句话：**一个 AI 产品如果连自己的成本数字都不可信，业务方不会信它的任何输出。**
- **Content Density**: Medium
- **Narrative Role**: 用「翻车 → 根因 → 修法 → 回归用例」证明演进是真的
- **Image Requirements**: 无（三行翻车记录）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 主动讲失败且讲清根因，是候选人可信度最直接的证据

## Page 17: 自审：我把自己当面试官，审了一遍自己的项目
- **Page Type**: Content
- **Page Title**: 我审了一遍自己的项目
- **Page Subtitle**: 按「面试杀伤力」而不是「修复难度」排序
- **Selected Template**: content/tech/1586.tpl
- **Content Structure**:
  - **引子**：我假装我是面试官，且我愿意翻代码，写了一份 **12 项**缺口审计。
  - **被我自己抓出来、并且已经修掉的几条**：
    - 筛选链路虚报模型调用与成本——链路里其实 0 次模型调用，日志却记了模型工具名和 token 数 → 已修：工具名不撒谎，用量取自真实网关。
    - 「已进入优化数据集」是一句空话——审计日志这么写，但数据集不存在 → 已修：改成真正可归因的原因码枚举 + 一致率接口。
    - 一个死按钮（演示复跑必经路径，点下去毫无反应）→ 已修，并补了后端接口。
    - WAL 从不 checkpoint——实测日志文件是主库的 11 倍且只增不减 → 已修，压测时顺手记录 P95/P99。
    - 无障碍为 0——政府采购评标普遍含无障碍要求 → 已补最小集（弹窗语义 / 焦点管理 / 表格表头 / 减少动效）。
  - **为什么这一节值钱**：绝大多数候选人展示「我做成了什么」；我多展示一层——**「我知道它哪里还不行、并且我说得出来」**。
- **Content Density**: Heavy
- **Narrative Role**: 全篇最值钱的一节——把「不足」转化成「我清楚边界」
- **Image Requirements**: 无（清单 + 底部强调条）
- **Page Weight**: Core page
- **Content Page Selection Rationale**: 这一页直接对准岗位最重要的能力：自我审查与诚实

## Page 18: 已知边界
- **Page Type**: Content
- **Page Title**: 已知边界（不藏着）
- **Page Subtitle**: 说得清边界，比假装没有边界更有说服力
- **Selected Template**: content/tech/1587.tpl
- **Content Structure**:
  - **黄金集 30 例**：置信区间偏宽（[83.3%, 99.4%]）→ 扩样必须**独立标注**才有效，不能拿规则输出当答案；口径与方法已独立成文。
  - **单租户**：租户标识写死 → 多租户涉及数据隔离模型重设计，属企业级门槛，不在 PoC 范围。
  - **无真实简历入口**：走演示数据 → 真实简历涉及个人信息合规，需先定数据来源与授权链路。
  - **模型未接入默认链路**：规则模式跑全流程 → **这是设计选择**（可复现、可签字）；接模型是替换一个函数，不改架构。
  - **并发天花板未压到极限**：已测到 20 并发 0 错误 → SQLite 单写者，需在真实部署形态下再压。
  - **无障碍仅最小集**：已补语义与焦点 → 完整 WCAG 审计未做，不能当合规。
- **Content Density**: Medium
- **Narrative Role**: 主动交代边界，把「不足」前置成「我知道我的边界在哪」
- **Image Requirements**: 无（6 行边界表）
- **Page Weight**: Secondary page
- **Content Page Selection Rationale**: 承接上一页的自审文化——自审不只是在代码里，也在产品的定位判断上

## Page 19: 关于我
- **Page Type**: Content
- **Page Title**: 关于我
- **Page Subtitle**: 马云冲 · AI 产品经理
- **Selected Template**: content/tech/1582.tpl
- **Content Structure**:
  - **背景**：执业法律背景，现在做 AI 产品方向——我对前面三条痛点的敏感度不是推演出来的：**一份 JD 或 Offer 里哪句话碰不得，我是从法条那一侧知道的。**
  - **工作方式**：让 AI 写代码，但我必须能解释每一行为什么这么写——所以我把每个踩过的坑都写成了回归用例。
  - **面试时会主动讲的三句话**：
    1. 「分数和档位 100% 是规则算出来的，模型只负责措辞。」
    2. 「漏筛率 0% 是我守的红线；为了它，我接受了 8.3% 的误筛。」
    3. 「我知道它哪儿还不行——这份自审清单就是证据。」
  - **联系方式**：（发送前请替换为真实邮箱 / 微信）
  - 两个入口：在线 demo（零安装，30 秒看完主流程）· 源码 + 完整文档
- **Content Density**: Medium
- **Narrative Role**: 收束到人——把项目能力转化为「我为什么适合这个岗位」
- **Image Requirements**: 无
- **Page Weight**: Secondary page
- **Notes**: 联系方式为占位符，交付时会提醒用户替换
