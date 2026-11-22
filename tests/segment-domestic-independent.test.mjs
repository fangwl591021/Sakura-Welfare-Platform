import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {handleSegmentPush} from '../src/segment-push.js';
import {createSegmentSchedule,runDueSegmentSchedules} from '../src/segment-push-schedule.js';
import {handleSegmentDraft} from '../src/segment-push-drafts.js';

// All data, identities and the transport in this file are synthetic.
globalThis.fetch=()=>{throw new Error('External network forbidden');};
const uid=n=>'U'+n.toString(16).padStart(32,'0');
const hasStatus=status=>error=>error?.status===status;
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE line_user_profiles(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,status_message TEXT,status TEXT,created_at TEXT,updated_at TEXT);
  CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,member_type TEXT,status TEXT,employee_no TEXT,phone TEXT,email TEXT,language TEXT,bind_status TEXT,verified_at TEXT,tags TEXT,created_at TEXT,updated_at TEXT);
  CREATE TABLE line_threads(id TEXT PRIMARY KEY,source_user_id TEXT,display_name TEXT,picture_url TEXT,summary TEXT,tags TEXT,last_message_at TEXT,updated_at TEXT,created_at TEXT);
  CREATE TABLE line_webhook_events(id TEXT PRIMARY KEY,line_user_id TEXT,message_text TEXT,sentiment_type TEXT,created_at TEXT);
  CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contract_end TEXT,contract_terminated_at TEXT,contact_line_user_id TEXT,submitted_by_line_user_id TEXT);
  CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id));`);
  for(const migration of ['0012_line_segment_push.sql','0035_employee_roster.sql','0037_segment_push_safety.sql','0039_segment_push_schedules.sql','0040_segment_push_drafts.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
  const member=sqlite.prepare(`INSERT INTO welfare_members(line_user_id,display_name,picture_url,member_type,status,employee_no,phone,email,language,bind_status,verified_at,tags,created_at,updated_at) VALUES(?,?,'','employee','active',?,'','','zh-TW',?,'2026-10-20 12:00:00',?,'2026-01-01','2026-01-02')`);
  const roster=sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name) VALUES(?,?,?,?,?,?)');
  for(const [n,factory,unit,tags,binding] of [[1,'甲廠','製造處','A,B','bound'],[2,'乙廠','製造處','A','bound'],[3,'丙廠','製造處','A,B','bound'],[4,'乙廠','管理處','A,B','bound'],[5,'甲廠','製造處','A,B','unbound']]){
    const no=String(n).padStart(4,'0');member.run(uid(n),'合成人員'+n,no,binding,tags);roster.run(no,'合成人員'+n,factory,unit,'D01','同名部門');
  }
  let clock=Date.UTC(2026,9,29,1,0,0);const calls=[],background=[];
  const db={prepare(sql){let args=[];const run=()=>{const r=sqlite.prepare(sql).run(...args);return{success:true,meta:{changes:Number(r.changes)}}};return{bind(...v){args=v;return this},async all(){return{success:true,results:sqlite.prepare(sql).all(...args)}},async first(key){const row=sqlite.prepare(sql).get(...args)||null;return key?row?.[key]??null:row},async run(){return run()},_run:run}},async batch(stmts){sqlite.exec('BEGIN IMMEDIATE');try{const out=stmts.map(s=>s._run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
  const deps={actor:'synthetic-admin',now:()=>clock,waitUntil:p=>background.push(p),buildMessages:async()=>[{type:'text',text:'合成測試'}],transport:async(id,messages,key)=>{calls.push({id,key});return{ok:true,status:200}}};
  const call=body=>handleSegmentPush(new Request('https://synthetic.invalid/admin-api/line-segment-push',{method:'POST',body:JSON.stringify(body)}),db,{},deps);
  const preview=(filters,extra={})=>call({action:'preview',title:'隔離測試',message:{mode:'official_text',text:'合成測試'},filters:{maxRecipients:200,...filters},...extra});
  const send=p=>call({action:'send',preview_id:p.data.preview_id,preview_revision:p.data.preview_revision,request_id:p.data.request_id,confirmed:true});
  const schedule=(p,at)=>createSegmentSchedule(db,deps,{action:'schedule',preview_id:p.data.preview_id,preview_revision:p.data.preview_revision,request_id:p.data.request_id,confirmed:true,scheduled_at:at});
  return{sqlite,db,deps,calls,call,preview,send,schedule,get now(){return clock},set now(value){clock=value},cron:()=>runDueSegmentSchedules(db,{}, {...deps,actorAuthorized:async()=>true}),async close(){await Promise.allSettled(background);sqlite.close()}};
}

// Role, roster identity and language are independent; these are synthetic records.
function seedIdentityCases(f) {
  const roster=f.sqlite.prepare('UPDATE employee_roster SET identity_type=? WHERE employee_no=?');
  for (const [n,identity] of [[1,'台灣'],[2,'台灣-產學生'],[3,'印尼'],[4,'台灣'],[5,'台灣']]) roster.run(identity,String(n).padStart(4,'0'));
  f.sqlite.prepare("UPDATE welfare_members SET member_type='manager',language='th' WHERE line_user_id=?").run(uid(2));
  f.sqlite.prepare("UPDATE welfare_members SET language='id' WHERE line_user_id=?").run(uid(1));
  f.sqlite.prepare("UPDATE welfare_members SET member_type='foreign_employee' WHERE line_user_id=?").run(uid(4));
  const addMember=f.sqlite.prepare("INSERT INTO welfare_members(line_user_id,display_name,member_type,status,employee_no,language,bind_status,verified_at,tags) VALUES(?,? ,?,'active',?,'zh-TW','bound','2026-10-20 12:00:00','')");
  const addRoster=f.sqlite.prepare("INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name,identity_type) VALUES(?,?,'甲廠','製造處','D01','同名部門',?)");
  for(const [n,role,identity] of [[6,'employee',''],[7,'visitor','台灣'],[8,'vendor','台灣'],[9,'employee','泰國'],[10,'employee','菲律賓'],[11,'employee','越南'],[12,'employee','外配'],[13,'employee','未確認'],[15,'employee','印尼-外配'],[16,'employee','泰國-外配']]) {
    const no=String(n).padStart(4,'0');addMember.run(uid(n),'合成人員'+n,role,no);addRoster.run(no,'合成人員'+n,identity);
  }
  // A bound employee with no roster is also an unknown identity.
  addMember.run(uid(14),'合成人員14','employee','0014');
}

test('new audience only admits explicitly Taiwan roster categories and consistent bound employee roles',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);
    const rows=async filters=>(await f.call({action:'audience',filters:{maxRecipients:200,...filters}})).data.recipients.map(x=>x.line_user_id).sort();
    assert.deepEqual(await rows({memberType:'employee_domestic'}),[uid(1),uid(2)]);
    assert.deepEqual(await rows({memberType:'employee_domestic',factories:['甲廠','乙廠'],businessUnit:'製造處',department:JSON.stringify(['甲廠','製造處','D01','同名部門'])}),[uid(1)]);
    assert.deepEqual(await rows({memberType:'employee_domestic',factories:['乙廠'],businessUnit:'製造處'}),[uid(2)]);
    const legacy=await rows({memberType:'employee'});assert.ok(legacy.includes(uid(3)));assert.ok(legacy.includes(uid(4)));assert.ok(legacy.includes(uid(14)));
    assert.deepEqual(await rows({memberType:'employee_language_id'}),[uid(1)]);
    assert.deepEqual(await rows({memberType:'employee_language_th'}),[uid(2)]);
    assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('preview and immediate send retain only selected eligible recipients',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);
    await assert.rejects(f.preview({memberType:'employee_domestic',factories:['甲廠','乙廠'],selectedLineUserIds:[uid(1),uid(3),uid(4),uid(6)]}),hasStatus(409));
    const p=await f.preview({memberType:'employee_domestic',factories:['甲廠','乙廠'],selectedLineUserIds:[uid(1)]});
    assert.equal((await f.send(p)).data.status,'sent');assert.deepEqual(f.calls.map(x=>x.id),[uid(1)]);
    await f.send(p).catch(()=>{});assert.deepEqual(f.calls.map(x=>x.id),[uid(1)]);
  }finally{await f.close()}
});

test('identity changes after preview fail closed before immediate delivery',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);
    const p=await f.preview({memberType:'employee_domestic',selectedLineUserIds:[uid(1),uid(2)]});
    f.sqlite.prepare("UPDATE employee_roster SET identity_type='印尼' WHERE employee_no='0002'").run();
    await assert.rejects(f.send(p),error=>{
      assert.equal(error.status,409);
      assert.deepEqual(error.recipientIssues.map(row=>[row.line_user_id,row.reason]),[
        [uid(2),'目前不符合本次選定的身分、標籤或組織條件。']
      ]);
      return true;
    });assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('scheduled identity drift skips only the changed recipient and cannot replay',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);const at=f.now+300000;
    const p=await f.preview({memberType:'employee_domestic',selectedLineUserIds:[uid(1),uid(2)]},{delivery_mode:'scheduled',scheduled_at:at});
    await f.schedule(p,at);f.sqlite.prepare("UPDATE employee_roster SET identity_type='' WHERE employee_no='0002'").run();f.now=at;
    const result=await f.cron();assert.equal(result[0].status,'partial');
    assert.deepEqual(f.calls.map(row=>row.id),[uid(1)]);
    const rows=f.sqlite.prepare('SELECT line_user_id,status,response_body FROM welfare_push_deliveries WHERE campaign_id=? ORDER BY line_user_id').all(p.data.preview_id);
    assert.deepEqual(rows.map(row=>[row.line_user_id,row.status]),[[uid(1),'accepted'],[uid(2),'not_sent']]);
    assert.equal(rows[1].response_body,'目前不符合本次選定的身分、標籤或組織條件。');
    assert.deepEqual(await f.cron(),[]);assert.equal(f.calls.length,1);
  }finally{await f.close()}
});

test('scheduled delivery uses frozen selection and does not repeat on retry',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);const at=f.now+300000;
    const p=await f.preview({memberType:'employee_domestic',selectedLineUserIds:[uid(1)]},{delivery_mode:'scheduled',scheduled_at:at});
    await f.schedule(p,at);f.now=at;const result=await f.cron();assert.equal(result[0].status,'sent');assert.deepEqual(f.calls.map(x=>x.id),[uid(1)]);assert.deepEqual(await f.cron(),[]);assert.equal(f.calls.length,1);
  }finally{await f.close()}
});

test('identity drift immediately before scheduling rejects the reservation',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);const at=f.now+300000;
    const p=await f.preview({memberType:'employee_domestic',selectedLineUserIds:[uid(1)]},{delivery_mode:'scheduled',scheduled_at:at});
    f.sqlite.prepare("UPDATE employee_roster SET identity_type='越南' WHERE employee_no='0001'").run();
    await assert.rejects(f.schedule(p,at),hasStatus(409));assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('identity drift after campaign claim is checked again before the transport',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);
    const p=await f.preview({memberType:'employee_domestic',selectedLineUserIds:[uid(1)]});
    const original=f.db.prepare.bind(f.db);let mutated=false;
    f.db.prepare=sql=>{if(!mutated && sql.includes('INSERT OR IGNORE INTO welfare_push_deliveries')){mutated=true;f.sqlite.prepare("UPDATE employee_roster SET identity_type='菲律賓' WHERE employee_no='0001'").run()}return original(sql)};
    await f.send(p);assert.equal(mutated,true);assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('pre-change guard hashes and already-scheduled snapshots remain compatible',async()=>{
  const f=fixture();try{
    seedIdentityCases(f);
    const base=await import('../../../push-usage-20261106/Sakura-Welfare-Platform/src/segment-audience.js');
    const basePush=await import('../../../push-usage-20261106/Sakura-Welfare-Platform/src/segment-push.js');
    const baseSchedule=await import('../../../push-usage-20261106/Sakura-Welfare-Platform/src/segment-push-schedule.js');
    const current=await import('../src/segment-audience.js');
    const oldRows=await base.readSegmentAudience(f.db),newRows=await current.readSegmentAudience(f.db);
    for(const n of [1,2,3])assert.equal(oldRows.guards.get(uid(n)),newRows.guards.get(uid(n)));
    const at=f.now+300000,body={action:'preview',title:'合成舊排程',message:{mode:'official_text',text:'合成'},filters:{memberType:'employee',selectedLineUserIds:[uid(1),uid(2)],maxRecipients:200},delivery_mode:'scheduled',scheduled_at:at};
    const p=await basePush.handleSegmentPush(new Request('https://synthetic.invalid/admin-api/line-segment-push',{method:'POST',body:JSON.stringify(body)}),f.db,{},f.deps);
    await baseSchedule.createSegmentSchedule(f.db,f.deps,{action:'schedule',preview_id:p.data.preview_id,preview_revision:p.data.preview_revision,request_id:p.data.request_id,confirmed:true,scheduled_at:at});
    f.now=at;const result=await f.cron();assert.equal(result[0].status,'sent');assert.deepEqual(f.calls.map(x=>x.id).sort(),[uid(1),uid(2)]);
  }finally{await f.close()}
});
