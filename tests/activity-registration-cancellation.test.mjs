import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, familyForm, validAnswers } from './activity-form.test.mjs';

export async function cancellationFixture() {
  const f = fixture();
  f.sqlite.exec(`CREATE TABLE welfare_audit_events(id TEXT PRIMARY KEY,actor_type TEXT,actor_id TEXT,event_type TEXT,target_type TEXT,target_id TEXT,summary TEXT,raw_json TEXT,created_at TEXT);
    INSERT INTO welfare_activity_events(id,title,status,audience_scope,end_at) VALUES('event-2','另一活動','active','["all"]','2099-12-31');`);
  await f.save();
  const insert = (id, event = 'event-1', uid = id) => f.sqlite.prepare(`INSERT INTO welfare_activity_registrations
    (id,event_id,line_user_id,display_name,form_revision,schema_json,answers_json,created_at) VALUES(?,?,?,?,1,?,?,?)`)
    .run(id, event, uid, '測試 ' + id, JSON.stringify(familyForm), JSON.stringify(validAnswers), '2026-10-02T00:00:00Z');
  insert('one', 'event-1', 'test-member'); insert('two'); insert('three'); insert('outside', 'event-2');
  let beforeBatch = () => {}, failDelete = false;
  f.db.batch = async statements => {
    beforeBatch(); f.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (let i = 0; i < statements.length; i++) {
        if (i === 1 && failDelete) throw new Error('synthetic failure');
        results.push(await statements[i].run());
      }
      f.sqlite.exec('COMMIT'); return results;
    } catch (error) { f.sqlite.exec('ROLLBACK'); throw error; }
  };
  const count = () => f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations WHERE event_id='event-1'").get().n;
  const audits = () => f.sqlite.prepare('SELECT * FROM welfare_audit_events').all();
  const input = async (all = false) => {
    const view = await (await f.call('/admin-api/activity-form?event_id=event-1')).json();
    return { action: all ? 'cancel_all_registrations' : 'cancel_registration', event_id: 'event-1',
      event_title: '測試家庭日', registration_id: all ? null : 'one', expected_count: view.registration_count,
      roster_revision: view.roster_revision, confirmed: true, request_id: crypto.randomUUID() };
  };
  return { ...f, insert, count, audits, input, race: hook => { beforeBatch = hook; }, failDelete: () => { failDelete = true; } };
}

test('cancellation denies anonymous/member before reads or writes', async () => {
  const f = await cancellationFixture();
  try { const body = await f.input(); for (const token of ['', 'test-member']) {
    f.queries.length = 0; assert.equal((await f.call('/admin-api/activity-form', body, token)).status, 403);
    assert.deepEqual(f.queries, []); assert.equal(f.count(), 3); assert.equal(f.audits().length, 0);
  } } finally { f.sqlite.close(); }
});
test('single cancellation preserves audit snapshot, other registrations and allows signup again', async () => {
  const f = await cancellationFixture();
  try {
    const body = await f.input(); assert.equal((await f.call('/admin-api/activity-form', body)).status, 200);
    assert.equal(f.count(), 2); const audit = f.audits()[0];
    assert.equal(audit.actor_id, 'admin:test-admin'); assert.equal(audit.target_id, 'event-1');
    assert.equal(JSON.parse(audit.raw_json).registrations[0].answers_json, JSON.stringify(validAnswers));
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations WHERE event_id='event-2'").get().n, 1);
    assert.equal((await f.call('/api/activity-registration', { event_id: 'event-1', revision: 1, answers: validAnswers }, 'test-member')).status, 200);
    assert.equal(f.count(), 3);
    assert.equal((await f.call('/admin-api/activity-form', body)).status, 200);
    assert.equal(f.count(), 3); assert.equal(f.audits().length, 1);
  } finally { f.sqlite.close(); }
});
test('bulk cancellation clears only selected event, exports exclude removed rows', async () => {
  const f = await cancellationFixture();
  try {
    const response = await f.call('/admin-api/activity-form', await f.input(true));
    assert.equal((await response.json()).cancelled_count, 3); assert.equal(f.count(), 0);
    assert.equal(JSON.parse(f.audits()[0].raw_json).registrations.length, 3);
    const roster = await (await f.call('/admin-api/activity-form?event_id=event-1')).json();
    assert.equal(roster.registration_count, 0); assert.deepEqual(roster.registrations, []);
    assert.doesNotMatch(await (await f.call('/admin-api/activity-form?event_id=event-1&export=csv')).text(), /測試 one|測試 two/);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations WHERE event_id='event-2'").get().n, 1);
  } finally { f.sqlite.close(); }
});
for (const [label, overrides] of [['confirmation', { confirmed: false }], ['wrong title', { event_title: '另一活動' }],
  ['wrong row', { registration_id: 'outside' }], ['invalid operation ID', { request_id: ['abc'] }],
  ['stale bulk count', { action: 'cancel_all_registrations', expected_count: 9 }], ['stale bulk revision', { action: 'cancel_all_registrations', roster_revision: 'stale' }]]) {
  test('rejects ' + label + ' without changes', async () => {
    const f = await cancellationFixture();
    try { assert.ok((await f.call('/admin-api/activity-form', { ...await f.input(), ...overrides })).status >= 400); assert.equal(f.count(), 3); assert.equal(f.audits().length, 0); }
    finally { f.sqlite.close(); }
  });
}
test('cross-origin cancellation is denied', async () => {
  const f = await cancellationFixture(); try {
    assert.equal((await f.call('/admin-api/activity-form', await f.input(), 'test-admin', { Origin: 'https://other.test' })).status, 403);
    assert.equal(f.count(), 3); assert.equal(f.audits().length, 0);
  } finally { f.sqlite.close(); }
});
test('checked-in registrant prevents the entire bulk operation', async () => {
  const f = await cancellationFixture(); try {
    f.sqlite.exec("INSERT INTO welfare_activity_checkins(id,event_id,line_user_id) VALUES('check','event-1','two')");
    assert.equal((await f.call('/admin-api/activity-form', await f.input(true))).status, 409);
    assert.equal(f.count(), 3); assert.equal(f.audits().length, 0);
  } finally { f.sqlite.close(); }
});
for (const [label, race] of [['signup', f => f.insert('new')], ['check-in', f => f.sqlite.exec("INSERT INTO welfare_activity_checkins(id,event_id,line_user_id) VALUES('check','event-1','two')")],
  ['answer edit', f => f.sqlite.exec("UPDATE welfare_activity_registrations SET answers_json='{}' WHERE id='two'")]]) {
  test('concurrent ' + label + ' cancels nothing and writes no audit', async () => {
    const f = await cancellationFixture(); try {
      const body = await f.input(true); f.race(() => race(f));
      assert.equal((await f.call('/admin-api/activity-form', body)).status, 409);
      assert.equal(f.count(), label === 'signup' ? 4 : 3); assert.equal(f.audits().length, 0);
    } finally { f.sqlite.close(); }
  });
}
test('delete failure rolls back the cancellation snapshot and leaves the roster intact', async () => {
  const f = await cancellationFixture(); try {
    f.failDelete(); assert.equal((await f.call('/admin-api/activity-form', await f.input(true))).status, 503);
    assert.equal(f.count(), 3); assert.equal(f.audits().length, 0);
  } finally { f.sqlite.close(); }
});
test('audit failure leaves registrations intact', async () => {
  const f = await cancellationFixture(); try {
    f.sqlite.exec('DROP TABLE welfare_audit_events');
    assert.equal((await f.call('/admin-api/activity-form', await f.input(true))).status, 503); assert.equal(f.count(), 3);
  } finally { f.sqlite.close(); }
});
