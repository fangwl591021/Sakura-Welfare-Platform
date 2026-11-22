import { authorizeActivityFormAdmin, canRegisterForActivity } from './activity-form-service.js';
import { registrationWindowState } from './activity-registration-window.js';
import { translateClubContent } from './club-translation.js';
import { withClubCover } from './club-default-cover.js';
import { EmployeeBindingAccessError } from './employee-binding-auto-sync.js';
import { verifiedBenefitCookieUid } from './vendor-benefit-access.js';
import {editorActorRole,editorCanReadEvent} from './editor-access.js';

const tables = { club: 'welfare_clubs', gallery: 'welfare_club_galleries', activity: 'welfare_activity_club_links' };
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
class ClubError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new ClubError(message, status); };
const text = (value, max = 3000) => { if (typeof value !== 'string' || value.length > max) fail('欄位格式或長度不正確。'); return value.trim(); };
const id = value => { const result = text(value, 100); if (!/^[a-zA-Z0-9_-]{1,100}$/.test(result)) fail('資料編號不正確。'); return result; };
const choice = (value, options) => { if (!options.includes(value)) fail('請選擇有效的狀態或分類。'); return value; };
const record = row => ({ ...JSON.parse(row.content_json), id: row.id, revision: row.revision, updated_at: row.updated_at, ...(row.club_id ? { club_id: row.club_id } : {}) });
const bearer = request => (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
async function bounded(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit || !request.body) fail('資料超過大小限制或沒有內容。', 413);
  let size = 0;
  return new Response(request.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
    size += chunk.byteLength; if (size > limit) throw new ClubError('資料超過大小限制。', 413); controller.enqueue(chunk);
  } })), { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } });
}
async function memberFor(request, env, deps) {
  const token = bearer(request);
  let uid;
  if (token) {
    const identity = await deps.verifyLine(env, token);
    if (!identity?.lineUserId) fail('LINE 登入已失效，請重新登入。', 403);
    uid = identity.lineUserId;
    await deps.ensureEmployeeBinding?.(uid);
  } else {
    uid = await verifiedBenefitCookieUid(request, env);
    if (!uid) return null;
  }
  return env.DB.prepare('SELECT member_type,status,bind_status FROM welfare_members WHERE line_user_id=?').bind(uid).first();
}
const employee = member => canRegisterForActivity({ audience_scope: '["employee"]' }, member);
function translated(content, locale) {
  const copy = { ...content }; delete copy.translations;
  const translation = content.translations?.[locale] || {};
  for (const key of ['title', 'description', 'contact', 'join_rules']) if (translation[key]) copy[key] = translation[key];
  return copy;
}
function normalizeTranslations(input) {
  const result = {};
  for (const locale of ['id', 'th']) {
    result[locale] = {};
    for (const field of ['title', 'description', 'contact', 'join_rules']) result[locale][field] = text(input?.[locale]?.[field] || '', field === 'title' ? 150 : 3000);
  }
  return result;
}
async function normalize(kind, data, db, previous) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('請填寫完整資料。');
  if (kind === 'club') {
    const coverId = data.cover_media_id === undefined ? previous?.cover_media_id || '' : text(data.cover_media_id, 100);
    if (coverId && !await db.prepare('SELECT id FROM welfare_club_media WHERE id=? AND club_id=?').bind(id(coverId), id(data.id)).first()) fail('封面照片不屬於此社團。');
    return { title: text(data.title, 150) || fail('請填寫社團名稱。'), description: text(data.description || ''),
    contact: text(data.contact || '', 500), join_rules: text(data.join_rules || ''), status: choice(data.status, ['active','preparing','paused','archived']),
    published: data.published === true && data.status !== 'archived', cover_media_id: coverId, translations: normalizeTranslations(data.translations) };
  }
  const clubId = id(data.club_id);
  if (!await db.prepare('SELECT id FROM welfare_clubs WHERE id=?').bind(clubId).first()) fail('找不到社團。', 404);
  if (kind === 'activity') {
    if (!await db.prepare('SELECT id FROM welfare_activity_events WHERE id=?').bind(id(data.id)).first()) fail('找不到活動，請先建立活動。', 404);
    return { club_id: clubId, kind: choice(data.kind, ['club','company','esg','charity']), mode: choice(data.mode, ['registration','announcement']) };
  }
  const eventId = data.event_id ? id(data.event_id) : '';
  if (eventId && !await db.prepare('SELECT id FROM welfare_activity_club_links WHERE id=? AND club_id=?').bind(eventId, clubId).first()) fail('花絮活動必須已關聯此社團。');
  if (!Array.isArray(data.media_ids) || data.media_ids.length > 200 || new Set(data.media_ids).size !== data.media_ids.length) fail('每本活動相簿最多 200 張照片，不可重複。');
  const mediaIds = data.media_ids.map(id);
  if (mediaIds.length) {
    let owned=0;
    for(let start=0;start<mediaIds.length;start+=80){const chunk=mediaIds.slice(start,start+80);
      owned+=(await db.prepare('SELECT id FROM welfare_club_media WHERE club_id=? AND id IN ('+chunk.map(()=>'?').join(',')+')').bind(clubId,...chunk).all()).results.length;
    }
    if(owned!==mediaIds.length)fail('照片不屬於此社團。');
  }
  let video = text(data.video_url || '', 2000);
  if (video) { let url; try { url = new URL(video); } catch { fail('影片連結格式不正確。'); }
    if (url.protocol !== 'https:' || url.username || url.password) fail('影片連結須為 HTTPS。'); video = url.href; }
  return { club_id: clubId, event_id: eventId, title: text(data.title, 150) || fail('請填寫花絮標題。'), description: text(data.description || ''),
    media_ids: mediaIds, video_url: video, visibility: choice(data.visibility, ['employee','all']),
    status: choice(data.status, ['draft','published','hidden','archived']), translations: normalizeTranslations(data.translations) };
}
async function fingerprint(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
async function replay(db, requestId, actor, hash) {
  const row = await db.prepare('SELECT * FROM welfare_club_actions WHERE request_id=?').bind(requestId).first();
  if (!row) return null;
  if (row.actor !== actor || row.fingerprint !== hash) fail('操作編號已被使用，請重新整理。', 409);
  return json({ success: true, id: row.entity_id, revision: row.revision, replayed: true });
}
async function save(request, env, actor, deps) {
  let body; try { body = await (await bounded(request, 65000)).json(); } catch (error) { if (error instanceof ClubError) throw error; fail('資料格式不正確。'); }
  const kind = choice(body.kind, Object.keys(tables)), entityId = id(body.data?.id), requestId = id(body.request_id);
  if (!Number.isInteger(body.revision) || body.revision < 0 || body.confirmed !== true) fail('請確認資料及版本後再儲存。');
  const hash = await fingerprint(body), db = env.DB;
  const previous = await replay(db, requestId, actor, hash); if (previous) return previous;
  const table = tables[kind], current = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(entityId).first();
  if (Number(current?.revision || 0) !== body.revision) fail('資料已被更新，請重新載入，避免覆蓋其他人的修改。', 409);
  const previousContent = current ? JSON.parse(current.content_json) : null;
  if(editorActorRole(actor)==='club_editor'){
    if(kind==='activity'&&!current)fail('只能關聯已屬於社團的活動，請由社團活動頁新增。',403);
    if(kind==='gallery'&&body.data.event_id&&body.data.event_id!==previousContent?.event_id&&!await editorCanReadEvent(db,actor,body.data.event_id))fail('此活動不在社團管理範圍。',403);
  }
  const content = await normalize(kind, body.data, db, previousContent);
  if (current && kind === 'gallery' && current.club_id !== content.club_id) fail('既有花絮不可改掛其他社團。');
  try {
    await translateClubContent(kind, content, previousContent, env, deps.callAi);
  } catch { fail('自動翻譯暫時無法完成，資料尚未儲存。請保留編輯內容並稍後按「確認儲存」重試。', 503); }
  const serialized = JSON.stringify(content), next = body.revision + 1;
  const extra = kind === 'club' ? '' : ',club_id', extraPlaceholder = kind === 'club' ? '' : ',?', args = [entityId, serialized, next, requestId];
  if (kind !== 'club') args.push(content.club_id);
  args.push(body.revision);
  const mutation = db.prepare(`INSERT INTO ${table}(id,content_json,revision,last_request_id${extra}) VALUES(?,?,?,?${extraPlaceholder})
    ON CONFLICT(id) DO UPDATE SET content_json=excluded.content_json,revision=excluded.revision,last_request_id=excluded.last_request_id,
    updated_at=datetime('now','+8 hours')${kind === 'club' ? '' : ',club_id=excluded.club_id'} WHERE ${table}.revision=?`).bind(...args);
  const audit = db.prepare(`INSERT INTO welfare_club_actions(request_id,actor,fingerprint,kind,entity_id,revision,before_json,after_json)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND revision=? AND last_request_id=?)`)
    .bind(requestId, actor, hash, kind, entityId, next, current?.content_json || '{}', serialized, entityId, next, requestId);
  try {
    const results = await db.batch([mutation, audit]);
    if (!results[0].meta?.changes || !results[1].meta?.changes) fail('資料已被更新，請重新载入。', 409);
  } catch (error) {
    const retry = await replay(db, requestId, actor, hash); if (retry) return retry;
    if (error instanceof ClubError) throw error;
    fail('儲存失敗，資料沒有變更，請稍後再試。', 503);
  }
  return json({ success: true, id: entityId, revision: next });
}
async function upload(request, env, actor, url) {
  const clubId = id(url.searchParams.get('club_id')), requestId = id(url.searchParams.get('request_id'));
  if (!await env.DB.prepare('SELECT id FROM welfare_clubs WHERE id=?').bind(clubId).first()) fail('找不到社團。', 404);
  if (!env.R2_BUCKET) fail('照片儲存暫時不可用。', 503);
  const form = await (await bounded(request, 8_100_000)).formData(), file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size || file.size > 8_000_000) fail('照片須小於 8 MB。', 413);
  const bytes = new Uint8Array(await file.arrayBuffer()), starts = values => values.every((value, i) => bytes[i] === value);
  const mime = /\.jpe?g$/i.test(file.name) && starts([255,216,255]) ? 'image/jpeg'
    : /\.png$/i.test(file.name) && starts([137,80,78,71,13,10,26,10]) ? 'image/png'
    : /\.webp$/i.test(file.name) && starts([82,73,70,70]) && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP' ? 'image/webp' : '';
  if (!mime || (file.type && file.type !== mime)) fail('只接受有效 JPG、PNG、WebP 照片。');
  const hash = await fingerprint({ clubId, name: file.name, hash: await crypto.subtle.digest('SHA-256', bytes).then(b => Array.from(new Uint8Array(b))) });
  const previous = await replay(env.DB, requestId, actor, hash); if (previous) return previous;
  const mediaId = crypto.randomUUID(), key = 'club_private_media_' + mediaId;
  await env.R2_BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO welfare_club_media(id,club_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)').bind(mediaId,clubId,key,mime,file.name.slice(0,200),bytes.length,actor,requestId),
      env.DB.prepare('INSERT INTO welfare_club_actions(request_id,actor,fingerprint,kind,entity_id,revision,before_json,after_json,source_route) VALUES(?,?,?,?,?,1,?,?,?)').bind(requestId,actor,hash,'media',mediaId,'{}',JSON.stringify({ club_id:clubId,mime_type:mime,file_size:bytes.length }),'/admin-api/club-media')
    ]);
  } catch {
    await env.R2_BUCKET.delete(key);
    const retry = await replay(env.DB, requestId, actor, hash); if (retry) return retry;
    fail('上傳失敗，照片尚未發布。', 503);
  }
  return json({ success: true, id: mediaId, revision: 1 });
}
async function publicDirectory(request, env, deps, url) {
  const member = await memberFor(request, env, deps), locale = ['id','th'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'zh';
  const clubs = (await env.DB.prepare('SELECT * FROM welfare_clubs ORDER BY id LIMIT 300').all()).results.map(record)
    .filter(c => c.published && c.status !== 'archived').map(c => withClubCover(translated(c, locale)));
  const clubIds = new Set(clubs.map(c => c.id));
  const events = (await env.DB.prepare(`SELECT l.id,l.club_id,l.content_json,e.title,e.description,e.location,e.start_at,e.end_at,e.status,e.audience_scope,
    e.registration_start_at,e.registration_end_at,EXISTS(SELECT 1 FROM welfare_activity_forms f WHERE f.event_id=e.id) AS has_form
    FROM welfare_activity_club_links l JOIN welfare_activity_events e ON e.id=l.id WHERE e.status='active' ORDER BY e.start_at DESC LIMIT 300`).all()).results
    .filter(e => clubIds.has(e.club_id) && canRegisterForActivity(e, member)).map(e => {
      const link = JSON.parse(e.content_json), window = registrationWindowState(e), mode = link.mode;
      return { id:e.id,club_id:e.club_id,title:e.title,description:e.description,location:e.location,start_at:e.start_at,end_at:e.end_at,
        registration_start_at:e.registration_start_at,registration_end_at:e.registration_end_at,kind:link.kind,mode,
        registration_state:mode === 'announcement' ? 'announcement' : !e.has_form ? 'unconfigured' : window,
        registration_url:mode === 'registration' && e.has_form ? '/activity-registration?event_id='+encodeURIComponent(e.id)+'&lang='+locale : '' };
    });
  const galleries = [];
  for (const gallery of (await env.DB.prepare('SELECT * FROM welfare_club_galleries ORDER BY updated_at DESC LIMIT 300').all()).results.map(record)) {
    if (!employee(member) || !clubIds.has(gallery.club_id) || gallery.status !== 'published') continue;
    if (gallery.event_id) {
      const event = await env.DB.prepare('SELECT audience_scope FROM welfare_activity_events WHERE id=?').bind(gallery.event_id).first();
      const link = await env.DB.prepare('SELECT club_id FROM welfare_activity_club_links WHERE id=?').bind(gallery.event_id).first();
      if (!event || link?.club_id !== gallery.club_id || !canRegisterForActivity(event, member)) continue;
    }
    galleries.push({ ...translated(gallery, locale), visibility: 'employee' });
  }
  return json({ success:true,clubs,events,galleries,employee:employee(member) });
}
// A saved club cover is explicitly public with its club; album permissions stay separate.
async function cover(env, url) {
  const clubId = id(decodeURIComponent(url.pathname.slice('/club-cover/'.length)));
  const row = await env.DB.prepare('SELECT * FROM welfare_clubs WHERE id=?').bind(clubId).first();
  const club = row ? record(row) : null;
  if (!club?.published || club.status === 'archived' || !club.cover_media_id) fail('找不到社團封面。', 404);
  // A photo reused in an album must not leak through the otherwise public cover.
  const usedInGallery = await env.DB.prepare(`SELECT 1 AS found FROM welfare_club_galleries
    WHERE EXISTS(SELECT 1 FROM json_each(content_json,'$.media_ids') WHERE value=?) LIMIT 1`).bind(club.cover_media_id).first();
  if (usedInGallery) fail('找不到社團封面。', 404);
  const mediaRow = await env.DB.prepare('SELECT * FROM welfare_club_media WHERE id=? AND club_id=?').bind(club.cover_media_id, clubId).first();
  const object = mediaRow && await env.R2_BUCKET?.get(mediaRow.object_key);
  if (!object) fail('找不到社團封面。', 404);
  return new Response(object.body, { headers: { 'Content-Type': mediaRow.mime_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } });
}
async function media(request, env, deps, url) {
  const mediaId = id(decodeURIComponent(url.pathname.slice('/club-media/'.length))), db = env.DB;
  const managing = url.searchParams.get('manage') === '1';
  if (managing && !await authorizeActivityFormAdmin(request, db, env, deps)) fail('沒有管理權限。',403);
  const member = managing ? null : await memberFor(request, env, deps);
  if (!managing && !employee(member)) fail('找不到可閱讀照片。',404);
  const row = await db.prepare('SELECT * FROM welfare_club_media WHERE id=?').bind(mediaId).first();
  if (!row) fail('找不到照片。', 404);
  if (!managing) {
    const clubRow = await db.prepare('SELECT * FROM welfare_clubs WHERE id=?').bind(row.club_id).first();
    const club = clubRow ? record(clubRow) : null;
    if (!club?.published || club.status === 'archived') fail('找不到可閱讀照片。',404);
    const candidates = (await db.prepare(`SELECT * FROM welfare_club_galleries WHERE club_id=?
      AND json_extract(content_json,'$.status')='published'
      AND EXISTS(SELECT 1 FROM json_each(content_json,'$.media_ids') WHERE value=?) LIMIT 300`).bind(row.club_id,mediaId).all()).results.map(record);
    let allowed = false;
    for (const gallery of candidates) {
      if (gallery.visibility !== 'all' && !employee(member)) continue;
      if (gallery.event_id) {
        const event = await db.prepare(`SELECT e.audience_scope,l.club_id FROM welfare_activity_events e
          JOIN welfare_activity_club_links l ON l.id=e.id WHERE e.id=?`).bind(gallery.event_id).first();
        if (!event || event.club_id !== row.club_id || !canRegisterForActivity(event,member)) continue;
      }
      allowed = true; break;
    }
    if (!allowed) fail('找不到可閱讀照片。',404);
  }
  const object = await env.R2_BUCKET?.get(row.object_key); if (!object) fail('找不到照片。',404);
  return new Response(object.body, { headers: { 'Content-Type':row.mime_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline' } });
}
export async function handleClubRequest(request, env, deps) {
  const url = new URL(request.url), path = url.pathname;
  if (!['/api/clubs','/admin-api/clubs','/admin-api/club-media'].includes(path) && !path.startsWith('/club-media/') && !path.startsWith('/club-cover/')) return null;
  try {
    if (!env.DB) fail('社團服務暫時無法使用。',503);
    if (!['GET','POST'].includes(request.method)) fail('不支援此操作。',405);
    if (path.startsWith('/club-cover/') && request.method === 'GET') return await cover(env,url);
    if (path.startsWith('/club-media/') && request.method === 'GET') return await media(request,env,deps,url);
    if (path === '/api/clubs' && request.method === 'GET') return await publicDirectory(request,env,deps,url);
    if (!path.startsWith('/admin-api/')) fail('不支援此操作。',405);
    if ((request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('請由管理後台操作。',403);
    const actor = await authorizeActivityFormAdmin(request,env.DB,env,deps); if (!actor) fail('沒有社團管理權限，請先登入管理後台。',403);
    if (path === '/admin-api/club-media') { if (request.method !== 'POST') fail('不支援此操作。',405); return await upload(request,env,actor,url); }
    if (request.method === 'POST') return await save(request,env,actor,deps);
    const result = { success:true };
    for (const [kind, table] of Object.entries(tables)) result[kind] = (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC LIMIT 300`).all()).results.map(record);
    result.media = (await env.DB.prepare('SELECT id,club_id,original_name,mime_type,file_size FROM welfare_club_media ORDER BY created_at DESC LIMIT 1000').all()).results;
    return json(result);
  } catch (error) {
    if (error instanceof EmployeeBindingAccessError) return json({ success:false,code:error.code,message:error.message,retryable:error.status===503 },error.status);
    return json({ success:false,message:error instanceof ClubError ? error.message : '社團服務暫時無法使用，請稍後重試。' },error instanceof ClubError ? error.status : 503);
  }
}
