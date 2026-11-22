import {SegmentPushError,readSegmentAudience,readSegmentRecipientGuard,recipientGuardForFilter,filterSegmentAudience,normalizeSegmentFilters,segmentOptions,needsVendorPushPolicy,needsVendorTagProjection,recipientIssueReasons,rejectRecipientIssues,reviewRecipientIssues} from './segment-audience.js';
import {registerSegmentInsights,segmentPushPayload} from './segment-push-insights.js';
export {SegmentPushError} from './segment-audience.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
const fail=(message,status=400)=>{throw new SegmentPushError(message,status);};
const nowOf=deps=>typeof deps.now==='function'?deps.now():Date.now();
export async function getSegmentPushDashboard(db,deps={}) {
  const users=await readSegmentAudience(db,{vendorPolicy:true,vendorDisplay:true}),templates=await deps.listTemplates?.(db)||[];
  return {success:true,data:{users,templates:Array.isArray(templates)?templates:templates.templates||[],tags:[...new Set(users.flatMap(user=>user.tags.split(',').filter(Boolean)))].sort(),options:segmentOptions(users),summary:{totalUsers:users.length,pushableUsers:users.length,bound:users.filter(user=>user.bind_status==='bound').length}}};
}
export async function readSegmentPushBody(request) {
  if(Number(request.headers.get('Content-Length'))>65000)fail('請求內容過大。',413);
  const reader=request.body?.getReader();if(!reader)fail('缺少請求內容。');
  let bytes=0,text='';const decoder=new TextDecoder();
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65000){void reader.cancel();fail('請求內容過大。',413);}text+=decoder.decode(part.value,{stream:true});}
  let body;try{body=JSON.parse(text+decoder.decode());}catch{fail('請求格式不正確。');}
  if(!body||typeof body!=='object'||Array.isArray(body))fail('請求格式不正確。');return body;
}
async function findPreview(db,actor,requestId) {
  if(!UUID.test(requestId||''))fail('操作編號不正確。');
  const preview=await db.prepare('SELECT * FROM welfare_push_previews WHERE request_id=? AND actor=?').bind(requestId,actor).first();
  if(!preview)fail('找不到本人確認的推播，請重新預覽。',404);return preview;
}
async function stateOf(db,preview,now) {
  const campaign=await db.prepare('SELECT id,title,recipient_count,success_count,failed_count,status,created_at FROM welfare_push_campaigns WHERE id=?').bind(preview.id).first();
  if(!campaign)return {status:'previewed',recipientCount:JSON.parse(preview.recipients_json).length,successCount:0,failedCount:0,unknownCount:0,notSentCount:0,request_id:preview.request_id,expires_at:preview.expires_at};
  const result=await db.prepare('SELECT id,line_user_id,status,response_status FROM welfare_push_deliveries WHERE campaign_id=? ORDER BY line_user_id').bind(preview.id).all();
  const rows=result.results||[],count=status=>rows.filter(row=>row.status===status).length;
  const started=Date.parse(campaign.created_at+(String(campaign.created_at).includes('T')?'':'Z'));
  const stale=campaign.status==='sending'&&(!Number.isFinite(started)||now-started>60000);
  const uncertain=stale||campaign.status==='needs_review';
  return {id:campaign.id,title:campaign.title,request_id:preview.request_id,status:stale?'needs_review':campaign.status,recipientCount:campaign.recipient_count,successCount:count('accepted'),failedCount:count('failed'),unknownCount:count('unknown')+(uncertain?count('sending')+Math.max(0,campaign.recipient_count-rows.length):0),notSentCount:count('not_sent'),results:rows.map(row=>({lineUserId:row.line_user_id,status:row.status,ok:row.status==='accepted',httpStatus:row.response_status})),message:uncertain?'結果待確認，請勿重新送出。':''};
}
export async function handleSegmentPush(request,db,env,deps={}) {
  const actor=typeof deps.actor==='string'?deps.actor:'';if(!actor)fail('沒有推播管理權限。',403);
  const body=await readSegmentPushBody(request),action=body.action;
  if(action==='status')return {success:true,data:await stateOf(db,await findPreview(db,actor,body.request_id),nowOf(deps))};
  if(action==='audience'||action==='preview') {
    const filters=normalizeSegmentFilters(body.filters),users=await readSegmentAudience(db,{vendor:needsVendorTagProjection(filters),vendorPolicy:needsVendorPushPolicy(filters),vendorDisplay:true});
    const matched=filterSegmentAudience(users,filters,{selected:action==='preview'});
    if(action==='audience')return {success:true,data:{recipients:matched.slice(0,filters.maxRecipients),matchedCount:matched.length}};
    if(matched.length!==filters.selectedLineUserIds.length){
      const currentIds=new Set(matched.map(user=>user.line_user_id));
      const issues=filters.selectedLineUserIds.filter(id=>!currentIds.has(id))
        .map(line_user_id=>({line_user_id,reason:recipientIssueReasons.filtered}));
      rejectRecipientIssues('有已勾選的受眾不符合目前條件，請核對名單。',issues,matched.length?409:400);
    }
    if(matched.length>filters.maxRecipients)fail('勾選受眾超過安全上限。');
    const title=typeof body.title==='string'?body.title.trim():'';if(!title||title.length>120)fail('請填寫 120 字以內的推播名稱。');
    if(!deps.buildMessages)fail('推播內容暫時無法驗證。',503);
    const messages=await deps.buildMessages(db,body.message||{});
    if(!Array.isArray(messages)||!messages.length||messages.length>5||JSON.stringify(messages).length>50000)fail('推播內容格式或大小不正確。');
    const created=nowOf(deps),expires=created+600000,id=crypto.randomUUID(),requestId=crypto.randomUUID();
    const deliveryMode=body.delivery_mode??'immediate';
    if(!['immediate','scheduled'].includes(deliveryMode))fail('傳送方式不正確。');
    const scheduledAt=body.scheduled_at;
    if(deliveryMode==='scheduled'&&(!Number.isSafeInteger(scheduledAt)||scheduledAt%60000!==0||scheduledAt<=created||scheduledAt>created+366*86400000))fail('請選擇一年內未來的整分鐘預約時間。');
    if(deliveryMode==='immediate'&&scheduledAt!==undefined)fail('立即傳送不可指定預約時間。');
    const recipients=matched.map(user=>({line_user_id:user.line_user_id,display_name:user.display_name,guard:recipientGuardForFilter(users,user.line_user_id,filters),retry_key:crypto.randomUUID()}));
    const revision=await hash({id,actor,requestId,title,filters,messages,recipients,created,expires,...(deliveryMode==='scheduled'?{deliveryMode,scheduledAt}:{})});
    const previewInsert=db.prepare('INSERT INTO welfare_push_previews(id,actor,request_id,revision,title,message_mode,filters_json,message_json,recipients_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,actor,requestId,revision,title,String(body.message?.mode||'official_text'),JSON.stringify(filters),JSON.stringify(messages),JSON.stringify(recipients),created,expires);
    if(deliveryMode==='scheduled')await db.batch([previewInsert,db.prepare("INSERT INTO welfare_push_schedule_intents(preview_id,delivery_mode,scheduled_at) VALUES(?,'scheduled',?)").bind(id,scheduledAt)]);
    else await previewInsert.run();
    return {success:true,data:{preview_id:id,preview_revision:revision,request_id:requestId,expires_at:expires,recipientCount:matched.length,recipients:matched,title,...(deliveryMode==='scheduled'?{delivery_mode:deliveryMode,scheduled_at:scheduledAt}:{}),messageSummary:messages.map(message=>message.type==='text'?message.text:message.type==='flex'?message.altText:'圖片訊息').join('\n')}};
  }
  if(action!=='send')fail('不支援的推播操作。');
  if(Object.keys(body).some(key=>!['action','preview_id','preview_revision','request_id','confirmed'].includes(key))||body.confirmed!==true)fail('請先預覽並確認固定的推播名單與內容。');
  const preview=await findPreview(db,actor,body.request_id);
  if(preview.id!==body.preview_id||preview.revision!==body.preview_revision)fail('預覽版本不正確，請重新預覽。',409);
  const existing=await db.prepare('SELECT id FROM welfare_push_campaigns WHERE id=?').bind(preview.id).first();
  if(existing)return {success:true,replayed:true,data:await stateOf(db,preview,nowOf(deps))};
  const scheduleIntent=await db.prepare('SELECT delivery_mode FROM welfare_push_schedule_intents WHERE preview_id=?').bind(preview.id).first();
  if(scheduleIntent)fail('這份預覽用於預約傳送，不能立即發送。',409);
  if(Number(preview.expires_at)<=nowOf(deps))fail('預覽已過期，請重新預覽。',409);
  const filters=JSON.parse(preview.filters_json),snapshot=JSON.parse(preview.recipients_json),messages=JSON.parse(preview.message_json);
  if(!snapshot.length||snapshot.length>500||new Set(snapshot.map(row=>row.line_user_id)).size!==snapshot.length)fail('預覽名單不正確。',409);
  const users=await readSegmentAudience(db,{vendor:needsVendorTagProjection(filters),vendorPolicy:needsVendorPushPolicy(filters),vendorDisplay:true}),fresh=filterSegmentAudience(users,filters,{selected:true});
  const issues=reviewRecipientIssues(users,fresh,filters,snapshot);
  if(issues.length){
    const reserved=await db.prepare('SELECT id FROM welfare_push_campaigns WHERE id=?').bind(preview.id).first();
    if(reserved)return {success:true,replayed:true,data:await stateOf(db,preview,nowOf(deps))};
    rejectRecipientIssues('受眾資料需核對，本次請求未發送。',issues);
  }
  if(!deps.transport&&!env.LINE_CHANNEL_ACCESS_TOKEN)fail('LINE 推播服務尚未設定。',503);
  const claim=await db.prepare(`INSERT OR IGNORE INTO welfare_push_campaigns(id,title,message_mode,filters_json,message_json,recipient_count,success_count,failed_count,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,0,'sending',?,?)`).bind(preview.id,preview.title,preview.message_mode,preview.filters_json,preview.message_json,snapshot.length,new Date(nowOf(deps)).toISOString(),new Date(nowOf(deps)).toISOString()).run();
  if(!claim.meta?.changes)return {success:true,replayed:true,data:await stateOf(db,preview,nowOf(deps))};
  const work=dispatch(db,env,deps,preview,snapshot,messages);
  if(deps.waitUntil)deps.waitUntil(work);
  await work;
  return {success:true,data:await stateOf(db,preview,nowOf(deps))};
}
// Only the trusted scheduler calls this entry after it atomically claims a schedule.
// It reuses the same recipient guards, campaign claim and per-recipient dispatcher as immediate sends.
export async function executeScheduledSegmentPush(db,env,deps,preview) {
  if (!preview || !deps?.schedulerClaimed || !Number.isSafeInteger(deps.schedulerClaimedAt)) fail('預約推播尚未取得執行權。',409);
  const filters=JSON.parse(preview.filters_json),snapshot=JSON.parse(preview.recipients_json),messages=JSON.parse(preview.message_json);
  if(!snapshot.length||snapshot.length>500||new Set(snapshot.map(row=>row.line_user_id)).size!==snapshot.length)fail('預約名單不正確。',409);
  const users=await readSegmentAudience(db,{vendor:needsVendorTagProjection(filters),vendorPolicy:needsVendorPushPolicy(filters),vendorDisplay:true}),fresh=filterSegmentAudience(users,filters,{selected:true});
  const issues=new Map(reviewRecipientIssues(users,fresh,filters,snapshot).map(row=>[row.line_user_id,row.reason]));
  if(!deps.transport&&!env.LINE_CHANNEL_ACCESS_TOKEN)fail('LINE 推播服務尚未設定。',503);
  if(typeof deps.actorAuthorized!=='function'||!await deps.actorAuthorized(preview.actor))fail('建立者的推播權限已失效，未發送。',403);
  const claimAt=deps.schedulerClaimedAt, leaseUntil=claimAt+45000, time=nowOf(deps);
  if(time>=leaseUntil)fail('預約處理時間已過，請查詢結果。',409);
  const now=new Date(time).toISOString();
  const claim=await db.prepare("UPDATE welfare_push_campaigns SET status='sending',created_at=?,updated_at=? WHERE id=? AND status='scheduled' AND EXISTS (SELECT 1 FROM welfare_push_schedules WHERE preview_id=? AND status='dispatching' AND claimed_at=?)").bind(now,now,preview.id,preview.id,claimAt).run();
  if(!claim.meta?.changes)fail('預約推播已處理或取消。',409);
  const schedulerGuard=async()=>{
    if(nowOf(deps)>=leaseUntil)return false;
    const current=await db.prepare("SELECT 1 FROM welfare_push_schedules s JOIN welfare_push_campaigns c ON c.id=s.preview_id WHERE s.preview_id=? AND s.status='dispatching' AND s.claimed_at=? AND c.status='sending'").bind(preview.id,claimAt).first();
    if(!current||nowOf(deps)>=leaseUntil)return false;
    return Boolean(await deps.actorAuthorized(preview.actor)) && nowOf(deps)<leaseUntil;
  };
  const work=dispatch(db,env,{...deps,schedulerGuard,schedulerLeaseUntil:leaseUntil},preview,snapshot,messages,issues);
  if(deps.waitUntil)deps.waitUntil(work);
  await work;
  return stateOf(db,preview,nowOf(deps));
}
async function dispatch(db,env,deps,preview,snapshot,messages,issues) {
  const outcomes=[];
  const filters=JSON.parse(preview.filters_json),memberType=filters.memberType,domestic=memberType==='employee_domestic',vendor=needsVendorTagProjection(filters),vendorPolicy=needsVendorPushPolicy(filters);
  try {
    // One bounded JSON insert instead of 500 separate D1 inserts.
    await db.prepare(`INSERT OR IGNORE INTO welfare_push_deliveries(id,campaign_id,line_user_id,display_name,status,response_status,response_body,created_at)
      SELECT json_extract(value,'$.retry_key'),?,json_extract(value,'$.line_user_id'),json_extract(value,'$.display_name'),'sending',0,'',datetime('now') FROM json_each(?)`).bind(preview.id,JSON.stringify(snapshot)).run();
    const persisted=await db.prepare('SELECT id,line_user_id FROM welfare_push_deliveries WHERE campaign_id=?').bind(preview.id).all();
    if(persisted.results.length!==snapshot.length||snapshot.some(row=>!persisted.results.some(saved=>saved.id===row.retry_key&&saved.line_user_id===row.line_user_id)))throw new Error('Delivery reservation mismatch');
    const unit=deps.transport||issues?.size===snapshot.length ? null : await registerSegmentInsights(db,preview.id,nowOf(deps));
    let cursor=0;const deadline=Date.now()+20000;
    const run=async()=>{
      for(;;){const index=cursor++;if(index>=snapshot.length)return;const row=snapshot[index];let status='not_sent',http=0,reason='本次處理時間已達上限，未發送。';
        let attempted=false;
        if(issues?.has(row.line_user_id)){
          reason=issues.get(row.line_user_id);
        } else if(Date.now()<deadline){
          try {
            if(await readSegmentRecipientGuard(db,row.line_user_id,domestic,vendor,vendorPolicy)!==row.guard){reason=recipientIssueReasons.changed;}
            else if(deps.schedulerGuard && (!await deps.schedulerGuard() || nowOf(deps)>=deps.schedulerLeaseUntil)){reason='預約權限或處理狀態已變更，未發送。';}
            else if(Date.now()<deadline){
              const timeout=Math.min(7000,Math.max(1,deadline-Date.now()),deps.schedulerGuard?Math.max(1,deps.schedulerLeaseUntil-nowOf(deps)):7000);
              let result;
              attempted=true;
              if(deps.transport)result=await deps.transport(row.line_user_id,messages,row.retry_key,timeout);
              else {const response=await (deps.fetchLine||fetch)('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json','X-Line-Retry-Key':row.retry_key},body:JSON.stringify(segmentPushPayload(row.line_user_id,messages,unit)),signal:AbortSignal.timeout(timeout)});result={ok:response.ok,status:response.status,requestId:response.headers.get('x-line-request-id')||'',acceptedRequestId:response.headers.get('x-line-accepted-request-id')||''};await response.body?.cancel();}
              http=Number(result.status)||0;
              status=result.ok||(http===409&&result.acceptedRequestId)?'accepted':http>=400&&http<500&&http!==409?'failed':'unknown';
              reason=status==='accepted'?'LINE API 已接受；不代表手機送達。':status==='failed'?'LINE API 拒絕此訊息。':'結果不明，禁止自動重送。';
            }
          }catch{
            if(!attempted)reason=recipientIssueReasons.unavailable;
            else {status='unknown';reason='結果待確認，禁止自動重送。';}
          }
        }
        outcomes.push({id:row.retry_key,status,http,reason});
      }
    };
    await Promise.all(Array.from({length:Math.min(5,snapshot.length)},run));
    // Save all outcomes in one statement, retaining original per-recipient retry keys.
    await db.prepare(`UPDATE welfare_push_deliveries SET
      status=(SELECT json_extract(value,'$.status') FROM json_each(?) WHERE json_extract(value,'$.id')=welfare_push_deliveries.id),
      response_status=(SELECT json_extract(value,'$.http') FROM json_each(?) WHERE json_extract(value,'$.id')=welfare_push_deliveries.id),
      response_body=(SELECT json_extract(value,'$.reason') FROM json_each(?) WHERE json_extract(value,'$.id')=welfare_push_deliveries.id)
      WHERE campaign_id=?`).bind(JSON.stringify(outcomes),JSON.stringify(outcomes),JSON.stringify(outcomes),preview.id).run();
    const accepted=outcomes.filter(row=>row.status==='accepted').length,failed=outcomes.filter(row=>row.status==='failed').length,unknown=outcomes.some(row=>row.status==='unknown');
    await db.prepare('UPDATE welfare_push_campaigns SET success_count=?,failed_count=?,status=?,updated_at=datetime(\'now\') WHERE id=?'+(deps.schedulerGuard?" AND status='sending'":'')).bind(accepted,failed,unknown?'needs_review':accepted===snapshot.length?'sent':'partial',preview.id).run();
  }catch{
    // Never re-open a claimed campaign, including after an ambiguous DB failure.
    try{await db.prepare("UPDATE welfare_push_campaigns SET status='needs_review',updated_at=datetime('now') WHERE id=?").bind(preview.id).run();}catch{/* A stale sending campaign is exposed as needs_review by statusOf. */}
  }
}
