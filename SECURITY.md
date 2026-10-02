# 安全说明

## 这个项目是什么（以及不是什么）

**是**：一个可运行的 B 端 HR AI Agent 平台 PoC，内置了一套「认真做」的安全底座 ——
真实身份认证、服务端三层权限、append-only 审计、PIPL 数据治理、生产环境硬约束。

**不是**：生产级多租户 SaaS。**请勿直接把演示配置暴露到公网。** 到生产还差什么，见
[`docs/05_从PoC到企业级的差距清单.md`](docs/05_从PoC到企业级的差距清单.md)（按 P0/P1/P2 分级，8 项）。

---

## 已经做对的（欢迎验证，不欢迎只当宣传语）

| 机制 | 实现位置 | 怎么自己验 |
|---|---|---|
| 口令 `scrypt` 哈希，不可逆 | `server/auth.js` | 直接读 `users` 表，看不到明文 |
| 服务端会话 + 可吊销令牌（HMAC + 指纹校验） | `server/auth.js` | 改密后旧令牌立即失效 |
| 连续失败 5 次锁定 | `server/auth.js` | 故意输错 5 次 |
| 功能级 × 行级 × 字段级三层权限 | `server/routes.js` | 员工身份导出全公司花名册 → **真 403** |
| 审计 append-only（数据库触发器物理拒绝） | `server/migrations.js` v4 | 直接对 `audit_logs` 执行 `UPDATE` / `DELETE` |
| Offer 合规红线（最低工资 / 试用期上限） | `server/hiring.js` | 提交越界 Offer → **422 且不落库** |
| 日志敏感字段自动 `[REDACTED]` | `server/logs` 相关模块 | 看结构化日志输出 |
| 静态资源隔离（`/src/*`、`/build.js` 返回 404） | `server/routes.js` | 直接请求这两个路径 |
| 目录穿越防护 / CORS 白名单 / 安全响应头 | `server/routes.js` | `npm run test:ops`（48 项） |
| 生产硬约束 | `server/config.js` | `NODE_ENV=production` 但 `COOKIE_SECURE` 为空 → **拒绝启动** |

想一次性看结论：`npm run test:auth`、`npm run test:ops`、`npm run preflight`（只读自检，退出码 0 才可以把链接发出去）。

---

## 已知边界（部署前必读）

1. **演示口令是公开的**（登录页直接列出来）。任何对外可访问的实例，**第一件事就是改口令**，
   并关掉 `ALLOW_RESET`（否则任何人可以 POST `/api/reset` 清空演示数据）。
2. **`COOKIE_SECURE` 必须与访问协议配对**：HTTPS 设 `1`，HTTP 必须留空。配错的表现是
   「登录成功，下一秒又回到登录页」，很难自行归因。
3. **单进程单写者**。并发数字（P95/P99）是单进程口径，**不代表多实例生产容量**。
4. **没有多租户物理隔离**：租户是逻辑字段，不是独立库/独立 schema。
5. **没有文件与简历原文存储**，没有向量检索、模型评测平台、灰度与回滚。
6. **会话密钥**：未配 `SESSION_SECRET` / `SESSION_SECRET_FILE` 时每次启动随机生成 ——
   重启即全员登出，多实例部署会互相踢。生产必须配置指向持久卷的密钥文件。
7. **抓取脚本**访问的是 BOSS 直聘 / 智联招聘的**公开页面**。使用前请自行确认并遵守目标站点的
   robots 与服务条款，不要高频请求。仓库内 `reference_jobs` 是抓取快照，仅用于演示
   「JD 生成要接地真实市场」这一能力，**不代表任何公司的招聘承诺**。
8. **演示数据是合成的**（21 个岗位 / 79 份简历由程序生成），但**运行时数据库里可能含 PII** ——
   这就是 `server/hr_agent.db` 与 `backups/` 被 `.gitignore` 挡住的原因，请不要解除。

---

## 上报漏洞

发现安全问题请**不要开公开 Issue**（那等于在修补完成前公开暴露）。

- 走 GitHub 的 [Private vulnerability reporting](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  （仓库 **Security** 标签页 → *Report a vulnerability*），或
- 在本仓库新建 Issue 时**只写「需要私下沟通」**，不要贴细节。

请尽量附上：影响范围、复现步骤、你观察到的实际行为与期望行为、以及（如果方便）一个最小复现。

**这是个人 PoC 项目，没有 SLA。** 但每一条报告都会认真看：如果确认，我会给出修复时间点；
如果判定为非问题，我会说明理由 —— 而不是沉默。
