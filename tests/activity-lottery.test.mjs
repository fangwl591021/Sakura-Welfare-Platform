import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/index.js';
import { lotteryDefaultVideoPath } from '../src/activity-lottery-video.js';
import { ACTIVITY_TUTORIALS } from '../src/activity-tutorial-media.js';
import { lotteryChatEntryPath } from '../src/workspace/dashboard-flex.js';

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
  sqlite.exec("ALTER TABLE welfare_activity_events ADD COLUMN start_at TEXT; ALTER TABLE welfare_activity_events ADD COLUMN created_at TEXT;");
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
    get: async (key, {range} = {}) => {
      const bytes = media.get(key);
      if (!bytes) return null;
      return {size:bytes.length, body:range ? bytes.subarray(range.offset,range.offset+range.length) : bytes};
    },
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
  return { sqlite, person, call, send, bucket, onBeforeSave(callback) { beforeSave = callback; } };
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
  data=await ok(f.send(data,'draw',{prize_id:second,confirmed:true}));
  const winnerExport='/admin-api/activity-lottery?event_id=family&export=csv&list=winners';
  const scopedResponse=await f.call('family',{path:winnerExport+'&prize_id='+first});
  assert.match(decodeURIComponent(scopedResponse.headers.get('content-disposition')),/家庭日-獎品甲-中獎名單\.csv/);
  const scopedCsv=await scopedResponse.text();
  assert.match(scopedCsv,/獎品甲.*已領獎/);
  assert.doesNotMatch(scopedCsv,/缺席|獎品乙/);
  assert.equal(scopedCsv.split('\r\n').length,2);
  const eventCsv=await (await f.call('family',{path:winnerExport})).text();
  assert.match(eventCsv,/獎品乙.*待領獎/);
  assert.equal(eventCsv.split('\r\n').length,3);
  assert.equal((await f.call('family',{path:winnerExport+'&prize_id=other'})).status,404);
  assert.equal((await f.call('family',{path:winnerExport,token:'clubs'})).status,403);
  assert.equal((await f.call('family',{path:winnerExport,token:''})).status,403);
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
  assert.match(html,/getElementById\('activity-lottery-open'\), 'lottery', 0/);
  assert.ok(html.includes(ACTIVITY_TUTORIALS.lottery.path));
  assert.match(html,/id="lottery-mode"/);
  for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
});

test('the LINE lottery picker accepts only its LIFF state and returns scoped activity summaries', async t => {
  const f = fixture(t);
  const liffPath = '/?liff.state=' + encodeURIComponent(lotteryChatEntryPath);
  assert.match(await (await f.call('family', {token:'',path:liffPath})).text(), /const TARGET_PATH = "\/editor-workspace\?line_login=1&view=lottery"/);
  const unexpected = await f.call('family', {token:'',path:liffPath + encodeURIComponent('&extra=1')});
  assert.doesNotMatch(await unexpected.text(), /const TARGET_PATH = "\/editor-workspace/);
  const path = '/admin-api/activity-checkin?view=lottery_picker';
  for (const [token, ids] of [['admin',['club','family','solo']],['activities',['family','solo']],['clubs',['club']]]) {
    const result = await ok(f.call('family', { token, path }));
    assert.deepEqual(result.events.map(event => event.id), ids);
    assert.deepEqual(Object.keys(result.events[0]), ['id','title','start_at']);
  }
  for (const token of ['', 'member', 'welfare']) assert.equal((await f.call('family', {token, path})).status, 403);
  const html = await (await f.call('family', {token:'', path:'/activity-checkin-admin?view=lottery'})).text();
  assert.match(html, /<h1>抽獎設定<\/h1>/);
  assert.match(html, /返回工作區/);
  for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n, 0);
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

test('the current and prior tutorials remain independently available by exact path', async t => {
  const f = fixture(t);
  const current = ACTIVITY_TUTORIALS.lottery;
  const samples = [[current, Buffer.from('latest tutorial')]];
  for (const version of ['v2','v3']) {
    const file='activity-lottery-20261124-'+version+'.mp4';
    samples.push([{path:'/activity-tutorials/'+file,key:'tutorials/activity/'+file},Buffer.from(version+' tutorial')]);
  }
  for (const [file, bytes] of samples) await f.bucket.put(file.key, bytes);
  for (const [file, bytes] of samples) {
    const response = await f.call('family', {token:'', path:file.path, headers:{Range:'bytes=0-6'}});
    assert.equal(response.status,206);
    assert.equal(await response.text(),bytes.subarray(0,7).toString());
  }
});

test('browser can configure family tickets, play projection video and display only masked winners',
  {skip: !process.env.PLAYWRIGHT_CHANNEL, timeout:45000}, async t=>{
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL,headless:true});
    t.after(()=>browser.close());
    const f=fixture(t);
    f.person('測試員工甲','employee',12);
    const liffEntryPath='/?liff.state='+encodeURIComponent(lotteryChatEntryPath);
    const servedPages=new Map();
    if (process.env.LOTTERY_LIVE_READBACK === '1') {
      const origin='https://sakura-welfare-platform.fangwl591021.workers.dev';
      // Fetch public HTML only. All sessions, activity data and draw actions below stay in the fixture.
      await Promise.all([liffEntryPath,lotteryChatEntryPath,'/activity-checkin-admin?view=lottery',
        '/activity-checkin-admin','/activity-lottery-stage'].map(async path=>{
        const response=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(15000)});
        assert.equal(response.status,200,path);
        assert.match(response.headers.get('content-type')||'',/text\/html/i);
        const headers=Object.fromEntries(response.headers);
        delete headers['content-encoding'];
        delete headers['content-length'];
        servedPages.set(path,{status:200,headers,body:Buffer.from(await response.arrayBuffer())});
      }));
    }
    const tutorial=ACTIVITY_TUTORIALS.lottery;
    const clip=await f.call('family',{token:'',path:lotteryDefaultVideoPath});
    const defaultBytes=Buffer.from(await clip.arrayBuffer());
    const tutorialBytes=process.env.LOTTERY_TUTORIAL_TEST_FILE
      ? readFileSync(process.env.LOTTERY_TUTORIAL_TEST_FILE) : defaultBytes;
    await f.bucket.put(tutorial.key,tutorialBytes);
    const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
    page.setDefaultTimeout(5000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.addInitScript(()=>localStorage.setItem('sakura_admin_session',JSON.stringify({token:'admin'})));
    await page.addInitScript(()=>{
      window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'synthetic'}),getIDToken:()=> 'fixture-token'};
    });
    await page.context().route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url());
      if(url.origin!=='https://isolated.test') return route.abort();
      const servedPage=servedPages.get(url.pathname+url.search);
      if(request.method()==='GET' && servedPage) return route.fulfill(servedPage);
      if(url.pathname==='/api' && request.method()==='POST'){
        assert.equal(request.postDataJSON().action,'reviewerLineLogin');
        return route.fulfill({json:{success:true,data:{role:'admin',token:'admin'}}});
      }
      if(url.pathname==='/admin-api/activity-checkin' && url.searchParams.get('view')!=='lottery_picker') return route.fulfill({json:{
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
    const liffEntry='https://isolated.test'+liffEntryPath;
    await page.goto(liffEntry);
    await page.getByRole('heading',{name:'抽獎設定',exact:true}).waitFor();
    const picker=page.getByLabel('選擇活動',{exact:true});
    await picker.selectOption('family');
    await page.getByRole('button',{name:'抽獎與獎項',exact:true}).click();
    await page.getByText(/可列入名單 1 人/).waitFor();
    async function verifyLotteryControls(widths) {
      const dialog=page.getByRole('dialog',{name:'抽獎與獎項'});
      for (const width of widths) {
        await page.setViewportSize({width,height:844});
        const sizes=await dialog.evaluate(root=>{
          const inside=['#lottery-stage-open','#lottery-close','#lottery-mode','#lottery-policy',
            '#lottery-save-settings','#lottery-prize-name','#lottery-quantity','#lottery-prize-save'];
          const panel=root.getBoundingClientRect();
          const controls=inside.map(id => {
            const box=root.querySelector(id).getBoundingClientRect();
            return {id, height:box.height, width:box.width, contained:box.left>=panel.left && box.right<=panel.right};
          });
          return {left:panel.left,right:panel.right,horizontalScroll:root.scrollWidth-root.clientWidth,controls};
        });
        assert.ok(sizes.left>=0 && sizes.right<=width && sizes.horizontalScroll<=1, JSON.stringify({width,...sizes}));
        for (const control of sizes.controls) {
          assert.ok(control.height>=48 && control.width>=112 && control.contained, JSON.stringify({viewport:width,...control}));
        }
      }
    }
    await verifyLotteryControls([320,390]);
    await page.getByRole('button',{name:'關閉／返回活動',exact:true}).click();
    assert.equal(await picker.isVisible(),true);
    assert.equal(await page.getByRole('link',{name:'返回工作區'}).isVisible(),true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
    await page.goto('https://isolated.test/activity-checkin-admin');
    await page.getByText('家庭日',{exact:true}).first().waitFor();
    const lesson=page.locator('#activity-lottery-entry').getByRole('button',{name:'操作教學：抽獎與獎項',exact:true});
    await lesson.click();
    const lessonDialog=page.getByRole('dialog',{name:'活動抽獎操作教學'});
    assert.equal(await lessonDialog.isVisible(),true);
    await page.waitForFunction(()=>document.getElementById('at-video').currentTime>0);
    const lessonLength=await page.locator('#at-video').evaluate(video=>video.duration);
    if(process.env.LOTTERY_TUTORIAL_TEST_FILE){
      assert.ok(lessonLength>298 && lessonLength<305, lessonLength);
      await page.locator('#at-video').evaluate(video=>{ video.currentTime=281; });
      await page.waitForFunction(()=>{
        const player=document.getElementById('at-video');
        return player.currentTime>=281 && !player.seeking && player.readyState>=2;
      });
    }
    assert.equal(await page.locator('#at-video').getAttribute('src'),tutorial.path);
    await lessonDialog.getByRole('button',{name:'關閉操作教學'}).click();
    assert.equal(await lessonDialog.isVisible(),false);
    assert.equal(await lesson.evaluate(button=>document.activeElement===button),true);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
    await page.getByRole('button',{name:'抽獎與獎項',exact:true}).click();
    await page.getByText(/可列入名單 1 人/).waitFor();
    await verifyLotteryControls([1440,390]);
    await page.locator('#lottery-video-options summary').click();
    await page.getByText('目前使用系統預設影片。',{exact:true}).waitFor();
    await page.locator('#lottery-video-file').setInputFiles({name:'custom.mp4',mimeType:'video/mp4',buffer:defaultBytes});
    await page.getByRole('button',{name:'上傳影片',exact:true}).click();
    await page.getByText('已上傳，本活動將使用自訂影片。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'預覽影片',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('lottery-player').currentTime>0);
    assert.match(await page.locator('#lottery-player').getAttribute('src'),/^blob:/);
    await page.getByRole('button',{name:'結束預覽'}).click();
    await page.getByRole('button',{name:'恢復預設影片'}).click();
    await page.getByText('已恢復系統預設影片。',{exact:true}).waitFor();
    await page.getByLabel('抽獎資格').selectOption('with_family');
    await page.getByText(/預覽（尚未儲存）.*可列入名單 12 人/).waitFor();
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM welfare_activity_lotteries').get().n,0);
    await page.getByLabel('中獎規則').selectOption('per_prize');
    await page.getByRole('button',{name:'儲存設定'}).click();
    await page.getByText(/目前.*可列入名單 12 人/).waitFor();
    await page.getByLabel('獎項名稱').fill('家庭日試驗獎');
    await page.getByLabel('名額',{exact:true}).fill('12');
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
    const stagePopup = page.waitForEvent('popup');
    await page.getByRole('button',{name:'開啟現場投影'}).click();
    const stage = await stagePopup;
    stage.on('pageerror',error=>errors.push(error.message));
    stage.setDefaultTimeout(5000);
    await stage.setViewportSize({width:1920,height:1080});
    await stage.getByRole('heading',{name:'家庭日試驗獎',exact:true}).waitFor();
    await stage.getByText('等待主持人開始',{exact:true}).waitFor();
    await stage.getByRole('button',{name:'全螢幕',exact:true}).click();
    await stage.waitForFunction(()=>document.fullscreenElement===document.documentElement);
    assert.doesNotMatch(await stage.locator('body').innerText(), /抽獎資格|獎項管理|測試員工甲/);
    await page.getByRole('button',{name:'試抽',exact:true}).click();
    await stage.waitForFunction(()=>document.getElementById('video').currentTime>0);
    assert.equal(await stage.locator('#video').getAttribute('src'),lotteryDefaultVideoPath);
    assert.equal(await stage.locator('#winners li').count(),0);
    await stage.locator('#video').dispatchEvent('ended');
    await stage.getByText('試抽結果',{exact:true}).waitFor();
    assert.equal(await stage.locator('#winners li').count(),9);
    await page.getByRole('button',{name:'正式抽出 12 位'}).waitFor();
    await page.locator('#lottery-video-file').setInputFiles({name:'custom.mp4',mimeType:'video/mp4',buffer:defaultBytes});
    await page.getByRole('button',{name:'上傳影片',exact:true}).click();
    await page.getByText('已上傳，本活動將使用自訂影片。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'正式抽出 12 位'}).click();
    await stage.waitForFunction(()=>document.getElementById('video').currentTime>0);
    assert.match(await stage.locator('#video').getAttribute('src'),/^blob:/);
    await stage.getByText('開獎中',{exact:true}).waitFor();
    await page.getByRole('button',{name:'略過影片，顯示結果'}).click();
    await stage.getByText('恭喜中獎',{exact:true}).waitFor();
    assert.equal(await stage.locator('#winners').getAttribute('data-layout'),'multiple');
    assert.equal(await stage.locator('#winners li').count(),9);
    const groupFont=await stage.locator('#winners strong').first().evaluate(name=>parseFloat(getComputedStyle(name).fontSize));
    const before=await stage.locator('#winners li span').allTextContents();
    await stage.getByText(/共 12 位.*第 1／2 頁/).waitFor();
    await page.getByRole('button',{name:'投影下一頁'}).click();
    await stage.getByText(/共 12 位.*第 2／2 頁/).waitFor();
    const after=await stage.locator('#winners li span').allTextContents();
    assert.equal(new Set([...before,...after]).size,12);
    assert.equal(after.length,3);
    await page.getByRole('button',{name:'投影上一頁'}).click();
    await stage.getByText(/第 1／2 頁/).waitFor();
    assert.doesNotMatch(await stage.locator('body').innerText(), /測試員工甲|fixture-uid|確認領獎|下載 CSV/);
    await page.getByText('測試員工甲-3〔0001-3〕',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('抽獎資格').isDisabled(),true);
    assert.equal(await page.locator('#lottery-results .lottery-row').count(),12);
    await page.getByLabel('獎項名稱').fill('單人試驗獎');
    await page.getByRole('button',{name:'新增獎項'}).click();
    await page.getByRole('button',{name:'正式抽出 1 位'}).click();
    await page.getByRole('button',{name:'略過影片，顯示結果'}).click();
    await stage.getByRole('heading',{name:'單人試驗獎',exact:true}).waitFor();
    await stage.getByText('恭喜中獎',{exact:true}).waitFor();
    assert.equal(await stage.locator('#winners').getAttribute('data-layout'),'single');
    assert.equal(await stage.locator('#winners li').count(),1);
    const soloFont=await stage.locator('#winners strong').evaluate(name=>parseFloat(getComputedStyle(name).fontSize));
    assert.ok(soloFont > groupFont * 1.5);
    assert.doesNotMatch(await stage.locator('#winners').innerText(),/測試員工甲/);
    assert.equal(await stage.locator('#result-meta').isVisible(),false);
    assert.equal(await page.getByRole('button',{name:'投影下一頁'}).isVisible(),false);
    for (const [scope,stem,rows] of [['prize','家庭日-單人試驗獎-中獎名單',1],['event','家庭日-中獎名單',13]]) {
      await page.getByLabel('名單範圍').selectOption(scope);
      for (const [format,extension] of [['Excel','xlsx'],['CSV','csv']]) {
        const pendingFile=page.waitForEvent('download');
        await page.getByRole('button',{name:'下載中獎名單 '+format}).click();
        const file=await pendingFile;
        assert.equal(file.suggestedFilename(),stem+'.'+extension);
        const bytes=readFileSync(await file.path()), content=bytes.toString('utf8');
        if (extension==='xlsx') {
          assert.equal(bytes.readUInt32LE(0),0x04034b50);
          assert.ok(content.includes('<dimension ref="A1:E'+(rows+1)+'"/>'));
        } else assert.equal(content.split('\r\n').length,rows+1);
        assert.match(content,/單人試驗獎/);
        if (scope==='event') assert.match(content,/家庭日試驗獎/);
        else assert.doesNotMatch(content,/家庭日試驗獎/);
      }
    }
    await page.getByText('完整抽獎紀錄',{exact:true}).click();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'下載 CSV'}).click();
    assert.equal((await download).suggestedFilename(),'家庭日-抽獎紀錄.csv');
    const stageClosed = stage.waitForEvent('close');
    await page.getByRole('button',{name:'關閉／返回活動'}).click();
    await stageClosed;
    assert.equal(await page.getByRole('dialog',{name:'抽獎與獎項'}).isVisible(),false);
    assert.deepEqual(errors,[]);
  });
