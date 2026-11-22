const UID = /^U[0-9a-f]{32}$/i;
export const VENDOR_SUPPLEMENT_SAVE_GUARD = Symbol('verified-vendor-supplement-save');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const text = value => String(value ?? '').trim();
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
const now = deps => (deps.now ? deps.now() : new Date()).toISOString();
const fail = message => ({success:false,message});
const parseItems = value => {try {const items=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(items)?items.filter(item=>typeof item==='string'):[];}catch{return [];}};
const missingSchema = error => /no such table.*welfare_vendor_(supplements|review_events|notification_identities)/i.test(String(error?.message||error));
const validProof = (proof,uid) => Boolean(UID.test(uid)&&proof?.line_user_id===uid&&['line_verified_application','line_verified_portal_login','admin_verified'].includes(proof.source)&&text(proof.verified_at));

export async function authorizeVendorSupplementAdmin(request,db,{requireAdmin}) {
  const origin=request.headers.get('Origin');
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return null;
  const token=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return null;
  const auth=await requireAdmin({sessionToken:token},db);
  if(!auth?.ok||auth.user?.role!=='admin'||!auth.user?.id)return null;
  let scope=auth.user.business_units;
  if(scope===undefined||scope===null){const row=await db.prepare("SELECT business_units FROM admin_users WHERE id=? AND active=1 AND role='admin'").bind(auth.user.id).first();scope=row?.business_units;}
  const modules=text(scope).split(',').map(text);
  return modules.includes('*')||modules.includes('vendors')?{...auth.user,business_units:scope}:null;
}

export function vendorNotificationResult(row) {
  let state=row?.notification_state||'not_requested';
  // A claimed event is never dispatched by a repeated request, even if its final receipt was lost.
  if(state==='sending')state='unknown';
  const messages={accepted:'LINE 已接受通知，不代表對方已收到或閱讀。',failed:'補件要求已保存，但 LINE 拒絕通知。',unknown:'補件要求已保存，通知結果待確認；請勿重送。',pending:'補件要求已保存，通知尚未送出。',skipped_unverified:'補件要求已保存，尚未核對申請人的 LINE 帳號，因此未通知。',skipped_missing_recipient:'補件要求已保存，未提供有效申請人 LINE UID，因此未通知。',skipped_disabled:'補件要求已保存，LINE 推播尚未設定，因此未通知。',not_requested:'未要求發送 LINE 通知。'};
  return {state,message:messages[state]||'通知結果待確認。',http_status:Number(row?.response_status||0)};
}

export async function readVendorSupplement(db,vendorId) {
  try{return await db.prepare('SELECT * FROM welfare_vendor_supplements WHERE vendor_id=?').bind(text(vendorId)).first();}
  catch(error){if(missingSchema(error))return null;throw error;}
}

function project(vendor,row,event,proof,admin) {
  if(!row&&!admin)return vendor;
  const active=row?.state==='needs_supplement'&&vendor.status==='rejected';
  const supplement={state:row?.state||'',items:active?parseItems(row.items_json):[],note:active?row.note:'',revision:Number(row?.revision||0),expected_updated_at:vendor.supplement?.expected_updated_at||vendor.updated_at||'',notification:vendorNotificationResult(event)};
  if(admin){
    supplement.notification.recipient_uid=text(event?.recipient_uid);
    const uid=text(vendor.submitted_by_line_user_id);
    supplement.applicant={uid,contactDifferent:Boolean(text(vendor.contact_line_user_id)&&text(vendor.contact_line_user_id)!==uid),verified:validProof(proof,uid),source:validProof(proof,uid)?proof.source:''};
  }
  return {...vendor,status:active?'needs_supplement':vendor.status,supplement_items:supplement.items,supplement};
}

export async function projectVendorSupplement(db,vendor,{admin=false}={}) {
  if(!vendor?.id)return vendor;
  const row=await readVendorSupplement(db,vendor.id);
  if(!row&&!admin)return vendor;
  const event=row?.last_event_id?await db.prepare('SELECT notification_state,response_status,recipient_uid FROM welfare_vendor_review_events WHERE event_id=?').bind(row.last_event_id).first():null;
  let proof=null;
  if(admin){try{proof=await db.prepare('SELECT line_user_id,source,verified_at FROM welfare_vendor_notification_identities WHERE vendor_id=?').bind(vendor.id).first();}catch(error){if(!missingSchema(error))throw error;}}
  return project(vendor,row,event,proof,admin);
}

export async function projectVendorSupplementDashboard(db,result) {
  if(!result?.success||!Array.isArray(result.vendors))return result;
  // One sidecar scan, not one round trip per vendor; an empty migration has no effect.
  let rows,identities;
  try{[rows,identities]=await Promise.all([db.prepare('SELECT s.*,e.notification_state,e.response_status,e.recipient_uid FROM welfare_vendor_supplements s LEFT JOIN welfare_vendor_review_events e ON e.event_id=s.last_event_id').all(),db.prepare('SELECT vendor_id,line_user_id,source,verified_at FROM welfare_vendor_notification_identities').all()]);}
  catch(error){if(missingSchema(error))return result;throw error;}
  const workflows=new Map((rows.results||[]).map(row=>[row.vendor_id,row])),proofs=new Map((identities.results||[]).map(row=>[row.vendor_id,row]));
  const vendors=result.vendors.map(v=>project(v,workflows.get(v.id),workflows.get(v.id),proofs.get(v.id),true));
  return {...result,vendors};
}

export async function projectVendorSupplementApplication(db,result) {
  if(!result?.success||!result.data?.vendor)return result;
  const vendor=await projectVendorSupplement(db,result.data.vendor);
  if(!vendor.supplement)return result;
  return {...result,data:{...result.data,vendor,review:{...result.data.review,status:vendor.status,statusLabel:vendor.status==='needs_supplement'?'待補件':result.data.review?.statusLabel,supplementItems:vendor.supplement_items,supplement:vendor.supplement}}};
}

export async function recordVerifiedVendorNotificationIdentity(db,vendorId,uid,{verified=false,source='',actor=''}={}) {
  if(!verified||!UID.test(text(uid))||!['line_verified_application','line_verified_portal_login'].includes(source))return false;
  let result;
  try{result=await db.prepare(`INSERT INTO welfare_vendor_notification_identities(vendor_id,line_user_id,source,verified_by,verified_at)
    SELECT id,?,?,?,? FROM welfare_vendors WHERE id=? AND submitted_by_line_user_id=? AND COALESCE(is_hidden,0)=0
    ON CONFLICT(vendor_id) DO UPDATE SET line_user_id=excluded.line_user_id,source=excluded.source,verified_by=excluded.verified_by,verified_at=excluded.verified_at`).bind(uid,source,text(actor),new Date().toISOString(),vendorId,uid).run();}
  catch(error){if(missingSchema(error))return false;throw error;}
  return Number(result.meta?.changes)>0;
}

export async function hasVerifiedVendorNotificationIdentity(db,vendorId,uid) {
  if(!UID.test(text(uid)))return false;
  try{return Boolean(await db.prepare(`SELECT n.vendor_id FROM welfare_vendor_notification_identities n JOIN welfare_vendors v ON v.id=n.vendor_id
    WHERE n.vendor_id=? AND n.line_user_id=? AND v.submitted_by_line_user_id=? AND COALESCE(v.is_hidden,0)=0
    AND n.source IN ('line_verified_application','line_verified_portal_login','admin_verified') AND n.verified_at<>''`).bind(vendorId,uid,uid).first());}
  catch(error){if(missingSchema(error))return false;throw error;}
}

export function buildVendorSupplementFlex(vendor,event,origin) {
  const base=new URL(origin);
  if(base.protocol!=='https:')throw new Error('Notification entry requires HTTPS');
  const items=parseItems(event.items_json);
  const contents={type:'bubble',size:'mega',header:{type:'box',layout:'vertical',backgroundColor:'#FFF1F2',paddingAll:'20px',contents:[{type:'text',text:'廠商申請待補件',weight:'bold',size:'xl',color:'#9F1239',wrap:true}]},body:{type:'box',layout:'vertical',spacing:'md',paddingAll:'20px',contents:[
    {type:'text',text:text(vendor.name).slice(0,150)||'店家申請',weight:'bold',size:'lg',wrap:true},
    {type:'text',text:'請補齊以下資料，再送回福委會審核。',size:'sm',color:'#64748B',wrap:true},
    {type:'separator'},
    {type:'text',text:'補件項目',weight:'bold',size:'md',wrap:true},
    ...items.map((item,i)=>({type:'text',text:`${i+1}. ${item}`,size:'sm',color:'#334155',wrap:true})),
    {type:'separator'},
    {type:'text',text:'補件原因',weight:'bold',size:'md',wrap:true},
    {type:'text',text:text(event.note)||'請登入查看補件說明。',size:'sm',color:'#334155',wrap:true}
  ]},footer:{type:'box',layout:'vertical',spacing:'sm',paddingAll:'20px',contents:[{type:'button',style:'primary',color:'#16A085',action:{type:'uri',label:'立即補件',uri:new URL('/vendor-login?next=supplement',base).href}},{type:'text',text:'請使用原廠商帳號密碼登入。',size:'xs',color:'#64748B',wrap:true}]}};
  if(new TextEncoder().encode(JSON.stringify(contents)).length>30000)throw new Error('Supplement Flex exceeds provider bubble limit');
  return {type:'flex',altText:`廠商申請待補件｜${text(vendor.name).slice(0,100)||'店家申請'}｜${items.length} 項資料待補齊`,contents};
}

async function eventResponse(db,event,replayed=false) {
  const vendor=await db.prepare('SELECT * FROM welfare_vendors WHERE id=?').bind(event.vendor_id).first();
  if(!vendor)return fail('找不到廠商資料。');
  const safe={...vendor,vendor_portal_password:'',vendor_portal_password_set:Boolean(vendor.vendor_portal_password)};
  return {success:true,replayed,message:vendorNotificationResult(event).message,data:{id:vendor.id,vendor:await projectVendorSupplement(db,safe,{admin:true}),notification:{...vendorNotificationResult(event),recipient_uid:text(event.recipient_uid)},request_id:event.request_id}};
}

export async function requestVendorSupplement(db,env,data,{actor='',origin='',transport,now:clock}={}) {
  const deps={now:clock},id=text(data.id),requestId=text(data.request_id),expected=text(data.expected_updated_at),note=text(data.review_note);
  if(!actor)return fail('請使用具有廠商管理權限的管理員登入。');
  if(!id||id.length>200||!UUID.test(requestId)||!expected||expected.length>100)return fail('缺少有效操作編號或資料版本，請重新載入。');
  if(!note||note.length>2000||CONTROL.test(note))return fail('補件原因必填，且不可超過 2000 字或含控制字元。');
  if(!Array.isArray(data.supplement_items)||data.supplement_items.length<1||data.supplement_items.length>20||data.supplement_items.some(v=>typeof v!=='string'||!text(v)||text(v).length>200||CONTROL.test(v)))return fail('請填寫 1 至 20 項補件項目，每項不可超過 200 字或含控制字元。');
  const items=[...new Set(data.supplement_items.map(text))];
  const confirmed=data.confirm_applicant_identity===true;
  const fingerprint=await hash({id,note,items,expected,confirmed});
  const previousEvent=await db.prepare('SELECT * FROM welfare_vendor_review_events WHERE request_id=?').bind(requestId).first();
  if(previousEvent){if(previousEvent.actor!==actor||previousEvent.fingerprint!==fingerprint)return fail('操作編號已用於不同資料，請重新載入。');return eventResponse(db,previousEvent.notification_state==='pending'?await dispatchVendorSupplement(db,env,previousEvent,{origin,transport}):previousEvent,true);}
  const vendor=await db.prepare('SELECT * FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0').bind(id).first();
  if(!vendor)return fail('找不到可審核的廠商資料。');
  if(text(vendor.updated_at)!==expected)return fail('資料已被更新，請重新載入後再審核。');
  if(!['pending','rejected'].includes(vendor.status))return fail('只有待審或退件申請可以要求補件。');
  const current=await readVendorSupplement(db,id);
  if(current?.state==='needs_supplement'&&current.note===note&&JSON.stringify(parseItems(current.items_json))===JSON.stringify(items)){
    const oldEvent=await db.prepare('SELECT notification_state FROM welfare_vendor_review_events WHERE event_id=?').bind(current.last_event_id).first();
    if(!confirmed||!['skipped_unverified','skipped_missing_recipient','skipped_disabled'].includes(oldEvent?.notification_state))return fail('這筆補件要求已保存，請勿重複通知；請查閱原通知狀態。');
  }
  const uid=text(vendor.submitted_by_line_user_id),proof=await db.prepare('SELECT * FROM welfare_vendor_notification_identities WHERE vendor_id=?').bind(id).first();
  const validUid=UID.test(uid),trusted=validUid&&(confirmed||validProof(proof,uid));
  const source=confirmed&&validUid?'admin_verified':trusted?proof.source:'';
  const state=!validUid?'skipped_missing_recipient':!trusted?'skipped_unverified':!env.LINE_CHANNEL_ACCESS_TOKEN&&!transport?'skipped_disabled':'pending';
  const stamp=now(deps),eventId=crypto.randomUUID(),retryKey=crypto.randomUUID(),revision=Number(current?.revision||0)+1;
  const statements=[db.prepare(`INSERT INTO welfare_vendor_review_events(request_id,event_id,vendor_id,actor,fingerprint,previous_status,next_status,items_json,note,expected_updated_at,recipient_uid,recipient_source,notification_state,retry_key,created_at,updated_at)
    SELECT ?,?,?,?,?,?,'needs_supplement',?,?,?,?,?,?,?,?,? FROM welfare_vendors
    WHERE id=? AND updated_at=? AND COALESCE(is_hidden,0)=0 AND status IN ('pending','rejected')
      AND COALESCE((SELECT revision FROM welfare_vendor_supplements WHERE vendor_id=?),0)=?`).bind(requestId,eventId,id,actor,fingerprint,current?.state==='needs_supplement'?'needs_supplement':vendor.status,JSON.stringify(items),note,expected,trusted?uid:'',source,state,retryKey,stamp,stamp,id,expected,id,Number(current?.revision||0)),
    db.prepare(`UPDATE welfare_vendors SET status='rejected',review_note=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM welfare_vendor_review_events WHERE event_id=?)`).bind(note,actor,stamp,stamp,id,eventId),
    db.prepare(`INSERT INTO welfare_vendor_supplements(vendor_id,state,items_json,note,revision,reviewed_at,updated_at,last_event_id)
      SELECT ?,'needs_supplement',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM welfare_vendor_review_events WHERE event_id=?)
      ON CONFLICT(vendor_id) DO UPDATE SET state=excluded.state,items_json=excluded.items_json,note=excluded.note,revision=excluded.revision,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at,last_event_id=excluded.last_event_id`).bind(id,JSON.stringify(items),note,revision,stamp,stamp,eventId,eventId)];
  if(confirmed&&validUid)statements.push(db.prepare(`INSERT INTO welfare_vendor_notification_identities(vendor_id,line_user_id,source,verified_by,verified_at)
    SELECT ?,?,'admin_verified',?,? WHERE EXISTS(SELECT 1 FROM welfare_vendor_review_events WHERE event_id=?)
    ON CONFLICT(vendor_id) DO UPDATE SET line_user_id=excluded.line_user_id,source=excluded.source,verified_by=excluded.verified_by,verified_at=excluded.verified_at`).bind(id,uid,actor,stamp,eventId));
  let batch;
  try{batch=await db.batch(statements);}catch(error){
    const replay=await db.prepare('SELECT * FROM welfare_vendor_review_events WHERE request_id=?').bind(requestId).first();
    if(replay?.actor===actor&&replay.fingerprint===fingerprint)return eventResponse(db,replay,true);
    throw error;
  }
  if(!Number(batch[0]?.meta?.changes))return fail('資料已被更新，請重新載入後再審核。');
  let event=await db.prepare('SELECT * FROM welfare_vendor_review_events WHERE event_id=?').bind(eventId).first();
  if(state==='pending')event=await dispatchVendorSupplement(db,env,event,{origin,transport});
  return eventResponse(db,event);
}

async function dispatchVendorSupplement(db,env,event,{origin,transport}) {
  // Claim once before any external request. Replays only read the stored result.
  const claim=await db.prepare("UPDATE welfare_vendor_review_events SET notification_state='sending',updated_at=? WHERE event_id=? AND notification_state='pending'").bind(new Date().toISOString(),event.event_id).run();
  if(!Number(claim.meta?.changes))return db.prepare('SELECT * FROM welfare_vendor_review_events WHERE event_id=?').bind(event.event_id).first();
  let state='unknown',status=0,requestId='',acceptedId='',detail='通知結果待確認，禁止自動重送。';
  try{
    const vendor=await db.prepare('SELECT name,submitted_by_line_user_id,status,is_hidden FROM welfare_vendors WHERE id=?').bind(event.vendor_id).first();
    const active=await readVendorSupplement(db,event.vendor_id);
    if(!vendor||vendor.submitted_by_line_user_id!==event.recipient_uid||Number(vendor.is_hidden)||active?.last_event_id!==event.event_id||active.state!=='needs_supplement'||vendor.status!=='rejected'||!await hasVerifiedVendorNotificationIdentity(db,event.vendor_id,event.recipient_uid)){
      state='skipped_unverified';detail='申請人或審核狀態已變更，未通知。';
    }else{
      const message=buildVendorSupplementFlex(vendor,event,origin);
      const result=transport?await transport({to:event.recipient_uid,messages:[message],retryKey:event.retry_key}):await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json','X-Line-Retry-Key':event.retry_key},body:JSON.stringify({to:event.recipient_uid,messages:[message]}),signal:AbortSignal.timeout(8000)});
      status=Number(result.status)||0;requestId=result.headers?.get('x-line-request-id')||result.requestId||'';acceptedId=result.headers?.get('x-line-accepted-request-id')||result.acceptedRequestId||'';
      state=result.ok||(status===409&&acceptedId)?'accepted':status>=400&&status<500&&status!==409?'failed':'unknown';
      detail=vendorNotificationResult({notification_state:state}).message;
      await result.body?.cancel?.();
    }
  }catch{/* Ambiguous external results must never be automatically replayed. */}
  try{await db.prepare('UPDATE welfare_vendor_review_events SET notification_state=?,response_status=?,provider_request_id=?,provider_accepted_request_id=?,notification_detail=?,updated_at=? WHERE event_id=? AND notification_state=\'sending\'').bind(state,status,requestId.slice(0,160),acceptedId.slice(0,160),detail,new Date().toISOString(),event.event_id).run();}
  catch{return {...event,notification_state:'unknown'};}
  return db.prepare('SELECT * FROM welfare_vendor_review_events WHERE event_id=?').bind(event.event_id).first();
}

export async function closeVendorSupplement(db,vendorId,state='closed') {
  if(!['pending','closed'].includes(state))throw new Error('Invalid supplement state');
  try{await db.prepare("UPDATE welfare_vendor_supplements SET state=?,revision=revision+1,updated_at=? WHERE vendor_id=? AND state='needs_supplement'").bind(state,new Date().toISOString(),vendorId).run();}
  catch(error){if(!missingSchema(error))throw error;}
}

export async function commitVendorSupplementResubmission(db,mutation,guard) {
  const stamp=new Date().toISOString();
  const batch=await db.batch([
    db.prepare(`INSERT INTO welfare_vendor_review_events(request_id,event_id,vendor_id,actor,fingerprint,previous_status,next_status,note,expected_updated_at,notification_state,retry_key,created_at,updated_at)
      SELECT ?,?,?,?,?,'needs_supplement','pending','廠商補件重新送審',?,'not_requested',?,?,? FROM welfare_vendors
      WHERE id=? AND status='rejected' AND updated_at=? AND COALESCE(is_hidden,0)=0
        AND EXISTS(SELECT 1 FROM welfare_vendor_supplements WHERE vendor_id=? AND state='needs_supplement' AND revision=? AND last_event_id=?)`).bind(guard.event_id,guard.event_id,guard.vendor_id,guard.actor,await hash({vendor:guard.vendor_id,expected:guard.expected,revision:guard.revision}),guard.expected,crypto.randomUUID(),stamp,stamp,guard.vendor_id,guard.expected,guard.vendor_id,guard.revision,guard.last_event_id),
    mutation,
    db.prepare(`UPDATE welfare_vendor_supplements SET state='pending',revision=revision+1,updated_at=?,last_event_id=? WHERE vendor_id=?
      AND EXISTS(SELECT 1 FROM welfare_vendor_review_events WHERE event_id=?)`).bind(stamp,guard.event_id,guard.vendor_id,guard.event_id)
  ]);
  return Number(batch[0]?.meta?.changes)&&Number(batch[1]?.meta?.changes)?batch[1]:{meta:{changes:0}};
}

export async function hasVendorSupplement(db,vendorId) {return Boolean(await readVendorSupplement(db,vendorId));}

export async function validateVendorSupplementSubmission(workflow,previous,submitted,{hasUpdatedContract=async()=>false}={}) {
  if(workflow?.state!=='needs_supplement')return {success:true};
  const changed = field => Boolean(text(submitted[field])&&text(submitted[field])!==text(previous[field]));
  const uploaded = field => Boolean(submitted[field]&&typeof submitted[field]==='object'&&text(submitted[field].base64));
  const required=new Set(parseItems(workflow.items_json).map(item=>item.replace(/\s+/g,'')));
  const has = options => options.some(item=>required.has(item));
  if(has(['營業登記證明','營業登記/證照檔案','營業登記/證照','營業登記／證照檔案','營業登記'])&&!uploaded('business_license_file'))return fail('請本次重新上傳營業登記／證照檔案後再送審。');
  if(has(['保險證明','保險文件或保險證號','保險文件'])&&!uploaded('insurance_file')&&!(changed('insurance_policy_no')&&text(submitted.insurance_policy_no).length>=3&&/\d/.test(text(submitted.insurance_policy_no))))return fail('請本次上傳保險文件，或更新保險證號後再送審。');
  if(has(['食品業者登錄資料','食品業者登錄'])&&!uploaded('food_registration_file')&&!(changed('food_registration_no')&&text(submitted.food_registration_no).length>=3))return fail('請本次上傳食品登錄文件，或更新登錄號後再送審。');
  if(has(['合約資料','合作合約'])&&!changed('contract_start')&&!changed('contract_end')&&!await hasUpdatedContract())return fail('請本次更新合約日期或上傳合作合約後再送審。');
  if(has(['員工優惠政策'])&&!(changed('discount_policy')&&text(submitted.discount_policy).replace(/<[^>]*>/g,'').trim()))return fail('請本次補充或更新員工優惠政策後再送審。');
  return {success:true};
}

export async function changeVendorSupplementReviewStatus(db,data,{actor='',now:clock}={}) {
  const id=text(data.id),workflow=await readVendorSupplement(db,id);
  if(!workflow)return null;
  if(!actor)return fail('請使用具有廠商管理權限的管理員登入。');
  const status=text(data.status);
  if(!['pending','approved','rejected','suspended'].includes(status))return fail('不支援此審核狀態。');
  const vendor=await db.prepare('SELECT * FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0').bind(id).first();
  if(!vendor)return fail('找不到可審核的廠商資料。');
  const expected=text(data.expected_updated_at||vendor.updated_at),requestId=text(data.request_id)||crypto.randomUUID(),note=text(data.review_note);
  if(!UUID.test(requestId))return fail('操作編號不正確。');
  const fingerprint=await hash({id,status,expected,note}),replay=await db.prepare('SELECT * FROM welfare_vendor_review_events WHERE request_id=?').bind(requestId).first();
  if(replay){if(replay.actor!==actor||replay.fingerprint!==fingerprint)return fail('操作編號已用於不同資料。');return eventResponse(db,replay,true);}
  if(expected!==text(vendor.updated_at))return fail('資料已被更新，請重新載入後再審核。');
  const stamp=now({now:clock}),eventId=crypto.randomUUID();
  const batch=await db.batch([
    db.prepare(`INSERT INTO welfare_vendor_review_events(request_id,event_id,vendor_id,actor,fingerprint,previous_status,next_status,note,expected_updated_at,notification_state,retry_key,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?, 'not_requested',?,?,? FROM welfare_vendors WHERE id=? AND updated_at=? AND COALESCE(is_hidden,0)=0
      AND (SELECT revision FROM welfare_vendor_supplements WHERE vendor_id=?)=?`).bind(requestId,eventId,id,actor,fingerprint,workflow.state==='needs_supplement'?'needs_supplement':vendor.status,status,note,expected,crypto.randomUUID(),stamp,stamp,id,expected,id,workflow.revision),
    db.prepare(`UPDATE welfare_vendors SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM welfare_vendor_review_events WHERE event_id=?)`).bind(status,note,actor,stamp,stamp,id,eventId),
    db.prepare(`UPDATE welfare_vendor_supplements SET state=?,revision=revision+1,updated_at=?,last_event_id=? WHERE vendor_id=? AND EXISTS(SELECT 1 FROM welfare_vendor_review_events WHERE event_id=?)`).bind(status==='pending'?'pending':'closed',stamp,eventId,id,eventId)
  ]);
  if(!Number(batch[0]?.meta?.changes))return fail('資料已被更新，請重新載入後再審核。');
  return eventResponse(db,await db.prepare('SELECT * FROM welfare_vendor_review_events WHERE event_id=?').bind(eventId).first());
}
