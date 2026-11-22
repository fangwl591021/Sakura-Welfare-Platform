import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {chromium} from 'playwright';

const bundle = process.env.STORE_APP_BUNDLE;
const {default:worker} = await import(bundle ? pathToFileURL(bundle).href : '../src/index.js');
const origin = 'https://line-opinion.test';
const person = 'U' + '3'.repeat(32);
const other = 'U' + '4'.repeat(32);
const targetThread = 'group:synthetic-group:' + person;
const wrongThread = 'user:' + person;
const messageText = '隔離測試的群組客訴 <原文>';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const migration of ['0003_welfare_platform.sql', '0005_line_user_profiles.sql', '0007_line_oa_threads.sql']) {
    sqlite.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  }
  sqlite.exec(`CREATE TABLE admin_users(id,username,display_name,role,business_units,line_user_id,active);
    CREATE TABLE admin_sessions(token,user_id,expires_at);
    INSERT INTO admin_users VALUES('admin','fixture','隔離管理員','admin','*','',1);
    INSERT INTO admin_sessions VALUES('test-session','admin','2099-01-01');`);
  sqlite.prepare('INSERT INTO line_user_profiles(line_user_id, display_name) VALUES(?,?)').run(person, '隔離測試者');
  const addEvent = sqlite.prepare(`INSERT INTO line_webhook_events(id,event_id,line_user_id,message_type,message_text,raw_payload,sentiment_type,priority,process_status,created_at)
    VALUES(?,?,? ,?,?, '{}',?,?,?, '2026-01-01 11:00:00')`);
  addEvent.run(1, 'event-in-group', person, 'text', messageText, 'complaint', 'medium', 'open');
  addEvent.run(2, '', person, 'text', '舊版紀錄', 'general', 'critical', 'new');
  addEvent.run(3, 'event-missing', person, 'text', '未同步 <原文>', 'complaint', 'medium', 'open');
  addEvent.run(4, 'event-archived', person, 'text', '已結束', 'complaint', 'high', 'archived');
  addEvent.run(5, 'event-location', person, 'location', '定位測試資料', 'complaint', 'high', 'open');

  const addThread = sqlite.prepare('INSERT INTO line_threads(id,source_user_id,display_name,last_message_at) VALUES(?,?,?,?)');
  addThread.run(wrongThread, person, '私人聊天室', '2030-01-01');
  addThread.run(targetThread, person, '正確群組聊天室', '2026-01-02');
  const addMessage = sqlite.prepare('INSERT INTO line_messages(id,thread_id,line_event_id,sender_id,message_text,created_at) VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 520; i++) {
    addMessage.run('old-' + i, targetThread, '', person, '舊對話', new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString());
  }
  addMessage.run('same-text', wrongThread, 'different-event', person, messageText, '2026-01-01 11:00:00');
  addMessage.run('original', targetThread, 'event-in-group', person, messageText, '2026-01-01 11:00:00');
  addMessage.run('after', targetThread, 'after-event', other, '下一則對話', '2026-01-01 11:05:00');
  addMessage.run('legacy:2', wrongThread, '', person, '舊版紀錄', '2026-01-01 11:00:00');

  function prepare(query, values = []) {
    assert.match(query.trim(), /^SELECT\b/i, 'opinion reads must not write');
    return {
      bind: (...params) => prepare(query, params),
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return {results:sqlite.prepare(query).all(...values)}; },
    };
  }
  return (path, loggedIn = true) => worker.fetch(new Request(origin + path, {
    headers: loggedIn ? {Authorization:'Bearer test-session'} : {},
  }), {DB:{prepare}, OPENAI_API_KEY:'must-not-contact-provider'}, {
    waitUntil() { throw Error('No background activity expected'); },
  });
}

test('protected opinion routes resolve exact event IDs and include context beyond older 500 messages', async t => {
  const call = fixture(t);
  for (const path of ['/admin-api/line-events?view=pending','/api/line-oa/thread?event_id=1']) {
    assert.equal((await call(path,false)).status,403);
  }
  const list = await call('/admin-api/line-events?view=pending');
  assert.match(list.headers.get('Cache-Control'),/no-store/);
  const pending = await list.json();
  assert.deepEqual(pending.summary,{total:3,complaints:2,high:1});
  assert.deepEqual(pending.events.map(event=>event.id),[3,2,1]);

  const read = globalThis.fetch;
  const attempts=[];
  globalThis.fetch = async (...args)=>{ attempts.push(args[0]); throw Error('External request forbidden'); };
  t.after(()=>{ globalThis.fetch=read; });
  const response = await call('/api/line-oa/thread?event_id=1');
  assert.match(response.headers.get('Cache-Control'),/no-store/);
  const result = await response.json();
  assert.equal(result.data.id,targetThread);
  assert.equal(result.focus.messageId,'original');
  assert.equal(result.data.messages.length,42);
  assert.deepEqual(result.data.messages.slice(-2).map(message=>message.id),['original','after']);
  assert.equal((await (await call('/api/line-oa/thread?event_id=2')).json()).focus.messageId,'legacy:2');
  const missing = await (await call('/api/line-oa/thread?event_id=3')).json();
  assert.equal(missing.data,null);
  assert.equal(missing.focus.messageText,'未同步 <原文>');
  for (const id of ['5','999','2%20OR%201%3D1']) assert.equal((await call('/api/line-oa/thread?event_id='+id)).status,404);
  assert.deepEqual(attempts,[]);
});

test('dashboard buttons open and highlight the exact message, and missing chats show the original record', {timeout:60000}, async t => {
  const call = fixture(t);
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1750,height:1080}});
  const errors = [], writes = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('sakura_admin_session',JSON.stringify({token:'test-session'})));
  await page.route('**/*', async route=>{
    const request = route.request(), url = new URL(request.url());
    if(url.origin!==origin) return route.abort();
    if(url.pathname==='/api'&&request.postDataJSON()?.action==='getAdminSession') {
      return route.fulfill({json:{success:true,data:{role:'admin'}}});
    }
    if(request.method()!=='GET'){writes.push(url.pathname);return route.abort();}
    if(['/admin-api/vendor-management','/admin-api/crm-users'].includes(url.pathname)) return route.fulfill({json:{success:true,summary:{}}});
    if(url.pathname==='/admin-api/editor-context')return route.fulfill({json:{success:true,role:'admin',editor:false}});
    if(url.pathname==='/admin-api/vendor-supplement-monitor')return route.fulfill({json:{success:true,records:[]}});
    const response = await call(url.pathname+url.search,request.headers().authorization==='Bearer test-session');
    const body = await response.text();
    const contentType = response.headers.get('Content-Type') || 'text/plain';
    if(contentType.includes('text/html')) for(const [,script] of body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script);
    return route.fulfill({status:response.status,contentType,body});
  });
  await page.goto(origin+'/sakura-admin');
  const monitor = page.frameLocator('#monitorContent iframe');
  await page.locator('[data-line-opinion="1"]').click();
  await monitor.getByText('正確群組聊天室',{exact:true}).first().waitFor();
  assert.equal(await monitor.locator('#chatName').textContent(),'正確群組聊天室');
  await monitor.locator('.opinion-focus').getByText(messageText,{exact:true}).waitFor();
  assert.equal(await monitor.locator('.opinion-focus').count(),1);
  assert.equal(await monitor.locator('.opinion-focus 原文').count(),0);
  const dashboard = page.locator('.nav-item[data-module="dashboard"]');
  if (!await dashboard.isVisible()) await page.locator('.group').filter({has:dashboard}).locator('.group-title').click();
  await dashboard.click();
  await page.locator('[data-line-opinion="3"]').click();
  await monitor.getByText('未同步 <原文>',{exact:false}).waitFor();
  assert.equal(await monitor.locator('#chatName').textContent(),'尚未選取');
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
});
