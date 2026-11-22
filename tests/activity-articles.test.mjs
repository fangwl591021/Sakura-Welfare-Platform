import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleActivityStoryRequest} from '../src/activity-stories-service.js';

const CLUB_EDITOR='U'+'1'.repeat(32),EMPLOYEE='U'+'2'.repeat(32);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE welfare_clubs(id TEXT PRIMARY KEY,content_json TEXT);CREATE TABLE welfare_club_galleries(id TEXT PRIMARY KEY,club_id TEXT,content_json TEXT,updated_at TEXT);CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY,audience_scope TEXT);CREATE TABLE welfare_activity_club_links(id TEXT PRIMARY KEY,club_id TEXT);CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,member_type TEXT,status TEXT,bind_status TEXT);CREATE TABLE admin_uid_whitelist(line_user_id TEXT,display_name TEXT,role TEXT,active INTEGER);`);
 sqlite.exec(readFileSync(new URL('../migrations/0036_activity_stories.sql',import.meta.url),'utf8'));
 for(const name of ['club-a','club-b'])sqlite.prepare('INSERT INTO welfare_clubs VALUES(?,?)').run(name,JSON.stringify({title:name,status:'active',published:true}));
 sqlite.prepare('INSERT INTO admin_uid_whitelist VALUES(?,?,?,1)').run(CLUB_EDITOR,'Synthetic editor','club_editor');
 sqlite.prepare('INSERT INTO welfare_activity_story_grants(line_user_id,unit_id) VALUES(?,?)').run(CLUB_EDITOR,'club-a');
 sqlite.prepare('INSERT INTO welfare_members VALUES(?,?,?,?)').run(EMPLOYEE,'employee','active','bound');
 const reads=[];const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
 const db={prepare(sql){const statement=(...args)=>({async first(){const result=sqlite.prepare(sql).get(...args)||null;reads.push({sql,bytes:bytes(result)});return result;},async all(){const results=sqlite.prepare(sql).all(...args);reads.push({sql,bytes:bytes(results)});return {results};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}});return {...statement(),bind:statement}}};
 db.batch=async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}};
 const aiCalls=[];const goodAi=async(_env,messages,options)=>{const input=JSON.parse(messages[1].content).texts,locale=messages[0].content.includes('Indonesian')?'id':'th';aiCalls.push({input,locale,options});return {texts:input.map(value=>value?(locale.toUpperCase()+' '+value):'')};};
 const env={DB:db,OPENAI_API_KEY:'synthetic-only',R2_BUCKET:{async get(){return {body:new Uint8Array([255,216,255,217])}}}};
 const auth={admin:{id:'1',role:'admin'},editor:{id:'2',line_user_id:CLUB_EDITOR,role:'club_editor'},activity:{id:'3',role:'activity_editor'}};
 const deps={requireAdmin:async({sessionToken})=>auth[sessionToken]?{ok:true,user:auth[sessionToken]}:{ok:false},findAdmin:async()=>null,verifyLine:async(_env,token)=>token==='employee-token'?{lineUserId:EMPLOYEE}:null,callAi:goodAi};
 const req=(path,{body,raw,token='admin',method=(body||raw)?'POST':'GET',headers={}}={})=>handleActivityStoryRequest(new Request('https://article.test'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...((body||raw)?{'Content-Type':'application/json'}:{}),...headers},...((body||raw)?{body:raw??JSON.stringify(body)}:{})}),env,deps);
 const article=(id='article',overrides={})=>({id,unit_id:'club-a',type:'article',title:'文章',summary:'摘要',event_date:'',cover_media_id:'',visibility:'all',status:'draft',blocks:[{type:'text',text:'正文'}],gallery_id:'',album_media_ids:[],...overrides});
 const payload=(story,revision=0,request_id=crypto.randomUUID())=>({story,revision,request_id,confirmed:true});
 const save=(story,revision=0,requestId,token='admin')=>req('/admin-api/activity-stories',{token,body:payload(story,revision,requestId)});
 const row=id=>sqlite.prepare('SELECT * FROM welfare_activity_stories WHERE id=?').get(id);
 const content=id=>JSON.parse(row(id).content_json);
 return {sqlite,db,env,deps,aiCalls,goodAi,reads,req,article,payload,save,row,content,close:()=>sqlite.close()};
}

test('long article draft roundtrips full text and every new block without an AI key',async()=>{
 const f=fixture();try{
  delete f.env.OPENAI_API_KEY;f.deps.callAi=()=>{throw Error('Draft must not use AI')};
  f.sqlite.prepare('INSERT INTO welfare_activity_story_media(id,unit_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)').run('photo','club-a','private-photo','image/jpeg','fixture.jpg',4,'synthetic','photo-request');
  const text='文'.repeat(50000),blocks=[{type:'heading',level:2,text:'段落標題'},{type:'text',text},{type:'quote',text:'引用\n原文'},{type:'list',style:'ordered',items:['第一項','第二項']},{type:'image',media_id:'photo',caption:'照片說明'},{type:'video',url:'https://www.youtube.com/watch?v=uUJU66syCgk'}];
  const story=f.article('long-draft',{blocks});assert.ok(new TextEncoder().encode(JSON.stringify(f.payload(story))).length>150000);
  assert.equal((await f.save(story)).status,200);assert.deepEqual(f.content(story.id).blocks,blocks);assert.equal(f.content(story.id).translations,undefined);
  const loaded=(await(await f.req('/admin-api/activity-stories?type=article')).json()).stories[0];assert.deepEqual(loaded.blocks,blocks);assert.equal(loaded.summary,'摘要');assert.equal(loaded.blocks[1].text.length,50000);assert.equal((await f.req('/api/activity-stories/long-draft',{token:''})).status,404);
 }finally{f.close();}
});

test('unfinished article drafts keep empty headings, lists and paragraphs',async()=>{
 const f=fixture();try{const blocks=[{type:'text',text:''},{type:'heading',level:3,text:''},{type:'quote',text:''},{type:'list',style:'bullet',items:[]}];assert.equal((await f.save(f.article('empty',{blocks}))).status,200);assert.deepEqual(f.content('empty').blocks,blocks);assert.equal(f.aiCalls.length,0);}finally{f.close();}
});

test('publication splits long values and localizes headings, quotes, lists and captions without truncation',async()=>{
 const f=fixture();try{
  f.sqlite.prepare('INSERT INTO welfare_activity_story_media(id,unit_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)').run('photo','club-a','private-photo','image/jpeg','fixture.jpg',4,'synthetic','photo-request');
  const source=Array.from({length:1700},(_,i)=>'第'+i+'段文章內容。\n').join('')+'全文結尾';const story=f.article('published',{status:'published',blocks:[{type:'heading',level:2,text:'文章標題'},{type:'text',text:source},{type:'quote',text:'引用內容'},{type:'list',style:'ordered',items:['費用 1200 元','網址 https://example.test/a?x=42']},{type:'image',media_id:'photo',caption:'照片文字'},{type:'video',url:'https://www.youtube.com/watch?v=uUJU66syCgk'}]});
  assert.equal((await f.save(story)).status,200);assert.ok(f.aiCalls.length>4);assert.ok(f.aiCalls.every(c=>c.input.every(v=>v.length<=1400)&&c.input.reduce((n,v)=>n+v.length,0)<=4000&&c.options.store===false&&c.options.signal instanceof AbortSignal));
  for(const locale of ['id','th']){const detail=(await(await f.req('/api/activity-stories/published?lang='+locale,{token:''})).json()).story;assert.equal(detail.blocks[0].level,2);assert.equal(detail.blocks[0].text,locale.toUpperCase()+' 文章標題');assert.equal(detail.blocks[1].text.replaceAll(locale.toUpperCase()+' ',''),source);assert.equal(detail.blocks[2].text,locale.toUpperCase()+' 引用內容');assert.deepEqual(detail.blocks[3],{type:'list',style:'ordered',items:[locale.toUpperCase()+' 費用 1200 元',locale.toUpperCase()+' 網址 https://example.test/a?x=42']});assert.equal(detail.blocks[4].media_id,'photo');assert.equal(detail.blocks[4].caption,locale.toUpperCase()+' 照片文字');assert.equal(detail.blocks[5].url,'https://www.youtube.com/watch?v=uUJU66syCgk');}
 }finally{f.close();}
});

test('article type survives old clients and metadata edits reuse complete translations',async()=>{
 const f=fixture();try{const story=f.article('reuse',{status:'published'});assert.equal((await f.save(story)).status,200);const calls=f.aiCalls.length,old=f.content('reuse').translations;const oldClient={...story,visibility:'employee'};delete oldClient.type;assert.equal((await f.save(oldClient,1)).status,200);assert.equal(f.content('reuse').type,'article');assert.deepEqual(f.content('reuse').translations,old);assert.equal(f.aiCalls.length,calls);assert.equal((await f.req('/api/activity-stories/reuse',{token:''})).status,404);assert.equal((await f.req('/api/activity-stories/reuse',{token:'employee-token'})).status,200);}finally{f.close();}
});

test('draft edits discard stale translations and republish regenerates both locales',async()=>{
 const f=fixture();try{const story=f.article('republish',{status:'published'});assert.equal((await f.save(story)).status,200);const calls=f.aiCalls.length;story.status='draft';assert.equal((await f.save(story,1)).status,200);assert.ok(f.content('republish').translations);assert.equal(f.aiCalls.length,calls);story.blocks=[{type:'quote',text:'全新引用'}];assert.equal((await f.save(story,2)).status,200);assert.equal(f.content('republish').translations,undefined);assert.equal(f.aiCalls.length,calls);story.status='published';assert.equal((await f.save(story,3)).status,200);assert.equal(f.content('republish').translations.th.blocks[0],'TH 全新引用');assert.ok(f.aiCalls.length>calls);}finally{f.close();}
});

test('failed article translation keeps saved draft and retry/replay commits exactly once',async()=>{
 const f=fixture();try{const story=f.article('retry');assert.equal((await f.save(story)).status,200);const previous=f.row('retry'),requestId=crypto.randomUUID();story.status='published';f.deps.callAi=async()=>{throw Error('synthetic outage')};assert.equal((await f.save(story,1,requestId)).status,503);assert.deepEqual(f.row('retry'),previous);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,1);f.deps.callAi=f.goodAi;assert.equal((await f.save(story,1,requestId)).status,200);const calls=f.aiCalls.length;const replay=await(await f.save(story,1,requestId)).json();assert.equal(replay.replayed,true);assert.equal(f.aiCalls.length,calls);assert.equal(f.row('retry').revision,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,2);assert.equal((await f.save({...story,title:'other'},2,requestId)).status,409);}finally{f.close();}
});

test('article provider deadline aborts both locales and leaves the saved draft unchanged',async t=>{
 const f=fixture();try{const story=f.article('timeout');assert.equal((await f.save(story)).status,200);const previous=f.row(story.id);let startedResolve,aborted=0;const started=new Promise(resolve=>{startedResolve=resolve;});f.deps.callAi=async(_env,_messages,options)=>new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>{aborted++;reject(Error('synthetic abort'));},{once:true});startedResolve();});t.mock.timers.enable({apis:['setTimeout']});story.status='published';const pending=f.save(story,1);await started;t.mock.timers.tick(90001);assert.equal((await pending).status,503);assert.equal(aborted,2);assert.deepEqual(f.row(story.id),previous);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,1);}finally{t.mock.timers.reset();f.close();}
});

test('missing locale items and changed protected tokens cannot partially publish',async()=>{
 for(const failure of ['missing','number','email','url']){const f=fixture();try{f.deps.callAi=async(_env,messages)=>{let texts=JSON.parse(messages[1].content).texts.map(v=>'翻 '+v);if(messages[0].content.includes('Thai')){if(failure==='missing')texts=texts.slice(1);if(failure==='number')texts=texts.map(v=>v.replace('2026','2025'));if(failure==='email')texts=texts.map(v=>v.replace('a@example.test','b@example.test'));if(failure==='url')texts=texts.map(v=>v.replace('https://example.test/path','https://wrong.test/path'));}return {texts};};const story=f.article('invalid-translation',{status:'published',blocks:[{type:'text',text:'2026/10/29 聯絡 a@example.test，https://example.test/path'}]});assert.equal((await f.save(story)).status,503,failure);assert.equal(f.row(story.id),undefined);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,0);}finally{f.close();}}
});

test('protected long URL is retained literally and never split into provider fragments',async()=>{
 const f=fixture();try{const url='https://example.test/'+('a'.repeat(2200));const story=f.article('long-url',{status:'published',blocks:[{type:'text',text:'前文 '+url+' 後文 2026/10/29'}]});assert.equal((await f.save(story)).status,200);for(const locale of ['id','th'])assert.ok(f.content('long-url').translations[locale].blocks[0].includes(url));assert.ok(f.aiCalls.every(call=>call.input.every(v=>!v.includes(url))));}finally{f.close();}
});

test('Unicode code points and protected numeric occurrences survive chunk boundaries',async()=>{
 const f=fixture();try{const source='😀'.repeat(8000)+'\n100 100\n'+'尾'.repeat(2000);const story=f.article('unicode',{status:'published',blocks:[{type:'text',text:source}]});assert.equal((await f.save(story)).status,200);assert.equal(f.content('unicode').translations.id.blocks[0].replaceAll('ID ',''),source);assert.ok(f.aiCalls.every(call=>call.input.every(value=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))));f.deps.callAi=async(_env,messages)=>({texts:JSON.parse(messages[1].content).texts.map(value=>value.replace('100 100','100'))});assert.equal((await f.save(f.article('lost-number',{status:'published',blocks:[{type:'text',text:'100 100'}]}))).status,503);assert.equal(f.row('lost-number'),undefined);}finally{f.close();}
});

test('all article scalar, list, block count and total text limits reject rather than truncate',async()=>{
 const f=fixture();try{
  const cases=[{blocks:Array.from({length:201},()=>({type:'text',text:''}))},{blocks:[{type:'text',text:'x'.repeat(50001)}]},{blocks:[{type:'quote',text:'x'.repeat(20001)}]},{blocks:[{type:'heading',level:2,text:'x'.repeat(301)}]},{blocks:[{type:'heading',level:1,text:'x'}]},{blocks:[{type:'heading',level:'2',text:'x'}]},{blocks:[{type:'list',style:'bullet',items:Array(201).fill('x')}]},{blocks:[{type:'list',style:'bullet',items:['x'.repeat(2001)]}]},{blocks:[{type:'list',style:'task',items:['x']}]},{blocks:[{type:'list',style:'ordered',items:'x'}]},{blocks:[{type:'list',style:'ordered',items:[12]}]},{blocks:[{type:'list',style:'ordered',items:[null]}]},{blocks:[{type:'unknown',text:'x'}]},{blocks:[[]]},{title:'x'.repeat(151)},{summary:'x'.repeat(501)}];
  for(let i=0;i<cases.length;i++){const story=f.article('limit-'+i,cases[i]);assert.equal((await f.save(story)).status,400,'case '+i);assert.equal(f.row(story.id),undefined);}
  const exact=f.article('exact',{blocks:[{type:'text',text:'a'.repeat(50000)},{type:'text',text:'b'.repeat(49996)}]});assert.equal((await f.save(exact)).status,200);const over=f.article('over',{blocks:[{type:'text',text:'a'.repeat(50000)},{type:'text',text:'b'.repeat(49997)}]});assert.equal((await f.save(over)).status,400);assert.equal(f.row('over'),undefined);
  assert.equal((await f.save(f.article('max-blocks',{blocks:Array.from({length:200},()=>({type:'text',text:''}))}))).status,200);assert.equal(f.aiCalls.length,0);
 }finally{f.close();}
});

test('article request stays below one million bytes and highlight keeps its 150KB request limit',async()=>{
 const f=fixture();try{
  const padded=(story,size)=>{const raw=JSON.stringify(f.payload(story)),bytes=new TextEncoder().encode(raw).length;assert.ok(bytes<size);return raw+' '.repeat(size-bytes);};
  const article=f.article('padded');assert.equal((await f.req('/admin-api/activity-stories',{raw:padded(article,999999)})).status,200);assert.equal((await f.req('/admin-api/activity-stories',{raw:padded(f.article('too-big'),1000001)})).status,413);assert.equal(f.row('too-big'),undefined);
  const highlight=f.article('highlight',{type:'highlight'});assert.equal((await f.req('/admin-api/activity-stories',{raw:padded(highlight,150001)})).status,413);assert.equal(f.row('highlight'),undefined);assert.equal(f.aiCalls.length,0);
 }finally{f.close();}
});

test('persisted article translations are byte-bounded before any story/audit commit',async()=>{
 const f=fixture();try{f.deps.callAi=async(_env,messages)=>({texts:JSON.parse(messages[1].content).texts.map(v=>'泰'.repeat(7000)+v)});const story=f.article('stored-limit',{status:'published',blocks:[{type:'text',text:'文'.repeat(50000)}]});assert.equal((await f.save(story)).status,413);assert.equal(f.row(story.id),undefined);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,0);}finally{f.close();}
});

test('article writes retain unit/media ownership, scoped transfers and revision boundaries',async()=>{
 const f=fixture();try{
  const story=f.article('owned');assert.equal((await f.save(story,0,undefined,'editor')).status,200);const previous=f.row(story.id);
  assert.equal((await f.save({...story,unit_id:'club-b'},1,undefined,'editor')).status,403);assert.equal((await f.save(story,0)).status,409);assert.equal((await f.save(f.article('activity-club'),0,undefined,'activity')).status,403);
  f.sqlite.prepare('INSERT INTO welfare_activity_story_media(id,unit_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)').run('foreign','club-b','secret','image/jpeg','fixture.jpg',4,'synthetic','foreign-request');
  for(const payload of [{cover_media_id:'foreign'},{blocks:[{type:'image',media_id:'foreign',caption:''}]},{album_media_ids:['foreign']}])assert.equal((await f.save({...story,...payload},1)).status,403);
  assert.deepEqual(f.row(story.id),previous);assert.equal(f.aiCalls.length,0);
  assert.equal((await f.save({...story,unit_id:'club-b'},1)).status,200);assert.equal(f.row(story.id).unit_id,'club-b');assert.equal(f.row(story.id).revision,2);
 }finally{f.close();}
});

test('highlight block/text caps and provider-dependent draft behavior remain unchanged',async()=>{
 const f=fixture();try{for(const blocks of [[{type:'heading',level:2,text:'x'}],[{type:'quote',text:'x'}],[{type:'list',style:'bullet',items:['x']}],[{type:'text',text:'x'.repeat(6001)}],Array.from({length:101},()=>({type:'text',text:''}))])assert.equal((await f.save(f.article(crypto.randomUUID(),{type:'highlight',blocks}))).status,400);delete f.env.OPENAI_API_KEY;assert.equal((await f.save(f.article('highlight-draft',{type:'highlight'}))).status,503);assert.equal(f.row('highlight-draft'),undefined);f.env.OPENAI_API_KEY='synthetic-only';f.deps.callAi=async(...args)=>{await f.goodAi(...args);return {texts:JSON.parse(args[1][1].content).texts};};assert.equal((await f.save(f.article('highlight-ok',{type:'highlight',blocks:[{type:'text',text:'x'.repeat(6000)}]}))).status,200);assert.equal(f.aiCalls.length,2);}finally{f.close();}
});

test('51 valid long articles use SQL-projected public/admin lists and bounded legacy reads',async()=>{
 const f=fixture();try{
  const body='文'.repeat(50000),seed=f.article('large-00',{status:'published',blocks:[{type:'text',text:body}]});
  assert.equal((await f.save(seed)).status,200);const stored=f.row(seed.id).content_json,recordBytes=new TextEncoder().encode(stored).byteLength;
  assert.ok(recordBytes>400000&&recordBytes<1800000);
  const insert=f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id) VALUES(?,?,?,1,?)');
  for(let i=1;i<51;i++)insert.run('large-'+String(i).padStart(2,'0'),'club-a',stored,'seed-'+i);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n,51);
  for(const locale of ['zh','id','th']){
   f.reads.length=0;const response=await f.req('/api/activity-stories?unit_id=club-a&type=article&lang='+locale,{token:''}),raw=await response.text(),result=JSON.parse(raw);
   assert.equal(response.status,200);assert.equal(result.stories.length,50);assert.equal(result.next_page,2);assert.ok(new TextEncoder().encode(raw).byteLength<100000);
   assert.ok(result.stories.every(story=>!('blocks' in story)&&!('album_media_ids' in story)&&!('translations' in story)));
   const storyReads=f.reads.filter(read=>read.sql.includes('welfare_activity_stories'));assert.equal(storyReads.length,1);assert.match(storyReads[0].sql,/json_remove\(content_json/);assert.ok(storyReads[0].bytes<200000);
  }
  f.reads.length=0;let response=await f.req('/admin-api/activity-stories?unit_id=club-a&type=article&projection=summary',{token:'editor'}),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.stories.length,50);assert.equal(result.next_page,2);assert.ok(result.stories.every(story=>story.detail_required===true&&!('blocks' in story)&&!('album_media_ids' in story)&&!('translations' in story)&&story.revision===1));
  let storyReads=f.reads.filter(read=>read.sql.includes('welfare_activity_stories'));assert.equal(storyReads.length,1);assert.match(storyReads[0].sql,/json_remove\(content_json/);assert.ok(storyReads[0].bytes<200000);
  f.reads.length=0;response=await f.req('/admin-api/activity-stories?unit_id=club-a&type=article',{token:'editor'});assert.equal(response.status,413);assert.match((await response.json()).message,/編輯器已更新，請重新載入後再試/);
  storyReads=f.reads.filter(read=>read.sql.includes('welfare_activity_stories'));assert.equal(storyReads.length,1);assert.match(storyReads[0].sql,/length\(CAST\(content_json AS BLOB\)\)/);assert.ok(storyReads[0].bytes<10000);assert.doesNotMatch(storyReads[0].sql,/SELECT \*/);
  f.reads.length=0;response=await f.req('/admin-api/activity-stories?unit_id=club-a&type=article&page=2',{token:'editor'});result=await response.json();assert.equal(response.status,200);assert.equal(result.stories.length,1);assert.equal(result.next_page,null);assert.equal(result.stories[0].blocks[0].text,body);assert.ok(!('detail_required' in result.stories[0]));
  assert.ok(f.reads.filter(read=>read.sql.includes('welfare_activity_stories')).every(read=>read.bytes<1000000));
  response=await f.req('/admin-api/activity-stories?projection=summary&page=999999',{token:'editor'});result=await response.json();assert.equal(response.status,200);assert.deepEqual(result.stories,[]);assert.equal(result.next_page,null);
 }finally{f.close();}
});

test('authorized article detail returns full content and rechecks scope, unit and visibility',async()=>{
 const f=fixture();try{
  const body='完整正文'.repeat(11000)+'END';const story=f.article('detail',{status:'draft',visibility:'employee',blocks:[{type:'heading',level:3,text:'段落'},{type:'text',text:body},{type:'list',style:'bullet',items:['甲','乙']}]});assert.equal((await f.save(story,0,undefined,'editor')).status,200);
  const before=f.row(story.id),calls=f.aiCalls.length;
  let response=await f.req('/admin-api/activity-stories?id=detail',{token:'editor'}),result=await response.json();assert.equal(response.status,200);assert.deepEqual(result.story.blocks,story.blocks);assert.equal(result.story.status,'draft');assert.equal(result.story.visibility,'employee');assert.equal(result.story.revision,1);assert.ok(!('detail_required' in result.story));assert.equal(result.stories,undefined);
  assert.equal((await f.req('/admin-api/activity-stories?id=detail',{token:'activity'})).status,404);assert.equal((await f.req('/admin-api/activity-stories?id=detail',{token:''})).status,403);assert.equal((await f.req('/admin-api/activity-stories?id=missing',{token:'editor'})).status,404);assert.equal((await f.req('/admin-api/activity-stories?id=detail&unit_id=club-b',{token:'editor'})).status,403);assert.equal((await f.req('/admin-api/activity-stories?id=detail&unit_id=club-b',{token:'admin'})).status,404);assert.equal((await f.req('/admin-api/activity-stories?id=%2Fbad',{token:'editor'})).status,400);
  f.sqlite.prepare('DELETE FROM welfare_activity_story_grants WHERE line_user_id=?').run(CLUB_EDITOR);assert.equal((await f.req('/admin-api/activity-stories?id=detail',{token:'editor'})).status,404);assert.equal((await f.req('/api/activity-stories/detail',{token:''})).status,404);
  assert.equal(f.aiCalls.length,calls);assert.deepEqual(f.row(story.id),before);
 }finally{f.close();}
});

test('legacy byte budget is rechecked inside full SQL when content grows after metadata read',async()=>{
 const f=fixture();try{
  assert.equal((await f.save(f.article('race'))).status,200);
  const expanded={...f.content('race'),status:'published',blocks:[{type:'text',text:'文'.repeat(50000)},{type:'text',text:'文'.repeat(49996)}],translations:{id:{title:'Article',summary:'Summary',blocks:['譯'.repeat(50000),'譯'.repeat(49996)]},th:{title:'Article',summary:'Summary',blocks:['泰'.repeat(50000),'泰'.repeat(49996)]}}};
  const raw=JSON.stringify(expanded);assert.ok(new TextEncoder().encode(raw).byteLength>800000);
  f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id) VALUES(?,?,?,1,?)').run('race2','club-a',f.row('race').content_json,'race2');
  const original=f.db.prepare.bind(f.db);let expandedOnce=false;
  f.db.prepare=sql=>{const statement=original(sql);if(!sql.startsWith('SELECT id,length(CAST(content_json AS BLOB))'))return statement;return {...statement,bind:(...args)=>{const bound=statement.bind(...args);return {...bound,all:async()=>{const result=await bound.all();f.sqlite.prepare('UPDATE welfare_activity_stories SET content_json=?').run(raw);expandedOnce=true;return result;}};}};};
  f.reads.length=0;const response=await f.req('/admin-api/activity-stories?unit_id=club-a',{token:'editor'});assert.equal(response.status,413);assert.equal(expandedOnce,true);assert.match((await response.json()).message,/重新載入/);
  const full=f.reads.find(read=>read.sql.startsWith('WITH page AS'));assert.ok(full);assert.equal(full.bytes,2,'expanded content must stay in SQLite rather than being transferred to the Worker');
 }finally{f.close();}
});
