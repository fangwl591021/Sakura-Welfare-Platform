import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {handleActivityStoryRequest} from '../src/activity-stories-service.js';
const UID1='U'+'1'.repeat(32),UID2='U'+'2'.repeat(32),UID3='U'+'3'.repeat(32),MEMBER='U'+'4'.repeat(32);
function fixture(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(`CREATE TABLE welfare_clubs(id TEXT PRIMARY KEY,content_json TEXT);CREATE TABLE welfare_club_galleries(id TEXT PRIMARY KEY,club_id TEXT,content_json TEXT,updated_at TEXT);CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY,audience_scope TEXT);CREATE TABLE welfare_activity_club_links(id TEXT PRIMARY KEY,club_id TEXT);CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,member_type TEXT,status TEXT,bind_status TEXT);CREATE TABLE admin_uid_whitelist(line_user_id TEXT,display_name TEXT,role TEXT,active INTEGER);`);sqlite.exec(readFileSync(new URL('../migrations/0036_activity_stories.sql',import.meta.url),'utf8'));
 const c=sqlite.prepare('INSERT INTO welfare_clubs VALUES(?,?)');for(const [id,title] of [['club-a','羽球社'],['club-b','瑜珈社']])c.run(id,JSON.stringify({title,status:'active',published:true,translations:{id:{title:'Club '+title},th:{title:'Thai '+title}}}));const w=sqlite.prepare('INSERT INTO admin_uid_whitelist VALUES(?,?,?,1)');w.run(UID1,'A','club_editor');w.run(UID2,'B','club_editor');w.run(UID3,'C','activity_editor');sqlite.prepare('INSERT INTO welfare_members VALUES(?,?,?,?)').run(MEMBER,'employee','active','bound');
 const db={prepare(sql){const prep=(...args)=>({async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}});return {...prep(),bind:prep}}};db.batch=async stmts=>{sqlite.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}};const files=new Map();const env={DB:db,OPENAI_API_KEY:'synthetic',R2_BUCKET:{async put(k,v){files.set(k,v)},async get(k){return files.has(k)?{body:files.get(k)}:null},async delete(k){files.delete(k)}}};const auth={admin:{id:'1',role:'admin'},a:{id:'2',line_user_id:UID1,role:'club_editor'},b:{id:'3',line_user_id:UID2,role:'club_editor'},activity:{id:'4',line_user_id:UID3,role:'activity_editor'}};const deps={requireAdmin:async ({sessionToken})=>auth[sessionToken]?{ok:true,user:auth[sessionToken]}:{ok:false},verifyLine:async(_env,t)=>t==='employee-token'?{lineUserId:MEMBER}:null,findAdmin:async()=>null,callAi:async(_env,m)=>({texts:JSON.parse(m[1].content).texts.map(x=>x?'译 '+x:'')})};
 const req=async(path,{token='',body,method=body?'POST':'GET',headers={}}={})=>handleActivityStoryRequest(new Request('https://fixture.test'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),env,deps);
 const save=(token,story,revision=0,request_id=crypto.randomUUID())=>req('/admin-api/activity-stories',{token,body:{story,revision,request_id,confirmed:true}});
 const story=(unit,id='post1',visibility='all')=>({id,unit_id:unit,title:'活動',summary:'摘要',event_date:'2026-10-29',cover_media_id:'',visibility,status:'published',blocks:[{type:'text',text:'活動內容'}],gallery_id:''});
 const photo=async(token,unit,request_id=crypto.randomUUID())=>{const form=new FormData();form.set('file',new File([new Uint8Array([255,216,255,217])],'a.jpg',{type:'image/jpeg'}));return req('/admin-api/activity-story-media?unit_id='+unit+'&request_id='+request_id,{token,body:form})};
 return{sqlite,db,files,env,deps,req,save,story,photo,close:()=>sqlite.close()}}
test('editor grants are admin only and scoped to own unit on read/write/upload',async()=>{const f=fixture();try{
 assert.equal((await f.req('/admin-api/activity-story-grants',{token:'a'})).status,403);
 assert.equal((await f.save('a',f.story('club-a'))).status,403);assert.equal((await f.photo('a','club-a')).status,403);
 assert.equal((await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:true}})).status,200);
 assert.equal((await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID2,unit_id:'club-b',active:true}})).status,200);
 assert.equal((await f.save('a',f.story('club-a'))).status,200);assert.equal((await f.save('a',f.story('club-b','bad'))).status,403);
 assert.equal((await f.save('b',f.story('club-b','post1'),1)).status,403);assert.equal((await f.photo('b','club-a')).status,403);
 assert.deepEqual((await(await f.req('/admin-api/activity-stories',{token:'b'})).json()).stories,[]);
 assert.equal((await f.save('activity',f.story('welfare_committee','committee'))).status,200);assert.equal((await f.save('activity',f.story('club-a','bad2'))).status,403);
 assert.equal((await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:false}})).status,200);assert.equal((await f.save('a',f.story('club-a'),1)).status,403);
 }finally{f.close()}});
test('published visibility and media read enforced on list, detail and images; translations and revisions',async()=>{const f=fixture();try{
 const photo=await(await f.photo('admin','club-a')).json();const s=f.story('club-a','private','employee');s.cover_media_id=photo.id;s.blocks.push({type:'image',media_id:photo.id,caption:'說明'});
 assert.equal((await f.save('admin',s)).status,200);assert.equal((await(await f.req('/api/activity-stories')).json()).stories.length,0);assert.equal((await f.req('/api/activity-stories/private')).status,404);assert.equal((await f.req('/activity-story-media/'+photo.id)).status,404);
 assert.equal((await(await f.req('/api/activity-stories?lang=id',{token:'employee-token'})).json()).stories[0].title,'译 活動');const detail=(await(await f.req('/api/activity-stories/private?lang=th',{token:'employee-token'})).json()).story;assert.equal(detail.blocks[0].text,'译 活動內容');assert.equal(detail.blocks[1].caption,'译 說明');assert.equal((await f.req('/activity-story-media/'+photo.id,{token:'employee-token'})).status,200);
 assert.equal((await f.save('admin',s,0)).status,409);
 f.sqlite.prepare('UPDATE welfare_clubs SET content_json=? WHERE id=?').run(JSON.stringify({title:'A',status:'active',published:false}),'club-a');assert.equal((await f.req('/activity-story-media/'+photo.id,{token:'employee-token'})).status,404);
 }finally{f.close()}});
test('album linkage does not expose an employee or draft gallery to anonymous readers',async()=>{const f=fixture();try{
 f.sqlite.prepare('INSERT INTO welfare_club_galleries VALUES(?,?,?,?)').run('album1','club-a',JSON.stringify({title:'相簿',status:'published',visibility:'employee',media_ids:['m1']}),'2026-10-29');const s=f.story('club-a','public');s.gallery_id='album1';assert.equal((await f.save('admin',s)).status,200);assert.equal((await(await f.req('/api/activity-stories/public')).json()).story.album,null);assert.deepEqual((await(await f.req('/api/activity-stories/public',{token:'employee-token'})).json()).story.album.media_ids,['m1']);
 s.gallery_id='album1';s.unit_id='club-b';s.id='bad';assert.equal((await f.save('admin',s)).status,403);
 }finally{f.close()}});
test('translation failure does not save story',async()=>{const f=fixture();try{f.deps.callAi=async()=>{throw Error('down')};assert.equal((await f.save('admin',f.story('club-a'))).status,503);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n,0);}finally{f.close()}});
test('worker file route cannot bypass private story media authorization',async()=>{const {default:worker}=await import('../src/index.js');let reads=0;const env={R2_BUCKET:{async get(){reads++;return {body:new Uint8Array([1]),writeHttpMetadata(){},httpEtag:'x'}}}};for(const suffix of ['activity_story_private_secret','activity_story_private_%73ecret']){const r=await worker.fetch(new Request('https://fixture.test/file/'+suffix),env,{});assert.equal(r.status,404);assert.equal(reads,0)}});
test('album accepts 200 images and media ACL covers its photos',async()=>{const f=fixture();try{const mids=[];const add=f.sqlite.prepare('INSERT INTO welfare_activity_story_media(id,unit_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)');for(let i=0;i<201;i++){const id='media'+i;add.run(id,'welfare_committee','key'+i,'image/jpeg','a.jpg',4,'admin:1','req'+i);f.files.set('key'+i,new Uint8Array([255,216,255,217]));mids.push(id)}const s=f.story('welfare_committee','album','employee');s.album_media_ids=mids.slice(0,200);assert.equal((await f.save('activity',s)).status,200);assert.equal((await f.req('/activity-story-media/media0')).status,404);assert.equal((await f.req('/activity-story-media/media0',{token:'employee-token'})).status,200);assert.equal((await(await f.req('/api/activity-stories/album',{token:'employee-token'})).json()).story.album_media_ids.length,200);s.id='too-many';s.album_media_ids=mids;assert.equal((await f.save('activity',s)).status,400);}finally{f.close()}});
test('pagination filters visibility and units before limiting and searches the whole collection',async()=>{const f=fixture();try{
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:true}});const ins=f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id,updated_at) VALUES(?,?,?,1,?,?)');for(let i=0;i<510;i++){const a=f.story('club-b','other'+i);ins.run(a.id,a.unit_id,JSON.stringify(a),'o'+i,'2026-10-29')};for(let i=0;i<52;i++){const a=f.story('club-a','own'+i);a.title=i===0?'特別測試標題':'社團貼文';a.translations={id:{title:i===0?'Unique Result':'Other title',summary:'Ringkasan',blocks:['Cerita']}};ins.run(a.id,a.unit_id,JSON.stringify(a),'a'+i,'2026-10-28')};for(let i=0;i<60;i++){const a=f.story('club-a','draft'+i);a.status='draft';ins.run(a.id,a.unit_id,JSON.stringify(a),'d'+i,'2026-10-30')};
 let r=(await(await f.req('/api/activity-stories?unit_id=club-a&page=1')).json());assert.equal(r.stories.length,50);assert.equal(r.next_page,2);r=(await(await f.req('/api/activity-stories?unit_id=club-a&page=2')).json());assert.equal(r.stories.length,2);assert.equal(r.next_page,null);r=(await(await f.req('/api/activity-stories?lang=id&unit_id=club-a&q=Unique')).json());assert.equal(r.stories.length,1);assert.equal(r.stories[0].id,'own0');
 r=(await(await f.req('/admin-api/activity-stories?unit_id=club-a&q=特別',{token:'a'})).json());assert.equal(r.stories.length,1);assert.equal(r.stories[0].id,'own0');r=(await(await f.req('/admin-api/activity-stories?unit_id=club-a&page=3',{token:'a'})).json());assert.equal(r.stories.length,12);assert.equal(r.next_page,null);assert.equal((await f.req('/admin-api/activity-stories?unit_id=club-b',{token:'a'})).status,403);
 }finally{f.close()}});
test('media management permissions are revoked immediately; upload replay and forged requests are rejected',async()=>{const f=fixture();try{
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:true}});const requestId=crypto.randomUUID();const x=await(await f.photo('a','club-a',requestId)).json();const y=await(await f.photo('a','club-a',requestId)).json();assert.equal(x.id,y.id);assert.equal(y.replayed,true);assert.equal(f.files.size,1);assert.equal((await f.req('/activity-story-media/'+x.id+'?manage=1',{token:'a'})).status,200);assert.equal((await f.req('/activity-story-media/'+x.id+'?manage=1',{token:'b'})).status,404);assert.equal((await f.req('/admin-api/activity-stories',{token:'a',body:{story:f.story('club-a','cross'),revision:0,request_id:crypto.randomUUID(),confirmed:true},headers:{Origin:'https://evil.invalid'}})).status,403);
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:false}});assert.equal((await f.req('/activity-story-media/'+x.id+'?manage=1',{token:'a'})).status,404);assert.equal((await f.photo('a','club-a')).status,403);
 }finally{f.close()}});
test('story types default without data migration, persist on edit, and reject invalid values',async()=>{const f=fixture();try{
 const legacy=f.story('welfare_committee','legacy');const raw=JSON.stringify(legacy);f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id) VALUES(?,?,?,1,?)').run(legacy.id,legacy.unit_id,raw,'legacy-request');
 assert.equal((await(await f.req('/api/activity-stories/legacy')).json()).story.type,'highlight');assert.equal((await(await f.req('/admin-api/activity-stories',{token:'activity'})).json()).stories[0].type,'highlight');assert.equal(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').get('legacy').content_json,raw);
 assert.equal((await f.save('activity',legacy,1)).status,200);assert.equal(JSON.parse(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').get('legacy').content_json).type,'highlight');
 const article={...f.story('welfare_committee','article'),type:'article'};assert.equal((await f.save('activity',article)).status,200);const oldClient={...article};delete oldClient.type;assert.equal((await f.save('activity',oldClient,1)).status,200);assert.equal((await(await f.req('/api/activity-stories/article')).json()).story.type,'article');
 assert.equal((await f.save('activity',{...f.story('welfare_committee','bad'),type:'invalid'})).status,400);assert.equal((await f.req('/api/activity-stories?type=invalid')).status,400);assert.equal((await f.req('/admin-api/activity-stories?visibility=invalid',{token:'activity'})).status,400);
 }finally{f.close()}});
test('type and audience filters compose with permissions, unit, search, and pagination',async()=>{const f=fixture();try{
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:true}});
 const ins=f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id,updated_at) VALUES(?,?,?,1,?,?)');
 const add=(id,unit,type,visibility,title,day,status='published')=>{const s=f.story(unit,id,visibility);if(type)s.type=type;s.title=title;s.status=status;ins.run(id,unit,JSON.stringify(s),'request-'+id,day)};
 for(let i=0;i<65;i++)add('other'+i,'club-a','highlight','all','普通花絮','2026-10-30');
 for(let i=0;i<51;i++)add('article'+i,'club-a','article','all','文章測試','2026-10-29');
 add('private','club-a','article','employee','員工文章','2026-10-28');add('legacy','club-a',null,'all','舊版花絮','2026-10-27');add('other-unit','club-b','article','all','瑜珈文章','2026-10-31');add('draft','club-a','article','all','草稿文章','2026-11-01','draft');
 let a=(await(await f.req('/api/activity-stories?unit_id=club-a&type=article&visibility=all&page=1')).json());assert.equal(a.stories.length,50);assert.equal(a.next_page,2);assert.ok(a.stories.every(s=>s.type==='article'&&s.visibility==='all'));a=(await(await f.req('/api/activity-stories?unit_id=club-a&type=article&visibility=all&page=2')).json());assert.equal(a.stories.length,1);assert.equal(a.next_page,null);
 a=(await(await f.req('/api/activity-stories?unit_id=club-a&type=article&visibility=employee')).json());assert.deepEqual(a.stories,[]);assert.equal(a.next_page,null);a=(await(await f.req('/api/activity-stories?unit_id=club-a&type=article&visibility=employee',{token:'employee-token'})).json());assert.deepEqual(a.stories.map(s=>s.id),['private']);
 a=(await(await f.req('/api/activity-stories?unit_id=club-a&type=highlight&q=舊版')).json());assert.deepEqual(a.stories.map(s=>[s.id,s.type]),[['legacy','highlight']]);
 a=(await(await f.req('/admin-api/activity-stories?unit_id=club-a&type=article&visibility=employee',{token:'a'})).json());assert.deepEqual(a.stories.map(s=>s.id),['private']);assert.equal((await f.req('/admin-api/activity-stories?unit_id=club-b&type=article',{token:'a'})).status,403);
 assert.equal((await f.req('/api/activity-stories/private')).status,404);assert.equal((await f.req('/api/activity-stories/private',{token:'employee-token'})).status,200);
 }finally{f.close()}});
test('audience filtering cannot expose private story photos to visitors',async()=>{const f=fixture();try{
 const photo=(await(await f.photo('activity','welfare_committee')).json()).id;
 const s={...f.story('welfare_committee','private-article','employee'),type:'article',cover_media_id:photo,album_media_ids:[photo]};
 assert.equal((await f.save('activity',s)).status,200);
 const visitor=(await(await f.req('/api/activity-stories?type=article&visibility=employee')).json());assert.deepEqual(visitor.stories,[]);assert.equal((await f.req('/api/activity-stories/private-article')).status,404);assert.equal((await f.req('/activity-story-media/'+photo)).status,404);
 const employee=(await(await f.req('/api/activity-stories?type=article&visibility=employee',{token:'employee-token'})).json());assert.deepEqual(employee.stories.map(x=>x.id),['private-article']);assert.equal((await f.req('/activity-story-media/'+photo,{token:'employee-token'})).status,200);
 }finally{f.close()}});


test('moving a story checks both unit grants and preserves only its referenced media',async()=>{const f=fixture();try{
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:true}});
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID2,unit_id:'club-b',active:true}});
 const first=(await(await f.photo('admin','club-a')).json()).id, unrelated=(await(await f.photo('admin','club-a')).json()).id;
 const s={...f.story('club-a','move','employee'),cover_media_id:first,blocks:[{type:'image',media_id:first,caption:'封面'}],album_media_ids:[first]};
 const other={...f.story('club-a','shared'),cover_media_id:first};
 assert.equal((await f.save('admin',s)).status,200);assert.equal((await f.save('admin',other)).status,200);
 let moved={...s,unit_id:'club-b'};
 assert.equal((await f.save('a',moved,1)).status,403);assert.equal((await f.save('b',moved,1)).status,403);
 assert.equal((await f.save('admin',{...moved,album_media_ids:[first,unrelated]},1)).status,403);
 assert.equal((await f.save('admin',{...f.story('club-b','forged'),cover_media_id:first})).status,403);
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-b',active:true}});
 const reqId=crypto.randomUUID();let response=await f.save('a',moved,1,reqId);assert.equal(response.status,200,await response.clone().text());
 response=await f.save('a',moved,1,reqId);assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);
 assert.equal((await f.save('admin',s,1)).status,409);
 const row=f.sqlite.prepare('SELECT unit_id,revision,content_json FROM welfare_activity_stories WHERE id=?').get('move'),content=JSON.parse(row.content_json);
 assert.equal(row.unit_id,'club-b');assert.equal(row.revision,2);assert.equal(content.cover_media_id,first);assert.equal(content.blocks[0].media_id,first);assert.deepEqual(content.album_media_ids,[first]);
 assert.equal(f.sqlite.prepare('SELECT unit_id FROM welfare_activity_story_media WHERE id=?').get(first).unit_id,'club-a');
 assert.equal(f.sqlite.prepare('SELECT unit_id FROM welfare_activity_stories WHERE id=?').get('shared').unit_id,'club-a');
 // B gains access only through its own referencing story. The unrelated image remains private.
 assert.equal((await f.req('/activity-story-media/'+first+'?manage=1',{token:'b'})).status,200);
 assert.equal((await f.req('/activity-story-media/'+unrelated+'?manage=1',{token:'b'})).status,404);
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:false}});
 assert.equal((await f.req('/activity-story-media/'+first+'?manage=1',{token:'a'})).status,200);
 await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-b',active:false}});
 assert.equal((await f.req('/activity-story-media/'+first+'?manage=1',{token:'a'})).status,404);
 assert.equal((await f.req('/activity-story-media/'+first)).status,200); // Other public story still references it.
 f.sqlite.prepare('UPDATE welfare_clubs SET content_json=? WHERE id=?').run(JSON.stringify({title:'A',status:'active',published:false}),'club-a');
 assert.equal((await f.req('/activity-story-media/'+first)).status,404); // moved story is employee-only.
 assert.equal((await f.req('/activity-story-media/'+first,{token:'employee-token'})).status,200);
 assert.equal((await f.req('/api/activity-stories/move',{token:'employee-token'})).status,200);
 moved={...moved,visibility:'all'};assert.equal((await f.save('admin',moved,2)).status,200);
 assert.equal((await f.req('/activity-story-media/'+first)).status,200); // Destination is published.
 f.sqlite.prepare('UPDATE welfare_clubs SET content_json=? WHERE id=?').run(JSON.stringify({title:'B',status:'active',published:false}),'club-b');
 assert.equal((await f.req('/activity-story-media/'+first)).status,404);
 }finally{f.close()}});

test('moving a story rejects a gallery owned by the old club until explicitly unlinked',async()=>{const f=fixture();try{
 f.sqlite.prepare('INSERT INTO welfare_club_galleries VALUES(?,?,?,?)').run('gallery-a','club-a',JSON.stringify({title:'album',status:'published',visibility:'all',media_ids:[]}),'2026-10-29');
 const s={...f.story('club-a','gallery-move'),gallery_id:'gallery-a'};assert.equal((await f.save('admin',s)).status,200);
 assert.equal((await f.save('admin',{...s,unit_id:'club-b'},1)).status,403);
 const row=f.sqlite.prepare('SELECT unit_id,revision FROM welfare_activity_stories WHERE id=?').get(s.id);assert.equal(row.unit_id,'club-a');assert.equal(row.revision,1);
 assert.equal((await f.save('admin',{...s,unit_id:'club-b',gallery_id:''},1)).status,200);
 }finally{f.close()}});


test('a concurrent edit during translation prevents a stale unit transfer',async()=>{const f=fixture();try{
 const s=f.story('club-a','racing');assert.equal((await f.save('admin',s)).status,200);
 let raced=false;f.deps.callAi=async(_env,m)=>{if(!raced){raced=true;f.sqlite.prepare('UPDATE welfare_activity_stories SET unit_id=?,revision=revision+1 WHERE id=?').run('welfare_committee',s.id)}return {texts:JSON.parse(m[1].content).texts.map(x=>x?'譯 '+x:'')};};
 const move={...s,unit_id:'club-b',title:'changed'};const result=await f.save('admin',move,1);assert.equal(result.status,409);
 const row=f.sqlite.prepare('SELECT unit_id,revision FROM welfare_activity_stories WHERE id=?').get(s.id);assert.equal(row.unit_id,'welfare_committee');assert.equal(row.revision,2);
 }finally{f.close()}});


test('revoking editor grants or role during translation prevents transfer atomically',async()=>{
 for(const revoked of ['source','target','role']){const f=fixture();try{
  await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-a',active:true}});
  await f.req('/admin-api/activity-story-grants',{token:'admin',body:{line_user_id:UID1,unit_id:'club-b',active:true}});
  const s=f.story('club-a','revoke-race');assert.equal((await f.save('a',s)).status,200);
  let revokedOnce=false;f.deps.callAi=async(_env,m)=>{if(!revokedOnce){revokedOnce=true;if(revoked==='role')f.sqlite.prepare('UPDATE admin_uid_whitelist SET active=0 WHERE line_user_id=?').run(UID1);else f.sqlite.prepare('DELETE FROM welfare_activity_story_grants WHERE line_user_id=? AND unit_id=?').run(UID1,revoked==='source'?'club-a':'club-b');}return {texts:JSON.parse(m[1].content).texts.map(x=>x?'譯 '+x:'')};};
  const result=await f.save('a',{...s,unit_id:'club-b',title:'changed'},1);assert.equal(result.status,409,revoked);
  const row=f.sqlite.prepare('SELECT unit_id,revision FROM welfare_activity_stories WHERE id=?').get(s.id);assert.equal(row.unit_id,'club-a',revoked);assert.equal(row.revision,1,revoked);
 }finally{f.close()}}
});


test('uncertain batch outcome safely recovers by exact actor and request fingerprint',async()=>{const f=fixture();try{
 const s=f.story('club-a','uncertain'),requestId=crypto.randomUUID(),batch=f.db.batch;let failOnce=true;
 f.db.batch=async statements=>{const out=await batch(statements);if(failOnce){failOnce=false;throw Error('simulated lost response')}return out};
 const result=await f.save('admin',s,0,requestId);assert.equal(result.status,200);assert.equal((await result.json()).replayed,true);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions WHERE request_id=?').get(requestId).n,1);
 assert.equal((await f.save('admin',{...s,title:'different'},0,requestId)).status,409);
 }finally{f.close()}});


test('direct LINE admin loses write access if whitelist role changes during translation',async()=>{const f=fixture();try{
 const s=f.story('club-a','line-admin-race');assert.equal((await f.save('admin',s)).status,200);
 f.sqlite.prepare("UPDATE admin_uid_whitelist SET role='admin' WHERE line_user_id=?").run(UID3);
 f.deps.verifyLine=async()=>({lineUserId:UID3});f.deps.findAdmin=async(db,uid)=>db.prepare('SELECT * FROM admin_uid_whitelist WHERE line_user_id=?').bind(uid).first();
 let changed=false;f.deps.callAi=async(_env,m)=>{if(!changed){changed=true;f.sqlite.prepare("UPDATE admin_uid_whitelist SET role='viewer' WHERE line_user_id=?").run(UID3)}return {texts:JSON.parse(m[1].content).texts.map(x=>x?'譯 '+x:'')};};
 const result=await f.req('/admin-api/activity-stories',{headers:{'X-Line-Id-Token':'line-fixture'},body:{story:{...s,unit_id:'club-b',title:'changed'},revision:1,request_id:crypto.randomUUID(),confirmed:true}});assert.equal(result.status,409);
 const row=f.sqlite.prepare('SELECT unit_id,revision FROM welfare_activity_stories WHERE id=?').get(s.id);assert.equal(row.unit_id,'club-a');assert.equal(row.revision,1);
 }finally{f.close()}});
