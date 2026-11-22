import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksToDeltaOps,deltaOpsToBlocks,articleEditorAssets} from '../src/article-rich-editor.js';
import {articleFixture} from './activity-article-fixture.mjs';
import {syntheticArticlePng} from './activity-wysiwyg-fixture-image.mjs';

const roundTrip=blocks=>deltaOpsToBlocks(blocksToDeltaOps(blocks));
const longText='全文開始\n\n'+Array.from({length:180},(_,i)=>`第${i+1}段：`+'這是舊文章裡原有的完整文字。'.repeat(4)).join('\n\n')+'\n\nEND_OF_ORIGINAL_BODY';
function richDocument(photo='photo-rich'){
 return [
  {type:'heading',level:2,text:'主標題',runs:[{text:'主',bold:true},{text:'標題'}],align:'center'},
  {type:'text',text:'粗體斜體底線刪除連結純文',runs:[{text:'粗體',bold:true},{text:'斜體',italic:true},{text:'底線',underline:true},{text:'刪除',strike:true},{text:'連結',link:'https://example.test/read?q=1'},{text:'純文'}],align:'justify'},
  {type:'heading',level:3,text:'副標題'},
  {type:'quote',text:'引用內容',runs:[{text:'引用',bold:true,italic:true,underline:true,strike:true},{text:'內容',link:'mailto:editor@example.test'}],align:'right'},
  {type:'list',style:'ordered',items:['第一項','第二項'],item_runs:[[{text:'第一',bold:true},{text:'項'}],[{text:'第二項',link:'tel:+886423592525'}]],align:'center'},
  {type:'list',style:'bullet',items:['無格式清單','保留文字']},
  {type:'image',media_id:photo,caption:'圖片說明',width:50,align:'center'},
  {type:'text',text:'圖片後的正文\n\n最後一段'},
  {type:'video',url:'https://www.youtube.com/watch?v=uUJU66syCgk'},
 ];
}

test('old long plain article keeps every character and blank line without exploding the 200-block limit',()=>{
 assert.ok(longText.length>11000);
 const source=[{type:'text',text:longText}],before=structuredClone(source);
 for(const input of [source,[{type:'text',text:longText+'\n\n'}]]){
  const output=roundTrip(input);
  assert.equal(output.length,1,'ordinary lines belong to a continuous document');
  assert.ok(output.length<=200);
  assert.equal(output[0].text,input[0].text);
  assert.equal(Object.hasOwn(output[0],'runs'),false,'old plain text must not acquire formatting');
 }
 assert.deepEqual(source,before,'loading/conversion never mutates the source record');
});

test('rich document roundtrip preserves marks, lists, headings, quote and private image properties',()=>{
 const source=richDocument(),before=structuredClone(source),ops=blocksToDeltaOps(source);
 assert.deepEqual(deltaOpsToBlocks({ops}),source);
 assert.deepEqual(source,before);
 assert.equal(ops.some(op=>op.insert?.storyImage?.media_id==='photo-rich'),true);
 assert.equal(ops.some(op=>op.insert?.image),false,'private images never become external URL embeds');
 assert.deepEqual(roundTrip(roundTrip(source)),source,'reopen and save remains stable');
 const legacyVideo={type:'video',url:'https://example.test/video'};
 assert.deepEqual(roundTrip([legacyVideo]),[legacyVideo],'legacy non-YouTube media remains roundtrippable');
 for(const width of [25,50,75,100])for(const align of ['center','right']){
  const block={type:'image',media_id:'private-image',caption:'圖說',width,align};
  assert.deepEqual(roundTrip([block]),[block]);
 }
 assert.deepEqual(roundTrip([{type:'image',media_id:'private-image',caption:'',width:'auto',align:'left'}]),[{type:'image',media_id:'private-image',caption:''}]);
});

test('paragraph merge retains inline runs and list coalescing keeps corresponding item runs',()=>{
 const blocks=deltaOpsToBlocks([
  {insert:'甲',attributes:{bold:true}},{insert:'\n'},
  {insert:'乙'},{insert:'\n'},
  {insert:'丙',attributes:{underline:true}},{insert:'\n'},
  {insert:'一'},{insert:'\n',attributes:{list:'bullet'}},
  {insert:'二',attributes:{italic:true}},{insert:'\n',attributes:{list:'bullet'}},
 ]);
 assert.deepEqual(blocks,[
  {type:'text',text:'甲\n乙\n丙',runs:[{text:'甲',bold:true},{text:'\n乙\n'},{text:'丙',underline:true}]},
  {type:'list',style:'bullet',items:['一','二'],item_runs:[[{text:'一'}],[{text:'二',italic:true}]]},
 ]);
 assert.deepEqual(roundTrip(blocks),blocks);
});

test('unsupported embeds, invalid marks and unsafe links cannot become persisted HTML or external media',()=>{
 for(const insert of [{image:'https://outside.test/a.png'},{image:'data:image/png;base64,AAAA'},{video:'https://outside.test/iframe'},{formula:'x'},{unknown:'<script>alert(1)</script>'},{storyImage:{caption:'missing private ID'}}])
  assert.throws(()=>deltaOpsToBlocks([{insert},{insert:'\n'}]));
 for(const href of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://user:password@example.test/','https://exa\nmple.test/']){
  assert.throws(()=>deltaOpsToBlocks([{insert:'點擊',attributes:{link:href}},{insert:'\n'}]),/連結/);
  assert.throws(()=>blocksToDeltaOps([{type:'text',text:'點擊',runs:[{text:'點擊',link:href}]}]),/連結/);
 }
 assert.throws(()=>deltaOpsToBlocks([{retain:1}]),/操作/);
 assert.throws(()=>blocksToDeltaOps([{type:'unsupported',text:'must not silently discard'}]),/不支援/);
 assert.throws(()=>blocksToDeltaOps([{type:'text',text:'甲乙',runs:[{text:'甲',bold:true}]}]),/不一致/);
 const raw='<img src=x onerror="globalThis.__xss=true"><script>alert(1)</script>';
 assert.deepEqual(deltaOpsToBlocks([{insert:raw,attributes:{color:'red',onclick:'alert(1)',font:'x'}},{insert:'\n'}]),[{type:'text',text:raw}]);
});

test('converter output persists through the real service and reopens unchanged without translating drafts',async()=>{
 const f=articleFixture();try{
  const photo=f.seedPhoto('photo-rich'),source=roundTrip(richDocument(photo)),story={...f.story('converter-draft'),blocks:source};
  const response=await f.post(story);assert.equal(response.status,200,await response.clone().text());
  const detail=await f.fetch('/admin-api/activity-stories?id=converter-draft',{headers:{Authorization:'Bearer synthetic-admin'}});
  assert.equal(detail.status,200);const result=await detail.json();
  assert.deepEqual(result.story.blocks,source);
  assert.deepEqual(roundTrip(result.story.blocks),source);
  assert.equal(f.aiCalls.length,0);
 }finally{f.close()}
});

test('self-hosted editor assets and generated local image are fully local fixtures',()=>{
 const assets=articleEditorAssets();
 assert.match(assets,/<script data-article-vendor/);assert.match(assets,/<script data-article-editor/);
 assert.doesNotMatch(assets,/<script\b[^>]*\bsrc=/i);
 assert.doesNotMatch(assets,/@import\s+url/i);
 const png=syntheticArticlePng();
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(png.readUInt32BE(16),640);assert.equal(png.readUInt32BE(20),320);
});
