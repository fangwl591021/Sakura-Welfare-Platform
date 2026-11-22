import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(process.env.WELFARE_DEPENDENCIES||import.meta.url);
const {build}=require('esbuild'),{Miniflare}=require('miniflare');
const uid='U00000000000000000000000000000001';
test('schedule reservation and deadline use genuine isolated workerd/D1 transactions',{timeout:90000},async t=>{
 const bundled=await build({stdin:{contents:`
 import {handleSegmentPush} from './src/segment-push.js';
 import {createSegmentSchedule,cancelSegmentSchedule,runDueSegmentSchedules} from './src/segment-push-schedule.js';
 import {buildCompositeMessages} from './src/segment-composite.js';
 const sent=[];
 const fetchLine=async(url,options)=>{
   if(url!=='https://api.line.me/v2/bot/message/push'||options.method!=='POST')throw new Error('Unexpected external request');
   sent.push({body:JSON.parse(options.body),key:options.headers['X-Line-Retry-Key']});
   return new Response('{}',{status:200});
 };
 export default {async fetch(request,env){try{
  const body=await request.clone().json(),header=request.headers.get('x-test-clock'),sequence=request.headers.get('x-test-sequence'),before=sent.length;
  let times=sequence?JSON.parse(sequence):null;const captured=[];const deps={actor:'admin:1',buildMessages:async(_,message)=>message.mode==='official_composite'?buildCompositeMessages(message):[{type:'text',text:'synthetic'}],transport:async(uid,messages)=>{captured.push({uid,messages});return {ok:true,status:200}}};
  if(request.headers.has('x-test-wire')){delete deps.transport;deps.fetchLine=fetchLine;}
  if(times)deps.now=()=>times.length>1?times.shift():times[0];else if(header)deps.now=()=>Number(header);
  let db=env.DB;
  if(request.headers.get('x-expire-before-batch')){const actual=db;db={prepare:(...args)=>actual.prepare(...args),batch:async statements=>{await actual.prepare('UPDATE welfare_push_previews SET expires_at=? WHERE id=?').bind(Number(request.headers.get('x-expire-before-batch')),body.preview_id).run();return actual.batch(statements)}};}
  const result=body.action==='schedule'?await createSegmentSchedule(db,deps,body):body.action==='cancel'?await cancelSegmentSchedule(db,deps,body):body.action==='cron'?{success:true,data:await runDueSegmentSchedules(db,env,{...deps,actorAuthorized:async()=>true})}:await handleSegmentPush(request,db,env,deps);
  return Response.json({...result,captured,wire:sent.slice(before)});
 }catch(e){return Response.json({success:false,message:e.message},{status:e.status||500})}}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-08',d1Databases:{DB:'isolated-segment-schedule-test'},bindings:{LINE_CHANNEL_ACCESS_TOKEN:'isolated-wire-token'}});
 try{
  const db=await mf.getD1Database('DB');
  const schema=[`CREATE TABLE line_user_profiles(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,status_message TEXT,status TEXT,created_at TEXT,updated_at TEXT)`,`CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,member_type TEXT,status TEXT,employee_no TEXT,phone TEXT,email TEXT,language TEXT,bind_status TEXT,verified_at TEXT,tags TEXT,created_at TEXT,updated_at TEXT)`,`CREATE TABLE line_threads(id TEXT PRIMARY KEY,source_user_id TEXT,display_name TEXT,picture_url TEXT,summary TEXT,tags TEXT,last_message_at TEXT,updated_at TEXT,created_at TEXT)`,`CREATE TABLE line_webhook_events(id TEXT PRIMARY KEY,line_user_id TEXT,message_text TEXT,sentiment_type TEXT,created_at TEXT)`];
  for(const sql of schema)await db.prepare(sql).run();
  await db.prepare('CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contract_end TEXT,contract_terminated_at TEXT,contact_line_user_id TEXT,submitted_by_line_user_id TEXT)').run();
  await db.prepare('CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id))').run();
  for(const name of ['0012_line_segment_push.sql','0035_employee_roster.sql','0037_segment_push_safety.sql','0039_segment_push_schedules.sql','0051_segment_push_insights.sql'])for(const sql of readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
  await db.prepare(`INSERT INTO welfare_members(line_user_id,display_name,picture_url,member_type,status,employee_no,phone,email,language,bind_status,verified_at,tags,created_at,updated_at) VALUES(?,'合成人員','','employee','active','0001','','','zh-TW','bound','2026-10-20 12:00:00','A','2026-01-01','2026-01-02')`).bind(uid).run();await db.prepare(`INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name) VALUES('0001','合成員工','烏日廠','製造處','D01','測試部')`).run();
  const call=async(body,headers={})=>mf.dispatchFetch('https://local.test/action',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const preview=async(headers={},scheduledAt)=>{const clock=Number(headers['x-test-clock']||Date.now());const due=scheduledAt||((Math.floor(clock/60000)+2)*60000);const r=await call({action:'preview',delivery_mode:'scheduled',scheduled_at:due,title:'合成預約',filters:{selectedLineUserIds:[uid],maxRecipients:100},message:{mode:'official_text',text:'synthetic'}},headers);assert.equal(r.status,200,await r.clone().text());return (await r.json()).data;};
  const schedule=(p,due,headers={})=>call({action:'schedule',preview_id:p.preview_id,preview_revision:p.preview_revision,request_id:p.request_id,scheduled_at:due,confirmed:true},headers);
  const counts=async()=>({campaigns:(await db.prepare('SELECT COUNT(*) n FROM welfare_push_campaigns').first()).n,schedules:(await db.prepare('SELECT COUNT(*) n FROM welfare_push_schedules').first()).n});
  await t.test('due schedule sends to the confirmed recipient and records the skipped recipient in D1',async()=>{
   const changed='U00000000000000000000000000000002';
   await db.prepare("INSERT INTO employee_roster(employee_no,employee_name) VALUES('0002','第二位合成員工')").run();
   await db.prepare("INSERT INTO welfare_members SELECT ?,display_name,picture_url,member_type,status,'0002',phone,email,language,bind_status,verified_at,tags,created_at,updated_at FROM welfare_members WHERE line_user_id=?").bind(changed,uid).run();
   try{
    const now=Date.now(),due=(Math.floor(now/60000)+2)*60000;
    const headers={'x-test-clock':String(now),'x-test-wire':'1'};
    const resp=await call({action:'preview',delivery_mode:'scheduled',scheduled_at:due,title:'隔離資格測試',
      filters:{memberType:'employee',selectedLineUserIds:[uid,changed]},message:{mode:'official_text'}},headers);
    assert.equal(resp.status,200,await resp.clone().text());
    const preview=(await resp.json()).data;
    assert.equal((await schedule(preview,due,headers)).status,200);
    await db.prepare("UPDATE welfare_members SET bind_status='pending' WHERE line_user_id=?").bind(changed).run();
    const dueHeaders={...headers,'x-test-clock':String(due)};
    const result=await (await call({action:'cron'},dueHeaders)).json();
    assert.deepEqual(result.data,[{id:preview.preview_id,status:'partial'}]);
    assert.deepEqual(result.wire.map(entry=>entry.body.to),[uid]);
    const outcomes=await db.prepare('SELECT status,response_body FROM welfare_push_deliveries WHERE campaign_id=? ORDER BY line_user_id').bind(preview.preview_id).all();
    assert.deepEqual(outcomes.results.map(row=>row.status),['accepted','not_sent']);
    assert.equal(outcomes.results[1].response_body,'員工 LINE 綁定尚未確認。');
    assert.deepEqual((await (await call({action:'cron'},dueHeaders)).json()).wire,[]);
   }finally{
    await db.prepare('DELETE FROM welfare_members WHERE line_user_id=?').bind(changed).run();
    await db.prepare("DELETE FROM employee_roster WHERE employee_no='0002'").run();
   }
  });
  await t.test('new immediate and scheduled sends add one stable analytics unit to the isolated LINE request',async()=>{
   for(const scheduled of [false,true]){
    const clock=Date.now(),due=(Math.floor(clock/60000)+2)*60000,headers={'x-test-clock':String(clock),'x-test-wire':'1'};
    const pRes=await call({action:'preview',title:'隔離成效測試',filters:{selectedLineUserIds:[uid],maxRecipients:100},message:{mode:'official_text'},...(scheduled?{delivery_mode:'scheduled',scheduled_at:due}:{})},headers);
    assert.equal(pRes.status,200,await pRes.clone().text());
    const p=(await pRes.json()).data;
    const sendBody={action:'send',preview_id:p.preview_id,preview_revision:p.preview_revision,request_id:p.request_id,confirmed:true};
    if(scheduled)assert.equal((await schedule(p,due,headers)).status,200);
    const res=scheduled?await call({action:'cron'},{...headers,'x-test-clock':String(due)}):await call(sendBody,headers);
    assert.equal(res.status,200,await res.clone().text());
    const {wire}=await res.json();assert.equal(wire.length,1);
    const saved=await db.prepare('SELECT unit_name,synced_at FROM welfare_push_insights WHERE campaign_id=?').bind(p.preview_id).first();
    assert.match(saved.unit_name,/^sp_[a-f0-9]{27}$/);
    assert.equal(saved.synced_at,null);
    assert.deepEqual(wire[0].body,{to:uid,messages:[{type:'text',text:'synthetic'}],customAggregationUnits:[saved.unit_name]});
    assert.match(wire[0].key,/^[0-9a-f-]{36}$/);
    const again=scheduled?await call({action:'cron'},{...headers,'x-test-clock':String(due)}):await call(sendBody,headers);
    assert.equal(again.status,200);
    assert.deepEqual((await again.json()).wire,[]);
   }
  });
  await t.test('image-first snapshot reaches isolated immediate and scheduled transport unchanged',async()=>{
   const text={type:'text',text:'合成內容'},image={type:'image',originalContentUrl:'https://example.test/a.jpg',previewImageUrl:'https://example.test/a.jpg'},message={mode:'official_composite',text:text.text,originalContentUrl:image.originalContentUrl,messageOrder:'image_first'};
   for(const scheduled of [false,true]){
    const clock=Date.now(),due=(Math.floor(clock/60000)+2)*60000,headers={'x-test-clock':String(clock)};
    const pRes=await call({action:'preview',title:'合成順序',filters:{selectedLineUserIds:[uid],maxRecipients:100},message,...(scheduled?{delivery_mode:'scheduled',scheduled_at:due}:{})},headers);
    assert.equal(pRes.status,200,await pRes.clone().text());const p=(await pRes.json()).data;
    assert.deepEqual(JSON.parse((await db.prepare('SELECT message_json FROM welfare_push_previews WHERE id=?').bind(p.preview_id).first()).message_json),[image,text]);
    if(scheduled){const reservation=await schedule(p,due,headers);assert.equal(reservation.status,200,await reservation.clone().text());const run=await call({action:'cron'},{'x-test-clock':String(due)});assert.equal(run.status,200,await run.clone().text());const result=await run.json();assert.deepEqual(result.captured.find(x=>x.uid===uid).messages,[image,text]);}
    else {const sent=await call({action:'send',preview_id:p.preview_id,preview_revision:p.preview_revision,request_id:p.request_id,confirmed:true},headers);assert.equal(sent.status,200,await sent.clone().text());assert.deepEqual((await sent.json()).captured[0].messages,[image,text]);}
   }
  });
  await t.test('actual D1 UTC clock includes millisecond fraction',async()=>{const before=Date.now(),row=await db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER) AS ms").first(),after=Date.now();assert.ok(row.ms>=before-1500 && row.ms<=after+1500,JSON.stringify({before,sql:row.ms,after}));});
  await t.test('scheduled preview and its time intent are written atomically in D1',async()=>{const before=(await db.prepare('SELECT COUNT(*) n FROM welfare_push_previews').first()).n,prior=(await db.prepare('SELECT COUNT(*) n FROM welfare_push_schedule_intents').first()).n;await db.prepare("CREATE TRIGGER fail_intent BEFORE INSERT ON welfare_push_schedule_intents BEGIN SELECT RAISE(ABORT, 'synthetic constraint'); END").run();try{const due=(Math.floor(Date.now()/60000)+2)*60000,r=await call({action:'preview',delivery_mode:'scheduled',scheduled_at:due,title:'失敗測試',filters:{selectedLineUserIds:[uid],maxRecipients:100},message:{mode:'official_text',text:'synthetic'}});assert.equal(r.status,500,await r.clone().text());assert.equal((await db.prepare('SELECT COUNT(*) n FROM welfare_push_previews').first()).n,before);assert.equal((await db.prepare('SELECT COUNT(*) n FROM welfare_push_schedule_intents').first()).n,prior);}finally{await db.prepare('DROP TRIGGER fail_intent').run();}const p=await preview();const intent=await db.prepare('SELECT delivery_mode,scheduled_at FROM welfare_push_schedule_intents WHERE preview_id=?').bind(p.preview_id).first();assert.equal(intent.delivery_mode,'scheduled');assert.equal(intent.scheduled_at,p.scheduled_at);});
  await t.test('confirmed schedule rejects altered time and cannot dispatch as immediate send',async()=>{const p=await preview(),before=await counts(),r=await schedule(p,p.scheduled_at+60000);assert.equal(r.status,409,await r.clone().text());const immediate=await call({action:'send',preview_id:p.preview_id,preview_revision:p.preview_revision,request_id:p.request_id,confirmed:true});assert.equal(immediate.status,409,await immediate.clone().text());assert.deepEqual(await counts(),before);});
  await t.test('correctly bound schedule does not run before its confirmed time',async()=>{const clock=Date.now(),h={'x-test-clock':String(clock)},p=await preview(h),r=await schedule(p,p.scheduled_at,h);assert.equal(r.status,200,await r.clone().text());const id=(await r.json()).data.id,early=await call({action:'cron'},{'x-test-clock':String(p.scheduled_at-1)});assert.equal(early.status,200,await early.clone().text());assert.equal((await db.prepare('SELECT status FROM welfare_push_schedules WHERE id=?').bind(id).first()).status,'scheduled');assert.equal((await db.prepare('SELECT COUNT(*) n FROM welfare_push_deliveries WHERE campaign_id=?').bind(id).first()).n,0);const now=await call({action:'cron'},{'x-test-clock':String(p.scheduled_at)});assert.equal(now.status,200,await now.clone().text());assert.equal((await db.prepare('SELECT status FROM welfare_push_schedules WHERE id=?').bind(id).first()).status,'sent');});
  await t.test('production clock and real D1 batch reserve both rows',async()=>{const p=await preview(),before=await counts(),r=await schedule(p,p.scheduled_at);assert.equal(r.status,200,await r.clone().text());assert.deepEqual(await counts(),{campaigns:before.campaigns+1,schedules:before.schedules+1});});
  await t.test('concurrent reservations produce exactly one campaign and schedule',async()=>{const p=await preview(),due=p.scheduled_at,before=await counts(),results=await Promise.all([schedule(p,due),schedule(p,due)]);assert.ok(results.some(r=>r.status===200));assert.deepEqual(await counts(),{campaigns:before.campaigns+1,schedules:before.schedules+1});});
  for(const fake of [false,true])await t.test(`preview expires after JS check before D1 batch; fake-clock=${fake}`,async()=>{const clock=Date.now(),h=fake?{'x-test-clock':String(clock)}:{},p=await preview(h),before=await counts(),due=p.scheduled_at,r=await schedule(p,due,{...h,'x-expire-before-batch':String(clock-5000)});assert.equal(r.status,409,await r.clone().text());assert.deepEqual(await counts(),before);});
  await t.test('injected clock crosses preview expiry before write; no reservation',async()=>{const clock=Date.now(),due=(Math.floor((clock+1200000)/60000)+1)*60000,p=await preview({'x-test-clock':String(clock)},due),before=await counts(),r=await schedule(p,due,{'x-test-sequence':JSON.stringify([clock,clock+700000])});assert.equal(r.status,409,await r.clone().text());assert.deepEqual(await counts(),before);});
  await t.test('cancel and due cron race has one winner on real D1',async()=>{const clock=Date.now(),headers={'x-test-clock':String(clock)},p=await preview(headers),due=p.scheduled_at,r=await schedule(p,due,headers);assert.equal(r.status,200,await r.clone().text());const id=(await r.json()).data.id;const nowHeaders={'x-test-clock':String(due)};const [cancel,run]=await Promise.all([call({action:'cancel',schedule_id:id},nowHeaders),call({action:'cron'},nowHeaders)]);assert.ok(run.status===200);const row=await db.prepare('SELECT status FROM welfare_push_schedules WHERE id=?').bind(id).first(),deliveries=await db.prepare('SELECT status FROM welfare_push_deliveries WHERE campaign_id=?').bind(id).all();assert.ok(['cancelled','sent'].includes(row.status),JSON.stringify(row));if(row.status==='cancelled'){assert.equal(cancel.status,200);assert.equal(deliveries.results.length,0);}else{assert.equal(cancel.status,409);assert.equal(deliveries.results.length,1);assert.equal(deliveries.results[0].status,'accepted');}});
  await t.test('duplicate schedule request id rolls back earlier insert in actual D1 batch',async()=>{const p=await preview(),before=await counts();await db.prepare(`INSERT INTO welfare_push_schedules(id,preview_id,actor,request_id,preview_revision,scheduled_at,status,created_at,updated_at) VALUES('other-id','other-preview','other',?,'x',?,'scheduled',?,?)`).bind(p.request_id,Date.now()+3600000,Date.now(),Date.now()).run();const afterSeed=await counts(),r=await schedule(p,p.scheduled_at);assert.equal(r.status,409,await r.clone().text());assert.deepEqual(await counts(),afterSeed);assert.equal((await db.prepare('SELECT COUNT(*) n FROM welfare_push_campaigns WHERE id=?').bind(p.preview_id).first()).n,0);assert.equal(afterSeed.campaigns,before.campaigns);});
 }finally{await mf.dispose();}
});
