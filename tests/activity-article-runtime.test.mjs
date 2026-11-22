import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(process.env.WELFARE_DEPENDENCIES||import.meta.url);
const {build}=require('esbuild'),{Miniflare}=require('miniflare');
const employee='U'+'4'.repeat(32);

test('real isolated workerd preserves full article across draft, publish, replay, locale and media authorization',{timeout:90000},async()=>{
  const entry=`import {handleActivityStoryRequest} from './src/activity-stories-service.js';
    let aiCalls=0;export default{async fetch(request,env){if(new URL(request.url).pathname==='/__fixture-stats')return Response.json({aiCalls});
    return await handleActivityStoryRequest(request,env,{requireAdmin:async({sessionToken})=>sessionToken==='synthetic-admin'?{ok:true,user:{id:'1',role:'admin'}}:{ok:false},findAdmin:async()=>null,verifyLine:async(_env,token)=>token==='synthetic-employee'?{lineUserId:'${employee}'}:null,callAi:async(_env,messages)=>{aiCalls++;return {texts:JSON.parse(messages[1].content).texts.map(text=>text?'translated '+text:'')}}})||new Response('Not found',{status:404})}}`;
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-08',d1Databases:{DB:'synthetic-article-only'},r2Buckets:['R2_BUCKET'],bindings:{OPENAI_API_KEY:'synthetic-only'}});
  try{
    const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('R2_BUCKET');
    for(const sql of [
      'CREATE TABLE welfare_clubs(id TEXT PRIMARY KEY,content_json TEXT)',
      'CREATE TABLE welfare_club_galleries(id TEXT PRIMARY KEY,club_id TEXT,content_json TEXT,updated_at TEXT)',
      'CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY,audience_scope TEXT)',
      'CREATE TABLE welfare_activity_club_links(id TEXT PRIMARY KEY,club_id TEXT)',
      'CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,member_type TEXT,status TEXT,bind_status TEXT)',
      'CREATE TABLE admin_uid_whitelist(line_user_id TEXT PRIMARY KEY,display_name TEXT,role TEXT,active INTEGER)',
      ...readFileSync(new URL('../migrations/0036_activity_stories.sql',import.meta.url),'utf8').split(';').filter(sql=>sql.trim())
    ])await db.prepare(sql).run();
    await db.prepare('INSERT INTO welfare_members VALUES(?,?,?,?)').bind(employee,'employee','active','bound').run();
    await db.prepare('INSERT INTO welfare_activity_story_media(id,unit_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)').bind('photo-1','welfare_committee','synthetic/photo-1','image/jpeg','synthetic.jpg',4,'admin:1','seed-photo').run();
    await bucket.put('synthetic/photo-1',new Uint8Array([255,216,255,217]));
    const request=(path,{body,token,method=body?'POST':'GET'}={})=>mf.dispatchFetch('https://isolated.test'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const save=(story,revision,request_id)=>request('/admin-api/activity-stories',{token:'synthetic-admin',body:{story,revision,request_id,confirmed:true}});
    const fullText='長文章開頭\n'+Array.from({length:1200},(_,index)=>'第 '+index+' 段：文章完整內容與分段保存。').join('\n')+'\n完整末尾 END_OF_ARTICLE';
    const story={id:'runtime-article',unit_id:'welfare_committee',type:'article',title:'Runtime article',summary:'Summary only',event_date:'',cover_media_id:'photo-1',visibility:'all',status:'draft',gallery_id:'',album_media_ids:[],blocks:[{type:'heading',level:2,text:'Article heading'},{type:'text',text:fullText},{type:'quote',text:'Quoted plain text'},{type:'list',style:'ordered',items:['First item','Second item']},{type:'image',media_id:'photo-1',caption:'Article photograph'},{type:'video',url:'https://www.youtube.com/watch?v=uUJU66syCgk'}]};
    let response=await save(story,0,'article-draft');assert.equal(response.status,200,await response.clone().text());
    assert.equal((await(await request('/__fixture-stats')).json()).aiCalls,0);
    let stored=JSON.parse((await db.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').bind(story.id).first()).content_json);
    assert.equal(stored.blocks[1].text,fullText);assert.equal(stored.summary,'Summary only');
    assert.equal((await request('/api/activity-stories/'+story.id)).status,404);
    assert.equal((await request('/activity-story-media/photo-1')).status,404);
    story.status='published';response=await save(story,1,'article-publish');assert.equal(response.status,200,await response.clone().text());
    assert.ok((await(await request('/__fixture-stats')).json()).aiCalls>2,'long publication must split provider batches');
    const publicDetail=(await(await request('/api/activity-stories/'+story.id)).json()).story;
    assert.deepEqual(publicDetail.blocks,story.blocks);assert.equal(publicDetail.blocks[1].text.length,fullText.length);
    const publicList=(await(await request('/api/activity-stories')).json()).stories;
    assert.equal(publicList[0].summary,story.summary);assert.equal(publicList[0].blocks,undefined);
    for(const language of ['id','th']){
      const translated=(await(await request('/api/activity-stories/'+story.id+'?lang='+language)).json()).story;
      assert.match(translated.blocks[0].text,/Article heading/);assert.match(translated.blocks[1].text,/END_OF_ARTICLE$/);
      assert.match(translated.blocks[2].text,/Quoted plain text/);assert.match(translated.blocks[3].items[1],/Second item/);
      assert.equal(translated.blocks[3].style,'ordered');assert.equal(translated.blocks[4].media_id,'photo-1');
    }
    const replay=await save(story,1,'article-publish');assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM welfare_activity_stories').first()).n,1);
    assert.equal((await save({...story,title:'Stale'},1,'stale-request')).status,409);
    assert.equal((await request('/activity-story-media/photo-1')).status,200);
    story.visibility='employee';response=await save(story,2,'article-private');assert.equal(response.status,200,await response.clone().text());
    assert.equal((await request('/api/activity-stories/'+story.id)).status,404);
    assert.equal((await request('/activity-story-media/photo-1')).status,404);
    assert.equal((await request('/api/activity-stories/'+story.id,{token:'synthetic-employee'})).status,200);
    assert.equal((await request('/activity-story-media/photo-1',{token:'synthetic-employee'})).status,200);
    stored=JSON.parse((await db.prepare('SELECT content_json FROM welfare_activity_stories WHERE id=?').bind(story.id).first()).content_json);
    assert.equal(stored.blocks[1].text,fullText);
  }finally{await mf.dispose()}
});
