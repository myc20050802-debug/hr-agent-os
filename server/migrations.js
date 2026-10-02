/* ===========================================================
   L4 · 版本化迁移（migrations）
   职责：**所有 schema 变更都走这里**，且可从空库一键建到最新版本。

   为什么必须版本化（而不是原来的 migrate() 补列）：
   - 原来的做法是「运行时探测缺哪列就 ALTER」，缺点：① 无法表达「改默认值 / 建索引 /
     加约束 / 数据回填」；② 没有执行记录，无法回答「这台机器的库是什么版本」；
     ③ 不可回放，新机器只能靠代码路径恰好走到才建表。
   - 版本化后：`schema_migrations` 记录已应用版本，每个迁移只跑一次，顺序固定，可审计。

   约定：
   - 迁移**只增不改**：已发布的迁移脚本视为不可变（改它等于篡改历史）。
     需要修正就再加一条新迁移。
   - 每条迁移在**独立事务**内执行：失败即整体回滚，不会留下半成品 schema。
   - SQLite 的 DDL 支持事务，这点比 MySQL 强，所以这里可以放心地包事务。

   迁移清单：
     v1  baseline              现有 13 张业务表（与 docs/02 的 PG 版同源）
     v2  auth_sessions         账号口令字段 + 会话表（M1 可信底座）
     v3  governance            授权留痕 / 留存策略 / 删除请求（M8 数据治理）
     v4  audit_append_only     审计表 append-only 的**数据库层**约束（触发器）
     v5  hiring_pipeline       面试与 Offer 实体（把「已邀约」之后的链路补成真的）
     v6  override_code         人工推翻原因结构化（把「进入优化数据集」从承诺变成可统计的枚举）
     v7  score_why             打分归因落库（复核历史评分看到的是当时的理由）
     v8  job_duties            岗位职责栏（HR 自填职责随岗位持久化，v13）
     v9  reference_jobs        岗位资料库（BOSS 直聘在招岗位抓取入库，作为 JD 生成的参考依据）
   =========================================================== */
'use strict';
const { logger } = require('./logger.js');

/* ---------- v1 · baseline：现有业务表（全部 IF NOT EXISTS，对已有库幂等） ---------- */
const BASELINE_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT DEFAULT 'mvp', region TEXT DEFAULT 'cn-north'
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL,              -- admin/hrd/hrbp/recruiter/interviewer/employee/auditor
  dept_path TEXT, title TEXT, external_id TEXT, is_active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, dept_path TEXT,
  must_have TEXT DEFAULT '[]', nice_have TEXT DEFAULT '[]', rubric TEXT DEFAULT '{}',
  must_years REAL, must_edu_rank INTEGER, status TEXT DEFAULT 'open',
  industry TEXT DEFAULT '互联网',
  jd_text TEXT,
  jd_ver INTEGER DEFAULT 0,
  keywords TEXT DEFAULT '[]',
  headcount INTEGER DEFAULT 1,
  salary TEXT,
  opened_at TEXT,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, job_id TEXT NOT NULL,
  name TEXT, gender TEXT, birth_date TEXT,          -- 存储保留，但送入打分前物理剔除
  years_exp REAL, edu_rank INTEGER, edu_text TEXT, company TEXT,
  skills TEXT DEFAULT '[]', business_tags TEXT DEFAULT '[]', plus_tags TEXT DEFAULT '[]',
  source TEXT, stage TEXT DEFAULT 'screening',
  ai_score REAL, ai_grade TEXT, ai_reasons TEXT DEFAULT '[]', ai_note TEXT,
  human_decision TEXT, override_reason TEXT, parse_ok INTEGER DEFAULT 1,
  consent_given INTEGER DEFAULT 1, retain_until TEXT,
  synthesized INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leave_balance (
  user_id TEXT PRIMARY KEY, annual_total REAL, annual_used REAL, carryover REAL
);
CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, ver TEXT,
  effective_at TEXT, visibility TEXT DEFAULT 'all', status TEXT DEFAULT 'active', updated_at TEXT
);
CREATE TABLE IF NOT EXISTS kb_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, content TEXT NOT NULL, keywords TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_type TEXT NOT NULL,
  initiator_id TEXT NOT NULL, goal TEXT NOT NULL,
  plan TEXT DEFAULT '[]', status TEXT DEFAULT 'running',
  result TEXT, token_cost INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, tool_name TEXT NOT NULL,
  params TEXT, result TEXT, is_high_risk INTEGER DEFAULT 0, status TEXT,
  error_msg TEXT, duration_ms INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, action_type TEXT NOT NULL,
  title TEXT, payload TEXT NOT NULL, risk_level TEXT DEFAULT 'high',
  status TEXT DEFAULT 'pending', reviewer_id TEXT, reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')), reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
  actor_type TEXT NOT NULL, actor_id TEXT, task_id TEXT,
  action TEXT NOT NULL, object_type TEXT, object_id TEXT,
  detail TEXT, result TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS unanswered_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL,
  asked_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status       ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_cand_job          ON candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_cand_job_score    ON candidates(job_id, ai_score);
CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_result      ON audit_logs(result);
CREATE INDEX IF NOT EXISTS idx_chunks_doc        ON kb_chunks(doc_id);
`;

/* ---------- v3 · 治理 ---------- */
const GOVERNANCE_SQL = `
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  purpose TEXT NOT NULL,              -- 用途：招聘评估 / 人才库留存 / 背调
  channel TEXT,                       -- 取得渠道：投递勾选 / 书面 / 邮件确认
  evidence TEXT,                      -- 授权凭证摘要（不存原文）
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS retention_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  data_class TEXT NOT NULL,           -- 数据类别：候选人简历 / 面试记录 / 落选者档案
  retain_days INTEGER NOT NULL,
  basis TEXT,                         -- 留存依据（法律或业务）
  updated_at TEXT,
  UNIQUE(tenant_id, data_class)
);
CREATE TABLE IF NOT EXISTS erasure_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  requested_by TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending',      -- pending/done/rejected
  handled_by TEXT, handled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consent_cand  ON consents(candidate_id);
CREATE INDEX IF NOT EXISTS idx_erasure_stat  ON erasure_requests(status);
CREATE INDEX IF NOT EXISTS idx_cand_retain   ON candidates(retain_until);
`;

/* ---------- v4 · 审计 append-only 的数据库层约束 ----------
   注意：这是**数据库层**约束，而非应用层自觉。
   应用层「我们不写 UPDATE」是承诺；触发器是**物理不可能**。两级都要有。 */
const AUDIT_GUARD_SQL = `
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only: UPDATE denied by policy');
END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only: DELETE denied by policy');
END;
`;

/* ---------- v5 · 面试与 Offer ----------
   为什么这两张表之前不存在、现在必须补：
   原型把「邀约与调度 / 面试辅助 / Offer 前置」三页画得很完整，但后端零支撑 ——
   候选人的 `stage` 走到「已邀约」就断了，`interviewer` 角色配了能力却没有一个真人担任。
   补上实体之后，链路才从「已邀约」继续走到「已入职」，权限模型也才有落点。

   设计口径（与 docs/08 ADR-009 一致）：
   - 面试**结果**必须由面试官本人填写，Agent 不产出录用建议（判断权在人）。
   - Offer 的**发出**是高风险动作，只有 HRD 能批（offer:decide）。
   - 阶段流转由这两张表的状态驱动，而不是让人手动改 stage —— 避免出现
     「表里说没面试、候选人却已入职」这类自相矛盾的数据。 */
const HIRING_SQL = `
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,        -- 第几轮（1=初试，2=复试）
  mode TEXT DEFAULT '线上',                 -- 线上 / 现场
  scheduled_at TEXT,                       -- 计划时间（北京时间字符串）
  duration_min INTEGER DEFAULT 60,
  interviewer_id TEXT NOT NULL,            -- 面试官（users.role='interviewer'）
  status TEXT DEFAULT 'scheduled',         -- scheduled/in_progress/completed/cancelled
  result TEXT,                             -- pass / hold / fail（仅在 completed 后有值）
  feedback TEXT,                           -- 面试纪要（面试官填写，Agent 只做整理）
  score REAL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  salary INTEGER,                          -- 月薪（元），用于带宽与红线校验
  probation_months INTEGER DEFAULT 3,
  report_date TEXT,                        -- 期望到岗日
  status TEXT DEFAULT 'pending_approval',  -- pending_approval/sent/rejected/accepted/declined
  note TEXT,
  created_by TEXT,
  decided_by TEXT, decided_at TEXT,
  decided_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_itv_cand        ON interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_itv_interviewer ON interviews(interviewer_id, status);
CREATE INDEX IF NOT EXISTS idx_itv_job         ON interviews(job_id);
CREATE INDEX IF NOT EXISTS idx_offer_cand      ON offers(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offer_status    ON offers(status);
`;

const MIGRATIONS = [
  {
    version: 1, name: 'baseline',
    up(db) { db.exec(BASELINE_SQL); },
  },
  {
    version: 2, name: 'auth_sessions',
    up(db) {
      /* 老库升级：给已存在的 users 补认证字段（不删库，避免 Windows 文件锁与数据丢失） */
      const add = (table, col, ddl) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      };
      add('users', 'password_hash', `password_hash TEXT`);
      add('users', 'password_algo', `password_algo TEXT`);
      add('users', 'password_updated_at', `password_updated_at TEXT`);
      add('users', 'last_login_at', `last_login_at TEXT`);
      add('users', 'failed_logins', `failed_logins INTEGER DEFAULT 0`);
      add('users', 'locked_until', `locked_until TEXT`);
      add('users', 'must_change_password', `must_change_password INTEGER DEFAULT 0`);
      add('users', 'is_active', `is_active INTEGER DEFAULT 1`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          token_fp TEXT NOT NULL,          -- 令牌指纹（只存哈希，不存令牌原文）
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_seen_at TEXT,
          revoked_at TEXT,
          revoke_reason TEXT,
          client_ip TEXT, user_agent TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_exp    ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_fp     ON sessions(token_fp);
      `);
    },
  },
  {
    version: 3, name: 'governance',
    up(db) {
      db.exec(GOVERNANCE_SQL);
      /* 候选人表补治理字段 */
      const cols = db.prepare(`PRAGMA table_info(candidates)`).all().map(c => c.name);
      if (!cols.includes('consent_given')) db.exec(`ALTER TABLE candidates ADD COLUMN consent_given INTEGER DEFAULT 1`);
      if (!cols.includes('retain_until')) db.exec(`ALTER TABLE candidates ADD COLUMN retain_until TEXT`);
      if (!cols.includes('anonymized_at')) db.exec(`ALTER TABLE candidates ADD COLUMN anonymized_at TEXT`);
      if (!cols.includes('synthesized')) db.exec(`ALTER TABLE candidates ADD COLUMN synthesized INTEGER DEFAULT 0`);
    },
  },
  {
    version: 4, name: 'audit_append_only',
    up(db) { db.exec(AUDIT_GUARD_SQL); },
  },
  {
    version: 5, name: 'hiring_pipeline',
    up(db) { db.exec(HIRING_SQL); },
  },
  {
    /* v6 · 人工推翻原因结构化
       为什么加：override_reason 是自由文本，能存不能用 —— 无法统计「规则最常错在哪」。
       加上 override_code（枚举，取值见 shared/override-codes.js）后，
       「推翻原因进入优化数据集」才第一次成为可聚合、可排序、可直接驱动改进的数据。
       另加两个便于统计的索引：按人工结论筛选样本、按原因码分组。 */
    version: 6, name: 'override_code',
    up(db) {
      const cols = db.prepare(`PRAGMA table_info(candidates)`).all().map(c => c.name);
      if (!cols.includes('override_code')) db.exec(`ALTER TABLE candidates ADD COLUMN override_code TEXT`);
      if (!cols.includes('human_decided_at')) db.exec(`ALTER TABLE candidates ADD COLUMN human_decided_at TEXT`);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cand_human     ON candidates(human_decision);
        CREATE INDEX IF NOT EXISTS idx_cand_ovcode    ON candidates(override_code);
      `);
    },
  },
  {
    version: 7, name: 'score_why',
    up(db) {
      /* 打分归因（为什么是这个分）。
         为什么落库而不是每次现算：归因里含「本次命中了哪些关键词、差哪几个」，
         这些上下文在读取时已经拿不全了（岗位关键词会随词库升级重算）。
         落库后它就是**当时那次判断的原始记录** —— 复核历史评分时看到的是当时的理由，
         而不是用今天的口径重算出来的理由。 */
      const cols = db.prepare(`PRAGMA table_info(candidates)`).all().map(c => c.name);
      if (!cols.includes('ai_why')) db.exec(`ALTER TABLE candidates ADD COLUMN ai_why TEXT`);
    },
  },
  {
    version: 8, name: 'job_duties',
    up(db) {
      /* 「岗位职责」栏（v13）：HR 单独填写的职责条目随岗位落库。
         为什么必须落库而不是每次从 must_have 反推：职责不进打分关键词通道，
         must_have 里根本没有它 —— 不落库的话，编辑保存与词库自愈重算
         都会把 HR 写的职责静默替换成职能模板，用户内容直接丢失。 */
      const cols = db.prepare(`PRAGMA table_info(jobs)`).all().map(c => c.name);
      if (!cols.includes('duties')) db.exec(`ALTER TABLE jobs ADD COLUMN duties TEXT`);
    },
  },
  {
    version: 9, name: 'reference_jobs',
    up(db) {
      /* 岗位资料库：把 BOSS 直聘在招岗位的「岗位名称 / 岗位描述 / 薪资范围 /
         工作地点 / 抓取时间」等结构化落库，作为今后所有 JD 生成任务的参考依据。
         为什么独立成表而不是塞进 jobs：jobs 是「本公司自己的招聘需求」，
         reference_jobs 是「市场公开在招岗位」—— 两类语义不同、生命周期不同、
         权限不同（资料库只读参考，不影响本公司招聘流程），必须分开。 */
      db.exec(`
        CREATE TABLE IF NOT EXISTS reference_jobs (
          id            TEXT PRIMARY KEY,
          tenant_id     TEXT NOT NULL DEFAULT 'T-001',
          job_title     TEXT NOT NULL,
          job_description TEXT,
          salary_range  TEXT,
          location      TEXT,
          company_name  TEXT,
          company_industry TEXT,
          company_scale TEXT,
          source_url    TEXT,
          skill_labels  TEXT,
          scraped_at    TEXT,
          raw_json      TEXT,
          created_at    TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ref_title    ON reference_jobs(job_title);
        CREATE INDEX IF NOT EXISTS idx_ref_loc      ON reference_jobs(location);
        CREATE INDEX IF NOT EXISTS idx_ref_scraped  ON reference_jobs(scraped_at DESC);
      `);
    },
  },
];

const LATEST = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

function ensureMeta(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      duration_ms INTEGER
    );
  `);
}

/** 当前库已应用到哪个版本 */
function currentVersion(db) {
  ensureMeta(db);
  const r = db.prepare(`SELECT COALESCE(MAX(version),0) v FROM schema_migrations`).get();
  return Number(r ? r.v : 0);
}

/**
 * 执行所有未应用的迁移。可从**空库**一键建到最新版本。
 * @returns {{from:number,to:number,applied:Array<{version:number,name:string,ms:number}>}}
 */
function run(db, log = logger) {
  ensureMeta(db);
  const from = currentVersion(db);
  const applied = [];
  const st = db.prepare(`INSERT INTO schema_migrations (version,name,applied_at,duration_ms) VALUES (?,?,?,?)`);
  for (const m of MIGRATIONS.sort((a, b) => a.version - b.version)) {
    if (m.version <= from) continue;
    const t0 = Date.now();
    db.exec('BEGIN');
    try {
      m.up(db);
      const ms = Date.now() - t0;
      st.run(m.version, m.name, new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19), ms);
      db.exec('COMMIT');
      applied.push({ version: m.version, name: m.name, ms });
      log.info('迁移已应用', { version: m.version, name: m.name, ms });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* 回滚失败不掩盖原始错误 */ }
      throw new Error(`[migrations] v${m.version} ${m.name} 失败：${e.message}`, { cause: e });
    }
  }
  return { from, to: currentVersion(db), applied };
}

/**
 * 临时摘除审计 append-only 触发器执行 fn，随后恢复。
 *
 * 为什么需要：`/api/reset` 要把演示数据清空重灌，其中包含 DELETE FROM audit_logs，
 * 而 v4 迁移特意把这张表的 DELETE 设成物理不可能。这是**故意的对冲**：
 * 生产路径不该有这种需求，只有「演示数据重置」这一个受控场景需要，
 * 所以用一个名字就把风险框住 —— 凡调用它，都必须能说清为什么。
 */
function withoutAuditGuards(db, fn) {
  db.exec(`DROP TRIGGER IF EXISTS trg_audit_logs_no_update; DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;`);
  try { return fn(); }
  finally { db.exec(AUDIT_GUARD_SQL); }
}

module.exports = { run, currentVersion, MIGRATIONS, LATEST, withoutAuditGuards, BASELINE_SQL, HIRING_SQL };
