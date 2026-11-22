import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { clubFixture } from './club-fixture.mjs';
import { handleActivityFormRequest } from '../src/activity-form-service.js';
import { validAnswers } from './activity-form.test.mjs';
import { buildClubPageHtml } from '../src/club-ui.js';
import { buildClubAdminHtml } from '../src/club-admin-ui.js';
import { decorateFeaturedActivitiesHtml } from '../src/featured-activities-ui.js';

const gallery=(ids=[],extra={})=>({id:'gallery-1',club_id:'club-yoga',title:'測試花絮',description:'測試內容',media_ids:ids,video_url:'',event_id:'',status:'published',visibility:'employee',...extra});
test('additive migration seeds only the three confirmed clubs and preserves registrations and identity',async()=>{const f=clubFixture();try{
 assert.deepEqual(f.sqlite.prepare('SELECT id FROM welfare_clubs ORDER BY id').all().map(r=>r.id),['club-badminton','club-running','club-yoga']);
 assert.equal(f.club('club-running').status,'preparing');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_events').get().n,1);assert.equal(f.sqlite.prepare('SELECT bind_status FROM welfare_members').get().bind_status,'bound');
 f.sqlite.exec(readFileSync(new URL('../migrations/0034_clubs_and_highlights.sql',import.meta.url),'utf8'));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_clubs').get().n,3);
 const data=await (await f.call('/api/clubs?lang=id')).json();assert.equal(data.clubs.find(c=>c.id==='club-yoga').title,'Klub Yoga');assert.equal(data.events.length,0);assert.equal(data.galleries.length,0);
}finally{f.close();}});
test('all generated inline scripts parse, the same public component is used in featured and standalone pages',()=>{
 for(const lang of ['zh','id','th'])for(const html of [buildClubPageHtml(lang),decorateFeaturedActivitiesHtml('<html><head></head><body><main class="app"><section class="filters"></section><section class="content"></section></main></body></html>',lang)])for(const [,s]of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(s);
 for(const [,s]of buildClubAdminHtml().matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(s);
});
test('anonymous, wrong role, inactive LINE and cross-origin writes do not change any club or upload',async()=>{const f=clubFixture();try{
 const data=f.club('club-yoga');for(const token of ['','test-employee','test-member'])assert.equal((await f.call('/admin-api/clubs',{kind:'club',data,revision:1,confirmed:true,request_id:crypto.randomUUID()},token)).status,403);
 assert.equal((await f.call('/admin-api/clubs',null,'',{'X-Line-Id-Token':'line-admin'})).status,200);
 assert.equal((await f.call('/admin-api/clubs',null,'test-admin',{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.upload('club-yoga',crypto.randomUUID(),undefined,'')).status,403);assert.equal(f.files.size,0);assert.equal(f.club('club-yoga').revision,1);
 f.queries.length=0;assert.equal((await f.call('/api/clubs',null,'expired')).status,403);assert.equal(f.queries.length,0);
}finally{f.close();}});
test('confirmed saves use optimistic revisions, record atomic audit and replay exactly once',async()=>{const f=clubFixture();try{
 const data={...f.club('club-yoga'),description:'新說明',title:'新名稱'},requestId=crypto.randomUUID();
 assert.equal((await f.save('club',data,1,{confirmed:false})).status,400);
 assert.equal((await f.save('club',data,1,{request_id:requestId})).status,200);
 assert.equal((await (await f.save('club',data,1,{request_id:requestId})).json()).replayed,true);assert.equal(f.club('club-yoga').revision,2);
 assert.equal((await f.save('club',{...data,title:'覆蓋'},1)).status,409);assert.equal((await f.save('club',{...data,title:'覆蓋'},2,{request_id:requestId})).status,409);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_actions').get().n,1);
 f.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON welfare_club_actions BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");
 assert.equal((await f.save('club',{...data,title:'不應儲存'},2)).status,503);assert.equal(f.club('club-yoga').title,'新名稱');
}finally{f.close();}});
test('private photos require publication, employee binding and safe direct access; hide/archive retain data',async()=>{const f=clubFixture();try{
 const upload=await (await f.upload()).json();assert.equal(upload.success,true);const mediaId=upload.id;
 assert.equal((await f.call('/club-media/'+mediaId)).status,404);assert.equal((await f.call('/club-media/'+mediaId+'?manage=1',null,'test-admin')).status,200);
 const rawKey=f.sqlite.prepare('SELECT object_key FROM welfare_club_media').get().object_key;
 assert.equal((await f.call('/club-media/'+mediaId+'?manage=1')).status,403);
 assert.equal((await f.save('gallery',gallery([mediaId]))).status,200);
 assert.equal((await (await f.call('/api/clubs')).json()).galleries.length,0);
 assert.equal((await (await f.call('/api/clubs',null,'another-member')).json()).galleries.length,0);
 assert.equal((await (await f.call('/api/clubs',null,'test-member')).json()).galleries.length,1);
 assert.equal((await f.call('/club-media/'+mediaId,null,'test-member')).status,200);assert.equal((await f.call('/club-media/'+mediaId)).status,404);
 assert.equal((await f.save('gallery',gallery([mediaId],{visibility:'all'}),1)).status,200);assert.equal((await f.call('/club-media/'+mediaId)).status,404);
 assert.equal((await (await f.call('/api/clubs')).json()).galleries.length,0);
 assert.equal((await (await f.call('/api/clubs',null,'test-member')).json()).galleries[0].visibility,'employee');
 assert.equal((await f.save('gallery',gallery([mediaId],{status:'hidden',visibility:'all'}),2)).status,200);assert.equal((await f.call('/club-media/'+mediaId)).status,404);assert.equal(f.files.has(rawKey),true);
 assert.equal((await f.save('gallery',gallery([mediaId],{status:'published',visibility:'all'}),3)).status,200);
 assert.equal((await f.save('club',{...f.club('club-yoga'),status:'archived'},1)).status,200);assert.equal((await f.call('/club-media/'+mediaId)).status,404);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_galleries').get().n,1);
}finally{f.close();}});
test('gallery media never leaks through a public club cover; unrelated cover stays public',async()=>{const f=clubFixture();try{
 const photo=await(await f.upload()).json();
 assert.equal((await f.save('club',{...f.club('club-yoga'),cover_media_id:photo.id},1)).status,200);
 assert.equal((await f.call('/club-cover/club-yoga')).status,200);
 assert.equal((await f.save('gallery',gallery([photo.id],{status:'draft',visibility:'all'}))).status,200);
 assert.equal((await f.call('/club-cover/club-yoga')).status,404);
 assert.equal((await f.call('/club-media/'+photo.id,null,'test-member')).status,404);
 assert.equal((await f.call('/club-media/'+photo.id+'?manage=1',null,'test-admin')).status,200);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT content_json FROM welfare_club_galleries').get().content_json).visibility,'all');
}finally{f.close();}});
test('gallery list and media reject inactive, unbound, visitor and forged identities',async()=>{const f=clubFixture();try{
 const photo=await(await f.upload()).json();await f.save('gallery',gallery([photo.id],{visibility:'all'}));
 f.deps.verifyLine=async (_env,token)=>token==='forged'?null:{lineUserId:token};
 for(const [uid,type,status,bind] of [['inactive','employee','inactive','bound'],['unbound','employee','active','unbound'],['visitor','visitor','active','bound'],['foreign','foreign_employee','active','bound'],['manager','manager','active','bound']])
  f.sqlite.prepare('INSERT INTO welfare_members(line_user_id,member_type,status,bind_status) VALUES(?,?,?,?)').run(uid,type,status,bind);
 for(const uid of ['inactive','unbound','visitor']){
  assert.equal((await (await f.call('/api/clubs',null,uid)).json()).galleries.length,0);
  assert.equal((await f.call('/club-media/'+photo.id,null,uid)).status,404);
 }
 assert.equal((await f.call('/api/clubs',null,'forged')).status,403);assert.equal((await f.call('/club-media/'+photo.id,null,'forged')).status,403);
 for(const uid of ['test-member','foreign','manager']){assert.equal((await (await f.call('/api/clubs',null,uid)).json()).galleries.length,1);assert.equal((await f.call('/club-media/'+photo.id,null,uid)).status,200);}
}finally{f.close();}});
test('album validation rejects foreign photos, unsafe URLs, HTML images and more than 200 photos',async()=>{const f=clubFixture();try{
 const photo=await (await f.upload('club-badminton')).json();assert.equal((await f.save('gallery',gallery([photo.id]))).status,400);
 assert.equal((await f.save('gallery',gallery([],{video_url:'javascript:alert(1)'}))).status,400);
 assert.equal((await f.save('gallery',gallery([],{video_url:'https://user:password@example.com/'}))).status,400);
 assert.equal((await f.save('gallery',gallery(Array.from({length:201},(_,i)=>'photo-'+i)))).status,400);
 assert.equal((await f.upload('club-yoga',crypto.randomUUID(),new TextEncoder().encode('<html>evil</html>'))).status,400);
 assert.equal((await f.save('gallery',gallery([],{club_id:'unknown'}))).status,404);
}finally{f.close();}});
test('200-photo albums save and preserve order without exceeding D1 parameter limits',async()=>{const f=clubFixture();try{
 const ids=Array.from({length:200},(_,i)=>'album-photo-'+i);
 for(const id of ids)f.sqlite.prepare("INSERT INTO welfare_club_media(id,club_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,'club-yoga',?,'image/jpeg','photo.jpg',4,'test-admin',?)").run(id,'club_private_media_'+id,id);
 const prepare=f.env.DB.prepare;f.env.DB.prepare=sql=>{const statement=prepare(sql),bind=statement.bind;statement.bind=(...args)=>{assert.ok(args.length<=100,'D1 limit');return bind(...args);};return statement;};
 assert.equal((await f.save('gallery',gallery(ids))).status,200);
 const row=f.sqlite.prepare('SELECT content_json FROM welfare_club_galleries').get();assert.deepEqual(JSON.parse(row.content_json).media_ids,ids);
 assert.equal((await f.save('gallery',gallery([...ids,ids[0]]),1)).status,400);
}finally{f.close();}});
test('upload retries are idempotent, failed audit rolls back metadata and cleans only new object',async()=>{const f=clubFixture();try{
 const requestId=crypto.randomUUID(),first=await (await f.upload('club-yoga',requestId)).json(),retry=await (await f.upload('club-yoga',requestId)).json();assert.equal(first.id,retry.id);assert.equal(f.files.size,1);
 f.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON welfare_club_actions BEGIN SELECT RAISE(ABORT,'test'); END;");assert.equal((await f.upload()).status,503);assert.equal(f.files.size,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_media').get().n,1);
}finally{f.close();}});
test('associated events reuse registration windows and announcement mode blocks direct submissions without deleting receipts',async()=>{const f=clubFixture();try{
 await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'esg',mode:'registration'});
 await handleActivityFormRequest(f.request('/admin-api/activity-form',{action:'save',event_id:'event-1',revision:0,schema:(await import('./activity-form.test.mjs')).familyForm,confirmed:true}),f.env,f.deps);
 f.sqlite.prepare("UPDATE welfare_activity_events SET registration_start_at='2099-09-01 08:00:00'").run();
 let events=(await (await f.call('/api/clubs',null,'test-member')).json()).events;assert.equal(events[0].registration_state,'not_started');assert.match(events[0].registration_url,/activity-registration/);
 assert.equal((await (await f.call('/api/clubs')).json()).events.length,0);
 await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'esg',mode:'announcement'},1);
 f.sqlite.prepare("UPDATE welfare_activity_events SET registration_start_at=''").run();
 events=(await (await f.call('/api/clubs',null,'test-member')).json()).events;assert.equal(events[0].registration_state,'announcement');assert.equal(events[0].registration_url,'');
 const direct=await handleActivityFormRequest(f.request('/api/activity-registration',{event_id:'event-1',revision:1,answers:validAnswers},'test-member'),f.env,f.deps);assert.equal(direct.status,400);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations').get().n,0);
 const page=await handleActivityFormRequest(f.request('/api/activity-registration?event_id=event-1',null,'test-member'),f.env,f.deps);assert.equal((await page.json()).schema,undefined);
 await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'club',mode:'registration'},2);
 assert.equal((await handleActivityFormRequest(f.request('/api/activity-registration',{event_id:'event-1',revision:1,answers:validAnswers},'test-member'),f.env,f.deps)).status,200);
 await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'club',mode:'announcement'},3);
 assert.ok((await (await handleActivityFormRequest(f.request('/api/activity-registration?event_id=event-1',null,'test-member'),f.env,f.deps)).json()).registration);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations').get().n,1);
}finally{f.close();}});
test('linked galleries honor the original activity audience and later association changes',async()=>{const f=clubFixture();try{
 await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'club',mode:'registration'});const p=await(await f.upload()).json();await f.save('gallery',gallery([p.id],{event_id:'event-1',visibility:'all'}));
 assert.equal((await f.call('/club-media/'+p.id)).status,404);assert.equal((await f.call('/club-media/'+p.id,null,'test-member')).status,200);
 f.sqlite.prepare("UPDATE welfare_activity_events SET audience_scope='[\"manager\"]' WHERE id='event-1'").run();
 f.sqlite.prepare("INSERT INTO welfare_members(line_user_id,member_type,status,bind_status) VALUES('manager','manager','active','bound')").run();
 f.deps.verifyLine=async (_env,token)=>token==='forged'?null:{lineUserId:token};
 assert.equal((await (await f.call('/api/clubs',null,'test-member')).json()).galleries.length,0);assert.equal((await f.call('/club-media/'+p.id,null,'test-member')).status,404);
 assert.equal((await (await f.call('/api/clubs',null,'manager')).json()).galleries.length,1);assert.equal((await f.call('/club-media/'+p.id,null,'manager')).status,200);
 await f.save('activity',{id:'event-1',club_id:'club-badminton',kind:'club',mode:'registration'},1);assert.equal((await f.call('/club-media/'+p.id,null,'test-member')).status,404);
}finally{f.close();}});

test('concurrent editors cannot both commit the same club revision',async()=>{const f=clubFixture();try{
 const club=f.club('club-yoga');const first=f.save('club',{...club,title:'第一位編輯'},1),second=f.save('club',{...club,title:'第二位編輯'},1);
 assert.deepEqual([(await first).status,(await second).status].sort(),[200,409]);assert.equal(f.club('club-yoga').revision,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_actions').get().n,1);
}finally{f.close();}});
test('announcement change between registration read and INSERT is rejected atomically',async()=>{const f=clubFixture();try{
 await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'club',mode:'registration'});await handleActivityFormRequest(f.request('/admin-api/activity-form',{action:'save',event_id:'event-1',revision:0,schema:(await import('./activity-form.test.mjs')).familyForm,confirmed:true}),f.env,f.deps);
 const prepare=f.env.DB.prepare;f.env.DB.prepare=sql=>{if(/INSERT INTO welfare_activity_registrations/.test(sql))f.sqlite.exec("UPDATE welfare_activity_club_links SET content_json=json_set(content_json,'$.mode','announcement')");return prepare(sql);};
 const response=await handleActivityFormRequest(f.request('/api/activity-registration',{event_id:'event-1',revision:1,answers:validAnswers},'test-member'),f.env,f.deps);assert.equal(response.status,409);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_registrations').get().n,0);
}finally{f.close();}});
test('club private prefixes cannot bypass media policy through the generic file endpoint',async()=>{const f=clubFixture();try{
 const upload=await(await f.upload()).json();const key=f.sqlite.prepare('SELECT object_key FROM welfare_club_media WHERE id=?').get(upload.id).object_key;
 const {default:worker}=await import('../src/index.js');assert.equal((await worker.fetch(new Request('https://activity.test/file/'+encodeURIComponent(key)),f.env,{})).status,404);
}finally{f.close();}});
