import {editorRole} from '../editor-access.js';
import { findAdminUidWhitelistRowReadOnly } from './admin-whitelist-reader.js';
import { ensureWorkspaceAgentSessionTable, getWorkspaceAgentSession, saveWorkspaceAgentSession, clearWorkspaceAgentSession } from './workspace-agent-session.js';

export const RICH_MENU_CHAT_START = 'action=workspace.richmenu.change';
const SELECT = 'action=workspace.richmenu.select';
const CANCEL = 'action=workspace.richmenu.cancel';
const AGENT = 'rich_menu';
const LOCK = 'rich_menu_chat_publish_lock_v1';
export const MENU_IMAGE_MAX_BYTES = 1000000;
export const MENU_IMAGE_ERROR = '尺寸錯誤，請重新上傳正確圖片以及解析度。\n圖片必須為 2500 × 1686 像素、檔案小於 1 MB，格式為 JPG 或 PNG。';
const MENUS = Object.freeze([
  { slot: '1', label: '中文', alias: 'guest_zh' },
  { slot: '2', label: '印尼文', alias: 'indo-menu' },
  { slot: '3', label: '泰文', alias: 'new-rich-menu' },
]);
const busyText = '這張圖片正在處理，請等待結果，勿重複上傳。';
const choices = (run) => ({ type: 'text', text: '請選擇要變更的選單：\n1：中文　2：印尼文　3：泰文\n僅換圖片，原有按鈕保持不變。輸入「取消」可結束。', quickReply: { items: MENUS.map(m => ({ type: 'action', action: { type: 'postback', label: m.slot, displayText: `選單 ${m.slot}：${m.label}`, data: `${SELECT}&slot=${m.slot}&run=${run}` } })) } });
const uploadPrompt = (menu) => ({ type: 'text', text: `請上傳選單照片。\n已選擇 ${menu.slot}：${menu.label}\n2500 × 1686 像素、檔案小於 1 MB，限 JPG／PNG。\n版面需對齊原本按鈕。若照片傳送後尺寸變小，請改以「檔案」傳送原圖。`, quickReply: { items: [{ type: 'action', action: { type: 'cameraRoll', label: '上傳照片' } }, { type: 'action', action: { type: 'postback', label: '取消', data: CANCEL, displayText: '取消變更選單' } }] } });
const response = (text) => ({ handled: true, message: { type: 'text', text } });

export async function canChangeRichMenu(db, userId) {
  const row = await findAdminUidWhitelistRowReadOnly(db, userId);
  if (!row || row.role === 'viewer' || editorRole(row.role)) return false;
  const modules = String(row.allowed_modules || '*').trim().split(',').map(s => s.trim());
  return modules.includes('*') || modules.includes('line');
}

// Inspect the real bytes, rather than trusting a filename, MIME header or webhook size.
export function inspectMenuImage(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length >= MENU_IMAGE_MAX_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    let at = 8, width = 0, height = 0, data = false;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at), end = at + length + 12;
      if (end > bytes.length) return null;
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (at === 8) {
        if (type !== 'IHDR' || length !== 13) return null;
        width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      } else if (type === 'IHDR') return null;
      if (type === 'IDAT' && length) data = true;
      if (type === 'IEND') return length === 0 && end === bytes.length && data && width === 2500 && height === 1686 ? { width, height, contentType: 'image/png' } : null;
      at = end;
    }
    return null;
  }
  if (bytes.length >= 20 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let at = 2, width = 0, height = 0;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) return null;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 0) return null;
      if (at + 2 > bytes.length) return null;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) return null;
      if ([192,193,194].includes(marker)) {
        if (length < 8 || width) return null;
        height = view.getUint16(at + 3); width = view.getUint16(at + 5);
      }
      if (marker === 218) return width === 2500 && height === 1686 ? { width, height, contentType: 'image/jpeg' } : null;
      at += length;
    }
  }
  return null;
}

export async function readMenuImage(env, messageId, fetcher = fetch) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(String(messageId || ''))) throw new Error('IMAGE_UNAVAILABLE');
  const signal = AbortSignal.timeout(8000);
  const res = await fetcher(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, { headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN }, signal });
  if (res.status !== 200 || !res.body) throw new Error('IMAGE_UNAVAILABLE');
  if (Number(res.headers.get('content-length')) >= MENU_IMAGE_MAX_BYTES) { await res.body.cancel(); return null; }
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size >= MENU_IMAGE_MAX_BYTES) return null;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const info = inspectMenuImage(bytes);
  return info ? { bytes, ...info } : null;
}

const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2,'0')).join('');
const fingerprint = (project) => digest(JSON.stringify([project.id, project.deployedRichMenuId, project.config, project.isDefaultHome, project.owner_uid, project.name, project.chatBarText]));
const save = (db, userId, step, payload, status = 'running') => saveWorkspaceAgentSession(db, { lineUserId: userId, agent: AGENT, step, payload, status, ttlSeconds: 1800 });
async function acquirePublishLock(db, token) {
  const now = Date.now();
  const r = await db.prepare(`INSERT INTO system_settings(setting_key,setting_value,updated_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at
    WHERE CAST(json_extract(system_settings.setting_value,'$.expires') AS INTEGER) < ?`)
    .bind(LOCK, JSON.stringify({ token, expires: now + 120000 }), now).run();
  return Number(r.meta?.changes) === 1;
}

export async function handleRichMenuChatTurn({ db, env, item, loadProjects, loadProject, publish, reply, fetcher = fetch }) {
  const userId = String(item?.LINE_user_id || '');
  const input = String(item?.postbackData || item?.text || '').trim();
  const start = input === RICH_MENU_CHAT_START || input === '變更選單';
  const action = input.startsWith('action=workspace.richmenu.');
  const session = userId ? await getWorkspaceAgentSession(db, userId) : null;
  const active = session?.agent === AGENT && Date.parse(session.expiresAt) > Date.now();
  if (!start && !action && !active) return null;
  // Signed private-chat events and the active LINE-module whitelist are mandatory.
  if (!item.activitySignatureVerified || item.sourceType !== 'user' || !await canChangeRichMenu(db, userId)) return response('此功能僅限已授權 LINE 選單管理員於一對一聊天室使用。');
  if (active && ['validating','publishing'].includes(session.status)) return response(busyText);
  if (start) {
    const run = crypto.randomUUID();
    if (!await ensureWorkspaceAgentSessionTable(db)) return response('選單流程暫時無法開啟，請稍後重試。');
    if (!await save(db, userId, 'choose', { run })) return response('選單流程暫時無法開啟，請稍後重試。');
    return { handled: true, message: choices(run) };
  }
  if (!active) return response('選單流程已逾時，請從「儀表板 → 變更選單」重新開始。');
  if (input === CANCEL || input === '取消') { await clearWorkspaceAgentSession(db, userId); return response('已取消變更選單。'); }
  if (input === '儀表板' || input === '仪表板' || input.startsWith('action=workspace.') && !action) return null;
  if (session.step === 'choose') {
    const params = new URLSearchParams(input);
    const slot = input.startsWith(SELECT + '&') && params.get('run') === session.payload.run ? params.get('slot') : /^[123]$/.test(input) ? input : '';
    const menu = MENUS.find(m => m.slot === slot);
    if (!menu) return { handled: true, message: choices(session.payload.run) };
    const projects = await loadProjects();
    const candidates = (projects || []).filter(p => p.aliasId === menu.alias);
    if (candidates.length !== 1) return response('目前無法確認這張選單，請稍後重新選擇。');
    const project = await loadProject(candidates[0].id);
    if (!project?.deployedRichMenuId || project.aliasId !== menu.alias || project.config?.size?.width !== 2500 || project.config?.size?.height !== 1686) return response('既有選單尺寸或設定不符，請先由後台確認。');
    const payload = { run: session.payload.run, slot, projectId: project.id, fingerprint: await fingerprint(project) };
    if (!await save(db, userId, 'upload', payload)) return response('無法記錄選單選擇，請重新選擇。');
    return { handled: true, message: uploadPrompt(menu) };
  }
  if (session.step !== 'upload') return response(session.status === 'complete' ? '上一張選單圖片已更新；如需再次變更，請點「變更選單」。' : '上次更新未能確認完成，請先至後台檢查選單，再重新開始。');
  if (!['image','file'].includes(item.messageType)) return { handled: true, message: uploadPrompt(MENUS.find(m => m.slot === session.payload.slot)) };
  if (session.payload.lastMessageId === item.messageId) return { handled: true, silent: true };
  const claimed = await db.prepare(`UPDATE workspace_agent_sessions SET status='validating',updated_at=datetime('now')
    WHERE line_user_id=? AND agent_name=? AND current_step='upload' AND status='running' AND payload_json=? AND julianday(expires_at) > julianday('now')`)
    .bind(userId, AGENT, JSON.stringify(session.payload)).run();
  if (Number(claimed.meta?.changes) !== 1) return response(busyText);
  const payload = { ...session.payload, lastMessageId: item.messageId };
  // Leave room for completion notification within the webhook's background lifetime.
  const publicationDeadline = AbortSignal.timeout(20000);
  let locked = false, acknowledged = false;
  try {
    let image;
    try { image = item.fileSize >= MENU_IMAGE_MAX_BYTES ? null : await readMenuImage(env, item.messageId, fetcher); }
    catch { await save(db, userId, 'upload', payload); return response('目前無法取得圖片，請重新上傳 JPG／PNG 原圖。'); }
    if (!image) { await save(db, userId, 'upload', payload); return response(MENU_IMAGE_ERROR); }
    const project = await loadProject(payload.projectId);
    if (!await canChangeRichMenu(db, userId)) { await save(db, userId, 'stopped', payload, 'failed'); return response('管理權限已變更，本次圖片未發布。'); }
    if (!project || await fingerprint(project) !== payload.fingerprint) { await save(db, userId, 'stopped', payload, 'failed'); return response('原選單已被更新，請重新選擇選單後上傳。'); }
    locked = await acquirePublishLock(db, payload.run);
    if (!locked) { await save(db, userId, 'upload', payload); return response('另一張選單正在更新，請稍後重新上傳。'); }
    const latest = await loadProject(payload.projectId);
    if (!latest || await fingerprint(latest) !== payload.fingerprint) { await save(db, userId, 'stopped', payload, 'failed'); return response('原選單已被更新，請重新選擇選單後上傳。'); }
    if (!await save(db, userId, 'upload', payload, 'publishing')) return response('無法記錄發布狀態，本次圖片未發布。');
    acknowledged = (await reply({ type: 'text', text: '圖片檢查通過，正在更新選單，完成後會通知你。' }))?.ok === true;
    if (!acknowledged) { await save(db, userId, 'upload', payload); return { handled: true, silent: true }; }
    // Only server-stored configuration is published; no chat-supplied actions or target IDs.
    let binary = ''; for (let at = 0; at < image.bytes.length; at += 8192) binary += String.fromCharCode(...image.bytes.subarray(at, at + 8192));
    const result = await publish({ id: project.id, richMenuConfig: { ...project.config, isDefaultHome: project.isDefaultHome === true }, aliasId: project.aliasId, setDefault: project.isDefaultHome === true, imageBase64: `data:${image.contentType};base64,${btoa(binary)}`, deferUserMenuRefresh: true, signal: publicationDeadline });
    const complete = result?.success === true;
    await save(db, userId, 'done', { ...payload, publishedMenuId: result?.data?.richMenuId || '' }, complete ? 'complete' : 'failed');
    const menu = MENUS.find(m => m.slot === payload.slot);
    return { handled: true, alreadyReplied: true, completionText: complete ? `選單 ${menu.slot}（${menu.label}）圖片已更新，原本按鈕位置與功能保持不變。既有使用者的選單正在自動更新。` : '選單更新未能確認完成，請先至後台檢查；系統不會自動重複發布。', notificationKey: payload.run };
  } catch {
    await save(db, userId, 'done', payload, 'failed');
    const text = '選單更新未能確認完成，請先至後台檢查；系統不會自動重複發布。';
    return acknowledged ? { handled: true, alreadyReplied: true, completionText: text, notificationKey: payload.run } : response(text);
  } finally {
    if (locked) await db.prepare(`DELETE FROM system_settings WHERE setting_key=? AND json_extract(setting_value,'$.token')=?`).bind(LOCK, payload.run).run().catch(() => console.warn('Rich menu publication lease remains until expiry'));
  }
}
