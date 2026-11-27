import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Script } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { handleActivityHistory } from '../src/activity-history.js';
const bundle=process.env.STORE_APP_BUNDLE;
const liveOrigin=process.env.ACTIVITY_HISTORY_LIVE_UI==='1'
  ?'https://sakura-welfare-platform.fangwl591021.workers.dev':'';
const {default:worker}=await import(bundle?pathToFileURL(bundle).href:'../src/index.js');

function readAdminPage(path){
  if(liveOrigin)return fetch(liveOrigin+path,{redirect:'error',signal:AbortSignal.timeout(10000)});
  return worker.fetch(new Request('https://isolated.test'+path),{},{});
}

function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  sqlite.exec(`
    CREATE TABLE welfare_activity_events (
      id TEXT PRIMARY KEY,title,description DEFAULT '',location DEFAULT '',cover_image_url DEFAULT '',cover_image_key DEFAULT '',
      audience_scope DEFAULT '["all"]',start_at DEFAULT '',end_at DEFAULT '',checkin_start_at DEFAULT '',checkin_end_at DEFAULT '',
      registration_start_at DEFAULT '',registration_end_at DEFAULT '',status,qr_token UNIQUE,created_at DEFAULT '2026-01-01',updated_at DEFAULT '');
    CREATE TABLE welfare_activity_forms(event_id,revision,schema_json,created_by,created_at,PRIMARY KEY(event_id,revision));
    CREATE TABLE welfare_audit_events(id TEXT PRIMARY KEY,actor_id,event_type,target_type,target_id,summary,raw_json);
    CREATE TABLE welfare_activity_club_links(id TEXT PRIMARY KEY,club_id,content_json);
    INSERT INTO welfare_activity_events(id,title,location,status,start_at,end_at,qr_token)
      VALUES ('old','過往家庭日','台中','active','2001-08-02 14:00:00','','old-qr'),
             ('open','長期活動','台中','active','2001-08-01 14:00:00','2099-08-01 14:00:00','open-qr'),
             ('draft','草稿','台北','draft','2001-08-03T00:30:00+08:00','','draft-qr'),
             ('club','社團旅行','台北','archived','','','club-qr');
    INSERT INTO welfare_activity_club_links VALUES ('club','club-one','{"mode":"free","old_only":"do not copy"}');
    UPDATE welfare_activity_events SET description='活動說明',cover_image_url='/file/example',cover_image_key='workspace/activity/example',
      audience_scope='["employee"]',checkin_start_at='2001-08-02 13:00:00',registration_start_at='2001-07-01 08:00:00' WHERE id='old';
    INSERT INTO welfare_activity_forms VALUES ('old',1,'{"fields":["old"]}','admin','2001-01-01'),('old',2,'{"fields":["latest"]}','admin','2001-02-01');
    CREATE TABLE welfare_activity_registrations(id,event_id);
    INSERT INTO welfare_activity_registrations VALUES ('registration','old');
    CREATE TABLE welfare_activity_checkins(id,event_id);
    INSERT INTO welfare_activity_checkins VALUES ('checkin','old');
    CREATE TABLE welfare_activity_lotteries(event_id);
    INSERT INTO welfare_activity_lotteries VALUES ('old');
  `);
  function prepare(sql,args=[]) {
    return {bind:(...values)=>prepare(sql,values),all:()=>({results:sqlite.prepare(sql).all(...args)}),run:()=>sqlite.prepare(sql).run(...args)};
  }
  const db={prepare,batch(stmts){
    sqlite.exec('BEGIN');
    try {
      const results=stmts.map(stmt=>stmt.all());
      sqlite.exec('COMMIT');
      return results;
    }catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  const path='/admin-api/activity-checkin?view=history';
  return {sqlite,
    list:(query='',actor='admin:fixture')=>handleActivityHistory(new Request('https://isolated.test'+path+query),db,actor),
    copy:(id,request_id,actor='admin:fixture')=>handleActivityHistory(new Request('https://isolated.test'+path,{
      method:'POST',body:JSON.stringify({action:'copy_event',data:{id,request_id}})
    }),db,actor)};
}

test('history shows past events, searches, filters and pages within existing roles',async t=>{
  const f=fixture(t);
  const ids=async response=>(await (await response).json()).events.map(row=>row.id);
  assert.deepEqual(await ids(f.list()),['club','old']);
  assert.deepEqual(await ids(f.list('', 'editor:activity_editor:one')),['old']);
  assert.deepEqual(await ids(f.list('', 'editor:club_editor:one')),['club']);
  assert.deepEqual(await ids(f.list('&filter=draft')),['draft']);
  assert.deepEqual(await ids(f.list('&filter=all&q='+encodeURIComponent('台北'))),['club','draft']);
  assert.equal((await f.list('&page=0')).status,400);
  for(let i=0;i<26;i++){
    f.sqlite.prepare("INSERT INTO welfare_activity_events(id,title,status,start_at,qr_token) VALUES (?,?,'closed','2000-01-01',?)")
      .run('past-'+i,'歷史活動 '+i,'qr-'+i);
  }
  const first=await (await f.list()).json(),second=await (await f.list('&page=2')).json();
  assert.equal(first.events.length,25);
  assert.equal(first.has_next,true);
  assert.equal(second.events.length,3);
  assert.equal(second.has_next,false);
});

test('copies content and latest form once into a separate draft with blank dates and fresh QR',async t=>{
  const f=fixture(t);
  const id=crypto.randomUUID();
  const response=await f.copy('old',id);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).draft,{id,title:'過往家庭日（複製）'});
  const draft=f.sqlite.prepare('SELECT * FROM welfare_activity_events WHERE id=?').get(id);
  assert.equal(draft.status,'draft');
  assert.equal(draft.location,'台中');
  assert.equal(draft.description,'活動說明');
  assert.equal(draft.cover_image_key,'workspace/activity/example');
  assert.equal(draft.audience_scope,'["employee"]');
  assert.notEqual(draft.qr_token,'old-qr');
  for(const field of ['start_at','end_at','registration_start_at','registration_end_at','checkin_start_at','checkin_end_at']){
    assert.equal(draft[field],'');
  }
  const form=f.sqlite.prepare('SELECT revision,schema_json FROM welfare_activity_forms WHERE event_id=?').get(id);
  assert.equal(form.revision,1);
  assert.equal(form.schema_json,'{"fields":["latest"]}');
  for(const table of ['welfare_activity_checkins','welfare_activity_registrations','welfare_activity_lotteries']){
    assert.equal(f.sqlite.prepare('SELECT event_id FROM '+table).all()[0].event_id,'old');
    assert.equal(f.sqlite.prepare('SELECT count(*) AS size FROM '+table).get().size,1);
  }
  assert.equal((await f.copy('old',id)).status,200);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS size FROM welfare_audit_events').get().size,1);
  assert.equal((await f.copy('old',id,'admin:other')).status,409);
  assert.equal((await f.copy('club',crypto.randomUUID(),'editor:activity_editor:one')).status,409);
  const clubDraft=crypto.randomUUID();
  assert.equal((await f.copy('club',clubDraft,'editor:club_editor:one')).status,200);
  const link=f.sqlite.prepare('SELECT club_id,content_json FROM welfare_activity_club_links WHERE id=?').get(clubDraft);
  assert.equal(link.club_id,'club-one');
  assert.deepEqual(JSON.parse(link.content_json),{club_id:'club-one',kind:'club',mode:'free'});
});

test('the admin navigation places history immediately below the calendar and serves the standalone view',async()=>{
  const [adminPage,historyPage]=await Promise.all([
    readAdminPage('/sakura-admin'),
    readAdminPage('/activity-checkin-admin?view=history&embedded=1')
  ]);
  assert.equal(adminPage.status,200);
  assert.equal(historyPage.status,200);
  const admin=await adminPage.text();
  assert.match(admin,/\["activity-calendar"[^\n]+\],\["activity-history"/);
  assert.match(admin,/activity-checkin-admin\?view=history&embedded=1/);
  const history=await historyPage.text();
  assert.match(history,/<h1>活動列表總覽<\/h1>/);
  for(const [,script] of history.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(script);
});

test('a browser can copy a past event and open the independent draft for editing',
  {skip:!process.env.PLAYWRIGHT_CHANNEL&&!bundle,timeout:25000},async t=>{
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  t.after(()=>browser.close());
  const f=fixture(t), origin='https://isolated.test';
  // The live check replays only the HTML. Every interaction uses the in-memory fixture.
  const renderPaths=['/activity-checkin-admin','/activity-checkin-admin?view=history&embedded=1'];
  const renderedPages=new Map(await Promise.all(renderPaths.map(async path=>{
    const response=await readAdminPage(path);
    assert.equal(response.status,200);
    return [path,await response.text()];
  })));
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/activity-checkin-admin'){
      const path=url.searchParams.get('view')==='history'?renderPaths[1]:renderPaths[0];
      return route.fulfill({contentType:'text/html;charset=UTF-8',body:renderedPages.get(path)});
    }
    if(url.pathname==='/admin-api/activity-checkin'&&url.searchParams.get('view')==='history'){
      const body=req.method()==='POST'?req.postDataJSON().data:null;
      const response=body?await f.copy(body.id,body.request_id):await f.list(url.search.replace('?view=history',''));
      return route.fulfill({status:response.status,json:await response.json()});
    }
    if(url.pathname==='/admin-api/activity-checkin'){
      const id=url.searchParams.get('event_id'),event=f.sqlite.prepare('SELECT * FROM welfare_activity_events WHERE id=?').get(id);
      return route.fulfill({json:{success:true,selected_event_id:id,events:[event],
        summary:{event_total:1,checkin_total:0,active_total:0},attendance:[]}});
    }
    if(url.pathname==='/admin-api/editor-context')return route.fulfill({json:{role:'admin',editor:false}});
    if(url.pathname==='/admin-api/activity-form')return route.fulfill({json:{success:true,schema:{fields:[],rules:[]},revision:0,registrations:[]}});
    return route.fulfill({json:{success:true}});
  });
  await page.addInitScript(()=>localStorage.setItem('sakura_admin_session',JSON.stringify({token:'fixture'})));
  await page.goto(origin+'/activity-checkin-admin?view=history&embedded=1');
  await page.getByText('過往家庭日',{exact:true}).waitFor();
  await page.getByText('社團旅行',{exact:true}).waitFor();
  await page.getByRole('searchbox').fill('家庭日');
  await page.getByRole('button',{name:'搜尋',exact:true}).click();
  await page.getByText('社團旅行',{exact:true}).waitFor({state:'hidden'});
  await page.getByText('過往家庭日',{exact:true}).waitFor();
  const row=page.getByRole('row').filter({hasText:'過往家庭日'});
  await row.getByRole('button',{name:'複製為草稿'}).click();
  await page.getByText('已建立草稿「過往家庭日（複製）」。',{exact:false}).waitFor();
  await page.getByRole('combobox',{name:'顯示範圍'}).selectOption('draft');
  await page.getByText('過往家庭日（複製）',{exact:true}).waitFor();
  await page.getByRole('link',{name:'編輯新草稿'}).click();
  await page.waitForURL('**/activity-checkin-admin?event_id=*&embedded=1');
  await page.waitForFunction(()=>document.querySelector('#eventForm [name="title"]').value==='過往家庭日（複製）');
  assert.equal(await page.locator('#eventForm [name="status"]').inputValue(),'draft');
  assert.equal(await page.locator('#eventForm [name="start_at"]').inputValue(),'');
  assert.deepEqual(errors,[]);
});
