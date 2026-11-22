import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readSegmentAudience, readSegmentRecipientGuard, filterSegmentAudience, normalizeSegmentFilters, segmentOptions, departmentKey } from '../src/segment-audience.js';

// This suite has no production environment or transport. Any accidental fetch is a failure.
globalThis.fetch = () => { throw new Error('Network is forbidden in segment audience tests'); };
const uid = n => 'U' + n.toString(16).padStart(32, '0');
const ids = rows => rows.map(row => row.line_user_id).sort();
const status = value => error => error?.status === value;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE line_user_profiles(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,status_message TEXT,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,member_type TEXT,status TEXT,employee_no TEXT,phone TEXT,email TEXT,language TEXT,bind_status TEXT,verified_at TEXT,tags TEXT,created_at TEXT,updated_at TEXT,
      factory TEXT,business_unit TEXT,department_name TEXT,birthday_mmdd TEXT);
    CREATE TABLE line_threads(id TEXT PRIMARY KEY,source_user_id TEXT,display_name TEXT,picture_url TEXT,summary TEXT,tags TEXT,last_message_at TEXT,updated_at TEXT,created_at TEXT);
    CREATE TABLE line_webhook_events(id TEXT PRIMARY KEY,line_user_id TEXT,message_text TEXT,sentiment_type TEXT,created_at TEXT);`);
  sqlite.exec(readFileSync(new URL('../migrations/0035_employee_roster.sql', import.meta.url), 'utf8'));
  const queries = [];
  const db = { prepare(sql) {
    queries.push(sql); let values = [];
    return { bind(...args) { values = args; return this; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
      async first(column) { const row = sqlite.prepare(sql).get(...values) || null; return column ? row?.[column] ?? null : row; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; } };
  } };
  const profile = (id, data = {}) => {
    const row = { line_user_id: id, display_name: 'LINE 合成暱稱', picture_url: '', status_message: '', status: 'active', created_at: '2026-01-01', updated_at: '2026-01-02', ...data };
    const keys = Object.keys(row); sqlite.prepare(`INSERT INTO line_user_profiles(${keys.join(',')}) VALUES(${keys.map(() => '?')})`).run(...keys.map(key => row[key]));
  };
  const member = (id, data = {}) => {
    const row = { line_user_id: id, display_name: '合成會員', picture_url: '', member_type: 'employee', status: 'active', employee_no: '0001', phone: '', email: '', language: 'zh-TW', bind_status: 'bound', verified_at: '2026-10-20 12:00:00', tags: '', created_at: '2026-01-01', updated_at: '2026-01-02', factory: '錯誤快取廠別', business_unit: '錯誤快取處別', department_name: '錯誤快取部門', birthday_mmdd: 'NEVER SELECT', ...data };
    const keys = Object.keys(row); sqlite.prepare(`INSERT INTO welfare_members(${keys.join(',')}) VALUES(${keys.map(() => '?')})`).run(...keys.map(key => row[key]));
  };
  const roster = (code, data = {}) => {
    const row = { employee_no: code, employee_name: '甲員工真名', factory: '烏日二廠', business_unit: '製造處', department_code: 'D01', department_name: '製造課', ...data };
    const keys = Object.keys(row); sqlite.prepare(`INSERT INTO employee_roster(${keys.join(',')}) VALUES(${keys.map(() => '?')})`).run(...keys.map(key => row[key]));
  };
  const seed = () => {
    member(uid(1), { employee_no: '0001', tags: 'A, B,A' }); roster('0001');
    member(uid(2), { employee_no: '0002', member_type: 'foreign_employee', language: 'id', tags: 'B' }); roster('0002', { employee_name: '乙員工真名', department_code: 'D02', department_name: '生產課' });
    member(uid(3), { employee_no: '0003', member_type: 'manager', tags: 'A' }); roster('0003', { employee_name: '丙員工真名', factory: '神岡廠' });
    member(uid(4), { employee_no: '', member_type: 'visitor', bind_status: 'unbound', tags: 'A' });
    member(uid(5), { employee_no: '', member_type: 'vendor', bind_status: 'unbound', tags: 'C' });
    profile(uid(6), { display_name: '只有 LINE 紀錄的合成用戶' });
    member(uid(7), { employee_no: '0007', tags: 'A' }); // No roster row: valid employee, no organization assignment.
  };
  return { sqlite, db, queries, member, roster, profile, seed, close: () => sqlite.close() };
}

test('audience projection reads true roster organization, preserves zeroes, and performs no writes', async () => {
  const f = fixture();
  try {
    f.seed(); const before = f.sqlite.prepare('SELECT total_changes() n').get().n;
    f.sqlite.exec('PRAGMA query_only=ON');
    const rows = await readSegmentAudience(f.db);
    assert.equal(rows.length, 7);
    const own = rows.find(row => row.line_user_id === uid(1));
    assert.equal(own.employee_no, '0001'); assert.equal(own.employee_name, '甲員工真名');
    assert.equal(own.factory, '烏日二廠'); assert.equal(own.business_unit, '製造處'); assert.equal(own.department_name, '製造課');
    assert.equal(own.department_key, JSON.stringify(['烏日二廠','製造處','D01','製造課']));
    assert.equal(Object.hasOwn(own, 'birthday_mmdd'), false);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, before);
    assert.ok(f.queries.every(sql => /^\s*SELECT\b/i.test(sql)));
  } finally { f.close(); }
});

test('employee family includes active bound employee, foreign employee and manager only', async () => {
  const f = fixture();
  try { f.seed(); assert.deepEqual(ids(filterSegmentAudience(await readSegmentAudience(f.db), { memberType: 'employee' })), [uid(1),uid(2),uid(3),uid(7)]); }
  finally { f.close(); }
});

test('employee language groups only include verified active bound employees with an exact language', async () => {
  const f=fixture(); try {
    f.seed();
    f.member(uid(8),{employee_no:'0008',member_type:'manager',language:'th'});f.roster('0008');
    f.member(uid(9),{employee_no:'0009',member_type:'employee',language:'id'});f.roster('0009');
    f.member(uid(10),{employee_no:'',member_type:'visitor',bind_status:'unbound',language:'id'});
    f.member(uid(11),{employee_no:'0011',member_type:'foreign_employee',bind_status:'unbound',language:'id'});f.roster('0011');
    f.member(uid(12),{employee_no:'0012',member_type:'foreign_employee',status:'inactive',language:'th'});f.roster('0012');
    f.member(uid(13),{employee_no:'0013',member_type:'foreign_employee',language:'ID'});f.roster('0013');
    f.member(uid(14),{employee_no:'0014',member_type:'foreign_employee',language:''});f.roster('0014');
    const rows=await readSegmentAudience(f.db);
    assert.deepEqual(ids(filterSegmentAudience(rows,{memberType:'employee_language_id'})),[uid(2),uid(9)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{memberType:'employee_language_th'})),[uid(8)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{memberType:'employee_language_id',factory:'烏日二廠'})),[uid(2),uid(9)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{memberType:'employee_language_id',selectedLineUserIds:[uid(2)]},{selected:true})),[uid(2)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{memberType:'employee'})),[uid(1),uid(2),uid(3),uid(7),uid(8),uid(9),uid(13),uid(14)]);
    assert.equal(normalizeSegmentFilters({memberType:'employee_language_id'}).memberType,'employee_language_id');
    assert.equal(normalizeSegmentFilters({memberType:'employee_language_th'}).memberType,'employee_language_th');
    assert.throws(()=>normalizeSegmentFilters({memberType:'employee_language_vi'}),status(400));
    const fabricated=[{line_user_id:uid(50),member_type:'employee',bind_status:'bound',member_status:'',language:'id'},
      {line_user_id:uid(51),member_type:'visitor',bind_status:'bound',member_status:'active',language:'id'},
      {line_user_id:uid(52),member_type:'employee',bind_status:'unbound',member_status:'active',language:'id'}];
    assert.deepEqual(filterSegmentAudience(fabricated,{memberType:'employee_language_id'}),[]);
  } finally { f.close(); }
});

test('inactive, explicitly unbound, blank code and denied profile employees cannot enter the audience', async t => {
  for (const [name, data, profileData] of [
    ['inactive', { status: 'inactive' }], ['blocked', { status: 'blocked' }], ['suspended', { status: 'suspended' }],
    ['unbound with code', { bind_status: 'unbound' }], ['blank code', { employee_no: '' }], ['space code', { employee_no: '   ' }],
    ['blocked profile', {}, { status: 'blocked' }], ['missing confirmation', { verified_at: '' }],
    ['invalid confirmation', { verified_at: 'not-a-date' }], ['impossible confirmation', { verified_at: '2026-02-30 12:00:00' }]
  ]) await t.test(name, async () => {
    const f = fixture(); try { f.member(uid(1), data); f.roster('0001'); if (profileData) f.profile(uid(1), profileData); assert.deepEqual(await readSegmentAudience(f.db), []); } finally { f.close(); }
  });
});

test('duplicate employee codes and duplicate trimmed roster matches fail closed', async t => {
  await t.test('two member UIDs share a trimmed code', async () => {
    const f = fixture(); try { f.member(uid(1)); f.member(uid(2), { employee_no: ' 0001 ' }); f.roster('0001'); assert.deepEqual(await readSegmentAudience(f.db), []); } finally { f.close(); }
  });
  await t.test('two roster keys normalize to the same code', async () => {
    const f = fixture(); try { f.member(uid(1)); f.roster('0001'); f.roster(' 0001 ', { factory: '另一廠' }); assert.deepEqual(await readSegmentAudience(f.db), []); } finally { f.close(); }
  });
  await t.test('two member rows normalize to the same LINE UID', async () => {
    const f = fixture(); try { f.member(uid(1)); f.member(' '+uid(1)+' ', { employee_no: '0002' }); f.roster('0001'); f.roster('0002'); assert.deepEqual(await readSegmentAudience(f.db), []); } finally { f.close(); }
  });
});

test('missing roster does not invent organization or prevent general employee targeting', async () => {
  const f = fixture(); try {
    f.member(uid(1)); const rows = await readSegmentAudience(f.db);
    assert.equal(rows.length, 1); assert.equal(rows[0].bind_status, 'bound'); assert.equal(rows[0].factory, '');
    assert.equal(filterSegmentAudience(rows, { memberType: 'employee' }).length, 1);
    assert.equal(filterSegmentAudience(rows, { factory: '烏日二廠' }).length, 0);
    assert.equal(segmentOptions(rows).factories.length, 0);
  } finally { f.close(); }
});

test('factory, business-unit and composite department selections are exact intersecting predicates', async () => {
  const f = fixture(); try {
    f.seed(); const rows = await readSegmentAudience(f.db);
    assert.deepEqual(ids(filterSegmentAudience(rows, { factory: '烏日二廠' })), [uid(1),uid(2)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { factory: '烏日' })), []);
    assert.deepEqual(ids(filterSegmentAudience(rows, { businessUnit: '製造處' })), [uid(1),uid(2),uid(3)]);
    const department = JSON.stringify(['烏日二廠','製造處','D01','製造課']);
    assert.deepEqual(ids(filterSegmentAudience(rows, { factory: '烏日二廠', businessUnit: '製造處', department })), [uid(1)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { factory: '神岡廠', department })), []);
    assert.deepEqual(ids(filterSegmentAudience(rows, { department: '製造課' })), []);
  } finally { f.close(); }
});

test('multiple factories match any exact factory while retaining all other audience predicates', async () => {
  const f=fixture();try{
    f.seed();const rows=await readSegmentAudience(f.db);
    assert.deepEqual(ids(filterSegmentAudience(rows,{factories:['神岡廠','烏日二廠']})),[uid(1),uid(2),uid(3)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{factories:['神岡廠','烏日']})),[uid(3)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{factories:['神岡廠','烏日二廠'],businessUnit:'製造處',tags:['A'],tagMode:'all'})),[uid(1),uid(3)]);
    const department=JSON.stringify(['烏日二廠','製造處','D01','製造課']);
    assert.deepEqual(ids(filterSegmentAudience(rows,{factories:['神岡廠','烏日二廠'],department})),[uid(1)]);
    assert.deepEqual(ids(filterSegmentAudience(rows,{factories:[]})),ids(filterSegmentAudience(rows,{})));
    assert.deepEqual(ids(filterSegmentAudience(rows,{factories:['神岡廠','烏日二廠'],selectedLineUserIds:[uid(1),uid(3),uid(4)]},{selected:true})),[uid(1),uid(3)]);
    const forged=[{line_user_id:uid(20),member_type:'visitor',bind_status:'unbound',member_status:'active',factory:'烏日二廠'}];
    assert.deepEqual(filterSegmentAudience(forged,{factories:['烏日二廠']}),[]);
  }finally{f.close();}
});

test('factory array is bounded, canonical, and cannot conflict with a legacy factory',()=>{
  const input={factories:[' 神岡廠 ','烏日二廠','神岡廠'],factory:''},before=structuredClone(input);
  assert.deepEqual(normalizeSegmentFilters(input).factories,['烏日二廠','神岡廠'].sort());
  assert.deepEqual(input,before);
  assert.equal(normalizeSegmentFilters({factory:'烏日二廠'}).factory,'烏日二廠');
  assert.equal(Object.hasOwn(normalizeSegmentFilters({factory:'烏日二廠'}),'factories'),false);
  for(const value of ['烏日二廠',null,[null],[''],['   '],Array(101).fill('烏日二廠'),['x'.repeat(1001)]]) assert.throws(()=>normalizeSegmentFilters({factories:value}),status(400));
  assert.throws(()=>normalizeSegmentFilters({factory:'神岡廠',factories:['烏日二廠']}),status(400));
  assert.throws(()=>normalizeSegmentFilters({factory:'神岡廠',factories:[]}),status(400));
});

test('organization choices retain parent factory and disambiguate same-named departments', async () => {
  const f = fixture(); try {
    f.seed(); const options = segmentOptions(await readSegmentAudience(f.db));
    assert.deepEqual(options.factories.map(option => option.value).sort(), ['烏日二廠','神岡廠'].sort());
    assert.equal(options.businessUnits.filter(option => option.value === '製造處').length, 2);
    assert.equal(options.departments.filter(option => option.label === 'D01 製造課').length, 2);
    assert.equal(new Set(options.departments.map(option => option.value)).size, 3);
    for (const option of options.departments) { const [factory, unit] = JSON.parse(option.value); assert.equal(option.factory, factory); assert.equal(option.businessUnit, unit); }
  } finally { f.close(); }
});

test('organization choices include roster factories with zero eligible bound LINE users', async () => {
  const f=fixture();try{
    f.member(uid(1));f.roster('0001');f.roster('0900',{factory:'只有未綁定名冊的廠',business_unit:'零人處',department_code:'Z01',department_name:'零人部門'});
    const rows=await readSegmentAudience(f.db),options=segmentOptions(rows);
    assert.equal(rows.length,1);assert.ok(options.factories.some(option=>option.value==='只有未綁定名冊的廠'));
    assert.deepEqual(filterSegmentAudience(rows,{factory:'只有未綁定名冊的廠'}),[]);
  }finally{f.close();}
});

test('tags ANY/ALL combine with organization and keyword searches include employee language and roster fields', async () => {
  const f = fixture(); try {
    f.seed(); const rows = await readSegmentAudience(f.db);
    assert.deepEqual(ids(filterSegmentAudience(rows, { factory: '烏日二廠', tags: ['A','B'], tagMode: 'all' })), [uid(1)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { factory: '烏日二廠', tags: ['A','B'], tagMode: 'any' })), [uid(1),uid(2)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { keyword: '甲員工真名' })), [uid(1)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { keyword: '烏日二廠' })), [uid(1),uid(2)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { keyword: 'ID' })), [uid(2)]);
  } finally { f.close(); }
});

test('confirmed bound/unbound semantics do not fall back to employee number', async () => {
  const f = fixture(); try {
    f.seed(); const rows = await readSegmentAudience(f.db);
    assert.deepEqual(ids(filterSegmentAudience(rows, { bindStatus: 'bound' })), [uid(1),uid(2),uid(3),uid(7)]);
    assert.deepEqual(ids(filterSegmentAudience(rows, { bindStatus: 'unbound' })), [uid(4),uid(5),uid(6)]);
  } finally { f.close(); }
});

test('UID validation and merging across profile/chat/event/member sources produce one recipient', async () => {
  const f = fixture(); try {
    f.member(uid(1)); f.roster('0001'); f.profile(uid(1)); f.profile('invalid-line-id'); f.member('Ushort', { employee_no: '9999' });
    f.sqlite.prepare('INSERT INTO line_threads(id,source_user_id,tags,last_message_at) VALUES(?,?,?,?)').run('thread', uid(1), 'chat', '2026-01-03');
    f.sqlite.prepare('INSERT INTO line_webhook_events(id,line_user_id,message_text,created_at) VALUES(?,?,?,?)').run('event', uid(1), '合成訊息', '2026-01-04');
    const rows = await readSegmentAudience(f.db); assert.deepEqual(ids(rows), [uid(1)]); assert.equal(rows[0].last_message, '合成訊息');
  } finally { f.close(); }
});

test('source reads preserve users beyond the old 2,000-row per-source cutoff', async () => {
  const f = fixture(); try {
    f.sqlite.exec('BEGIN'); for (let n = 1; n <= 2105; n++) f.profile(uid(n), { updated_at: '2026-01-01' }); f.sqlite.exec('COMMIT');
    const rows = await readSegmentAudience(f.db); assert.equal(rows.length, 2105); assert.ok(rows.some(row => row.line_user_id === uid(2105)));
  } finally { f.close(); }
});

test('source failure returns a closed error rather than a silently partial audience', async () => {
  const f = fixture(); try { f.seed(); f.sqlite.exec('DROP TABLE employee_roster'); await assert.rejects(readSegmentAudience(f.db), status(503)); } finally { f.close(); }
});

test('canonical filters reject unknown keys, invalid enums and malformed limits', () => {
  for (const input of [null,[],{factoryTypo:'烏日二廠'},{memberType:'all'},{bindStatus:'approved'},{tagMode:'other'},{factory:['烏日二廠']},{tags:'A,B'}]) assert.throws(() => normalizeSegmentFilters(input), status(400));
  for (const maxRecipients of [0,-1,501,1.5,'not-a-number',NaN,Infinity,null]) assert.throws(() => normalizeSegmentFilters({maxRecipients}), status(400));
  assert.equal(normalizeSegmentFilters({maxRecipients:1}).maxRecipients,1); assert.equal(normalizeSegmentFilters({maxRecipients:500}).maxRecipients,500);
  const original={tags:[' B ','A','A'],selectedLineUserIds:[uid(2),uid(1),uid(1)]}; const saved=structuredClone(original), normalized=normalizeSegmentFilters(original);
  assert.deepEqual(normalized.tags,['A','B']); assert.deepEqual(normalized.selectedLineUserIds,[uid(1),uid(2)]); assert.deepEqual(original,saved);
});

test('explicit empty selection is rejected; selected IDs only intersect the matching audience', async () => {
  const f = fixture(); try {
    f.seed(); const rows = await readSegmentAudience(f.db);
    for (const filters of [{},{selectedLineUserIds:[]}]) assert.throws(() => filterSegmentAudience(rows,filters,{selected:true}),status(400));
    assert.throws(() => normalizeSegmentFilters({selectedLineUserIds:['invalid']}),status(400));
    assert.deepEqual(ids(filterSegmentAudience(rows,{factory:'烏日二廠',selectedLineUserIds:[uid(1),uid(3),uid(999)]},{selected:true})),[uid(1)]);
    assert.deepEqual(filterSegmentAudience([],{selectedLineUserIds:[uid(1)]},{selected:true}),[]);
  } finally { f.close(); }
});

test('filter ordering is deterministic and does not mutate the audience or filters', async () => {
  const f = fixture(); try {
    f.seed(); const rows=await readSegmentAudience(f.db), filters={tags:['A','B'],tagMode:'any'};
    const originalRows=structuredClone(rows), originalFilters=structuredClone(filters);
    const forward=filterSegmentAudience(rows,filters).map(row=>row.line_user_id), reverse=filterSegmentAudience([...rows].reverse(),filters).map(row=>row.line_user_id);
    assert.deepEqual(forward,reverse); assert.deepEqual(rows,originalRows); assert.deepEqual(filters,originalFilters);
    assert.equal(departmentKey({factory:' 烏日二廠 ',business_unit:'製造處',department_code:'D01',department_name:'製造課'}),JSON.stringify(['烏日二廠','製造處','D01','製造課']));
  } finally { f.close(); }
});


test('deployed five-column profile schema loads without inventing friend status and matches recipient guard', async () => {
  const f=fixture();try {
    f.sqlite.exec('ALTER TABLE line_user_profiles DROP COLUMN status; ALTER TABLE line_user_profiles DROP COLUMN created_at;');
    f.member(uid(1));f.roster('0001');f.sqlite.prepare('INSERT INTO line_user_profiles(line_user_id,display_name,picture_url,status_message,updated_at) VALUES(?,?,?,?,?)').run(uid(1),'測試', '', '', '2026-10-30');
    f.member(uid(2),{employee_no:'0002',status:'blocked'});f.roster('0002');
    const rows=await readSegmentAudience(f.db);assert.deepEqual(ids(rows),[uid(1)]);
    assert.equal(rows[0].profile_status,'');
    assert.equal(rows.guards.get(uid(1)),await readSegmentRecipientGuard(f.db,uid(1)));
    assert.ok(f.queries.every(sql=>/^\s*SELECT\b/i.test(sql)));
  } finally {f.close();}
});

test('profile optional fields retain blocked filter and snapshot guard when present', async () => {
  const f=fixture();try {
    f.member(uid(1));f.roster('0001');f.profile(uid(1));
    f.member(uid(2),{employee_no:'0002'});f.roster('0002');f.profile(uid(2),{status:'blocked'});
    const rows=await readSegmentAudience(f.db);assert.deepEqual(ids(rows),[uid(1)]);
    assert.equal(rows[0].profile_status,'active');assert.equal(rows.guards.get(uid(1)),await readSegmentRecipientGuard(f.db,uid(1)));
    f.sqlite.prepare('UPDATE line_user_profiles SET status=? WHERE line_user_id=?').run('blocked',uid(1));
    assert.notEqual(rows.guards.get(uid(1)),await readSegmentRecipientGuard(f.db,uid(1)));
  } finally {f.close();}
});

test('profile schema inspection failure blocks audience and recipient recheck', async () => {
  const bad={prepare(sql){if(sql.includes('pragma_table_info'))return {bind(){return this;},all:async()=>{throw new Error('unavailable')}};throw Error('unexpected');}};
  await assert.rejects(readSegmentAudience(bad),status(503));
  await assert.rejects(readSegmentRecipientGuard(bad,uid(1)),status(503));
});


test('profile alias collisions and missing mandatory columns fail closed',async t=>{
  for(const [name,statement] of [['reserved alias collision','ALTER TABLE line_user_profiles ADD COLUMN __PUSH_GUARD_member_uid TEXT'],['missing required field','ALTER TABLE line_user_profiles DROP COLUMN status_message']]) await t.test(name,async()=>{
    const f=fixture();try{f.member(uid(1));f.roster('0001');f.sqlite.exec(statement);await assert.rejects(readSegmentAudience(f.db),status(503));await assert.rejects(readSegmentRecipientGuard(f.db,uid(1)),status(503));}finally{f.close();}
  });
});

test('recipient recheck uses one D1 query with namespaced fields',async()=>{
 const f=fixture();try{f.member(uid(1));f.roster('0001');f.profile(uid(1));const rows=await readSegmentAudience(f.db),prior=f.queries.length;assert.equal(await readSegmentRecipientGuard(f.db,uid(1)),rows.guards.get(uid(1)));assert.equal(f.queries.length-prior,1);}finally{f.close();}
});


test('case-variant optional profile columns fail closed for audience and guard',async t=>{
  for(const [column,variant] of [['status','STATUS'],['created_at','Created_At']]) await t.test(variant,async()=>{
    const f=fixture();try{f.member(uid(1));f.roster('0001');f.sqlite.exec(`ALTER TABLE line_user_profiles DROP COLUMN ${column}; ALTER TABLE line_user_profiles ADD COLUMN ${variant} TEXT;`);await assert.rejects(readSegmentAudience(f.db),status(503));await assert.rejects(readSegmentRecipientGuard(f.db,uid(1)),status(503));}finally{f.close();}
  });
});
