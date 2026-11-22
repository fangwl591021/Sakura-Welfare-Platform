import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleEmployeeRosterGet } from '../src/employee-roster-service.js';

const uid = number => 'U' + number.toString(16).padStart(32, '0');
const request = (method = 'GET') => new Request('https://fixture.test/admin-api/employee-roster', { method });
const rosterMigration = readFileSync(new URL('../migrations/0035_employee_roster.sql', import.meta.url), 'utf8');

function fixture({ omitRoster = false, omitMembers = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (!omitRoster) {
    sqlite.exec(rosterMigration);
    const insert = sqlite.prepare('INSERT INTO employee_roster VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    for (let number = 1; number <= 4; number += 1) {
      insert.run(String(number).padStart(4, '0'), 'Synthetic ' + number, 'Test Factory', 'Test Unit', 'D1', 'Test Department', 'employee', 'synthetic.xlsx', 'Synthetic Sheet', number + 1, 'synthetic-source-hash', '2026-10-20T02:00:00Z');
    }
  }
  if (!omitMembers) {
    sqlite.exec(`CREATE TABLE welfare_members (
      id TEXT PRIMARY KEY, employee_no TEXT, line_user_id TEXT UNIQUE, member_type TEXT,
      status TEXT, bind_status TEXT, verified_at TEXT, birthday_mmdd TEXT,
      birthday_mmdd_hash TEXT, display_name TEXT, role TEXT
    );`);
    const insert = sqlite.prepare('INSERT INTO welfare_members VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    insert.run('member-1', '0001', uid(1), 'employee', 'active', 'bound', '2026-10-20T02:00:00Z', '0304', 'private-hash-1', 'Private LINE nickname', 'viewer');
    insert.run('member-2', '0002', uid(2), 'employee', 'inactive', 'bound', '2026-10-20T02:00:00Z', '0506', 'private-hash-2', 'Other private nickname', 'viewer');
    insert.run('outside', 'outside-roster', uid(3), 'employee', 'active', 'bound', '2026-10-20T02:00:00Z', '0708', 'private-hash-3', 'Outside nickname', 'viewer');
  }
  const queries = [];
  let writeAttempts = 0;
  const blocked = () => { writeAttempts += 1; throw new Error('The read-only service attempted a write'); };
  const db = {
    prepare(sql) {
      queries.push(sql);
      assert.match(sql, /^\s*SELECT\b/i, 'the roster endpoint may only prepare SELECT statements');
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        run: blocked,
      };
    },
    batch: blocked,
    exec: blocked,
  };
  sqlite.exec('PRAGMA query_only=ON');
  return { sqlite, db, queries, get writeAttempts() { return writeAttempts; }, close: () => sqlite.close() };
}

function snapshot(f) {
  return {
    roster: f.sqlite.prepare('SELECT * FROM employee_roster ORDER BY source_row').all(),
    members: f.sqlite.prepare('SELECT * FROM welfare_members ORDER BY id').all(),
    changes: f.sqlite.prepare('SELECT total_changes() AS n').get().n,
    schema: f.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all(),
  };
}

test('the GET reads the real SQLite roster and members without writes, upstream access or member creation', async () => {
  const f = fixture(), before = snapshot(f), originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error('No upstream request is permitted for this child-site projection'); };
  try {
    for (let count = 0; count < 2; count += 1) {
      const response = await handleEmployeeRosterGet(request(), f.db);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.success, true);
      assert.equal(result.source, 'child-site');
      assert.deepEqual(result.summary, { total: 4, bound: 1, unbound: 2, review: 1 });
      assert.deepEqual(result.rows.map(row => row.employeeNo), ['0001', '0002', '0003', '0004']);
      assert.deepEqual(result.rows.map(row => row.status), ['bound', 'review', 'unbound', 'unbound']);
      assert.ok(result.rows.filter(row => row.status === 'unbound').every(row => row.reason.includes('子站尚無紀錄')));
      const encoded = JSON.stringify(result);
      for (const value of [uid(1), uid(2), uid(3), 'private-hash-1', 'Private LINE nickname']) assert.equal(encoded.includes(value), false);
      assert.equal(/birthday|line_user_id|lineUserId|birthday_mmdd_hash|source_sha256/.test(encoded), false);
      assert.deepEqual(snapshot(f), before, 'GET must preserve roster, member records, access fields and schema');
    }
    assert.equal(externalCalls, 0);
    assert.equal(f.writeAttempts, 0);
    assert.ok(f.queries.length > 0);
    assert.ok(f.queries.every(sql => /^\s*SELECT\b/i.test(sql)));
  } finally { globalThis.fetch = originalFetch; f.close(); }
});

for (const missing of ['roster', 'members']) {
  test('a missing ' + missing + ' table returns 503 without ensuring or seeding any schema', async () => {
    const f = fixture({ omitRoster: missing === 'roster', omitMembers: missing === 'members' });
    try {
      const before = f.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const beforeChanges = f.sqlite.prepare('SELECT total_changes() AS n').get().n;
      const response = await handleEmployeeRosterGet(request(), f.db);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.success, false);
      assert.equal(JSON.stringify(body).includes('no such table'), false);
      assert.deepEqual(f.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all(), before);
      assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n, beforeChanges);
      assert.equal(f.writeAttempts, 0);
      assert.ok(f.queries.every(sql => /^\s*SELECT\b/i.test(sql)));
    } finally { f.close(); }
  });
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
  test(method + ' is rejected without accessing the database', async () => {
    let reads = 0;
    const db = { prepare() { reads += 1; throw new Error('A rejected method must not query'); } };
    const response = await handleEmployeeRosterGet(request(method), db);
    assert.equal(response.status, 405);
    assert.equal(reads, 0);
  });
}

test('an unrelated database failure returns a generic 500 without exposing SQL or private source data', async () => {
  const privateDetail = 'SELECT secret_column FROM private_source WHERE line_user_id=' + uid(99);
  const db = { prepare() { throw new Error(privateDetail); } };
  const response = await handleEmployeeRosterGet(request(), db);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.success, false);
  const encoded = JSON.stringify(body);
  assert.equal(encoded.includes(privateDetail), false);
  assert.equal(encoded.includes(uid(99)), false);
  assert.equal(encoded.includes('secret_column'), false);
});

test('the actual roster migration adds data-only columns and preserves existing member credentials and access fields', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('CREATE TABLE welfare_members (id TEXT PRIMARY KEY, line_user_id TEXT, member_type TEXT, status TEXT, birthday_mmdd_hash TEXT, role TEXT)');
    sqlite.prepare('INSERT INTO welfare_members VALUES(?,?,?,?,?,?)').run('synthetic', uid(10), 'visitor', 'blocked', 'synthetic-secret-hash', 'viewer');
    const before = sqlite.prepare('SELECT * FROM welfare_members').all();
    sqlite.exec(rosterMigration);
    sqlite.exec(rosterMigration);
    assert.deepEqual(sqlite.prepare('SELECT * FROM welfare_members').all(), before);
    assert.deepEqual(sqlite.prepare('PRAGMA table_info(employee_roster)').all().map(column => column.name).sort(), [
      'employee_no', 'employee_name', 'factory', 'business_unit', 'department_code',
      'department_name', 'identity_type', 'source_file', 'source_sheet', 'source_row',
      'source_sha256', 'imported_at',
    ].sort());
    assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all(), [], 'roster data cannot trigger member creation or entitlement changes');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM employee_roster').get().n, 0);
  } finally { sqlite.close(); }
});
