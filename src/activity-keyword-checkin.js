import { canRegisterForActivity } from "./activity-form-service.js";

const FLOW = "activity_keyword_checkin";
const ruleId = eventId => "activity-checkin:" + eventId;
const failure = (code, text) => ({ success: false, code, text });

function metadata(rule) {
  try { return JSON.parse(rule?.metadata_json || "{}"); } catch { return {}; }
}

export function isActivityKeywordRule(rule) {
  const meta = metadata(rule);
  return rule?.action_type === "custom_flow" && meta?.flow === FLOW
    && typeof meta.event_id === "string" && rule.id === ruleId(meta.event_id);
}

export function activityKeywordTime(value) {
  let text = String(value || "").trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return NaN;
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(text)) text += "+08:00";
  return Date.parse(text);
}

export async function attachActivityKeywords(db, events) {
  if (!events.length) return events;
  let rows;
  try {
    rows = await db.prepare(`SELECT id, keyword, active, action_type, metadata_json FROM line_keyword_rules
      WHERE id IN (${events.map(() => "?").join(",")})`).bind(...events.map(event => ruleId(event.id))).all();
  } catch (error) {
    if (!String(error.message).includes("no such table: line_keyword_rules")) throw error;
    return events.map(event => ({ ...event, checkin_keyword: "" }));
  }
  const keywords = new Map((rows.results || []).filter(isActivityKeywordRule)
    .map(row => [metadata(row).event_id, Number(row.active) === 1 ? row.keyword : ""]));
  return events.map(event => ({ ...event, checkin_keyword: keywords.get(event.id) || "" }));
}

export async function prepareActivityKeywordRule(db, event, isReserved) {
  if (typeof event.checkin_keyword !== "string") throw new Error("簽到關鍵字格式不正確。");
  const keyword = event.checkin_keyword.trim(), id = ruleId(event.id);
  if (!keyword) return db.prepare("UPDATE line_keyword_rules SET active = 0, updated_at = datetime('now') WHERE id = ? AND action_type = 'custom_flow'").bind(id);
  if (keyword.length > 80 || /[\u0000-\u001f\u007f]/.test(keyword)) throw new Error("簽到關鍵字限 80 字，不可包含換行。");
  if (isReserved(keyword)) throw new Error("此關鍵字屬於既有功能，請改用活動專屬關鍵字。");
  const start = activityKeywordTime(event.checkin_start_at), end = activityKeywordTime(event.checkin_end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("啟用關鍵字簽到需設定有效的簽到開始與截止時間。");
  const rows = await db.prepare("SELECT id, keyword, match_type FROM line_keyword_rules WHERE active = 1 AND id <> ?").bind(id).all();
  const collision = (rows.results || []).some(row => {
    if (row.match_type === "contains") return keyword.includes(row.keyword);
    if (row.match_type === "regex") { try { return new RegExp(row.keyword).test(keyword); } catch { return false; } }
    return keyword === row.keyword;
  });
  if (collision) throw new Error("此關鍵字已被其他活動或功能使用，請更換。");
  // A concurrent exact-keyword collision raises NOT NULL and rolls back the activity batch.
  return db.prepare(`INSERT INTO line_keyword_rules
    (id, keyword, match_type, action_type, title, priority, active, metadata_json, updated_at)
    VALUES (?, CASE WHEN EXISTS(SELECT 1 FROM line_keyword_rules WHERE active = 1 AND keyword = ? AND id <> ?)
      THEN NULL ELSE ? END, 'exact', 'custom_flow', ?, 10, 1, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET keyword=excluded.keyword, match_type='exact', action_type='custom_flow',
      title=excluded.title, priority=10, active=1, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`)
    .bind(id, keyword, id, keyword, "活動簽到：" + event.title,
      JSON.stringify({ flow: FLOW, event_id: event.id }));
}

export async function checkinByActivityKeyword({ db, item, rule, signatureVerified, now = Date.now() }) {
  if (!isActivityKeywordRule(rule)) return null;
  if (signatureVerified !== true || !item?.LINE_user_id || item.eventType !== "message" || item.messageType !== "text") {
    return failure("unverified", "無法驗證 LINE 身分，請從官方帳號聊天室重新輸入簽到關鍵字。");
  }
  if (item.sourceType !== "user") return failure("private_chat_required", "請至官方帳號的一對一聊天室輸入簽到關鍵字。");
  const keyword = String(item.text || "").trim();
  if (keyword !== rule.keyword || Number(rule.active) !== 1 || rule.match_type !== "exact") return failure("invalid_keyword", "簽到關鍵字無效，請確認活動提供的關鍵字。");
  try {
    const eventId = metadata(rule).event_id, userId = item.LINE_user_id;
    const event = await db.prepare("SELECT * FROM welfare_activity_events WHERE id = ?").bind(eventId).first();
    if (!event || event.status !== "active") return failure("closed", "此活動尚未開放或已關閉簽到。");
    const member = await db.prepare("SELECT member_type, status, bind_status FROM welfare_members WHERE line_user_id = ? LIMIT 1").bind(userId).first();
    if (!canRegisterForActivity(event, member)) return failure("denied", "目前身分不符合此活動資格，無法簽到。");
    const registration = await db.prepare("SELECT id, display_name FROM welfare_activity_registrations WHERE event_id = ? AND line_user_id = ?").bind(eventId, userId).first();
    if (!registration) return failure("not_registered", "你尚未報名此活動，請先完成報名再簽到。");
    const previous = await db.prepare("SELECT checked_at, raw_payload FROM welfare_activity_checkins WHERE event_id = ? AND line_user_id = ?").bind(eventId, userId).first();
    if (previous) {
      let audit = {}; try { audit = JSON.parse(previous.raw_payload || "{}"); } catch {}
      return { success: true, code: "already_checked_in", silent: Boolean(item.eventId && audit.webhook_event_id === item.eventId),
        text: "你已完成「" + event.title + "」簽到，不會重複核銷。\n簽到時間：" + previous.checked_at };
    }
    const start = activityKeywordTime(event.checkin_start_at), end = activityKeywordTime(event.checkin_end_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return failure("invalid_window", "活動尚未設定有效簽到時間，請聯絡主辦單位。");
    if (now < start) return failure("not_started", "簽到尚未開始。");
    if (now > end) return failure("ended", "簽到已截止。");
    const id = crypto.randomUUID();
    // Recheck mutable event/rule/registration state in the INSERT; the existing unique key prevents QR/keyword races.
    const saved = await db.prepare(`INSERT INTO welfare_activity_checkins
      (id, event_id, line_user_id, display_name, picture_url, checkin_status, checked_at, raw_payload)
      SELECT ?, e.id, ?, r.display_name, '', 'checked_in', datetime('now','+8 hours'), ?
      FROM welfare_activity_events e JOIN welfare_activity_registrations r ON r.event_id=e.id AND r.line_user_id=?
      JOIN line_keyword_rules k ON k.id=?
      WHERE e.id=? AND e.status='active' AND e.audience_scope=? AND e.checkin_start_at=? AND e.checkin_end_at=?
        AND k.keyword=? AND k.active=1 AND k.action_type='custom_flow' AND k.metadata_json=?
        AND k.match_type='exact' AND r.id=?
        AND NOT EXISTS(SELECT 1 FROM line_keyword_rules other WHERE other.active=1 AND other.keyword=k.keyword AND other.id<>k.id)
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=?))
          OR (?=1 AND EXISTS(SELECT 1 FROM welfare_members WHERE line_user_id=?
            AND member_type IS ? AND status IS ? AND bind_status IS ?)))
        AND julianday('now') BETWEEN julianday(?) AND julianday(?)
      ON CONFLICT(event_id,line_user_id) DO NOTHING`)
      .bind(id, userId, JSON.stringify({ source: FLOW, webhook_event_id: item.eventId || "", registration_id: registration.id }),
        userId, rule.id, eventId, event.audience_scope, event.checkin_start_at, event.checkin_end_at, keyword, rule.metadata_json,
        registration.id, member ? 1 : 0, userId, member ? 1 : 0, userId,
        member?.member_type ?? null, member?.status ?? null, member?.bind_status ?? null,
        new Date(start).toISOString(), new Date(end).toISOString()).run();
    if (!saved.meta?.changes) return failure("state_changed", "簽到資料已更新或已完成簽到，請重新輸入關鍵字確認。");
    const result = await db.prepare("SELECT checked_at FROM welfare_activity_checkins WHERE id = ?").bind(id).first();
    return { success: true, code: "checked_in", text: "「" + event.title + "」簽到成功，已核銷出席。\n簽到時間：" + result.checked_at + "\n本次不贈扣點數。" };
  } catch {
    return failure("unavailable", "暫時無法確認簽到結果，請稍後再輸入關鍵字查詢；系統不會重複核銷。");
  }
}
