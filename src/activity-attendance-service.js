import { canRegisterForActivity } from "./activity-form-service.js";
import { activityKeywordTime } from "./activity-keyword-checkin.js";

const attendanceFailure = (code, message) => ({ success: false, code, message });

// Registration fields are custom and saved per revision. Only unambiguous total
// fields are recognized; individual age-group counts must never be guessed.
export function registeredPartyCount(registration) {
  try {
    const schema=JSON.parse(registration.schema_json), answers=JSON.parse(registration.answers_json);
    if(!Array.isArray(schema?.fields)||!answers||typeof answers!=='object'||Array.isArray(answers)) return {kind:'invalid'};
    const labels=new Set(['人數','報名人數','參加人數','參與人數','總人數','報名總人數','參加總人數','報名人數(包含員工本人)','報名人數（包含員工本人）']);
    const fields=schema.fields.filter(f=>labels.has(String(f.label||'').replace(/\s+/g,''))&&!f.showWhen);
    if(!fields.length)return {kind:'none'};
    if(fields.length!==1)return {kind:'ambiguous'};
    if(!['number','text','select'].includes(fields[0].type))return {kind:'invalid'};
    const raw=answers[fields[0].id];
    const text=String(raw??'').trim().replace(/[０-９]/g,c=>String(c.charCodeAt(0)-65296));
    if(!/^\d+$/.test(text))return {kind:'invalid'};
    const count=Number(text);return Number.isSafeInteger(count)&&count>=1&&count<=10000?{kind:'count',count}:{kind:'invalid'};
  } catch { return {kind:'invalid'}; }
}

export function storedAttendanceCount(payload) {
  try {const n=JSON.parse(payload||'{}').attendance_count;return Number.isSafeInteger(n)&&n>=1&&n<=10000?n:null;} catch{return null;}
}

export async function readActivityAttendanceCandidate(db, eventId, userId, now = Date.now()) {
  const event = await db.prepare("SELECT * FROM welfare_activity_events WHERE id = ?").bind(eventId).first();
  if (!event || event.status !== "active") return attendanceFailure("closed", "活動未啟用或已關閉。");
  const member = await db.prepare("SELECT member_type, status, bind_status FROM welfare_members WHERE line_user_id = ? LIMIT 1").bind(userId).first();
  if (!canRegisterForActivity(event, member)) return attendanceFailure("denied", "目前身分不符合活動資格。");
  const registration = await db.prepare("SELECT id, display_name, schema_json, answers_json FROM welfare_activity_registrations WHERE event_id = ? AND line_user_id = ?").bind(eventId, userId).first();
  if (!registration) return attendanceFailure("not_registered", "尚未報名此活動，不能核銷出席。");
  const previous = await db.prepare("SELECT id, checked_at, raw_payload FROM welfare_activity_checkins WHERE event_id = ? AND line_user_id = ?").bind(eventId, userId).first();
  const start = activityKeywordTime(event.checkin_start_at), end = activityKeywordTime(event.checkin_end_at);
  if (!previous) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return attendanceFailure("invalid_window", "尚未設定有效的簽到時間。");
    if (now < start) return attendanceFailure("not_started", "簽到尚未開始。");
    if (now > end) return attendanceFailure("ended", "簽到已截止。");
  }
  return { success: true, event, member, registration, previous, userId, start, end };
}

// Actor and userId must come from the authenticated server adapter, never a claimed role.
export async function commitActivityAttendance(db, candidate, { actor, source, qrToken = null, attendanceCount = null }) {
  const { event, member, registration, previous, userId, start, end } = candidate;
  if (previous) return { success: true, code: "already_checked_in", message: "已完成簽到，不會重複核銷。", data: { checked_at: previous.checked_at, display_name: registration.display_name, ...(storedAttendanceCount(previous.raw_payload)!==null?{attendance_count:storedAttendanceCount(previous.raw_payload)}:{}) } };
  const id = crypto.randomUUID();
  const audit = JSON.stringify({ source, actor, registration_id: registration.id, ...(attendanceCount!==null?{attendance_count:attendanceCount}:{}) });
  const saved = await db.prepare(`INSERT INTO welfare_activity_checkins
    (id,event_id,line_user_id,display_name,picture_url,checkin_status,checked_at,raw_payload)
    SELECT ?,e.id,?,r.display_name,'','checked_in',datetime('now','+8 hours'),?
    FROM welfare_activity_events e JOIN welfare_activity_registrations r ON r.event_id=e.id AND r.line_user_id=?
    WHERE e.id=? AND e.status='active' AND e.audience_scope=? AND e.checkin_start_at=? AND e.checkin_end_at=?
      AND r.id=? AND r.display_name IS ? AND (? IS NULL OR (r.schema_json IS ? AND r.answers_json IS ?)) AND (? IS NULL OR e.qr_token=?)
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=?))
        OR (?=1 AND EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=? AND member_type IS ? AND status IS ? AND bind_status IS ?)))
      AND julianday('now') BETWEEN julianday(?) AND julianday(?)
    ON CONFLICT(event_id,line_user_id) DO NOTHING`)
    .bind(id, userId, audit, userId, event.id, event.audience_scope, event.checkin_start_at, event.checkin_end_at,
      registration.id, registration.display_name, attendanceCount, registration.schema_json, registration.answers_json, qrToken, qrToken, member ? 1 : 0, userId, member ? 1 : 0, userId,
      member?.member_type ?? null, member?.status ?? null, member?.bind_status ?? null,
      new Date(start).toISOString(), new Date(end).toISOString()).run();
  const row = await db.prepare("SELECT id, checked_at, raw_payload FROM welfare_activity_checkins WHERE event_id = ? AND line_user_id = ?").bind(event.id, userId).first();
  if (!row) return attendanceFailure("state_changed", "資料或簽到時間已變更，請重新掃碼確認。");
  return { success: true, code: saved.meta?.changes ? "checked_in" : "already_checked_in",
    message: saved.meta?.changes ? "簽到成功，已核銷出席。本次不贈扣點數。" : "已完成簽到，不會重複核銷。",
    data: { checked_at: row.checked_at, display_name: registration.display_name, ...(storedAttendanceCount(row.raw_payload)!==null?{attendance_count:storedAttendanceCount(row.raw_payload)}:{}) } };
}
