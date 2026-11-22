import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildVendorQrChatPlan, vendorQrListButton } from '../src/vendor-branch-qr-chat.js';

const UID = 'U' + '1'.repeat(32), origin = 'https://qr.example.test';
const event = command => ({ eventType: 'postback', sourceType: 'user', LINE_user_id: UID, replyToken: 'synthetic', activitySignatureVerified: true, postbackData: 'action=vendor.branch_qr.' + command });
function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contact_line_user_id TEXT,submitted_by_line_user_id TEXT,contract_end TEXT,contract_terminated_at TEXT);
    CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id));
    CREATE TABLE welfare_vendor_locations(id TEXT PRIMARY KEY,vendor_id TEXT,branch_name TEXT,address TEXT,status TEXT);
    INSERT INTO welfare_vendors VALUES('a','品牌 A','approved',0,'','','',''),('b','品牌 B','approved',0,'','','',''),('foreign','其他品牌','approved',0,'','','','');`);
  for (const id of ['a', 'b']) raw.prepare('INSERT INTO welfare_vendor_line_bindings VALUES(?,?,?)').run(id, UID, 'active');
  for (let n = 0; n < 6; n++) raw.prepare('INSERT INTO welfare_vendor_locations VALUES(?,?,?,?,?)').run('a-' + n, 'a', 'A分店' + n, 'A地址', 'active');
  raw.prepare('INSERT INTO welfare_vendor_locations VALUES(?,?,?,?,?)').run('b-1', 'b', 'B唯一分店', 'B地址', 'active');
  raw.prepare('INSERT INTO welfare_vendor_locations VALUES(?,?,?,?,?)').run('foreign-1', 'foreign', '機密分店', '機密地址', 'active');
  const wrap = (sql, args = []) => ({ bind(...values) { return wrap(sql, values); }, async first() { return raw.prepare(sql).get(...args) || null; }, async all() { return { success: true, results: raw.prepare(sql).all(...args) }; } });
  return { raw, prepare(sql) { assert.match(sql.trim(), /^SELECT\b/i); return wrap(sql); } };
}
const plan = (db, command) => buildVendorQrChatPlan({ db, item: event(command), origin });
const json = result => JSON.stringify(result.messages);

test('brand-scoped QR list retains scope through pagination and lets caller return to all associated branches', async () => {
  const db = setup();
  try {
    const first = await plan(db, 'list&page=0&vendor_id=a'); assert.equal(first.authorized, true); assert.match(json(first), /共 6 個分店/);
    assert.doesNotMatch(json(first), /B唯一分店|機密/); assert.match(json(first), /vendor\.branch_qr\.list&page=1&vendor_id=a/);
    assert.match(json(first), /vendor\.branch_qr\.show&location_id=a-0&page=0&vendor_id=a/);
    assert.match(json(first), /全部店家 QR/); assert.match(json(first), /vendor\.brand\.home&surface=dashboard&vendor_id=a/);
    const next = await plan(db, 'list&page=1&vendor_id=a'); assert.match(json(next), /第 2 \/ 2 頁/); assert.match(json(next), /a-5/); assert.doesNotMatch(json(next), /B唯一分店/);
    const all = await plan(db, 'list&page=0'); assert.match(json(all), /共 7 個分店/);
    assert.match(json(await plan(db, 'list&page=1')), /B唯一分店/);
    assert.equal(vendorQrListButton().action.data, 'action=vendor.branch_qr.list&page=0');
  } finally { db.raw.close(); }
});

test('single-branch scoped QR shows that exact brand and scoped return controls only after fresh ownership check', async () => {
  const db = setup();
  try {
    const one = await plan(db, 'list&page=0&vendor_id=b'); assert.equal(one.authorized, true);
    assert.match(json(one), /qr\.png\?location_id=b-1/); assert.match(json(one), /B唯一分店/);
    assert.match(json(one), /vendor\.branch_qr\.list&page=0&vendor_id=b/); assert.match(json(one), /vendor\.brand\.home&surface=dashboard&vendor_id=b/);
    assert.doesNotMatch(json(one), /portal_token|line_user_id|employee_no/);
    db.raw.exec("UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='b'");
    const revoked = await plan(db, 'show&location_id=b-1&vendor_id=b'); assert.equal(revoked.authorized, false); assert.doesNotMatch(json(revoked), /qr\.png/);
  } finally { db.raw.close(); }
});

test('cannot swap a scoped request to another associated or unassociated brand branch', async () => {
  const db = setup();
  try {
    for (const command of ['show&location_id=b-1&vendor_id=a', 'show&location_id=foreign-1&vendor_id=a', 'list&vendor_id=foreign', 'list&vendor_id=a&vendor_id=b']) {
      const result = await plan(db, command); assert.equal(result.authorized, false, command); assert.doesNotMatch(json(result), /qr\.png|機密地址|B地址/);
    }
    const oldUnscoped = await plan(db, 'show&location_id=b-1'); assert.equal(oldUnscoped.authorized, true);
    assert.match(json(oldUnscoped), /vendor\.branch_qr\.home/); assert.doesNotMatch(json(oldUnscoped), /vendor\.brand\.home/);
  } finally { db.raw.close(); }
});
