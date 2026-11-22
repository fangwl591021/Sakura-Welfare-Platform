import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import worker from '../src/index.js';import {clubFixture} from './club-fixture.mjs';
import {EDITOR_ROLES,editorMayAccess,activityScopeSql,readBoundedAdminJson} from '../src/editor-access.js';

export const roleUid=role=>'U'+({'welfare_editor':'a','activity_editor':'b','club_editor':'c','owner':'d'}[role]).repeat(32);
export function editorFixture(){
 const f=clubFixture(),sql=f.sqlite;
 for(const [column,definition]of [['password',"TEXT DEFAULT ''"],['login_method',"TEXT DEFAULT 'line'"],['updated_at',"TEXT DEFAULT ''"]])sql.exec('ALTER TABLE admin_users ADD COLUMN '+column+' '+definition);
 sql.exec(readFileSync(new URL('../migrations/0003_admin_activity_logs.sql',import.meta.url),'utf8'));
 sql.exec(`CREATE TABLE admin_uid_whitelist(id INTEGER PRIMARY KEY AUTOINCREMENT,line_user_id TEXT UNIQUE,display_name TEXT,role TEXT,allowed_modules TEXT,active INTEGER,note TEXT DEFAULT '',created_at TEXT,updated_at TEXT);
 CREATE TABLE admin_user_permissions(user_id TEXT,business_unit TEXT,review_stage TEXT,active INTEGER);
 CREATE TABLE welfare_audit_events(id TEXT PRIMARY KEY,actor_type TEXT,actor_id TEXT,event_type TEXT,target_type TEXT,target_id TEXT,summary TEXT,raw_json TEXT,created_at TEXT);
 CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER DEFAULT 0);
 CREATE TABLE welfare_offers(id TEXT PRIMARY KEY,vendor_id TEXT,title TEXT,category TEXT,description TEXT,original_price REAL,employee_price REAL,visitor_price REAL,discount_type TEXT,discount_value REAL,status TEXT,review_note TEXT,starts_at TEXT,ends_at TEXT,source_image_url TEXT,ai_ocr_json TEXT,public_title TEXT,public_description TEXT,employee_discount_label TEXT,visitor_discount_label TEXT,usage_limit TEXT,redemption_method TEXT,qr_enabled INTEGER,employee_only INTEGER,publish_channels TEXT,approved_by TEXT,approved_at TEXT,created_at TEXT,updated_at TEXT);
 INSERT INTO welfare_vendors VALUES('vendor-1','測試特約店','approved',0);
 INSERT INTO welfare_vendors VALUES('vendor-hidden','隱藏廠商','approved',1);
 INSERT INTO welfare_vendors VALUES('vendor-pending','待審廠商','pending',0);
 INSERT INTO welfare_activity_events(id,title,description,location,start_at,end_at,status,audience_scope,checkin_start_at,checkin_end_at) VALUES('club-event','社團活動','社團資料','會場','2099-01-01 09:00:00','2099-01-01 12:00:00','active','["employee"]','2020-01-01 00:00:00','2099-01-01 12:00:00');
 UPDATE welfare_activity_events SET qr_token='club-qr' WHERE id='club-event';
 INSERT INTO welfare_activity_club_links(id,club_id,content_json) VALUES('club-event','club-yoga','{"club_id":"club-yoga","kind":"club","mode":"registration"}');
 INSERT INTO welfare_activity_checkins(id,event_id,line_user_id,display_name,checked_at) VALUES('company-check','event-1','private-company-uid','一般活動限定名冊','2026-01-01');
 INSERT INTO welfare_activity_checkins(id,event_id,line_user_id,display_name,checked_at) VALUES('club-check','club-event','private-club-uid','社團限定名冊','2026-01-01');`);
 for(const role of [...Object.keys(EDITOR_ROLES),'owner']){
  const uid=roleUid(role),actualRole=role==='owner'?'admin':role,modules=EDITOR_ROLES[role]?.modules.join(',')||'*';
  sql.prepare('INSERT INTO admin_users(id,username,display_name,role,business_units,active,line_user_id) VALUES(?,?,?,?,?,1,?)').run(role,role,role,actualRole,modules,uid);
  sql.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run('session-'+role,role,'2099-01-01T00:00:00Z');
  sql.prepare('INSERT INTO admin_uid_whitelist(line_user_id,display_name,role,allowed_modules,active) VALUES(?,?,?,?,1)').run(uid,role,actualRole,modules);
 }
 const req=(path,role='owner',data,extra={})=>new Request('https://activity.test'+path,{method:data?'POST':'GET',headers:{...(role?{Authorization:'Bearer session-'+role}:{}),...(data?{'Content-Type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
 const call=(path,role,data,extra)=>worker.fetch(req(path,role,data,extra),f.env,{});
 return {...f,req,call};
}

test('three editor presets have fixed non-overlapping units and exclude all administrative controls',()=>{
 assert.deepEqual(Object.values(EDITOR_ROLES).map(r=>r.label),['福利小編','活動小編','社團小編']);
 for(const role of Object.keys(EDITOR_ROLES))for(const path of ['/admin-api/admin-uid-whitelist','/admin-api/system-settings','/admin-api/crm-users','/admin-api/rich-menu-bindings','/admin-api/vendor-management','/admin-api/vendor-pos-discounts'])assert.equal(editorMayAccess(role,path,'POST'),false,role+path);
 assert.equal(editorMayAccess('welfare_editor','/admin-api/clubs'),false);assert.equal(editorMayAccess('activity_editor','/admin-api/clubs'),false);assert.equal(editorMayAccess('club_editor','/admin-api/editor-welfare'),false);
});
test('management APIs reject anonymous, expired, forged and cross-origin credentials before writes',async()=>{
 const f=editorFixture();try{const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 for(const role of ['', 'forged'])for(const path of ['/admin-api/editor-context','/admin-api/clubs','/admin-api/admin-uid-whitelist','/admin-api/system-settings','/workspace-api/activities','/api/line-oa/threads','/api/line-oa/profile-debug'])assert.equal((await f.call(path,role)).status,403,path);
 assert.equal((await f.call('/admin-api/clubs','club_editor',null,{Origin:'https://evil.test'})).status,403);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
 }finally{f.close();}
});
test('owner receives three presets without granting anyone; editor context is limited to the verified role',async()=>{
 const f=editorFixture();try{
 const before=f.sqlite.prepare('SELECT COUNT(*) n FROM admin_uid_whitelist').get().n;
 const result=await(await f.call('/admin-api/admin-uid-whitelist','owner')).json();assert.equal(result.editorPresets.length,3);
 for(const role of Object.keys(EDITOR_ROLES)){const r=await(await f.call('/admin-api/editor-context',role)).json();assert.equal(r.role,role);assert.equal(r.preset.label,EDITOR_ROLES[role].label);assert.equal(r.presets,undefined);}
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM admin_uid_whitelist').get().n,before);
 }finally{f.close();}
});
test('role templates override client wildcard modules and downgrade pre-existing broad sessions atomically',async()=>{
 const f=editorFixture();try{
 f.sqlite.prepare("UPDATE admin_users SET role='admin',business_units='*' WHERE id='activity_editor'").run();
 const row=f.sqlite.prepare('SELECT id FROM admin_uid_whitelist WHERE line_user_id=?').get(roleUid('activity_editor'));
 const r=await(await f.call('/admin-api/admin-uid-whitelist','owner',{action:'save',id:row.id,line_user_id:roleUid('activity_editor'),role:'activity_editor',allowed_modules:'*',active:1})).json();assert.equal(r.success,true);
 assert.equal(f.sqlite.prepare('SELECT allowed_modules FROM admin_uid_whitelist WHERE id=?').get(row.id).allowed_modules,'activities');assert.equal(f.sqlite.prepare("SELECT role FROM admin_users WHERE id='activity_editor'").get().role,'activity_editor');
 assert.equal((await f.call('/admin-api/admin-uid-whitelist','activity_editor',{action:'save',role:'admin'})).status,403);
 f.sqlite.prepare('DELETE FROM admin_uid_whitelist WHERE id=?').run(row.id);assert.equal((await f.call('/admin-api/activity-checkin','activity_editor')).status,403);
 }finally{f.close();}
});
test('disabling or switching an editor whitelist immediately changes an existing session',async()=>{
 const f=editorFixture();try{
 const uid=roleUid('club_editor');f.sqlite.prepare('UPDATE admin_uid_whitelist SET active=0 WHERE line_user_id=?').run(uid);assert.equal((await f.call('/admin-api/clubs','club_editor')).status,403);
 f.sqlite.prepare("UPDATE admin_uid_whitelist SET active=1,role='activity_editor' WHERE line_user_id=?").run(uid);
 assert.equal((await f.call('/admin-api/clubs','club_editor')).status,403);assert.equal((await(await f.call('/admin-api/editor-context','club_editor')).json()).role,'activity_editor');
 }finally{f.close();}
});
test('general and club activity lists, attendance and QR summaries contain only their own unit',async()=>{
 const f=editorFixture();try{for(const [role,own,other,forbidden]of [['activity_editor','event-1','club-event','社團限定名冊'],['club_editor','club-event','event-1','一般活動限定名冊']]){
 const r=await f.call('/admin-api/activity-checkin',role);assert.equal(r.status,200);const view=await r.json();assert.equal(view.success,true,JSON.stringify(view));assert.deepEqual(view.events.map(e=>e.id),[own]);assert.ok(!JSON.stringify(view).includes(forbidden));
 assert.equal((await f.call('/admin-api/activity-checkin?event_id='+other,role)).status,403);
 const qr=await(await f.call('/admin-api/activity-qr-checkin',role)).json();assert.deepEqual(qr.events.map(e=>e.id),[own]);
 assert.equal((await f.call('/admin-api/activity-form?event_id='+other,role)).status,403);
 assert.equal((await f.call('/admin-api/activity-form?event_id='+other+'&export=csv',role)).status,403);
 }}finally{f.close();}
});
test('forged event IDs cannot edit, archive, export, cancel or preview attendance across units',async()=>{
 const f=editorFixture();try{const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
 for(const [role,id]of [['activity_editor','club-event'],['club_editor','event-1']])for(const [path,body]of [
 ['/admin-api/activity-checkin',{action:'save_event',data:{id,title:'forged'}}],['/admin-api/activity-checkin',{action:'delete_event',data:{id}}],
 ['/admin-api/activity-form',{action:'cancel_all_registrations',event_id:id}],['/admin-api/activity-qr-checkin',{action:'preview',event_id:id,qr:'fake'}]
 ])assert.equal((await f.call(path,role,body)).status,403,role+path);
 assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
 }finally{f.close();}
});
test('club editor creates an event and club ownership in one transaction; cannot claim a company event',async()=>{
 const f=editorFixture();try{
 let r=await(await f.call('/admin-api/activity-checkin','club_editor',{action:'save_event',data:{title:'新社團活動'}})).json();assert.equal(r.success,false);
 r=await(await f.call('/admin-api/activity-checkin','club_editor',{action:'save_event',data:{title:'新社團活動',club_id:'club-yoga',start_at:'2099-01-01T08:00',end_at:'2099-01-01T12:00'}})).json();assert.equal(r.success,true,JSON.stringify(r));
 assert.equal(f.sqlite.prepare('SELECT club_id FROM welfare_activity_club_links WHERE id=?').get(r.data.event.id).club_id,'club-yoga');
 const response=await f.call('/admin-api/clubs','club_editor',{kind:'activity',data:{id:'event-1',club_id:'club-yoga',kind:'club',mode:'registration'},revision:0,confirmed:true,request_id:crypto.randomUUID()});assert.equal(response.status,403);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_club_links WHERE id='event-1'").get().n,0);
 }finally{f.close();}
});
test('welfare editor sees only content and approved public vendor choices, with no member or finance data',async()=>{
 const f=editorFixture();try{const r=await f.call('/admin-api/editor-welfare','welfare_editor');assert.equal(r.status,200);const view=await r.json();assert.deepEqual(view.vendors.map(v=>v.id),['vendor-1']);assert.deepEqual(Object.keys(view).sort(),['offers','success','vendors']);assert.equal((await f.call('/admin-api/editor-welfare','activity_editor')).status,403);
 }finally{f.close();}
});
test('welfare draft saves are audited, replay-safe, revision-checked and cannot approve an offer',async()=>{
 const f=editorFixture();try{
 const body={action:'save',request_id:crypto.randomUUID(),revision:'',data:{id:'',vendor_id:'vendor-1',title:'測試優惠',description:'草稿',employee_price:80,visitor_price:100,status:'draft'}};
 const response=await f.call('/admin-api/editor-welfare','welfare_editor',body);let result=await response.json();assert.equal(response.status,200,JSON.stringify(result));const id=result.data.id;
 assert.equal(f.sqlite.prepare('SELECT status FROM welfare_offers WHERE id=?').get(id).status,'draft');assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_audit_events WHERE event_type='editor.offer.save'").get().n,1);
 assert.equal((await(await f.call('/admin-api/editor-welfare','welfare_editor',body)).json()).replayed,true);
 assert.equal((await f.call('/admin-api/editor-welfare','welfare_editor',{...body,request_id:crypto.randomUUID(),data:{...body.data,id,status:'approved'}})).status,403);
 assert.equal((await f.call('/admin-api/editor-welfare','welfare_editor',{...body,request_id:crypto.randomUUID(),data:{...body.data,id,title:'過期覆蓋'}})).status,409);
 f.sqlite.prepare("UPDATE welfare_offers SET status='approved' WHERE id=?").run(id);
 const revision=f.sqlite.prepare('SELECT updated_at FROM welfare_offers WHERE id=?').get(id).updated_at;
 assert.equal((await f.call('/admin-api/editor-welfare','welfare_editor',{...body,request_id:crypto.randomUUID(),revision,data:{...body.data,id}})).status,409);
 }finally{f.close();}
});
test('failed editor audit rolls the content transaction back without partial changes',async()=>{
 const f=editorFixture();try{f.sqlite.exec("CREATE TRIGGER reject_editor_audit BEFORE INSERT ON welfare_audit_events WHEN NEW.event_type='editor.offer.save' BEGIN SELECT RAISE(ABORT,'synthetic audit failure');END;");
 const r=await f.call('/admin-api/editor-welfare','welfare_editor',{action:'save',request_id:crypto.randomUUID(),data:{vendor_id:'vendor-1',title:'不得殘留',status:'draft'}});assert.equal(r.status,503);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_offers').get().n,0);
 }finally{f.close();}
});
test('LINE admin login rejects UID-only and mismatched verified identities before creating a session',async()=>{
 const f=editorFixture(),original=globalThis.fetch;try{const before=f.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n;
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({sub:roleUid('activity_editor')});};
 for(const data of [{lineUserId:roleUid('owner')},{lineUserId:roleUid('owner'),lineIdToken:'synthetic-other-user'}]){
 const r=await(await f.call('/api','',{action:'reviewerLineLogin',data})).json();assert.equal(r.success,false);
 }assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,before);assert.ok(calls<=1);
 }finally{globalThis.fetch=original;f.close();}
});
test('verified LINE editor login uses its fixed role and inactive whitelist cannot mint another session',async()=>{
 const f=editorFixture(),original=globalThis.fetch;try{
 globalThis.fetch=async(url)=>{assert.ok(String(url).startsWith('https://api.line.me/oauth2/v2.1/verify'));return Response.json({sub:roleUid('activity_editor')});};
 let r=await(await f.call('/api','',{action:'reviewerLineLogin',data:{lineUserId:roleUid('activity_editor'),lineIdToken:'synthetic-valid-token'}})).json();assert.equal(r.success,true,JSON.stringify(r));assert.equal(r.data.role,'activity_editor');assert.equal(r.data.allowedModules,'activities');
 const before=f.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n;f.sqlite.prepare('UPDATE admin_uid_whitelist SET active=0 WHERE line_user_id=?').run(roleUid('activity_editor'));
 r=await(await f.call('/api','',{action:'reviewerLineLogin',data:{lineUserId:roleUid('activity_editor'),lineIdToken:'synthetic-valid-token'}})).json();assert.equal(r.success,false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,before);
 }finally{globalThis.fetch=original;f.close();}
});
test('served role pages and whitelist scripts compile with all three options and reachable return controls',async()=>{
 for(const path of ['/admin-uid-whitelist','/editor-workspace','/welfare-editor']){
 const html=await(await worker.fetch(new Request('https://activity.test'+path),{},{})).text();for(const [,script]of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
 assert.match(html,/返回/);if(path==='/admin-uid-whitelist')for(const preset of Object.values(EDITOR_ROLES))assert.ok(html.includes(preset.label));
 }
});

test('bounded streamed clone rejects oversized payload promptly and legacy root payload cannot bypass role gates',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({value:'a'.repeat(70000)}));
 const request=new Request('https://activity.test/admin-api/activity-checkin',{method:'POST',body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),duplex:'half'});
 await assert.rejects(Promise.race([readBoundedAdminJson(request.clone()),new Promise((_,reject)=>setTimeout(()=>reject(Error('body cancellation stalled')),1000))]),e=>e.status===413);
 const f=editorFixture();try{
 for(const role of Object.keys(EDITOR_ROLES))for(const action of ['RICH_MENU_LIST','savePermissionUser','WELFARE_POINTS_INSERT','WELFARE_POINTS_QUERY','WELFARE_MEMBER_VERIFY','WELFARE_REDEMPTION_CREATE'])assert.equal((await f.call('/api','',{action,payload:{sessionToken:'session-'+role,role:'admin',allowed_modules:'*'}})).status,403);
 const r=await f.call('/api','',{action:'getPermissionConfig',payload:{sessionToken:'session-owner'}});assert.notEqual(r.status,403);
 }finally{f.close();}
});

test('failed club ownership insert rolls back a new activity and its keyword',async()=>{
 const f=editorFixture();try{
 f.sqlite.exec("CREATE TRIGGER reject_editor_club BEFORE INSERT ON welfare_activity_club_links BEGIN SELECT RAISE(ABORT,'synthetic club link failure');END;");
 const r=await f.call('/admin-api/activity-checkin','club_editor',{action:'save_event',data:{title:'rollback-club-event',club_id:'club-yoga',checkin_keyword:'rollback-club-event'}});
 assert.equal((await r.json()).success,false);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_events WHERE title='rollback-club-event'").get().n,0);
 }finally{f.close();}
});
import {createAdminIdentityProvider} from '../src/workspace/admin-identity-provider.js';import {canChangeRichMenu} from '../src/workspace/rich-menu-chat.js';import {editorChatCard} from '../src/editor-ui.js';
test('LINE workspace identity keeps editors out of broad admin and menu publication even with stale wildcard modules',async()=>{
 const f=editorFixture();try{for(const role of Object.keys(EDITOR_ROLES)){
  f.sqlite.prepare("UPDATE admin_uid_whitelist SET allowed_modules='*' WHERE role=?").run(role);
  const identity=await createAdminIdentityProvider().resolve({db:f.db,userId:roleUid(role)});assert.equal(identity.role,role);assert.equal(identity.admin,false);assert.equal(identity.authenticated,true);
  assert.equal(await canChangeRichMenu(f.db,roleUid(role)),false);
  const card=editorChatCard(role,'https://activity.test');assert.equal(card.altText,EDITOR_ROLES[role].label+'工作區');assert.ok(!JSON.stringify(card).includes('line-segment-push'));assert.ok(!JSON.stringify(card).includes('RICH_MENU'));
 }}finally{f.close();}
});


test('LINE admin login accepts verified same-channel access only for missing or expired ID token', async t => {
 const uid=roleUid('activity_editor');
 const cases=[
  {name:'expired ID plus valid access',id:'expired',access:'valid',success:true},
  {name:'missing ID plus valid access',id:'',access:'valid',success:true},
  {name:'wrong ID audience stays rejected',id:'audience',access:'valid'},
  {name:'ID provider unavailable stays rejected',id:'unavailable',access:'valid'},
  {name:'valid ID with mismatched UID stays rejected',id:'different',access:'valid'},
  {name:'expired ID plus mismatched access identity stays rejected',id:'expired',access:'different'},
  {name:'expired ID plus wrong access audience stays rejected',id:'expired',access:'wrong-channel'},
  {name:'expired ID plus missing openid stays rejected',id:'expired',access:'missing-scope'},
  {name:'expired ID plus inactive whitelist stays rejected',id:'expired',access:'valid',inactive:true},
  {name:'missing credentials stay rejected',id:'',access:''}
 ];
 for(const c of cases) await t.test(c.name,async()=>{
  const f=editorFixture(),original=globalThis.fetch;let accessCalls=0;
  try{
   if(c.inactive)f.sqlite.prepare('UPDATE admin_uid_whitelist SET active=0 WHERE line_user_id=?').run(uid);
   const before=f.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n;
   globalThis.fetch=async(url,opt={})=>{
    const u=new URL(String(url));
    if(opt.method==='POST'){
     if(c.id==='unavailable')throw new Error('synthetic provider unavailable');
     if(c.id==='expired')return Response.json({error_description:'IdToken expired.'},{status:400});
     if(c.id==='audience')return Response.json({error_description:'Invalid IdToken Audience.'},{status:400});
     return Response.json({sub:roleUid('owner')});
    }
    accessCalls++;
    if(u.pathname.endsWith('/verify'))return Response.json({client_id:c.access==='wrong-channel'?'9999999999':'2009117474',expires_in:60,scope:c.access==='missing-scope'?'profile':'openid profile'});
    if(u.pathname.endsWith('/userinfo'))return Response.json({sub:c.access==='different'?roleUid('owner'):uid});
    throw new Error('unexpected provider request');
   };
   const data={lineUserId:uid,lineIdToken:c.id?'synthetic-id':'',lineAccessToken:c.access?'synthetic-access':''};
   const result=await(await f.call('/api','',{action:'reviewerLineLogin',data})).json();
   assert.equal(result.success,!!c.success,JSON.stringify(result));
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,before+Number(!!c.success));
   if(['audience','unavailable','different'].includes(c.id))assert.equal(accessCalls,0,'never fall back on other ID failures or UID mismatch');
   if(c.success)assert.equal(result.data.role,'activity_editor');
  }finally{globalThis.fetch=original;f.close();}
 });
});
