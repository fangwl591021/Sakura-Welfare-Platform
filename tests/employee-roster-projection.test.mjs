import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeRosterProjection } from '../src/employee-roster-service.js';

const uid = number => 'U' + number.toString(16).padStart(32, '0');
const verifiedAt = '2026-10-20T02:00:00.000Z';
const master = (employeeNo = '0001', extra = {}) => ({
  employee_no: employeeNo, employee_name: 'Synthetic Employee', factory: 'Synthetic Factory',
  business_unit: 'Synthetic Unit', department_code: 'D01', department_name: 'Synthetic Department',
  identity_type: 'employee', source_row: 2, ...extra,
});
const member = (employeeNo = '0001', extra = {}) => ({
  id: 'synthetic-member-' + employeeNo, employee_no: employeeNo, line_user_id: uid(1),
  member_type: 'employee', status: 'active', bind_status: 'bound', verified_at: verifiedAt,
  display_name: 'LINE nickname', birthday_mmdd: '0304', birthday_mmdd_hash: 'synthetic-private-hash',
  mother_reported_at: '', ...extra,
});
const project = (members = [], roster = [master()]) => buildEmployeeRosterProjection(roster, members);
const projected = members => project(members).rows[0];

test('local projection keeps all 1245 master rows in source order without creating missing members', () => {
  const roster = Array.from({ length: 1245 }, (_, index) => master(String(index + 1).padStart(5, '0'), { source_row: index + 2 }));
  const members = [
    member('00001', { line_user_id: uid(1) }),
    member('00002', { line_user_id: uid(2), status: 'inactive' }),
    member('00003', { line_user_id: '' }),
    member('outside-master', { line_user_id: uid(4) }),
  ];
  const before = structuredClone({ roster, members });
  const result = project(members, roster);
  assert.equal(result.success, true);
  assert.equal(result.source, 'child-site');
  assert.deepEqual(result.summary, { total: 1245, bound: 1, unbound: 1242, review: 2 });
  assert.equal(result.rows.length, 1245);
  assert.deepEqual(result.rows.map(row => row.employeeNo), roster.map(row => row.employee_no));
  assert.deepEqual(result.rows.map(row => row.sourceRow), roster.map(row => row.source_row));
  assert.deepEqual({ roster, members }, before, 'projection must not edit either input or add a member');
  for (let index = 0; index < roster.length; index += 1) {
    for (const [output, input] of Object.entries({ employeeNo: 'employee_no', name: 'employee_name', factory: 'factory', businessUnit: 'business_unit', departmentCode: 'department_code', departmentName: 'department_name', identityType: 'identity_type', sourceRow: 'source_row' })) {
      assert.equal(result.rows[index][output], roster[index][input]);
    }
  }
});

test('a roster employee with no local member is unbound only in the child-site sense', () => {
  const row = projected([]);
  assert.equal(row.status, 'unbound');
  assert.equal(row.statusLabel, '未綁定');
  assert.match(row.reason, /子站尚無紀錄/);
  assert.equal(row.verifiedAt, '');
});

for (const type of ['employee', 'foreign_employee', 'manager']) {
  test('a unique valid active bound ' + type + ' is bound from existing child evidence', () => {
    const row = projected([member('0001', { member_type: type })]);
    assert.equal(row.status, 'bound');
    assert.equal(row.statusLabel, '已綁定');
    assert.equal(row.verifiedAt, verifiedAt);
  });
}

test('a different LINE nickname cannot defeat an exact verified employee-number match', () => {
  assert.equal(projected([member('0001', { display_name: 'A completely different nickname' })]).status, 'bound');
});

test('matching names and birthdays never join a different employee number', () => {
  const result = project([member('other-number', { display_name: 'Synthetic Employee' })], [master('0001', { birthday_mmdd: '0304' })]);
  assert.equal(result.rows[0].status, 'unbound');
  assert.match(result.rows[0].reason, /子站尚無紀錄/);
});

test('employee numbers preserve leading zeroes and never use numeric fuzzy matching', () => {
  const result = project([member('1')], [master('0001'), master('1', { source_row: 3 })]);
  assert.deepEqual(result.rows.map(row => [row.employeeNo, row.status]), [['0001', 'unbound'], ['1', 'bound']]);
});

for (const [description, extra] of [
  ['only an employee number', { line_user_id: '', bind_status: '', verified_at: '' }],
  ['a missing LINE UID', { line_user_id: '' }],
  ['an invalid LINE UID', { line_user_id: 'U-not-valid' }],
  ['a missing bound state', { bind_status: '' }],
  ['an unbound state', { bind_status: 'unbound' }],
  ['a missing verification time', { verified_at: '' }],
  ['an invalid verification time', { verified_at: 'not a timestamp' }],
  ['an impossible verification date', { verified_at: '2026-02-30T02:00:00Z' }],
  ['a date without a verification time', { verified_at: '2026-10-20' }],
  ['an inactive account', { status: 'inactive' }],
  ['a blocked account', { status: 'blocked' }],
  ['an unknown account state', { status: '' }],
  ['a visitor account', { member_type: 'visitor' }],
  ['a vendor account', { member_type: 'vendor' }],
  ['a committee account', { member_type: 'committee' }],
]) {
  test(description + ' requires review rather than implying a verified employee binding', () => {
    const row = projected([member('0001', extra)]);
    assert.equal(row.status, 'review');
    assert.equal(row.statusLabel, '待確認');
    assert.ok(row.reason);
  });
}

test('duplicate local employee numbers require review even when every repeated UID is identical', () => {
  for (const second of [member(), member('0001', { line_user_id: uid(2) })]) {
    const row = projected([member(), second]);
    assert.equal(row.status, 'review');
  }
});

test('a LINE UID used by another local employee requires review including employees outside the roster', () => {
  assert.equal(projected([member(), member('outside-roster')]).status, 'review');
});

test('duplicate master employee numbers remain present but cannot become definitive bindings', () => {
  const rows = project([member()], [master(), master('0001', { source_row: 3 })]).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.status), ['review', 'review']);
  assert.deepEqual(rows.map(row => row.sourceRow), [2, 3]);
});

test('a missing master employee number remains in the projection for review', () => {
  const row = project([], [master('')]).rows[0];
  assert.equal(row.employeeNo, '');
  assert.equal(row.status, 'review');
});

test('roster identity labels never grant access or change existing member roles', () => {
  const members = [member('0001', { member_type: 'visitor', role: 'viewer' })];
  const before = structuredClone(members);
  const row = project(members, [master('0001', { identity_type: 'manager' })]).rows[0];
  assert.equal(row.status, 'review');
  assert.deepEqual(members, before);
  for (const key of ['role', 'permissions', 'employee', 'memberId', 'member_type']) assert.equal(Object.hasOwn(row, key), false);
});

test('the response whitelists roster display fields and never exposes birthdays, UIDs, hashes or raw member rows', () => {
  const roster = [master('0001', { birthday: '2000-03-04', birthday_mmdd: '0304', line_user_id: uid(9), role: 'admin' })];
  const result = project([member()], roster);
  assert.deepEqual(Object.keys(result.rows[0]).sort(), [
    'employeeNo', 'name', 'factory', 'businessUnit', 'departmentCode', 'departmentName',
    'identityType', 'sourceRow', 'status', 'statusLabel', 'reason', 'verifiedAt',
  ].sort());
  const encoded = JSON.stringify(result);
  for (const privateValue of [uid(1), uid(9), '2000-03-04', 'synthetic-private-hash', 'LINE nickname']) assert.equal(encoded.includes(privateValue), false);
  assert.equal(/birthday|line_user_id|lineUserId|birthday_mmdd_hash/.test(encoded), false);
});

test('an empty roster stays empty even when local bound members exist', () => {
  const result = project([member()], []);
  assert.deepEqual(result.summary, { total: 0, bound: 0, unbound: 0, review: 0 });
  assert.deepEqual(result.rows, []);
});
