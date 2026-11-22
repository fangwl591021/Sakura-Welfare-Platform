import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requestVendorSupplement,projectVendorSupplement,projectVendorSupplementDashboard,projectVendorSupplementApplication,recordVerifiedVendorNotificationIdentity,hasVerifiedVendorNotificationIdentity,readVendorSupplement,closeVendorSupplement,hasVendorSupplement,changeVendorSupplementReviewStatus,buildVendorSupplementFlex,VENDOR_SUPPLEMENT_SAVE_GUARD,commitVendorSupplementResubmission,validateVendorSupplementSubmission,authorizeVendorSupplementAdmin } from '../src/vendor-supplement-service.js';

const migration=readFileSync(new URL('../migrations/0042_vendor_supplements.sql',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const UID='U'+'1'.repeat(32),OTHER='U'+'2'.repeat(32),origin='https://supplement.test';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE welfare_vendors(id TEXT PRIMARY KEY,name TEXT,status TEXT CHECK(status IN ('pending','approved','rejected','suspended')),is_hidden INTEGER DEFAULT 0,submitted_by_line_user_id TEXT,contact_line_user_id TEXT,vendor_portal_username TEXT,vendor_portal_password TEXT,review_note TEXT,reviewed_by TEXT,reviewed_at TEXT,updated_at TEXT);
    CREATE TABLE retained_documents(id TEXT PRIMARY KEY,vendor_id TEXT REFERENCES welfare_vendors(id),body TEXT);
    INSERT INTO welfare_vendors VALUES('v','測試店家','pending',0,'${UID}','${OTHER}','store','secret','舊說明','old','','version-1');
    INSERT INTO retained_documents VALUES('old-doc','v','保留原始文件');`);
  const writer=source.match(/async function saveWelfareVendor\([^]*?\n\}/)[0];
  const columns=writer.match(/INSERT INTO welfare_vendors \(([^]*?)\) /)[1].split(',').map(v=>v.trim());
  const existing=new Set(sqlite.prepare('PRAGMA table_info(welfare_vendors)').all().map(v=>v.name));
  for(const column of columns)if(!existing.has(column))sqlite.exec(`ALTER TABLE welfare_vendors ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  const before={schema:sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='welfare_vendors'").get().sql,rows:sqlite.prepare('SELECT * FROM welfare_vendors').all(),documents:sqlite.prepare('SELECT * FROM retained_documents').all()};
  sqlite.exec(migration);
  const controls={abortSql:'',failReceipt:false},queries=[],sends=[];
  const db={prepare(sql){queries.push(sql);let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){if(controls.abortSql&&sql.includes(controls.abortSql))throw new Error('synthetic DB failure');if(controls.failReceipt&&sql.includes('provider_request_id=?'))throw new Error('synthetic receipt persistence failure');const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const transport=async request=>{sends.push(request);return {ok:true,status:200,requestId:'mock-request'};};
  const row=()=>sqlite.prepare("SELECT * FROM welfare_vendors WHERE id='v'").get();
  const data=(overrides={})=>({id:'v',status:'needs_supplement',review_note:'請提供有效證明',supplement_items:['營業登記','保險證明'],request_id:crypto.randomUUID(),expected_updated_at:row().updated_at,reviewed_by:'FORGED_ACTOR',...overrides});
  const run=(payload=data(),options={})=>requestVendorSupplement(db,{},payload,{actor:'real-admin',origin,transport,...options});
  return {sqlite,db,before,controls,queries,sends,transport,row,data,run,close(){sqlite.close();}};
}

test('additive migration preserves original vendor CHECK, rows, FK children and reapplication',()=>{
  const f=fixture();try{f.sqlite.exec(migration);assert.equal(f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='welfare_vendors'").get().sql,f.before.schema);assert.deepEqual(f.sqlite.prepare('SELECT * FROM welfare_vendors').all(),f.before.rows);assert.deepEqual(f.sqlite.prepare('SELECT * FROM retained_documents').all(),f.before.documents);assert.throws(()=>f.sqlite.exec("UPDATE welfare_vendors SET status='needs_supplement'"),/CHECK/);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);}finally{f.close();}
});

test('explicit admin verification saves one applicant, dynamic Flex and fixed receipt; contact is not sent',async()=>{
  const f=fixture();try{const result=await f.run(f.data({confirm_applicant_identity:true}));assert.equal(result.success,true);assert.equal(result.data.notification.state,'accepted');assert.match(result.data.notification.message,/不代表/);assert.equal(f.row().status,'rejected');assert.equal(result.data.vendor.status,'needs_supplement');assert.equal(f.row().reviewed_by,'real-admin');assert.equal(f.sends.length,1);const sent=f.sends[0];assert.equal(sent.to,UID);assert.notEqual(sent.to,OTHER);assert.match(sent.retryKey,/^[0-9a-f-]{36}$/);assert.equal(sent.messages[0].type,'flex');assert.match(sent.messages[0].altText,/2 項/);const bubble=sent.messages[0].contents;assert.equal(bubble.footer.contents[0].action.uri,origin+'/vendor-login?next=supplement');assert.equal(bubble.footer.contents[0].action.label,'立即補件');assert.match(JSON.stringify(bubble),/營業登記/);assert.match(JSON.stringify(bubble),/請提供有效證明/);assert.ok(new TextEncoder().encode(JSON.stringify(bubble)).length<30000);assert.equal(result.data.vendor.supplement.applicant.contactDifferent,true);assert.equal(result.data.vendor.supplement.applicant.verified,true);assert.equal(await hasVerifiedVendorNotificationIdentity(f.db,'v',UID),true);assert.equal(f.sqlite.prepare('SELECT verified_by FROM welfare_vendor_notification_identities').get().verified_by,'real-admin');}finally{f.close();}
});

test('unverified or missing applicant never falls back to contact or sends',async()=>{
  for(const uid of [UID,'','phone-number']){const f=fixture();try{f.sqlite.prepare('UPDATE welfare_vendors SET submitted_by_line_user_id=?').run(uid);const result=await f.run();assert.equal(result.success,true);assert.equal(result.data.notification.state,uid===UID?'skipped_unverified':'skipped_missing_recipient');assert.equal(f.sends.length,0);assert.equal(f.row().status,'rejected');}finally{f.close();}}
});

test('verified proof is exact to current applicant; changed UID invalidates it',async()=>{
  const f=fixture();try{assert.equal(await recordVerifiedVendorNotificationIdentity(f.db,'v',UID,{verified:false,source:'line_verified_application'}),false);assert.equal(await recordVerifiedVendorNotificationIdentity(f.db,'v',OTHER,{verified:true,source:'line_verified_application'}),false);assert.equal(await recordVerifiedVendorNotificationIdentity(f.db,'v',UID,{verified:true,source:'line_verified_application'}),true);assert.equal(await hasVerifiedVendorNotificationIdentity(f.db,'v',UID),true);f.sqlite.prepare('UPDATE welfare_vendors SET submitted_by_line_user_id=?').run(OTHER);assert.equal(await hasVerifiedVendorNotificationIdentity(f.db,'v',UID),false);const result=await f.run();assert.equal(result.data.notification.state,'skipped_unverified');assert.equal(f.sends.length,0);}finally{f.close();}
});

test('trusted proof supports sends without a newly checked manual confirmation',async()=>{
  const f=fixture();try{await recordVerifiedVendorNotificationIdentity(f.db,'v',UID,{verified:true,source:'line_verified_portal_login',actor:UID});const result=await f.run();assert.equal(result.data.notification.state,'accepted');assert.equal(f.sends.length,1);}finally{f.close();}
});

test('same request replay reads original result and altered payload or same requirement cannot send twice',async()=>{
  const f=fixture();try{const payload=f.data({confirm_applicant_identity:true}),first=await f.run(payload),again=await f.run(payload);assert.equal(again.replayed,true);assert.equal(again.data.request_id,first.data.request_id);assert.equal(f.sends.length,1);assert.equal((await f.run({...payload,review_note:'different'})).success,false);assert.equal((await f.run(f.data({confirm_applicant_identity:true}))).success,false);assert.equal(f.sends.length,1);}finally{f.close();}
});

test('invalid request, limits, stale version, hidden and approved vendors cause no writes or sends',async()=>{
  const variants=[{review_note:''},{review_note:'a'.repeat(2001)},{review_note:'bad\u0000'},{supplement_items:[]},{supplement_items:['x'.repeat(201)]},{supplement_items:Array(21).fill('x')},{request_id:'bad'},{expected_updated_at:'old'}];
  for(const variant of variants){const f=fixture();try{assert.equal((await f.run(f.data({...variant,confirm_applicant_identity:true}))).success,false);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendor_review_events').get().n,0);assert.equal(f.sends.length,0);}finally{f.close();}}
  for(const sql of ["UPDATE welfare_vendors SET is_hidden=1","UPDATE welfare_vendors SET status='approved'"]){const f=fixture();try{f.sqlite.exec(sql);assert.equal((await f.run()).success,false);assert.equal(f.sends.length,0);}finally{f.close();}}
});

test('atomic D1 batch rolls back vendor, event, supplement and manual proof on partial write failure',async()=>{
  const f=fixture();try{f.controls.abortSql='INSERT INTO welfare_vendor_supplements';await assert.rejects(f.run(f.data({confirm_applicant_identity:true})),/synthetic/);assert.deepEqual(f.sqlite.prepare('SELECT * FROM welfare_vendors').all(),f.before.rows);for(const table of ['welfare_vendor_review_events','welfare_vendor_supplements','welfare_vendor_notification_identities'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(f.sends.length,0);}finally{f.close();}
});

test('unknown transport result and lost receipt persist uncertainty and never auto resend',async()=>{
  for(const receipt of [false,true]){const f=fixture();try{f.controls.failReceipt=receipt;const payload=f.data({confirm_applicant_identity:true});let calls=0;const transport=async request=>{calls++;if(!receipt)throw new Error('uncertain provider timeout');return {ok:true,status:200};};const result=await f.run(payload,{transport});assert.equal(result.data.notification.state,'unknown');const replay=await f.run(payload,{transport});assert.equal(replay.data.notification.state,'unknown');assert.equal(calls,1);}finally{f.close();}}
});

test('provider 4xx is failed, 409 with accepted request id is accepted; both results retained',async()=>{
  for(const [status,accepted,state] of [[400,'','failed'],[409,'original-provider-id','accepted'],[409,'','unknown'],[503,'','unknown']]){const f=fixture();try{const result=await f.run(f.data({confirm_applicant_identity:true}),{transport:async()=>({ok:false,status,acceptedRequestId:accepted})});assert.equal(result.data.notification.state,state);assert.equal(f.sqlite.prepare('SELECT response_status FROM welfare_vendor_review_events').get().response_status,status);}finally{f.close();}}
});

test('closed review states and pending resubmission cannot resurrect supplement marker; history retained',async()=>{
  for(const status of ['approved','rejected','suspended','pending']){const f=fixture();try{await f.run();const result=await changeVendorSupplementReviewStatus(f.db,{id:'v',status,review_note:'final decision',request_id:crypto.randomUUID(),expected_updated_at:f.row().updated_at},{actor:'verified-admin'});assert.equal(result.success,true);assert.equal(result.data.vendor.status,status);assert.equal(result.data.vendor.supplement.state,status==='pending'?'pending':'closed');assert.deepEqual(result.data.vendor.supplement_items,[]);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendor_review_events').get().n,2);if(['rejected','pending'].includes(status)){const reopened=await f.run(f.data({review_note:'new request',supplement_items:['新文件']}));assert.equal(reopened.data.vendor.status,'needs_supplement');assert.deepEqual(reopened.data.vendor.supplement_items,['新文件']);}}finally{f.close();}}
  const f=fixture();try{await f.run();f.sqlite.exec("UPDATE welfare_vendors SET status='pending',updated_at='resubmitted'");await closeVendorSupplement(f.db,'v','pending');const projected=await projectVendorSupplement(f.db,f.row());assert.equal(projected.status,'pending');assert.equal(projected.supplement.state,'pending');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendor_review_events').get().n,1);}finally{f.close();}
});

test('dashboard projects proof before first supplement using two reads, application never exposes applicant proof',async()=>{
  const f=fixture();try{await recordVerifiedVendorNotificationIdentity(f.db,'v',UID,{verified:true,source:'line_verified_portal_login'});const count=f.queries.length;const dashboard=await projectVendorSupplementDashboard(f.db,{success:true,vendors:[f.row()]});assert.equal(dashboard.vendors[0].supplement.applicant.verified,true);assert.equal(f.queries.length-count,2);await f.run();const application=await projectVendorSupplementApplication(f.db,{success:true,data:{vendor:f.row(),review:{status:'rejected',statusLabel:'退件補件'}}});assert.equal(application.data.review.status,'needs_supplement');assert.equal(application.data.review.statusLabel,'待補件');assert.deepEqual(application.data.review.supplementItems,['營業登記','保險證明']);assert.equal('applicant' in application.data.vendor.supplement,false);}finally{f.close();}
});

test('maximum bounded Flex is still a Flex below bubble byte limit and has all requested items',()=>{
  const items=Array.from({length:20},(_,i)=>String(i)+'繁'.repeat(197));const message=buildVendorSupplementFlex({name:'店'.repeat(300)},{items_json:JSON.stringify(items),note:'原'.repeat(2000)},origin);assert.equal(message.type,'flex');assert.equal(message.contents.body.contents.filter(item=>/^\d+\./.test(item.text||'')).length,20);assert.ok(new TextEncoder().encode(JSON.stringify(message.contents)).length<30000);assert.ok(message.altText.length<400);assert.throws(()=>buildVendorSupplementFlex({name:'x'},{items_json:'[]',note:'x'},'http://unsafe.test'),/HTTPS/);
});

test('actual vendor.status branch rejects expired/viewer/cross-origin and derives actor from authenticated admin',async()=>{
  const handler=source.match(/async function handleVendorManagementAction\([^]*?\n\}/)[0],auth=source.match(/async function vendorVisibilityAdmin\([^]*?\n\}/)[0];
  for(const role of ['admin','viewer','expired']){const f=fixture();try{const context=vm.createContext({URL,console,requestVendorSupplement,hasVendorSupplement,changeVendorSupplementReviewStatus,authorizeVendorSupplementAdmin,requireAdmin:async()=>role==='expired'?{ok:false}:{ok:true,user:{id:'real-session-admin',role,business_units:'vendors'}},sendTelegramNotification:async()=>{},vendorNotifyLines:()=>[],getVendorNotifySnapshot:async()=>({}),backfillApprovedVendorLineBinding:async()=>{},crypto});vm.runInContext(auth+'\n'+handler,context);const payload=f.data();const call=originHeader=>context.handleVendorManagementAction(new Request(origin+'/admin-api/vendor-management',{method:'POST',headers:{Authorization:'Bearer fake-session',Origin:originHeader},body:JSON.stringify({action:'vendor.status',data:payload})}),f.db,{});assert.equal((await call('https://other.test')).success,false);const result=await call(origin);assert.equal(result.success,role==='admin');assert.equal(f.sends.length,0);if(role==='admin')assert.equal(f.sqlite.prepare('SELECT actor FROM welfare_vendor_review_events').get().actor,'real-session-admin');else assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendor_review_events').get().n,0);}finally{f.close();}}
});

function writerContext(f,{beforeUpload}={}){
  const context=vm.createContext({URL,console,crypto,VENDOR_SUPPLEMENT_SAVE_GUARD,commitVendorSupplementResubmission,validateVendorSupplementSubmission,readVendorSupplement,
    taiwanNowString:()=>new Date().toISOString(),ensureVendorPortalCredentialColumns:async()=>{},sanitizeVendorRichText:v=>v,
    processVendorFileUploads:async(env,origin,data)=>{if(beforeUpload)await beforeUpload();for(const [file,url] of [['business_license_file','business_license_url'],['insurance_file','insurance_file_url'],['food_registration_file','food_registration_url']])if(data[file]?.base64){data[url]='https://stored.test/'+crypto.randomUUID();delete data[file];}return data;},
    sendTelegramNotification:async()=>{},getVendorNotifySnapshot:async()=>({}),vendorNotifyLines:()=>[],
    readVendorPortalCookie:()=>null,verifyVendorPortalToken:async()=>({vendor_id:'v',username:'store'}),validateVendorPortalCredentialInput:()=>({success:true,username:'store',password:''})});
  for(const name of ['normalizeVendorStatus','saveWelfareVendor','handleVendorManagementAction','saveVendorApplication']){
    const declaration=source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));assert.ok(declaration,name);vm.runInContext(declaration[0],context);
  }
  return context;
}

test('ordinary admin save uses real vendor writer and preserves active supplement revision/note; form status cannot close it',async()=>{
  const f=fixture();try{await f.run();const before=await readVendorSupplement(f.db,'v'),context=writerContext(f);
    const save=status=>context.handleVendorManagementAction(new Request(origin+'/admin-api/vendor-management',{method:'POST',body:JSON.stringify({action:'vendor.save',data:{...f.row(),name:'更新店名',status,review_note:'form must not replace requirement'}})}),f.db,{});
    assert.equal((await save('needs_supplement')).success,true);assert.equal(f.row().status,'rejected');assert.equal(f.row().review_note,before.note);const after=await readVendorSupplement(f.db,'v');assert.equal(after.revision,before.revision);assert.equal(after.last_event_id,before.last_event_id);assert.equal(after.state,'needs_supplement');assert.equal((await save('approved')).success,false);assert.equal((await save('pending')).success,false);assert.equal(f.row().status,'rejected');assert.equal(f.sends.length,0);
  }finally{f.close();}
});

test('actual merchant writer atomically resubmits current supplement and audits pending; stale render or raced newer requirement cannot overwrite',async()=>{
  for(const mode of ['success','stale','race','rollback']){const f=fixture();try{await f.run(f.data({supplement_items:['營業登記證明','保險文件或保險證號']}));const workflow=await readVendorSupplement(f.db,'v'),before=f.row(),context=writerContext(f,{beforeUpload:mode==='race'?async()=>{await f.run(f.data({review_note:'管理員的新要求',supplement_items:['新文件']}));}:undefined});
    const data={...before,id:'v',portal_token:'test-portal',name:'補件店家',supplement_expected_updated_at:mode==='stale'?'old-version':before.updated_at,supplement_revision:workflow.revision,business_license_file:{base64:'synthetic'},insurance_policy_no:'NEW-12345'};
    if(mode==='rollback')f.controls.abortSql="UPDATE welfare_vendor_supplements SET state='pending'";
    const call=()=>context.saveVendorApplication(new Request(origin+'/api/vendor-apply',{method:'POST',body:JSON.stringify(data)}),f.db,{},origin);
    if(mode==='rollback'){await assert.rejects(call(),/synthetic/);assert.equal(f.row().status,'rejected');assert.equal(f.row().name,before.name);assert.equal((await readVendorSupplement(f.db,'v')).state,'needs_supplement');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM welfare_vendor_review_events').get().n,1);}
    else{const result=await call();assert.equal(result.success,mode==='success',JSON.stringify(result));if(mode==='success'){assert.equal(f.row().status,'pending');assert.equal(f.row().name,'補件店家');assert.equal((await readVendorSupplement(f.db,'v')).state,'pending');const events=f.sqlite.prepare('SELECT next_status,actor FROM welfare_vendor_review_events ORDER BY rowid').all();assert.equal(events.length,2);assert.equal(events[1].next_status,'pending');assert.equal(events[1].actor,'vendor:store');}else{assert.equal(f.row().status,'rejected');assert.notEqual(f.row().name,'補件店家');assert.equal((await readVendorSupplement(f.db,'v')).state,'needs_supplement');if(mode==='race')assert.equal(f.row().review_note,'管理員的新要求');}}
  }finally{f.close();}}
});

test('known required item semantics reject empty resubmission while document/number/date/policy updates count',async()=>{
  for(const [item,accepted] of [['營業登記證明',{business_license_file:{base64:'new'}}],['保險文件或保險證號',{insurance_policy_no:'NEW-123'}],['食品業者登錄資料',{food_registration_no:'A-123'}],['合約資料',{contract_end:'2027-12-31'}],['員工優惠政策',{discount_policy:'員工優惠九折'}]]){
    const workflow={state:'needs_supplement',items_json:JSON.stringify([item])};assert.equal((await validateVendorSupplementSubmission(workflow,{},{})).success,false,item);assert.equal((await validateVendorSupplementSubmission(workflow,{},accepted)).success,true,item);assert.equal((await validateVendorSupplementSubmission(workflow,accepted,accepted)).success,item==='營業登記證明',item);
  }
  assert.equal((await validateVendorSupplementSubmission({state:'needs_supplement',items_json:'["合約資料"]'},{},{},{hasUpdatedContract:async()=>true})).success,true);
  assert.equal((await validateVendorSupplementSubmission({state:'needs_supplement',items_json:'["請說明保險合作方式"]'},{},{})).success,true,'free text is not incorrectly classified as a machine-verifiable field');
});

test('unverified saved requirement can be explicitly confirmed once later; invalid proof metadata cannot send',async()=>{
  const f=fixture();try{assert.equal((await f.run()).data.notification.state,'skipped_unverified');const confirmed=await f.run(f.data({confirm_applicant_identity:true}));assert.equal(confirmed.data.notification.state,'accepted');assert.equal(f.sends.length,1);assert.equal((await f.run(f.data({confirm_applicant_identity:true}))).success,false);assert.equal(f.sends.length,1);}finally{f.close();}
  const g=fixture();try{g.sqlite.prepare("INSERT INTO welfare_vendor_notification_identities VALUES(?,?,'admin_verified','admin','')").run('v',UID);assert.equal((await g.run()).data.notification.state,'skipped_unverified');assert.equal(g.sends.length,0);}finally{g.close();}
});

test('actual merchant route rejects original prefilled policy unchanged then accepts an actual change',async()=>{
  const f=fixture();try{
    f.sqlite.prepare('UPDATE welfare_vendors SET discount_policy=?').run('原有員工優惠九折');
    await f.run(f.data({supplement_items:['員工優惠政策']}));
    const workflow=await readVendorSupplement(f.db,'v'),before=f.row(),context=writerContext(f);
    const data={...before,id:'v',portal_token:'test-portal',supplement_expected_updated_at:before.updated_at,supplement_revision:workflow.revision};
    const submit=body=>context.saveVendorApplication(new Request(origin+'/api/vendor-apply',{method:'POST',body:JSON.stringify(body)}),f.db,{},origin);
    const unchanged=await submit(data);assert.equal(unchanged.success,false);assert.match(unchanged.message,/本次/);assert.equal(f.row().status,'rejected');assert.equal((await readVendorSupplement(f.db,'v')).revision,workflow.revision);
    const changed=await submit({...data,discount_policy:'補充：員工憑證享八折，至年底有效'});assert.equal(changed.success,true);assert.equal(f.row().status,'pending');assert.equal(f.row().discount_policy,'補充：員工憑證享八折，至年底有效');assert.equal((await readVendorSupplement(f.db,'v')).state,'pending');
  }finally{f.close();}
});

test('unclaimed pending event can resume once, while claimed or accepted events never dispatch again',async()=>{
  const f=fixture();try{const payload=f.data({confirm_applicant_identity:true});const saved=await f.run(payload,{transport:undefined});assert.equal(saved.data.notification.state,'skipped_disabled');assert.equal(f.sends.length,0);f.sqlite.exec("UPDATE welfare_vendor_review_events SET notification_state='pending'");const resumed=await f.run(payload);assert.equal(resumed.data.notification.state,'accepted');assert.equal(f.sends.length,1);await f.run(payload);assert.equal(f.sends.length,1);}finally{f.close();}
});

test('shared admin gate rejects unrelated module and derives missing scope only from active trusted DB row',async()=>{
  const f=fixture();try{const request=new Request(origin+'/admin-api/vendor-management',{headers:{Authorization:'Bearer session',Origin:origin}});
    assert.equal(await authorizeVendorSupplementAdmin(request,f.db,{requireAdmin:async()=>({ok:true,user:{id:'a',role:'admin',business_units:'activities'}})}),null);
    f.sqlite.exec("CREATE TABLE admin_users(id TEXT,role TEXT,active INTEGER,business_units TEXT); INSERT INTO admin_users VALUES('a','admin',1,'vendors')");
    const allowed=await authorizeVendorSupplementAdmin(request,f.db,{requireAdmin:async()=>({ok:true,user:{id:'a',role:'admin'}})});assert.equal(allowed.id,'a');assert.equal(allowed.business_units,'vendors');
    f.sqlite.exec('UPDATE admin_users SET active=0');assert.equal(await authorizeVendorSupplementAdmin(request,f.db,{requireAdmin:async()=>({ok:true,user:{id:'a',role:'admin'}})}),null);
  }finally{f.close();}
});

test('admin notification recipient is the event snapshot and is not exposed to the applicant',async()=>{
  const f=fixture();try{
    const saved=await f.run(f.data({confirm_applicant_identity:true}));
    assert.equal(saved.data.notification.recipient_uid,UID);
    assert.equal(saved.data.vendor.supplement.notification.recipient_uid,UID);
    f.sqlite.prepare('UPDATE welfare_vendors SET submitted_by_line_user_id=?').run(OTHER);
    const dashboard=await projectVendorSupplementDashboard(f.db,{success:true,vendors:[f.row()]});
    assert.equal(dashboard.vendors[0].supplement.notification.recipient_uid,UID);
    assert.equal(dashboard.vendors[0].supplement.applicant.uid,OTHER);
    const application=await projectVendorSupplementApplication(f.db,{success:true,data:{vendor:f.row(),review:{}}});
    assert.equal('recipient_uid' in application.data.vendor.supplement.notification,false);
    const skipped=fixture();try{const result=await skipped.run();assert.equal(result.data.notification.recipient_uid,'');assert.equal(result.data.notification.state,'skipped_unverified');}finally{skipped.close();}
  }finally{f.close();}
});
