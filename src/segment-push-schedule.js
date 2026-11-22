import {SegmentPushError,executeScheduledSegmentPush} from './segment-push.js';
import {readSegmentAudience,filterSegmentAudience,needsVendorPushPolicy,needsVendorTagProjection,rejectRecipientIssues,reviewRecipientIssues} from './segment-audience.js';

const nowOf = deps => typeof deps.now === 'function' ? deps.now() : Date.now();
const fail = (message,status=400) => { throw new SegmentPushError(message,status); };
const maxDelay = 15 * 60 * 1000;
const maxFuture = 366 * 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function owner(deps) { if(typeof deps?.actor !== 'string'||!deps.actor) fail('沒有推播管理權限。',403); return deps.actor; }
function confirmedPreview(body) {
  if(!body||body.confirmed!==true||!uuid.test(body.preview_id||'')||!uuid.test(body.request_id||'')||!/^[0-9a-f]{64}$/i.test(body.preview_revision||''))fail('請先預覽並確認固定的推播名單與內容。');
  if(Object.keys(body).some(key=>!['action','preview_id','preview_revision','request_id','scheduled_at','confirmed'].includes(key)))fail('預約資料包含不允許的欄位。');
}
async function currentPreview(db,actor,body,now) {
  const preview=await db.prepare("SELECT p.* FROM welfare_push_previews p JOIN welfare_push_schedule_intents i ON i.preview_id=p.id WHERE p.id=? AND p.actor=? AND p.request_id=? AND p.revision=? AND i.delivery_mode='scheduled' AND i.scheduled_at=?").bind(body.preview_id,actor,body.request_id,body.preview_revision,body.scheduled_at).first();
  if(!preview)fail('找不到本人確認的預覽，請重新預覽。',409);
  if(Number(preview.expires_at)<=now)fail('預覽已過期，請重新預覽。',409);
  const filters=JSON.parse(preview.filters_json),snapshot=JSON.parse(preview.recipients_json);
  if(!snapshot.length||snapshot.length>500||new Set(snapshot.map(row=>row.line_user_id)).size!==snapshot.length)fail('預覽名單不正確。',409);
  const users=await readSegmentAudience(db,{vendor:needsVendorTagProjection(filters),vendorPolicy:needsVendorPushPolicy(filters),vendorDisplay:true}),fresh=filterSegmentAudience(users,filters,{selected:true});
  const issues=reviewRecipientIssues(users,fresh,filters,snapshot);
  if(issues.length)rejectRecipientIssues('受眾資料需核對，這筆預約尚未建立。',issues);
  return preview;
}
export async function createSegmentSchedule(db,deps,body) {
  const actor=owner(deps),now=nowOf(deps);confirmedPreview(body);
  const due=Number(body.scheduled_at);
  if(!Number.isSafeInteger(due)||due%60000!==0||due<=now||due>now+maxFuture)fail('請選擇一年內未來的整分鐘預約時間。');
  const old=await db.prepare('SELECT * FROM welfare_push_schedules WHERE preview_id=? AND actor=?').bind(body.preview_id,actor).first();
  if(old){if(old.scheduled_at===due&&old.request_id===body.request_id&&old.preview_revision===body.preview_revision)return {success:true,replayed:true,data:publicSchedule(old)};fail('此預覽已預約，請重新預覽後操作。',409);}
  const preview=await currentPreview(db,actor,body,now),count=JSON.parse(preview.recipients_json).length;
  const writeNow=nowOf(deps);
  if(Number(preview.expires_at)<=writeNow||due<=writeNow)fail('預覽或預約時間已過，請重新確認。',409);
  const iso=new Date(writeNow).toISOString(), clockOverride=typeof deps.now==='function'?writeNow:null;
  try {
    // The time is rechecked by D1 in the same transaction that reserves the campaign.
    // The clock override is only supplied by isolated tests; production uses SQLite UTC.
    const result=await db.batch([
      db.prepare(`INSERT INTO welfare_push_campaigns(id,title,message_mode,filters_json,message_json,recipient_count,success_count,failed_count,status,created_at,updated_at)
        SELECT ?,?,?,?,?,?,0,0,'scheduled',?,? FROM welfare_push_previews p
        WHERE p.id=? AND p.actor=? AND p.request_id=? AND p.revision=?
        AND EXISTS (SELECT 1 FROM welfare_push_schedule_intents i WHERE i.preview_id=p.id AND i.delivery_mode='scheduled' AND i.scheduled_at=?)
        AND p.expires_at>COALESCE(?,(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
        AND ?>COALESCE(?,(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))`)
        .bind(preview.id,preview.title,preview.message_mode,preview.filters_json,preview.message_json,count,iso,iso,preview.id,actor,preview.request_id,preview.revision,due,clockOverride,due,clockOverride),
      db.prepare(`INSERT INTO welfare_push_schedules(id,preview_id,actor,request_id,preview_revision,scheduled_at,status,created_at,updated_at)
        SELECT ?,?,?,?,?,?,'scheduled',?,? WHERE changes()=1`).bind(preview.id,preview.id,actor,preview.request_id,preview.revision,due,writeNow,writeNow)
    ]);
    if(!result[0].meta?.changes||!result[1].meta?.changes)fail('預覽或預約時間已過，請重新確認。',409);
  } catch(error) { if(error instanceof SegmentPushError)throw error;fail('此預覽已被使用，請查詢結果後再操作。',409); }
  return {success:true,data:publicSchedule(await db.prepare('SELECT s.*,c.title,c.recipient_count FROM welfare_push_schedules s JOIN welfare_push_campaigns c ON c.id=s.preview_id WHERE s.id=?').bind(preview.id).first())};
}
function publicSchedule(row) { return {id:row.id,preview_id:row.preview_id,request_id:row.request_id,scheduled_at:row.scheduled_at,status:row.status,created_at:row.created_at,updated_at:row.updated_at,last_error:row.last_error||'',title:row.title||'',recipient_count:row.recipient_count??0}; }
export async function listSegmentSchedules(db,deps) {
  const actor=owner(deps),result=await db.prepare('SELECT s.*,c.title,c.recipient_count FROM welfare_push_schedules s JOIN welfare_push_campaigns c ON c.id=s.preview_id WHERE s.actor=? ORDER BY s.created_at DESC LIMIT 100').bind(actor).all();
  return {success:true,data:(result.results||[]).map(publicSchedule)};
}
export async function cancelSegmentSchedule(db,deps,body) {
  const actor=owner(deps),now=nowOf(deps),id=String(body?.schedule_id||'');if(!uuid.test(id))fail('預約編號不正確。');
  const result=await db.batch([
    db.prepare("UPDATE welfare_push_schedules SET status='cancelled',updated_at=? WHERE id=? AND actor=? AND status='scheduled' AND EXISTS (SELECT 1 FROM welfare_push_campaigns WHERE id=? AND status='scheduled')").bind(now,id,actor,id),
    db.prepare("UPDATE welfare_push_campaigns SET status='cancelled',updated_at=? WHERE id=? AND status='scheduled' AND EXISTS (SELECT 1 FROM welfare_push_schedules WHERE id=? AND actor=? AND status='cancelled' AND updated_at=?)").bind(new Date(now).toISOString(),id,id,actor,now)
  ]);
  if(!result[0].meta?.changes)fail('預約不存在，或已開始處理而無法取消。',409);
  if(!result[1].meta?.changes)throw new Error('Cancel state mismatch');
  return {success:true,data:publicSchedule(await db.prepare('SELECT s.*,c.title,c.recipient_count FROM welfare_push_schedules s JOIN welfare_push_campaigns c ON c.id=s.preview_id WHERE s.id=? AND s.actor=?').bind(id,actor).first())};
}
async function markReview(db,id,now,reason) {
  await db.batch([
    db.prepare("UPDATE welfare_push_schedules SET status='needs_review',updated_at=?,last_error=? WHERE id=? AND status='dispatching'").bind(now,reason,id),
    db.prepare("UPDATE welfare_push_campaigns SET status='needs_review',updated_at=? WHERE id=? AND status IN ('scheduled','sending')").bind(new Date(now).toISOString(),id)
  ]);
}
export async function runDueSegmentSchedules(db,env,deps={}) {
  if(typeof deps.actorAuthorized!=='function')throw new Error('Scheduler actor authorization is required');
  const now=nowOf(deps);
  // A claimed job is never automatically retried: its LINE outcome may be unknown.
  await db.batch([
    db.prepare("UPDATE welfare_push_campaigns SET status='needs_review',updated_at=? WHERE status IN ('scheduled','sending') AND id IN (SELECT preview_id FROM welfare_push_schedules WHERE status='dispatching' AND claimed_at<?)").bind(new Date(now).toISOString(),now-60000),
    db.prepare("UPDATE welfare_push_schedules SET status='needs_review',updated_at=?,last_error='處理結果待確認，未自動重送。' WHERE status='dispatching' AND claimed_at<?").bind(now,now-60000)
  ]);
  const result=await db.prepare("SELECT * FROM welfare_push_schedules WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at,id LIMIT 3").bind(now).all();
  // Dispatch at most three due campaigns concurrently, while each retains its own atomic claim.
  const outcomes=await Promise.all((result.results||[]).map(async row=>{
    const claimNow=nowOf(deps);
    const claim=await db.prepare("UPDATE welfare_push_schedules SET status='dispatching',claimed_at=?,updated_at=? WHERE id=? AND status='scheduled' AND scheduled_at<=?").bind(claimNow,claimNow,row.id,claimNow).run();
    if(!claim.meta?.changes)return null;
    try {
      if(claimNow-row.scheduled_at>maxDelay)throw new Error('預約逾時，請重新確認後操作。');
      if(!await deps.actorAuthorized(row.actor))throw new Error('建立者的推播權限已失效，未發送。');
      const preview=await db.prepare("SELECT p.* FROM welfare_push_previews p JOIN welfare_push_schedule_intents i ON i.preview_id=p.id WHERE p.id=? AND p.actor=? AND p.request_id=? AND p.revision=? AND i.delivery_mode='scheduled' AND i.scheduled_at=?").bind(row.preview_id,row.actor,row.request_id,row.preview_revision,row.scheduled_at).first();
      if(!preview)throw new Error('原預覽已失效，未發送。');
      const state=await executeScheduledSegmentPush(db,env,{...deps,schedulerClaimed:true,schedulerClaimedAt:claimNow},preview);
      const terminal=['sent','partial','needs_review'].includes(state.status)?state.status:'needs_review';
      await db.prepare("UPDATE welfare_push_schedules SET status=?,updated_at=?,last_error=? WHERE id=? AND status='dispatching'").bind(terminal,nowOf(deps),terminal==='needs_review'?'發送結果待確認，未自動重送。':'',row.id).run();
      return {id:row.id,status:terminal};
    } catch(error) {
      const safeReasons=new Set(['預約逾時，請重新確認後操作。','建立者的推播權限已失效，未發送。','原預覽已失效，未發送。']);
      const reason=error instanceof SegmentPushError?error.message:safeReasons.has(error?.message)?error.message:'處理結果待確認，未自動重送。';
      await markReview(db,row.id,nowOf(deps),reason.slice(0,200));return {id:row.id,status:'needs_review'};
    }
  }));
  return outcomes.filter(Boolean);
}
