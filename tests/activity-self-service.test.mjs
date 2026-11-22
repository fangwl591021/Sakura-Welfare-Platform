import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleMyActivityRegistrations,selfServiceTimestamp,ownCancellationState} from '../src/activity-self-service.js';
import {handleActivityFormRequest} from '../src/activity-form-service.js';
const UID='U'+'1'.repeat(32),OTHER='U'+'2'.repeat(32),origin='https://self-service.test';
const schema={fields:[{id:'name',label:'姓名',type:'text',required:true}],rules:[]};

export function selfServiceFixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY,title TEXT,start_at TEXT,end_at TEXT,location TEXT,status TEXT,audience_scope TEXT,registration_end_at TEXT);
 CREATE TABLE welfare_activity_registrations(id TEXT PRIMARY KEY,event_id TEXT,line_user_id TEXT,display_name TEXT,form_revision INTEGER,schema_json TEXT,answers_json TEXT,created_at TEXT,UNIQUE(event_id,line_user_id));
 CREATE TABLE welfare_activity_checkins(id TEXT PRIMARY KEY,event_id TEXT,line_user_id TEXT);
 CREATE TABLE welfare_audit_events(id TEXT PRIMARY KEY,actor_type TEXT,actor_id TEXT,event_type TEXT,target_type TEXT,target_id TEXT,summary TEXT,raw_json TEXT,created_at TEXT);`);
 sqlite.exec(readFileSync(new URL('../migrations/0044_activity_self_service_indexes.sql',import.meta.url),'utf8'));
 const queries=[],controls={beforeBatch:()=>{},failSecond:false};
 const db={prepare(sql){queries.push(sql);let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){controls.beforeBatch();sqlite.exec('BEGIN');try{const results=[];for(let i=0;i<statements.length;i++){if(i===1&&controls.failSecond)throw new Error('synthetic commit failure');results.push(await statements[i].run());}sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const event=(id='e',extra={})=>{const row={id,title:'合成活動 '+id,start_at:'2099-12-01 10:00:00',end_at:'2099-12-01 12:00:00',location:'測試會場',status:'active',audience_scope:'["employee"]',registration_end_at:'2000-01-01 00:00:00',...extra};sqlite.prepare('INSERT INTO welfare_activity_events VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(row));return row;};
 const registration=(id='r',eventId='e',uid=UID,answers={name:'本人測試答案'})=>{sqlite.prepare('INSERT INTO welfare_activity_registrations VALUES(?,?,?, ?,1,?,?,?)').run(id,eventId,uid,'測試名稱',JSON.stringify(schema),JSON.stringify(answers),'2026-11-01T01:00:00.000Z');};
 event();registration();registration('other-r','e',OTHER,{name:'其他人敏感答案'});
 const env={DB:db},deps={verifyLine:async(_,token)=>token==='owner-token'?{lineUserId:UID}:token==='other-token'?{lineUserId:OTHER}:null};
 const request=(suffix='',body=null,token='owner-token',headers={})=>new Request(origin+'/api/my-activity-registrations'+suffix,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const call=(suffix='',body=null,token,headers)=>handleActivityFormRequest(request(suffix,body,token,headers),env,deps);
 const get=async(suffix='',token)=>{const response=await call(suffix,null,token);return {...await response.json(),http:response.status};};
 const input=async()=>{const row=(await get()).registrations.find(row=>row.id==='r'&&row.status==='registered');return {action:'cancel_registration',registration_id:row.id,event_id:row.event.id,cancel_revision:row.cancel_revision,request_id:crypto.randomUUID(),confirmed:true};};
 return {sqlite,db,env,deps,queries,controls,event,registration,request,call,get,input,close:()=>sqlite.close()};
}

test('own registration API rejects missing/expired identity before DB reads and ignores query UID impersonation',async()=>{
 const f=selfServiceFixture();try{for(const token of ['', 'expired']){f.queries.length=0;assert.equal((await f.get('',token)).http,401);assert.deepEqual(f.queries,[]);}const list=await f.get('?line_user_id='+OTHER);assert.equal(list.total,1);assert.equal(list.registrations[0].id,'r');assert.equal(JSON.stringify(list).includes('其他人敏感答案'),false);assert.equal(JSON.stringify(list).includes(OTHER),false);assert.ok(list.registrations[0].can_cancel);assert.equal(list.registrations[0].schema.fields[0].label,'姓名');}finally{f.close();}
});

test('own history keeps past, inactive and orphaned event registrations; invalid/started times cannot cancel',async()=>{
 const f=selfServiceFixture();try{f.event('past',{start_at:'2000-01-01 01:00:00',status:'inactive',audience_scope:'["manager"]'});f.registration('past-r','past');f.registration('orphan','missing');f.event('bad',{start_at:'2099-02-30 10:00:00'});f.registration('bad-r','bad');const list=await f.get();assert.equal(list.total,4);const byId=new Map(list.registrations.map(row=>[row.id,row]));assert.equal(byId.get('past-r').can_cancel,false);assert.equal(byId.get('orphan').cancel_block_reason,'invalid_start');assert.equal(byId.get('bad-r').cancel_block_reason,'invalid_start');assert.equal((await f.get('?filter=cancellable')).total,1);}finally{f.close();}
});

test('cancellable filter applies to complete own set before fifty-row pagination',async()=>{
 const f=selfServiceFixture();try{f.sqlite.exec('DELETE FROM welfare_activity_registrations');for(let i=0;i<78;i++){const id='page-'+i;f.event(id,{start_at:i<65?'2099-12-01 10:00:00':'2000-01-01 10:00:00'});f.registration(id,id);}const a=await f.get('?filter=cancellable&page=1'),b=await f.get('?filter=cancellable&page=2');assert.equal(a.total,65);assert.equal(a.pages,2);assert.equal(a.registrations.length,50);assert.equal(b.registrations.length,15);assert.equal(new Set([...a.registrations,...b.registrations].map(row=>row.id)).size,65);assert.equal((await f.get()).total,78);}finally{f.close();}
});

test('time parsing distinguishes Taipei wall time and explicit zones and blocks the exact start instant',()=>{
 const ts=Date.parse('2026-11-05T02:00:00Z');assert.equal(selfServiceTimestamp('2026-11-05 10:00:00'),ts);assert.equal(selfServiceTimestamp('2026-11-05T02:00:00Z'),ts);assert.equal(selfServiceTimestamp('2026-11-05T10:00:00+08:00'),ts);assert.equal(selfServiceTimestamp('2026-11-04T18:00:00-08:00'),ts);
 for(const value of ['',null,'invalid','2026-02-30 10:00:00','2026-11-05','2026-11-05T24:00:00Z','2026-11-05T10:00:00+15:00'])assert.equal(Number.isNaN(selfServiceTimestamp(value)),true,value);
 assert.equal(ownCancellationState({start_at:'2026-11-05 10:00:00'},false,ts-1).can_cancel,true);assert.equal(ownCancellationState({start_at:'2026-11-05 10:00:00'},false,ts).can_cancel,false);assert.equal(ownCancellationState({start_at:'2026-11-05 10:00:00'},true,ts-1).cancel_block_reason,'checked_in');
});

test('closed registration still cancels before start, in one audited transaction, with idempotent replay and own history',async()=>{
 const f=selfServiceFixture();try{const payload=await f.input();const response=await f.call('',payload);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).replayed,false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations WHERE line_user_id=?').get(UID).n,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations WHERE line_user_id=?').get(OTHER).n,1);assert.equal((await(await f.call('',payload)).json()).replayed,true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_audit_events').get().n,1);const history=await f.get();assert.equal(history.total,1);assert.equal(history.registrations[0].status,'cancelled');assert.equal(history.registrations[0].answers.name,'本人測試答案');assert.equal((await f.get('?filter=cancellable')).total,0);assert.equal((await f.get('?request_id='+payload.request_id)).operation.status,'cancelled');assert.equal((await f.get('?request_id='+payload.request_id,'other-token')).operation.status,'not_found');}finally{f.close();}
});

test('cancel requires explicit confirmation, own row, unchanged revision and a fixed request id',async()=>{
 const f=selfServiceFixture();try{const payload=await f.input();for(const body of [{...payload,confirmed:false},{...payload,line_user_id:OTHER},{...payload,request_id:'bad'}])assert.equal((await f.call('',body)).status,400);assert.equal((await f.call('',{...payload,registration_id:'other-r'})).status,404);assert.equal((await f.call('',payload,'other-token')).status,404);assert.equal((await f.call('',{...payload,cancel_revision:'0'.repeat(64)})).status,409);assert.equal((await f.call('',payload,undefined,{Origin:'https://other.test'})).status,403);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_audit_events').get().n,0);}finally{f.close();}
});

test('cancellation then new registration retains both records; the old request cannot delete a new registration',async()=>{
 const f=selfServiceFixture();try{const payload=await f.input();await f.call('',payload);f.registration('new-registration');const replay=await f.call('',payload);assert.equal((await replay.json()).replayed,true);const list=await f.get();assert.equal(list.total,2);assert.deepEqual(list.registrations.map(row=>row.status).sort(),['cancelled','registered']);assert.equal(list.registrations.find(row=>row.status==='registered').id,'new-registration');assert.equal((await f.call('',{...payload,registration_id:'new-registration'})).status,409);}finally{f.close();}
});

test('concurrent check-in, answers, event start/status/audience or ownership changes block cancellation atomically',async()=>{
 for(const sql of ["INSERT INTO welfare_activity_checkins VALUES('late','e','"+UID+"')","UPDATE welfare_activity_registrations SET answers_json='{}' WHERE id='r'","UPDATE welfare_activity_events SET start_at='2000-01-01 10:00:00'","UPDATE welfare_activity_events SET status='inactive'","UPDATE welfare_activity_events SET audience_scope='[\"manager\"]'","UPDATE welfare_activity_registrations SET line_user_id='different' WHERE id='r'"]){const f=selfServiceFixture();try{const payload=await f.input();f.controls.beforeBatch=()=>f.sqlite.exec(sql);assert.equal((await f.call('',payload)).status,409,sql);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_audit_events').get().n,0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM welfare_activity_registrations WHERE id='r'").get().n,1);}finally{f.close();}}
});

test('write failure rolls back audit and deletion; GET operation reports no completed request',async()=>{
 const f=selfServiceFixture();try{const payload=await f.input();f.controls.failSecond=true;assert.equal((await f.call('',payload)).status,503);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_audit_events').get().n,0);assert.equal((await f.get()).registrations[0].status,'registered');assert.equal((await f.get('?request_id='+payload.request_id)).operation.status,'not_found');}finally{f.close();}
});

test('no admin cancellation raw payload or another user answers appear in own history and invalid own metadata is excluded',async()=>{
 const f=selfServiceFixture();try{const insert=f.sqlite.prepare("INSERT INTO welfare_audit_events VALUES(?,'admin',?,?,'activity','e','test',?,'2026-11-04T00:00:00Z')");insert.run('bulk','admin','activity.registration.cancel',JSON.stringify({registrations:[{line_user_id:UID,answers:'self'}, {line_user_id:OTHER,answers:'OTHER-SECRET'}]}));insert.run('other-self',OTHER,'activity.registration.self_cancel',JSON.stringify({registration:{id:'other',line_user_id:OTHER,answers_json:'{"name":"OTHER-SECRET"}'}}));insert.run('corrupt-self',UID,'activity.registration.self_cancel',JSON.stringify({registration:{id:'wrong',line_user_id:OTHER}}));const list=await f.get();assert.equal(list.total,1);assert.equal(JSON.stringify(list).includes('OTHER-SECRET'),false);assert.equal(JSON.stringify(list).includes(OTHER),false);assert.ok(f.queries.filter(sql=>sql.includes('raw_json')&&sql.includes('welfare_audit_events')).every(sql=>sql.includes('event_type=?')));}finally{f.close();}
});

test('large own answers are not copied into page payload; original view remains available',async()=>{
 const f=selfServiceFixture();try{f.sqlite.prepare("UPDATE welfare_activity_registrations SET answers_json=? WHERE id='r'").run(JSON.stringify({name:'x'.repeat(18000)}));const item=(await f.get()).registrations[0];assert.equal(item.details_available,false);assert.equal(item.answers,null);assert.equal(item.schema,null);assert.match(item.details_message,/原報名頁/);assert.ok(item.cancel_revision);await f.call('',await f.input());const history=(await f.get()).registrations[0];assert.equal(history.status,'cancelled');assert.equal(history.details_available,false);assert.match(history.details_message,/聯絡管理員/);assert.equal(history.details_message.includes('原報名頁'),false);}finally{f.close();}
});

test('two hundred legacy admin batches return only each verified owner child across all pages with indexed bounded queries',async()=>{
 const f=selfServiceFixture();try{
  const row=f.sqlite.prepare("SELECT * FROM welfare_activity_registrations WHERE id='r'").get(),insert=f.sqlite.prepare("INSERT INTO welfare_audit_events VALUES(?,'admin','admin-actor','activity.registration.cancel','activity','e','批次取消',?,?)");
  for(let i=0;i<200;i++)insert.run('batch-'+i,JSON.stringify({event_title:'歷史活動',registrations:[{...row,id:'old-self-'+i,answers_json:JSON.stringify({name:'本人歷史'+i})},{...row,id:'old-other-'+i,line_user_id:OTHER,answers_json:JSON.stringify({name:'DO-NOT-EXPOSE-OTHER-'+i})}]}),'2026-11-02T00:00:00.000Z');
  insert.run('broken-json','{broken','2026-11-02T00:00:00.000Z');insert.run('wrong-shape',JSON.stringify({registrations:['not-json',42,null,{line_user_id:UID}]}),'2026-11-02T00:00:00.000Z');
  insert.run('not-admin',JSON.stringify({event_title:'不可信來源',registrations:[{...row,id:'not-admin-own'}]}),'2026-11-02T00:00:00.000Z');f.sqlite.exec("UPDATE welfare_audit_events SET actor_type='member' WHERE id='not-admin'");insert.run('not-activity',JSON.stringify({event_title:'其他資料類型',registrations:[{...row,id:'wrong-target-own'}]}),'2026-11-02T00:00:00.000Z');f.sqlite.exec("UPDATE welfare_audit_events SET target_type='vendor' WHERE id='not-activity'");
  const before=performance.now(),first=await f.get();assert.equal(first.total,201);assert.equal(first.pages,5);assert.equal(first.registrations.length,50);assert.ok(performance.now()-before<2000);
  const all=[...first.registrations];for(let page=2;page<=5;page++)all.push(...(await f.get('?page='+page)).registrations);
  assert.equal(all.length,201);assert.equal(new Set(all.map(row=>row.history_id||row.id)).size,201);assert.equal(all.filter(row=>row.status==='cancelled').length,200);assert.equal(JSON.stringify(all).includes('DO-NOT-EXPOSE-OTHER'),false);assert.equal(JSON.stringify(all).includes(OTHER),false);
  const other=await f.get('?page=1','other-token');assert.equal(other.total,201);assert.equal(other.registrations.some(row=>row.answers?.name?.startsWith('本人歷史')),false);
  const exact=await f.get('?registration_id=old-self-157');assert.equal(exact.total,1);assert.equal(exact.registrations[0].id,'old-self-157');
  const adminQuery=f.queries.find(sql=>sql.includes('a.id AS audit_id,a.created_at,j.key'));
  const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+adminQuery).all('activity.registration.cancel',UID);assert.ok(plan.some(row=>row.detail.includes('idx_welfare_audit_type_created')),JSON.stringify(plan));
  assert.ok(f.queries.every(sql=>!/^SELECT\s+(?:a\.)?raw_json.*activity\.registration\.cancel/i.test(sql)));
  f.queries.length=0;await f.get();assert.ok(f.queries.length<=5,'page reads remain bounded, not one query per history row: '+f.queries.length);
 }finally{f.close();}
});
