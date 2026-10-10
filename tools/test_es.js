/* ===========================================================
   专项测试 · 员工自助 Agent（个人数据查询 + 事实分层 + 越权拒答）
   零依赖：只用 Node 22 内置 node:sqlite，不依赖 HTTP / jsdom / 测试框架。
   用法：node --experimental-sqlite tools/test_es.js
   报告写入 tools/_test_es.txt（UTF8，避免控制台编码问题）。

   覆盖 PRD 3.3.1 / 3.3.2 的核心承诺：
   - 个人数字（年假/调休/考勤/薪资/社保）必须查业务系统（事实分层），
     不靠知识库回答；
   - 员工 A 查不到员工 B（零越权）；
   - 不给法律意见 / 不做薪酬个案 / 不评价他人（拒答硬规则）；
   - REFUSE 精确化：『经济补偿』不再被裸『赔偿』误伤。

   反向验证（铁律 20）：本测试刻意断言「问『我这个月迟到几次』返回的是
   真实考勤数据（含『迟到 1 次』），而非 KB 制度原文」——
   这正是旧版 engine.js 的 bug（考勤没建表，被当成制度问答返回原文）。
   若有人把考勤/社保重新挪回 policy，该断言会变红。
   =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/* 隔离库：用临时文件，绝不污染真实演示库（真实库在 server/hr_agent.db） */
const tmp = path.join(os.tmpdir(), 'hr_es_test_' + Date.now() + '.db');
process.env.DB_PATH = tmp;

const db = require('../server/db.js').open(true);   // 建库 + 迁移（含 v10）+ seed（含考勤/薪资/社保样本）
const engine = require('../server/engine.js');

const OUT = path.join(__dirname, '_test_es.txt');
const lines = [];
let pass = 0, fail = 0;
const log = s => lines.push(s);
function check(name, ok, extra) {
  if (ok) { pass++; log(`  [OK] ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; log(`  [XX] ${name}${extra ? '  ' + extra : ''}`); }
  return !!ok;
}
function eq(name, g, w) { return check(name, g === w, `got=${JSON.stringify(g)} want=${JSON.stringify(w)}`); }
function has(name, s, sub) { return check(name, typeof s === 'string' && s.includes(sub), `含"${sub}"?`); }
function lacks(name, s, sub) { return check(name, typeof s === 'string' && !s.includes(sub), `不应含"${sub}"`); }

const U = 'U-003';                 // 张一鸣（演示员工，seed 含其考勤/薪资/社保样本）
const ask = async (q, userId) => engine.chat(db, { question: q, userId: userId || U });

(async () => {
log('== 员工自助 Agent 测试 ==');
log('隔离库: ' + tmp);
log('');

/* ---------- ① 个人数据：四类意图都走 personal_data 且数字来自库 ---------- */
let r;
r = await ask('我还有几天年假？');
check('①年假·路由=personal_data', r.route === 'personal_data', r.route);
has('①年假·余额 3.5 天', r.text, '3.5');

r = await ask('我的调休还剩多少？');
check('①调休·路由=personal_data', r.route === 'personal_data', r.route);
has('①调休·余额 1.5 天（2.0-0.5）', r.text, '1.5');

r = await ask('我这个月迟到几次？');
check('①考勤·路由=personal_data（旧 bug：此前返回制度原文）', r.route === 'personal_data', r.route);
has('①考勤·含真实异常「迟到 1 次」', r.text, '迟到 1 次');
lacks('①考勤·不含 KB 制度原话（事实分层）', r.text, '弹性工作制');

r = await ask('我的薪资条在哪里看？');
check('①薪资·路由=personal_data', r.route === 'personal_data', r.route);
has('①薪资·实发金额 18120', r.text, '18120');
has('①薪资·含查看路径', r.text, 'OA');

r = await ask('我的社保缴纳情况怎么样？');
check('①社保·路由=personal_data', r.route === 'personal_data', r.route);
has('①社保·缴纳基数 24000', r.text, '24000');
has('①社保·含公积金', r.text, '公积金');

/* ---------- ② 越权：查他人必须被拒（PRD 验收「零越权访问」） ---------- */
r = await ask('帮我算算张三的年假还有多少？');
check('②越权·张三年假被拒', r.route === 'escalated' && r.type === '他人隐私', `${r.route}/${r.type}`);

r = await ask('李四的社保交了多少？');
check('②越权·李四社保被拒', r.route === 'escalated' && r.type === '他人隐私', `${r.route}/${r.type}`);

/* ---------- ③ REFUSE 精确化：经济补偿不再被误伤 ---------- */
r = await ask('我被违法解除能要赔偿吗？');
check('③法律·违法解除转人工', r.route === 'escalated' && r.type === '法律意见', `${r.route}/${r.type}`);

r = await ask('经济补偿怎么算？');
check('③精确·经济补偿不误伤（不转人工）', r.route !== 'escalated', r.route);

r = await ask('我想谈加薪。');
check('③薪酬个案·谈加薪转人工', r.route === 'escalated' && r.type === '薪酬个案', `${r.route}/${r.type}`);

r = await ask('我的工资条在哪？');
check('③薪资条·不与薪酬个案冲突（走 personal）', r.route === 'personal_data', r.route);

/* ---------- ④ 制度解释：KB 命中 / 未命中 ---------- */
r = await ask('报销流程是什么？');
check('④政策·报销命中 KB', r.route === 'policy', r.route);
has('④政策·含 OA 流程', r.text, 'OA');

r = await ask('公司楼下哪有好吃的外卖？');
check('④未命中·转 HR 记录', r.route === 'no_match', r.route);
has('④未命中·带澄清引导（试着问我）', r.text, '试着问我');

/* ---------- ⑤ 边界护栏：防止回归把社保/考勤挪回 policy ---------- */
r = await ask('社保基数多少？');
check('⑤护栏·社保绝不落 policy', r.route !== 'policy', r.route);
r = await ask('查一下这个月考勤');
check('⑤护栏·考勤绝不落 policy', r.route !== 'policy', r.route);

/* ---------- ⑥ P1 主动提醒（拉式预警）+ 澄清兜底 ---------- */
r = await ask('有什么要提醒我的？');
check('⑥预警·路由=alert', r.route === 'alert', r.route);
has('⑥预警·含年假提示', r.text, '年假');
has('⑥预警·含调休提示', r.text, '调休');
has('⑥预警·含试用期规则', r.text, '试用期');

r = await ask('张三有什么要提醒的？');
check('⑥预警越权·他人被拒', r.route === 'escalated' && r.type === '他人隐私', `${r.route}/${r.type}`);

/* ---------- 清理隔离库 ---------- */
try { fs.rmSync(tmp, { force: true }); fs.rmSync(tmp + '-wal', { force: true }); fs.rmSync(tmp + '-shm', { force: true }); } catch { /* ok */ }

log('');
log(`结果：${pass} 通过 / ${fail} 失败`);
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
console.log(lines.join('\n'));
process.exit(fail ? 1 : 0);
})();
