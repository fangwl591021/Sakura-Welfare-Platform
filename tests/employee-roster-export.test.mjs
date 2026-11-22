import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleEmployeeRosterGet } from '../src/employee-roster-service.js';
import { buildRosterWorkbook } from '../src/activity-roster-xlsx.js';

export function zipParts(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const start = offset + 30 + length + extra;
    files.set(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + length)), new TextDecoder().decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  return files;
}

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0035_employee_roster.sql', import.meta.url), 'utf8'));
  sql.exec('CREATE TABLE welfare_members(employee_no TEXT,line_user_id TEXT,member_type TEXT,status TEXT,bind_status TEXT,verified_at TEXT,birthday_mmdd TEXT,display_name TEXT)');
  const insert = sql.prepare('INSERT INTO employee_roster VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const member = sql.prepare('INSERT INTO welfare_members VALUES (?,?,?,?,?,?,?,?)');
  for (let i = 1; i <= 1245; i++) {
    const code = String(i).padStart(6, '0');
    insert.run(code, i === 1 ? '=HYPERLINK("https://attack.invalid")' : '測試員工' + i, i % 2 ? 'A廠' : 'B廠', '測試處', 'D0' + i % 3, '測試部門', '', 'private-source.xlsx', 'source', i + 1, 'private-source-hash', '2026-10-22T00:00:00Z');
    if (i <= 302) member.run(code, 'U' + i.toString(16).padStart(32, '0'), 'employee', i > 299 ? 'inactive' : 'active', 'bound', new Date(Date.UTC(2026, 9, 22, 0, 0, i)).toISOString(), 'PRIVATE_BIRTHDAY', 'PRIVATE_LINE_NAME');
  }
  const db = { prepare(query) {
    assert.match(query.trim(), /^SELECT\b/i);
    return { async all() { return { results: sql.prepare(query).all() }; } };
  } };
  return { sql, db, call: query => handleEmployeeRosterGet(new Request('https://roster.test/admin-api/employee-roster?' + query), db) };
}
const bytes = async response => new Uint8Array(await response.arrayBuffer());
const sheet = async response => zipParts(await bytes(response)).get('xl/worksheets/sheet1.xml');
const codes = xml => [...xml.matchAll(/<c r="A[0-9]+"[^>]*><is><t[^>]*>([0-9]+)<\/t>/g)].map(match => match[1]);

test('XLSX includes all 1245 safe rows with text codes, three statuses, blank missing time and genuine Taipei date cells', async () => {
  const f = fixture();
  try {
    const before = f.sql.prepare('SELECT total_changes() n').get().n;
    const response = await f.call('format=xlsx&page=9&pageSize=50');
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Roster-Count'), '1245');
    assert.match(response.headers.get('Content-Type'), /spreadsheetml.sheet/);
    assert.match(response.headers.get('Content-Disposition'), /^attachment; filename="employee-roster-[0-9]+\.xlsx"$/);
    const parts = zipParts(await bytes(response)), xml = parts.get('xl/worksheets/sheet1.xml');
    assert.equal(codes(xml).length, 1245); assert.equal(codes(xml)[1244], '001245');
    assert.match(parts.get('xl/workbook.xml'), /sheet name="員工名冊"/);
    for (const field of ['工號', '姓名', '廠別', '處別', '部門', '身分類別', '子站綁定', '最後確認（臺北）', '說明', '已綁定', '未綁定', '待確認']) assert.ok(xml.includes(field), field);
    assert.match(xml, /r="H304" s="0"\/>/); // unbound row, true blank time
    assert.match(xml, /r="F2" s="0"\/>/); // unspecified identity remains blank
    assert.match(xml, /<c r="B2" s="0" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
    assert.doesNotMatch([...parts.values()].join(''), /<f[ >]|<hyperlink|PRIVATE_|private-source|line_user_id|birthday_mmdd|U000000/);
    const serial = Number(xml.match(/r="H2" s="2" t="n"><v>([^<]+)/)[1]);
    assert.ok(Math.abs(serial - (Date.UTC(2026,9,22,8,0,1)/86400000+25569)) < 1e-8);
    assert.match(xml, /<pane ySplit="1"/); assert.match(xml, /autoFilter ref="A1:I1246"/);
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n, before);
  } finally { f.sql.close(); }
});

test('export intersects search/factory/status, sorts the full filtered set both ways and retains source order and blanks last', async () => {
  const f = fixture();
  try {
    const expected = Array.from({length:299},(_,i)=>i+1).filter(i=>i%2 && i%3===1).map(i=>String(i).padStart(6,'0'));
    const params = new URLSearchParams({format:'xlsx',query:'D01',factory:'A廠',status:'bound',sort:'desc'});
    assert.deepEqual(codes(await sheet(await f.call(params))), [...expected].reverse());
    params.set('sort','asc'); assert.deepEqual(codes(await sheet(await f.call(params))), expected);
    const xml = await sheet(await f.call('format=xlsx&sort=desc'));
    assert.equal(codes(xml)[0], '000299'); assert.equal(codes(xml)[299], '000300');
    assert.equal(codes(await sheet(await f.call('format=xlsx')))[0], '000001');
    const empty = await f.call('format=xlsx&query=NO_MATCH'); assert.equal(empty.headers.get('X-Roster-Count'),'0');
    assert.match(await sheet(empty), /dimension ref="A1:I1"/);
    const chinese = await f.call('format=xlsx&query='+encodeURIComponent('測試員工1245'));
    assert.deepEqual(codes(await sheet(chinese)), ['001245']);
    for (const query of ['format=xlsx&status=forged','format=xlsx&sort=forged']) assert.equal((await f.call(query)).status,400);
  } finally { f.sql.close(); }
});

test('identity type is an exact intersecting export filter over every matching record, without writes', async () => {
  const f = fixture();
  try {
    f.sql.exec("UPDATE employee_roster SET identity_type=CASE WHEN CAST(employee_no AS INTEGER)%5=0 THEN '台灣-產學生' WHEN CAST(employee_no AS INTEGER)%3=0 THEN '印尼' ELSE '台灣' END");
    const before = f.sql.prepare('SELECT total_changes() n').get().n;
    const allTaiwan = Array.from({length:1245}, (_, i) => i + 1).filter(i => i % 5 !== 0 && i % 3 !== 0).map(i => String(i).padStart(6, '0'));
    const response = await f.call(new URLSearchParams({format:'xlsx',identityType:'台灣',page:'9',pageSize:'50'}));
    assert.equal(response.headers.get('X-Roster-Count'), String(allTaiwan.length));
    assert.ok(allTaiwan.length > 100, 'identity export must include matches beyond the displayed page');
    const xml = await sheet(response);
    assert.deepEqual(codes(xml), allTaiwan);
    assert.doesNotMatch(xml, /台灣-產學生|印尼/);

    const params = new URLSearchParams({format:'xlsx',identityType:'台灣',query:'D01',factory:'A廠',status:'bound',sort:'desc'});
    const combined = Array.from({length:299}, (_, i) => i + 1).filter(i => i % 2 && i % 3 === 1 && i % 5 !== 0).map(i => String(i).padStart(6, '0'));
    assert.deepEqual(codes(await sheet(await f.call(params))), combined.reverse());
    const students = Array.from({length:1245}, (_, i) => i + 1).filter(i => i % 5 === 0).map(i => String(i).padStart(6, '0'));
    assert.deepEqual(codes(await sheet(await f.call(new URLSearchParams({format:'xlsx',identityType:'台灣-產學生'})))), students);
    const missing = await f.call(new URLSearchParams({format:'xlsx',identityType:'台灣%'}));
    assert.equal(missing.headers.get('X-Roster-Count'), '0');
    assert.match(await sheet(missing), /dimension ref="A1:I1"/);
    assert.equal((await f.call('format=xlsx')).headers.get('X-Roster-Count'), '1245');
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n, before);
  } finally { f.sql.close(); }
});

test('download rereads current records and refuses oversized cells instead of truncating', async () => {
  const f=fixture();
  try {
    assert.equal((await(await f.call('')).json()).summary.bound,299);
    f.sql.exec("UPDATE welfare_members SET status='active' WHERE employee_no='000300'");
    assert.equal((await f.call('format=xlsx&status=bound')).headers.get('X-Roster-Count'),'300');
    f.sql.prepare('UPDATE employee_roster SET employee_name=? WHERE employee_no=?').run('X'.repeat(32768),'000001');
    const response = await f.call('format=xlsx'); assert.equal(response.status,422);
    assert.equal(response.headers.has('Content-Disposition'),false); assert.match((await response.json()).message,/超過 Excel 上限/);
  } finally { f.sql.close(); }
});

test('shared writer preserves activity defaults and escapes optional worksheet names without permitting invalid names', () => {
  assert.match(zipParts(buildRosterWorkbook(['a'],[])).get('xl/workbook.xml'), /name="報名出席名單"/);
  assert.match(zipParts(buildRosterWorkbook(['a'],[],{sheetName:'名冊 & "備註"'})).get('xl/workbook.xml'), /name="名冊 &amp; &quot;備註&quot;"/);
  for (const sheetName of ['','A/B','A'.repeat(32)]) assert.throws(()=>buildRosterWorkbook(['a'],[],{sheetName}),RangeError);
});
