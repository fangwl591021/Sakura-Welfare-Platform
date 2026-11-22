import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { activityRosterFieldColumn, readActivityRosterPrefill, applyActivityRosterPrefill } from '../src/activity-roster-prefill.js';
import { fixture, familyForm, validAnswers } from './activity-form.test.mjs';

const expected = { department: '名冊測試部門', name: '名冊測試員工', employee_no: '0001' };
const member = { line_user_id: 'synthetic-owner', employee_no: '0001', member_type: 'employee', status: 'active', bind_status: 'bound' };
const schema = { fields: familyForm.fields, rules: familyForm.rules };

function rosterDatabase({ withRoster = true } = {}) {
  const sqlite = new DatabaseSync(':memory:'), queries = [];
  sqlite.exec(`CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,employee_no TEXT,member_type TEXT,status TEXT,bind_status TEXT);
    INSERT INTO welfare_members VALUES('synthetic-owner','0001','employee','active','bound');`);
  if (withRoster) {
    sqlite.exec(readFileSync(new URL('../migrations/0035_employee_roster.sql', import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,department_name) VALUES(?,?,?)').run('0001', expected.name, expected.department);
  }
  const db = { prepare(sql) {
    queries.push(sql);
    assert.match(sql.trim(), /^SELECT\b/i, 'prefill must never ensure schemas or write');
    let bindings = [];
    return { bind(...values) { bindings = values; return this; }, async all() { return { results: sqlite.prepare(sql).all(...bindings) }; }, async first() { return sqlite.prepare(sql).get(...bindings) || null; } };
  } };
  return { sqlite, queries, db };
}

async function registrationFixture({ withRoster = true, save = true } = {}) {
  const f = fixture();
  const columns = f.sqlite.prepare('PRAGMA table_info(welfare_members)').all().map(row => row.name);
  if (!columns.includes('employee_no')) f.sqlite.exec("ALTER TABLE welfare_members ADD COLUMN employee_no TEXT NOT NULL DEFAULT ''");
  f.sqlite.prepare('UPDATE welfare_members SET employee_no=? WHERE line_user_id=?').run('0001', 'test-member');
  f.sqlite.prepare('INSERT INTO welfare_members(line_user_id,employee_no,member_type,status,bind_status) VALUES(?,?,?,?,?)').run('another-member', '0002', 'employee', 'active', 'bound');
  const ensureCalls = [];
  f.deps.ensureEmployeeBinding = async uid => { ensureCalls.push(uid); };
  if (withRoster) {
    f.sqlite.exec(readFileSync(new URL('../migrations/0035_employee_roster.sql', import.meta.url), 'utf8'));
    const insert = f.sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,department_name,factory,business_unit,department_code,identity_type) VALUES(?,?,?,?,?,?,?)');
    insert.run('0001', expected.name, expected.department, 'PRIVATE-FACTORY', 'PRIVATE-BUSINESS', 'D001', 'PRIVATE-TYPE');
    insert.run('0002', '另一名冊員工', '另一名冊部門', 'PRIVATE-OTHER-FACTORY', 'PRIVATE-OTHER-BUSINESS', 'D002', 'PRIVATE-OTHER-TYPE');
  }
  if (save) assert.equal((await f.save()).status, 200);
  const get = (query = '', token = 'test-member') => f.call('/api/activity-registration?event_id=event-1' + query, null, token);
  return { ...f, ensureCalls, get };
}

for (const [column, labels] of [
  ['department_name', ['部門名稱', '部門', '所屬部門', ' 部 門 名 稱 （必填）＊ ']],
  ['employee_name', ['員工姓名', '員工名稱', '員工姓名（必填）']],
  ['employee_no', ['工號', '員工工號', '員工編號', '員工代號', '員編', ' 工號 * ']]
]) test('canonical roster labels map to ' + column, () => {
  for (const label of labels) for (const type of ['text', 'textarea']) assert.equal(activityRosterFieldColumn({ id: 'random_field', label, type }), column, label + '/' + type);
});

test('labels are exact and never infer relatives, contacts, generic names, translated text or input IDs', () => {
  for (const label of ['姓名', '聯絡人姓名', '緊急聯絡人姓名', '眷屬姓名', '員工姓名（眷屬）', '員工姓名與工號', '部門主管姓名', '工號填寫錯誤', 'Nomor karyawan']) assert.equal(activityRosterFieldColumn({ id: 'employee_no', label, type: 'text' }), null, label);
  for (const type of ['number', 'tel', 'select', 'multiselect', 'html']) assert.equal(activityRosterFieldColumn({ id: 'employee_no', label: '工號', type }), null, type);
  for (const field of [null, undefined, {}, { type: 'text', label: null }]) assert.equal(activityRosterFieldColumn(field), null);
});

test('pure answer overlay preserves valid source objects and leaves malformed containers for original validator', () => {
  const answers = Object.freeze({ department: 'forged', name: '', employee_no: '0002', phone: validAnswers.phone });
  const prefill = Object.freeze({ ...expected });
  assert.deepEqual(applyActivityRosterPrefill(answers, prefill), { ...answers, ...expected });
  assert.equal(answers.department, 'forged');
  for (const invalid of [null, undefined, [], ['x'], 'text', 1, true]) assert.equal(applyActivityRosterPrefill(invalid, prefill), invalid);
});

test('real SQLite prefill reads only the three matched values and preserves leading zeroes without writes', async () => {
  const f = rosterDatabase();
  try {
    const before = f.sqlite.prepare('SELECT total_changes() n').get().n;
    f.sqlite.exec('PRAGMA query_only=ON');
    assert.deepEqual(await readActivityRosterPrefill(f.db, Object.freeze({ ...member }), schema), expected);
    assert.ok(f.queries.length >= 1);
    assert.ok(f.queries.every(sql => /^\s*SELECT\b/i.test(sql)));
    assert.ok(f.queries.every(sql => !/SELECT\s+\*\s+FROM\s+employee_roster/i.test(sql)));
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, before);
  } finally { f.sqlite.close(); }
});

for (const role of ['employee', 'foreign_employee', 'manager']) test('existing active bound ' + role + ' may receive own roster prefill', async () => {
  const f = rosterDatabase();
  try { assert.deepEqual(await readActivityRosterPrefill(f.db, { ...member, member_type: role }, schema), expected); }
  finally { f.sqlite.close(); }
});

for (const [label, overrides] of [
  ['unbound', { bind_status: 'unbound' }], ['inactive', { status: 'inactive' }],
  ['visitor', { member_type: 'visitor' }], ['missing employee number', { employee_no: '' }]
]) test(label + ' never reads or exposes roster data', async () => {
  const f = rosterDatabase();
  try { assert.deepEqual(await readActivityRosterPrefill(f.db, { ...member, ...overrides }, schema), {}); assert.equal(f.queries.length, 0); }
  finally { f.sqlite.close(); }
});

test('trimmed exact employee numbers are accepted, but a duplicate member number is ambiguous', async () => {
  const f = rosterDatabase();
  try {
    assert.deepEqual(await readActivityRosterPrefill(f.db, { ...member, employee_no: ' 0001 ' }, schema), expected);
    f.sqlite.prepare('INSERT INTO welfare_members VALUES(?,?,?,?,?)').run('synthetic-duplicate', ' 0001 ', 'employee', 'active', 'bound');
    assert.deepEqual(await readActivityRosterPrefill(f.db, member, schema), {});
  } finally { f.sqlite.close(); }
});

test('ambiguous trimmed roster rows and unmatched employee numbers never pick the first row', async () => {
  const f = rosterDatabase();
  try {
    f.sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,department_name) VALUES(?,?,?)').run(' 0001 ', '不應選用', '不應選用');
    assert.deepEqual(await readActivityRosterPrefill(f.db, member, schema), {});
    assert.deepEqual(await readActivityRosterPrefill(f.db, { ...member, employee_no: '0009' }, schema), {});
  } finally { f.sqlite.close(); }
});

test('a stale member snapshot cannot expose roster after rebind or deactivation', async () => {
  for (const mutation of ["employee_no='0002'", "status='inactive'", "bind_status='unbound'", "member_type='visitor'"]) {
    const f = rosterDatabase();
    try {
      f.sqlite.exec("UPDATE welfare_members SET " + mutation + " WHERE line_user_id='synthetic-owner'");
      assert.deepEqual(await readActivityRosterPrefill(f.db, member, schema), {}, mutation);
    } finally { f.sqlite.close(); }
  }
});

test('missing roster table is a safe manual fallback; other database failures remain visible to the service', async () => {
  const f = rosterDatabase({ withRoster: false });
  try {
    assert.deepEqual(await readActivityRosterPrefill(f.db, member, schema), {});
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='employee_roster'").get().n, 0);
  } finally { f.sqlite.close(); }
  await assert.rejects(readActivityRosterPrefill({ prepare() { throw Error('synthetic D1 failure'); } }, member, schema), /synthetic D1 failure/);
});

test('partial roster values fill only available values and never fabricate department data', async () => {
  const f = rosterDatabase();
  try {
    f.sqlite.exec("UPDATE employee_roster SET department_name=''");
    assert.deepEqual(await readActivityRosterPrefill(f.db, member, schema), { name: expected.name, employee_no: expected.employee_no });
  } finally { f.sqlite.close(); }
});

test('authenticated new-form GET exposes only this employee and ignores query employee numbers', async () => {
  const f = await registrationFixture();
  try {
    const before = f.sqlite.prepare('SELECT total_changes() n').get().n; f.queries.length = 0;
    const response = await f.get('&employee_no=0002&line_user_id=another-member'); const result = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(result.prefill, expected); assert.deepEqual(f.ensureCalls, ['test-member']);
    const serialized = JSON.stringify(result);
    for (const privateValue of ['另一名冊員工', '另一名冊部門', 'PRIVATE-FACTORY', 'PRIVATE-BUSINESS', 'PRIVATE-TYPE', '測試 LINE 名稱']) assert.ok(!serialized.includes(privateValue), privateValue);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, before);
    assert.ok(f.queries.every(sql => /^\s*SELECT/i.test(sql)));
    const other = await (await f.get('', 'another-member')).json();
    assert.deepEqual(other.prefill, { department: '另一名冊部門', name: '另一名冊員工', employee_no: '0002' });
  } finally { f.sqlite.close(); }
});

test('invalid LINE identity cannot query roster or receive an employee prefill', async () => {
  const f = await registrationFixture();
  try { f.queries.length = 0; assert.equal((await f.get('&employee_no=0001', 'forged')).status, 403); assert.deepEqual(f.queries, []); assert.deepEqual(f.ensureCalls, []); }
  finally { f.sqlite.close(); }
});

for (const mode of ['empty', 'forged']) test('new POST uses server roster values when client identity answers are ' + mode, async () => {
  const f = await registrationFixture();
  try {
    const submitted = { ...validAnswers, department: mode === 'empty' ? '' : '偽造部門', name: mode === 'empty' ? '' : '偽造姓名', employee_no: mode === 'empty' ? '' : '0002' };
    const response = await f.call('/api/activity-registration', { event_id: 'event-1', revision: 1, employee_no: '0002', line_user_id: 'another-member', answers: submitted }, 'test-member');
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    assert.deepEqual(result.registration.answers, { ...validAnswers, ...expected });
    assert.equal(result.registration.answers.phone, validAnswers.phone);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations').get().n, 1);
    assert.equal(f.sqlite.prepare("SELECT employee_no FROM welfare_members WHERE line_user_id='test-member'").get().employee_no, '0001');
    assert.equal(submitted.employee_no, mode === 'empty' ? '' : '0002');
  } finally { f.sqlite.close(); }
});

test('malformed new POST answers still fail instead of being converted into a prefilled submission', async () => {
  const f = await registrationFixture();
  try {
    for (const answers of [null, [], 'forged']) assert.equal((await f.call('/api/activity-registration', { event_id: 'event-1', revision: 1, answers }, 'test-member')).status, 400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('missing or incomplete roster preserves the existing manual required-field validation', async () => {
  for (const missing of ['table', 'row', 'department']) {
    const f = await registrationFixture({ withRoster: missing !== 'table' });
    try {
      if (missing === 'row') f.sqlite.exec("DELETE FROM employee_roster WHERE employee_no='0001'");
      if (missing === 'department') f.sqlite.exec("UPDATE employee_roster SET department_name='' WHERE employee_no='0001'");
      const result = await (await f.get()).json();
      assert.deepEqual(result.prefill, missing === 'department' ? { name: expected.name, employee_no: '0001' } : {});
      assert.equal((await f.call('/api/activity-registration', { event_id: 'event-1', revision: 1, answers: { ...validAnswers, department: '' } }, 'test-member')).status, 400);
      const saved = await (await f.call('/api/activity-registration', { event_id: 'event-1', revision: 1, answers: validAnswers }, 'test-member')).json();
      assert.equal(saved.success, true); assert.equal(saved.registration.answers.department, validAnswers.department);
    } finally { f.sqlite.close(); }
  }
});

test('unbound or inactive users of a public-audience activity receive no roster data', async () => {
  for (const mutation of ["bind_status='unbound'", "status='inactive'"]) {
    const f = await registrationFixture();
    try {
      f.sqlite.exec("UPDATE welfare_activity_events SET audience_scope='[\"all\"]';UPDATE welfare_members SET " + mutation + " WHERE line_user_id='test-member'");
      const response = await f.get(); assert.equal(response.status, 200); assert.deepEqual((await response.json()).prefill, {});
    } finally { f.sqlite.close(); }
  }
});

test('roster employee values never enter translation requests or translation cache', async () => {
  const f = await registrationFixture(), calls = [], cached = [];
  try {
    f.deps.callAi = async (_env, messages) => { calls.push(messages); return { texts: JSON.parse(messages[1].content).texts.map(text => 'translated: ' + text) }; };
    f.deps.translationCache = { async match() { return null; }, async put(_key, value) { cached.push(await value.text()); } };
    const response = await f.get('&lang=id'); const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.translationStatus, 'translated'); assert.deepEqual(result.prefill, expected);
    assert.ok(calls.length > 0);
    for (const privateValue of [expected.name, expected.department, '0001', '測試 LINE 名稱', 'test-member', '另一名冊員工']) { assert.ok(!JSON.stringify(calls).includes(privateValue), privateValue); assert.ok(!JSON.stringify(cached).includes(privateValue), privateValue); }
  } finally { f.sqlite.close(); }
});

test('existing registration GET preserves historical snapshot and answers without consulting current roster', async () => {
  const f = await registrationFixture();
  try {
    const form = f.sqlite.prepare("SELECT schema_json FROM welfare_activity_forms WHERE event_id='event-1'").get();
    const historic = { ...validAnswers, department: '歷史部門', name: '歷史姓名', employee_no: '0999' };
    f.sqlite.prepare('INSERT INTO welfare_activity_registrations(id,event_id,line_user_id,display_name,form_revision,schema_json,answers_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run('historic-registration', 'event-1', 'test-member', '舊LINE暱稱', 1, form.schema_json, JSON.stringify(historic), '2025-01-01T00:00:00Z');
    const before = f.sqlite.prepare("SELECT * FROM welfare_activity_registrations WHERE id='historic-registration'").get(); f.queries.length = 0;
    const result = await (await f.get()).json();
    assert.equal(result.registration.id, before.id); assert.equal(result.registration.created_at, before.created_at);
    assert.deepEqual(result.registration.schema, JSON.parse(before.schema_json)); assert.deepEqual(result.registration.answers, historic);
    assert.equal(Object.hasOwn(result, 'prefill'), false);
    assert.ok(!f.queries.some(sql => /FROM\s+employee_roster\b/i.test(sql)));
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM welfare_activity_registrations WHERE id='historic-registration'").get(), before);
  } finally { f.sqlite.close(); }
});
