import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVendorBrandChatPlan, isVendorBrandChatCandidate, partitionVendorBrandForwardPayload, withVendorBrandSwitchButton, scopeVendorBrandQrButtons } from '../src/vendor-brand-chat.js';

const UID = 'U' + '1'.repeat(32);
const brand = n => ({ id: 'brand-' + n, name: '品牌 ' + n, secret: 'never-public', management_source: 'admin' });
const event = (command = 'list&page=0', extra = {}) => ({ eventType: 'postback', postbackData: 'action=vendor.brand.' + command, sourceType: 'user', LINE_user_id: UID, replyToken: 'synthetic', activitySignatureVerified: true, ...extra });
const entry = (text = '儀表板') => event('', { eventType: 'message', messageType: 'text', postbackData: '', text });
const card = name => ({ type: 'flex', altText: name, contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: name }] }, footer: { type: 'box', layout: 'vertical', contents: [
  { type: 'button', action: { type: 'postback', label: '店家 QR 碼', data: 'action=vendor.branch_qr.list&page=0' } },
  { type: 'button', action: { type: 'uri', label: '原有入口', uri: 'https://example.test/unchanged' } },
] } } });
function setup(count = 7) {
  const rows = Array.from({ length: count }, (_, n) => brand(n + 1));
  const calls = [], state = { rows, selected: null };
  const access = {
    list: async (_db, uid) => { calls.push(['list', uid]); return state.rows; },
    get: async (_db, uid, id) => { calls.push(['get', uid, id]); return state.rows.find(row => row.id === id) || null; },
    selected: async (_db, uid) => { calls.push(['selected', uid]); return state.selected; },
    select: async (_db, uid, id) => { calls.push(['select', uid, id]); state.selected = state.rows.find(row => row.id === id) || null; if (!state.selected) throw Error('denied'); return state.selected; },
  };
  const builders = [];
  const buildDashboard = async row => { builders.push(['dashboard', row.id]); return card(row.name); };
  const buildPortal = async row => { builders.push(['portal', row.id]); return card('專區 ' + row.name); };
  return { state, calls, access, builders, run: item => buildVendorBrandChatPlan({ db: {}, item, access, buildDashboard, buildPortal }) };
}
const json = value => JSON.stringify(value.messages || value);
function actions(value) {
  const result = [];
  function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'postback') result.push(node.data); for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(visit); else visit(value); } }
  visit(value); return result;
}

test('seven brands paginate five at a time without exposing vendor private fields', async () => {
  const f = setup(), first = await f.run(entry());
  assert.equal(first.authorized, true); assert.match(json(first), /共 7 個品牌，第 1 \/ 2 頁/);
  assert.equal(actions(first).filter(value => value.startsWith('action=vendor.brand.select')).length, 5);
  assert.doesNotMatch(json(first), /品牌 6|never-public|management_source/); assert.deepEqual(f.builders, []);
  const next = await f.run(event('list&surface=portal&page=1'));
  assert.equal(actions(next).filter(value => value.startsWith('action=vendor.brand.select')).length, 2);
  assert.ok(actions(next).every(value => value.includes('surface=portal')));
  assert.ok(actions(next).includes('action=vendor.brand.list&surface=portal&page=0'));
  assert.match(json(next), /返回儀表板/);
  assert.match(json(await f.run(event('list&page=999999'))), /第 2 \/ 2 頁/);
});

test('selection writes only the selection cache through access and scopes the existing QR shortcut', async () => {
  const f = setup(), result = await f.run(event('select&vendor_id=brand-6&surface=portal'));
  assert.equal(result.vendorId, 'brand-6'); assert.deepEqual(f.builders, [['portal', 'brand-6']]);
  assert.deepEqual(f.calls, [['list', UID], ['select', UID, 'brand-6']]);
  assert.ok(actions(result).includes('action=vendor.branch_qr.list&page=0&vendor_id=brand-6'));
  assert.ok(actions(result).includes('action=vendor.brand.list&surface=portal&page=0'));
  assert.match(json(result), /https:\/\/example.test\/unchanged/);
  const repeat = await f.run(entry('廠商專區'));
  assert.equal(repeat.vendorId, 'brand-6'); assert.equal(f.calls.filter(call => call[0] === 'select').length, 1);
});

test('single brand keeps direct dashboard and portal experience without selection write or switch', async () => {
  const f = setup(1);
  assert.equal((await f.run(entry())).vendorId, 'brand-1');
  const portal = await f.run(entry('廠商專區'));
  assert.deepEqual(f.builders, [['dashboard', 'brand-1'], ['portal', 'brand-1']]);
  assert.equal(f.calls.some(call => call[0] === 'select'), false);
  assert.equal(actions(portal).some(value => value.startsWith('action=vendor.brand.')), false);
});

test('home with explicit brand reauthorizes without changing cached choice', async () => {
  const f = setup(); f.state.selected = brand(1);
  const result = await f.run(event('home&vendor_id=brand-3&surface=dashboard'));
  assert.equal(result.vendorId, 'brand-3'); assert.equal(f.state.selected.id, 'brand-1');
  assert.deepEqual(f.calls, [['list', UID], ['get', UID, 'brand-3']]);
});

test('cross-brand request and stale selected cache never reach dashboard or portal builder', async () => {
  const f = setup();
  const unauthorized = await f.run(event('select&vendor_id=someone-else&surface=portal'));
  assert.equal(unauthorized.authorized, false); assert.equal(f.calls.some(call => call[0] === 'select'), false);
  f.state.selected = { id: 'someone-else', name: 'SECRET NAME' };
  const stale = await f.run(entry()); assert.equal(stale.authorized, false);
  assert.doesNotMatch(json(stale), /SECRET NAME/); assert.deepEqual(f.builders, []);
});

test('permissions revoked after list are checked at every selection and failed authority never falls through', async () => {
  const f = setup(); assert.equal((await f.run(event())).authorized, true);
  f.state.rows = f.state.rows.filter(row => row.id !== 'brand-1');
  assert.equal((await f.run(event('select&vendor_id=brand-1'))).authorized, false);
  f.access.select = async () => { throw Object.assign(Error('private details'), { status: 403 }); };
  const racing = await f.run(event('select&vendor_id=brand-2'));
  assert.equal(racing.handled, true); assert.equal(racing.authorized, false); assert.doesNotMatch(json(racing), /private details/);
  assert.deepEqual(f.builders, []);
});

test('shared-code QR-only caller gets no management card and old entry is delegated to original QR flow', async () => {
  const f = setup(0);
  assert.deepEqual(await f.run(entry()), { handled: false, authorized: false, messages: [] });
  assert.deepEqual(await f.run(entry('廠商專區')), { handled: false, authorized: false, messages: [] });
  const explicit = await f.run(event()); assert.equal(explicit.handled, true); assert.equal(explicit.authorized, false);
  assert.deepEqual(f.builders, []); assert.equal(f.calls.some(call => call[0] === 'select'), false);
});

test('unsigned, group, room, malformed UID and missing reply token perform no authority lookup or reply', async () => {
  for (const extra of [{ activitySignatureVerified: false }, { sourceType: 'group' }, { sourceType: 'room' }, { LINE_user_id: 'bad' }, { replyToken: '' }]) {
    const f = setup(); const result = await f.run(event('select&vendor_id=brand-1', extra));
    assert.deepEqual(result, { handled: true, authorized: false, messages: [] }); assert.deepEqual(f.calls, []);
  }
});

test('malformed explicit commands are owned but fail before authority lookup', async () => {
  for (const command of ['destroy', 'select', 'list&page=-1', 'list&page=one', 'list&surface=admin', 'list&vendor_id=a&vendor_id=b', 'select&vendor_id=%00', 'list&unknown=1', 'list&page=1&page=2', 'list&x=' + 'a'.repeat(300)]) {
    const f = setup(), result = await f.run(event(command));
    assert.equal(result.handled, true, command); assert.equal(result.authorized, false, command); assert.deepEqual(f.calls, []);
  }
  const f = setup(); assert.equal((await f.run(entry('我想看儀表板'))).handled, false); assert.deepEqual(f.calls, []);
});

test('access or card builder failures return safe owned response without leaking errors', async () => {
  const f = setup(1); f.access.get = async () => { throw Error('SECRET SQL'); };
  const denied = await f.run(entry()); assert.equal(denied.handled, true); assert.equal(denied.authorized, false); assert.doesNotMatch(json(denied), /SECRET SQL/);
  const g = setup(1), result = await buildVendorBrandChatPlan({ db: {}, item: entry(), access: g.access, buildDashboard: async () => { throw Error('SECRET TOKEN'); } });
  assert.equal(result.authorized, false); assert.doesNotMatch(json(result), /SECRET TOKEN/);
});

test('admin/editor dashboard gets only immutable switch addition for multiple independently authorized brands', async () => {
  const f = setup(), original = card('original admin'), snapshot = structuredClone(original);
  const result = await withVendorBrandSwitchButton({ db: {}, item: entry(), message: original, access: f.access });
  assert.deepEqual(original, snapshot); assert.deepEqual(result.contents.body, original.contents.body);
  assert.deepEqual(result.contents.footer.contents.slice(0, -1), original.contents.footer.contents);
  assert.equal(actions(result).filter(value => value.startsWith('action=vendor.brand.list')).length, 1);
  const repeated = await withVendorBrandSwitchButton({ db: {}, item: entry(), message: result, access: f.access });
  assert.deepEqual(repeated, result);
  f.state.rows = []; assert.equal(await withVendorBrandSwitchButton({ db: {}, item: entry(), message: original, access: f.access }), original);
  f.state.rows = [brand(1)]; assert.equal(await withVendorBrandSwitchButton({ db: {}, item: entry(), message: original, access: f.access }), original);
  f.access.list = async () => { throw Error('unavailable'); }; assert.equal(await withVendorBrandSwitchButton({ db: {}, item: entry(), message: original, access: f.access }), original);
});

test('carousel preserves all original controls and scopes only the QR action', async () => {
  const f = setup(), carousel = { type: 'flex', altText: 'original editor', contents: { type: 'carousel', contents: [card('one').contents, card('two').contents] } }, original = structuredClone(carousel);
  const result = await withVendorBrandSwitchButton({ db: {}, item: entry(), message: carousel, surface: 'portal', access: f.access });
  assert.deepEqual(carousel, original); assert.deepEqual(result.contents.contents[1], original.contents.contents[1]);
  assert.equal(actions(result).filter(value => value.startsWith('action=vendor.brand.list')).length, 1);
  const scoped = scopeVendorBrandQrButtons(result, 'brand-3');
  assert.equal(actions(scoped).filter(value => value === 'action=vendor.branch_qr.list&page=0&vendor_id=brand-3').length, 2);
  assert.equal(actions(scoped).filter(value => value === 'action=vendor.brand.list&surface=portal&page=0').length, 1);
  assert.deepEqual(carousel, original);
});

test('forwarding partitions only signed private new postbacks; keywords, other events and unchanged bytes survive', () => {
  const ordinary = { type: 'message', source: { type: 'user', userId: UID }, message: { type: 'text', text: '儀表板' } };
  const brandEvent = { type: 'postback', source: { type: 'user', userId: UID }, postback: { data: 'action=vendor.brand.list&page=0' } };
  const groupEvent = { ...brandEvent, source: { type: 'group', userId: UID, groupId: 'synthetic' } };
  const raw = JSON.stringify({ destination: 'synthetic', events: [brandEvent, ordinary, groupEvent] });
  assert.equal(partitionVendorBrandForwardPayload(raw, false).body, raw);
  const changed = partitionVendorBrandForwardPayload(raw, true); assert.equal(changed.changed, true); assert.equal(changed.shouldForward, true);
  assert.deepEqual(JSON.parse(changed.body).events, [ordinary, groupEvent]);
  assert.equal(partitionVendorBrandForwardPayload(JSON.stringify({ events: [brandEvent] }), true).shouldForward, false);
  const unchanged = '{ "events": ' + JSON.stringify([ordinary]) + ' }';
  assert.equal(partitionVendorBrandForwardPayload(unchanged, true).body, unchanged);
  assert.equal(partitionVendorBrandForwardPayload('bad json', true).body, 'bad json');
  assert.equal(isVendorBrandChatCandidate({ text: '儀表板' }), false);
  assert.equal(isVendorBrandChatCandidate({ postbackData: 'action=vendor.brandish.list' }), false);
});
