import test from 'node:test';
import assert from 'node:assert/strict';
import {activityStoriesAdminHtml} from '../src/activity-stories-admin-ui.js';
import {articleFixture} from './activity-article-fixture.mjs';
import {wysiwygHarness} from './activity-wysiwyg-harness.mjs';

const select=(h,name)=>h.q(`[name="${name}"]`);
const bodyInput=h=>h.richEditor()?.body;
const selectedTitle=h=>select(h,'title').value;
function seed(f,id,unit='welfare_committee',status='draft') {
  const story={...f.story(id),unit_id:unit,status,title:'文章 '+id,blocks:[{type:'text',text:'完整 '+id+' 正文\n'+'正文段落持續延伸。'.repeat(1200)+'\n末尾 '+id}],summary:'摘要 '+id};
  f.sqlite.prepare('INSERT INTO welfare_activity_stories(id,unit_id,content_json,revision,last_request_id) VALUES(?,?,?,1,?)').run(story.id,story.unit_id,JSON.stringify(story),'seed-'+id);
  return story;
}
async function setup(f,fetch=f.fetch) {
  const h=await wysiwygHarness(activityStoriesAdminHtml(),{fetch});
  await h.settle(()=>!h.q('#save').disabled);
  return h;
}
function record(h,title){return h.q('#records').querySelectorAll('button').find(node=>node.className==='record-title'&&node.textContent===title)}
function isDetail(path,id){const url=new URL(path,'https://fixture.test');return url.pathname==='/admin-api/activity-stories'&&url.searchParams.get('id')===id}
const errorResponse=message=>Response.json({success:false,message},{status:503});

test('summary metadata is never edited as empty body; open and post-save refresh read full detail',async()=>{
  const f=articleFixture();try{
    const expected=seed(f,'full-A'),h=await setup(f);
    const listRequest=f.requests.find(request=>request.path==='/admin-api/activity-stories');
    assert.equal(listRequest.query.projection,'summary');
    const metadata=await(await f.fetch('/admin-api/activity-stories?projection=summary',{headers:{Authorization:'Bearer synthetic-admin'}})).json();
    const row=metadata.stories.find(story=>story.id===expected.id);
    assert.equal(row.detail_required,true);assert.equal(row.blocks,undefined);
    await record(h,expected.title).click();await h.settle(()=>selectedTitle(h)===expected.title);
    assert.equal(bodyInput(h).value,expected.blocks[0].text);
    assert.ok(f.requests.some(request=>request.query.id===expected.id));
    const updated=expected.blocks[0].text+'\n新增正文尾端';await bodyInput(h).input(updated);
    await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(bodyInput(h).value,updated,'post-save list metadata must not replace the complete editor');
    const saved=JSON.parse(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').get(expected.id).content_json);
    assert.equal(saved.blocks[0].text,updated);assert.equal(saved.summary,expected.summary);
    const listRequests=f.requests.filter(request=>request.path==='/admin-api/activity-stories'&&request.method==='GET'&&!request.query.id);
    assert.ok(listRequests.every(request=>request.query.projection==='summary'));
    assert.ok(f.requests.filter(request=>request.query.id===expected.id).length>=2);
  }finally{f.close()}
});

test('failed detail selection preserves the old dirty editor and the exact save request identity',async()=>{
  const f=articleFixture();try{
    const a=seed(f,'dirty-A'),b=seed(f,'failed-B'),h=await setup(f);
    await record(h,a.title).click();await h.settle(()=>selectedTitle(h)===a.title);
    const dirtyText=a.blocks[0].text+'\n尚未儲存的正文';await bodyInput(h).input(dirtyText);
    const posts=[],before=f.sqlite.prepare('SELECT content_json,revision FROM welfare_activity_stories WHERE id=?').get(a.id);
    h.context.fetch=async(path,options={})=>{
      if(options.method==='POST'){posts.push(JSON.parse(options.body));return errorResponse('隔離測試拒絕保存，內容保留')}
      if(isDetail(path,b.id))return errorResponse('隔離全文暫時無法載入');
      return f.fetch(path,options);
    };
    await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    await record(h,b.title).click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(selectedTitle(h),a.title);assert.equal(bodyInput(h).value,dirtyText);
    let dirty=false;for(const listener of h.events.get('beforeunload')||[])listener({preventDefault(){dirty=true}});
    assert.equal(dirty,true,'failed detail must retain the unsaved-change guard');
    await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(posts.length,2);assert.equal(posts[0].story.id,a.id);assert.equal(posts[1].story.id,a.id);
    assert.equal(posts[0].request_id,posts[1].request_id);assert.equal(posts[0].revision,posts[1].revision);
    assert.deepEqual(posts[0].story,posts[1].story);
    assert.deepEqual(f.sqlite.prepare('SELECT content_json,revision FROM welfare_activity_stories WHERE id=?').get(a.id),before);
  }finally{f.close()}
});

test('canceling a dirty record or unit switch does not fetch detail or discard any body',async()=>{
  const f=articleFixture();try{
    const a=seed(f,'cancel-A'),b=seed(f,'cancel-B','club-a'),h=await setup(f);
    await record(h,a.title).click();await h.settle(()=>selectedTitle(h)===a.title);
    const dirty=a.blocks[0].text+'\n保留修改';await bodyInput(h).input(dirty);
    const before=f.requests.length;h.context.confirm=()=>false;
    await record(h,b.title).click();await h.q('#unit-filter').change('club-a');await h.settle();
    assert.equal(selectedTitle(h),a.title);assert.equal(bodyInput(h).value,dirty);
    assert.equal(h.q('#unit-filter').value,'');
    assert.equal(f.requests.slice(before).some(request=>request.query.id===b.id),false);
    assert.equal(f.requests.slice(before).some(request=>request.query.unit_id==='club-a'),false);
  }finally{f.close()}
});

test('a slower old detail response cannot overwrite a more recently selected article',async()=>{
  const f=articleFixture();try{
    const a=seed(f,'slow-A'),b=seed(f,'fast-B'),h=await setup(f),pending=new Map();
    h.context.fetch=(path,options={})=>{
      const id=new URL(path,'https://fixture.test').searchParams.get('id');
      if(id===a.id||id===b.id)return new Promise(resolve=>pending.set(id,async()=>resolve(await f.fetch(path,options))));
      return f.fetch(path,options);
    };
    const slow=record(h,a.title).click();await h.settle(()=>pending.has(a.id));
    const fast=record(h,b.title).click();await h.settle(()=>pending.has(b.id));
    await pending.get(b.id)();await fast;await h.settle(()=>selectedTitle(h)===b.title);
    assert.equal(bodyInput(h).value,b.blocks[0].text);
    await pending.get(a.id)();await slow;await h.settle();
    assert.equal(selectedTitle(h),b.title);assert.equal(bodyInput(h).value,b.blocks[0].text);
    assert.equal(f.requests.filter(request=>request.method==='POST').length,0);
  }finally{f.close()}
});

test('changing unit invalidates an in-flight detail from the previous unit',async()=>{
  const f=articleFixture();try{
    const a=seed(f,'old-unit-A'),b=seed(f,'new-unit-B','club-a'),h=await setup(f);let release;
    h.context.fetch=(path,options={})=>isDetail(path,a.id)?new Promise(resolve=>{release=async()=>resolve(await f.fetch(path,options))}):f.fetch(path,options);
    const slow=record(h,a.title).click();await h.settle(()=>!!release);
    await h.q('#unit-filter').change('club-a');await h.settle(()=>!!record(h,b.title));
    await release();await slow;await h.settle();
    assert.equal(h.q('#unit-filter').value,'club-a');assert.notEqual(selectedTitle(h),a.title);
    assert.equal(select(h,'unit_id').value==='welfare_committee'&&selectedTitle(h)===a.title,false);
    assert.equal(f.requests.filter(request=>request.method==='POST').length,0);
  }finally{f.close()}
});

test('saving a published article cannot silently unpublish it through the draft shortcut',async()=>{
  const f=articleFixture();try{
    const expected=seed(f,'published-A','welfare_committee','published'),h=await setup(f);
    await record(h,expected.title).click();await h.settle(()=>selectedTitle(h)===expected.title);
    await bodyInput(h).input(expected.blocks[0].text+'\n公開文章編輯');
    assert.equal(select(h,'status').value,'published');
    assert.ok(h.q('#save-draft').hidden||h.q('#save-draft').disabled,'the draft shortcut must not imply an unnoticed unpublish');
    const before=f.requests.filter(request=>request.method==='POST').length;
    await h.q('#form').onsubmit({preventDefault(){},submitter:h.q('#save-draft')});
    await h.settle();
    assert.equal(f.requests.filter(request=>request.method==='POST').length,before,'event handler must protect even a stale/programmatic submitter');
    assert.equal(JSON.parse(f.sqlite.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').get(expected.id).content_json).status,'published');
    await h.q('#save').click();await h.settle(()=>!h.q('#save').disabled);
    let row=f.sqlite.prepare('SELECT content_json,revision FROM welfare_activity_stories WHERE id=?').get(expected.id);
    assert.equal(row.revision,2);assert.equal(JSON.parse(row.content_json).status,'published');
    await select(h,'status').change('draft');await bodyInput(h).input(expected.blocks[0].text+'\n明確選擇草稿後編輯');
    const aiBefore=f.aiCalls.length;await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    row=f.sqlite.prepare('SELECT content_json,revision FROM welfare_activity_stories WHERE id=?').get(expected.id);
    assert.equal(row.revision,3);assert.equal(JSON.parse(row.content_json).status,'draft');assert.equal(f.aiCalls.length,aiBefore);
  }finally{f.close()}
});

test('incomplete or mismatched detail cannot become a writable empty article',async t=>{
  for(const invalid of ['missing-blocks','wrong-id','wrong-unit'])await t.test(invalid,async()=>{
    const f=articleFixture();try{
      const a=seed(f,'valid-current'),b=seed(f,'invalid-detail'),h=await setup(f);
      await record(h,a.title).click();await h.settle(()=>selectedTitle(h)===a.title);
      const edited=a.blocks[0].text+'\n保留完整編輯';await bodyInput(h).input(edited);
      const bad={...b,revision:1};if(invalid==='missing-blocks')delete bad.blocks;if(invalid==='wrong-id')bad.id='other-record';if(invalid==='wrong-unit')bad.unit_id='club-a';
      h.context.fetch=(path,options={})=>isDetail(path,b.id)?Promise.resolve(Response.json({success:true,story:bad})):f.fetch(path,options);
      await record(h,b.title).click();await h.settle(()=>!h.q('#save').disabled);
      assert.equal(selectedTitle(h),a.title);assert.equal(bodyInput(h).value,edited);
      await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
      const rows=f.sqlite.prepare('SELECT id,content_json,revision FROM welfare_activity_stories ORDER BY id').all();
      assert.equal(rows.length,2);assert.equal(rows.find(row=>row.id===a.id).revision,2);assert.equal(rows.find(row=>row.id===b.id).revision,1);
      assert.equal(JSON.parse(rows.find(row=>row.id===a.id).content_json).blocks[0].text,edited);
    }finally{f.close()}
  });
});

test('a confirmed save followed by failed detail reload keeps full content and rotates the next save identity',async()=>{
  const f=articleFixture();try{
    const h=await setup(f),posts=[];let failReload=true;
    await h.q('#new-article').click();await select(h,'unit_id').change('welfare_committee');await select(h,'title').input('儲存後重讀保護');
    const full='完整正文\n'+'重新讀取失敗仍不得清空。'.repeat(900);await bodyInput(h).input(full);
    h.context.fetch=async(path,options={})=>{
      if(options.method==='POST')posts.push(JSON.parse(options.body));
      if(new URL(path,'https://fixture.test').searchParams.has('id')&&failReload)return errorResponse('隔離重新讀取失敗');
      return f.fetch(path,options);
    };
    await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(bodyInput(h).value,full);assert.match(h.q('#notice').textContent,/已儲存/);assert.match(h.q('#notice').textContent,/完整內容已保留/);
    assert.equal(f.sqlite.prepare('SELECT revision FROM welfare_activity_stories').get().revision,1);
    failReload=false;await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(posts.length,2);assert.notEqual(posts[0].request_id,posts[1].request_id);assert.equal(posts[0].revision,0);assert.equal(posts[1].revision,1);
    assert.equal(bodyInput(h).value,full);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_stories').get().n,1);
    assert.equal(f.sqlite.prepare('SELECT revision FROM welfare_activity_stories').get().revision,2);
  }finally{f.close()}
});

test('an uncertain save response retries the same payload and replays one committed article',async()=>{
  const f=articleFixture();try{
    const h=await setup(f),posts=[];let loseReply=true;
    await h.q('#new-article').click();await select(h,'unit_id').change('welfare_committee');await select(h,'title').input('遺失回應重試保護');
    const full='完整正文\n'+'同一個操作重試不得重複新增。'.repeat(700);await bodyInput(h).input(full);
    h.context.fetch=async(path,options={})=>{
      if(options.method==='POST'){
        posts.push(JSON.parse(options.body));const response=await f.fetch(path,options);
        if(loseReply){loseReply=false;assert.equal(response.status,200);throw Error('synthetic reply lost after commit')}
        return response;
      }
      return f.fetch(path,options);
    };
    await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(bodyInput(h).value,full);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_stories').get().n,1);
    await h.q('#save-draft').click();await h.settle(()=>!h.q('#save').disabled);
    assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_activity_stories').get().n,1);
    assert.equal(f.sqlite.prepare('SELECT revision FROM welfare_activity_stories').get().revision,1);
    assert.equal(bodyInput(h).value,full);
  }finally{f.close()}
});
