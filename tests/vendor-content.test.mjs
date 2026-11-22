import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { contentFixture, source } from './vendor-content-fixture.mjs';
import { decorateVendorContentHtml } from '../src/vendor-content-ui.js';

test('additive migration keeps old policies and credentials without guessing descriptions', () => {
  const f = contentFixture();
  try { assert.equal(f.row().discount_policy, 'Legacy policy'); assert.equal(f.row().store_intro, ''); assert.equal(f.row().vendor_portal_password, 'fixture-password'); }
  finally { f.close(); }
});
test('admin, application and storefront round-trip independent sanitized fields', async () => {
  const f = contentFixture();
  try {
    const result = await f.save({ ...f.row(), store_intro: '<h2>Intro</h2><script>bad()</script>', discount_policy: '<b>Policy</b>' });
    assert.equal(result.success, true);
    assert.equal(f.row().store_intro, '<h2>Intro</h2>');
    assert.equal(f.row().discount_policy, '<b>Policy</b>');
    const application = await f.application(), storefront = await f.storefront();
    for (const result of [application, storefront]) {
      assert.equal(result.success, true);
      assert.equal(result.data.vendor.store_intro, f.row().store_intro);
      assert.equal(result.data.vendor.discount_policy, f.row().discount_policy);
    }
    assert.equal(storefront.data.vendor.intro, '<h2>Intro</h2>');
    assert.equal((await f.apply({ ...f.row(), portal_token: 'token-a', store_intro: '<p>Application intro</p>' })).success, true);
    assert.equal(f.row().store_intro, '<p>Application intro</p>');
    assert.equal(f.row().discount_policy, '<b>Policy</b>');
    assert.equal((await f.profile({ ...f.row(), portal_token: 'token-a', discount_policy: '<p>New policy</p>' })).success, true);
    assert.equal(f.row().store_intro, '<p>Application intro</p>');
    assert.equal((await f.application()).data.vendor.discount_policy, '<p>New policy</p>');
  } finally { f.close(); }
});
test('omitted content is preserved, explicit blanks clear only the selected field', async () => {
  const f = contentFixture();
  try {
    await f.save({ ...f.row(), store_intro: 'Intro' });
    const data = { ...f.row(), phone: '0412345678' };
    delete data.store_intro; delete data.discount_policy;
    await f.save(data);
    assert.equal(f.row().store_intro, 'Intro'); assert.equal(f.row().discount_policy, 'Legacy policy');
    await f.save({ ...f.row(), store_intro: '' });
    assert.equal(f.row().store_intro, ''); assert.equal(f.row().discount_policy, 'Legacy policy');
  } finally { f.close(); }
});
test('legacy descriptions never implicitly become policies and empty descriptions stay empty', async () => {
  const f = contentFixture();
  try {
    const before = { ...f.row() };
    const legacy = { ...before, portal_token: 'token-a', discount_policy: 'Legacy intro write' };
    delete legacy.store_intro;
    const result = await f.profile(legacy);
    assert.equal(result.success, false); assert.match(result.message, /重新載入/);
    assert.deepEqual({ ...f.row() }, before);
    assert.equal((await f.storefront()).data.vendor.intro, '店家尚未填寫介紹。');
  } finally { f.close(); }
});
for (const token of ['', 'invalid', 'token-b']) test('profile rejects unrelated identity: ' + (token || 'anonymous'), async () => {
  const f = contentFixture();
  try {
    const before = { ...f.row() };
    assert.equal((await f.profile({ ...before, portal_token: token, store_intro: 'Spoof', discount_policy: 'Spoof' })).success, false);
    assert.deepEqual({ ...f.row() }, before);
  } finally { f.close(); }
});
test('all vendor editing surfaces retain both fields and the single shared editor contract', () => {
  const apply = readFileSync(new URL('../src/vendor-apply.html', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../src/vendor-management.html', import.meta.url), 'utf8');
  for (const name of ['vendorApply', 'vendorManagement']) {
    const line = source.split(/\r?\n/).find(line => line.startsWith('const ' + name + 'Html = '));
    assert.equal(JSON.parse(line.slice(('const ' + name + 'Html = ').length, -1)), (name === 'vendorApply' ? apply : admin).replace(/\r\n/g, '\n'));
  }
  for (const field of ['store_intro', 'discount_policy']) {
    assert.ok(apply.includes('data-vendor-content="' + field + '"'));
    assert.ok(admin.includes('richTextEditor("' + field + '"'));
    const store = source.slice(source.indexOf('function buildVendorStoreHtml('), source.indexOf('const vendorRedeemHtml'));
    assert.ok(store.includes('data-vendor-content="' + field + '"'));
    assert.ok(source.slice(source.indexOf('function renderVendorApplyHtml('), source.indexOf('function renderVendorManagementHtml(')).includes('"' + field + '"'));
  }
  assert.ok(admin.includes('window.SakuraVendorContent.markup'));
  assert.ok(source.includes('decorateVendorContentHtml(buildVendorStoreHtml'));
  assert.ok(source.includes('return decorateVendorContentHtml(vendorApplyHtml'));
  assert.ok(source.includes('decorateVendorContentHtml(decorateVendorPosAdminHtml'));
  for (const [, script] of decorateVendorContentHtml('<head></head>').matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
});
