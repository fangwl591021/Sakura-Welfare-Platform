import { generateActivityForm, normalizeActivityForm, validateActivityAnswers } from "./activity-form-schema.js";
import { ACTIVITY_IMPORT_BODY_LIMIT, validateActivityImportFile, extractActivityImport } from "./activity-import.js";
import { extractActivityPdf } from "./activity-pdf-upload.js";
import { localizeActivityData } from "./activity-translation.js";
import { exportActivityRoster } from "./activity-roster-export.js";
import { registrationWindowState, REGISTRATION_WINDOW_MESSAGES } from "./activity-registration-window.js";
import { cancelActivityRegistrations, readRegistrationCancellationRevision } from "./activity-registration-cancellation.js";
import { clubRegistrationPolicy } from "./club-activity-policy.js";
import { EmployeeBindingAccessError } from "./employee-binding-auto-sync.js";
import { registrationEditState, updateOwnActivityRegistration } from "./activity-registration-edit.js";
import {editorRole,editorCanReadEvent} from './editor-access.js';
import { readActivityRosterPrefill, applyActivityRosterPrefill } from './activity-roster-prefill.js';
import { handleMyActivityRegistrations } from './activity-self-service.js';

const latestFormSql = `SELECT * FROM welfare_activity_forms WHERE event_id = ? ORDER BY revision DESC LIMIT 1`;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store" }
});
const denied = () => json({ success: false, message: "無權限，請使用已授權帳號登入。" }, 403);
const bearer = request => (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1].trim() || "";

export async function authorizeActivityFormAdmin(request, db, env, deps) {
  const path=new URL(request.url).pathname;
  const clubDomain=path==='/admin-api/clubs'||path==='/admin-api/club-media'||path.startsWith('/club-media/');
  const editorActor=(role,id)=>editorRole(role)&&role!=='welfare_editor'&&(!clubDomain||role==='club_editor')?'editor:'+role+':'+id:null;
  const token = bearer(request);
  if (token) {
    const auth = await deps.requireAdmin({ sessionToken: token }, db);
    if (auth?.ok && auth.user?.role === "admin") return "admin:" + auth.user.id;
    if(auth?.ok&&editorRole(auth.user?.role))return editorActor(auth.user.role,auth.user.id);
  }
  const identity = await deps.verifyLine(env, request.headers.get("X-Line-Id-Token"));
  if (!identity?.lineUserId) return null;
  const row = await deps.findAdmin(db, identity.lineUserId);
  if (!row || Number(row.active) !== 1) return null;
  if(editorRole(row.role))return editorActor(row.role,identity.lineUserId);
  // Existing whitelist rules treat an empty module list as full access.
  const modules = (String(row.allowed_modules || "").trim() || "*").split(",").map(v => v.trim());
  if (!modules.some(v => ["*","activity-calendar","activity-checkin","activities",...(clubDomain?["clubs"]:[])].includes(v))) return null;
  return "line:" + identity.lineUserId;
}

export function canRegisterForActivity(event, member) {
  let audience;
  try { audience = Array.isArray(event.audience_scope) ? event.audience_scope : JSON.parse(event.audience_scope || '["all"]'); }
  catch { return false; }
  if (!Array.isArray(audience)) return false;
  if (audience.includes("all")) return true;
  const bound = member?.status === "active" && member?.bind_status === "bound";
  const type = bound ? member.member_type : "visitor";
  if (audience.includes("visitor") && type === "visitor") return true;
  if (audience.includes("employee") && ["employee", "foreign_employee", "manager"].includes(type)) return true;
  return audience.includes("manager") && type === "manager";
}

function publicEvent(row) {
  return { id: row.id, title: row.title, description: row.description, location: row.location,
    start_at: row.start_at, end_at: row.end_at, cover_image_url: row.cover_image_url || "",
    registration_start_at: row.registration_start_at || "", registration_end_at: row.registration_end_at || "" };
}

function ownRegistration(row) {
  if (!row) return null;
  return { id: row.id, form_revision: row.form_revision, schema: JSON.parse(row.schema_json),
    answers: JSON.parse(row.answers_json), created_at: row.created_at };
}

function attendanceCountFromPayload(payload) {
  try { const n=JSON.parse(payload||'{}').attendance_count; return Number.isSafeInteger(n)&&n>=1&&n<=10000?n:null; } catch { return null; }
}

async function readBody(request, limit = 65000) {
  if (Number(request.headers.get("Content-Length") || 0) > limit) throw new Error("資料超過大小限制。");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("缺少資料。");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("資料超過大小限制。"); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder().decode(all));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid body");
    return data;
  }
  catch { throw new Error("資料格式不正確。"); }
}

const invalid = message => json({ success: false, message }, 400);
const conflict = () => json({ success: false, message: "欄位版本已更新，請重新載入後再確認。" }, 409);

async function activityImportRequest(request, env, deps) {
  if (!await authorizeActivityFormAdmin(request, env.DB, env, deps)) return denied();
  const isPdf = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "application/pdf";
  let file;
  try { if (!isPdf) file = validateActivityImportFile((await readBody(request, ACTIVITY_IMPORT_BODY_LIMIT)).file); }
  catch (error) { return invalid(error.message); }
  try {
    const result = isPdf ? await extractActivityPdf(request, env, deps.callAiContent, deps.fetchAiFile)
      : await extractActivityImport(env, file, deps.callAiContent);
    return json({ success: true, ...result });
  } catch (error) {
    if (isPdf && [400, 413].includes(error.status)) return json({ success: false, message: error.message }, error.status);
    const timeout = ["TimeoutError", "AbortError"].includes(error.name);
    return json({ success: false, message: timeout ? "AI 辨識逾時，原表單未變更，請稍後重試。"
      : "無法辨識活動資料，請提供清晰的單一活動 DM／PDF，或稍後重試。原表單未變更。" }, 502);
  }
}

async function adminRequest(request, env, deps) {
  const db = env.DB;
  const url = new URL(request.url);
  const actor = await authorizeActivityFormAdmin(request, db, env, deps);
  if (!actor) return denied();
  let body = {};
  if (request.method === "POST") {
    try { body = await readBody(request); } catch (error) { return invalid(error.message); }
  }
  const eventId = request.method === "GET" ? new URL(request.url).searchParams.get("event_id") : body.event_id;
  if (typeof eventId !== "string" || !eventId || eventId.length > 100) return invalid("請先儲存並選取活動。");
  if(!await editorCanReadEvent(db,actor,eventId))return denied();
  const event = await db.prepare("SELECT id, title, start_at, end_at, location FROM welfare_activity_events WHERE id = ?").bind(eventId).first();
  if (!event) return json({ success: false, message: "找不到活動。" }, 404);
  if (request.method === "POST" && ["cancel_registration", "cancel_all_registrations"].includes(body.action)) {
    if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return denied();
    return cancelActivityRegistrations(db, event, actor, body);
  }
  if (request.method === "GET" && url.searchParams.has("export")) {
    const format = url.searchParams.get("export");
    if (!["xlsx", "csv", "print"].includes(format)) return json({ success: false, message: "不支援的名冊格式。" }, 400);
    return exportActivityRoster(db, event, format);
  }
  if (request.method === "POST" && body.action === "generate") {
    try {
      return json({ success: true, ...await generateActivityForm(env, body.requirements, deps.callAi) });
    } catch (error) {
      const message = error.name === "TimeoutError" || error.name === "AbortError"
        ? "AI 生成逾時，請稍後重試；目前草稿已保留。"
        : "AI 暫時無法產生有效欄位，請確認需求或使用手動新增。";
      return json({ success: false, message }, 502);
    }
  }
  const current = await db.prepare(latestFormSql).bind(eventId).first();
  if (request.method === "GET") {
    const requestedPage = Number(url.searchParams.get('roster_page') || 1);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) return invalid('報名名單頁碼無效。');
    const count = await db.prepare(`SELECT COUNT(*) AS total, COUNT(c.id) AS checked_in,
      SUM(CASE WHEN json_valid(c.raw_payload) THEN CASE WHEN json_type(c.raw_payload,'$.attendance_count')='integer' AND json_extract(c.raw_payload,'$.attendance_count') BETWEEN 1 AND 10000 THEN json_extract(c.raw_payload,'$.attendance_count') ELSE 0 END ELSE 0 END) AS attendance_people,
      SUM(CASE WHEN c.id IS NULL THEN 0 WHEN json_valid(c.raw_payload) THEN CASE WHEN json_type(c.raw_payload,'$.attendance_count')='integer' AND json_extract(c.raw_payload,'$.attendance_count') BETWEEN 1 AND 10000 THEN 0 ELSE 1 END ELSE 1 END) AS attendance_unknown
      FROM welfare_activity_registrations r LEFT JOIN welfare_activity_checkins c ON c.event_id=r.event_id AND c.line_user_id=r.line_user_id
      WHERE r.event_id = ?`).bind(eventId).first();
    const total = Number(count?.total || 0), checkedIn = Number(count?.checked_in || 0);
    const pages = Math.max(1, Math.ceil(total / 100)), page = Math.min(requestedPage, pages);
    const rows = await db.prepare(`SELECT r.id, r.display_name, r.form_revision, r.schema_json, r.answers_json, r.created_at,
      c.id AS checkin_id, c.checked_at, c.raw_payload AS checkin_payload
      FROM welfare_activity_registrations r LEFT JOIN welfare_activity_checkins c ON c.event_id=r.event_id AND c.line_user_id=r.line_user_id
      WHERE r.event_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100 OFFSET ?`).bind(eventId, (page - 1) * 100).all();
    return json({ success: true, event, revision: current?.revision || 0,
      schema: current ? JSON.parse(current.schema_json) : { version: 1, fields: [], rules: [] },
      registration_count: total, checked_in_count: checkedIn, not_checked_in_count: total - checkedIn,
      attendance_people: Number(count?.attendance_people || 0), attendance_unknown: Number(count?.attendance_unknown || 0),
      roster_page: page, roster_pages: pages,
      roster_revision: await readRegistrationCancellationRevision(db, eventId),
      registrations: (rows.results || []).map(row => ({ ...ownRegistration(row), display_name: row.display_name,
        checked_in: Boolean(row.checkin_id), checked_at: row.checkin_id ? row.checked_at || '' : '', attendance_count: row.checkin_id ? attendanceCountFromPayload(row.checkin_payload) : null })) });
  }
  if (body.action !== "save" || body.confirmed !== true) return invalid("請預覽並確認儲存報名欄位。");
  let schema;
  try { schema = normalizeActivityForm(body.schema); } catch (error) { return invalid(error.message); }
  if (!schema.fields.length) return invalid("至少需要一個報名欄位。");
  if (!Number.isSafeInteger(body.revision) || body.revision !== (current?.revision || 0)) return conflict();
  const revision = body.revision + 1;
  // The conditional INSERT makes revision checks atomic across concurrent editors.
  const saved = await db.prepare(`INSERT INTO welfare_activity_forms(event_id, revision, schema_json, created_by, created_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM welfare_activity_events WHERE id = ?)
    AND COALESCE((SELECT MAX(revision) FROM welfare_activity_forms WHERE event_id = ?), 0) = ?
    ON CONFLICT(event_id, revision) DO NOTHING`).bind(eventId, revision, JSON.stringify(schema), actor,
    new Date().toISOString(), eventId, eventId, body.revision).run();
  if (!saved.meta?.changes) return conflict();
  return json({ success: true, schema, revision, message: "報名欄位已儲存。" });
}

async function registrationRequest(request, env, deps) {
  const identity = await deps.verifyLine(env, bearer(request));
  if (!identity?.lineUserId) return denied();
  await deps.ensureEmployeeBinding?.(identity.lineUserId);
  const db = env.DB;
  const member = await db.prepare("SELECT member_type, status, bind_status, employee_no, line_user_id FROM welfare_members WHERE line_user_id = ? LIMIT 1")
    .bind(identity.lineUserId).first();
  const clubPolicy = await clubRegistrationPolicy(db);
  let body = {};
  if (request.method === "POST") {
    try { body = await readBody(request); } catch (error) { return invalid(error.message); }
  }
  const eventId = request.method === "GET" ? new URL(request.url).searchParams.get("event_id") : body.event_id;
  if (!eventId && request.method === "GET") {
    const rows = await db.prepare(`SELECT e.* FROM welfare_activity_events e WHERE status = 'active'
      AND EXISTS(SELECT 1 FROM welfare_activity_forms f WHERE f.event_id = e.id) ORDER BY start_at LIMIT 100`).all();
    const events = (rows.results || []).flatMap(event => {
      const state = registrationWindowState(event);
      if (!["open", "not_started"].includes(state) || !canRegisterForActivity(event, member) || clubPolicy.announcements.has(event.id)) return [];
      return [{ ...publicEvent(event), registration_state: state }];
    });
    return json({ success: true, events });
  }
  if (typeof eventId !== "string" || !eventId || eventId.length > 100) return invalid("請選取活動。");
  const event = await db.prepare("SELECT * FROM welfare_activity_events WHERE id = ?").bind(eventId).first();
  if (!event || !canRegisterForActivity(event, member)) return denied();
  const ownSql = "SELECT * FROM welfare_activity_registrations WHERE event_id = ? AND line_user_id = ?";
  const existing = await db.prepare(ownSql).bind(eventId, identity.lineUserId).first();
  if (existing) {
    const edit=await registrationEditState(db,event,existing,clubPolicy);
    if(request.method==='POST' && body.action==='update_registration') {
      if(request.headers.get('Origin') && request.headers.get('Origin')!==new URL(request.url).origin)return denied();
      const result=await updateOwnActivityRegistration(db,event,member,existing,body,clubPolicy,edit);
      if(!result.success)return json({success:false,message:result.message},result.status);
      const updated=await registrationEditState(db,event,result.row,clubPolicy);
      return json({success:true,event:publicEvent(event),registration:ownRegistration(result.row),can_edit:updated.can_edit,
        edit_revision:updated.edit_revision,updated:true,replayed:!!result.replayed,message:'報名修改已儲存。'});
    }
    return json({ success:true,event:publicEvent(event),registration:ownRegistration(existing),can_edit:edit.can_edit,
      edit_revision:edit.edit_revision,edit_block_reason:edit.edit_block_reason,message:'您已完成報名。' });
  }
  if(request.method==='POST' && body.action==='update_registration')return json({success:false,message:'此報名已取消或不存在，請重新載入。'},409);
  if (clubPolicy.announcements.has(eventId)) {
    return request.method === "GET" ? json({ success: true, event: publicEvent(event), registrationState: "not_started" }) : invalid(REGISTRATION_WINDOW_MESSAGES.unavailable);
  }
  const windowState = registrationWindowState(event);
  if (windowState !== "open") {
    if (request.method === "GET" && ["not_started", "closed"].includes(windowState)) {
      return json({ success: true, event: publicEvent(event), registrationState: windowState });
    }
    return invalid(REGISTRATION_WINDOW_MESSAGES[windowState]);
  }
  const form = await db.prepare(latestFormSql).bind(eventId).first();
  if (!form) return invalid("此活動尚未設定報名欄位。");
  const schema = JSON.parse(form.schema_json);
  if (request.method === "GET") {
    const prefill = await readActivityRosterPrefill(db, member, schema);
    return json({ success: true, event: publicEvent(event), schema, revision: form.revision, prefill });
  }
  if (body.revision !== form.revision) return conflict();
  const prefill = await readActivityRosterPrefill(db, member, schema);
  let answers;
  try { answers = validateActivityAnswers(schema, applyActivityRosterPrefill(body.answers, prefill)); } catch (error) { return invalid(error.message); }
  await db.prepare(`INSERT INTO welfare_activity_registrations
    (id, event_id, line_user_id, display_name, form_revision, schema_json, answers_json, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT MAX(revision) FROM welfare_activity_forms WHERE event_id = ?) = ?
    AND EXISTS(SELECT 1 FROM welfare_activity_events WHERE id = ? AND status = 'active' AND end_at IS ?
      AND registration_start_at IS ? AND registration_end_at IS ?
      AND (registration_start_at = '' OR julianday(registration_start_at, '-8 hours') <= julianday('now'))
      AND (registration_end_at = '' OR julianday(registration_end_at, '-8 hours') > julianday('now')))${clubPolicy.sql}
    ON CONFLICT(event_id, line_user_id) DO NOTHING`).bind(crypto.randomUUID(), eventId, identity.lineUserId,
    identity.displayName || "", form.revision, JSON.stringify(schema), JSON.stringify(answers),
    new Date().toISOString(), eventId, form.revision, eventId, event.end_at,
    event.registration_start_at, event.registration_end_at, ...(clubPolicy.sql ? [eventId] : [])).run();
  const saved = await db.prepare(ownSql).bind(eventId, identity.lineUserId).first();
  if (!saved) {
    const current = await db.prepare("SELECT * FROM welfare_activity_events WHERE id = ?").bind(eventId).first();
    if (!current || !canRegisterForActivity(current, member)) return denied();
    const state = registrationWindowState(current);
    return state !== "open" ? invalid(REGISTRATION_WINDOW_MESSAGES[state]) : conflict();
  }
  const edit=await registrationEditState(db,event,saved,clubPolicy);
  return json({ success:true,event:publicEvent(event),registration:ownRegistration(saved),can_edit:edit.can_edit,edit_revision:edit.edit_revision,message:'報名完成。' });
}

export async function handleActivityFormRequest(request, env, deps) {
  if (new URL(request.url).pathname === '/api/my-activity-registrations') return handleMyActivityRegistrations(request, env, deps);
  const path = new URL(request.url).pathname;
  if (!["/admin-api/activity-form", "/api/activity-registration", "/admin-api/activity-import"].includes(path)) return null;
  if (!["GET", "POST"].includes(request.method)) return json({ success: false, message: "不支援的操作。" }, 405);
  if (path === "/admin-api/activity-import" && request.method !== "POST") return json({ success: false, message: "請使用檔案匯入。" }, 405);
  try {
    if (!env.DB) throw new Error("DB unavailable");
    if (path === "/admin-api/activity-import") return await activityImportRequest(request, env, deps);
    const response = await (path === "/admin-api/activity-form" ? adminRequest : registrationRequest)(request, env, deps);
    // Translation only sees the already-authorized GET result. It never affects canonical answers or writes.
    if (path === "/api/activity-registration" && request.method === "GET" && response.ok) {
      const url = new URL(request.url);
      return json(await localizeActivityData(await response.json(), url.searchParams.get("lang"), env, deps.callAi,
        { origin: url.origin, ...(deps.translationCache ? { cache: deps.translationCache } : {}) }));
    }
    return response;
  } catch (error) {
    // Do not return SQL, credentials, identity records or provider errors to clients.
    if (error instanceof EmployeeBindingAccessError) return json({ success:false,code:error.code,message:error.message,retryable:error.status===503 },error.status);
    return json({ success: false, message: "報名欄位服務暫時無法使用，請稍後再試或聯絡管理員。" }, 503);
  }
}
