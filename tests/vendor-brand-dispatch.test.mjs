import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildVendorBrandChatPlan, isVendorBrandChatCandidate, withVendorBrandSwitchButton } from '../src/vendor-brand-chat.js';
import { buildVendorQrChatPlan, isVendorBranchQrChatCandidate, withVendorQrDashboardButton } from '../src/vendor-branch-qr-chat.js';
import { resolveWorkspaceIntent, WORKSPACE_INTENTS } from '../src/workspace/intent-router.js';
import { handleDashboardSummaryIntent } from '../src/workspace/dashboard-handler.js';
import { handleWorkspaceChatCardIntent } from '../src/workspace/workspace-chat-card-handler.js';
import { editorRole } from '../src/editor-access.js';
import { editorChatCard } from '../src/editor-ui.js';

const UID = 'U' + '1'.repeat(32), origin = 'https://brand-dispatch.example.test';
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function extract(name, async = false) { const code = source.match(new RegExp(`${async ? 'async ' : ''}function ${name}\\([^]*?\\n\\}`))?.[0]; assert.ok(code, name); return code; }
const entry = (text = '儀表板', extra = {}) => ({ eventType: 'message', messageType: 'text', text, postbackData: '', sourceType: 'user', LINE_user_id: UID, replyToken: 'synthetic', activitySignatureVerified: true, ...extra });
const command = (data, extra = {}) => entry('', { eventType: 'postback', messageType: '', postbackData: data, ...extra });
const card = title => ({ type: 'flex', altText: title, contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: title }] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'postback', label: '店家 QR 碼', data: 'action=vendor.branch_qr.list&page=0' } }] } } });
function setup(t, count = 7, management = true) {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  raw.exec(`CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contact_line_user_id TEXT,submitted_by_line_user_id TEXT,contract_end TEXT,contract_terminated_at TEXT);
    CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,source TEXT,created_at TEXT,updated_at TEXT,management_enabled INTEGER DEFAULT 0,PRIMARY KEY(vendor_id,line_user_id));
    CREATE TABLE welfare_vendor_line_sessions(line_user_id TEXT PRIMARY KEY,vendor_id TEXT,created_at TEXT,updated_at TEXT,stage TEXT,last_text TEXT);
    CREATE TABLE welfare_vendor_locations(id TEXT PRIMARY KEY,vendor_id TEXT,branch_name TEXT,address TEXT,status TEXT);
    CREATE TABLE welfare_redemptions(id TEXT PRIMARY KEY,amount INTEGER);
    INSERT INTO welfare_redemptions VALUES('unchanged-history',100);`);
  for (let n = 1; n <= count; n++) {
    raw.prepare("INSERT INTO welfare_vendors VALUES(?,?,'approved',0,'','','','')").run('brand-' + n, '品牌 ' + n);
    raw.prepare("INSERT INTO welfare_vendor_line_bindings VALUES(?,?,'active','admin','original-created','original-updated',?)").run('brand-' + n, UID, Number(management));
    raw.prepare("INSERT INTO welfare_vendor_locations VALUES(?,?,?,'測試地址','active')").run('branch-' + n, 'brand-' + n, '分店 ' + n);
  }
  const writes = [];
  const wrap = (query, args = []) => ({ bind(...values) { return wrap(query, values); }, async first() { return raw.prepare(query).get(...args) || null; }, async all() { return { success: true, results: raw.prepare(query).all(...args) }; }, async run() { assert.match(query.trim(), /^INSERT INTO welfare_vendor_line_sessions\b/); writes.push(query); const result = raw.prepare(query).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; } });
  return { raw, writes, prepare: query => wrap(query) };
}
function dispatcher(db, role = 'none', extra = {}) {
  const replies = [], dashboards = [], portals = [];
  const deps = {
    buildVendorBrandChatPlan, isVendorBrandChatCandidate, withVendorBrandSwitchButton, buildVendorQrChatPlan, isVendorBranchQrChatCandidate, withVendorQrDashboardButton,
    resolveWorkspaceIntent, WORKSPACE_INTENTS, handleDashboardSummaryIntent, handleWorkspaceChatCardIntent, editorRole, editorChatCard,
    findAdminUidWhitelistRowReadOnly: async () => role === 'admin' || editorRole(role) ? { role } : null,
    findAdminUidWhitelistRow: async () => null,
    resolveWorkspaceIdentity: async () => ({ identity: { admin: role === 'admin' } }), getWorkspaceDashboardSummary: async () => ({ vendor_pending: 2 }),
    buildLiffUrl: (_env,path) => path==='/welfare-shop-settings' ? 'https://liff.line.me/synthetic/welfare-shop-settings' : origin,
    buildVendorLineDashboardFlex: async (_db, _origin, vendor) => { dashboards.push(vendor.id); return card('營運 ' + vendor.name); },
    buildVendorPortalFlex: async (_env, _origin, vendor, item, uid) => { portals.push({ id: vendor.id, uid, eventUid: item.LINE_user_id }); return card('專區 ' + vendor.name); },
    findVisibleVendorByLineUserId: async () => null,
    buildVendorApplicationStatusForLine: async () => null,
    buildVendorPortalLoginFlex: async () => card('原有廠商登入'),
    replyLineMessages: async (_env, token, messages) => { replies.push({ token, messages }); return { ok: true, status: 200 }; },
    ...extra,
  };
  const helpers = ['getLineItemText', 'getLineItemWorkspaceInput', 'getLineItemUserId', 'getLineDashboardSubcommand', 'isLineDashboardCommandCandidate', 'isVendorLineOnboardingText'].map(name => extract(name)).join('\n');
  const functions = ['vendorBrandPlan', 'maybeHandleLineDashboardCommand', 'maybeHandleVendorLineOnboarding'].map(name => extract(name, true)).join('\n');
  const all = Function('deps', `const {${Object.keys(deps).join(',')}}=deps;${helpers};${functions};return {maybeHandleLineDashboardCommand,maybeHandleVendorLineOnboarding};`)(deps);
  const env = { LINE_CHANNEL_ACCESS_TOKEN: 'synthetic', DB: db };
  return { replies, dashboards, portals, run: ev => all.maybeHandleLineDashboardCommand(db, env, ev, origin), onboarding: ev => all.maybeHandleVendorLineOnboarding(db, env, ev, origin) };
}

test('actual dashboard dispatcher plus real access SQL chooses, remembers, scopes QR and refreshes authority', async t => {
  const db = setup(t), f = dispatcher(db), unchanged = db.raw.prepare('SELECT * FROM welfare_vendor_line_bindings').all();
  await f.run(entry()); assert.equal(f.replies.length, 1); assert.match(JSON.stringify(f.replies[0]), /共 7 個品牌/); assert.deepEqual(f.dashboards, []);
  await f.run(command('action=vendor.brand.select&vendor_id=brand-6&surface=dashboard'));
  assert.equal(f.replies.length, 2); assert.deepEqual(f.dashboards, ['brand-6']); assert.equal(db.writes.length, 1);
  assert.match(JSON.stringify(f.replies[1]), /action=vendor\.branch_qr\.list&page=0&vendor_id=brand-6/);
  assert.equal(db.raw.prepare('SELECT vendor_id FROM welfare_vendor_line_sessions').get().vendor_id, 'brand-6');
  await f.run(entry()); assert.deepEqual(f.dashboards, ['brand-6', 'brand-6']); assert.equal(db.writes.length, 1);
  await f.run(command('action=vendor.branch_qr.list&page=0&vendor_id=brand-6')); assert.match(JSON.stringify(f.replies[3]), /qr\.png\?location_id=branch-6/);
  await f.run(command('action=vendor.brand.home&vendor_id=brand-6&surface=dashboard')); assert.equal(f.dashboards.length, 3);
  db.raw.exec("UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='brand-6'");
  await f.run(command('action=vendor.brand.home&vendor_id=brand-6')); assert.equal(f.dashboards.length, 3); assert.doesNotMatch(JSON.stringify(f.replies.at(-1)), /營運 品牌 6/);
  assert.deepEqual(db.raw.prepare("SELECT * FROM welfare_vendor_line_bindings WHERE vendor_id<>'brand-6'").all(), unchanged.filter(row => row.vendor_id !== 'brand-6'));
  assert.deepEqual([...db.raw.prepare('SELECT * FROM welfare_redemptions').all()].map(row => ({ ...row })), [{ id: 'unchanged-history', amount: 100 }]);
});

test('actual workspace portal handles text/postback and passes selected UID to credential builder', async t => {
  const db = setup(t), f = dispatcher(db);
  await f.run(entry('廠商專區')); assert.match(JSON.stringify(f.replies[0]), /共 7 個品牌/); assert.equal(f.portals.length, 0);
  await f.run(command('action=vendor.brand.select&vendor_id=brand-2&surface=portal'));
  assert.deepEqual(f.portals, [{ id: 'brand-2', uid: UID, eventUid: UID }]);
  await f.run(command('廠商專區')); assert.deepEqual(f.portals[1], { id: 'brand-2', uid: UID, eventUid: UID });
  await f.onboarding(command('', { text: '查看店家頁' })); assert.deepEqual(f.portals[2], { id: 'brand-2', uid: UID, eventUid: UID });
  assert.equal(f.replies.length, 4); assert.equal(db.writes.length, 1);
});

test('actual admin/editor dashboards preserve original cards and only add switch to managed brands', async t => {
  const db = setup(t);
  for (const role of ['admin', 'activity_editor']) {
    const writesBefore = db.writes.length;
    const f = dispatcher(db, role), result = await f.run(entry()); assert.equal(f.replies.length, 1);
    assert.equal(result.role, role === 'admin' ? 'owner' : role); assert.match(JSON.stringify(f.replies[0]), /切換品牌/);
    assert.deepEqual(f.dashboards, []); assert.equal(db.writes.length, writesBefore);
    const prior = JSON.stringify(f.replies[0]);
    await f.run(command('action=vendor.brand.select&vendor_id=brand-3')); assert.deepEqual(f.dashboards, ['brand-3']);
    await f.run(entry()); assert.equal(JSON.stringify(f.replies.at(-1)), prior);
  }
});

test('welfare shop settings is an LIFF button for verified private admin dashboard requests', async t => {
  const db = setup(t, 1);
  const admin = dispatcher(db, 'admin');
  for(const keyword of ['儀表板','儀錶板','仪表板']){
    await admin.run(entry(keyword));
    const buttons=admin.replies.at(-1).messages[0].contents.footer.contents;
    assert.deepEqual(buttons.find(item=>item.action?.label==='福利品專區設定')?.action,{
      type:'uri',label:'福利品專區設定',uri:'https://liff.line.me/synthetic/welfare-shop-settings'
    });
  }
  for(const extra of [{sourceType:'group'},{sourceType:'room'},{activitySignatureVerified:false}]){
    await admin.run(entry('儀表板',extra));
    assert.doesNotMatch(JSON.stringify(admin.replies.at(-1)),/welfare-shop-settings/);
  }
  for(const role of ['activity_editor','none']){
    const other=dispatcher(db,role);
    await other.run(entry());
    assert.doesNotMatch(JSON.stringify(other.replies.at(-1)),/welfare-shop-settings/);
  }
});

test('actual shared-code only account retains QR dashboard and never receives management token', async t => {
  const db = setup(t, 1, false), f = dispatcher(db);
  await f.run(entry()); assert.match(JSON.stringify(f.replies[0]), /店家 QR 碼/); assert.deepEqual(f.dashboards, []);
  await f.run(command('action=vendor.brand.select&vendor_id=brand-1&surface=portal'));
  assert.equal(f.portals.length, 0); assert.equal(db.writes.length, 0); assert.match(JSON.stringify(f.replies[1]), /沒有可管理的品牌/);
  await f.run(command('action=vendor.branch_qr.list&page=0')); assert.match(JSON.stringify(f.replies[2]), /qr\.png/);
});

test('actual explicit unverified and cross-brand commands are owned without legacy authority fallback', async t => {
  const db = setup(t), f = dispatcher(db, 'admin');
  for (const change of [{ activitySignatureVerified: false }, { sourceType: 'group' }, { sourceType: 'room' }]) {
    const result = await f.run(command('action=vendor.brand.list', change)); assert.equal(result.role, 'none'); assert.equal(f.replies.length, 0);
  }
  await f.run(command('action=vendor.brand.select&vendor_id=foreign&surface=portal'));
  assert.equal(f.replies.length, 1); assert.equal(f.portals.length, 0); assert.equal(f.dashboards.length, 0); assert.equal(db.writes.length, 0);
});

test('actual child dispatcher claims one token for brand selection and never falls through after uncertain reply', async t => {
  const db = setup(t), f = dispatcher(db), logs = []; let attempts = 0;
  const deps = { redactVendorBindingPayload: value => value, lifeInfoStationItemLanguage: () => '', isWelfareShopCommand: () => false, isVendorBindingCommand: () => false, isMotherOnlyLineKeyword: () => false,
    isVendorBranchQrChatCandidate, isVendorBrandChatCandidate, getPublicOrigin: () => origin, buildFastLineEvent: ev => ({ ...ev, activitySignatureVerified: false }),
    storeLineWebhookEvent: async () => logs.push('event'), storeLineThreadMessage: async () => logs.push('thread'),
    maybeHandleLineDashboardCommand: async (_db, _env, ev) => { attempts++; await f.run(ev); throw Error('provider accepted, acknowledgement lost'); },
    maybeHandleRichMenuChat: async () => { throw Error('brand must not fall through'); },
  };
  const run = Function('deps', `const {${Object.keys(deps).join(',')}}=deps;return (${extract('processLineChildPayload', true)});`)(deps);
  const ev = command('action=vendor.brand.select&vendor_id=brand-5');
  await run(JSON.stringify({ events: [ev, ev] }), { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic' }, { signatureVerified: true, origin });
  assert.equal(attempts, 1); assert.equal(f.replies.length, 1); assert.equal(db.writes.length, 1); assert.equal(logs.length, 4);
});

test('editor workspace keyword replies once only for a verified private editor', async t => {
 const db=setup(t), editor=dispatcher(db,'activity_editor');
 const result=await editor.run(entry('小編工作區'));assert.equal(result.role,'activity_editor');assert.equal(editor.replies.length,1);assert.match(JSON.stringify(editor.replies[0]),/開啟我的工作區/);
 for(const change of [{activitySignatureVerified:false},{sourceType:'group'},{eventType:'postback'}]){assert.equal(await editor.run(entry('小編工作區',change)),null);}
 assert.equal(editor.replies.length,1);const other=dispatcher(db,'none');assert.equal(await other.run(entry('小編工作區')),null);assert.equal(other.replies.length,0);assert.equal(db.writes.length,0);
});

test('verified administrator receives the workspace card but unauthorized people do not',async t=>{const db=setup(t),admin=dispatcher(db,'admin');const result=await admin.run(entry('小編工作區'));assert.equal(result.role,'admin');assert.equal(admin.replies.length,1);assert.match(JSON.stringify(admin.replies[0]),/開啟我的工作區/);assert.equal(await admin.run(entry('小編工作區',{activitySignatureVerified:false})),null);assert.equal(admin.replies.length,1);assert.equal(db.writes.length,0);});
