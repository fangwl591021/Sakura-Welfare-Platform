import { authorizeActivityFormAdmin } from "./activity-form-service.js";
import { activityKeywordTime } from "./activity-keyword-checkin.js";
import { readActivityAttendanceCandidate, commitActivityAttendance } from "./activity-attendance-service.js";
import {filterEditorEvents,editorCanReadEvent} from './editor-access.js';

const activityQrJson = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const activityQrError = (message, status = 400) => activityQrJson({ success: false, message }, status);

async function readInput(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192) throw new Error("資料過大。");
  const reader = request.body?.getReader(); if (!reader) throw new Error("缺少資料。");
  let text = "", size = 0; const decoder = new TextDecoder();
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new Error("資料過大。"); } text += decoder.decode(value, { stream: true }); }
  const body = JSON.parse(text + decoder.decode());
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("格式不正確。");
  return body;
}

export async function activityQrSummary(db, selectedId = "", actor = '') {
  const rows = await filterEditorEvents(db,actor,(await db.prepare(`SELECT e.id,e.title,e.checkin_start_at,e.checkin_end_at,
    (SELECT COUNT(*) FROM welfare_activity_registrations r WHERE r.event_id=e.id) AS registered_count,
    (SELECT COUNT(*) FROM welfare_activity_checkins c WHERE c.event_id=e.id) AS checkin_count
    FROM welfare_activity_events e WHERE e.status='active' ORDER BY e.checkin_start_at,e.id LIMIT 200`).all()).results || []);
  const now = Date.now(), active = rows.filter(e => now >= activityKeywordTime(e.checkin_start_at) && now <= activityKeywordTime(e.checkin_end_at));
  const selected = rows.find(e => e.id === selectedId) || (!selectedId && active.length === 1 ? active[0] : null);
  return { events: rows, selected_event_id: selected?.id || "", open_count: active.length,
    summary: selected ? { registered_count: Number(selected.registered_count), checkin_count: Number(selected.checkin_count) } : null };
}

export async function handleActivityQrCheckin(request, env, deps) {
  const url = new URL(request.url);
  if (url.pathname !== "/admin-api/activity-qr-checkin") return null;
  if (!["GET", "POST"].includes(request.method)) return activityQrError("不支援的操作。", 405);
  try {
    const actor = await authorizeActivityFormAdmin(request, env.DB, env, deps);
    if (!actor) return activityQrError("無權限，請使用已授權管理員帳號登入。", 403);
    if (request.method === "GET") {
      const id=url.searchParams.get('event_id')||'';
      if(id&&!await editorCanReadEvent(env.DB,actor,id))return activityQrError('此活動不在您的管理範圍。',403);
      return activityQrJson({ success: true, ...await activityQrSummary(env.DB,id,actor) });
    }
    let body; try { body = await readInput(request); } catch { return activityQrError("資料格式不正確或超過大小限制。"); }
    if (!["preview", "confirm"].includes(body.action) || typeof body.event_id !== "string" || !body.event_id || body.event_id.length > 100
      || typeof body.qr !== "string" || !body.qr.trim() || body.qr.length > 4096) return activityQrError("請選擇活動並掃描個人 QR。");
    const userId = deps.extractLineUserIdFromQr(body.qr);
    if(!await editorCanReadEvent(env.DB,actor,body.event_id))return activityQrError('此活動不在您的管理範圍。',403);
    if (!/^U[0-9a-fA-F]{32}$/.test(userId)) return activityQrError("無法識別個人 QR；活動報名碼、簽到碼及商城短效碼不能作為個人 QR。");
    const candidate = await readActivityAttendanceCandidate(env.DB, body.event_id, userId);
    if (!candidate.success) return activityQrJson(candidate, 409);
    if (body.action === "preview") return activityQrJson({ success: true, preview: {
      event_id: candidate.event.id, event_title: candidate.event.title, registration_id: candidate.registration.id,
      display_name: candidate.registration.display_name || "未填姓名", already_checked_in: Boolean(candidate.previous), checked_at: candidate.previous?.checked_at || ""
    } });
    if (body.confirmed !== true || body.registration_id !== candidate.registration.id) return activityQrError("請重新掃碼、核對報名者並確認核銷。", 409);
    const result = await commitActivityAttendance(env.DB, candidate, { actor, source: "activity_admin_qr" });
    if (!result.success) return activityQrJson(result, 409);
    // A summary read failure must never make a committed attendance look like a failed write.
    try { result.summary = (await activityQrSummary(env.DB, body.event_id)).summary; } catch { result.summary = null; }
    return activityQrJson(result);
  } catch { return activityQrError("暫時無法確認核銷結果，請重新掃碼查詢；不會重複核銷。", 503); }
}
