import test from 'node:test';
import assert from 'node:assert/strict';
import { contentFixture } from './vendor-content-fixture.mjs';

const hiddenAt = '2026-10-20 14:10:00';
const hiddenBy = 'fixture-admin';

function hideVendor(f) {
  f.sqlite.prepare("UPDATE welfare_vendors SET status='suspended', is_hidden=1, hidden_at=?, hidden_by=? WHERE id='a'").run(hiddenAt, hiddenBy);
}

function assertHidden(row) {
  assert.equal(row.is_hidden, 1, 'ordinary saves must keep a hidden vendor hidden');
  assert.equal(row.hidden_at, hiddenAt, 'ordinary saves must retain the hide timestamp');
  assert.equal(row.hidden_by, hiddenBy, 'ordinary saves must retain the hide actor');
}

test('editing a hidden vendor is rejected without changing visibility, credentials or contract details', async () => {
  const f = contentFixture();
  try {
    f.sqlite.prepare("UPDATE welfare_vendors SET contract_start='2026-01-01', contract_end='2026-12-31', vendor_portal_password_updated_at='2026-01-01 09:00:00' WHERE id='a'").run();
    hideVendor(f);
    const before = { ...f.row() };
    const otherBefore = { ...f.row('b') };
    const data = { ...before, phone: '04-12345678', vendor_portal_password: '' };
    delete data.is_hidden;
    delete data.hidden_at;
    delete data.hidden_by;

    const result = await f.save(data);

    assert.equal(result.success, false);
    assert.match(result.message, /已隱藏/);
    const after = f.row();
    assertHidden(after);
    assert.deepEqual({ ...after }, before, 'rejecting the save must preserve every vendor field');
    assert.deepEqual({ ...f.row('b') }, otherBefore, 'saving one vendor must not change another vendor');
  } finally { f.close(); }
});

test('a form captured before hiding cannot unhide a vendor with stale visibility fields', async () => {
  const f = contentFixture();
  try {
    f.sqlite.prepare("UPDATE welfare_vendors SET status='suspended' WHERE id='a'").run();
    const staleForm = { ...f.row(), vendor_portal_password: '', phone: '04-87654321' };
    assert.equal(staleForm.is_hidden, 0);
    assert.equal(staleForm.hidden_at, '');
    assert.equal(staleForm.hidden_by, '');
    hideVendor(f);
    const before = { ...f.row() };

    const result = await f.save(staleForm);

    assert.equal(result.success, false);
    assert.match(result.message, /已隱藏/);
    assertHidden(f.row());
    assert.deepEqual({ ...f.row() }, before, 'stale form fields must not change a hidden vendor');
  } finally { f.close(); }
});

test('hiding immediately before the save executes atomically blocks the stale update', async () => {
  const f = contentFixture();
  try {
    const staleForm = { ...f.row(), phone: '04-99999999', discount_policy: '<p>Stale policy</p>', vendor_portal_password: '' };
    let hiddenBeforeRun;
    let intercepted = 0;
    const racingDb = { prepare(sql) {
      const statement = f.db.prepare(sql);
      if (!/INSERT INTO welfare_vendors/.test(sql)) return statement;
      return { bind(...values) { statement.bind(...values); return this; }, async run() {
        intercepted += 1;
        hideVendor(f);
        hiddenBeforeRun = { ...f.row() };
        return statement.run();
      } };
    } };

    const result = await f.context.saveWelfareVendor(racingDb, staleForm);

    assert.equal(intercepted, 1, 'the fixture must hide at the actual write boundary');
    assert.equal(result.success, false);
    assert.match(result.message, /已隱藏/);
    assertHidden(f.row());
    assert.deepEqual({ ...f.row() }, hiddenBeforeRun, 'the atomic save guard must preserve the newly hidden row');
  } finally { f.close(); }
});

test('ordinary saves keep visible vendors visible and new vendors use visibility defaults', async () => {
  const f = contentFixture();
  try {
    assert.equal((await f.save({ ...f.row('b'), vendor_portal_password: '', phone: '02-12345678' })).success, true);
    assert.equal((await f.save({ id: 'new-vendor', name: 'New Fixture Store', status: 'pending' })).success, true);

    for (const id of ['b', 'new-vendor']) {
      const row = f.row(id);
      assert.equal(row.is_hidden, 0, id + ' should remain visible');
      assert.equal(row.hidden_at, '');
      assert.equal(row.hidden_by, '');
    }
    assert.equal(f.row('b').vendor_portal_password, 'fixture-password');
    assert.equal(f.row('new-vendor').status, 'pending');
  } finally { f.close(); }
});
