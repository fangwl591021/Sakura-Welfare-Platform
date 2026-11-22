import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readManageableVendorBrand, readSelectedManagedVendor } from '../src/vendor-brand-access.js';

const UID = 'U' + '1'.repeat(32), OTHER = 'U' + '2'.repeat(32);
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'actual index function boundaries must exist');
  return source.slice(from, to);
}
const portalSource = extract('async function hmacSha256Hex(', 'const VENDOR_PORTAL_COOKIE');
const editSource = extract('async function canEditVendorStorefront(', 'function sanitizeVendorRichText(');
const lookupSource = extract('async function findVisibleVendorByLineUserId(', 'function isLikelyLineUserId(');
function setup(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  for (const name of ['0008_sakura_welfare_core.sql', '0010_welfare_operations.sql', '0019_vendor_line_onboarding.sql', '0046_vendor_line_bindings.sql', '0048_vendor_brand_management.sql']) {
    sql.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  sql.exec(`ALTER TABLE welfare_vendors ADD COLUMN submitted_by_line_user_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN is_hidden INTEGER DEFAULT 0;
    ALTER TABLE welfare_vendors ADD COLUMN contract_end TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN contract_terminated_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN tax_id TEXT NOT NULL DEFAULT '';`);
  const insert = sql.prepare("INSERT INTO welfare_vendors(id,name,status,vendor_portal_username,vendor_portal_password)VALUES(?,?,'approved',?,'fixture-secret')");
  for (const id of ['a', 'b', 'qr', 'legacy', 'pending']) insert.run(id, 'Fixture ' + id, id === 'b' ? '' : 'login-' + id);
  sql.exec("UPDATE welfare_vendors SET status='pending' WHERE id='pending'");
  const f = { sql, reads: [], writes: [], sessionRepairs: [] };
  const wrap = (query, args = []) => ({
    bind(...next) { return wrap(query, next); },
    async first() { f.reads.push(query); return sql.prepare(query).get(...args) || null; },
    async all() { f.reads.push(query); return { success: true, results: sql.prepare(query).all(...args) }; },
    async run() { f.writes.push(query); return { success: true, meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
  });
  f.db = { prepare: query => wrap(query) };
  f.env = { DB: f.db, VENDOR_PORTAL_SECRET: 'isolated-portal-test-secret' };
  f.bind = (id, management = 1, status = 'active', uid = UID) => sql.prepare("INSERT INTO welfare_vendor_line_bindings(vendor_id,line_user_id,status,source,management_enabled,created_at,updated_at)VALUES(?,?,?,'shared_code',?,'fixture-created','fixture-updated')").run(id, uid, status, management);
  f.select = (id, uid = UID) => sql.prepare('INSERT INTO welfare_vendor_line_sessions(line_user_id,vendor_id)VALUES(?,?) ON CONFLICT(line_user_id) DO UPDATE SET vendor_id=excluded.vendor_id').run(uid, id);
  const sandbox = {
    crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob,
    readManageableVendorBrand, readSelectedManagedVendor,
    upsertVendorLineSession: async (_db, uid, id) => { f.sessionRepairs.push({ uid, id }); f.select(id, uid); },
  };
  f.api = vm.runInNewContext(portalSource + editSource + lookupSource + '\n({createVendorPortalToken,verifyVendorPortalToken,canEditVendorStorefront,findVisibleVendorByLineUserId,hmacSha256Hex,base64UrlEncodeText})', sandbox);
  f.token = (id = 'a', uid = UID) => f.api.createVendorPortalToken(f.env, id, id === 'b' ? '' : 'login-' + id, uid);
  f.verify = token => f.api.verifyVendorPortalToken(f.env, token);
  f.sign = async payload => {
    const body = f.api.base64UrlEncodeText(JSON.stringify(payload));
    return body + '.' + await f.api.hmacSha256Hex(f.env.VENDOR_PORTAL_SECRET, body);
  };
  return f;
}

test('actual portal token scopes brand and verified LINE identity; passwordless managed brand works', async t => {
  const f = setup(t); f.bind('a'); f.bind('b');
  for (const id of ['a', 'b']) {
    const token = await f.token(id), payload = await f.verify(token);
    assert.equal(payload.vendor_id, id); assert.equal(payload.management_line_user_id, UID);
    assert.equal(await f.api.canEditVendorStorefront(f.db, f.env, id, '', '', token), true);
  }
  assert.equal(f.writes.length, 0); assert.equal(f.sessionRepairs.length, 0);
});

test('malformed identities, signed invalid identities, expired and tampered managed tokens fail closed', async t => {
  const f = setup(t); f.bind('a');
  for (const uid of ['not-a-line-id', 'U123', UID + ' ', 'U' + 'z'.repeat(32)]) assert.equal(await f.token('a', uid), '');
  const token = await f.token(), [body, signature] = token.split('.');
  assert.equal(await f.verify(body + '.' + (signature[0] === '0' ? '1' : '0') + signature.slice(1)), null);
  assert.equal(await f.api.verifyVendorPortalToken({ ...f.env, VENDOR_PORTAL_SECRET: 'wrong' }, token), null);
  const valid = { vendor_id: 'a', username: 'login-a', management_line_user_id: UID, exp: Math.floor(Date.now() / 1000) + 600 };
  assert.equal(await f.verify(await f.sign({ ...valid, management_line_user_id: 'invalid' })), null);
  assert.equal(await f.verify(await f.sign({ ...valid, exp: Math.floor(Date.now() / 1000) - 60 })), null);
  assert.equal(await f.verify(await f.sign({ ...valid, management_line_user_id: OTHER })), null);
  const changedBody = f.api.base64UrlEncodeText(JSON.stringify({ ...valid, vendor_id: 'b' }));
  assert.equal(await f.verify(changedBody + '.' + signature), null);
});

test('existing managed token rechecks revocation, management grant, visibility and contract at every use', async t => {
  for (const [name, change] of [
    ['revoked', "UPDATE welfare_vendor_line_bindings SET status='revoked' WHERE vendor_id='a'"],
    ['grant removed', "UPDATE welfare_vendor_line_bindings SET management_enabled=0 WHERE vendor_id='a'"],
    ['hidden', "UPDATE welfare_vendors SET is_hidden=1 WHERE id='a'"],
    ['suspended', "UPDATE welfare_vendors SET status='suspended' WHERE id='a'"],
    ['pending', "UPDATE welfare_vendors SET status='pending' WHERE id='a'"],
    ['expired', "UPDATE welfare_vendors SET contract_end='2000-01-01' WHERE id='a'"],
    ['terminated', "UPDATE welfare_vendors SET contract_terminated_at='2020-01-01' WHERE id='a'"],
  ]) await t.test(name, async child => {
    const f = setup(child); f.bind('a'); f.bind('b'); const a = await f.token(), b = await f.token('b');
    assert.ok(await f.verify(a)); f.sql.exec(change);
    assert.equal(await f.verify(a), null); assert.ok(await f.verify(b), 'other brand remains authorized');
    assert.equal(await f.api.canEditVendorStorefront(f.db, f.env, 'a', UID, 'ignored', a), false);
  });
});

test('shared-code QR-only binding never becomes portal authority and data lookup errors deny managed token', async t => {
  const f = setup(t); f.bind('qr', 0); f.select('qr');
  assert.equal(await f.verify(await f.token('qr')), null);
  f.bind('a'); const token = await f.token();
  assert.equal(await f.api.verifyVendorPortalToken({ ...f.env, DB: { prepare() { throw new Error('fixture unavailable'); } } }, token), null);
});

test('portal editing rejects foreign brand, missing token and changed brand login name', async t => {
  const f = setup(t); f.bind('a'); f.bind('b'); const token = await f.token();
  assert.equal(await f.api.canEditVendorStorefront(f.db, f.env, 'b', UID, '', token), false);
  assert.equal(await f.api.canEditVendorStorefront(f.db, f.env, 'a', UID, 'an-application-signature', ''), false);
  f.sql.exec("UPDATE welfare_vendors SET vendor_portal_username='replacement-login' WHERE id='a'");
  assert.equal(await f.verify(token), null);
});

test('legacy username portal token remains independent of new management bindings', async t => {
  const f = setup(t); f.bind('a', 0, 'revoked');
  const token = await f.api.createVendorPortalToken(f.env, 'a', 'login-a');
  const payload = await f.verify(token);
  assert.equal(payload.vendor_id, 'a'); assert.equal(payload.management_line_user_id, undefined);
  assert.equal(f.reads.length, 0, 'legacy signature verification must not require management migration');
  assert.equal(await f.api.canEditVendorStorefront(f.db, f.env, 'a', '', '', token), true);
  assert.equal(await f.api.canEditVendorStorefront(f.db, f.env, 'b', '', '', token), false);
  assert.equal(await f.api.createVendorPortalToken(f.env, 'a', ''), '');
});

test('unsigned legacy lookup cannot use new management selection; verified chat selection can', async t => {
  const f = setup(t); f.bind('a'); f.select('a');
  assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID), null);
  assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID, { managementVerified: false }), null);
  assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID, { managementVerified: 'true' }), null);
  assert.equal((await f.api.findVisibleVendorByLineUserId(f.db, UID, { managementVerified: true })).id, 'a');
  assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, OTHER, { managementVerified: true }), null);
  assert.equal(f.sessionRepairs.length, 0);
});

test('revoked or QR-only selection cannot fall through into legacy empty-owner session authority', async t => {
  for (const [name, management, status] of [['QR only', 0, 'active'], ['revoked management', 1, 'revoked'], ['revoked QR', 0, 'revoked']]) await t.test(name, async child => {
    const f = setup(child); f.bind('a', management, status); f.select('a');
    assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID), null);
    assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID, { managementVerified: true }), null);
    assert.equal(f.sessionRepairs.length, 0);
  });
});

test('old unbound session and pending direct application continue working; explicit revoked direct association denies', async t => {
  const f = setup(t); f.select('legacy');
  assert.equal((await f.api.findVisibleVendorByLineUserId(f.db, UID)).id, 'legacy');
  f.sql.prepare("UPDATE welfare_vendors SET submitted_by_line_user_id=? WHERE id='pending'").run(UID);
  assert.equal((await f.api.findVisibleVendorByLineUserId(f.db, UID)).id, 'pending');
  assert.equal(f.sessionRepairs.length, 1);
  f.bind('pending', 0, 'revoked');
  assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID), null);
  assert.equal(await f.api.findVisibleVendorByLineUserId(f.db, UID, { managementVerified: true }), null);
});
