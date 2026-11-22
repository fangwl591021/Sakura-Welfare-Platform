import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { formatCrmDateTime, decorateCrmUsersHtml } from '../src/employee-binding-ui.js';
import { planAutomaticMotherRows, runEmployeeAutoSync, authorizeEmployeeAutoSync, ensureEmployeeBindingOnAccess, EmployeeBindingAccessError } from '../src/employee-binding-auto-sync.js';
import { BINDING_CHAT_LANGUAGES, bindingChatLanguage, observeBindingChatStart, detectBindingChatResult } from '../src/employee-binding-chat-sync.js';
import { recordBindingCompletion,flushBindingNotifications,readBindingHistory } from '../src/employee-binding-journal.js';

const uid = 'U' + 'a'.repeat(32), other = 'U' + 'b'.repeat(32);
const record = (extra={}) => ({ motherLineId:uid, employeeNo:'1234567', reportedAt:'2026-10-16 15:19:06', motherUserId:'77', displayName:'Synthetic employee', ...extra });
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE system_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT,updated_at TEXT);
    CREATE TABLE welfare_members(id TEXT,line_user_id TEXT UNIQUE,employee_no TEXT,bind_status TEXT,status TEXT,language TEXT,mother_user_id TEXT,mother_reported_at TEXT,updated_at TEXT,member_type TEXT DEFAULT 'employee');
    CREATE TABLE line_threads(source_user_id TEXT);
    CREATE TABLE line_user_profiles(line_user_id TEXT);
    CREATE TABLE rich_menu_switch_checks(line_user_id TEXT,target_alias_id TEXT,checked_at TEXT);
    CREATE TABLE admin_uid_whitelist(line_user_id TEXT,active INTEGER);
    CREATE TABLE welfare_vendors(contact_line_user_id TEXT,submitted_by_line_user_id TEXT);
    CREATE TABLE welfare_audit_events(id TEXT PRIMARY KEY,actor_type TEXT,actor_id TEXT,event_type TEXT,target_type TEXT,target_id TEXT,summary TEXT,raw_json TEXT,created_at TEXT);`);
  sql.prepare('INSERT INTO line_threads VALUES(?)').run(uid);
  const errors=[];
  const db={prepare(query) {
    const exec=(method,args)=>{try{return sql.prepare(query)[method](...args);}catch(error){errors.push({query,error:error.message});throw error;}};
    const bind=(...args)=>({
      first:async()=>exec('get',args)||null,
      all:async()=>({results:exec('all',args)}),
      run:async()=>({meta:{changes:Number(exec('run',args).changes)}})
    });
    return {...bind(),bind};
  }};
  const writes=[], menus=[];
  let rows=[record()], upstreamOk=true;
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function handleEmployeeBindingPullMother('),source.indexOf('\nfunction isEmployeeBindingSyncAuthorized('));
  const pull=vm.runInNewContext('('+fn+')',{
    Request,Set,Date,planAutomaticMotherRows,
    ensureEmployeeBindingMemberColumns:async()=>{},
    getMotherPointLookupConfig:()=>({}),getMotherLineUserApiConfig:()=>({}),
    fetchMotherEmployeeList:async()=>({ok:upstreamOk,rows}),
    normalizeLineUserId:v=>/^U[a-z0-9]{32}$/.test(v)?v:'',
    normalizeEmployeeBindingPayload:r=>({...r,lineUserId:r.line_user_id,employeeNo:r.employee_code,language:r.language}),
    upsertEmployeeBindingMember:async(_db,r)=>{
      writes.push(r);
      sql.prepare(`INSERT INTO welfare_members VALUES(?,?,?,'bound','active',?,?,?,'2026-10-16 16:00:00','employee')
        ON CONFLICT(line_user_id) DO UPDATE SET employee_no=excluded.employee_no,bind_status='bound',mother_user_id=excluded.mother_user_id,mother_reported_at=excluded.mother_reported_at`).run(r.lineUserId,r.lineUserId,r.employeeNo,r.language,r.mother_user_id,r.mother_reported_at);
      return sql.prepare('SELECT * FROM welfare_members WHERE line_user_id=?').get(r.lineUserId);
    },
    applyRichMenuForEmployeeBinding:async(_db,_env,r)=>{menus.push(r);return {applied:true};},
    checkOrCreateMotherLineUser:async()=>{throw Error('Automatic synchronization must not create mother users');},
    recordMotherLineUserCheck:()=>{},
    resolveLineUserIdFromMotherPointLedger:async()=>{throw Error('No point lookup in automatic mode');}
  });
  const run=()=>pull(new Request('https://test/pull',{method:'POST',body:'{}'}),db,{}, {automatic:true});
  const member=(status='active',employeeNo='1234567')=>sql.prepare("INSERT INTO welfare_members VALUES('member',?,?, 'bound',?, 'th','77','2026-10-16 15:19:06','','employee')").run(uid,employeeNo,status);
  return {sql,db,writes,menus,pull,run,member,errors,setRows:v=>{rows=v;},fail:()=>{upstreamOk=false;}};
}

test('UTC ISO times display in Taipei, including crossing midnight and preserving mother wall time',()=>{
  assert.equal(formatCrmDateTime('2026-10-16T08:17:25.614Z'),'2026-10-16 16:17:25');
  assert.equal(formatCrmDateTime('2026-10-16 23:30:00'),'2026-10-17 07:30:00');
  assert.equal(formatCrmDateTime('2026-10-16 15:19:06','Asia/Taipei'),'2026-10-16 15:19:06');
  assert.equal(formatCrmDateTime('2026-10-16T15:19:06+08:00'),'2026-10-16 15:19:06');
  assert.equal(formatCrmDateTime(''),'');assert.equal(formatCrmDateTime('bad time'),'bad time');
});

test('automatic planning rejects name/time-only, unknown UIDs, missing report evidence and ambiguous identity pairs',()=>{
  const known=new Set([uid]);
  for(const r of [record({motherLineId:''}),record({motherLineId:other}),record({reportedAt:''}),record({reportedAt:'invalid'})]) assert.equal(planAutomaticMotherRows([r],known).length,0);
  assert.equal(planAutomaticMotherRows([record(),record({employeeNo:'7654321'})],known).length,0);
  assert.equal(planAutomaticMotherRows([record(),record({motherLineId:other})],known).length,0);
  assert.equal(planAutomaticMotherRows([record(),record()],known).length,1);
});

test('mother-confirmed UID creates the missing child member without a fuzzy time match or mother/point writes',async()=>{
  const f=fixture();try{const r=await f.run();assert.equal(r.bound,1);assert.equal(f.writes[0].lineUserId,uid);assert.equal(f.menus.length,1);assert.equal((await f.run()).bound,0);assert.equal(f.writes.length,1);}finally{f.sql.close();}
});

test('unknown or incomplete mother identities create no member and no menu',async()=>{
  const f=fixture();try{f.setRows([record({motherLineId:other}),record({reportedAt:''}),record({motherLineId:''})]);const r=await f.run();assert.equal(r.bound,0);assert.equal(f.writes.length,0);assert.equal(f.menus.length,0);}finally{f.sql.close();}
});

test('blocked and inactive child members are never reactivated',async()=>{
  for(const state of ['blocked','inactive']){const f=fixture();try{f.member(state);assert.equal((await f.run()).bound,0);assert.equal(f.writes.length,0);assert.equal(f.sql.prepare('SELECT status FROM welfare_members').get().status,state);}finally{f.sql.close();}}
});

test('different employee identities and a code already bound to another UID are left for review',async()=>{
  const f=fixture();try{f.member('active','7654321');assert.equal((await f.run()).bound,0);assert.equal(f.writes.length,0);}finally{f.sql.close();}
  const g=fixture();try{g.sql.prepare("INSERT INTO welfare_members VALUES('other',?,'1234567','bound','active','id','','','','employee')").run(other);assert.equal((await g.run()).bound,0);assert.equal(g.writes.length,0);}finally{g.sql.close();}
});

test('existing language and a recently selected language are preserved',async()=>{
  const f=fixture();try{f.sql.prepare('INSERT INTO rich_menu_switch_checks VALUES(?,?,?)').run(uid,'indo-menu','2026-10-16 15:19:00');await f.run();assert.equal(f.writes[0].language,'id');}finally{f.sql.close();}
  const g=fixture();try{g.member();g.setRows([record({reportedAt:'2026-10-16 16:00:00'})]);await g.run();assert.equal(g.writes[0].language,'th');}finally{g.sql.close();}
});

test('administrator and vendor menus are not overwritten by employee reconciliation',async()=>{
  for(const table of ['admin','vendor']){const f=fixture();try{if(table==='admin')f.sql.prepare('INSERT INTO admin_uid_whitelist VALUES(?,1)').run(uid);else f.sql.prepare('INSERT INTO welfare_vendors VALUES(?,?)').run(uid,uid);assert.equal((await f.run()).bound,1);assert.equal(f.menus.length,0);}finally{f.sql.close();}}
});

test('roster failure reports failure without changing child identity',async()=>{
  const f=fixture();try{f.fail();assert.equal((await f.run()).success,false);assert.equal(f.writes.length,0);}finally{f.sql.close();}
});

test('concurrent auto refreshes use one SQL lease and recent refreshes reuse the result',async()=>{
  const f=fixture();try{let calls=0;const pull=async()=>{calls++;await new Promise(r=>setTimeout(r,15));return {success:true,bound:1};};const now=Date.parse('2026-10-16T08:00:00Z');const results=await Promise.all([runEmployeeAutoSync(f.db,{},pull,now),runEmployeeAutoSync(f.db,{},pull,now)]);assert.equal(calls,1);assert.ok(results.some(r=>r.state==='busy'));assert.equal((await runEmployeeAutoSync(f.db,{},pull,now+1000)).state,'recent');assert.equal(calls,1);}finally{f.sql.close();}
});

test('failed automatic refresh releases its lease, keeps only safe status and retries later',async()=>{
  const f=fixture();try{const now=Date.parse('2026-10-16T08:00:00Z');const a=await runEmployeeAutoSync(f.db,{},async()=>{throw Error('private provider body');},now);assert.equal(a.success,false);assert.ok(!JSON.stringify(a).includes('private'));const b=await runEmployeeAutoSync(f.db,{},async()=>({success:true}),now+60000);assert.equal(b.success,true);}finally{f.sql.close();}
});

test('auto refresh accepts authorized admin sessions and denies anonymous, viewer, cross-origin and unrelated modules',async()=>{
  const req=(headers={})=>new Request('https://test/refresh',{method:'POST',headers});
  const deps={requireAdmin:async d=>({ok:d.sessionToken==='valid',user:{role:'admin'}}),verifyLine:async()=>({lineUserId:uid}),findAdmin:async()=>({active:1,role:'admin',allowed_modules:'visitors'})};
  assert.equal(await authorizeEmployeeAutoSync(req(),{}, {},deps),false);
  assert.equal(await authorizeEmployeeAutoSync(req({Authorization:'Bearer valid'}),{}, {},deps),true);
  assert.equal(await authorizeEmployeeAutoSync(req({Authorization:'Bearer valid',Origin:'https://evil.test'}),{}, {},deps),false);
  assert.equal(await authorizeEmployeeAutoSync(req({'X-Line-Id-Token':'signed'}),{}, {},deps),true);
  for(const row of [{active:1,role:'viewer',allowed_modules:'*'},{active:1,role:'admin',allowed_modules:'clubs'},{active:0,role:'admin',allowed_modules:'*'}]) assert.equal(await authorizeEmployeeAutoSync(req({'X-Line-Id-Token':'signed'}),{}, {},{...deps,findAdmin:async()=>row}),false);
});

test('served CRM script compiles and decorates time, uncertainty labels and selected detail refresh',async()=>{
  const {default:worker}=await import('../src/index.js');
  const html=await (await worker.fetch(new Request('https://test/crm-users'),{},{})).text();
  const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);for(const s of scripts)new vm.Script(s[1]);
  assert.ok(html.includes('待母站確認'));assert.ok(html.includes('母站報到時間'));assert.ok(html.includes('子站同步時間'));
  assert.ok(html.includes('formatCrmDateTime(u.last_interaction_at'));
  assert.ok(html.includes('if (selected) openUser(selected.line_user_id)'));
  assert.ok(html.includes('setInterval(refreshBindingState, 60000)'));
  assert.ok(!decorateCrmUsersHtml('<html></html>').includes('undefined'));
});

test('full Worker refresh persists authoritative mother identity, exposes both times and keeps GET read-only',async()=>{
  const {default:worker}=await import('../src/index.js');
  const f=fixture(), originalFetch=globalThis.fetch;
  try {
    for(const col of ['birthday_mmdd_hash','display_name','picture_url','verified_at','birthday_mmdd','phone','email','tags','created_at']) f.sql.exec(`ALTER TABLE welfare_members ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    f.sql.exec(`CREATE TABLE admin_users(id TEXT,username TEXT,display_name TEXT,role TEXT,business_units TEXT,active INTEGER,line_user_id TEXT DEFAULT '');
      CREATE TABLE admin_sessions(token TEXT,user_id TEXT,expires_at TEXT);
      INSERT INTO admin_users(id,username,display_name,role,business_units,active) VALUES('admin','synthetic','Synthetic','admin','*',1);
      INSERT INTO admin_sessions VALUES('valid','admin','2099-01-01T00:00:00Z');
      CREATE TABLE rich_menu_bindings(id TEXT PRIMARY KEY,target_type TEXT,language TEXT,bind_status TEXT,vendor_status TEXT,admin_role TEXT,rich_menu_alias_id TEXT,rich_menu_id TEXT,priority INTEGER,active INTEGER,description TEXT,apply_timing TEXT,created_at TEXT,updated_at TEXT);
      DROP TABLE rich_menu_switch_checks;
      CREATE TABLE rich_menu_switch_checks(id TEXT PRIMARY KEY,check_group_id TEXT,kind TEXT,line_user_id TEXT,event_id TEXT,source_data TEXT,source_alias_id TEXT,target_alias_id TEXT,project_id TEXT,project_name TEXT,d1_rich_menu_id TEXT,line_rich_menu_id TEXT,line_status INTEGER,switch_status TEXT,latency_ms INTEGER,ok INTEGER,note TEXT,line_event_at TEXT,checked_at TEXT,raw_payload TEXT);`);
    f.sql.prepare("INSERT INTO rich_menu_bindings VALUES('rule-employee-zh','employee','zh-TW','bound','','','twmem-menu',?,77,1,'preserved policy','','2000-01-01','2000-01-01')").run('richmenu-'+'c'.repeat(32));
    const existingRules=JSON.stringify(f.sql.prepare('SELECT * FROM rich_menu_bindings ORDER BY id').all());
    let motherReads=0;
    globalThis.fetch=async(input,options)=>{
      const u=new URL(String(input));assert.equal(u.origin,'https://mother.test');assert.equal(u.searchParams.get('action'),'list');
      assert.equal(options.headers['X-API-KEY'],'synthetic-key');motherReads++;
      return Response.json({data:[{employee_code:'1234567',employee_name:'Synthetic employee',line_id:uid,line_checkin_datetime:'2026-10-16 15:19:06',user_id:'77',is_leave:0}]});
    };
    const env={DB:f.db,MOTHER_MEMBER_API_URL:'https://mother.test/roster',MOTHER_MEMBER_API_KEY:'synthetic-key'};
    const path='https://test/admin-api/employee-binding-sync/refresh';
    assert.equal((await worker.fetch(new Request(path,{method:'POST'}),env,{})).status,403);
    assert.equal(motherReads,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,0);
    const response=await worker.fetch(new Request(path,{method:'POST',headers:{Authorization:'Bearer valid'}}),env,{});
    const result=await response.json();assert.equal(result.bound,1,JSON.stringify({result,errors:f.errors}));assert.equal(motherReads,1);
    const saved=f.sql.prepare('SELECT * FROM welfare_members').get();assert.equal(saved.line_user_id,uid);assert.equal(saved.employee_no,'1234567');assert.equal(saved.bind_status,'bound');
    assert.equal(saved.mother_reported_at,'2026-10-16 15:19:06');assert.ok(saved.verified_at);
    assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM rich_menu_bindings ORDER BY id').all()),existingRules,'Automatic reconciliation must not seed or rewrite menu rules');
    const before=f.sql.prepare('SELECT total_changes() n').get().n;
    const crm=await (await worker.fetch(new Request('https://test/admin-api/crm-users',{headers:{Authorization:'Bearer valid'}}),env,{})).json();
    assert.equal(crm.users[0].bind_status,'bound');assert.equal(crm.users[0].mother_reported_at,'2026-10-16 15:19:06');assert.equal(crm.users[0].verified_at,saved.verified_at);
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
    const waits=[];await worker.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);
    assert.equal(waits.length,3); // Menu checks, employee reconciliation, and push statistics.
  } finally {globalThis.fetch=originalFetch;f.sql.close();}
});

function accessFixture() {
  const f=fixture();
  for(const col of ['birthday_mmdd_hash','display_name','picture_url','verified_at','birthday_mmdd','phone','email','tags','created_at']) f.sql.exec(`ALTER TABLE welfare_members ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  f.sql.exec(`DELETE FROM line_threads;
    CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY,title TEXT,description TEXT,location TEXT,start_at TEXT,end_at TEXT,status TEXT,audience_scope TEXT,
      registration_start_at TEXT DEFAULT '',registration_end_at TEXT DEFAULT '',checkin_start_at TEXT DEFAULT '2020-01-01 00:00:00',checkin_end_at TEXT DEFAULT '2099-01-01 00:00:00',qr_token TEXT DEFAULT 'qr');
    INSERT INTO welfare_activity_events(id,title,description,location,start_at,end_at,status,audience_scope)
      VALUES('event-1','Synthetic employee event','','','2099-01-01 08:00:00','2099-01-01 12:00:00','active','["employee"]');
    CREATE TABLE rich_menu_bindings(id TEXT,target_type TEXT,language TEXT,bind_status TEXT,vendor_status TEXT,admin_role TEXT,rich_menu_alias_id TEXT,rich_menu_id TEXT,priority INTEGER,active INTEGER);
    CREATE TABLE welfare_activity_checkins(id TEXT,event_id TEXT,line_user_id TEXT,display_name TEXT,picture_url TEXT,checkin_status TEXT,checked_at TEXT,raw_payload TEXT,UNIQUE(event_id,line_user_id));`);
  f.sql.exec(readFileSync(new URL('../migrations/0029_activity_registration_forms.sql',import.meta.url),'utf8'));
  f.sql.exec(readFileSync(new URL('../migrations/0034_clubs_and_highlights.sql',import.meta.url),'utf8'));
  f.sql.prepare('INSERT INTO welfare_activity_forms VALUES(?,1,?,\'admin\',\'2026-01-01\')').run('event-1',JSON.stringify({fields:[{id:'name',label:'Name',type:'text',required:true}],rules:[]}));
  f.sql.prepare('INSERT INTO welfare_club_galleries(id,club_id,content_json) VALUES(?,?,?)').run('gallery-1','club-yoga',JSON.stringify({title:'Private album',status:'published',visibility:'employee',media_ids:[]}));
  const upstream=[{employee_code:'1234567',employee_name:'Synthetic employee',line_id:uid,line_checkin_datetime:'2026-10-16 15:19:06',user_id:'77',is_leave:0}];
  let roster=upstream,fail=false,motherReads=0,verifications=0;
  const waits=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input));
    if(u.href==='https://api.line.me/oauth2/v2.1/verify'){
      verifications++; assert.equal(init.method,'POST');
      return new URLSearchParams(init.body).get('id_token')==='valid-line-token' ? Response.json({sub:uid,name:'Synthetic'}) : Response.json({error:'invalid_request'},{status:400});
    }
    assert.equal(u.origin,'https://mother.test','No mother account/point writes or unrelated upstream requests');
    assert.equal(u.searchParams.get('action'),'list');assert.ok(!init.method || init.method==='GET');
    assert.ok(init.signal instanceof AbortSignal);assert.equal(init.headers['Cache-Control'],'no-cache');
    motherReads++; if(fail) return Response.json({success:false},{status:503});
    return Response.json({data:roster});
  };
  const env={DB:f.db,MOTHER_MEMBER_API_URL:'https://mother.test/roster',MOTHER_MEMBER_API_KEY:'synthetic-key'};
  const ctx={waitUntil:p=>waits.push(p)};
  const req=(path='/api/employee-binding/ensure',token='valid-line-token',extra={})=>new Request('https://test'+path,{method:path.includes('/ensure')?'POST':'GET',headers:{Authorization:'Bearer '+token,...extra}});
  return {...f,env,ctx,req,upstream,setRoster:value=>{roster=value;},failMother:()=>{fail=true;},get motherReads(){return motherReads;},get verifications(){return verifications;},
    drain:async()=>{while(waits.length)await Promise.all(waits.splice(0));},
    close:async()=>{while(waits.length)await Promise.all(waits.splice(0));globalThis.fetch=originalFetch;f.sql.close();}};
}

test('actual registration entry binds the verified UID before eligibility even past 2000 mother records and an active batch lease',async()=>{
  const {default:worker}=await import('../src/index.js');const f=accessFixture();
  try {
    f.sql.prepare('INSERT INTO system_settings VALUES(?,?,?)').run('employee_binding_auto_sync_lease',String(Date.now()+120000),'');
    f.sql.prepare('INSERT INTO system_settings VALUES(?,?,?)').run('employee_binding_auto_sync_status',JSON.stringify({checkedAt:new Date().toISOString()}),'');
    const others=Array.from({length:2001},(_,i)=>({...f.upstream[0],employee_code:'other-'+i,line_id:'U'+String(i).padStart(32,'0')}));
    f.setRoster([...others,...f.upstream]);
    const response=await worker.fetch(f.req('/api/activity-registration?event_id=event-1'),f.env,f.ctx);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).event.id,'event-1');
    assert.equal(f.motherReads,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,1);
    const saved=f.sql.prepare('SELECT * FROM welfare_members').get();assert.equal(saved.line_user_id,uid);assert.equal(saved.bind_status,'bound');
    const club=await (await worker.fetch(f.req('/api/clubs'),f.env,f.ctx)).json();
    assert.equal(club.employee,true);assert.equal(club.galleries.length,1);assert.equal(f.motherReads,1,'Existing synchronized employee avoids another mother lookup');
  } finally {await f.close();}
});

test('an unbound access is not cached: mother binding becomes available on the very next request',async()=>{
  const {default:worker}=await import('../src/index.js');const f=accessFixture();
  try {
    f.setRoster([]);assert.equal((await (await worker.fetch(f.req(),f.env,f.ctx)).json()).state,'unbound');
    f.setRoster(f.upstream);assert.equal((await (await worker.fetch(f.req(),f.env,f.ctx)).json()).state,'bound');
    assert.equal(f.motherReads,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,1);
  } finally {await f.close();}
});

test('anonymous, forged token, query UID and cross-origin input never initiate mother lookup or create identity',async()=>{
  const {default:worker}=await import('../src/index.js');const f=accessFixture();
  try {
    for(const r of [f.req('/api/employee-binding/ensure?line_user_id='+uid,'forged'),f.req('/api/employee-binding/ensure',''),f.req('/api/employee-binding/ensure','valid-line-token',{Origin:'https://evil.test'})]){
      assert.equal((await worker.fetch(r,f.env,f.ctx)).status,403);
    }
    const anonymous=await worker.fetch(new Request('https://test/api/clubs'),f.env,f.ctx);
    assert.equal(anonymous.status,200);assert.equal(f.motherReads,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,0);
    const spoofed=await worker.fetch(f.req('/api/employee-binding/ensure?line_user_id='+other),f.env,f.ctx);
    assert.equal((await spoofed.json()).state,'bound');assert.equal(f.sql.prepare('SELECT line_user_id FROM welfare_members').get().line_user_id,uid);
  } finally {await f.close();}
});

test('mother outage returns a retryable 503 before private content, registration, or attendance can be misclassified',async()=>{
  const {default:worker}=await import('../src/index.js');const f=accessFixture();
  try {
    f.failMother();
    for(const path of ['/api/clubs','/api/activity-registration?event_id=event-1','/api/employee-binding/ensure']){
      const response=await worker.fetch(f.req(path),f.env,f.ctx);assert.equal(response.status,503);
      const body=await response.json();assert.equal(body.retryable,true);assert.equal(body.code,'binding_check_unavailable');assert.ok(!JSON.stringify(body).includes('synthetic-key'));
    }
    const checkin=await worker.fetch(new Request('https://test/api/activity-checkin',{method:'POST',body:JSON.stringify({event_id:'event-1',token:'qr',id_token:'valid-line-token'})}),f.env,f.ctx);
    assert.equal((await checkin.json()).code,'binding_check_unavailable');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_activity_checkins').get().n,0);
  } finally {await f.close();}
});

test('ambiguous mother pairs and a code held by another UID return conflict rather than guest fallback',async()=>{
  const {default:worker}=await import('../src/index.js');
  for(const kind of ['two-codes','two-uids','child-conflict']){const f=accessFixture();try{
    if(kind==='two-codes')f.setRoster([...f.upstream,{...f.upstream[0],employee_code:'7654321'}]);
    if(kind==='two-uids')f.setRoster([...f.upstream,{...f.upstream[0],line_id:other}]);
    if(kind==='child-conflict')f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,employee_no,bind_status,status) VALUES('other',?,'1234567','bound','active')").run(other);
    const response=await worker.fetch(f.req('/api/clubs'),f.env,f.ctx);assert.equal(response.status,409);assert.equal((await response.json()).code,'binding_conflict');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members WHERE line_user_id=?').get(uid).n,0);
  }finally{await f.close();}}
});

test('access reconciliation honors blocked accounts and identity persistence survives menu failure',async()=>{
  const f=fixture();try{
    f.member('blocked');assert.deepEqual(await ensureEmployeeBindingOnAccess(f.db,{},uid,()=>{throw Error('must not contact mother');}),{state:'restricted'});
    f.sql.exec('DELETE FROM welfare_members');
    const pull=async()=>{await f.run();return {success:false,failed:1};};
    assert.deepEqual(await ensureEmployeeBindingOnAccess(f.db,{},uid,pull),{state:'bound'});
    await assert.rejects(ensureEmployeeBindingOnAccess(f.db,{},'forged',f.pull),EmployeeBindingAccessError);
  }finally{f.sql.close();}
});

test('automatic SQL guard prevents a concurrent stop or employee-code takeover between read and write',async()=>{
  const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function upsertEmployeeBindingMember('),source.indexOf('\nasync function applyRichMenuForEmployeeBinding('));
  for(const race of ['blocked','other-code','code-held']){const f=accessFixture();try{
    if(race!=='code-held')f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,employee_no,bind_status,status) VALUES('member',?,'','unbound','active')").run(uid);
    const binding={raw:{},lineUserId:uid,employeeNo:'1234567',displayName:'Synthetic',pictureUrl:'',status:'active',phone:'',email:'',language:'th',bindStatus:'bound',motherUserId:'77',motherReportedAt:'2026-10-16 15:19:06',identityType:'employee'};
    const upsert=vm.runInNewContext('('+fn+')',{ensureEmployeeBindingMemberColumns:async()=>{
      if(race==='blocked')f.sql.exec("UPDATE welfare_members SET status='blocked'");
      if(race==='other-code')f.sql.exec("UPDATE welfare_members SET employee_no='7654321'");
      if(race==='code-held')f.sql.prepare("INSERT INTO welfare_members(id,line_user_id,employee_no,status) VALUES('other',?,'1234567','active')").run(other);
    },taiwanNowString:()=> '2026-10-16 17:00:00',uniqueCsv:v=>[v],sha256Hex:async()=>'',recordBindingCompletion:async()=>{}});
    const row=await upsert(f.db,binding,{automatic:true});
    assert.ok(!row || row.bind_status!=='bound');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM welfare_members WHERE line_user_id=? AND employee_no='1234567' AND bind_status='bound'").get(uid).n,0);
  }finally{await f.close();}}
});

test('all changed member-account inline scripts compile in the three supported locales',async()=>{
  const {default:worker}=await import('../src/index.js');
  for(const path of ['/member-app','/member-redemptions','/member-redemptions-id','/member-redemptions-th']){
    const response=await worker.fetch(new Request('https://test'+path),{},{});if(response.status!==200)continue;
    const html=await response.text();for(const [,script]of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
    if(html.includes('async function ensureIdentity()')){assert.ok(html.includes('liff.getIDToken()'));assert.ok(html.includes('headers:lineIdToken'));}
  }
});

test('identity-menu access preserves higher administrator/vendor roles even when mother is unavailable',async()=>{
  for(const role of ['admin','vendor']){const f=fixture();try{
    if(role==='admin')f.sql.prepare('INSERT INTO admin_uid_whitelist VALUES(?,1)').run(uid);
    else f.sql.prepare('INSERT INTO welfare_vendors VALUES(?,?)').run(uid,uid);
    assert.deepEqual(await ensureEmployeeBindingOnAccess(f.db,{},uid,()=>{throw Error('Mother must not delay higher-role menu');},{preserveHigherIdentity:true}),{state:'other_identity'});
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,0);
  }finally{f.sql.close();}}
});

const chat = (extra={}) => ({ LINE_user_id:uid,eventId:'chat-start',sourceType:'user',eventType:'message',messageType:'text',text:'櫻花報到',...extra });
const watchRow = f => JSON.parse(f.sql.prepare("SELECT setting_value FROM system_settings WHERE setting_key LIKE 'employee_binding_chat_watch:%'").get()?.setting_value || 'null');
test('three chat starts match the production menu actions, allowing surrounding spaces but not substring guesses',()=>{
  assert.deepEqual(Object.keys(BINDING_CHAT_LANGUAGES),['櫻花報到','Pendaftaran Bunga Sakura','ลงทะเบียนซากุระ']);
  for(const [text,locale] of Object.entries(BINDING_CHAT_LANGUAGES))assert.equal(bindingChatLanguage(' '+text+' '),locale);
  assert.equal(bindingChatLanguage('pendaftaran bunga sakura'),'id');
  for(const text of ['會員分享','活動簽到','我想櫻花報到','櫻花報到完成','Pendaftaran',''])assert.equal(bindingChatLanguage(text),'');
});

for(const [text,language] of Object.entries(BINDING_CHAT_LANGUAGES))test('chat start '+language+' observes mother flow without granting identity, then synchronizes on its later message',async()=>{
  const f=fixture();try{
    f.setRows([]);assert.equal(await observeBindingChatStart(f.db,chat({text}),true),true);
    assert.equal(watchRow(f).language,language);assert.equal(f.writes.length,0);
    assert.equal((await detectBindingChatResult(f.db,{},chat({text}),true,f.pull,{sleep:async()=>{}})).state,'pending');
    assert.equal(f.writes.length,0,'A registration keyword is not proof of binding');
    f.setRows([record()]);
    const result=await detectBindingChatResult(f.db,{},chat({text:'synthetic completion input',eventId:'chat-complete'}),true,f.pull,{sleep:async()=>{}});
    assert.equal(result.state,'complete');assert.equal(f.writes.length,1);assert.equal(f.writes[0].language,language);
    assert.equal(watchRow(f).state,'complete');
  }finally{f.sql.close();}
});

test('unsigned/group/postback/image/invalid UID and unrelated messages cannot start observation or call mother',async()=>{
  const f=fixture();try{
    for(const item of [chat({sourceType:'group'}),chat({eventType:'postback'}),chat({messageType:'image'}),chat({LINE_user_id:'forged'}),chat({text:'會員分享'}),chat({eventId:''})])assert.equal(await observeBindingChatStart(f.db,item,true),false);
    assert.equal(await observeBindingChatStart(f.db,chat(),false),false);
    let calls=0;const pull=async()=>{calls++;};
    assert.equal((await detectBindingChatResult(f.db,{},chat(),false,pull)).state,'ignored');
    assert.equal((await detectBindingChatResult(f.db,{},chat({text:'ordinary conversation'}),true,pull)).state,'ignored');
    assert.equal(calls,0);assert.equal(watchRow(f),null);
  }finally{f.sql.close();}
});

test('duplicate start and duplicate concurrent completion cannot reset the watch or repeat the binding',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat(),true,1000);
    assert.equal(await observeBindingChatStart(f.db,chat(),true,2000),false);assert.equal(watchRow(f).expiresAt,1801000);
    let calls=0;const pull=async(...args)=>{calls++;return f.pull(...args);};
    const results=await Promise.all([detectBindingChatResult(f.db,{},chat(),true,pull,{now:()=>3000}),detectBindingChatResult(f.db,{},chat(),true,pull,{now:()=>3000})]);
    assert.ok(results.some(r=>r.state==='complete'));assert.equal(calls,1);assert.equal(f.writes.length,1);
    assert.equal(await observeBindingChatStart(f.db,chat(),true,4000),false);assert.equal(watchRow(f).state,'complete');
  }finally{f.sql.close();}
});

test('mother publication arriving just after processing is found by the bounded retry',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat(),true);let calls=0;const sleeps=[];
    const pull=async(...args)=>{calls++;if(calls===1)return {success:true};return f.pull(...args);};
    const result=await detectBindingChatResult(f.db,{},chat(),true,pull,{sleep:async ms=>sleeps.push(ms)});
    assert.equal(result.state,'complete');assert.equal(calls,2);assert.deepEqual(sleeps,[2000]);
    assert.equal(watchRow(f).checks,2);
  }finally{f.sql.close();}
});

test('expired watches stop checking and older redelivery cannot replace a newer language/start',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat({timestamp:1000}),true,1000);
    await observeBindingChatStart(f.db,chat({eventId:'new-start',timestamp:2000,text:'ลงทะเบียนซากุระ'}),true,2000);
    assert.equal(await observeBindingChatStart(f.db,chat({timestamp:1000}),true,3000),false);assert.equal(watchRow(f).language,'th');
    const result=await detectBindingChatResult(f.db,{},chat({eventId:'later'}),true,()=>{throw Error('expired must not call mother');},{now:()=>1802001});
    assert.equal(result.state,'expired');assert.equal(watchRow(f).state,'expired');
  }finally{f.sql.close();}
});

test('API errors retain a pending watch without leaking upstream detail; a later message retries',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat(),true);
    const result=await detectBindingChatResult(f.db,{},chat(),true,()=>{throw Error('private provider body');},{sleep:async()=>{}});
    assert.equal(result.state,'pending');assert.equal(result.checkState,'unavailable');assert.ok(!JSON.stringify(watchRow(f)).includes('private'));
    assert.equal((await detectBindingChatResult(f.db,{},chat({eventId:'retry'}),true,f.pull)).state,'complete');
  }finally{f.sql.close();}
});

test('watch cannot cross LINE UIDs, resolve ambiguous identities, or reactivate a blocked member',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat(),true);
    assert.equal((await detectBindingChatResult(f.db,{},chat({LINE_user_id:other}),true,()=>{throw Error('wrong UID');})).state,'ignored');
    f.setRows([record(),record({employeeNo:'7654321'})]);assert.equal((await detectBindingChatResult(f.db,{},chat(),true,f.pull)).state,'conflict');assert.equal(f.writes.length,0);
  }finally{f.sql.close();}
  const g=fixture();try{
    g.member('blocked');await observeBindingChatStart(g.db,chat(),true);
    assert.equal((await detectBindingChatResult(g.db,{},chat(),true,()=>{throw Error('blocked must not query mother');})).state,'restricted');
    assert.equal(g.sql.prepare('SELECT status FROM welfare_members').get().status,'blocked');
  }finally{g.sql.close();}
});

test('insufficient Worker budget leaves the event unclaimed so a later delivery can check it',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat(),true,1000);
    assert.equal((await detectBindingChatResult(f.db,{},chat(),true,()=>{throw Error('budget');},{now:()=>1000,deadline:2000})).state,'deferred');
    assert.deepEqual(watchRow(f).events,[]);
    assert.equal((await detectBindingChatResult(f.db,{},chat(),true,f.pull,{now:()=>1000,deadline:20000})).state,'complete');
  }finally{f.sql.close();}
});

for(const [text,language] of Object.entries(BINDING_CHAT_LANGUAGES))test('real signed dual webhook preserves mother ownership and detects '+language+' completion after forwarding',async()=>{
  const {default:worker}=await import('../src/index.js');const f=accessFixture();const fixtureFetch=globalThis.fetch;
  try {
    f.sql.exec('DROP TABLE line_threads;DROP TABLE line_user_profiles;');
    for(const file of ['0003_welfare_platform.sql','0004_gpt_line_analysis.sql','0005_line_user_profiles.sql','0006_line_webhook_intake_logs.sql','0007_line_oa_threads.sql','0013_line_keyword_rules.sql']) f.sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
    let published=false;const forwards=[],reads=[],waits=[];
    globalThis.fetch=async(input,init)=>{
      const url=new URL(String(input));
      if(url.origin==='https://mother-webhook.test'){
        assert.equal(init.method,'POST');assert.equal(init.headers['x-line-signature'],createHmac('sha256','synthetic-channel-secret').update(init.body).digest('base64'));
        const event=JSON.parse(init.body).events[0];forwards.push(init.body);
        if(event.message.text==='synthetic completion input')published=true;
        return Response.json({success:true});
      }
      assert.equal(url.origin,'https://mother.test','Child must not send extra LINE replies or write mother accounts/points');
      reads.push(published);assert.ok(forwards.length>0,'Mother forwarding must precede reading the binding result');
      return Response.json({data:published?f.upstream:[]});
    };
    const env={...f.env,LINE_CHANNEL_SECRET:'synthetic-channel-secret',MOTHER_WEBHOOK_URL:'https://mother-webhook.test/receive'};
    const ctx={waitUntil:p=>waits.push(p)};
    const send=async(text,eventId,signed=true)=>{
      const body=JSON.stringify({events:[{type:'message',source:{type:'user',userId:uid},webhookEventId:eventId,timestamp:Date.now(),replyToken:'synthetic-mother-only-reply',message:{type:'text',id:eventId,text}}]});
      const signature=signed?createHmac('sha256','synthetic-channel-secret').update(body).digest('base64'):'forged';
      const response=await worker.fetch(new Request('https://test/line-webhook',{method:'POST',body,headers:{'x-line-signature':signature}}),env,ctx);
      while(waits.length)await Promise.all(waits.splice(0));
      return response;
    };
    assert.equal((await send(text,'forged-start',false)).status,403);assert.equal(forwards.length,0);assert.equal(watchRow(f),null);
    assert.equal((await send(text,'real-start')).status,200);assert.equal(watchRow(f).state,'pending');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM welfare_members').get().n,0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM line_webhook_intake_logs WHERE stage='store_failed'").get().n,0,JSON.stringify(f.errors));
    assert.equal((await send('synthetic completion input','real-complete')).status,200);
    const saved=f.sql.prepare('SELECT * FROM welfare_members WHERE line_user_id=?').get(uid);
    assert.equal(saved.bind_status,'bound');assert.equal(saved.language,language);assert.equal(watchRow(f).state,'complete');assert.ok(reads.some(Boolean));
    const before=reads.length;await send('synthetic completion input','real-complete');assert.equal(reads.length,before,'Duplicate completion does not query again');
  }finally{globalThis.fetch=fixtureFetch;await f.close();}
});

test('binding start history survives a newer watch, and replay does not append duplicate start records',async()=>{
  const f=fixture();try{
    await observeBindingChatStart(f.db,chat({timestamp:1000}),true,1000);
    await observeBindingChatStart(f.db,chat({timestamp:1000}),true,2000);
    await observeBindingChatStart(f.db,chat({timestamp:3000,eventId:'new-start'}),true,3000);
    const rows=f.sql.prepare("SELECT * FROM welfare_audit_events WHERE event_type='employee.binding.started'").all();
    assert.equal(rows.length,2);assert.ok(rows.every(r=>!r.raw_json.includes('birthday')));
  }finally{f.sql.close();}
});
const journalMember={line_user_id:uid,member_type:'employee',status:'active',bind_status:'bound',employee_no:'1234567',
  display_name:'Synthetic employee',language:'id',mother_reported_at:'2026-10-16 15:19:06',verified_at:'2026-10-16 19:00:00',birthday_mmdd:'private-birthday',phone:'private-phone'};
test('same authoritative binding creates one durable completion/outbox without birthday, phone or credentials',async()=>{
  const f=fixture();try{
    assert.equal(await recordBindingCompletion(f.db,journalMember),await recordBindingCompletion(f.db,journalMember,'chat_checkin'));
    const rows=f.sql.prepare('SELECT * FROM welfare_audit_events').all();assert.equal(rows.length,1);
    assert.ok(!rows[0].raw_json.includes('private-'));assert.equal(JSON.parse(rows[0].raw_json).notification.state,'pending');
    assert.equal(await recordBindingCompletion(f.db,{...journalMember,status:'blocked'}),null);
  }finally{f.sql.close();}
});
test('concurrent Telegram dispatch and replay send a completed binding only once',async()=>{
  const f=fixture();try{
    await recordBindingCompletion(f.db,journalMember);let sends=0;
    const send=async(_db,_env,key,lines)=>{sends++;assert.equal(key,'telegram_notify_employee_binding');assert.ok(lines.some(l=>l.includes('Synthetic')));assert.ok(!lines.join('').includes('private-'));await new Promise(r=>setTimeout(r,5));return {ok:true,status:200};};
    await Promise.all([flushBindingNotifications(f.db,{},send),flushBindingNotifications(f.db,{},send)]);
    await flushBindingNotifications(f.db,{},send);assert.equal(sends,1);
    assert.equal(JSON.parse(f.sql.prepare('SELECT raw_json FROM welfare_audit_events').get().raw_json).notification.state,'sent');
  }finally{f.sql.close();}
});
test('Telegram 429 waits before retry, while ambiguous delivery is recorded and never blindly resent',async()=>{
  for(const scenario of ['rate-limit','unknown']){const f=fixture();try{
    await recordBindingCompletion(f.db,journalMember);let sends=0;
    const now=Date.now(),send=async()=>{sends++;return sends===1?(scenario==='rate-limit'?{ok:false,status:429}:{ok:false,status:0}):{ok:true,status:200};};
    await flushBindingNotifications(f.db,{},send,now);await flushBindingNotifications(f.db,{},send,now+1000);assert.equal(sends,1);
    await flushBindingNotifications(f.db,{},send,now+61000);assert.equal(sends,scenario==='rate-limit'?2:1);
    const state=JSON.parse(f.sql.prepare('SELECT raw_json FROM welfare_audit_events').get().raw_json).notification.state;
    assert.equal(state,scenario==='rate-limit'?'sent':'unknown');
  }finally{f.sql.close();}}
});
test('Telegram configuration failure is visible and can recover after configuration becomes available',async()=>{
  const f=fixture();try{
    await recordBindingCompletion(f.db,journalMember);const now=Date.now();
    await flushBindingNotifications(f.db,{},async()=>({skipped:true,reason:'missing_credentials'}),now);
    assert.equal(JSON.parse(f.sql.prepare('SELECT raw_json FROM welfare_audit_events').get().raw_json).notification.state,'missing_credentials');
    await flushBindingNotifications(f.db,{},async()=>({ok:true,status:200}),now+300001);
    assert.equal(JSON.parse(f.sql.prepare('SELECT raw_json FROM welfare_audit_events').get().raw_json).notification.state,'sent');
  }finally{f.sql.close();}
});
test('actual Worker uses the configured Telegram chat after binding, and protected history omits internal payloads',async()=>{
  const {default:worker}=await import('../src/index.js');const f=accessFixture();const previousFetch=globalThis.fetch;
  try{
    f.sql.exec(`CREATE TABLE admin_users(id TEXT,username TEXT,display_name TEXT,role TEXT,business_units TEXT,active INTEGER,line_user_id TEXT DEFAULT '');
      CREATE TABLE admin_sessions(token TEXT,user_id TEXT,expires_at TEXT);
      INSERT INTO admin_users(id,username,display_name,role,business_units,active) VALUES('a','synthetic','Synthetic','admin','*',1);
      INSERT INTO admin_sessions VALUES('history-admin','a','2099-01-01T00:00:00Z');`);
    for(const [key,value]of Object.entries({telegram_enabled:'1',telegram_chat_id:'synthetic-chat',telegram_bot_token:'synthetic-token'}))f.sql.prepare('INSERT INTO system_settings VALUES(?,?,\'\')').run(key,value);
    const sends=[];
    globalThis.fetch=async(input,init)=>{
      if(String(input).startsWith('https://api.telegram.org/')){sends.push(JSON.parse(init.body));assert.ok(init.signal instanceof AbortSignal);return Response.json({ok:true,result:{message_id:123}});}
      return previousFetch(input,init);
    };
    const response=await worker.fetch(f.req(),f.env,f.ctx);assert.equal((await response.json()).state,'bound');await f.drain();
    assert.equal(sends.length,1);assert.equal(sends[0].chat_id,'synthetic-chat');assert.ok(sends[0].text.includes('1234567'));
    await worker.fetch(f.req(),f.env,f.ctx);await f.drain();assert.equal(sends.length,1);
    const history='https://test/admin-api/employee-binding-history';assert.equal((await worker.fetch(new Request(history),f.env,f.ctx)).status,403);
    const records=await (await worker.fetch(new Request(history,{headers:{Authorization:'Bearer history-admin'}}),f.env,f.ctx)).json();
    assert.equal(records.records[0].notification_state,'sent');assert.ok(!JSON.stringify(records).includes('synthetic-token'));
    assert.ok(!Object.hasOwn(records.records[0],'raw_json'));assert.equal((await readBindingHistory(f.db,other)).length,0);
  }finally{globalThis.fetch=previousFetch;await f.close();}
});
