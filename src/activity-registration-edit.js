import { validateActivityAnswers } from './activity-form-schema.js';
import { registrationWindowState } from './activity-registration-window.js';

export async function registrationEditRevision(row) {
  const raw = JSON.stringify([row.id,row.form_revision,row.schema_json,row.answers_json,row.created_at]);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function registrationEditState(db,event,row,clubPolicy) {
  const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='welfare_activity_checkins'").bind().first();
  const checked=table && await db.prepare('SELECT id FROM welfare_activity_checkins WHERE event_id=? AND line_user_id=? LIMIT 1').bind(event.id,row.line_user_id).first();
  return { can_edit:registrationWindowState(event)==='open' && !clubPolicy.announcements.has(event.id) && !checked,
    edit_revision:await registrationEditRevision(row), edit_block_reason:checked?'checked_in':registrationWindowState(event), hasCheckinTable:Boolean(table) };
}

// Called after LINE verification, membership eligibility, and own-row lookup.
// Keep the original form snapshot/id; edits cannot silently migrate old answers.
export async function updateOwnActivityRegistration(db,event,member,row,body,clubPolicy,state) {
  const fail=(message,status=409)=>({success:false,message,status});
  if(body.registration_id!==row.id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.request_id||'') || !/^[0-9a-f]{64}$/.test(body.edit_revision||'')) return fail('請重新載入本人報名資料後再修改。',400);
  let answers;
  try {answers=validateActivityAnswers(JSON.parse(row.schema_json),body.answers);} catch(error){return fail(error.message,400);}
  const answersJson=JSON.stringify(answers),auditId='activity-registration-edit:'+body.request_id;
  const audit={registration_id:row.id,before_revision:body.edit_revision,form_revision:row.form_revision,
    before:JSON.parse(row.answers_json),after:answers};
  const previous=await db.prepare('SELECT actor_id,target_id,raw_json FROM welfare_audit_events WHERE id=?').bind(auditId).first();
  const replay=entry=>entry && entry.actor_id===row.line_user_id && entry.target_id===event.id
    && JSON.parse(entry.raw_json).registration_id===row.id && JSON.parse(entry.raw_json).before_revision===body.edit_revision
    && JSON.stringify(JSON.parse(entry.raw_json).after)===answersJson;
  if(previous) return replay(previous)?{success:true,row,replayed:true}:{...fail('操作識別已使用，請重新載入。')};
  if(!state.can_edit)return fail(state.edit_block_reason==='checked_in'?'已完成簽到，報名資料無法再修改。':'此活動目前不開放修改報名。',400);
  if(body.edit_revision!==state.edit_revision)return fail('報名資料已更新，請重新載入後再修改。');
  const serialized=JSON.stringify(audit),now=new Date().toISOString();
  const result=await db.batch([
    db.prepare(`INSERT INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
      SELECT ?,'member',?,'activity.registration.edit','activity',?,'報名者修改本人報名資料',?,?
      FROM welfare_activity_registrations r WHERE r.id=? AND r.event_id=? AND r.line_user_id=?
      AND r.answers_json=? AND r.schema_json=? AND r.form_revision=? AND r.created_at=?
      AND EXISTS(SELECT 1 FROM welfare_activity_events e WHERE e.id=? AND e.status='active' AND e.audience_scope=?
        AND e.end_at IS ? AND e.registration_start_at IS ? AND e.registration_end_at IS ?
        AND (COALESCE(e.end_at,'')='' OR CASE WHEN e.end_at GLOB '*Z' OR e.end_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'
          THEN julianday(e.end_at) ELSE julianday(e.end_at,'-8 hours') END >= julianday('now'))
        AND (e.registration_start_at='' OR julianday(e.registration_start_at,'-8 hours')<=julianday('now'))
        AND (e.registration_end_at='' OR julianday(e.registration_end_at,'-8 hours')>julianday('now')))
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=?))
        OR (?=1 AND EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=? AND member_type IS ? AND status IS ? AND bind_status IS ?)))
      ${state.hasCheckinTable?'AND NOT EXISTS(SELECT 1 FROM welfare_activity_checkins WHERE event_id=? AND line_user_id=?)':''}
      ${clubPolicy.sql} ON CONFLICT(id) DO NOTHING`).bind(auditId,row.line_user_id,event.id,serialized,now,
        row.id,event.id,row.line_user_id,row.answers_json,row.schema_json,row.form_revision,row.created_at,
        event.id,event.audience_scope,event.end_at,event.registration_start_at,event.registration_end_at,
        member?1:0,row.line_user_id,member?1:0,row.line_user_id,member?.member_type??null,member?.status??null,member?.bind_status??null,
        ...(state.hasCheckinTable?[event.id,row.line_user_id]:[]),...(clubPolicy.sql?[event.id]:[])),
    db.prepare(`UPDATE welfare_activity_registrations SET answers_json=? WHERE id=? AND event_id=? AND line_user_id=? AND answers_json=?
      AND EXISTS(SELECT 1 FROM welfare_audit_events WHERE id=? AND actor_id=? AND target_id=? AND raw_json=?)`)
      .bind(answersJson,row.id,event.id,row.line_user_id,row.answers_json,auditId,row.line_user_id,event.id,serialized)
  ]);
  const saved=await db.prepare('SELECT * FROM welfare_activity_registrations WHERE id=? AND event_id=? AND line_user_id=?').bind(row.id,event.id,row.line_user_id).first();
  if(result[0]?.meta?.changes && result[1]?.meta?.changes)return {success:true,row:saved};
  const completed=await db.prepare('SELECT actor_id,target_id,raw_json FROM welfare_audit_events WHERE id=?').bind(auditId).first();
  return replay(completed)?{success:true,row:saved,replayed:true}:fail('報名資料已更新，請重新載入後再修改。');
}
