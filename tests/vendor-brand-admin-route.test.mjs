import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { requestEnvironment, requestWork } from '../src/request-work.js';
import { guardAdminRequest } from '../src/editor-access.js';
import { decorateAdministrativeResponse } from '../src/editor-ui.js';
import { handleVendorBenefitAccess } from '../src/vendor-benefit-access.js';
import { authorizeVendorSupplementAdmin } from '../src/vendor-supplement-service.js';
import { searchVendorBrandManagementUsers, readVendorBrandManagementOptions, previewVendorBrandManagement, confirmVendorBrandManagement, getVendorBrandManagementOperation } from '../src/vendor-brand-access.js';

const UID = 'U' + '1'.repeat(32), OTHER = 'U' + '2'.repeat(32), origin = 'https://brand-admin.test';
const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const workerSource = source.slice(source.indexOf('const welfareWorker = {'), source.indexOf('export default welfareWorker;'));
function extract(name, async = false) { const code = source.match(new RegExp(`${async ? 'async ' : ''}function ${name}\\([^]*?\\n\\}`))?.[0]; assert.ok(code, name); return code; }
const migration = name => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
function setup(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  for (const name of ['0008_sakura_welfare_core.sql', '0010_welfare_operations.sql', '0005_line_user_profiles.sql', '0019_vendor_line_onboarding.sql', '0046_vendor_line_bindings.sql']) sql.exec(migration(name));
  sql.exec(`ALTER TABLE welfare_vendors ADD COLUMN submitted_by_line_user_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN is_hidden INTEGER DEFAULT 0;
    ALTER TABLE welfare_vendors ADD COLUMN contract_end TEXT NOT NULL DEFAULT '';
    ALTER TABLE welfare_vendors ADD COLUMN contract_terminated_at TEXT NOT NULL DEFAULT '';`);
  sql.exec(migration('0048_vendor_brand_management.sql'));
  for (const id of ['a', 'b']) sql.prepare("INSERT INTO welfare_vendors(id,name,status,vendor_portal_password,updated_at) VALUES(?,?,'approved','SECRET_PASSWORD','original')").run(id, '品牌 ' + id);
  sql.prepare("INSERT INTO line_user_profiles(line_user_id,display_name,updated_at) VALUES(?,'窗口名稱','original')").run(UID);
  const f = { sql, reads: [], writes: [], unavailable: false, authCalls: [], principals: {
    admin: { id: 'verified-admin-id', role: 'admin', business_units: 'vendors' },
    global: { id: 'global-admin-id', role: 'admin', business_units: '*' },
    wrongscope: { id: 'wrongscope-admin-id', role: 'admin', business_units: 'activities' },
    nonadmin: { id: 'viewer-id', role: 'viewer', business_units: '*' },
    editor: { id: 'editor-id', role: 'activity_editor', business_units: 'activities' },
  } };
  const wrap = (query, args = []) => ({ query, args, bind(...values) { return wrap(query, values); },
    async first() { if (f.unavailable) throw Error('PRIVATE DATABASE ERROR'); f.reads.push(query); return sql.prepare(query).get(...args) || null; },
    async all() { if (f.unavailable) throw Error('PRIVATE DATABASE ERROR'); f.reads.push(query); return { success: true, results: sql.prepare(query).all(...args) }; },
    async run() { throw Error('Admin grant must use its atomic batch'); },
  });
  f.db = { prepare: query => wrap(query), async batch(statements) {
    if (f.unavailable) throw Error('PRIVATE DATABASE ERROR');
    sql.exec('BEGIN');
    try { const result = statements.map(statement => { assert.match(statement.query.trim(), /^INSERT INTO welfare_(audit_events|vendor_line_bindings)\b/); f.writes.push(statement.query); const applied = sql.prepare(statement.query).run(...statement.args); return { success: true, meta: { changes: Number(applied.changes) } }; }); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  const deps = { requestEnvironment, requestWork, guardAdminRequest, decorateAdministrativeResponse, handleVendorBenefitAccess, authorizeVendorSupplementAdmin,
    searchVendorBrandManagementUsers, readVendorBrandManagementOptions, previewVendorBrandManagement, confirmVendorBrandManagement, getVendorBrandManagementOperation,
    requireAdmin: async ({ sessionToken }) => { f.authCalls.push(sessionToken); return f.principals[sessionToken] ? { ok: true, user: f.principals[sessionToken] } : { ok: false }; },
    verifyActivityLineIdentity: async () => { throw Error('No real LINE identity request allowed'); }, verifyVendorPortalToken: async () => null,
    readVendorPortalCookie: () => '', isValidVendorApplySignature: async () => false, getLiffId: () => 'synthetic-liff',
    // Unrelated route handlers return no match. The real fetch routing, both
    // admin guards and brand service functions remain under test.
    handleActivityTutorialMedia: async () => null, handleActivityStoryRequest: async () => null, handleClubRequest: async () => null,
    handleActivityQrCheckin: async () => null, handleActivityFormRequest: async () => null, maybeHandleWorkspaceApiRequest: async () => null,
    extractLineUserIdFromQr: () => '', findAdminUidWhitelistRowReadOnly: async () => null, resolveFeaturedPartnerStoreLocale: () => '',
    callOpenAiJson: () => { throw Error('No AI request allowed'); }, callOpenAiJsonContent: () => { throw Error('No AI request allowed'); },
    loginAdmin: () => { throw Error('No login request expected'); }, ensureActivityCheckinTables: () => { throw Error('No schema writes allowed'); }, normalizeActivityDateInput: () => '',
  };
  const helpers = ['corsHeaders', 'corsResponse', 'corsJson'].map(name => extract(name)).join('\n') + '\n' + ['handleVendorBrandAdminRead', 'handleVendorManagementAction'].map(name => extract(name, true)).join('\n');
  f.worker = Function('deps', `const {${Object.keys(deps).join(',')}}=deps;${helpers};${workerSource};return welfareWorker;`)(deps);
  f.request = async ({ action = 'vendor.brands.options', method = 'GET', token = 'admin', data = {}, query = {}, headers = {}, body } = {}) => {
    const url = new URL('/admin-api/vendor-management', origin); if (method === 'GET') { url.searchParams.set('action', action); for (const [key, value] of Object.entries({ lineUserId: UID, ...query })) url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value); }
    const requestHeaders = { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers };
    const init = { method, headers: requestHeaders };
    if (method === 'POST') { init.headers['Content-Type'] = 'application/json'; init.body = body === undefined ? JSON.stringify({ action, data }) : body; }
    const response = await f.worker.fetch(new Request(url, init), { DB: f.db }, { waitUntil() { throw Error('No background work expected'); } });
    return { response, json: await response.json() };
  };
  f.preview = async () => (await f.request({ method: 'POST', action: 'vendor.brands.preview', data: { lineUserId: UID, vendorIds: ['a', 'b'] } })).json.data;
  return f;
}

test('actual worker.fetch search/options/preview are authenticated no-store and read only', async t => {
  const f = setup(t);
  const search = await f.request({ action: 'vendor.brands.search', query: { query: '窗口' } });
  assert.equal(search.response.status, 200); assert.deepEqual(search.json.data.users, [{ lineUserId: UID, lineDisplayName: '窗口名稱' }]);
  const options = await f.request(); assert.equal(options.response.status, 200); assert.equal(options.json.data.brands.length, 2);
  const preview = await f.preview(); assert.equal(preview.lineUserId, UID); assert.deepEqual(preview.vendorIds, ['a', 'b']);
  assert.equal(f.writes.length, 0); assert.doesNotMatch(JSON.stringify(options.json), /SECRET_PASSWORD/);
  for (const response of [search.response, options.response]) assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('all new read/write routes reject absent bearer, unknown session, nonadmin, editor and missing vendor scope', async t => {
  const f = setup(t);
  for (const token of ['', 'missing', 'nonadmin', 'editor', 'wrongscope']) {
    for (const action of ['vendor.brands.search', 'vendor.brands.options', 'vendor.brands.status', 'vendor.brands.preview', 'vendor.brands.confirm']) {
      const method = /preview|confirm/.test(action) ? 'POST' : 'GET';
      const result = await f.request({ action, method, token, data: { lineUserId: UID, vendorIds: ['a'], actor: { type: 'admin', id: 'forged' }, sessionToken: 'admin' } });
      assert.equal(result.response.status, 403, token + ' ' + action); assert.equal(result.json.success, false);
    }
  }
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
});

test('actual worker rejects cross-origin and cross-site reads/writes before accessing records', async t => {
  const f = setup(t);
  for (const headers of [{ Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    for (const method of ['GET', 'POST']) {
      const result = await f.request({ method, action: method === 'GET' ? 'vendor.brands.options' : 'vendor.brands.preview', headers, data: { lineUserId: UID, vendorIds: ['a'] } });
      assert.equal(result.response.status, 403);
    }
  }
  assert.equal(f.authCalls.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
});

test('confirm ignores forged actor, retains authenticated admin audit, and retry/status never duplicate grant', async t => {
  const f = setup(t), preview = await f.preview();
  const result = await f.request({ method: 'POST', action: 'vendor.brands.confirm', data: { ...preview, confirmed: true, actor: { type: 'admin', id: 'FORGED_ACTOR' }, actor_id: 'FORGED_ACTOR' } });
  assert.equal(result.response.status, 200); assert.equal(result.json.success, true); assert.equal(result.json.data.appliedCount, 2);
  const audit = f.sql.prepare('SELECT actor_id,raw_json FROM welfare_audit_events').get(); assert.equal(audit.actor_id, 'verified-admin-id'); assert.doesNotMatch(audit.raw_json, /FORGED_ACTOR/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_vendor_line_bindings').get().n, 2);
  const writes = f.writes.length;
  const repeat = await f.request({ method: 'POST', action: 'vendor.brands.confirm', data: { ...preview, confirmed: true } }); assert.equal(repeat.response.status, 200); assert.equal(repeat.json.data.duplicated, true);
  const status = await f.request({ action: 'vendor.brands.status', query: { operationId: preview.operationId, vendorIds: preview.vendorIds, revision: preview.revision } });
  assert.equal(status.response.status, 200); assert.equal(status.json.data.appliedCount, 2); assert.equal(f.writes.length, writes);
  const changed = await f.request({ action: 'vendor.brands.status', query: { lineUserId: OTHER, operationId: preview.operationId, vendorIds: preview.vendorIds, revision: preview.revision } });
  assert.equal(changed.response.status, 409); assert.equal(changed.json.success, false);
});

test('stale preview reaches HTTP 409 without writes and fresh request rejects revoked admin session', async t => {
  const f = setup(t), preview = await f.preview();
  f.sql.exec("UPDATE welfare_vendors SET updated_at='changed' WHERE id='b'");
  const stale = await f.request({ method: 'POST', action: 'vendor.brands.confirm', data: { ...preview, confirmed: true } });
  assert.equal(stale.response.status, 409); assert.equal(stale.json.code, 'preview_changed'); assert.equal(f.writes.length, 0);
  const newPreview = await f.preview(); delete f.principals.admin;
  const revoked = await f.request({ method: 'POST', action: 'vendor.brands.confirm', data: { ...newPreview, confirmed: true } });
  assert.equal(revoked.response.status, 403); assert.equal(f.writes.length, 0);
});

test('new API unavailable returns safe HTTP 503 without schema initialization or private error disclosure', async t => {
  const f = setup(t), preview = await f.preview(); f.unavailable = true;
  for (const action of ['vendor.brands.search', 'vendor.brands.options', 'vendor.brands.status', 'vendor.brands.preview', 'vendor.brands.confirm']) {
    const method = /preview|confirm/.test(action) ? 'POST' : 'GET';
    const result = await f.request({ action, method, query: { query: '窗口', operationId: preview.operationId, vendorIds: preview.vendorIds, revision: preview.revision }, data: { ...preview, confirmed: true } });
    assert.equal(result.response.status, 503, action); assert.equal(result.json.success, false); assert.doesNotMatch(JSON.stringify(result.json), /PRIVATE DATABASE ERROR|SECRET_PASSWORD/);
  }
  assert.equal(f.writes.length, 0);
});
