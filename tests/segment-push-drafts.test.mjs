import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleSegmentDraft} from '../src/segment-push-drafts.js';

const uid=n=>'U'+n.toString(16).padStart(32,'0');
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../migrations/0040_segment_push_drafts.sql',import.meta.url),'utf8'));
 sqlite.exec(`CREATE TABLE welfare_push_previews(id TEXT);CREATE TABLE welfare_push_campaigns(id TEXT);CREATE TABLE welfare_push_deliveries(id TEXT);`);
 const db={prepare(sql){let values=[];return{bind(...v){values=v;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){let result=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(result.changes)}};}};}};
 let clock=1000;const call=(actor,body)=>handleSegmentDraft(db,body,{actor,now:()=>clock++});
 return {sqlite,call,close(){sqlite.close();}};
}
const save=(extra={})=>({action:'draft.save',title:'合成草稿',filters:{keyword:'測試',tags:['活動'],maxRecipients:500},content:{messageMode:'system_card',flexCardTitle:'測試標題',flexCardButton:'查看',flexCardUrl:'https://example.invalid/'},selectedLineUserIds:[uid(1),uid(2)],...extra});

test('draft create, list, retrieve, edit and delete are scoped to the actor and never preview or deliver',async()=>{
 const f=fixture();try{
  const created=(await f.call('admin:a',save())).data;assert.equal(created.revision,1);
  const list=(await f.call('admin:a',{action:'draft.list'})).data.drafts;assert.equal(list.length,1);assert.equal('content' in list[0],false);assert.equal('selectedLineUserIds' in list[0],false);
  assert.deepEqual((await f.call('admin:b',{action:'draft.list'})).data.drafts,[]);
  const loaded=(await f.call('admin:a',{action:'draft.get',id:created.id})).data;assert.equal(loaded.requiresAudienceReview,true);assert.deepEqual(loaded.draft.selectedLineUserIds,[uid(1),uid(2)]);assert.equal(loaded.draft.content.flexCardTitle,'測試標題');
  for(const request of[{action:'draft.get',id:created.id},save({id:created.id,revision:1}),{action:'draft.delete',id:created.id,revision:1}])await assert.rejects(f.call('admin:b',request),e=>e.status===404);
  const changed=await f.call('admin:a',save({id:created.id,revision:1,title:'更新'}));assert.equal(changed.data.revision,2);
  await assert.rejects(f.call('admin:a',save({id:created.id,revision:1})),e=>e.status===409);
  await assert.rejects(f.call('admin:a',{action:'draft.delete',id:created.id,revision:1}),e=>e.status===409);
  await f.call('admin:a',{action:'draft.delete',id:created.id,revision:2});assert.equal((await f.call('admin:a',{action:'draft.list'})).data.drafts.length,0);
  for(const table of ['welfare_push_previews','welfare_push_campaigns','welfare_push_deliveries'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }finally{f.close();}
});

test('employee language selections round-trip through drafts without previewing or sending',async()=>{
 const f=fixture();try {
  for(const memberType of ['employee_language_id','employee_language_th']){
   const created=(await f.call('admin:a',save({filters:{memberType,maxRecipients:200},selectedLineUserIds:[uid(1)]}))).data;
   const loaded=(await f.call('admin:a',{action:'draft.get',id:created.id})).data.draft;
   assert.equal(loaded.filters.memberType,memberType);assert.deepEqual(loaded.selectedLineUserIds,[uid(1)]);
  }
  for(const table of ['welfare_push_previews','welfare_push_campaigns','welfare_push_deliveries'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }finally{f.close();}
});

test('legacy single and new multiple factory drafts round-trip without preview or dispatch',async()=>{
 const f=fixture();try{
  for(const filters of [{factory:'烏日二廠',maxRecipients:200},{factory:'',factories:['烏日二廠','神岡廠'],maxRecipients:200},{factories:[],maxRecipients:200}]){
   const created=(await f.call('admin:a',save({filters}))).data;
   const loaded=(await f.call('admin:a',{action:'draft.get',id:created.id})).data;
   assert.deepEqual(loaded.draft.filters,filters);assert.equal(loaded.requiresAudienceReview,true);
  }
  for(const filters of [{factories:'烏日二廠'},{factories:['']},{factories:['x'.repeat(301)]},{factories:Array(101).fill('烏日二廠')},{factory:'烏日二廠',factories:['神岡廠']}])await assert.rejects(f.call('admin:a',save({filters})),e=>e.status===400);
  for(const table of ['welfare_push_previews','welfare_push_campaigns','welfare_push_deliveries'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }finally{f.close();}
});

test('rejects malformed identity, arbitrary data, unsupported fields, blob images and excessive input',async()=>{
 const f=fixture();try{
  await assert.rejects(f.call('',save()),e=>e.status===403);
  const invalid=[save({selectedLineUserIds:['U-not-a-uid']}),save({selectedLineUserIds:Array(501).fill(uid(1))}),save({filters:{arbitrary:'x'}}),save({filters:{tags:['x'.repeat(201)]}}),save({content:{unknown:'evil'}}),save({content:{messageMode:'scheduled'}}),save({content:{deliveryMode:'other'}}),save({content:{scheduledAt:'2026-02-30T12:00'}}),save({content:{scheduledAt:'2026-01-01T24:01'}}),save({content:{scheduledAt:'2026-01-01T12:00:00'}}),save({content:{imageOriginalUrl:'blob:https://example.invalid/a'}}),save({content:{imageOriginalUrl:'data:image/png;base64,x'}}),save({content:{messageText:'x'.repeat(5001)}}),save({title:'x'.repeat(201)}),{...save(),confirmed:true},save({filters:JSON.parse('{"__proto__":{}}')})];
  for(const body of invalid)await assert.rejects(f.call('admin:a',body),e=>e.status===400);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_segment_push_drafts').get().n,0);
 }finally{f.close();}
});

test('bounded actor quota is independent and accepts partial drafts',async()=>{
 const f=fixture();try{
  for(let i=0;i<50;i++)await f.call('admin:a',save({title:'draft '+i,filters:{},content:{messageMode:'official_text',messageText:''},selectedLineUserIds:[]}));
  await assert.rejects(f.call('admin:a',save()),e=>e.status===409);
  await f.call('admin:b',save());assert.equal((await f.call('admin:b',{action:'draft.list'})).data.drafts.length,1);
 }finally{f.close();}
});

test('LINE and administrative session drafts remain separate after identity renewal',async()=>{
 const f=fixture();try{
  const admin='admin:1',line='line:'+uid(99),created=(await f.call(admin,save())).data;
  assert.deepEqual((await f.call(line,{action:'draft.list'})).data.drafts,[]);
  for(const body of [{action:'draft.get',id:created.id},save({id:created.id,revision:1}),{action:'draft.delete',id:created.id,revision:1}])await assert.rejects(f.call(line,body),e=>e.status===404);
  assert.equal((await f.call(admin,{action:'draft.get',id:created.id})).data.draft.id,created.id);
  for(const table of ['welfare_push_previews','welfare_push_campaigns','welfare_push_deliveries'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }finally{f.close();}
});
