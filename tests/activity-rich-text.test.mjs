import test from 'node:test';
import assert from 'node:assert/strict';
import {articleFixture} from './activity-article-fixture.mjs';

const stored=(f,id)=>JSON.parse(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').get(id).content_json);
const adminDetail=(f,id)=>f.fetch('/admin-api/activity-stories?id='+id,{headers:{Authorization:'Bearer synthetic-admin'}});
const publicDetail=async(f,id,locale='zh',token='')=>(await(await f.fetch('/api/activity-stories/'+id+'?lang='+locale,{headers:token?{Authorization:'Bearer '+token}:{}})).json());
const rich=()=>({type:'text',text:'  開頭 粗體及連結  ',runs:[{text:'  開頭 '},{text:'粗體',bold:true},{text:'及',italic:true,underline:true,strike:true},{text:'連結  ',link:'https://example.test/path?a=42'}],align:'justify'});

test('rich article draft roundtrips exact inline whitespace, marks, lists and image layout without AI',async()=>{
 const f=articleFixture();try{
  delete f.env.OPENAI_API_KEY;const mid=f.seedPhoto();
  const blocks=[rich(),{type:'heading',level:2,text:'小標題',runs:[{text:'小',italic:true},{text:'標題',bold:true}],align:'center'},{type:'quote',text:'引用文字',runs:[{text:'引用',underline:true},{text:'文字'}],align:'right'},{type:'list',style:'ordered',items:['第一 項',''],item_runs:[[{text:'第一 ',bold:true},{text:'項',link:'mailto:hello@example.test'}],[]],align:'left'},{type:'image',media_id:mid,caption:'圖片說明',width:50,align:'center'}];
  const article=f.story('rich-draft');article.blocks=blocks;assert.equal((await f.post(article)).status,200);assert.deepEqual(stored(f,article.id).blocks,blocks);assert.equal(f.aiCalls.length,0);
  const result=await(await adminDetail(f,article.id)).json();assert.deepEqual(result.story.blocks,blocks);assert.equal((await f.fetch('/api/activity-stories/'+article.id)).status,404);
 }finally{f.close();}
});

test('rich publication translates run text and list runs while retaining source marks, links and image properties',async()=>{
 const f=articleFixture();try{
  const article=f.story('rich-published');article.status='published';const mid=f.seedPhoto();article.blocks=[rich(),{type:'heading',level:3,text:'標題',runs:[{text:'標題',bold:true}]},{type:'quote',text:'引用',runs:[{text:'引用',italic:true}]},{type:'list',style:'bullet',items:['第一 項',''],item_runs:[[{text:'第一 ',bold:true},{text:'項',underline:true}],[]]},{type:'image',media_id:mid,caption:'圖片',width:25,align:'right'}];
  assert.equal((await f.post(article)).status,200);const content=stored(f,article.id);
  for(const locale of ['id','th']){
   assert.ok(content.translations[locale].blocks[0].runs.every(v=>typeof v==='string'));assert.equal(content.translations[locale].blocks[0].runs[1],'譯 粗體');
   const {story}=await publicDetail(f,article.id,locale);assert.equal(story.blocks[0].text,story.blocks[0].runs.map(r=>r.text).join(''));assert.equal(story.blocks[0].runs[1].bold,true);assert.equal(story.blocks[0].runs[2].strike,true);assert.equal(story.blocks[0].runs[3].link,'https://example.test/path?a=42');assert.ok(story.blocks[0].runs[0].text.startsWith('  譯 '));assert.ok(story.blocks[0].runs[3].text.endsWith('  '));
   assert.equal(story.blocks[1].level,3);assert.equal(story.blocks[1].runs[0].bold,true);assert.equal(story.blocks[2].runs[0].italic,true);assert.deepEqual(story.blocks[3].items,story.blocks[3].item_runs.map(runs=>runs.map(r=>r.text).join('')));assert.equal(story.blocks[3].item_runs[0][0].bold,true);assert.equal(story.blocks[3].item_runs[1].length,0);assert.equal(story.blocks[4].width,25);assert.equal(story.blocks[4].align,'right');assert.equal(story.blocks[4].caption,'譯 圖片');
  }
 }finally{f.close();}
});

test('format-only edits reuse translations but public detail applies current marks and image layout',async()=>{
 const f=articleFixture();try{
  const article=f.story('format-only');article.status='published';const mid=f.seedPhoto();article.blocks=[{type:'text',text:'相同文字',runs:[{text:'相同文字',bold:true}],align:'left'},{type:'image',media_id:mid,caption:'圖',width:100,align:'left'}];assert.equal((await f.post(article)).status,200);const calls=f.aiCalls.length,translations=stored(f,article.id).translations;
  article.blocks[0].runs=[{text:'相同文字',italic:true,link:'tel:+886423456789'}];article.blocks[0].align='right';article.blocks[1].width='auto';article.blocks[1].align='center';assert.equal((await f.post(article,1)).status,200);assert.equal(f.aiCalls.length,calls);assert.deepEqual(stored(f,article.id).translations,translations);
  const {story}=await publicDetail(f,article.id,'id');assert.equal(story.blocks[0].runs[0].bold,undefined);assert.equal(story.blocks[0].runs[0].italic,true);assert.equal(story.blocks[0].runs[0].link,'tel:+886423456789');assert.equal(story.blocks[0].align,'right');assert.equal(story.blocks[1].width,'auto');assert.equal(story.blocks[1].align,'center');
 }finally{f.close();}
});

test('formatted whitespace-only runs remain literal and do not block article publication',async()=>{
 const f=articleFixture();try{const article=f.story('rich-whitespace');article.status='published';article.blocks=[{type:'text',text:'  前後\n ',runs:[{text:'  ',bold:true},{text:'前後'},{text:'\n ',italic:true}]}];assert.equal((await f.post(article)).status,200);for(const locale of ['id','th']){const {story}=await publicDetail(f,article.id,locale);assert.equal(story.blocks[0].runs[0].text,'  ');assert.equal(story.blocks[0].runs[2].text,'\n ');assert.equal(story.blocks[0].text,'  譯 前後\n ');}}finally{f.close();}
});

test('adding rich formatting to a legacy article does not reuse an incompatible plain translation',async()=>{
 const f=articleFixture();try{const article=f.story('legacy-rich');article.status='published';article.blocks=[{type:'text',text:'原有文字'}];assert.equal((await f.post(article)).status,200);const calls=f.aiCalls.length;article.blocks[0].runs=[{text:'原有文字',bold:true}];assert.equal((await f.post(article,1)).status,200);assert.ok(f.aiCalls.length>calls);const {story}=await publicDetail(f,article.id,'th');assert.equal(story.blocks[0].text,'譯 原有文字');assert.equal(story.blocks[0].runs[0].bold,true);}finally{f.close();}
});

test('unsafe links, unknown marks and mismatched canonical text fail without saving',async()=>{
 const cases=[
  {type:'text',text:'文',runs:[{text:'文',link:'javascript:alert(1)'}]},
  {type:'text',text:'文',runs:[{text:'文',link:'data:text/html,<script>x</script>'}]},
  {type:'text',text:'文',runs:[{text:'文',link:'file:///C:/private'}]},
  {type:'text',text:'文',runs:[{text:'文',link:'blob:https://example.test/x'}]},
  {type:'text',text:'文',runs:[{text:'文',link:'https://u:p@example.test/path'}]},
  {type:'text',text:'文',runs:[{text:'文',link:'https://exa\nmple.test'}]},
  {type:'text',text:'文',runs:[{text:'文',link:' https://example.test'}]},
  {type:'text',text:'文',runs:[{text:'文',bold:'true'}]},
  {type:'text',text:'文',runs:[{text:'文',style:'position:fixed'}]},
  {type:'text',text:'正文',runs:[{text:'不同文字',bold:true}]},
  {type:'heading',level:2,text:'標題',runs:[]},
  {type:'list',style:'bullet',items:['項目'],item_runs:[]},
  {type:'list',style:'bullet',items:['項目'],item_runs:[[{text:'其他項目'}]]},
  {type:'quote',text:'引用',align:'position:fixed'}
 ];
 for(const block of cases){const f=articleFixture();try{const article=f.story();article.blocks=[block];assert.equal((await f.post(article)).status,400,JSON.stringify(block));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n,0);assert.equal(f.aiCalls.length,0);}finally{f.close();}}
});

test('safe link protocols roundtrip and image size/alignment allow only documented values',async()=>{
 for(const link of ['https://example.test/path?a=42','http://example.test/path','mailto:help@example.test','tel:+886423456789']){const f=articleFixture();try{const article=f.story();article.blocks=[{type:'text',text:'連結',runs:[{text:'連結',link}]}];assert.equal((await f.post(article)).status,200);assert.equal(stored(f,article.id).blocks[0].runs[0].link,new URL(link).href);}finally{f.close();}}
 for(const [width,align] of [[0,'center'],[51,'center'],['50','left'],[50,'justify']]){const f=articleFixture();try{const mid=f.seedPhoto(),article=f.story();article.blocks=[{type:'image',media_id:mid,caption:'',width,align}];assert.equal((await f.post(article)).status,400);}finally{f.close();}}
});

test('rich run budgets reject excessive formatting without truncating valid text',async()=>{
 const make=n=>({type:'text',text:'文'.repeat(n),runs:Array.from({length:n},()=>({text:'文',bold:true}))});
 const f=articleFixture();try{const article=f.story('run-limit');article.blocks=[make(1001)];assert.equal((await f.post(article)).status,400);article.blocks=Array.from({length:6},()=>make(1000));assert.equal((await f.post(article)).status,400);article.blocks=Array.from({length:5},()=>make(1000));assert.equal((await f.post(article)).status,200);assert.equal(stored(f,article.id).blocks.reduce((n,b)=>n+b.runs.length,0),5000);}finally{f.close();}
});

test('rich writes retain authentication, media scope, version and replay checks',async()=>{
 const f=articleFixture();try{
  const article=f.story('rich-protected');article.blocks=[rich()];const body={story:article,revision:0,request_id:crypto.randomUUID(),confirmed:true};
  const denied=await f.fetch('/admin-api/activity-stories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(denied.status,403);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n,0);
  const wrong=f.seedPhoto('foreign','club-a');const bad={...article,blocks:[{type:'image',media_id:wrong,caption:'',width:50,align:'center'}]};assert.equal((await f.post(bad)).status,403);
  const requestId=crypto.randomUUID();assert.equal((await f.post(article,0,requestId)).status,200);assert.equal((await(await f.post(article,0,requestId)).json()).replayed,true);assert.equal((await f.post({...article,title:'new title'},0)).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,1);
  article.visibility='employee';article.status='published';assert.equal((await f.post(article,1)).status,200);assert.equal((await f.fetch('/api/activity-stories/'+article.id)).status,404);assert.equal((await publicDetail(f,article.id,'id','synthetic-employee')).success,true);
 }finally{f.close();}
});

test('plain highlights retain their previous normalized shape and limits',async()=>{
 const f=articleFixture();try{const article=f.story('highlight','highlight');article.blocks=[{type:'text',text:'  舊花絮  '}];assert.equal((await f.post(article)).status,200);assert.deepEqual(stored(f,article.id).blocks,[{type:'text',text:'舊花絮'}]);assert.ok(f.aiCalls.length>0);}finally{f.close();}
});

test('highlight conversion rejects rich fields without losing the stored article or adding actions',async()=>{
 const f=articleFixture();try{
  const article=f.story('keep-rich-article'),mid=f.seedPhoto();article.blocks=[rich()];assert.equal((await f.post(article)).status,200);const before=stored(f,article.id),actions=f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n;
  for(const block of [rich(),{type:'text',text:'文',runs:[]},{type:'text',text:'文',item_runs:[]},{type:'text',text:'文',align:'center'},{type:'image',media_id:mid,caption:'',width:50},{type:'image',media_id:mid,caption:'',align:'right'}]){const result=await f.post({...article,type:'highlight',blocks:[block]},1);assert.equal(result.status,400);assert.match((await result.json()).message,/長文/);assert.deepEqual(stored(f,article.id),before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_story_actions').get().n,actions);}
  assert.equal(f.aiCalls.length,0);
 }finally{f.close();}
});
