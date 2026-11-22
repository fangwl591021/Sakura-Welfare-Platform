const EVENT_TYPE='activity.registration.self_cancel';
const AUDIT_PREFIX='activity-registration-self-cancel:';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const REVISION=/^[0-9a-f]{64}$/;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=409)=>json({success:false,message},status);
const parse=(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}};

// Event wall times without an explicit offset are Taipei times. Reject invalid
// calendar dates instead of letting Date.parse silently roll them forward.
export function selfServiceTimestamp(value){
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/i);
  if(!m)return NaN;
  const [,year,month,day,hour,minute,second='00',fraction='',offset='+08:00']=m;
  if(+month<1||+month>12||+day<1||+day>new Date(Date.UTC(+year,+month,0)).getUTCDate()||+hour>23||+minute>59||+second>59)return NaN;
  if(offset.toUpperCase()!=='Z'){const parts=offset.slice(1).split(':').map(Number);if(parts[0]>14||parts[1]>59||(parts[0]===14&&parts[1]!==0))return NaN;}
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${offset}`);
}

export function ownCancellationState(event,checked,now=Date.now()){
  if(checked)return {can_cancel:false,cancel_block_reason:'checked_in',cancel_block_message:'已完成簽到，無法自行取消。'};
  const start=selfServiceTimestamp(event?.start_at);
  if(!Number.isFinite(start))return {can_cancel:false,cancel_block_reason:'invalid_start',cancel_block_message:'活動開始時間未確認，請聯絡管理員。'};
  if(now>=start)return {can_cancel:false,cancel_block_reason:'event_started',cancel_block_message:'活動已開始，無法自行取消。'};
  return {can_cancel:true,cancel_block_reason:'',cancel_block_message:''};
}

function eventOf(row){return {id:row.event_id,title:row.event_title||'活動資訊已移除',start_at:row.start_at||'',end_at:row.end_at||'',location:row.location||'',status:row.event_status||'',audience_scope:row.audience_scope||'',registration_end_at:row.registration_end_at||''};}
function snapshot(row){return {id:row.id,event_id:row.event_id,line_user_id:row.line_user_id,display_name:row.display_name,form_revision:row.form_revision,schema_json:row.schema_json,answers_json:row.answers_json,created_at:row.created_at};}
const revisionOf=row=>digest({registration:snapshot(row),event:eventOf(row)});
function details(row,cancelled=false){return new TextEncoder().encode(String(row.schema_json||'')+String(row.answers_json||'')).length<=16000?{schema:parse(row.schema_json,{fields:[]}),answers:parse(row.answers_json,{}),details_available:true}:{schema:null,answers:null,details_available:false,details_message:cancelled?'資料較多，請聯絡管理員查詢。':'資料較多，請開啟原報名頁查看。'};}
function ownItem(row,state,revision){return {id:row.id,registration_id:row.id,status:'registered',event:eventOf(row),created_at:row.created_at,form_revision:row.form_revision,...details(row),...state,cancel_revision:revision};}

const eventSelect=`e.title AS event_title,e.start_at,e.end_at,e.location,e.status AS event_status,e.audience_scope,e.registration_end_at`;
const liveSql=`SELECT r.*,${eventSelect},EXISTS(SELECT 1 FROM welfare_activity_checkins c WHERE c.event_id=r.event_id AND c.line_user_id=r.line_user_id) AS checked
  FROM welfare_activity_registrations r LEFT JOIN welfare_activity_events e ON e.id=r.event_id`;
const adminChildren="json_each(CASE WHEN json_valid(a.raw_json) THEN CASE WHEN json_type(a.raw_json,'$.registrations')='array' THEN json_extract(a.raw_json,'$.registrations') ELSE '[]' END ELSE '[]' END)";
const childJson="CASE WHEN j.type='object' THEN j.value ELSE '{}' END";

async function readList(db,uid,url){
  const filter=url.searchParams.get('filter')||'';
  if(filter&&!['all','cancellable'].includes(filter))return fail('不支援的報名篩選條件。',400);
  const rawPage=url.searchParams.get('page')||'1',registrationId=url.searchParams.get('registration_id')||'';
  if(!/^\d{1,6}$/.test(rawPage)||Number(rawPage)<1||registrationId.length>100)return fail('分頁或報名編號不正確。',400);
  const requestId=url.searchParams.get('request_id');
  if(requestId){
    if(!UUID.test(requestId))return fail('操作編號不正確。',400);
    const audit=await db.prepare('SELECT raw_json FROM welfare_audit_events WHERE id=? AND actor_id=? AND event_type=?').bind(AUDIT_PREFIX+requestId,uid,EVENT_TYPE).first();
    const candidate=audit?parse(audit.raw_json,null):null,saved=candidate?.registration?.line_user_id===uid?candidate:null;
    return json({success:true,registrations:[],page:1,pages:1,page_size:50,total:0,operation:saved?{status:'cancelled',registration_id:saved.registration.id,event_id:saved.event.id,request_id:requestId}:{status:'not_found',request_id:requestId}});
  }
  // First read lightweight owner-scoped metadata. Filter the complete own set
  // before pagination; malformed times cannot silently enter the cancellable tab.
  const active=await db.prepare(`SELECT r.id,r.event_id,r.created_at,${eventSelect},EXISTS(SELECT 1 FROM welfare_activity_checkins c WHERE c.event_id=r.event_id AND c.line_user_id=r.line_user_id) AS checked
    FROM welfare_activity_registrations r LEFT JOIN welfare_activity_events e ON e.id=r.event_id WHERE r.line_user_id=?${registrationId?' AND r.id=?':''}`).bind(uid,...(registrationId?[registrationId]:[])).all();
  let metadata=(active.results||[]).map(row=>({kind:'active',...row,...ownCancellationState(eventOf(row),Boolean(row.checked)),sort_at:selfServiceTimestamp(row.created_at)||0}));
  if(filter==='cancellable')metadata=metadata.filter(row=>row.can_cancel);
  else {
    const history=await db.prepare(`SELECT id,created_at,json_extract(raw_json,'$.registration.id') AS registration_id
      FROM welfare_audit_events WHERE actor_id=? AND event_type=? AND json_extract(raw_json,'$.registration.line_user_id')=?${registrationId?" AND json_extract(raw_json,'$.registration.id')=?":''}`).bind(uid,EVENT_TYPE,uid,...(registrationId?[registrationId]:[])).all();
    metadata.push(...(history.results||[]).map(row=>({kind:'history',...row,sort_at:selfServiceTimestamp(row.created_at)||0})));
    // SQL returns metadata for the authenticated person's child only. Entire
    // administrator batch payloads and other participants never enter JS/results.
    const previous=await db.prepare(`SELECT a.id AS audit_id,a.created_at,j.key AS item_key,json_extract(${childJson},'$.id') AS registration_id
      FROM welfare_audit_events a JOIN ${adminChildren} j
      WHERE a.event_type=? AND a.actor_type IN ('admin','line_admin') AND a.target_type='activity' AND json_extract(${childJson},'$.line_user_id')=?
      AND json_type(${childJson},'$.id')='text' AND length(json_extract(${childJson},'$.id')) BETWEEN 1 AND 100
      ${registrationId?`AND json_extract(${childJson},'$.id')=?`:''}`).bind('activity.registration.cancel',uid,...(registrationId?[registrationId]:[])).all();
    metadata.push(...(previous.results||[]).map(row=>({kind:'admin_history',...row,id:row.audit_id+':'+row.item_key,sort_at:selfServiceTimestamp(row.created_at)||0})));
  }
  metadata.sort((a,b)=>b.sort_at-a.sort_at||a.id.localeCompare(b.id));
  const total=metadata.length,pages=Math.max(1,Math.ceil(total/50)),page=Math.min(Number(rawPage),pages),selected=metadata.slice((page-1)*50,page*50),items=[];
  const ids=selected.filter(row=>row.kind==='active').map(row=>row.id);
  const rows=ids.length?await db.prepare(liveSql+' WHERE r.line_user_id=? AND r.id IN (SELECT value FROM json_each(?))').bind(uid,JSON.stringify(ids)).all():{results:[]};
  const byId=new Map(rows.results.map(row=>[row.id,row]));
  const selfIds=selected.filter(row=>row.kind==='history').map(row=>row.id);
  const selfRows=selfIds.length?await db.prepare('SELECT id,raw_json,created_at FROM welfare_audit_events WHERE actor_id=? AND event_type=? AND id IN(SELECT value FROM json_each(?))').bind(uid,EVENT_TYPE,JSON.stringify(selfIds)).all():{results:[]};
  const selfById=new Map(selfRows.results.map(row=>[row.id,row]));
  const adminEntries=selected.filter(row=>row.kind==='admin_history');
  const adminRows=adminEntries.length?await db.prepare(`SELECT a.id AS audit_id,j.key AS item_key,a.created_at,a.target_id AS event_id,
    json_extract(a.raw_json,'$.event_title') AS event_title,e.start_at,e.end_at,e.location,e.status AS event_status,e.audience_scope,e.registration_end_at,
    ${childJson} AS registration_json FROM welfare_audit_events a JOIN ${adminChildren} j LEFT JOIN welfare_activity_events e ON e.id=a.target_id
    WHERE a.event_type=? AND a.actor_type IN ('admin','line_admin') AND a.target_type='activity' AND a.id IN(SELECT json_extract(value,'$.audit_id') FROM json_each(?))
      AND json_extract(${childJson},'$.line_user_id')=? AND EXISTS(SELECT 1 FROM json_each(?) selected WHERE json_extract(selected.value,'$.audit_id')=a.id AND json_extract(selected.value,'$.item_key')=j.key)`)
    .bind('activity.registration.cancel',JSON.stringify(adminEntries),uid,JSON.stringify(adminEntries)).all():{results:[]};
  const adminById=new Map(adminRows.results.map(row=>[row.audit_id+':'+row.item_key,row]));
  for(const entry of selected){
    if(entry.kind==='active'){
      const row=byId.get(entry.id);if(!row)continue;
      const state=ownCancellationState(eventOf(row),Boolean(row.checked));
      items.push(ownItem(row,state,await revisionOf(row)));
    }else{
      const audit=entry.kind==='history'?selfById.get(entry.id):adminById.get(entry.id);
      const saved=entry.kind==='history'?(audit?parse(audit.raw_json,null):null):(audit?{registration:parse(audit.registration_json,null),event:eventOf(audit)}:null);
      if(!saved?.registration||saved.registration.line_user_id!==uid)continue;
      items.push({id:saved.registration.id,registration_id:saved.registration.id,history_id:entry.id,status:'cancelled',event:saved.event,created_at:saved.registration.created_at,cancelled_at:audit.created_at,form_revision:saved.registration.form_revision,...details(saved.registration,true),can_cancel:false,cancel_block_reason:'cancelled',cancel_block_message:'此報名已取消。',cancel_revision:''});
    }
  }
  return json({success:true,registrations:items,page,pages,page_size:50,total});
}

async function readBody(request){
  if(Number(request.headers.get('Content-Length'))>6000)throw new Error('資料超過大小限制。');
  const reader=request.body?.getReader();if(!reader)throw new Error('缺少取消資料。');
  let size=0,body='';const decoder=new TextDecoder();
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>6000){await reader.cancel();throw new Error('資料超過大小限制。');}body+=decoder.decode(part.value,{stream:true});}
  return JSON.parse(body+decoder.decode());
}

async function cancelOwn(db,uid,body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','registration_id','event_id','cancel_revision','request_id','confirmed'].includes(key))||body.action!=='cancel_registration'||body.confirmed!==true||!UUID.test(body.request_id||'')||!REVISION.test(body.cancel_revision||'')||typeof body.registration_id!=='string'||!body.registration_id||body.registration_id.length>100||typeof body.event_id!=='string'||!body.event_id||body.event_id.length>100)return fail('請重新載入本人報名並確認取消。',400);
  const auditId=AUDIT_PREFIX+body.request_id;
  const match=audit=>{const saved=audit&&parse(audit.raw_json,null);return saved&&audit.actor_id===uid&&audit.event_type===EVENT_TYPE&&audit.target_id===body.event_id&&saved.registration.id===body.registration_id&&saved.cancel_revision===body.cancel_revision;};
  const completed=await db.prepare('SELECT actor_id,event_type,target_id,raw_json FROM welfare_audit_events WHERE id=?').bind(auditId).first();
  const success=replayed=>json({success:true,message:'報名已取消。',cancelled:true,replayed,registration_id:body.registration_id,event_id:body.event_id});
  if(completed)return match(completed)?success(true):fail('操作識別已使用，請重新載入。');
  const row=await db.prepare(liveSql+' WHERE r.id=? AND r.event_id=? AND r.line_user_id=?').bind(body.registration_id,body.event_id,uid).first();
  if(!row)return fail('找不到本人的有效報名，請重新載入。',404);
  const state=ownCancellationState(eventOf(row),Boolean(row.checked));
  if(!state.can_cancel)return fail(state.cancel_block_message);
  if(body.cancel_revision!==await revisionOf(row))return fail('報名或活動資料已更新，請重新載入後再確認取消。');
  const event=eventOf(row),audit=JSON.stringify({registration:snapshot(row),event,cancel_revision:body.cancel_revision,action:'cancel_registration'});
  if(new TextEncoder().encode(audit).length>150000)return fail('報名資料過大，請聯絡管理員處理。',413);
  const stamp=new Date().toISOString();
  const result=await db.batch([
    db.prepare(`INSERT INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
      SELECT ?,'member',?,?,'activity',?,'報名者取消本人報名',?,? FROM welfare_activity_registrations r
      JOIN welfare_activity_events e ON e.id=r.event_id WHERE r.id=? AND r.event_id=? AND r.line_user_id=?
      AND r.display_name IS ? AND r.form_revision IS ? AND r.schema_json IS ? AND r.answers_json IS ? AND r.created_at IS ?
      AND e.title IS ? AND e.start_at IS ? AND e.end_at IS ? AND e.location IS ? AND e.status IS ? AND e.audience_scope IS ? AND e.registration_end_at IS ?
      AND julianday(?)>julianday('now')
      AND NOT EXISTS(SELECT 1 FROM welfare_activity_checkins c WHERE c.event_id=r.event_id AND c.line_user_id=r.line_user_id)
      ON CONFLICT(id) DO NOTHING`).bind(auditId,uid,EVENT_TYPE,row.event_id,audit,stamp,row.id,row.event_id,uid,row.display_name,row.form_revision,row.schema_json,row.answers_json,row.created_at,row.event_title,row.start_at,row.end_at,row.location,row.event_status,row.audience_scope,row.registration_end_at,new Date(selfServiceTimestamp(row.start_at)).toISOString()),
    db.prepare(`DELETE FROM welfare_activity_registrations WHERE id=? AND event_id=? AND line_user_id=?
      AND EXISTS(SELECT 1 FROM welfare_audit_events WHERE id=? AND actor_id=? AND event_type=? AND target_id=? AND raw_json=?)`).bind(row.id,row.event_id,uid,auditId,uid,EVENT_TYPE,row.event_id,audit)
  ]);
  if(Number(result[0]?.meta?.changes)&&Number(result[1]?.meta?.changes))return success(false);
  const replay=await db.prepare('SELECT actor_id,event_type,target_id,raw_json FROM welfare_audit_events WHERE id=?').bind(auditId).first();
  return match(replay)?success(true):fail('報名、活動時間或簽到狀態已變更，本次未取消；請重新載入。');
}

export async function handleMyActivityRegistrations(request,env,deps){
  const url=new URL(request.url);
  if(url.pathname!=='/api/my-activity-registrations')return null;
  if(!['GET','POST'].includes(request.method))return fail('不支援此操作。',405);
  const origin=request.headers.get('Origin');
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return fail('請由活動專區操作。',403);
  const token=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return fail('請先使用本人 LINE 帳號登入。',401);
  try{
    const identity=await deps.verifyLine(env,token);
    if(!identity?.lineUserId)return fail('LINE 登入已失效，請重新登入。',401);
    if(!env.DB)return fail('報名資料暫時無法讀取，請稍後再試。',503);
    if(request.method==='GET')return await readList(env.DB,identity.lineUserId,url);
    let body;try{body=await readBody(request);}catch{return fail('取消資料格式不正確或超過限制。',400);}
    return await cancelOwn(env.DB,identity.lineUserId,body);
  }catch{return fail('操作結果暫時無法確認，請保留操作編號並重新查詢，不要重新發起取消。',503);}
}
