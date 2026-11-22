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
  sqlite.exec(`CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contract_end TEXT,contract_terminated_at TEXT,contact_line_user_id TEXT,submitted_by_line_user_id TEXT); CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id));`);
  sqlite.exec(`CREATE TABLE line_user_profiles(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,status_message TEXT,status TEXT,created_at TEXT,updated_at TEXT);
  CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,member_type TEXT,status TEXT,employee_no TEXT,phone TEXT,email TEXT,language TEXT,bind_status TEXT,verified_at TEXT,tags TEXT,created_at TEXT,updated_at TEXT);
  CREATE TABLE line_threads(id TEXT PRIMARY KEY,source_user_id TEXT,display_name TEXT,picture_url TEXT,summary TEXT,tags TEXT,last_message_at TEXT,updated_at TEXT,created_at TEXT);
  CREATE TABLE line_webhook_events(id TEXT PRIMARY KEY,line_user_id TEXT,message_text TEXT,sentiment_type TEXT,created_at TEXT);`);
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

test('multiple factories are OR, while unit and any/all CRM tags remain intersections',async()=>{
  const f=fixture();try{
    const rows=async filters=>(await f.call({action:'audience',filters:{maxRecipients:200,...filters}})).data.recipients.map(x=>x.line_user_id).sort();
    assert.deepEqual(await rows({factories:['甲廠','乙廠']}),[uid(1),uid(2),uid(4)]);
    assert.deepEqual(await rows({factories:['甲廠','乙廠'],businessUnit:'製造處',tags:['A','B'],tagMode:'all'}),[uid(1)]);
    assert.deepEqual(await rows({factories:['甲廠','乙廠'],businessUnit:'製造處',tags:['A','B'],tagMode:'any'}),[uid(1),uid(2)]);
    assert.deepEqual(await rows({factories:['甲廠','乙廠'],businessUnit:'製造處',department:JSON.stringify(['甲廠','製造處','D01','同名部門'])}),[uid(1)]);
    assert.deepEqual(await rows({factories:['甲廠','乙廠'],businessUnit:'製造處',tags:['不存在'],tagMode:'any'}),[]);
    assert.deepEqual(await rows({factory:'甲廠'}),[uid(1)]);
    await assert.rejects(f.call({action:'audience',filters:{factory:'甲廠',factories:['乙廠']}}),hasStatus(400));
    assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('multi-factory preview freezes the selected users, rejects stale roster and invalid revision',async()=>{
  const f=fixture();try{
    const p=await f.preview({factories:['甲廠','乙廠'],selectedLineUserIds:[uid(1),uid(2)]});
    const snapshot=f.sqlite.prepare('SELECT filters_json FROM welfare_push_previews WHERE id=?').get(p.data.preview_id);
    assert.deepEqual(JSON.parse(snapshot.filters_json).factories.slice().sort(),['乙廠','甲廠'].sort());
    await assert.rejects(f.call({action:'send',preview_id:p.data.preview_id,preview_revision:'bad',request_id:p.data.request_id,confirmed:true}),hasStatus(409));
    f.sqlite.prepare("UPDATE employee_roster SET factory='丙廠' WHERE employee_no='0002'").run();
    await assert.rejects(f.send(p),hasStatus(409));
    assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('legacy single-factory preview and scheduled snapshot remain executable',async()=>{
  const f=fixture();try{
    const old=await f.preview({factory:'甲廠',selectedLineUserIds:[uid(1)]});
    // Reconstruct a real legacy-format revision; persisted filter bytes must not be rewritten.
    const makeLegacy=(p,at)=>{const row=f.sqlite.prepare('SELECT * FROM welfare_push_previews WHERE id=?').get(p.data.preview_id),filters=JSON.parse(row.filters_json);delete filters.factories;const json=JSON.stringify(filters),revision=createHash('sha256').update(JSON.stringify({id:row.id,actor:row.actor,requestId:row.request_id,title:row.title,filters,messages:JSON.parse(row.message_json),recipients:JSON.parse(row.recipients_json),created:row.created_at,expires:row.expires_at,...(at?{deliveryMode:'scheduled',scheduledAt:at}:{})})).digest('hex');f.sqlite.prepare('UPDATE welfare_push_previews SET filters_json=?,revision=? WHERE id=?').run(json,revision,row.id);p.data.preview_revision=revision;return{json,revision}};
    makeLegacy(old);assert.equal((await f.send(old)).data.status,'sent');assert.deepEqual(f.calls.map(x=>x.id),[uid(1)]);
    const at=f.now+300000,p=await f.preview({factory:'乙廠',selectedLineUserIds:[uid(2)]},{delivery_mode:'scheduled',scheduled_at:at}),legacy=makeLegacy(p,at);await f.schedule(p,at);f.now=at;
    const result=await f.cron();assert.equal(result[0].status,'sent');assert.deepEqual(f.calls.map(x=>x.id),[uid(1),uid(2)]);
    const saved=f.sqlite.prepare('SELECT filters_json,revision FROM welfare_push_previews WHERE id=?').get(p.data.preview_id);assert.equal(saved.filters_json,legacy.json);assert.equal(saved.revision,legacy.revision);
  }finally{await f.close()}
});

test('legacy and multi-factory drafts round trip unchanged and still require review',async()=>{
  const f=fixture();try{
    for(const filters of [{factory:'甲廠',tags:['A']},{factories:['甲廠','乙廠'],tags:['A','B'] }]){
      const saved=await handleSegmentDraft(f.db,{action:'draft.save',title:'合成草稿',filters,content:{messageMode:'official_text'},selectedLineUserIds:[uid(1)]},f.deps);
      const restored=await handleSegmentDraft(f.db,{action:'draft.get',id:saved.data.id},f.deps);
      assert.deepEqual(restored.data.draft.filters,filters);assert.deepEqual(restored.data.draft.selectedLineUserIds,[uid(1)]);assert.equal(restored.data.requiresAudienceReview,true);
    }
    assert.equal(f.calls.length,0);
  }finally{await f.close()}
});

test('scheduled multi-factory push skips a moved recipient and sends to the existing match only',async()=>{
  const f=fixture();try{
    const at=f.now+300000,p=await f.preview({factories:['甲廠','乙廠'],selectedLineUserIds:[uid(1),uid(2)]},{delivery_mode:'scheduled',scheduled_at:at});
    await f.schedule(p,at);f.sqlite.prepare("UPDATE employee_roster SET factory='丙廠' WHERE employee_no='0002'").run();f.now=at;
    const result=await f.cron();assert.equal(result[0].status,'partial');
    assert.deepEqual(f.calls.map(row=>row.id),[uid(1)]);
    assert.deepEqual(await f.cron(),[]);
  }finally{await f.close()}
});
