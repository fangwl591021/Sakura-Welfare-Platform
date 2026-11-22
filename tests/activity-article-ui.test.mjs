import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {activityStoriesAdminHtml} from '../src/activity-stories-admin-ui.js';
import {storyPanel,storyScript} from '../src/activity-stories-ui.js';
import {articleFixture} from './activity-article-fixture.mjs';
import {inlineHarness} from './activity-article-mock-dom.mjs';
import {wysiwygHarness} from './activity-wysiwyg-harness.mjs';

const longText='完整文章開始\n'+'段落持續延伸，超過摘要與舊的五千字限制。\n'.repeat(600)+'完整文章結尾 END_OF_FULL_BODY';
const unsafe='<img src=x onerror="globalThis.__xss=true"><script>globalThis.__xss=true</script>';
const select=(h,name)=>h.q(`[name="${name}"]`);
const blocks=h=>h.all('#blocks .block');
const blockOf=(h,type,index=0)=>blocks(h).filter(node=>node.dataset.blockType===type)[index];
const blockText=(h,type,index=0)=>select(h,'type').value==='article'?h.richEditor()?.blockProxy(type,index):blockOf(h,type,index)?.querySelector('textarea');
const bodyOf=f=>JSON.parse(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories ORDER BY id LIMIT 1').get().content_json);

async function admin(f) {
  const h=await wysiwygHarness(activityStoriesAdminHtml(),{fetch:f.fetch});
  await h.settle(()=>h.q('#save')&&!h.q('#save').disabled);
  return h;
}
async function publicReader(f,language='zh') {
  const document=`<!doctype html><html><body><section id="fa-section"><div class="fa-heading"></div><p id="fa-status"></p><div id="fa-list"></div>${storyPanel(language)}</section>${storyScript(language)}</body></html>`;
  const h=await inlineHarness(document,{fetch:f.fetch,url:'https://fixture.test/featured-partner-stores?view=activities&stories=1',session:false});
  await h.settle(()=>h.q('#story-catalog')?.children.length>0);
  return h;
}
function seedPublished(f,{id='article-ui',type='article',body=longText}={}) {
  const photo=f.seedPhoto('photo-'+id);
  const story={...f.story(id,type),status:'published',summary:'只用於文章列表的短摘要',blocks:[
    {type:'heading',level:2,text:'文章小標題 '+unsafe},
    {type:'text',text:body},
    {type:'quote',text:'引用文字 '+unsafe},
    {type:'list',style:'ordered',items:['第一項 '+unsafe,'第二項不截斷']},
    {type:'image',media_id:photo,caption:'圖片說明 '+unsafe},
    {type:'video',url:'https://example.test/video'},
    {type:'video',url:'javascript:alert(1)'}
  ]};
  f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id) VALUES(?,?,?,1,?)').run(id,story.unit_id,JSON.stringify(story),'seed-'+id);
  return story;
}

test('article editor and public inline scripts compile without executing a provider',()=>{
  for(const html of [activityStoriesAdminHtml(),...['zh','id','th'].map(storyScript)])
    for(const [,script] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
});

test('public detail renders the complete article and safe structural blocks in every locale',async t=>{
  for(const language of ['zh','id','th'])await t.test(language,async()=>{
    const f=articleFixture();try{
      const expected=seedPublished(f),h=await publicReader(f,language);
      const card=h.q('#story-catalog').children[0];
      assert.equal(card.textContent.includes('END_OF_FULL_BODY'),false,'list must remain a summary projection');
      await card.click();await h.settle(()=>h.q('#story-article-content').textContent.includes('END_OF_FULL_BODY'));
      const content=h.q('#story-article-content');
      assert.ok(content.querySelectorAll('p').some(node=>node.textContent===longText));
      assert.ok(content.querySelectorAll('h3').some(node=>node.textContent===expected.blocks[0].text));
      assert.equal(content.querySelector('blockquote').textContent,expected.blocks[2].text);
      assert.deepEqual(content.querySelector('ol').querySelectorAll('li').map(node=>node.textContent),expected.blocks[3].items);
      assert.equal(content.querySelector('figcaption').textContent,expected.blocks[4].caption);
      assert.equal(content.querySelectorAll('a').filter(node=>node.href==='https://example.test/video').length,1);
      assert.equal(content.querySelectorAll('a').some(node=>String(node.href).startsWith('javascript:')),false);
      assert.equal(h.document.created.some(node=>node.tagName==='SCRIPT'||node.hasAttribute('onerror')),false);
      assert.equal(h.context.__xss,undefined);
      assert.ok(f.requests.some(request=>request.path==='/api/activity-stories/article-ui'));
      assert.equal(f.aiCalls.length,0,'reading article content must not invoke translation');
    }finally{f.close()}
  });
});

test('public rich text keeps marks, translated run boundaries and image layout in all three languages',async()=>{
  const f=articleFixture();try{
    const image=f.seedPhoto('rich-render-photo'),story={...f.story('rich-render'),status:'published',blocks:[
      {type:'heading',level:2,text:'格式標題',runs:[{text:'格式',bold:true},{text:'標題'}],align:'center'},
      {type:'text',text:'粗體斜體底線刪除連結',runs:[{text:'粗體',bold:true},{text:'斜體',italic:true},{text:'底線',underline:true},{text:'刪除',strike:true},{text:'連結',link:'https://example.test/read'}],align:'justify'},
      {type:'quote',text:'引用內容',runs:[{text:'引用',italic:true},{text:'內容'}],align:'right'},
      {type:'list',style:'ordered',items:['清單一','清單二'],item_runs:[[{text:'清單一',bold:true}],[{text:'清單',underline:true},{text:'二'}]]},
      {type:'image',media_id:image,caption:'圖片說明',width:50,align:'center'},
    ]};
    const response=await f.post(story);assert.equal(response.status,200,await response.clone().text());
    const aiCalls=f.aiCalls.length;
    for(const language of ['zh','id','th']){
      const expected=(await (await f.fetch('/api/activity-stories/rich-render?lang='+language)).json()).story;
      const h=await publicReader(f,language);await h.q('#story-catalog').children[0].click();
      await h.settle(()=>h.q('#story-article-content').querySelector('p.story-block'));
      const content=h.q('#story-article-content'),p=content.querySelector('p.story-block');
      assert.equal(p.textContent,expected.blocks[1].text,'inline runs must concatenate without inserted spaces');
      for(const [tag,index] of [['strong',0],['em',1],['u',2],['s',3],['a',4]])assert.equal(p.querySelector(tag).textContent,expected.blocks[1].runs[index].text);
      assert.equal(p.querySelector('a').href,'https://example.test/read');assert.equal(p.querySelector('a').rel,'noopener noreferrer');
      assert.equal(p.style.textAlign,'justify');assert.equal(content.querySelector('h3').style.textAlign,'center');
      const quote=content.querySelector('blockquote');assert.equal(quote.textContent,expected.blocks[2].text);assert.equal(quote.style.textAlign,'right');assert.ok(quote.querySelector('em'));
      assert.deepEqual(content.querySelectorAll('li').map(node=>node.textContent),expected.blocks[3].items);assert.ok(content.querySelector('li strong'));assert.ok(content.querySelector('li u'));
      const figure=content.querySelector('figure.story-article-image');assert.equal(figure.style.textAlign,'center');assert.equal(figure.querySelector('img').style.width,'50%');
      assert.equal(content.querySelector('figcaption').textContent,expected.blocks[4].caption);
      assert.equal(h.context.__xss,undefined);
    }
    assert.equal(f.aiCalls.length,aiCalls,'reading either translation never starts provider work');
  }finally{f.close()}
});

test('single rich editor keeps full document, separate summary, formatted order, preview and reopened draft',async()=>{
  const f=articleFixture();try{
    const h=await admin(f);await h.q('#new-article').click();
    await select(h,'unit_id').change('welfare_committee');
    await select(h,'title').input('可持續編輯的長文章');
    await select(h,'summary').input('短摘要保留在自己的欄位');
    assert.equal(h.richEditor().getBlocks().length,1);
    assert.equal(h.richEditor().content.getAttribute('role'),'textbox');
    assert.equal(blocks(h).length,0,'article mode must not render the old separated block forms');
    assert.equal(h.q('#album-section').hidden,true);
    assert.equal(h.q('#event-field').hidden,true);
    const form=h.q('#form');assert.ok(form.children.indexOf(h.q('#body-section'))<form.children.indexOf(h.q('#article-summary-panel')));assert.ok(form.children.indexOf(h.q('#article-summary-panel'))<form.children.indexOf(h.q('#cover-section')));
    assert.equal(h.q('#summary-field').parentElement,h.q('#article-summary-panel'));
    const originalBody=blockText(h,'text');
    await originalBody.input(longText);
    assert.equal(originalBody.value,longText);
    h.richEditor().appendBlock({type:'heading',level:2,text:'文章小標 '+unsafe});
    h.richEditor().appendBlock({type:'quote',text:'引用 '+unsafe});
    h.richEditor().appendBlock({type:'list',style:'ordered',items:['項目甲','項目乙 '+unsafe]});
    h.richEditor().appendBlock({type:'text',text:'最後一段完整保留'});
    h.richEditor().moveBlock(4,3);
    const expectedTypes=['text','heading','quote','text','list'];assert.deepEqual(h.richEditor().getBlocks().map(block=>block.type),expectedTypes);
    await h.q('#preview-article').click();
    const preview=h.q('#article-preview-content');assert.equal(h.q('#article-preview').hidden,false);
    assert.ok(preview.querySelectorAll('p').some(node=>node.textContent===longText));
    assert.match(preview.textContent,/最後一段完整保留/);assert.equal(preview.querySelector('blockquote').textContent,'引用 '+unsafe);
    assert.equal(preview.querySelector('ol').children.length,2);assert.equal(h.context.__xss,undefined);
    await h.q('#save-draft').click();await h.settle(()=>f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n===1);
    const stored=bodyOf(f);assert.equal(stored.type,'article');assert.equal(stored.status,'draft');assert.equal(stored.summary,'短摘要保留在自己的欄位');
    assert.equal(stored.blocks[0].text,longText);assert.deepEqual(stored.blocks.map(block=>block.type),expectedTypes);
    assert.equal(f.aiCalls.length,0,'long drafts must save independently of translation');
    await h.q('#records').querySelectorAll('button').find(node=>node.className==='record-title'&&node.textContent.startsWith('可持續編輯的長文章')).click();
    assert.equal(blockText(h,'text').value,longText);assert.equal(select(h,'summary').value,stored.summary);
    assert.equal(blockText(h,'list').value,stored.blocks[4].items.join('\n'));
    assert.equal(h.q('#article-preview').hidden,true,'reopen must discard stale local preview');
    assert.equal(h.document.created.some(node=>node.tagName==='SCRIPT'||node.hasAttribute('onerror')),false);
  }finally{f.close()}
});

test('article publishing failure preserves text, stored revision and retry identity; retry commits once',async()=>{
  const f=articleFixture();try{
    const h=await admin(f);await h.q('#new-article').click();await select(h,'unit_id').change('welfare_committee');
    await select(h,'title').input('可重試文章');await blockText(h,'text').input(longText);
    await h.q('#save-draft').click();await h.settle(()=>f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n===1);
    const original=f.sqlite.prepare('SELECT * FROM welfare_activity_stories').get();
    await select(h,'status').change('published');
    const calls=[],localFetch=f.fetch;
    const recordingFetch=async(path,options={})=>{if(options.method==='POST')calls.push(JSON.parse(options.body));return localFetch(path,options)};
    h.context.fetch=recordingFetch;
    const provider=f.deps.callAi;f.deps.callAi=async()=>{throw Error('synthetic unavailable')};
    await h.q('#save').click();await h.settle(()=>!h.q('#save').disabled);
    assert.match(h.q('#notice').textContent,/翻譯|尚未儲存/);
    assert.equal(blockText(h,'text').value,longText);
    assert.equal(f.sqlite.prepare('SELECT revision FROM welfare_activity_stories').get().revision,original.revision);
    assert.equal(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories').get().content_json,original.content_json);
    f.deps.callAi=provider;
    await h.q('#save').click();await h.settle(()=>f.sqlite.prepare('SELECT revision FROM welfare_activity_stories').get().revision===2);
    assert.equal(calls.length,2);assert.equal(calls[0].request_id,calls[1].request_id);assert.equal(calls[0].revision,calls[1].revision);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n,1);
    assert.equal(bodyOf(f).blocks[0].text,longText);
    const reader=await publicReader(f);await reader.q('#story-catalog').children[0].click();await reader.settle(()=>reader.q('#story-article-content').textContent.includes('END_OF_FULL_BODY'));
    assert.ok(reader.q('#story-article-content').querySelectorAll('p').some(node=>node.textContent===longText));
  }finally{f.close()}
});

test('article validation retains overlong input and prevents a destructive conversion to highlights',async()=>{
  const f=articleFixture();try{
    const h=await admin(f);await h.q('#new-article').click();await select(h,'unit_id').change('welfare_committee');await select(h,'title').input('驗證保留全文');
    const over='文'.repeat(50001);await blockText(h,'text').input(over);assert.equal(blockText(h,'text').value,over);
    await h.q('#save-draft').click();assert.equal(f.requests.filter(request=>request.method==='POST').length,0);assert.match(h.q('#notice').textContent,/50,000/);
    await select(h,'type').change('highlight');assert.equal(select(h,'type').value,'article');assert.equal(blockText(h,'text').value,over);
    await blockText(h,'text').input(longText);h.richEditor().appendBlock({type:'heading',level:2,text:'保留的小標題'});
    await select(h,'type').change('highlight');assert.equal(select(h,'type').value,'article');assert.equal(h.richEditor().getBlocks().length,2);
    await h.q('#type-filter').change('highlight');await h.settle();assert.equal(blockText(h,'text').value,longText);assert.equal(h.richEditor().getBlocks().length,2);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n,0);
    await h.q('#new').click();assert.equal(select(h,'type').value,'highlight');assert.equal(h.q('#summary-field').parentElement,h.q('#story-fields'));assert.equal(h.q('#album-section').hidden,false);
  }finally{f.close()}
});

test('changing a short rich article to highlights cannot silently discard inline formatting or image layout',async()=>{
  const f=articleFixture();try{
    const h=await admin(f),image=f.seedPhoto('conversion-rich-photo');
    for(const document of [
      [{type:'text',text:'短篇粗體連結',runs:[{text:'短篇',bold:true},{text:'粗體連結',link:'https://example.test/read'}]}],
      [{type:'image',media_id:image,caption:'短篇圖片',width:50}],
      [{type:'image',media_id:image,caption:'短篇圖片',align:'right'}],
    ]){
      await h.q('#new-article').click();h.richEditor().inputBlocks(document);
      await select(h,'type').change('highlight');
      assert.equal(select(h,'type').value,'article');assert.deepEqual(h.richEditor().getBlocks(),document);
      assert.match(h.q('#notice').textContent,/格式|長文|正文/);
    }
    assert.equal(f.requests.filter(request=>request.method==='POST').length,0);assert.equal(f.aiCalls.length,0);
  }finally{f.close()}
});

test('highlights retain their original editing and publication behavior',async()=>{
  const f=articleFixture();try{
    const h=await admin(f);assert.equal(select(h,'type').value,'highlight');assert.equal(h.q('#album-section').hidden,false);assert.ok(!h.q('#add-heading')||h.q('#add-heading').hidden);assert.equal(h.q('#save-draft').hidden,true);
    await select(h,'unit_id').change('welfare_committee');await select(h,'title').input('既有花絮');await select(h,'summary').input('花絮摘要');await select(h,'status').change('published');await h.q('#add-text').click();
    const input=blockText(h,'text');assert.equal(input.maxLength,5000);await input.input('原有花絮正文');await h.q('#save').click();await h.settle(()=>f.sqlite.prepare('SELECT count(*) n FROM welfare_activity_stories').get().n===1);
    const saved=bodyOf(f);assert.equal(saved.type,'highlight');assert.equal(saved.blocks[0].text,'原有花絮正文');assert.equal(saved.summary,'花絮摘要');assert.equal(f.aiCalls.length,2);
    const reader=await publicReader(f);await reader.q('#story-catalog').children[0].click();await reader.settle(()=>reader.q('#story-article-content').textContent.includes('原有花絮正文'));
    assert.equal(reader.q('#story-article-content').querySelector('blockquote'),null);
  }finally{f.close()}
});
