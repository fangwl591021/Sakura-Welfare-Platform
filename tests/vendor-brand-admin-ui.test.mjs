import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createVendorBrandAdminController, decorateVendorBrandAdminHtml, vendorBrandAdminScrollTarget, vendorBrandAdminCatalog } from '../src/vendor-brand-admin-ui.js';
import { isVendorPublicEligible } from '../src/vendor-contract-policy.js';

const uid = n => 'U' + String(n).repeat(32);
const users = [{ lineUserId: uid(1), lineDisplayName: '同名窗口 <img onerror=alert(1)>' }, { lineUserId: uid(2), lineDisplayName: '同名窗口 <img onerror=alert(1)>' }];
const brands = Array.from({ length: 12 }, (_, i) => ({ id: 'brand-' + i, name: '品牌 ' + i, status: 'approved', bindingStatus: i === 1 ? 'revoked' : i === 0 ? 'active' : 'none', managementEnabled: i === 0, direct: false, canManage: i === 0 }));
const operationId = 'd3c927e9-ae6f-4bed-a90e-39a58baa1878';
const revision = 'a'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(overrides = {}, restored = null) {
  const calls = [], persisted = [];
  const controller = createVendorBrandAdminController({
    restored, persist: value => persisted.push(clone(value)),
    api: async (action, data) => {
      calls.push({ action, data: clone(data) });
      if (overrides[action]) return overrides[action](data);
      if (action === 'catalog') return brands.map(({ id, name, status }) => ({ id, name, status }));
      if (action === 'search') return { users, truncated: false };
      if (action === 'options') return { ...users.find(user => user.lineUserId === data.lineUserId), brands: clone(brands) };
      if (action === 'preview') return { ...users.find(user => user.lineUserId === data.lineUserId), ...data, operationId, revision, brands: brands.filter(brand => data.vendorIds.includes(brand.id)).map(brand => ({ ...brand, action: brand.bindingStatus === 'revoked' ? 'restore' : brand.canManage ? 'unchanged' : 'add' })) };
      if (action === 'confirm') return { operationId: data.operationId, revision: data.revision, lineUserId: data.lineUserId, lineDisplayName: users[1].lineDisplayName, vendorIds: data.vendorIds, appliedCount: data.vendorIds.length, duplicated: false };
      if (action === 'status') return null;
      throw new Error('Unexpected action ' + action);
    },
  });
  return { controller, calls, persisted };
}
async function select(f) { await f.controller.search('同名窗口'); await f.controller.selectUser(uid(2)); }
async function preview(f, ids = ['brand-1', 'brand-8']) { await select(f); for (const id of ids) f.controller.toggle(id, true); await f.controller.preview(); }

test('decorator is idempotent, preserves host HTML, and emits a syntactically valid scoped script', () => {
  const original = '<!doctype html><html><head><title>原頁面</title></head><body><section id="view">原廠商功能</section></body></html>';
  const html = decorateVendorBrandAdminHtml(original);
  assert.equal(decorateVendorBrandAdminHtml(html), html);
  assert.ok(html.endsWith('</head><body><section id="view">原廠商功能</section></body></html>'));
  assert.equal(decorateVendorBrandAdminHtml(null), null);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1); new vm.Script(scripts[0][1]);
  assert.match(html, /多品牌 LINE 管理/); assert.match(html, /確認綁定並授權管理/);
  for (const label of ['1 選擇管理人', '2 勾選品牌', '3 預覽確認', '選這位管理人']) assert.ok(html.includes(label));
  assert.match(html, /取消／關閉/); assert.match(html, /20[0]{3}/);
  assert.match(html, /credentials: 'same-origin'/);
  assert.doesNotMatch(scripts[0][1], /\.innerHTML\s*=/);
  assert.match(html, /@media\(max-width:520px\)/);
});

test('same-name users require an exact cached UID choice and options are read only', async () => {
  const f = fixture(); await f.controller.search('同名窗口');
  await f.controller.selectUser('同名窗口');
  assert.deepEqual(f.calls.map(call => call.action), ['search']);
  await f.controller.selectUser(uid(2));
  assert.deepEqual(f.calls[1], { action: 'options', data: { lineUserId: uid(2) } });
  assert.equal(f.controller.snapshot().user.lineUserId, uid(2));
  assert.equal(f.controller.snapshot().user.lineDisplayName, users[1].lineDisplayName);
  assert.equal(f.controller.snapshot().brands.length, 12);
  assert.deepEqual(f.persisted, []);
});

test('missing cached user cannot be guessed or bound by entering a name', async () => {
  const f = fixture({ search: async () => ({ users: [], truncated: false }) });
  await f.controller.search('尚未加入者'); await f.controller.selectUser(uid(2));
  await f.controller.preview(); await f.controller.confirm(true);
  assert.deepEqual(f.calls.map(call => call.action), ['search']);
  assert.equal(f.controller.snapshot().user, null);
  await f.controller.search('尚未加入者'); assert.match(f.controller.snapshot().message, /先加入.*傳送一則訊息/);
});

test('brand selection exceeds six, deselection stays removed, and unrelated existing links are absent from payload', async () => {
  const f = fixture(); await select(f);
  for (const brand of brands) f.controller.toggle(brand.id, true);
  f.controller.toggle('brand-0', false); f.controller.toggle('brand-5', false);
  await f.controller.preview();
  const state = f.controller.snapshot();
  assert.equal(state.preview.vendorIds.length, 10);
  assert.ok(!state.preview.vendorIds.includes('brand-0')); assert.ok(!state.preview.vendorIds.includes('brand-5'));
  assert.equal(state.brands[0].bindingStatus, 'active');
  assert.equal(state.preview.brands.find(brand => brand.id === 'brand-1').action, 'restore');
  assert.deepEqual(f.calls.map(call => call.action), ['search', 'options', 'preview']);
  assert.deepEqual(f.persisted, []);
});

test('preview requires explicit acknowledgement and returning to edit creates no authorization', async () => {
  const f = fixture(); await preview(f);
  await f.controller.confirm(false); await f.controller.confirm();
  assert.equal(f.calls.filter(call => call.action === 'confirm').length, 0);
  f.controller.edit(); await f.controller.confirm(true);
  assert.equal(f.controller.snapshot().stage, 'select');
  assert.deepEqual(f.controller.snapshot().selectedIds, ['brand-1', 'brand-8']);
  assert.equal(f.calls.filter(call => call.action === 'confirm').length, 0);
  assert.deepEqual(f.persisted, []);
});

test('confirmed payload is the exact preview snapshot, is saved before send, and repeated clicks do not submit again', async () => {
  const f = fixture(); await preview(f); await f.controller.confirm(true); await f.controller.confirm(true);
  const expected = { lineUserId: uid(2), vendorIds: ['brand-1', 'brand-8'], operationId, revision, confirmed: true };
  assert.deepEqual(f.calls.find(call => call.action === 'confirm').data, expected);
  assert.deepEqual(f.persisted, [expected, null]);
  assert.equal(f.calls.filter(call => call.action === 'confirm').length, 1);
  assert.equal(f.controller.snapshot().stage, 'done');
  assert.equal(f.controller.snapshot().receipt.lineUserId, uid(2));
  assert.ok(!Object.hasOwn(f.calls.find(call => call.action === 'confirm').data, 'actor'));
});

test('in-flight confirmation blocks a second submission and changing the target', async () => {
  let resolveWrite;
  const f = fixture({ confirm: data => new Promise(resolve => { resolveWrite = () => resolve({ ...data, appliedCount: data.vendorIds.length }); }) });
  await preview(f); const write = f.controller.confirm(true);
  assert.equal(f.controller.snapshot().busy, true);
  assert.equal(f.persisted[0].operationId, operationId);
  await f.controller.confirm(true); await f.controller.selectUser(uid(1));
  f.controller.toggle('brand-0', true); f.controller.edit(); f.controller.reset();
  assert.deepEqual(f.calls.map(call => call.action), ['search', 'options', 'preview', 'confirm']);
  assert.equal(f.controller.snapshot().pending.lineUserId, uid(2));
  resolveWrite(); await write; assert.equal(f.controller.snapshot().stage, 'done');
});

test('stale preview clears confirmation and requires reload and a new explicit selection', async () => {
  const f = fixture({ confirm: async () => { throw Object.assign(new Error('資料版本已變更'), { definitive: true, code: 'stale_preview' }); } });
  await preview(f); await f.controller.confirm(true);
  assert.equal(f.controller.snapshot().reloadRequired, true); assert.equal(f.controller.snapshot().preview, null);
  f.controller.toggle('brand-1', true); await f.controller.preview(); await f.controller.confirm(true);
  assert.equal(f.calls.filter(call => call.action === 'confirm').length, 1); assert.deepEqual(f.controller.snapshot().selectedIds, []);
  await f.controller.reload(); assert.equal(f.controller.snapshot().reloadRequired, false);
  assert.deepEqual(f.calls.at(-1), { action: 'options', data: { lineUserId: uid(2) } });
  assert.deepEqual(f.persisted.at(-1), null);
});

test('response loss survives reload and allows only readback of the unchanged operation', async () => {
  const f = fixture({ confirm: async () => { throw new Error('network lost'); } });
  await preview(f); await f.controller.confirm(true); const attempt = f.persisted[0];
  assert.equal(f.controller.snapshot().stage, 'uncertain');
  await f.controller.search('另一人'); await f.controller.preview(); await f.controller.confirm(true); f.controller.reset();
  assert.equal(f.calls.filter(call => call.action === 'confirm').length, 1);
  const resumed = fixture({}, attempt); await resumed.controller.check();
  assert.equal(resumed.controller.snapshot().stage, 'uncertain');
  assert.deepEqual(resumed.calls, [{ action: 'status', data: attempt }]);
  assert.deepEqual(resumed.persisted, []);
  const completed = fixture({ status: async data => ({ operationId: data.operationId, revision: data.revision, lineUserId: data.lineUserId, vendorIds: data.vendorIds, appliedCount: 2 }) }, attempt);
  await completed.controller.check();
  assert.equal(completed.controller.snapshot().stage, 'done');
  assert.deepEqual(completed.calls, [{ action: 'status', data: attempt }]);
  assert.deepEqual(completed.persisted, [null]);
});

test('mismatched preview or readback never authorizes a different user or brand list', async () => {
  const f = fixture({ preview: async data => ({ ...data, lineUserId: uid(1), operationId, revision, brands: [] }) });
  await preview(f); await f.controller.confirm(true);
  assert.equal(f.controller.snapshot().preview, null); assert.equal(f.calls.filter(call => call.action === 'confirm').length, 0);
  const attempt = { lineUserId: uid(2), vendorIds: ['brand-1'], operationId, revision, confirmed: true };
  const resumed = fixture({ status: async () => ({ ...attempt, lineUserId: uid(1) }) }, attempt);
  await resumed.controller.check(); assert.equal(resumed.controller.snapshot().stage, 'uncertain');
  assert.deepEqual(resumed.persisted, []);
});

test('unreadable saved operation fails closed instead of allowing a new authorization', async () => {
  const f = fixture({}, { unreadable: true });
  await f.controller.search('另一人'); await f.controller.confirm(true); f.controller.reset();
  assert.equal(f.controller.snapshot().stage, 'uncertain'); assert.match(f.controller.snapshot().message, /聯絡管理員/);
  assert.deepEqual(f.calls, []);
});

test('visible catalog matches existing contract eligibility, including inclusive Taipei expiry', () => {
  const now = Date.parse('2026-11-11T16:00:00Z');
  const rows = [
    { id: 'valid', name: '有效品牌', status: 'approved', contract_end: '2026-11-12' },
    { id: 'legacy', name: '舊資料', status: 'active', contract_end: '' },
    { id: 'hidden', status: 'approved', is_hidden: 1 },
    { id: 'pending', status: 'pending' },
    { id: 'expired', status: 'approved', contract_end: '2026-11-11' },
    { id: 'invalid', status: 'approved', contract_end: '2027-02-30' },
    { id: 'terminated', status: 'approved', contract_terminated_at: '2026-11-01' },
  ];
  assert.deepEqual(vendorBrandAdminCatalog(rows, now).map(row => row.id), rows.filter(row => isVendorPublicEligible(row, now)).map(row => row.id));
  assert.deepEqual(vendorBrandAdminCatalog(rows, now).map(row => row.id), ['valid', 'legacy']);
});

test('brands can be selected first and survive search, explicit manager choice and deselection', async () => {
  const f = fixture(); await f.controller.loadCatalog();
  assert.equal(f.controller.snapshot().brands.length, 12); assert.equal(f.controller.snapshot().user, null);
  f.controller.toggle('brand-1', true); f.controller.toggle('brand-8', true); f.controller.toggle('brand-8', false);
  await f.controller.preview(); await f.controller.confirm(true);
  assert.deepEqual(f.calls.map(call => call.action), ['catalog']);
  await f.controller.search('同名窗口');
  assert.deepEqual(f.controller.snapshot().selectedIds, ['brand-1']); assert.equal(f.controller.snapshot().user, null);
  await f.controller.selectUser(uid(2));
  assert.deepEqual(f.controller.snapshot().selectedIds, ['brand-1']);
  assert.equal(f.controller.snapshot().brands.find(row => row.id === 'brand-1').bindingStatus, 'revoked');
  await f.controller.preview();
  assert.deepEqual(f.calls.at(-1), { action: 'preview', data: { lineUserId: uid(2), vendorIds: ['brand-1'] } });
  assert.deepEqual(f.persisted, []);
});

test('cached page catalog avoids an extra request and selecting a manager rechecks brand eligibility', async () => {
  const f = fixture({ options: async () => ({ ...users[1], brands: brands.filter(row => row.id !== 'brand-8') }) });
  await f.controller.loadCatalog(brands.map(({ id, name, status }) => ({ id, name, status })));
  assert.deepEqual(f.calls, []);
  f.controller.toggle('brand-1', true); f.controller.toggle('brand-8', true);
  await f.controller.search('同名窗口'); await f.controller.selectUser(uid(2));
  assert.deepEqual(f.controller.snapshot().selectedIds, ['brand-1']);
  assert.match(f.controller.snapshot().message, /1 個品牌目前不可授權/);
  assert.deepEqual(f.calls.map(call => call.action), ['search', 'options']);
  assert.deepEqual(f.persisted, []);
});

test('a unique search result never selects the manager automatically', async () => {
  const f = fixture({ search: async () => ({ users: [users[1]], truncated: false }) });
  await f.controller.loadCatalog(); f.controller.toggle('brand-1', true);
  await f.controller.search('唯一窗口'); await f.controller.preview(); await f.controller.confirm(true);
  assert.equal(f.controller.snapshot().user, null);
  assert.deepEqual(f.calls.map(call => call.action), ['catalog', 'search']);
  assert.deepEqual(f.persisted, []);
});

test('unknown saved operation prevents loading or selecting a new brand catalog', async () => {
  const f = fixture({}, { lineUserId: uid(2), vendorIds: ['brand-1'], operationId, revision, confirmed: true });
  await f.controller.loadCatalog(); f.controller.toggle('brand-1', false); await f.controller.search('另一人');
  assert.equal(f.controller.snapshot().stage, 'uncertain'); assert.deepEqual(f.calls, []);
});

test('review and receipt start at the top without stealing focus on checkbox or busy updates', () => {
  const selection = { stage: 'select', user: users[1], selectedIds: ['brand-1'] };
  assert.equal(vendorBrandAdminScrollTarget({ stage: 'select', user: null }, selection), 'user');
  assert.equal(vendorBrandAdminScrollTarget(selection, { ...selection, selectedIds: ['brand-1', 'brand-8'] }), null);
  assert.equal(vendorBrandAdminScrollTarget(selection, { ...selection, selectedIds: [] }), null);
  const review = { ...selection, stage: 'preview' };
  assert.equal(vendorBrandAdminScrollTarget(selection, review), 'preview');
  assert.equal(vendorBrandAdminScrollTarget(review, { ...review, busy: true }), null);
  assert.equal(vendorBrandAdminScrollTarget(review, { ...review, stage: 'done' }), 'done');
  assert.equal(vendorBrandAdminScrollTarget(review, selection), null);
});

test('opening after hidden-to-visible navigation reads the current catalog and keeps preview in the fixed footer', async () => {
  // Minimal DOM for the actual emitted script; no browser or network is used.
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.value = ''; this.hidden = false; }
    set textContent(value) { this.text = String(value); this.replaceChildren(); }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
    append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
    prepend(...items) { for (const item of items) item.parentElement = this; this.children.unshift(...items); }
    replaceChildren(...items) { for (const item of this.children) item.parentElement = null; this.children = []; this.append(...items); }
    before(item) { const siblings = this.parentElement.children; item.parentElement = this.parentElement; siblings.splice(siblings.indexOf(this), 0, item); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    addEventListener() {}
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const body = new Element('body'), tabs = new Element('div'), activeTab = new Element('button'), view = new Element('section'); view.id = 'view'; tabs.append(activeTab); body.append(tabs, view);
  const all = element => [element, ...element.children.flatMap(all)];
  document = { body, readyState: 'complete', createElement: tag => new Element(tag), getElementById: id => all(body).find(item => item.id === id) || null, querySelector: selector => selector === '.tabs' ? tabs : selector === '.tab.active[data-tab="vendors"]' ? activeTab : null };
  const requests = [];
  const stored = new Map([['sakura_admin_session', JSON.stringify({ token: 'synthetic-token' })]]);
  const context = { document, URL, AbortSignal, location: { origin: 'https://isolated.test' }, MutationObserver: class { observe() {} }, localStorage: { getItem: key => stored.get(key) || null }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // The host has changed the tab flags but its asynchronous load has not yet
    // replaced the previous hidden-vendor response: the real regression trigger.
    state: { tab: 'vendors', visibility: 'visible', data: { vendors: [{ id: 'old-hidden', name: '舊隱藏品牌', status: 'approved', is_hidden: 1 }] } },
    fetch: async (url, options) => { requests.push({ url, method: options.method }); return { ok: true, status: 200, json: async () => ({ success: true, vendors: [{ id: 'current-visible', name: '目前公開品牌', status: 'approved', is_hidden: 0, contract_end: '2099-12-31' }] }) }; },
  };
  const html = decorateVendorBrandAdminHtml('<html><head></head><body></body></html>');
  vm.runInNewContext(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context);
  document.getElementById('vba-open').onclick();
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  assert.deepEqual(requests, [{ url: 'https://isolated.test/admin-api/vendor-management?module=vendors', method: 'GET' }]);
  const list = document.getElementById('vba-brands');
  assert.equal(list.textContent, '目前公開品牌'); assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].disabled, false);
  const preview = document.getElementById('vba-preview-button');
  assert.equal(preview.parentElement.tagName, 'FOOTER'); assert.equal(preview.hidden, false); assert.equal(preview.disabled, true);
  assert.equal(document.getElementById('vba-message').hidden, true);
  assert.ok(!body.textContent.includes('舊隱藏品牌'));
});
