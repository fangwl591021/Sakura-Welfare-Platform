import test from "node:test";
import assert from "node:assert/strict";
import { fixture, familyForm, validAnswers } from "./activity-form.test.mjs";
import { buildActivityRosterCsv, buildActivityRosterPrint, buildActivityRosterXlsx } from "../src/activity-roster-export.js";

const path = format => "/admin-api/activity-form?event_id=event-1&export=" + format;
const sample = { display_name: "測試會員", created_at: "2026-09-30T01:02:03Z", schema_json: JSON.stringify(familyForm), answers_json: JSON.stringify(validAnswers) };
function insert(f, id, row = sample, eventId = "event-1") {
  f.sqlite.prepare(`INSERT INTO welfare_activity_registrations
    (id,event_id,line_user_id,display_name,form_revision,schema_json,answers_json,created_at) VALUES(?,?,?,?,1,?,?,?)`)
    .run(id, eventId, "synthetic-" + id, row.display_name, row.schema_json, row.answers_json, row.created_at);
}

for (const format of ["xlsx", "csv", "print"]) {
  test("roster " + format + " denies non-admin before querying data", async () => {
    const f = fixture();
    try {
      for (const token of ["", "expired", "test-member"]) {
        assert.equal((await f.call(path(format), null, token, { "X-Line-Id-Token": "test-member" })).status, 403);
      }
      assert.deepEqual(f.queries, []);
    } finally { f.sqlite.close(); }
  });
  test("roster " + format + " exports all registrations, not the UI's latest 100", async () => {
    const f = fixture();
    try {
      for (let i = 0; i < 105; i++) insert(f, String(i).padStart(3, "0"), { ...sample, display_name: "Member-" + i });
      const response = await f.call(path(format));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.match(response.headers.get("Content-Disposition"), /^attachment;.*filename\*=UTF-8''/);
      const text = format === "xlsx" ? new TextDecoder().decode(await response.arrayBuffer()) : await response.text();
      assert.match(text, /Member-0/); assert.match(text, /Member-104/);
      assert.match(text, /簽到／簽名/); assert.match(text, /員工姓名/); assert.match(text, /0900000000/);
      assert.doesNotMatch(text, /synthetic-|test-admin|line_user_id/);
      assert.ok(f.queries.every(q => /^SELECT/i.test(q)));
      if (format === "print") assert.equal((text.match(/<td class="signature"><\/td>/g) || []).length, 105);
      else if (format === "csv") assert.equal(text.trim().split("\r\n").length, 106);
      else assert.match(response.headers.get("Content-Type"), /spreadsheetml.sheet/);
    } finally { f.sqlite.close(); }
  });
}

test("LINE admin authorization retains activity module permission", async () => {
  const f = fixture();
  try {
    assert.equal((await f.call(path("csv"), null, "", { "X-Line-Id-Token": "line-admin" })).status, 200);
    f.queries.length = 0;
    f.deps.findAdmin = async () => ({ active: 1, allowed_modules: "vendors" });
    assert.equal((await f.call(path("csv"), null, "", { "X-Line-Id-Token": "line-admin" })).status, 403);
    assert.deepEqual(f.queries, []);
  } finally { f.sqlite.close(); }
});

test("empty, missing event and invalid export format are explicit", async () => {
  const f = fixture();
  try {
    assert.match(await (await f.call(path("print"))).text(), /目前沒有報名資料/);
    assert.equal((await f.call(path("csv").replace("event-1", "missing"))).status, 404);
    assert.equal((await f.call(path("pdf"))).status, 400);
    assert.ok(f.queries.every(q => /^SELECT/i.test(q)));
  } finally { f.sqlite.close(); }
});

test("query filters other events and uses deterministic registration order", async () => {
  const f = fixture();
  try {
    f.sqlite.prepare("INSERT INTO welfare_activity_events(id,title) VALUES('event-2','Other')").run();
    insert(f, "other", { ...sample, display_name: "DO-NOT-EXPORT" }, "event-2");
    insert(f, "z", { ...sample, display_name: "Later" }); insert(f, "a", { ...sample, display_name: "First" });
    const csv = await (await f.call(path("csv"))).text();
    assert.doesNotMatch(csv, /DO-NOT-EXPORT/); assert.ok(csv.indexOf("First") < csv.indexOf("Later"));
  } finally { f.sqlite.close(); }
});

test("CSV preserves historical form fields, arrays, zeros, newlines and quotes safely", () => {
  const before = structuredClone(sample);
  const newer = { ...sample, schema_json: JSON.stringify({ fields: [{ id: "name", label: "更名欄位", type: "text" }, { id: "food", label: "餐點", type: "multiselect" }] }),
    answers_json: JSON.stringify({ name: 'A,"B"\nC', food: ["飯", "麵"] }) };
  const csv = buildActivityRosterCsv([sample, newer]);
  assert.ok(csv.startsWith("\uFEFF"));
  for (const text of ["員工姓名", "更名欄位", "餐點", "飯、麵", '"A,""B""\nC"', '"0"', '"\'0001"', '"\'0900000000"']) assert.ok(csv.includes(text), text);
  assert.deepEqual(sample, before);
  assert.ok(csv.split("\r\n").filter(Boolean).every(line => line.endsWith('""') || line.endsWith('"簽到／簽名"')));
});

test("CSV blocks formula injection including labels and leading whitespace", () => {
  for (const text of ["=1+1", "+SUM(1)", "-1+1", "@SUM(1)", " \t=1", "\n=1"]) {
    const row = { ...sample, display_name: text, schema_json: JSON.stringify({ fields: [{ id: "x", label: text, type: "text" }] }), answers_json: JSON.stringify({ x: text }) };
    assert.equal((buildActivityRosterCsv([row]).match(/"'/g) || []).length, 3);
  }
});

test("print sheet escapes all user data, retains multiline answers and blank signatures", () => {
  const unsafe = '<img src=x onerror="alert(1)">';
  const row = { ...sample, display_name: unsafe, schema_json: JSON.stringify({ fields: [{ id: "x", label: unsafe, type: "textarea" }] }), answers_json: JSON.stringify({ x: unsafe + "\n第二行" }) };
  const html = buildActivityRosterPrint({ title: unsafe, location: unsafe, start_at: "2026-09-30 09:00:00" }, [row]);
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
  assert.match(html, /第二行/); assert.match(html, /09:00:00/);
  assert.match(html, /size:A4 portrait/); assert.match(html, /display:table-header-group/);
  assert.match(html, /<td class="signature"><\/td>/);
});

test("roster service fails safely on corrupt saved schema or DB error", async () => {
  const f = fixture();
  try {
    insert(f, "bad", { ...sample, schema_json: "broken" });
    assert.equal((await f.call(path("csv"))).status, 503);
    f.db.prepare = () => { throw new Error("secret-database-detail"); };
    const response = await f.call(path("print"));
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret-database-detail/);
  } finally { f.sqlite.close(); }
});

test("over-limit roster is rejected instead of silently downloading a partial list", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10001)
      INSERT INTO welfare_activity_registrations(id,event_id,line_user_id,display_name,form_revision,schema_json,answers_json,created_at)
      SELECT CAST(x AS TEXT),'event-1',CAST(x AS TEXT),'synthetic',1,'{"fields":[]}','{}','2026-09-30T00:00:00Z' FROM n`);
    const response = await f.call(path("csv"));
    assert.equal(response.status, 413); assert.equal(response.headers.has("Content-Disposition"), false);
  } finally { f.sqlite.close(); }
});

function zipParts(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const filename = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    files.set(filename, new TextDecoder().decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  return files;
}

test('Excel and CSV export recorded actual attendance without inferring or changing legacy records', async () => {
  const f = fixture();
  try {
    for (const id of ['actual', 'legacy', 'bad', 'absent']) insert(f, id, { ...sample, display_name: id });
    const add = f.sqlite.prepare('INSERT INTO welfare_activity_checkins(id,event_id,line_user_id,checked_at,raw_payload) VALUES(?,?,?,?,?)');
    add.run('a', 'event-1', 'synthetic-actual', '2026-10-21 13:04:05', JSON.stringify({ attendance_count: 3, private_note: 'DO-NOT-EXPORT' }));
    add.run('b', 'event-1', 'synthetic-legacy', '2026-10-21 13:04:05', '{}');
    add.run('c', 'event-1', 'synthetic-bad', '2026-10-21 13:04:05', '{bad');
    const before = JSON.stringify(f.sqlite.prepare('SELECT * FROM welfare_activity_checkins ORDER BY id').all());
    const csv = await (await f.call(path('csv'))).text();
    assert.match(csv, /"簽到時間（臺北）","實到人數"/);
    const lines = csv.split('\r\n');
    assert.match(lines.find(line => line.includes('"actual"')), /"已簽到","[^"]+","3"/);
    for (const name of ['legacy', 'bad', 'absent']) assert.match(lines.find(line => line.includes('"' + name + '"')), /"(?:已簽到|未簽到)","[^"]*",""/);
    const response = await f.call(path('xlsx'));
    const sheet = zipParts(new Uint8Array(await response.arrayBuffer())).get('xl/worksheets/sheet1.xml');
    assert.match(sheet, /實到人數/);
    assert.match(sheet, /<c r="F3"[^>]*t="n"><v>3<\/v><\/c>/);
    assert.doesNotMatch(sheet, /DO-NOT-EXPORT/);
    assert.doesNotMatch(csv, /DO-NOT-EXPORT/);
    assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM welfare_activity_checkins ORDER BY id').all()), before);
    assert.ok(f.queries.every(sql => /^SELECT/i.test(sql)));
  } finally { f.sqlite.close(); }
});

test('actual attendance column avoids duplicate form labels and ignores invalid counts', () => {
  const row = { ...sample, checkin_id: 'check', schema_json: JSON.stringify({ fields: [{ id: 'n', label: '實到人數', type: 'text' }] }), answers_json: '{"n":"4"}' };
  for (const value of [0, -1, 1.5, 10001, '3', null]) {
    const csv = buildActivityRosterCsv([{ ...row, checkin_payload: JSON.stringify({ attendance_count: value }) }]);
    assert.match(csv, /"實到人數","實到人數（欄位 1）"/);
    assert.match(csv.split('\r\n')[1], /"已簽到","","","4"/);
  }
});

test('attendance joins by activity and verified stored UID, retains every registration and is read-only', async () => {
  const f = fixture();
  try {
    insert(f, 'present'); insert(f, 'absent');
    f.sqlite.exec("INSERT INTO welfare_activity_events(id,title) VALUES('other-event','Other')");
    f.sqlite.exec("INSERT INTO welfare_activity_checkins(id,event_id,line_user_id,checked_at) VALUES('checked','event-1','synthetic-present','2026-10-21 13:04:05'),('other','other-event','synthetic-absent','2026-10-21 14:00:00'),('walk-in','event-1','not-registered','2026-10-21 15:00:00')");
    const before = JSON.stringify(f.sqlite.prepare('SELECT * FROM welfare_activity_checkins ORDER BY id').all());
    const result = await (await f.call('/admin-api/activity-form?event_id=event-1')).json();
    assert.equal(result.registration_count, 2); assert.equal(result.checked_in_count, 1); assert.equal(result.not_checked_in_count, 1);
    assert.equal(result.registrations.find(row => row.display_name === sample.display_name && row.id === 'present').checked_at, '2026-10-21 13:04:05');
    assert.equal(result.registrations.find(row => row.id === 'absent').checked_in, false);
    assert.equal(result.registrations.find(row => row.id === 'absent').checked_at, '');
    for (const format of ['xlsx', 'csv', 'print']) {
      const response = await f.call(path(format)); assert.equal(response.status, 200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = format === 'xlsx' ? zipParts(bytes).get('xl/worksheets/sheet1.xml') : new TextDecoder().decode(bytes);
      assert.match(text, /出席狀況/); assert.match(text, /簽到時間（臺北）/); assert.match(text, /已簽到/); assert.match(text, /未簽到/);
      assert.doesNotMatch(text, /not-registered|synthetic-|14:00:00|15:00:00/);
      if (format !== 'xlsx') assert.match(text, /13:04:05/);
    }
    assert.equal(JSON.stringify(f.sqlite.prepare('SELECT * FROM welfare_activity_checkins ORDER BY id').all()), before);
    assert.ok(f.queries.every(sql => /^SELECT/i.test(sql)));
  } finally { f.sqlite.close(); }
});

test('all roster pages expose attendance totals and current status after a new check-in', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 105; i++) insert(f, String(i).padStart(3, '0'));
    const first = await (await f.call('/admin-api/activity-form?event_id=event-1')).json();
    const second = await (await f.call('/admin-api/activity-form?event_id=event-1&roster_page=2')).json();
    assert.equal(first.roster_pages, 2); assert.equal(first.roster_page, 1); assert.equal(first.registrations.length, 100);
    assert.equal(second.roster_page, 2); assert.equal(second.registrations.length, 5);
    assert.equal(new Set([...first.registrations, ...second.registrations].map(r => r.id)).size, 105);
    f.sqlite.exec("INSERT INTO welfare_activity_checkins(id,event_id,line_user_id,checked_at) VALUES('new','event-1','synthetic-000','2026-10-21 12:34:56')");
    const refreshed = await (await f.call('/admin-api/activity-form?event_id=event-1&roster_page=2')).json();
    assert.equal(refreshed.checked_in_count, 1); assert.equal(refreshed.not_checked_in_count, 104);
    assert.equal(refreshed.registrations.find(r => r.id === '000').checked_at, '2026-10-21 12:34:56');
    for (const page of ['0', '-1', 'NaN', '1.5']) assert.equal((await f.call('/admin-api/activity-form?event_id=event-1&roster_page=' + page)).status, 400);
    assert.equal((await (await f.call('/admin-api/activity-form?event_id=event-1&roster_page=99')).json()).roster_page, 2);
  } finally { f.sqlite.close(); }
});

test('native XLSX keeps literal formulas, leading zeros, historical fields, real dates and filter/freeze metadata', () => {
  const row = { ...sample, display_name: '=HYPERLINK("https://example.invalid")', checkin_id: 'checked', checked_at: '2026-10-21T05:04:05Z' };
  const parts = zipParts(buildActivityRosterXlsx([row]));
  assert.equal(parts.size, 6);
  const sheet = parts.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  assert.match(sheet, />0001<\/t>/); assert.match(sheet, />0900000000<\/t>/);
  assert.doesNotMatch(sheet, /<f[ >]|<hyperlink[ >]|<externalLink/);
  assert.match(sheet, /<pane ySplit="1"/); assert.match(sheet, /<autoFilter ref="A1:/);
  const cell = sheet.match(/<c r="E2" s="2" t="n"><v>([^<]+)<\/v>/);
  assert.ok(cell); assert.ok(Math.abs(Number(cell[1]) - (Date.UTC(2026,9,21,13,4,5) / 86400000 + 25569)) < 1e-8);
  assert.match(parts.get('xl/styles.xml'), /yyyy\/mm\/dd hh:mm:ss/);
  const same = zipParts(buildActivityRosterXlsx([{ ...row, checked_at: '2026-10-21 13:04:05' }])).get('xl/worksheets/sheet1.xml');
  assert.equal(same, sheet, 'offset-free Taipei and UTC represent the same time');
});

test('Excel rejects oversized cells instead of silently truncating saved answers', async () => {
  const row = { ...sample, display_name: 'A'.repeat(32768) };
  assert.throws(() => buildActivityRosterXlsx([row]), /超過 Excel 上限/);
  const f = fixture();
  try { insert(f, 'large', row); const response = await f.call(path('xlsx')); assert.equal(response.status, 413); assert.equal(response.headers.has('Content-Disposition'), false); }
  finally { f.sqlite.close(); }
});
