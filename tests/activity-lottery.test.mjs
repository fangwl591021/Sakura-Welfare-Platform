import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/index.js';
import { lotteryDefaultVideoPath } from '../src/activity-lottery-video.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE admin_users(id,username,display_name,role,business_units,line_user_id,active);
    CREATE TABLE admin_sessions(token,user_id,expires_at);
    CREATE TABLE admin_uid_whitelist(line_user_id,role,allowed_modules,active);
    CREATE TABLE welfare_members(line_user_id,member_type,status,bind_status);
    CREATE TABLE welfare_activity_events(id PRIMARY KEY,title,status);
    CREATE TABLE welfare_activity_checkins(id,event_id,line_user_id,display_name,checkin_status,checked_at,raw_payload);
    CREATE TABLE welfare_activity_club_links(id PRIMARY KEY);
    `);
  for (const name of ['0029_activity_registration_forms.sql','0056_activity_lottery.sql']) {
    sqlite.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  }
  for (const [id,role,line] of [
    ['admin','admin',''],['activities','activity_editor','fixture-activities'],
    ['clubs','club_editor','fixture-clubs'],['welfare','welfare_editor','fixture-welfare']
  ]) {
    sqlite.prepare("INSERT INTO admin_users VALUES(?,?,?,?,'*',?,1)").run(id,id,id,role,line);
    sqlite.prepare("INSERT INTO admin_sessions VALUES(?,?,'2099-01-01')").run(id,id);
    if (line) sqlite.prepare("INSERT INTO admin_uid_whitelist VALUES(?,?,'*',1)").run(line,role);
  }
  sqlite.exec("INSERT INTO welfare_activity_events VALUES('family','家庭日','active'),('solo','員工聚會','active'),('club','社團聚會','active')");
  sqlite.exec("INSERT INTO welfare_activity_club_links VALUES('club')");
  const person = (name, type, attendance, {event = 'family', status = 'active', checked = true} = {}) => {
    const uid = 'fixture-uid-' + name;
    sqlite.prepare("INSERT INTO welfare_members VALUES(?,?,?,'bound')").run(uid,type,status);
    sqlite.prepare("INSERT INTO welfare_activity_registrations VALUES(?,?,?,?,1,'{}','{\"party\":99}','2026-11-01')").run(event+name,event,uid,name);
    if (checked) sqlite.prepare("INSERT INTO welfare_activity_checkins VALUES(?,?,?,?,'checked_in','2026-11-23',?)")
      .run('checkin-'+name,event,uid,name,attendance === null ? '{}' : JSON.stringify({attendance_count:attendance}));
  };
  let beforeSave;
  const db = {
    prepare(sql) {
      const bind = (...values) => ({
        first: async field => {
          const row = sqlite.prepare(sql).get(...values);
          return (field ? row?.[field] : row) ?? null;
        },
        all: async () => ({results:sqlite.prepare(sql).all(...values)}),
        run: async () => {
          if (beforeSave && sql.startsWith('INSERT INTO welfare_activity_lotteries')) { const callback = beforeSave; beforeSave = null; callback(); }
          return {meta:{changes:sqlite.prepare(sql).run(...values).changes}};
        }
      });
      return {bind,...bind()};
    }
  };
  const media = new Map();
  const bucket = {
    head: async key => media.has(key) ? {size:media.get(key).length} : null,
    get: async key => media.has(key) ? {size:media.get(key).length,body:media.get(key)} : null,
    put: async (key, bytes) => media.set(key, bytes),
    delete: async key => media.delete(key)
  };
  const call = (event = 'family', {token = 'admin', body, raw, method, headers = {}, exportAs, origin, path} = {}) => worker.fetch(
    new Request('https://isolated.test' + (path || '/admin-api/activity-lottery?event_id=' + event + (exportAs ? '&export=' + exportAs : '')),{
      method:method || (body ? 'POST' : 'GET'),
      headers:{...(token ? {Authorization:'Bearer ' + token}:{}),...(origin ? {Origin:origin}:{}),...(body ? {'Content-Type':'application/json'}:{}),...headers},
      ...(body ? {body:JSON.stringify(body)}:raw ? {body:raw}:{})
    }),{DB:db,R2_BUCKET:bucket},{waitUntil(){}});
  const send = (state, action, extra = {}, options = {}) => call(state.event.id, { ...options, body:{
    event_id:state.event.id, revision:state.revision, rosterVersion:state.rosterVersion, request_id:crypto.randomUUID(), action,...extra
  }});
  return { sqlite, person, call, send, onBeforeSave(callback) { beforeSave = callback; } };
}

async function ok(request) {
  const response = await request, data = await response.json();
  assert.equal(response.status, 200, data.message);
  assert.equal(data.success, true);
  return data;
}

test('an opted-in family event creates A and three distinct companion tickets and freezes only on a persisted draw', async t => {
  const f = fixture(t);
  f.person('A','employee',4);
  f.person('Visitor','visitor',3);
  f.person('Inactive','employee',7,{status:'inactive'});
  f.person('RegisteredOnly','employee',8,{checked:false});
  let data = await ok(f.call());
  assert.deepEqual(data.attendance,{groups:1,people:1,companions:0,unknown:0});
  assert.deepEqual(data.attendancePreview,{mode:'with_family',groups:1,people:4,companions:3,unknown:0});
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
  data = await ok(f.send(data,'save_settings',{mode:'with_family',policy:'event_once'}));
  assert.deepEqual(data.attendance,{groups:1,people:4,companions:3,unknown:0});
  data = await ok(f.send(data,'save_prize',{name:'家庭日獎品',quantity:4}));
  const prizeId = data.prizes[0].id;
  const trial = await ok(f.send(data,'trial',{prize_id:prizeId}));
  assert.deepEqual(trial.trial.map(row=>row.label).sort(),['A','A-1','A-2','A-3']);
  assert.equal(trial.winners.length,0);
  assert.equal(trial.frozenAt,null);
  assert.equal((await f.send(data,'draw',{prize_id:prizeId})).status,400);
  f.onBeforeSave(()=>f.person('RacingArrival','employee',1));
  assert.equal((await f.send(data,'draw',{prize_id:prizeId,confirmed:true})).status,409);
  assert.equal((await ok(f.call())).winners.length,0);
  f.sqlite.exec("DELETE FROM welfare_activity_checkins WHERE display_name='RacingArrival'");
  const request = {prize_id:prizeId,confirmed:true,request_id:crypto.randomUUID()};
  const responses = await Promise.all([f.send(data,'draw',request),f.send(data,'draw',request)]);
  assert.ok(responses.some(response=>response.status===200));
  assert.ok(responses.every(response=>[200,409].includes(response.status)));
  const drawn = await ok(f.send(data,'draw',request));
  assert.equal(drawn.replayed,true);
  assert.equal((await f.send(data,'draw',{...request,confirmedUnknown:true})).status,409);
  assert.deepEqual(drawn.winners.map(row=>row.label).sort(),['A','A-1','A-2','A-3']);
  assert.equal(new Set(drawn.winners.map(row=>row.code)).size,4);
  assert.ok(drawn.frozenAt);
  assert.equal(drawn.attendancePreview,null);
  assert.doesNotMatch(JSON.stringify(drawn),/fixture-uid/);
  f.person('Late','employee',5);
  assert.equal((await ok(f.call())).attendance.people,4);
  assert.equal((await f.send(drawn,'save_settings',{mode:'employee_only',policy:'event_once'})).status,409);
  assert.equal((await f.send(drawn,'draw',{prize_id:prizeId,confirmed:true})).status,409);
});

test('each activity chooses its mode; changed or legacy attendance requires confirmation; absence and claims preserve the draw',async t=>{
  const f=fixture(t);
  f.person('Solo','manager',4,{event:'solo'});
  f.person('B','foreign_employee',3);
  f.person('C','employee',null);
  assert.deepEqual((await ok(f.call('solo'))).attendance,{groups:1,people:1,companions:0,unknown:0});
  let data=await ok(f.call());
  data=await ok(f.send(data,'save_settings',{mode:'with_family',policy:'per_prize'}));
  data=await ok(f.send(data,'save_prize',{name:'獎品甲',quantity:1}));
  data=await ok(f.send(data,'save_prize',{name:'獎品乙',quantity:1}));
  const [first,second]=data.prizes.map(row=>row.id);
  assert.deepEqual(data.attendance,{groups:2,people:4,companions:2,unknown:1});
  assert.equal((await f.send(data,'draw',{prize_id:first,confirmed:true})).status,409);
  f.sqlite.prepare("UPDATE welfare_activity_checkins SET raw_payload=? WHERE display_name='B'").run('{"attendance_count":2}');
  assert.equal((await f.send(data,'draw',{prize_id:first,confirmed:true,confirmedUnknown:true})).status,409);
  data=await ok(f.call());
  data=await ok(f.send(data,'draw',{prize_id:first,confirmed:true,confirmedUnknown:true}));
  assert.equal(data.prizes[1].eligible,3);
  const absent=data.winners[0];
  data=await ok(f.send(data,'redraw',{prize_id:first,winner_id:absent.id,reason:'現場唱名未到',confirmed:true}));
  assert.equal(data.winners[0].status,'absent');
  assert.notEqual(data.winners[0].code,data.winners[1].code);
  assert.equal(data.winners[1].replaces,absent.id);
  assert.equal(data.prizes[0].drawn,1);
  assert.equal(data.prizes[1].eligible,2);
  data=await ok(f.send(data,'claim',{prize_id:first,winner_id:data.winners[1].id}));
  assert.equal(data.winners[1].status,'claimed');
  const csv=await (await f.call('family',{exportAs:'csv'})).text();
  assert.match(csv,/現場唱名未到/);
  assert.match(csv,/已領獎/);
  const xlsx=await f.call('family',{exportAs:'xlsx'});
  assert.equal(xlsx.status,200);
  assert.deepEqual([...new Uint8Array(await xlsx.arrayBuffer()).slice(0,4)],[80,75,3,4]);
});

test('the Worker keeps the existing admin and editor scope, and serves syntax-valid workspace scripts',async t=>{
  const f=fixture(t);
  for(const token of ['', 'member','welfare','clubs']) assert.equal((await f.call('family',{token})).status,403);
  for(const token of ['admin','activities']) assert.equal((await f.call('family',{token})).status,200);
  assert.equal((await f.call('club',{token:'activities'})).status,403);
  assert.equal((await f.call('club',{token:'clubs'})).status,200);
  assert.equal((await f.call('family',{origin:'https://outside.test'})).status,403);
  const page=await f.call('family',{path:'/activity-checkin-admin'});
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/id="activity-lottery-open"[^>]*>抽獎與獎項/);
  assert.match(html,/id="lottery-mode"/);
  for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
});

test('the bundled clip supports video ranges and custom MP4s stay scoped to one event',async t=>{
  const f=fixture(t), mime={'Content-Type':'video/mp4'};
  const head=await f.call('family',{token:'',path:lotteryDefaultVideoPath,method:'HEAD'});
  assert.equal(head.status,200);
  const size=Number(head.headers.get('Content-Length'));
  assert.ok(size>100000);
  assert.equal(head.headers.get('Content-Type'),'video/mp4');
  const partial=await f.call('family',{token:'',path:lotteryDefaultVideoPath,headers:{Range:'bytes=0-11'}});
  assert.equal(partial.status,206);
  assert.equal(partial.headers.get('Content-Range'),'bytes 0-11/'+size);
  assert.equal(Buffer.from(await partial.arrayBuffer()).subarray(4,8).toString(),'ftyp');
  assert.equal((await f.call('family',{path:lotteryDefaultVideoPath,headers:{Range:'bytes=999999999-'}})).status,416);
  const defaultResponse = await f.call('family',{token:'',path:lotteryDefaultVideoPath});
  const raw = new Uint8Array(await defaultResponse.arrayBuffer());
  const base='/admin-api/activity-lottery-video?event_id=';
  const path=base+'family', upload={method:'PUT',headers:mime,raw,path};
  assert.equal((await f.call('family',{...upload,token:''})).status,403);
  assert.equal((await f.call('family',{...upload,token:'clubs'})).status,403);
  assert.equal((await f.call('family',{...upload,token:'welfare'})).status,403);
  assert.equal((await f.call('family',{...upload,origin:'https://external.test'})).status,403);
  assert.equal((await f.call('family',{...upload,headers:{...mime,'Content-Length':'20000001'}})).status,413);
  assert.equal((await f.call('family',{...upload,raw:new Uint8Array(24)})).status,415);
  assert.equal((await ok(f.call('family',{...upload,token:'activities'}))).custom,true);
  assert.equal((await ok(f.call('family',{path:path+'&view=status'}))).custom,true);
  assert.equal((await ok(f.call('solo',{path:base+'solo&view=status'}))).custom,false);
  assert.equal((await f.call('family',{token:'',path:'/file/activity_lottery_private_video_family'})).status,404);
  const fetched=await f.call('family',{path});
  assert.equal(fetched.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(new Uint8Array(await fetched.arrayBuffer()),raw);
  assert.equal((await ok(f.call('family',{path,method:'DELETE'}))).custom,false);
  assert.equal((await f.call('family',{path})).status,404);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
});

test('mobile browser can select a mode, create a prize, and draw from the correct family count',
  {skip: !process.env.PLAYWRIGHT_CHANNEL, timeout:30000}, async t=>{
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
    t.after(()=>browser.close());
    const f=fixture(t);
    f.person('A','employee',4);
    const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
    page.setDefaultTimeout(5000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.addInitScript(()=>localStorage.setItem('sakura_admin_session',JSON.stringify({token:'admin'})));
    await page.route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url());
      if(url.origin!=='https://isolated.test') return route.abort();
      if(url.pathname==='/admin-api/activity-checkin') return route.fulfill({json:{
        success:true, selected_event_id:'family', events:[{id:'family',title:'家庭日',status:'active',checkin_count:1,checkin_url:'https://isolated.test/qr'}],
        summary:{event_total:1,active_total:1,checkin_total:1}, attendance:[]
      }});
      if(url.pathname==='/admin-api/activity-form') return route.fulfill({json:{success:true,schema:{fields:[],rules:[]},revision:0,registrations:[]}});
      const headers=request.headers();
      const response=await f.call('family',{path:url.pathname+url.search,method:request.method(),
        token:headers.authorization==='Bearer admin'?'admin':'',
        headers:{...(headers.range?{Range:headers.range}:{}),...(request.method()==='PUT'?{'Content-Type':headers['content-type']||''}:{})},
        body:request.method()==='POST'?request.postDataJSON():undefined,raw:request.method()==='PUT'?request.postDataBuffer():undefined});
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto('https://isolated.test/activity-checkin-admin');
    await page.getByText('家庭日',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'抽獎與獎項'}).click();
    await page.getByText(/可列入名單 1 人/).waitFor();
    await page.locator('#lottery-video-options summary').click();
    await page.getByText('目前使用系統預設影片。',{exact:true}).waitFor();
    const clip=await f.call('family',{token:'',path:lotteryDefaultVideoPath});
    await page.locator('#lottery-video-file').setInputFiles({name:'custom.mp4',mimeType:'video/mp4',buffer:Buffer.from(await clip.arrayBuffer())});
    await page.getByRole('button',{name:'上傳影片',exact:true}).click();
    await page.getByText('已上傳，本活動將使用自訂影片。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'預覽影片',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('lottery-player').currentTime>0);
    assert.match(await page.locator('#lottery-player').getAttribute('src'),/^blob:/);
    await page.getByRole('button',{name:'結束預覽'}).click();
    await page.getByRole('button',{name:'恢復預設影片'}).click();
    await page.getByText('已恢復系統預設影片。',{exact:true}).waitFor();
    await page.getByLabel('抽獎資格').selectOption('with_family');
    await page.getByText(/預覽（尚未儲存）.*可列入名單 4 人/).waitFor();
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
    await page.getByRole('button',{name:'儲存設定'}).click();
    await page.getByText(/目前.*可列入名單 4 人/).waitFor();
    await page.getByLabel('獎項名稱').fill('家庭日試驗獎');
    await page.getByLabel('名額',{exact:true}).fill('4');
    await page.getByRole('button',{name:'新增獎項'}).click();
    await page.getByRole('button',{name:'試抽',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('lottery-player').currentTime>0);
    assert.equal(await page.locator('#lottery-player').getAttribute('src'),lotteryDefaultVideoPath);
    await page.getByRole('button',{name:'略過影片，顯示結果'}).click();
    await page.getByText(/試抽（未存檔）/).waitFor();
    await page.route('**/activity-lottery-media/default-v1.mp4',route=>route.abort());
    await page.getByRole('button',{name:'試抽',exact:true}).click();
    await page.getByText('影片無法播放，已回到抽獎頁面。',{exact:true}).waitFor();
    await page.getByText(/試抽（未存檔）/).waitFor();
    await page.unroute('**/activity-lottery-media/default-v1.mp4');
    await page.getByRole('button',{name:'正式抽出 4 位'}).click();
    await page.getByRole('button',{name:'略過影片，顯示結果'}).click();
    await page.getByText('A-3〔0001-3〕',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('抽獎資格').isDisabled(),true);
    assert.equal(await page.locator('#lottery-results .lottery-row').count(),4);
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'下載 CSV'}).click();
    assert.equal((await download).suggestedFilename(),'家庭日-抽獎紀錄.csv');
    await page.getByRole('button',{name:'關閉／返回活動'}).click();
    assert.equal(await page.getByRole('dialog',{name:'抽獎與獎項'}).isVisible(),false);
    assert.deepEqual(errors,[]);
  });
