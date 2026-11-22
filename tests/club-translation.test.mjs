import test from 'node:test';
import assert from 'node:assert/strict';
import { clubFixture } from './club-fixture.mjs';
import { translateClubContent } from '../src/club-translation.js';

const payload = () => ({ id:'club-new', title:'新社團', description:'每週運動，分機 #258', contact:'宋欣樺 #258', join_rules:'請洽窗口', status:'active', published:true });
function capture(f, transform = text => 'translated: ' + text) {
  const calls=[];
  f.deps.callAi=async (_env,messages,options)=>{calls.push({messages,options});return {texts:JSON.parse(messages[1].content).texts.map(transform)};};
  return calls;
}

test('new club saves both languages atomically and public reads reuse persisted translations',async()=>{
 const f=clubFixture();try{
  const calls=capture(f),data=payload();assert.equal((await f.save('club',data)).status,200);
  const saved=f.club(data.id);assert.equal(saved.description,data.description);assert.equal(calls.length,2);
  for(const lang of ['id','th']){const visible=(await(await f.call('/api/clubs?lang='+lang)).json()).clubs.find(c=>c.id===data.id);for(const key of ['title','description','contact','join_rules'])assert.equal(visible[key],'translated: '+data[key]);}
  assert.equal(calls.length,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_actions').get().n,1);
  for(const call of calls){assert.equal(call.options.store,false);assert.ok(call.options.signal instanceof AbortSignal);assert.match(call.messages[0].content,/untrusted content/);assert.doesNotMatch(call.messages[1].content,/test-admin|test-member|0900000000/);}
 }finally{f.close();}
});

test('changed Chinese refreshes only stale fields while unchanged translations stay intact',async()=>{
 const f=clubFixture();try{
  await f.save('club',payload());const old=f.club('club-new'),calls=capture(f,text=>'new: '+text);
  assert.equal((await f.save('club',{...old,description:'新的活動介紹'},old.revision)).status,200);
  const saved=f.club(old.id);for(const lang of ['id','th']){assert.equal(saved.translations[lang].description,'new: 新的活動介紹');assert.equal(saved.translations[lang].title,old.translations[lang].title);}
  assert.deepEqual(calls.map(c=>JSON.parse(c.messages[1].content).texts),[['新的活動介紹'],['新的活動介紹']]);
 }finally{f.close();}
});

test('explicit corrected translations survive automatic saving and state-only changes need no provider',async()=>{
 const f=clubFixture();try{
  await f.save('club',payload());const data=f.club('club-new');data.description='更新中文';data.translations.id.description='Perubahan yang diperiksa';data.translations.th.description='ข้อความที่ตรวจแล้ว';
  const calls=capture(f);assert.equal((await f.save('club',data,data.revision)).status,200);assert.equal(calls.length,0);
  delete f.env.OPENAI_API_KEY;const saved=f.club(data.id);assert.equal((await f.save('club',{...saved,status:'paused'},saved.revision)).status,200);assert.equal(calls.length,0);
 }finally{f.close();}
});

test('empty source clears its old translations without inventing content',async()=>{
 const f=clubFixture();try{
  await f.save('club',payload());const old=f.club('club-new'),calls=capture(f);assert.equal((await f.save('club',{...old,contact:''},old.revision)).status,200);
  for(const lang of ['id','th'])assert.equal(f.club(old.id).translations[lang].contact,'');assert.equal(calls.length,0);
 }finally{f.close();}
});

test('partial provider failure writes nothing; the same request can retry and replay without translating again',async()=>{
 const f=clubFixture();try{
  const data=payload(),requestId=crypto.randomUUID();f.deps.callAi=async (_env,m)=>m[0].content.includes('Thai')?{}:{texts:JSON.parse(m[1].content).texts.map(t=>'translated: '+t)};
  let r=await f.save('club',data,0,{request_id:requestId});assert.equal(r.status,503);assert.match((await r.json()).message,/資料尚未儲存/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_actions').get().n,0);assert.equal(f.sqlite.prepare('SELECT id FROM welfare_clubs WHERE id=?').get(data.id),undefined);
  const calls=capture(f);assert.equal((await f.save('club',data,0,{request_id:requestId})).status,200);assert.equal((await(await f.save('club',data,0,{request_id:requestId})).json()).replayed,true);assert.equal(calls.length,2);
 }finally{f.close();}
});

test('missing key fails safely and unauthenticated public reads never call AI',async()=>{
 const f=clubFixture();try{
  delete f.env.OPENAI_API_KEY;const calls=capture(f);assert.equal((await f.save('club',payload())).status,503);assert.equal(calls.length,0);
  assert.equal((await f.call('/api/clubs?lang=th')).status,200);assert.equal(calls.length,0);
 }finally{f.close();}
});

test('authorization, confirmation, invalid input and stale revision reject before provider calls',async()=>{
 const f=clubFixture();try{
  const calls=capture(f),data=payload(),body={kind:'club',data,revision:0,confirmed:true,request_id:crypto.randomUUID()};
  assert.equal((await f.call('/admin-api/clubs',body)).status,403);
  assert.equal((await f.save('club',data,0,{confirmed:false})).status,400);
  assert.equal((await f.save('club',{...data,title:''})).status,400);
  assert.equal((await f.save('club',{...f.club('club-yoga'),description:'舊版本修改'},0)).status,409);assert.equal(calls.length,0);
 }finally{f.close();}
});

test('malformed, empty, overlength and changed-number translations reject without changing source',async()=>{
 for(const result of [{},{texts:[]},{texts:['']},{texts:['x'.repeat(151)]},{texts:['lost number']}]){
  const source={title:'社團 #258',description:'',contact:'',join_rules:'',translations:{id:{},th:{}}};
  await assert.rejects(translateClubContent('club',source,null,{OPENAI_API_KEY:'synthetic'},async()=>result));assert.equal(source.title,'社團 #258');assert.equal(source.translations.id.title,undefined);
 }
});

test('translation deadline aborts a hanging provider',async()=>{
 let signal;const content={title:'社團',description:'',contact:'',join_rules:'',translations:{id:{},th:{}}};
 await assert.rejects(translateClubContent('club',content,null,{OPENAI_API_KEY:'synthetic'},async (_env,_m,opts)=>{signal=opts.signal;return new Promise(()=>{});},{timeoutMs:15}),/timeout/);
 assert.equal(signal.aborted,true);
});

test('contact names before an extension are masked and restored while department names still translate',async()=>{
 const contact='集團總部 (大雅一廠) 研發中心 宋欣樺 #258';
 const content={title:'社團',description:'請洽宋欣樺',contact,join_rules:'',translations:{id:{title:'Club'},th:{title:'ชมรม'}}};
 const inputs=[];await translateClubContent('club',content,null,{OPENAI_API_KEY:'synthetic'},async(_env,m)=>{const {texts}=JSON.parse(m[1].content);inputs.push(texts);assert.ok(texts.every(t=>!t.includes('宋欣樺')));return {texts:texts.map(t=>t.replace('集團總部','Head office').replace('研發中心','R&D'))};});
 for(const lang of ['id','th']){assert.equal(content.translations[lang].description,'請洽宋欣樺');assert.match(content.translations[lang].contact,/Head office.*R&D.*宋欣樺 #258/);assert.doesNotMatch(content.translations[lang].contact,/__CLUB_PERSON_/);}
 assert.equal(inputs.length,2);
 const rejected={title:'社團',description:'',contact:'宋欣樺 #258',join_rules:'',translations:{id:{title:'Club'},th:{title:'ชมรม'}}};
 await assert.rejects(translateClubContent('club',rejected,null,{OPENAI_API_KEY:'synthetic'},async()=>({texts:['Romanized name #258']})));
});

test('a concurrent editor cannot overwrite a newer source after its translation finishes',async()=>{
 const f=clubFixture();try{
  const old=f.club('club-yoga');let release;const pending=new Promise(resolve=>{release=resolve;});
  f.deps.callAi=async (_env,m)=>{const texts=JSON.parse(m[1].content).texts;await pending;return {texts:texts.map(t=>'translated: '+t)};};
  const slow=f.save('club',{...old,description:'較慢修改'},old.revision);
  await new Promise(resolve=>setTimeout(resolve,5));capture(f);assert.equal((await f.save('club',{...old,description:'較新修改'},old.revision)).status,200);release();assert.equal((await slow).status,409);
  assert.equal(f.club(old.id).description,'較新修改');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_club_actions').get().n,1);
 }finally{f.close();}
});

test('gallery title and description translate while audience and photos remain unchanged',async()=>{
 const f=clubFixture();try{
  const calls=capture(f),data={id:'gallery-new',club_id:'club-yoga',title:'活動花絮',description:'活動照片',media_ids:[],video_url:'',event_id:'',status:'published',visibility:'employee'};
  assert.equal((await f.save('gallery',data)).status,200);assert.equal((await(await f.call('/api/clubs?lang=id')).json()).galleries.length,0);
  const visible=(await(await f.call('/api/clubs?lang=th',null,'test-member')).json()).galleries[0];assert.equal(visible.description,'translated: 活動照片');assert.equal(visible.visibility,'employee');assert.deepEqual(visible.media_ids,[]);
  assert.deepEqual(calls.map(c=>JSON.parse(c.messages[1].content).texts),[['活動花絮','活動照片'],['活動花絮','活動照片']]);
 }finally{f.close();}
});

test('activity associations keep the existing activity translation flow',async()=>{
 const f=clubFixture();try{const calls=capture(f);assert.equal((await f.save('activity',{id:'event-1',club_id:'club-yoga',kind:'club',mode:'announcement'})).status,200);assert.equal(calls.length,0);}finally{f.close();}
});
