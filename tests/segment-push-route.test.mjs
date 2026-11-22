import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

let networkCalls=0;
globalThis.fetch=()=>{networkCalls++;throw new Error('No external network is permitted in paid-push route tests');};
const {default:worker}=await import('../src/index.js');
const uid=n=>'U'+n.toString(16).padStart(32,'0');
const endpoint='/admin-api/line-segment-push';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_hidden INTEGER,contract_end TEXT,contract_terminated_at TEXT,contact_line_user_id TEXT,submitted_by_line_user_id TEXT); CREATE TABLE welfare_vendor_line_bindings(vendor_id TEXT,line_user_id TEXT,status TEXT,PRIMARY KEY(vendor_id,line_user_id));`);
  sqlite.exec(`CREATE TABLE admin_users(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,role TEXT,business_units TEXT,active INTEGER,line_user_id TEXT);
    CREATE TABLE admin_sessions(token TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT);
    CREATE TABLE admin_user_permissions(user_id TEXT,business_unit TEXT,review_stage TEXT,active INTEGER);
    CREATE TABLE admin_uid_whitelist(id INTEGER PRIMARY KEY AUTOINCREMENT,line_user_id TEXT UNIQUE,display_name TEXT,role TEXT,allowed_modules TEXT,active INTEGER,note TEXT DEFAULT '',created_at TEXT,updated_at TEXT);
    CREATE TABLE line_user_profiles(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,status_message TEXT,status TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,display_name TEXT,picture_url TEXT,member_type TEXT,status TEXT,employee_no TEXT,phone TEXT,email TEXT,language TEXT,bind_status TEXT,verified_at TEXT,tags TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE line_threads(id TEXT PRIMARY KEY,source_user_id TEXT,display_name TEXT,picture_url TEXT,summary TEXT,tags TEXT,last_message_at TEXT,updated_at TEXT,created_at TEXT);
    CREATE TABLE line_webhook_events(id TEXT PRIMARY KEY,line_user_id TEXT,message_text TEXT,sentiment_type TEXT,created_at TEXT);
    CREATE TABLE welfare_flex_templates(id TEXT PRIMARY KEY,keyword TEXT,name TEXT,note TEXT,reply_type TEXT,active INTEGER,category TEXT,payload_json TEXT,usage_count INTEGER,last_pushed_at TEXT,created_at TEXT,updated_at TEXT,status TEXT);
    CREATE TABLE unrelated_records(id TEXT PRIMARY KEY,value TEXT);
    INSERT INTO unrelated_records VALUES('sentinel','unchanged');`);
  for(const migration of['0012_line_segment_push.sql','0035_employee_roster.sql','0037_segment_push_safety.sql','0039_segment_push_schedules.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
  const addActor=(name,{role='admin',modules='line-push',whitelistModules=modules,active=1,lineUid=uid(100+sqlite.prepare('SELECT COUNT(*) n FROM admin_users').get().n),expires='2099-01-01T00:00:00.000Z',whitelistRole=role}={})=>{
    sqlite.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?,?,?)').run(name,name,name,role,modules,active,lineUid);
    sqlite.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run('session-'+name,name,expires);
    if(lineUid)sqlite.prepare('INSERT INTO admin_uid_whitelist(line_user_id,display_name,role,allowed_modules,active) VALUES(?,?,?,?,1)').run(lineUid,name,whitelistRole,whitelistModules);
    return lineUid;
  };
  addActor('owner');addActor('other-owner');addActor('viewer',{role:'viewer'});addActor('activity-editor',{role:'activity_editor',modules:'activities'});
  addActor('expired',{expires:'2000-01-01T00:00:00.000Z'});addActor('inactive',{active:0});
  addActor('wrong-module',{modules:'activities'});addActor('empty-whitelist-module',{modules:'*',whitelistModules:''});
  addActor('password-empty-module',{lineUid:'',modules:''});addActor('password-wrong-module',{lineUid:'',modules:'activities'});addActor('password-allowed',{lineUid:'',modules:'line-push'});
  addActor('whitelist-viewer',{role:'admin',whitelistRole:'viewer'});
  sqlite.prepare(`INSERT INTO welfare_members(line_user_id,display_name,picture_url,member_type,status,employee_no,phone,email,language,bind_status,verified_at,tags,created_at,updated_at) VALUES(?,'合成人員','','employee','active','0001','','','zh-TW','bound','2026-10-20 12:00:00','A','2026-01-01','2026-01-02')`).run(uid(1));
  sqlite.prepare("INSERT INTO employee_roster(employee_no,employee_name,factory,business_unit,department_code,department_name) VALUES('0001','合成員工','烏日二廠','製造處','D01','製造課')").run();
  const queries=[];
  const db={prepare(sql){let values=[];const run=()=>{queries.push({sql,values});const result=sqlite.prepare(sql).run(...values);return{success:true,meta:{changes:Number(result.changes)}};};return{
    bind(...args){values=args;return this;},async all(){queries.push({sql,values});return{success:true,results:sqlite.prepare(sql).all(...values)};},
    async first(column){queries.push({sql,values});const row=sqlite.prepare(sql).get(...values)||null;return column?row?.[column]??null:row;},async run(){return run();},_run:run};},
    async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(statement=>statement._run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}
  };
  const request=(actor='owner',body,headers={},method)=>new Request('https://paid-push.test'+endpoint,{method:method||(body?'POST':'GET'),headers:{...(actor?{Authorization:'Bearer session-'+actor}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const call=(actor,body,headers,method)=>worker.fetch(request(actor,body,headers,method),{DB:db},{waitUntil(){throw new Error('These route tests never dispatch');}});
  const count=table=>sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  return{sqlite,db,queries,addActor,request,call,count,close:()=>sqlite.close()};
}

test('paid-push Worker route denies anonymous, forged, expired, inactive and non-admin identities without data writes',async t=>{
  for(const actor of['','forged','expired','inactive','viewer','activity-editor','whitelist-viewer'])await t.test(actor||'anonymous',async()=>{
    const f=fixture();try{
      const before=f.sqlite.prepare('SELECT total_changes() n').get().n;f.sqlite.exec('PRAGMA query_only=ON');
      for(const body of[undefined,{action:'audience',filters:{}},{action:'preview',title:'合成推播',filters:{selectedLineUserIds:[uid(1)]},message:{mode:'official_text',text:'合成內容'}},{action:'send',confirmed:true,request_id:'not-a-real-operation'}]){
        const response=await f.call(actor,body);assert.equal(response.status,403,actor+' '+JSON.stringify(body));const data=await response.json();assert.equal(data.success,false);assert.equal(data.data?.users,undefined);
      }
      assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.count('welfare_push_previews'),0);assert.equal(f.count('welfare_push_campaigns'),0);
    }finally{f.close();}
  });
  assert.equal(networkCalls,0);
});

test('paid-push module access rejects empty/other whitelist modules and cannot fall back to broad session scope',async t=>{
  for(const actor of['wrong-module','empty-whitelist-module','password-empty-module','password-wrong-module'])await t.test(actor,async()=>{
    const f=fixture();try{for(const body of[undefined,{action:'audience',filters:{}}])assert.equal((await f.call(actor,body)).status,403);assert.equal(f.count('welfare_push_previews'),0);}finally{f.close();}
  });
  const f=fixture();try{assert.equal((await f.call('password-allowed',{action:'audience',filters:{}})).status,200);}finally{f.close();}
  assert.equal(networkCalls,0);
});

test('foreign Origin and cross-site metadata are rejected even with a valid owner session',async()=>{
  const f=fixture();try{
    const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
    for(const headers of[{Origin:'https://foreign.invalid'},{'Sec-Fetch-Site':'cross-site'}]){
      assert.equal((await f.call('owner',undefined,headers)).status,403);
      assert.equal((await f.call('owner',{action:'audience',filters:{}},headers)).status,403);
    }
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(networkCalls,0);
  }finally{f.close();}
});

test('authorized owner GET and audience POST share true server filtering and do not mutate member/business records',async()=>{
  const f=fixture();try{
    const before=f.sqlite.prepare('SELECT total_changes() n').get().n;f.sqlite.exec('PRAGMA query_only=ON');
    const dashboard=await f.call('owner');assert.equal(dashboard.status,200);assert.equal(dashboard.headers.get('Cache-Control'),'no-store');
    const data=(await dashboard.json()).data;assert.equal(data.summary.pushableUsers,1);assert.equal(data.users[0].factory,'烏日二廠');
    const matching=await(await f.call('owner',{action:'audience',filters:{factory:'烏日二廠',businessUnit:'製造處'}})).json();assert.equal(matching.success,true);assert.equal(matching.data.matchedCount,1);
    const other=await(await f.call('owner',{action:'audience',filters:{factory:'神岡廠'}})).json();assert.equal(other.data.matchedCount,0);assert.deepEqual(other.data.recipients,[]);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.count('welfare_push_deliveries'),0);assert.equal(networkCalls,0);
  }finally{f.close();}
});

test('the actual Worker builds a private preview using the original message builder and guards its status by actor',async()=>{
  const f=fixture();try{
    const response=await f.call('owner',{action:'preview',title:'合成隔離付費推播',filters:{factory:'烏日二廠',memberType:'employee',selectedLineUserIds:[uid(1)]},message:{mode:'official_text',text:'合成內容，不送真實訊息'}});
    assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.success,true);assert.equal(preview.data.recipientCount,1);
    const row=f.sqlite.prepare('SELECT actor,message_json FROM welfare_push_previews').get();assert.equal(row.actor,'admin:owner');assert.deepEqual(JSON.parse(row.message_json),[{type:'text',text:'合成內容，不送真實訊息'}]);
    assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.count('welfare_push_deliveries'),0);
    const before=f.sqlite.prepare('SELECT total_changes() n').get().n;f.sqlite.exec('PRAGMA query_only=ON');
    assert.equal((await f.call('owner',{action:'status',request_id:preview.data.request_id})).status,200);
    assert.equal((await f.call('other-owner',{action:'status',request_id:preview.data.request_id})).status,404);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(networkCalls,0);
  }finally{f.close();}
});

test('actual Worker limits image upload to paid-push admins and exposes only the intended public asset',async()=>{
  const f=fixture(), objects=new Map(), reads=[];
  const bucket={async put(key,bytes,options){objects.set(key,{bytes:new Uint8Array(bytes),options});},async get(key){reads.push(key);const value=objects.get(key);return value?{body:value.bytes,httpEtag:'"fixture"',writeHttpMetadata(headers){headers.set('Content-Type',value.options.httpMetadata.contentType);}}:null;}};
  const env={DB:f.db,R2_BUCKET:bucket},ctx={waitUntil(){throw new Error('upload must not start work');}};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const upload=(actor,extra={})=>{const form=new FormData();form.set('file',new File([png],'fixture.png',{type:'image/png'}));return new Request('https://paid-push.test/admin-api/segment-push-image',{method:'POST',headers:{...(actor?{Authorization:'Bearer session-'+actor}:{}),Origin:'https://paid-push.test',...extra},body:form});};
  try{
    const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
    for(const actor of ['', 'forged','expired','inactive','viewer','activity-editor','whitelist-viewer','wrong-module','empty-whitelist-module','password-empty-module','password-wrong-module']){
      const response=await worker.fetch(upload(actor),env,ctx);assert.equal(response.status,403,actor||'anonymous');assert.equal(objects.size,0);
    }
    for(const headers of [{Origin:'https://foreign.invalid'},{'Sec-Fetch-Site':'cross-site'}]){
      const response=await worker.fetch(upload('owner',headers),env,ctx);assert.equal(response.status,403);assert.equal(objects.size,0);
    }
    const response=await worker.fetch(upload('owner'),env,ctx);assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.success,true);assert.match(result.originalContentUrl,/^https:\/\/paid-push\.test\/push-image\/[0-9a-f-]{36}\.png$/);
    assert.equal(result.originalContentUrl,result.previewImageUrl);assert.equal(objects.size,1);
    const image=await worker.fetch(new Request(result.originalContentUrl),env,ctx);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
    const head=await worker.fetch(new Request(result.originalContentUrl,{method:'HEAD'}),env,ctx);assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
    for(const path of ['/file/club_private_media_foo','/file/activity_story_private_foo','/file/vendor_public_document_foo','/push-image/club_private_media_foo.png']){
      const n=reads.length;assert.equal((await worker.fetch(new Request('https://paid-push.test'+path),env,ctx)).status,404,path);assert.equal(reads.length,n,path);
    }
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
    assert.equal(f.count('welfare_push_previews'),0);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(networkCalls,0);
  }finally{f.close();}
});

test('actual Worker locks composite text/image in preview and mock LINE sees one request per recipient',async()=>{
  const f=fixture(),calls=[],background=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.line.me/v2/bot/message/push');const body=JSON.parse(init.body);calls.push({body,retry:init.headers['X-Line-Retry-Key']});return new Response('{}',{status:200,headers:{'x-line-request-id':'synthetic-receipt'}});};
  const env={DB:f.db,LINE_CHANNEL_ACCESS_TOKEN:'synthetic-never-real'},ctx={waitUntil(p){background.push(p);}};
  const call=(body)=>worker.fetch(f.request('owner',body),env,ctx);
  try{
    const message={mode:'official_composite',text:'合成文字',originalContentUrl:'https://paid-push.test/push-image/00000000-0000-4000-8000-000000000001.png',previewImageUrl:'https://paid-push.test/push-image/00000000-0000-4000-8000-000000000001.png'};
    const previewResponse=await call({action:'preview',title:'隔離合成推播',filters:{factory:'烏日二廠',memberType:'employee',selectedLineUserIds:[uid(1)],maxRecipients:200},message});
    assert.equal(previewResponse.status,200);const preview=(await previewResponse.json()).data;
    const expected=[{type:'text',text:'合成文字'},{type:'image',originalContentUrl:message.originalContentUrl,previewImageUrl:message.previewImageUrl}];
    assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT message_json FROM welfare_push_previews').get().message_json),expected);assert.equal(calls.length,0);
    const send={action:'send',preview_id:preview.preview_id,preview_revision:preview.preview_revision,request_id:preview.request_id,confirmed:true};
    assert.equal((await call({...send,message:{...message,text:'未預覽內容'}})).status,400);assert.equal(calls.length,0);
    const response=await call(send);assert.equal(response.status,200);assert.equal((await response.json()).success,true);assert.equal(calls.length,1);assert.deepEqual(calls[0].body.messages,expected);
    const replay=await call(send);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);assert.equal(calls.length,1);
    assert.equal(f.count('welfare_push_campaigns'),1);assert.equal(f.count('welfare_push_deliveries'),1);
  }finally{await Promise.allSettled(background);globalThis.fetch=originalFetch;f.close();}
});

test('existing owner sessions lose paid-push access immediately after whitelist revoke, delete or scope change',async t=>{
  for(const[name,sql]of[
    ['disabled',"UPDATE admin_uid_whitelist SET active=0 WHERE display_name='owner'"],
    ['deleted',"DELETE FROM admin_uid_whitelist WHERE display_name='owner'"],
    ['scope removed',"UPDATE admin_uid_whitelist SET allowed_modules='activities' WHERE display_name='owner'"],
    ['scope emptied',"UPDATE admin_uid_whitelist SET allowed_modules='' WHERE display_name='owner'"],
    ['role downgraded',"UPDATE admin_uid_whitelist SET role='viewer' WHERE display_name='owner'"]
  ])await t.test(name,async()=>{const f=fixture();try{
    assert.equal((await f.call('owner',{action:'audience',filters:{}})).status,200);f.sqlite.exec(sql);
    assert.equal((await f.call('owner',{action:'audience',filters:{}})).status,403);assert.equal(f.count('welfare_push_previews'),0);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(networkCalls,0);
  }finally{f.close();}});
});

test('unsupported methods remain protected and valid owner requests receive 405 without mutations',async()=>{
  const f=fixture();try{const before=f.sqlite.prepare('SELECT total_changes() n').get().n;assert.equal((await f.call('',undefined,{},'PUT')).status,403);assert.equal((await f.call('owner',undefined,{},'PUT')).status,405);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(networkCalls,0);}finally{f.close();}
});


test('dashboard supports both template schemas without inventing approval or altering records',async t=>{
 for(const statusColumn of [false,true])await t.test(statusColumn?'status present':'deployed schema: no status',async()=>{
  const f=fixture();try{
   if(!statusColumn)f.sqlite.exec('ALTER TABLE welfare_flex_templates DROP COLUMN status');
   const columns=['id','keyword','name','note','reply_type','active','category','payload_json','usage_count','last_pushed_at','created_at','updated_at',...(statusColumn?['status']:[])];
   const insert=f.sqlite.prepare(`INSERT INTO welfare_flex_templates(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
   for(const [id,category,active,updated,statusValue] of [['new','normal',0,'2026-10-30','rejected'],['pending','normal',1,'2026-10-29','pending'],['approved','normal',1,'2026-10-28','approved'],['private','share_draft',1,'2026-10-31','approved']]){
    const values=[id,'k',id,'','TEXT',active,category,'{}',0,'','2026-01-01',updated,...(statusColumn?[statusValue]:[])];insert.run(...values);
   }
   const before=f.sqlite.prepare('SELECT total_changes() n').get().n;f.sqlite.exec('PRAGMA query_only=ON');
   const response=await f.call('owner');assert.equal(response.status,200);const payload=await response.json();const rows=payload.data.templates;
   assert.deepEqual(rows.map(row=>row.id),statusColumn?['approved','pending','new']:['new','pending','approved']);
   assert.equal(rows.find(row=>row.id==='new').active,false);assert.ok(rows.every(row=>!Object.hasOwn(row,'status')));
   assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(f.count('welfare_push_deliveries'),0);assert.equal(networkCalls,0);
  }finally{f.close();}
 });
});

test('dashboard fails closed for ambiguous status casing or missing required template column',async t=>{
 for(const sql of ['ALTER TABLE welfare_flex_templates DROP COLUMN status; ALTER TABLE welfare_flex_templates ADD COLUMN STATUS TEXT','ALTER TABLE welfare_flex_templates DROP COLUMN category']) await t.test(sql,async()=>{
  const f=fixture();try{f.sqlite.exec(sql);const before=f.sqlite.prepare('SELECT total_changes() n').get().n;const response=await f.call('owner');assert.equal(response.status,503);assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.count('welfare_push_campaigns'),0);assert.equal(networkCalls,0);}finally{f.close();}
 });
});
