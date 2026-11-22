import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/index.js';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE admin_users(id TEXT,username TEXT,display_name TEXT,role TEXT,business_units TEXT,line_user_id TEXT,active INTEGER);
    CREATE TABLE admin_sessions(token TEXT,user_id TEXT,expires_at TEXT);
    CREATE TABLE admin_uid_whitelist(line_user_id TEXT,role TEXT,allowed_modules TEXT,active INTEGER);
    CREATE TABLE admin_user_permissions(user_id TEXT,business_unit TEXT,review_stage TEXT,active INTEGER);
    CREATE TABLE welfare_members(employee_no TEXT,line_user_id TEXT,member_type TEXT,status TEXT,bind_status TEXT,verified_at TEXT);
    INSERT INTO admin_users VALUES('owner','owner','Owner','admin','*','',1);
    INSERT INTO admin_sessions VALUES('owner-token','owner','2099-01-01T00:00:00Z');
    INSERT INTO admin_users VALUES('viewer','viewer','Viewer','viewer','*','',1);
    INSERT INTO admin_sessions VALUES('viewer-token','viewer','2099-01-01T00:00:00Z');`);
  for (const role of ['welfare_editor','activity_editor','club_editor']) {
    const uid='U'+role[0].repeat(32);
    sql.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?,?,1)').run(role,role,role,role,'*',uid);
    sql.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(role+'-token',role,'2099-01-01T00:00:00Z');
    sql.prepare('INSERT INTO admin_uid_whitelist VALUES(?,?,?,1)').run(uid,role,'*');
  }
  const db={prepare(text) {
    // This fixture refuses every mutation even through authentication code.
    assert.match(text.trim(),/^SELECT\b/i);
    let params=[];
    return {bind(...values){params=values;return this;},async first(){return sql.prepare(text).get(...params)||null;},async all(){return {results:sql.prepare(text).all(...params)};}};
  }};
  const call=(path,token='owner-token',options={})=>worker.fetch(new Request('https://roster.test'+path,{...options,headers:{...(token?{Authorization:'Bearer '+token}:{}),...options.headers}}),{DB:db},{});
  return {sql,call};
}

test('full Worker route denies anonymous, forged, viewer, editor and cross-site roster access without writes',async()=>{
  const f=fixture();try{
    const before=f.sql.prepare('SELECT total_changes() n').get().n;
    for (const token of ['', 'forged', 'viewer-token','welfare_editor-token','activity_editor-token','club_editor-token']) {
      const response=await f.call('/admin-api/employee-roster',token);
      const exportResponse=await f.call('/admin-api/employee-roster?format=xlsx',token);
      assert.equal(exportResponse.status,403); assert.equal(exportResponse.headers.has('Content-Disposition'),false);
      assert.equal(response.status,403,token||'anonymous');
      assert.equal(response.headers.get('Cache-Control'),'no-store');
    }
    for (const headers of [{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}]) { assert.equal((await f.call('/admin-api/employee-roster','owner-token',{headers})).status,403); assert.equal((await f.call('/admin-api/employee-roster?format=xlsx','owner-token',{headers})).status,403); }
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
  }finally{f.sql.close();}
});

test('authorized full Worker GET reads only roster and existing members; POST cannot mutate or sync',async()=>{
  const f=fixture();try{
    f.sql.exec(readFileSync(new URL('../migrations/0035_employee_roster.sql',import.meta.url),'utf8'));
    f.sql.prepare('INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name,identity_type,source_file,source_sheet,source_row,source_sha256,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('001','Test employee','A','B','D','Department','employee','synthetic.xlsx','test',2,'0'.repeat(64),'2026-10-20T00:00:00Z');
    const before=f.sql.prepare('SELECT total_changes() n').get().n;
    const response=await f.call('/admin-api/employee-roster');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const body=await response.json();assert.equal(body.summary.total,1);assert.equal(body.rows[0].employeeNo,'001');assert.equal(body.rows[0].status,'unbound');
    const exported=await f.call('/admin-api/employee-roster?format=xlsx'); assert.equal(exported.status,200); assert.equal(exported.headers.get('X-Roster-Count'),'1');
    assert.equal((await f.call('/admin-api/employee-roster','owner-token',{method:'POST',body:'{}'})).status,405);
    assert.equal((await f.call('/admin-api/employee-roster?format=xlsx','owner-token',{method:'POST',body:'{}'})).status,405);
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
  }finally{f.sql.close();}
});

test('absent roster returns503 without implicitly creating a table',async()=>{
  const f=fixture();try{assert.equal((await f.call('/admin-api/employee-roster')).status,503);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='employee_roster'").get().n,0);}finally{f.sql.close();}
});

test('served roster shell has return/navigation, no employee data or automatic mother-sync and valid scripts',async()=>{
  const response=await worker.fetch(new Request('https://roster.test/crm-users?view=roster'),{},{});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  const html=await response.text();assert.match(html,/\/sakura-admin/);assert.match(html,/\/crm-users\?view=line/);
  assert.ok(!html.includes('/employee-binding-sync/refresh'));assert.ok(!html.includes('/employee-binding-pull-mother'));
  for(const [,script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
  const legacy=await(await worker.fetch(new Request('https://roster.test/crm-users?view=line'),{},{})).text();
  assert.match(legacy,/\/crm-users\?view=roster/);assert.match(legacy,/employee-binding-sync\/refresh/);
});
