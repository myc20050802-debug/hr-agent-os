/* ===========================================================
   L1/L2 · 三层 RBAC（rbac）
   职责：把「谁、能对什么、做什么、看到哪些字段」变成可执行的判断。

   三层权限（对齐 docs/08 ADR-009）：
     ① 功能级 —— 这个 API 他能不能调？        can(ctx, 'job:write')
     ② 行级   —— 这条数据他能不能看？          inScope(ctx, row)   （部门 / 本人）
     ③ 字段级 —— 这条记录里哪些字段要脱敏？     maskRow(ctx, row)

   设计纪律（这几条是本模块存在的意义）：
   - **默认拒绝**：能力表里没写 = 不能。不是写「黑名单」，而是「白名单」。
   - **拒绝即留痕**：每一次 403 都由调用方写审计（result='blocked'），
     原因是「越权尝试」本身就是安全情报，比「我们没被攻破」有用得多。
   - **tenant_id 永不接受前端传入**：一律由服务端会话推导（见 auth.js）。
     这是防「改个参数就跨租户」的根本手段。
   - **未脱敏 PII 不是权限问题，是「权限 + 留痕」两件事**：拿到 pii:read 还不够，
     实际读取必须写一条审计。见 needsPiiAudit()。
   =========================================================== */
'use strict';
const { AppError, CODES } = require('./errors.js');
const { config } = require('./config.js');

/* ---------- 能力清单 ----------
   命名规则 `资源:动作`。粒度取「一个页面一次主要操作」，过细会难维护，
   过粗则失去意义。 */
const ABILITIES = [
  'job:read', 'job:write',
  'screen:run', 'screen:read',
  'candidate:read',
  'approval:read', 'approval:decide',
  /* 面试与 Offer：把「已邀约」之后的链路做成真的，权限也按真实分工切 */
  'interview:read',       // 看面试安排
  'interview:schedule',   // 安排 / 改约 / 取消面试（招聘侧）
  'interview:feedback',   // 填写面试结果与纪要（**只有面试官本人**能写）
  'offer:read',
  'offer:create',         // 起草 Offer（招聘侧）
  'offer:decide',         // 审批并发出 Offer（HRD 独占）
  'employee:read', 'employee:export',
  'audit:read',
  'governance:read', 'governance:write',
  'report:read',
  'admin:user', 'admin:policy',
  'self:read',            // 员工自助：仅本人数据
  'pii:read',             // 读取未脱敏 PII（额外触发审计）
  'metrics:read',
];

/* ---------- 角色 → 能力 ----------
   最小权限原则：每个角色只拿它每天真正需要的能力。
   `*` 仅 admin 拥有。 */
const ROLE_ABILITIES = {
  admin: ['*'],
  hrd: [
    'job:read', 'job:write', 'screen:run', 'screen:read', 'candidate:read',
    'approval:read', 'approval:decide',
    'interview:read', 'interview:schedule', 'interview:feedback',
    'offer:read', 'offer:create', 'offer:decide',
    'employee:read', 'employee:export',
    'audit:read', 'governance:read', 'governance:write', 'report:read',
    'pii:read', 'metrics:read', 'admin:policy',
  ],
  /* 招聘专员负责把候选人往前推：安排面试、起草 Offer。
     但**批不了自己发起的申请**（没有 approval:decide），也**发不出 Offer**
     （没有 offer:decide）—— 这两个缺口是刻意留的，不是漏配。 */
  recruiter: [
    'job:read', 'job:write', 'screen:run', 'screen:read', 'candidate:read',
    'approval:read',
    'interview:read', 'interview:schedule',
    'offer:read', 'offer:create',
    'employee:read', 'report:read',
  ],
  hrbp: ['job:read', 'screen:read', 'employee:read', 'report:read', 'governance:read'],
  /* 面试官：只读写「属于自己的面试」。没有 screen:run，也没有 approval:read——
     面试官不需要看到审批流，更不该看到别人的候选人（行级由 hiring.js 再收一道）。 */
  interviewer: ['job:read', 'screen:read', 'candidate:read', 'interview:read', 'interview:feedback'],
  /* 员工只有自助能力 —— 注意它连 report:read / employee:read 都没有，
     所以「导出全公司花名册」在功能级就被拦下（不是靠行级过滤）。 */
  employee: ['self:read'],
  /* 数据保护负责人：能看审计与治理，但**看不到未脱敏 PII**，也不能改业务数据 */
  auditor: ['audit:read', 'governance:read', 'report:read', 'metrics:read'],
};

/* ---------- 行级范围 ----------
   all  = 全量
   dept = 本部门（含下级）：dept_path 前缀匹配
   self = 仅本人 */
const ROLE_SCOPE = {
  admin: 'all', hrd: 'all', recruiter: 'all', auditor: 'all',
  hrbp: 'dept', interviewer: 'dept', employee: 'self',
};

const ROLE_LABEL = {
  admin: '系统管理员', hrd: '人力资源总监', recruiter: '招聘专员',
  hrbp: 'HRBP', interviewer: '面试官', employee: '员工', auditor: '数据保护负责人',
};

/* ---------- ① 功能级 ---------- */
function abilitiesFor(role) {
  const list = ROLE_ABILITIES[role];
  if (!list) return [];
  if (list.includes('*')) return ABILITIES.slice();
  return list.slice();
}

function can(ctx, ability) {
  if (!ctx || !ctx.role) return false;
  const list = ROLE_ABILITIES[ctx.role];
  if (!list) return false;
  return list.includes('*') || list.includes(ability);
}

/** 断言式：不满足直接抛 403（调用方负责写审计，见 assertAbility 的 auditDb 参数） */
function assertAbility(ctx, ability, meta = {}) {
  if (can(ctx, ability)) return true;
  const err = new AppError('FORBIDDEN', `403：缺少能力「${ability}」${meta.what ? '（' + meta.what + '）' : ''}`);
  err.reason = `缺少能力 ${ability}（角色 ${ctx && ctx.role}）`;
  err.ability = ability;
  throw err;
}

/* ---------- ② 行级 ---------- */
function scopeOf(ctx) { return ROLE_SCOPE[ctx && ctx.role] || 'self'; }

const normDept = p => String(p || '').replace(/\/+$/, '');

/**
 * 行级判断。row 需要提供 deptPath（部门）与可选 ownerId（属主）。
 * @returns {boolean}
 */
function inScope(ctx, row = {}) {
  const s = scopeOf(ctx);
  if (s === 'all') return true;
  if (s === 'dept') {
    const mine = normDept(ctx.deptPath);
    const target = normDept(row.deptPath);
    if (!mine || !target) return false;
    return target === mine || target.startsWith(mine + '/');
  }
  /* self：必须有 ownerId 且等于会话用户 */
  return !!row.ownerId && row.ownerId === ctx.userId;
}

/* ---------- ③ 字段级 ---------- */
const PII_FIELDS = config.rbac.piiFields;

/** 是否应当遮罩 PII：无 pii:read 能力则一律遮罩 */
const shouldMask = ctx => !can(ctx, 'pii:read');

/** 读取未脱敏 PII 是否需要留痕（只要是人工翻看他人简历，就要留痕） */
function needsPiiAudit(ctx, row = {}) {
  if (!can(ctx, 'pii:read')) return false;
  /* 看自己的数据不必留痕；看别人的必须留痕 */
  return !(row.ownerId && row.ownerId === ctx.userId);
}

const maskPhone = v => (!v ? v : String(v).replace(/^(\d{3})\d+(\d{4})$/, '$1****$2'));
const maskEmail = v => {
  if (!v) return v;
  const [n, d] = String(v).split('@');
  if (!d) return '***';
  return (n.slice(0, 1) || '*') + '***@' + d;
};

/**
 * 字段级脱敏：返回**新对象**（不改原对象，避免污染调用方的数据）。
 * 遮罩后的字段**保留原键名**（值为掩码串），而不是删除键 ——
 * 前端可以据此显示「*** 已脱敏」，比字段消失更容易解释。
 */
function maskRow(ctx, row, fields = PII_FIELDS) {
  if (!row || !shouldMask(ctx)) return row;
  const out = { ...row };
  for (const f of fields) {
    if (!(f in out)) continue;
    if (f === 'phone') out[f] = maskPhone(out[f]);
    else if (f === 'email') out[f] = maskEmail(out[f]);
    else if (out[f] != null && out[f] !== '') out[f] = '已脱敏';
  }
  return out;
}

/** 批量脱敏 */
const maskAll = (ctx, rows, fields) => (Array.isArray(rows) ? rows.map(r => maskRow(ctx, r, fields)) : rows);

/* ---------- 会话上下文构造 ---------- */
/**
 * 把「会话里的用户」变成权限判断用的 ctx。
 * 注意：tenantId 来自数据库里的用户记录，**不是**请求参数。
 */
function buildContext(user, session = {}) {
  return {
    userId: user.id,
    tenantId: user.tenant_id,
    name: user.name,
    role: user.role,
    deptPath: user.dept_path || '',
    title: user.title || '',
    sid: session.sid || null,
    abilities: abilitiesFor(user.role),
    scope: ROLE_SCOPE[user.role] || 'self',
  };
}

/** 给前端的自描述信息（不含任何敏感字段） */
const describe = ctx => ({
  id: ctx.userId, name: ctx.name, role: ctx.role,
  roleLabel: ROLE_LABEL[ctx.role] || ctx.role,
  dept: ctx.deptPath, title: ctx.title,
  scope: ctx.scope, abilities: ctx.abilities,
  tenantId: ctx.tenantId,
});

module.exports = {
  ABILITIES, ROLE_ABILITIES, ROLE_SCOPE, ROLE_LABEL, PII_FIELDS,
  abilitiesFor, can, assertAbility, scopeOf, inScope,
  shouldMask, needsPiiAudit, maskRow, maskAll, maskPhone, maskEmail,
  buildContext, describe, CODES,
};
