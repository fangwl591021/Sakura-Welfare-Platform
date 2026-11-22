import { ensureEmployeeBindingOnAccess, EmployeeBindingAccessError } from './employee-binding-auto-sync.js';
import { recordBindingStart, recordBindingCompletion } from './employee-binding-journal.js';

// Exact message actions read from the three production menus. Text starts a
// read-only observation window; only the mother's explicit UID binding grants access.
export const BINDING_CHAT_LANGUAGES = Object.freeze({
  '櫻花報到': 'zh-TW',
  'Pendaftaran Bunga Sakura': 'id',
  'ลงทะเบียนซากุระ': 'th',
});
const PREFIX = 'employee_binding_chat_watch:';
const WINDOW_MS = 30 * 60 * 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function bindingChatLanguage(text) {
  const normalized = String(text || '').trim().normalize('NFKC').toLowerCase();
  return Object.entries(BINDING_CHAT_LANGUAGES).find(([key]) => key.normalize('NFKC').toLowerCase() === normalized)?.[1] || '';
}
function subject(item, verified) {
  const uid = String(item?.LINE_user_id || '');
  const eventId = String(item?.eventId || item?.messageId || '');
  if (!verified || item?.sourceType !== 'user' || item?.eventType !== 'message' || item?.messageType !== 'text'
    || !/^U[0-9A-Za-z_-]{20,128}$/.test(uid) || !eventId) return null;
  return { uid, eventId };
}
async function watchKey(uid) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
  return PREFIX + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function observeBindingChatStart(db, item, verified, now = Date.now()) {
  const user = subject(item, verified), language = bindingChatLanguage(item?.text);
  if (!db || !user || !language) return false;
  const startedAt = Number(item.timestamp) > 0 ? Number(item.timestamp) : now;
  const watch = { uid: user.uid, language, startEventId: user.eventId, startedAt, state: 'pending', expiresAt: now + WINDOW_MS, events: [], checks: 0 };
  const result = await db.prepare(`INSERT INTO system_settings(setting_key,setting_value,updated_at) VALUES(?,?,?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at
    WHERE json_extract(system_settings.setting_value,'$.startEventId') <> ? AND COALESCE(json_extract(system_settings.setting_value,'$.startedAt'),0) <= ?`)
    .bind(await watchKey(user.uid), JSON.stringify(watch), new Date(now).toISOString(), user.eventId, startedAt).run();
  await recordBindingStart(db,watch,await watchKey(user.uid));
  return Boolean(result.meta?.changes);
}

export async function detectBindingChatResult(db, env, item, verified, pull, options = {}) {
  const user = subject(item, verified);
  if (!db || !user) return { state: 'ignored' };
  const key = await watchKey(user.uid), now = options.now?.() ?? Date.now();
  const row = await db.prepare('SELECT setting_value FROM system_settings WHERE setting_key=?').bind(key).first();
  if (!row) return { state: 'ignored' };
  let watch;
  try { watch = JSON.parse(row.setting_value); } catch { return { state: 'ignored' }; }
  if (watch.state !== 'pending') return { state: watch.state };
  if (watch.expiresAt <= now) {
    await db.prepare(`UPDATE system_settings SET setting_value=json_set(setting_value,'$.state','expired'),updated_at=?
      WHERE setting_key=? AND json_extract(setting_value,'$.startEventId')=? AND json_extract(setting_value,'$.state')='pending'`)
      .bind(new Date(now).toISOString(), key, watch.startEventId).run();
    return { state: 'expired' };
  }
  if (options.deadline && options.deadline - now < 8500) return { state: 'deferred' };
  // Different later messages may finish while an earlier check is in flight.
  // Claim each signed event once, without a per-user lock that could lose the
  // message completing mother binding. Atomic member writes arbitrate races.
  const claim = await db.prepare(`UPDATE system_settings SET setting_value=json_insert(setting_value,'$.events[#]',?),updated_at=?
    WHERE setting_key=? AND json_extract(setting_value,'$.startEventId')=? AND json_extract(setting_value,'$.state')='pending'
      AND NOT EXISTS(SELECT 1 FROM json_each(system_settings.setting_value,'$.events') WHERE value=?)`)
    .bind(user.eventId, new Date(now).toISOString(), key, watch.startEventId, user.eventId).run();
  if (!claim.meta?.changes) return { state: 'duplicate' };
  let state = 'pending', checkState = 'unbound', checks = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.deadline && options.deadline - (options.now?.() ?? Date.now()) < (attempt ? 10500 : 8500)) break;
    if (attempt) await (options.sleep || delay)(2000);
    checks++;
    try {
      const result = await ensureEmployeeBindingOnAccess(db, env, user.uid, pull, {
        preferredLanguage: watch.language,
        ...(options.deferMenu ? { deferMenu: options.deferMenu } : {}),
      });
      checkState = result.state;
      if (result.state === 'bound') {
        const member=await db.prepare('SELECT * FROM welfare_members WHERE line_user_id=?').bind(user.uid).first();
        await recordBindingCompletion(db,member,'chat_checkin');
        if(options.notify)await options.notify();
        state = 'complete'; break;
      }
      if (result.state === 'restricted') { state = 'restricted'; break; }
    } catch (error) {
      checkState = error instanceof EmployeeBindingAccessError && error.status === 409 ? 'conflict' : 'unavailable';
      if (checkState === 'conflict') { state = 'conflict'; break; }
    }
  }
  await db.prepare(`UPDATE system_settings SET setting_value=json_set(setting_value,'$.state',?,'$.lastCheck',?,
      '$.checks',COALESCE(json_extract(setting_value,'$.checks'),0)+?,'$.checkedAt',?),updated_at=?
    WHERE setting_key=? AND json_extract(setting_value,'$.startEventId')=? AND json_extract(setting_value,'$.state')='pending'`)
    .bind(state, checkState, checks, new Date().toISOString(), new Date().toISOString(), key, watch.startEventId).run();
  return { state, checkState };
}

export async function detectBindingChatPayload(rawBody, env, verified, pull, ctx, deadline = Date.now() + 22000, notify) {
  if (!verified || !env.DB) return;
  const payload = JSON.parse(rawBody);
  for (const event of Array.isArray(payload.events) ? payload.events : []) {
    // This adapter consumes only server-verified LINE event fields. It never
    // replies, forwards a webhook, or submits employee credentials to mother.
    const item = { LINE_user_id: event.source?.userId, sourceType: event.source?.type, eventType: event.type,
      messageType: event.message?.type, eventId: event.webhookEventId, messageId: event.message?.id };
    await detectBindingChatResult(env.DB, env, item, true, pull, { deadline,
      ...(notify?{notify}:{}),
      ...(typeof ctx?.waitUntil === 'function' ? { deferMenu: task => ctx.waitUntil(task) } : {}) });
  }
}
