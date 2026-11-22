import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { buildCompositeMessages } from '../src/segment-composite.js';

globalThis.fetch = () => { throw new Error('Network is forbidden in segment push tests'); };
const { handleSegmentPush, getSegmentPushDashboard } = await import('../src/segment-push.js');
const uid = n => 'U' + n.toString(16).padStart(32, '0');
const hasStatus = status => error => error?.status === status;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fixture({ transport, buildMessages } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contract_end TEXT,contract_terminated_at TEXT,contact_line_user_id TEXT,submitted_by_line_user_id TEXT);
    CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id));`);
  sqlite.exec(`CREATE TABLE line_user_profiles(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,status_message TEXT,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,member_type TEXT,status TEXT,employee_no TEXT,phone TEXT,email TEXT,language TEXT,bind_status TEXT,verified_at TEXT,tags TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE line_threads(id TEXT PRIMARY KEY,source_user_id TEXT,display_name TEXT,picture_url TEXT,summary TEXT,tags TEXT,last_message_at TEXT,updated_at TEXT,created_at TEXT);
    CREATE TABLE line_webhook_events(id TEXT PRIMARY KEY,line_user_id TEXT,message_text TEXT,sentiment_type TEXT,created_at TEXT);
    CREATE TABLE unrelated_records(id TEXT PRIMARY KEY,value TEXT);
    INSERT INTO unrelated_records VALUES('sentinel','unchanged');`);
  for (const migration of ['0012_line_segment_push.sql','0035_employee_roster.sql','0037_segment_push_safety.sql','0039_segment_push_schedules.sql']) sqlite.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  const member = sqlite.prepare(`INSERT INTO welfare_members(line_user_id,display_name,picture_url,member_type,status,employee_no,phone,email,language,bind_status,verified_at,tags,created_at,updated_at) VALUES(?,?,'',?,'active',?,'','','zh-TW','bound','2026-10-20 12:00:00',?,'2026-01-01','2026-01-02')`);
  const roster = sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name) VALUES(?,?,?,?,?,?)');
  for (const [n,type,factory,tags] of [[1,'employee','烏日二廠','A,B'],[2,'foreign_employee','烏日二廠','B'],[3,'manager','神岡廠','A']]) {
    const code=String(n).padStart(4,'0');member.run(uid(n),'合成會員'+n,type,code,tags);roster.run(code,'合成員工'+n,factory,'製造處','D01','製造課');
  }
  let clock=Date.UTC(2026,9,29,1,0,0), hook=null, buildCalls=0;
  const queries=[], calls=[], background=[];
  const db={prepare(sql){let values=[];const execute=()=>{queries.push({sql,values:[...values]});hook?.(sql,values);const result=sqlite.prepare(sql).run(...values);return{success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};};return{
    bind(...args){values=args;return this;},
    async all(){queries.push({sql,values:[...values]});hook?.(sql,values);return{success:true,results:sqlite.prepare(sql).all(...values)};},
    async first(column){queries.push({sql,values:[...values]});hook?.(sql,values);const row=sqlite.prepare(sql).get(...values)||null;return column?row?.[column]??null:row;},
    async run(){return execute();},_run:execute};},
    async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement._run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
  };
  const deps={actor:'synthetic-admin',now:()=>clock,waitUntil:promise=>background.push(promise),
    buildMessages:async(db,input)=>{buildCalls++;if(buildMessages)return buildMessages(db,input);if(typeof input?.text!=='string'||!input.text.trim())throw new Error('Synthetic content is required');return[{type:'text',text:input.text.trim()}];},
    transport:async(lineUserId,messages,retryKey,timeout)=>{calls.push({lineUserId,messages:structuredClone(messages),retryKey,timeout});return transport?transport(lineUserId,messages,retryKey,timeout):{ok:true,status:200,acceptedRequestId:'synthetic-accepted'};}
  };
  const request=body=>new Request('https://synthetic.invalid/admin-api/line-segment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const call=(body,extra={})=>handleSegmentPush(request(body),db,{}, {...deps,...extra});
  const preview=(filters={},extra={})=>call({action:'preview',title:'合成隔離推播',message:{mode:'official_text',text:'僅限合成 transport'},filters:{selectedLineUserIds:[uid(1)],maxRecipients:200,...filters},...extra});
  const sendBody=preview=>({action:'send',preview_id:preview.data.preview_id,preview_revision:preview.data.preview_revision,request_id:preview.data.request_id,confirmed:true});
  const count=table=>sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  return{sqlite,db,deps,calls,queries,background,call,request,preview,sendBody,count,
    set now(value){clock=value;},get now(){return clock;},set hook(value){hook=value;},get buildCalls(){return buildCalls;},
    async close(){await Promise.allSettled(background);sqlite.close();}};
}

test('dashboard and audience action are read-only and expose roster organization plus complete match count',async()=>{
  const f=fixture();try{
    const before=f.sqlite.prepare('SELECT total_changes() n').get().n;f.sqlite.exec('PRAGMA query_only=ON');
    const dashboard=await getSegmentPushDashboard(f.db,{listTemplates:async()=>[{id:'synthetic-template',name:'合成版型'}]});
    assert.equal(dashboard.data.summary.pushableUsers,3);assert.equal(dashboard.data.templates.length,1);
    assert.deepEqual(dashboard.data.options.factories.map(option=>option.value).sort(),['烏日二廠','神岡廠'].sort());
    const audience=await f.call({action:'audience',filters:{memberType:'employee',maxRecipients:1}});
    assert.equal(audience.data.matchedCount,3);assert.equal(audience.data.recipients.length,1);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.calls.length,0);assert.equal(f.buildCalls,0);
  }finally{await f.close();}
});

test('preview records an actor-owned fixed recipient/message snapshot without campaigns or transports',async()=>{
  const f=fixture();try{
    const preview=await f.preview({factory:'烏日二廠',businessUnit:'製造處',selectedLineUserIds:[uid(2),uid(1),uid(1)]});
    const data=preview.data;assert.equal(preview.success,true);assert.equal(data.recipientCount,2);
    assert.deepEqual(data.recipients.map(row=>row.line_user_id),[uid(1),uid(2)]);
    assert.match(data.preview_id,UUID);assert.match(data.request_id,UUID);assert.match(data.preview_revision,/^[0-9a-f]{64}$/);assert.equal(data.expires_at,f.now+600000);
    assert.equal(f.count('welfare_push_previews'),1);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.count('welfare_push_deliveries'),0);assert.equal(f.calls.length,0);
    const saved=f.sqlite.prepare('SELECT * FROM welfare_push_previews').get(),rows=JSON.parse(saved.recipients_json);
    assert.equal(saved.actor,'synthetic-admin');assert.deepEqual(JSON.parse(saved.message_json),[{type:'text',text:'僅限合成 transport'}]);
    assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.retry_key)).size,2);
    for(const row of rows){assert.match(row.retry_key,UUID);assert.equal(typeof row.guard,'string');}
  }finally{await f.close();}
});

test('multi-factory preview locks the selected owners and rejects later organization drift',async()=>{
  const f=fixture();try{
    const filters={factories:['神岡廠','烏日二廠'],selectedLineUserIds:[uid(1),uid(3)]};
    const preview=await f.preview(filters);
    assert.deepEqual(preview.data.recipients.map(row=>row.line_user_id),[uid(1),uid(3)]);
    const saved=JSON.parse(f.sqlite.prepare('SELECT filters_json FROM welfare_push_previews').get().filters_json);
    assert.deepEqual(saved.factories,['烏日二廠','神岡廠'].sort());
    assert.equal(f.calls.length,0);
    await assert.rejects(f.call({...f.sendBody(preview),filters:{...saved,factories:['烏日二廠']}}),hasStatus(400));
    f.sqlite.prepare('UPDATE employee_roster SET factory=? WHERE employee_no=?').run('烏日二廠','0003');
    await assert.rejects(f.call(f.sendBody(preview)),hasStatus(409));
    assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('composite text and image are locked in one preview and sent once per recipient',async()=>{
  const f=fixture({buildMessages:async(_db,input)=>buildCompositeMessages(input)});try{
    const message={mode:'official_composite',text:'合成文字',originalContentUrl:'https://media.example.test/photo.jpg',previewImageUrl:'https://media.example.test/thumb.jpg'};
    const expected=[{type:'text',text:'合成文字'},{type:'image',originalContentUrl:message.originalContentUrl,previewImageUrl:message.previewImageUrl}];
    const preview=await f.call({action:'preview',title:'合成隔離推播',message,filters:{selectedLineUserIds:[uid(1),uid(2)],maxRecipients:200}});
    assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT message_json FROM welfare_push_previews').get().message_json),expected);
    assert.equal(f.calls.length,0);
    const send=f.sendBody(preview);
    await assert.rejects(f.call({...send,message:{...message,text:'未經預覽的文字'}}),hasStatus(400));
    assert.equal(f.calls.length,0);
    const sent=await f.call(send);assert.equal(sent.success,true);assert.equal(f.calls.length,2);
    for(const call of f.calls)assert.deepEqual(call.messages,expected);
    const replay=await f.call(send);assert.equal(replay.replayed,true);assert.equal(f.calls.length,2);
    assert.equal(f.count('welfare_push_campaigns'),1);assert.equal(f.count('welfare_push_deliveries'),2);
  }finally{await f.close();}
});

test('empty, stale-selected, unknown or excessive audience conditions cannot become a paid preview',async t=>{
  for(const [name,filters,status]of[
    ['empty selection',{selectedLineUserIds:[]},400],
    ['selected outside factory',{factory:'烏日二廠',selectedLineUserIds:[uid(1),uid(3)]},409],
    ['unknown selected UID',{selectedLineUserIds:[uid(999)]},400],
    ['selection exceeds limit',{selectedLineUserIds:[uid(1),uid(2)],maxRecipients:1},400],
    ['unknown condition',{factoryTypo:'烏日二廠'},400]
  ])await t.test(name,async()=>{const f=fixture();try{await assert.rejects(f.preview(filters),hasStatus(status));assert.equal(f.count('welfare_push_previews'),0);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);}finally{await f.close();}});
});

test('invalid content fails before any preview/campaign record or transport',async()=>{
  const f=fixture({buildMessages:async()=>[]});try{await assert.rejects(f.preview(),hasStatus(400));assert.equal(f.count('welfare_push_previews'),0);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);}finally{await f.close();}
});

test('large audiences report the full count while preview enforces the complete selected limit',async()=>{
  const f=fixture();try{
    const insert=f.sqlite.prepare(`INSERT INTO welfare_members(line_user_id,display_name,member_type,status,employee_no,bind_status,verified_at,tags,created_at,updated_at) VALUES(?,?,'employee','active',?,'bound','2026-10-20 12:00:00','','2026-01-01','2026-01-02')`);
    const roster=f.sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name) VALUES(?,?,?,?,?,?)');
    f.sqlite.exec('BEGIN');for(let n=4;n<=501;n++){const code=String(n).padStart(4,'0');insert.run(uid(n),'合成人員'+n,code);roster.run(code,'合成人員'+n,'烏日二廠','製造處','D01','製造課');}f.sqlite.exec('COMMIT');
    const audience=await f.call({action:'audience',filters:{maxRecipients:500}});assert.equal(audience.data.matchedCount,501);assert.equal(audience.data.recipients.length,500);
    await assert.rejects(f.preview({selectedLineUserIds:Array.from({length:201},(_,index)=>uid(index+1)),maxRecipients:200}),hasStatus(400));
    const preview=await f.preview({selectedLineUserIds:Array.from({length:500},(_,index)=>uid(index+1)),maxRecipients:500});assert.equal(preview.data.recipientCount,500);
    const saved=JSON.parse(f.sqlite.prepare('SELECT recipients_json FROM welfare_push_previews').get().recipients_json);assert.equal(saved.length,500);assert.equal(new Set(saved.map(row=>row.retry_key)).size,500);
    await assert.rejects(f.preview({selectedLineUserIds:Array.from({length:501},(_,index)=>uid(index+1)),maxRecipients:500}),hasStatus(400));
    assert.equal(f.calls.length,0);assert.equal(f.count('welfare_push_campaigns'),0);
  }finally{await f.close();}
});

test('large chat metadata is represented by opaque guards in a bounded 500-person preview snapshot',async()=>{
  const f=fixture();try{
    const insert=f.sqlite.prepare(`INSERT INTO welfare_members(line_user_id,display_name,member_type,status,employee_no,bind_status,verified_at,tags,created_at,updated_at) VALUES(?,?,'employee','active',?,'bound','2026-10-20 12:00:00','','2026-01-01','2026-01-02')`);
    const roster=f.sqlite.prepare('INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name) VALUES(?,?,?,?,?,?)');
    const contacts=f.sqlite.prepare('UPDATE welfare_members SET phone=?,email=? WHERE line_user_id=?');
    const thread=f.sqlite.prepare('INSERT INTO line_threads(id,source_user_id,summary,tags,last_message_at) VALUES(?,?,?,?,?)');
    const event=f.sqlite.prepare('INSERT INTO line_webhook_events(id,line_user_id,message_text,sentiment_type,created_at) VALUES(?,?,?,?,?)');
    f.sqlite.exec('BEGIN');
    for(let n=1;n<=500;n++){
      const code=String(n).padStart(4,'0');if(n>3){insert.run(uid(n),'合成人員'+n,code);roster.run(code,'合成人員'+n,'烏日二廠','製造處','D01','製造課');}
      contacts.run('PRIVATE_PHONE_'+n,'PRIVATE_EMAIL_'+n+'@example.invalid',uid(n));
      thread.run('long-thread-'+n,uid(n),'PRIVATE_THREAD_'+n+' '+ '長'.repeat(5000),'A','2026-10-28 12:00:00');
      event.run('long-event-'+n,uid(n),'PRIVATE_CHAT_BODY_'+n+' '+ '長'.repeat(5000),'B','2026-10-29 12:00:00');
    }
    f.sqlite.exec('COMMIT');
    const preview=await f.preview({selectedLineUserIds:Array.from({length:500},(_,index)=>uid(index+1)),maxRecipients:500});assert.equal(preview.data.recipientCount,500);
    const raw=f.sqlite.prepare('SELECT recipients_json FROM welfare_push_previews').get().recipients_json,rows=JSON.parse(raw);assert.equal(rows.length,500);
    for(const row of rows){assert.match(row.guard,/^[0-9a-f]{64}$/);assert.ok(Buffer.byteLength(JSON.stringify(row),'utf8')<512,'snapshot row remains bounded despite long source messages');}
    assert.ok(Buffer.byteLength(raw,'utf8')<250000,'snapshot does not scale with chat-body size');
    for(const marker of['PRIVATE_PHONE_','PRIVATE_EMAIL_','PRIVATE_THREAD_','PRIVATE_CHAT_BODY_','長'.repeat(100)])assert.equal(raw.includes(marker),false,marker.slice(0,30));
    assert.equal(f.calls.length,0);assert.equal(f.count('welfare_push_campaigns'),0);
  }finally{await f.close();}
});

test('send requires explicit confirmation and rejects changed filters, message or title',async t=>{
  for(const patch of[{confirmed:false},{filters:{}},{message:{text:'改寫內容'}},{title:'改寫標題'},{selectedLineUserIds:[uid(2)]}])await t.test(JSON.stringify(patch),async()=>{
    const f=fixture();try{const preview=await f.preview();await assert.rejects(f.call({...f.sendBody(preview),...patch}),hasStatus(400));assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);}finally{await f.close();}
  });
});

test('tampered preview references, missing preview and cross-actor access cannot dispatch',async t=>{
  for(const [name,patch,extra,status]of[
    ['wrong revision',{preview_revision:'0'.repeat(64)},{},409],
    ['wrong preview ID',{preview_id:randomUUID()},{},409],
    ['unknown request ID',{request_id:randomUUID()},{},404],
    ['different actor',{}, {actor:'another-synthetic-admin'},404]
  ])await t.test(name,async()=>{const f=fixture();try{const preview=await f.preview();await assert.rejects(f.call({...f.sendBody(preview),...patch},extra),hasStatus(status));assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);}finally{await f.close();}});
  const f=fixture();try{await assert.rejects(f.call({action:'send',confirmed:true,preview_id:randomUUID(),preview_revision:'0'.repeat(64),request_id:randomUUID()}),hasStatus(404));assert.equal(f.calls.length,0);}finally{await f.close();}
});

test('ten-minute preview TTL expires before a campaign can be claimed',async()=>{
  const f=fixture();try{const preview=await f.preview();f.now=preview.data.expires_at;await assert.rejects(f.call(f.sendBody(preview)),hasStatus(409));assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);}finally{await f.close();}
});

test('employee language previews require the exact verified employee group and recheck language before dispatch',async()=>{
  const f=fixture();try {
    f.sqlite.prepare("UPDATE welfare_members SET language='id' WHERE line_user_id IN (?,?)").run(uid(1),uid(2));
    f.sqlite.prepare("UPDATE welfare_members SET language='th' WHERE line_user_id=?").run(uid(3));
    const idAudience=await f.call({action:'audience',filters:{memberType:'employee_language_id'}});
    const thAudience=await f.call({action:'audience',filters:{memberType:'employee_language_th'}});
    assert.deepEqual(idAudience.data.recipients.map(row=>row.line_user_id),[uid(1),uid(2)]);
    assert.deepEqual(thAudience.data.recipients.map(row=>row.line_user_id),[uid(3)]);
    await assert.rejects(f.preview({memberType:'employee_language_id',selectedLineUserIds:[uid(3)]}),hasStatus(400));
    const stale=await f.preview({memberType:'employee_language_id'});
    f.sqlite.prepare("UPDATE welfare_members SET language='th' WHERE line_user_id=?").run(uid(1));
    await assert.rejects(f.call(f.sendBody(stale)),hasStatus(409));assert.equal(f.calls.length,0);
    f.sqlite.prepare("UPDATE welfare_members SET language='id' WHERE line_user_id=?").run(uid(1));
    const late=await f.preview({memberType:'employee_language_id'});let changed=false;
    f.hook=sql=>{if(!changed&&/INSERT OR IGNORE INTO welfare_push_deliveries/.test(sql)){changed=true;f.sqlite.prepare("UPDATE welfare_members SET language='th' WHERE line_user_id=?").run(uid(1));}};
    const result=await f.call(f.sendBody(late));assert.equal(result.data.notSentCount,1);assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('eligibility, binding, organization and ambiguity drift after preview require a fresh preview',async t=>{
  for(const[name,mutate]of[
    ['inactive',f=>f.sqlite.prepare("UPDATE welfare_members SET status='inactive' WHERE line_user_id=?").run(uid(1))],
    ['unbound',f=>f.sqlite.prepare("UPDATE welfare_members SET bind_status='unbound' WHERE line_user_id=?").run(uid(1))],
    ['factory changed',f=>f.sqlite.prepare("UPDATE employee_roster SET factory='另一廠' WHERE employee_no='0001'").run()],
    ['roster name changed',f=>f.sqlite.prepare("UPDATE employee_roster SET employee_name='異動姓名' WHERE employee_no='0001'").run()],
    ['ambiguous roster',f=>f.sqlite.prepare("INSERT INTO employee_roster(employee_no,employee_name,factory) VALUES(' 0001 ','另一員工','另一廠')").run()],
    ['profile blocked',f=>f.sqlite.prepare("INSERT INTO line_user_profiles(line_user_id,status) VALUES(?,'blocked')").run(uid(1))],
    ['binding confirmation lost',f=>f.sqlite.prepare("UPDATE welfare_members SET verified_at='' WHERE line_user_id=?").run(uid(1))],
    ['member tags changed',f=>f.sqlite.prepare("UPDATE welfare_members SET tags='changed' WHERE line_user_id=?").run(uid(1))],
    ['language changed',f=>f.sqlite.prepare("UPDATE welfare_members SET language='th' WHERE line_user_id=?").run(uid(1))],
    ['latest message changed',f=>f.sqlite.prepare("INSERT INTO line_webhook_events(id,line_user_id,message_text,sentiment_type,created_at) VALUES('changed-event',?,'合成新訊息','new-tag','2026-10-29 12:00:00')").run(uid(1))]
  ])await t.test(name,async()=>{const f=fixture();try{const preview=await f.preview();mutate(f);await assert.rejects(f.call(f.sendBody(preview)),hasStatus(409));assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.calls.length,0);}finally{await f.close();}});
});

test('new matching users after preview do not get added to the selected snapshot',async()=>{
  const f=fixture();try{
    const preview=await f.preview({factory:'烏日二廠'});f.sqlite.prepare("UPDATE employee_roster SET factory='烏日二廠' WHERE employee_no='0003'").run();
    const sent=await f.call(f.sendBody(preview));assert.equal(sent.data.recipientCount,1);assert.deepEqual(f.calls.map(call=>call.lineUserId),[uid(1)]);
  }finally{await f.close();}
});

test('confirmed send uses stored messages and stable per-recipient retry keys, replay never sends again',async()=>{
  const f=fixture();try{
    const preview=await f.preview({selectedLineUserIds:[uid(1),uid(2)]});const saved=JSON.parse(f.sqlite.prepare('SELECT recipients_json FROM welfare_push_previews').get().recipients_json);
    const send=f.sendBody(preview),result=await f.call(send);
    assert.equal(result.data.status,'sent');assert.equal(result.data.recipientCount,2);assert.equal(result.data.successCount,2);assert.equal(result.data.failedCount,0);assert.equal(result.data.unknownCount,0);
    assert.equal(f.calls.length,2);assert.equal(f.buildCalls,1);assert.equal(f.count('welfare_push_campaigns'),1);assert.equal(f.count('welfare_push_deliveries'),2);
    for(const call of f.calls){assert.deepEqual(call.messages,[{type:'text',text:'僅限合成 transport'}]);assert.equal(call.retryKey,saved.find(row=>row.line_user_id===call.lineUserId).retry_key);assert.match(call.retryKey,UUID);assert.ok(call.timeout>0&&call.timeout<=7000);}
    const second=await f.call(send);assert.equal(second.replayed,true);assert.equal(second.data.successCount,2);assert.equal(f.calls.length,2);assert.equal(f.count('welfare_push_campaigns'),1);
    assert.equal(f.sqlite.prepare("SELECT value FROM unrelated_records WHERE id='sentinel'").get().value,'unchanged');
  }finally{await f.close();}
});

test('concurrent identical requests claim exactly one campaign and one transport per UID',async()=>{
  const f=fixture();try{
    const preview=await f.preview({selectedLineUserIds:[uid(1),uid(2)]}),body=f.sendBody(preview);
    const responses=await Promise.all(Array.from({length:12},()=>f.call(body)));
    assert.ok(responses.every(response=>response.success));assert.equal(f.calls.length,2);assert.equal(f.count('welfare_push_campaigns'),1);assert.equal(f.count('welfare_push_deliveries'),2);
    assert.equal(new Set(f.calls.map(call=>call.retryKey)).size,2);
  }finally{await f.close();}
});

test('a duplicate arriving while the first transport is pending reads the same claim',async()=>{
  let release,announce;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>announce=resolve);
  const f=fixture({transport:async()=>{announce();await gate;return{ok:true,status:200};}});let first;
  try{
    const preview=await f.preview(),body=f.sendBody(preview);first=f.call(body);await started;
    const duplicate=await f.call(body);assert.equal(duplicate.replayed,true);assert.equal(duplicate.data.status,'sending');assert.equal(f.calls.length,1);
    release();const done=await first;assert.equal(done.data.status,'sent');assert.equal(f.calls.length,1);
  }finally{release();if(first)await first;await f.close();}
});

test('each UID is rechecked after claim immediately before transport',async()=>{
  const f=fixture();try{
    const preview=await f.preview();let changed=false;
    f.hook=sql=>{if(!changed&&/INSERT OR IGNORE INTO welfare_push_deliveries/.test(sql)){changed=true;f.sqlite.prepare("UPDATE welfare_members SET status='inactive' WHERE line_user_id=?").run(uid(1));}};
    const result=await f.call(f.sendBody(preview));assert.equal(result.data.notSentCount,1);assert.equal(result.data.successCount,0);assert.equal(f.calls.length,0);assert.equal(f.count('welfare_push_campaigns'),1);
  }finally{await f.close();}
});

test('post-claim tag or language drift is checked again before a paid transport',async t=>{
  for(const[name,sql]of[
    ['tags',"UPDATE welfare_members SET tags='changed-tag' WHERE line_user_id=?"],
    ['language',"UPDATE welfare_members SET language='th' WHERE line_user_id=?"],
    ['latest message',"INSERT INTO line_webhook_events(id,line_user_id,message_text,sentiment_type,created_at) VALUES('post-claim-event',?,'合成變更訊息','changed-tag','2026-10-29 12:00:00')"]
  ])await t.test(name,async()=>{const f=fixture();try{
    const preview=await f.preview();let changed=false;f.hook=statement=>{if(!changed&&/INSERT OR IGNORE INTO welfare_push_deliveries/.test(statement)){changed=true;f.sqlite.prepare(sql).run(uid(1));}};
    const result=await f.call(f.sendBody(preview));assert.equal(result.data.notSentCount,1);assert.equal(f.calls.length,0);
  }finally{await f.close();}});
});

test('rejected, ambiguous and duplicate-accepted provider outcomes remain distinct and never auto-resend',async t=>{
  for(const[name,transport,status,accepted,failed,unknown]of[
    ['definite 429',async()=>({ok:false,status:429}),'partial',0,1,0],
    ['provider 500',async()=>({ok:false,status:500}),'needs_review',0,0,1],
    ['transport timeout',async()=>{throw new Error('Synthetic timeout');},'needs_review',0,0,1],
    ['409 with accepted receipt',async()=>({ok:false,status:409,acceptedRequestId:'synthetic-existing-receipt'}),'sent',1,0,0],
    // A retry-key conflict without its receipt cannot prove rejection of the original request.
    ['409 without accepted receipt',async()=>({ok:false,status:409}),'needs_review',0,0,1]
  ])await t.test(name,async()=>{const f=fixture({transport});try{const preview=await f.preview(),body=f.sendBody(preview),result=await f.call(body);assert.equal(result.data.status,status);assert.equal(result.data.successCount,accepted);assert.equal(result.data.failedCount,failed);assert.equal(result.data.unknownCount,unknown);await f.call(body);assert.equal(f.calls.length,1);}finally{await f.close();}});
});

test('partial success and unknown outcomes retain the same result on replay',async()=>{
  const f=fixture({transport:async id=>id===uid(1)?{ok:true,status:200}:{ok:false,status:503}});try{
    const preview=await f.preview({selectedLineUserIds:[uid(1),uid(2)]}),body=f.sendBody(preview),result=await f.call(body);
    assert.equal(result.data.status,'needs_review');assert.equal(result.data.successCount,1);assert.equal(result.data.unknownCount,1);
    const replay=await f.call(body);assert.equal(replay.data.successCount,1);assert.equal(replay.data.unknownCount,1);assert.equal(f.calls.length,2);
  }finally{await f.close();}
});

test('uncertain outcome persistence does not allow another paid attempt',async()=>{
  const f=fixture();try{
    const preview=await f.preview();let injected=false;f.hook=sql=>{if(!injected&&/UPDATE welfare_push_deliveries SET/.test(sql)){injected=true;throw new Error('Synthetic persistence interruption after transport');}};
    const body=f.sendBody(preview),result=await f.call(body);assert.equal(result.data.status,'needs_review');assert.equal(f.calls.length,1);
    assert.equal(result.data.unknownCount,1,'a claimed unresolved delivery must be reported as uncertain');
    await f.call(body);assert.equal(f.calls.length,1);assert.equal(f.count('welfare_push_campaigns'),1);
  }finally{await f.close();}
});

test('status lookup is actor-owned, read-only and exposes stale in-flight work as needs review',async()=>{
  const f=fixture();try{
    const preview=await f.preview();f.sqlite.prepare(`INSERT INTO welfare_push_campaigns(id,title,recipient_count,status,created_at) VALUES(?,?,1,'sending',?)`).run(preview.data.preview_id,'合成隔離推播',new Date(f.now).toISOString().slice(0,19).replace('T',' '));
    f.now+=61000;const before=f.sqlite.prepare('SELECT total_changes() n').get().n;f.sqlite.exec('PRAGMA query_only=ON');
    const result=await f.call({action:'status',request_id:preview.data.request_id});assert.equal(result.data.status,'needs_review');assert.equal(result.data.unknownCount,1);
    await assert.rejects(f.call({action:'status',request_id:preview.data.request_id},{actor:'other-admin'}),hasStatus(404));
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.calls.length,0);
  }finally{await f.close();}
});

test('missing actor and oversized bodies fail before reads, claims or transport',async()=>{
  const f=fixture();try{
    await assert.rejects(f.call({action:'audience',filters:{}},{actor:''}),hasStatus(403));
    const request=new Request('https://synthetic.invalid/admin-api/line-segment-push',{method:'POST',body:'x'.repeat(65001)});
    await assert.rejects(handleSegmentPush(request,f.db,{},f.deps),hasStatus(413));assert.equal(f.calls.length,0);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.count('welfare_push_previews'),0);
  }finally{await f.close();}
});


test('unavailable profile schema blocks preview and blocks existing preview before campaign or transport',async()=>{
  const f=fixture();try{
    const preview=await f.preview();
    f.hook=sql=>{if(sql.includes('pragma_table_info'))throw new Error('Synthetic schema unavailable');};
    await assert.rejects(f.preview(),hasStatus(503));
    await assert.rejects(f.call(f.sendBody(preview)),hasStatus(503));
    assert.equal(f.calls.length,0);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.count('welfare_push_deliveries'),0);
  } finally {await f.close();}
});


test('post-claim profile schema collision blocks provider transport',async()=>{
  const f=fixture();try{
    const preview=await f.preview();let changed=false;
    f.hook=sql=>{if(!changed&&sql.includes('INSERT OR IGNORE INTO welfare_push_campaigns')){changed=true;f.sqlite.exec('ALTER TABLE line_user_profiles ADD COLUMN __PUSH_GUARD_member_uid TEXT');}};
    const result=await f.call(f.sendBody(preview));assert.equal(result.data.status,'partial');
    assert.equal(f.calls.length,0);assert.equal(result.data.notSentCount,1);assert.equal(result.data.unknownCount,0);
  }finally{await f.close();}
});


test('case-variant blocked profile column after preview cannot trigger provider transport',async()=>{
  const f=fixture();try{
    const preview=await f.preview();let changed=false;
    f.hook=sql=>{if(!changed&&sql.includes('INSERT OR IGNORE INTO welfare_push_campaigns')){changed=true;f.sqlite.exec("ALTER TABLE line_user_profiles DROP COLUMN status; ALTER TABLE line_user_profiles ADD COLUMN STATUS TEXT; INSERT INTO line_user_profiles(line_user_id,STATUS) VALUES('U00000000000000000000000000000001','blocked')");}};
    const result=await f.call(f.sendBody(preview));assert.equal(result.data.status,'partial');
    assert.equal(f.calls.length,0);assert.equal(result.data.notSentCount,1);assert.equal(result.data.unknownCount,0);
  }finally{await f.close();}
});
