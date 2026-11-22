export const DOCUMENT_MAX_BYTES = 50_000_000;
export const DOCUMENT_MAX_COUNT = 20;
const PREFIX = 'vendor_public_document_';
const DOCUMENT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const documentJson = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
class DocumentError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const documentFail = (message, status) => { throw new DocumentError(message, status); };
const documentText = (value, limit) => String(value ?? '').trim().slice(0, limit);
const vendorSql = "SELECT id, status, vendor_portal_username FROM welfare_vendors WHERE id = ? AND COALESCE(is_hidden,0) = 0 LIMIT 1";

export function publicDocument(row) {
  return { id: row.id, title: row.title, description: row.description, original_filename: row.original_filename, mime_type: row.mime_type, file_size: row.file_size, display_order: row.display_order, status: row.status, revision: row.revision, updated_at: row.updated_at, preview_url: '/vendor-document/' + encodeURIComponent(row.id), download_url: '/vendor-document/' + encodeURIComponent(row.id) + '?download=1' };
}

export async function validatePublicDocument(file) {
  if (!file || typeof file.slice !== 'function' || !file.name || !file.size) documentFail('請選擇非空白的文件。');
  if (file.size > DOCUMENT_MAX_BYTES) documentFail('每個文件不可超過 50 MB。', 413);
  const extension = file.name.split('.').pop().toLowerCase();
  const mime = DOCUMENT_TYPES[extension];
  if (!mime) documentFail('只支援 JPG、PNG、PDF、DOC、DOCX 文件。');
  if (file.type && file.type !== 'application/octet-stream' && file.type !== mime) documentFail('副檔名與檔案類型不符。');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const starts = values => values.every((value, index) => bytes[index] === value);
  const valid = mime === 'image/jpeg' ? starts([255,216,255]) : mime === 'image/png' ? starts([137,80,78,71,13,10,26,10]) : mime === 'application/pdf' ? starts([37,80,68,70,45]) : extension === 'doc' ? starts([208,207,17,224,161,177,26,225]) : starts([80,75,3,4]);
  if (!valid) documentFail('文件內容與副檔名不符，請選擇原始文件。');
  if (extension === 'docx') await validateWordArchive(file);
  return mime;
}

async function validateWordArchive(file) {
  const start = Math.max(0, file.size - 65557);
  const tail = new Uint8Array(await file.slice(start).arrayBuffer());
  const view = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === tail.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) documentFail('Word 文件格式不正確。');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > 2000 || size > 1_000_000 || offset + size > start + end) documentFail('Word 文件格式不正確。');
  const directory = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
  const data = new DataView(directory.buffer), names = new Set();
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > directory.length || data.getUint32(cursor, true) !== 0x02014b50 || data.getUint16(cursor + 8, true) & 1) documentFail('不支援加密或損壞的 Word 文件。');
    const length = data.getUint16(cursor + 28, true), extra = data.getUint16(cursor + 30, true), comment = data.getUint16(cursor + 32, true);
    if (cursor + 46 + length + extra + comment > directory.length) documentFail('Word 文件格式不正確。');
    names.add(new TextDecoder().decode(directory.slice(cursor + 46, cursor + 46 + length)));
    cursor += 46 + length + extra + comment;
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) documentFail('此檔案不是有效的 DOCX 文件。');
}

async function boundedBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) documentFail('上傳資料過大。', 413);
  if (!request.body) documentFail('請提供文件資料。');
  let size = 0;
  const stream = request.body.pipeThrough(new TransformStream({ transform(chunk, controller) { size += chunk.byteLength; if (size > limit) throw new DocumentError('上傳資料過大。', 413); controller.enqueue(chunk); } }));
  return new Response(stream, { headers: { 'Content-Type': request.headers.get('Content-Type') || '' } });
}

async function listDocuments(db, vendorId, managing) {
  const rows = await db.prepare(`SELECT * FROM welfare_vendor_public_documents WHERE vendor_id = ? AND status ${managing ? "<> 'archived'" : "= 'published'"} ORDER BY display_order,created_at,id LIMIT ?`).bind(vendorId, DOCUMENT_MAX_COUNT).all();
  return (rows.results || []).map(publicDocument);
}

async function authorize(request, env, dependencies, admin, vendorId) {
  if (admin) {
    const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) documentFail('請先登入管理後台。', 403);
    const auth = await dependencies.requireAdmin({ sessionToken: token }, env.DB);
    if (!auth?.ok || auth.user?.role !== 'admin' || !auth.user?.id) documentFail('沒有廠商文件管理權限，請使用有效管理員帳號。', 403);
    return { id: String(auth.user.id), type: 'admin' };
  }
  const cookie = dependencies.readVendorPortalCookie(request) || {};
  const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || cookie.portal_token;
  if (!token) documentFail('請先登入廠商專區。', 403);
  const payload = await dependencies.verifyVendorPortalToken(env, token);
  if (!payload || String(payload.vendor_id) !== vendorId) documentFail('店家登入失效或無權管理此店家。', 403);
  return { id: String(payload.username || ''), type: 'vendor' };
}

export async function handlePublicDocuments(request, env, dependencies, admin = false) {
  let storedKey = null;
  try {
    const url = new URL(request.url), vendorId = documentText(url.searchParams.get('vendor_id'), 100);
    if (!vendorId) documentFail('請選擇店家。');
    if (!env.DB) documentFail('暫時無法取得文件資料。', 503);
    const managing = admin || request.method === 'POST' || url.searchParams.get('manage') === '1';
    if (!['GET','POST'].includes(request.method)) documentFail('不支援此操作。', 405);
    const origin = request.headers.get('Origin');
    if (managing && ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) documentFail('請由店家編輯頁或管理後台操作。', 403);
    const actor = managing ? await authorize(request, env, dependencies, admin, vendorId) : null;
    const vendor = await env.DB.prepare(vendorSql).bind(vendorId).first();
    if (!vendor) documentFail('找不到可用店家。', 404);
    if (actor?.type === 'vendor' && (vendor.status !== 'approved' || actor.id !== vendor.vendor_portal_username)) documentFail('店家尚未核准、已停權或登入失效。', 403);
    if (!managing && vendor.status !== 'approved') documentFail('此店家目前不提供文件下載。', 404);
    if (request.method === 'GET') return documentJson({ success: true, data: { items: await listDocuments(env.DB, vendorId, managing), editable: managing && vendor.status === 'approved' } });
    if (vendor.status !== 'approved') documentFail('店家必須先核准，才能管理公開文件。', 403);
    const multipart = /^multipart\/form-data\b/i.test(request.headers.get('Content-Type') || '');
    const body = await boundedBody(request, multipart ? DOCUMENT_MAX_BYTES + 131072 : 65536);
    const form = multipart ? await body.formData() : null;
    const data = multipart ? Object.fromEntries([...form].filter(([key]) => key !== 'file')) : await body.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) documentFail('文件資料格式不正確。');
    const action = data.action, requestId = String(data.request_id || '');
    if (!['upload','replace','update','archive'].includes(action)) documentFail('不支援的文件操作。');
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) documentFail('缺少有效操作代碼。');
    const fingerprint = JSON.stringify({ ...data, actor_id: actor.id, actor_type: actor.type, ...(multipart ? { filename: form.get('file')?.name, size: form.get('file')?.size } : {}) });
    const previousAction = await env.DB.prepare('SELECT request_data FROM welfare_vendor_public_document_actions WHERE id = ? AND vendor_id = ?').bind(requestId, vendorId).first();
    if (previousAction) {
      if (previousAction.request_data !== fingerprint) documentFail('操作代碼已使用，請重新整理後再操作。', 409);
      return documentJson({ success: true, duplicate: true, data: { items: await listDocuments(env.DB, vendorId, true), editable: true } });
    }
    const id = action === 'upload' ? crypto.randomUUID() : documentText(data.id, 100);
    const previous = action === 'upload' ? null : await env.DB.prepare('SELECT * FROM welfare_vendor_public_documents WHERE id = ? AND vendor_id = ? AND status <> ?').bind(id, vendorId, 'archived').first();
    if (action !== 'upload' && !previous) documentFail('找不到此文件。', 404);
    if (previous && Number(data.revision) !== previous.revision) documentFail('文件已被更新，請重新載入後再修改。', 409);
    const title = documentText(data.title ?? previous?.title, 120), description = documentText(data.description ?? previous?.description, 500);
    const status = action === 'archive' ? 'archived' : data.status || previous?.status || 'hidden';
    if (action !== 'archive' && !['hidden','published'].includes(status)) documentFail('文件顯示狀態不正確。');
    if (!title) documentFail('請填寫文件名稱。');
    if (status === 'published' && data.confirmed !== true && data.confirmed !== 'true') documentFail('請確認此文件可供客戶公開下載。');
    const order = Number(data.display_order ?? previous?.display_order ?? 1);
    if (!Number.isInteger(order) || order < 1 || order > 999) documentFail('順序須為 1 到 999 的整數。');
    let mime = previous?.mime_type, size = previous?.file_size, filename = previous?.original_filename, key = previous?.storage_key;
    if (['upload','replace'].includes(action)) {
      if (!multipart || !env.R2_BUCKET) documentFail('請選擇上傳文件，或稍後重試。');
      const file = form.get('file');
      mime = await validatePublicDocument(file); size = file.size;
      filename = String(file.name).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180);
      key = PREFIX + vendorId + '_' + crypto.randomUUID();
      storedKey = key;
      await env.R2_BUCKET.put(key, file, { httpMetadata: { contentType: mime } });
    }
    const scope = "EXISTS(SELECT 1 FROM welfare_vendors WHERE id = ? AND status = 'approved' AND COALESCE(is_hidden,0) = 0" + (actor.type === 'vendor' ? ' AND vendor_portal_username = ?' : '') + ')';
    const scopeValues = [vendorId, ...(actor.type === 'vendor' ? [actor.id] : [])];
    const change = action === 'upload'
      ? env.DB.prepare(`INSERT INTO welfare_vendor_public_documents(id,vendor_id,title,description,original_filename,mime_type,file_size,storage_key,status,display_order,last_request_id,updated_by) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${scope} AND (SELECT COUNT(*) FROM welfare_vendor_public_documents WHERE vendor_id = ? AND status <> 'archived') < ?`).bind(id,vendorId,title,description,filename,mime,size,key,status,order,requestId,actor.id,...scopeValues,vendorId,DOCUMENT_MAX_COUNT)
      : env.DB.prepare(`UPDATE welfare_vendor_public_documents SET title=?,description=?,original_filename=?,mime_type=?,file_size=?,storage_key=?,status=?,display_order=?,revision=revision+1,last_request_id=?,updated_by=?,updated_at=datetime('now') WHERE id=? AND vendor_id=? AND revision=? AND status <> 'archived' AND ${scope}`).bind(title,description,filename,mime,size,key,status,order,requestId,actor.id,id,vendorId,previous.revision,...scopeValues);
    const current = JSON.stringify({ id,title,description,filename,mime,size,key,status,order,revision:(previous?.revision || 0)+1 });
    const audit = env.DB.prepare(`INSERT INTO welfare_vendor_public_document_actions(id,vendor_id,document_id,actor_id,actor_type,action,request_data,previous_data,current_data) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM welfare_vendor_public_documents WHERE id=? AND vendor_id=? AND last_request_id=?)`).bind(requestId,vendorId,id,actor.id,actor.type,action,fingerprint,JSON.stringify(previous || {}),current,id,vendorId,requestId);
    const results = await env.DB.batch([change,audit]);
    if (!results[0]?.meta?.changes) documentFail(action === 'upload' ? '文件最多 20 個，或店家狀態已變更；請重新載入。' : '文件或店家狀態已變更，請重新載入。', 409);
    storedKey = null;
    return documentJson({ success: true, message: status === 'published' ? '文件已公開，客戶可從商城店家頁下載。' : status === 'archived' ? '文件已下架，舊連結已停止提供。' : '文件已儲存，尚未公開。', data: { items: await listDocuments(env.DB, vendorId, true), editable: true } });
  } catch (error) {
    if (storedKey) { try { await env.R2_BUCKET.delete(storedKey); } catch {} }
    return documentJson({ success: false, message: error instanceof DocumentError ? error.message : error instanceof SyntaxError ? '文件資料格式不正確。' : '文件操作失敗，請重新載入後再試。' }, error instanceof DocumentError ? error.status : error instanceof SyntaxError ? 400 : 503);
  }
}

export async function servePublicDocument(request, env) {
  try {
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url), id = url.pathname.slice('/vendor-document/'.length);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !env.DB || !env.R2_BUCKET) return new Response('Not found', { status: 404 });
    const row = await env.DB.prepare(`SELECT d.* FROM welfare_vendor_public_documents d JOIN welfare_vendors v ON v.id=d.vendor_id WHERE d.id=? AND d.status='published' AND v.status='approved' AND COALESCE(v.is_hidden,0)=0 LIMIT 1`).bind(id).first();
    if (!row) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const object = await env.R2_BUCKET.get(row.storage_key);
    if (!object) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const attachment = url.searchParams.get('download') === '1' || !['application/pdf','image/jpeg','image/png'].includes(row.mime_type);
    const safe = row.original_filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const encoded = encodeURIComponent(row.original_filename).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    return new Response(request.method === 'HEAD' ? null : object.body, { headers: { 'Content-Type':row.mime_type,'Content-Length':String(row.file_size),'Content-Disposition':(attachment?'attachment':'inline')+'; filename="'+safe+'"; filename*=UTF-8\'\''+encoded,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Referrer-Policy':'no-referrer' } });
  } catch { return new Response('Temporarily unavailable', { status: 503, headers: { 'Cache-Control':'no-store' } }); }
}
