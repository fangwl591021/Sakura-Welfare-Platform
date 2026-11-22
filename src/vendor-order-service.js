import { readBoundedAdminJson } from './editor-access.js';

const STEP = 1048576;
const writable = new Set(['admin', 'operator', 'vendor_manager']);
const readable = new Set([...writable, 'viewer']);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const error = (status, code, message) => json({ success: false, code, message }, status);
const validAlias = value => { if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw Error('Invalid SQL alias'); return value; };
export function vendorOrderJoin(v = 'v', o = 'vendor_order') { return `LEFT JOIN welfare_vendor_order ${validAlias(o)} ON ${o}.vendor_id = ${validAlias(v)}.id`; }
export function vendorOrderBy(v = 'v', o = 'vendor_order') {
  validAlias(v); validAlias(o);
  return `CASE WHEN ${o}.vendor_id IS NULL THEN 0 ELSE 1 END ASC, CASE WHEN ${o}.vendor_id IS NULL THEN datetime(${v}.created_at) END DESC, ${o}.rank DESC, ${v}.id DESC`;
}

// The surrounding route also performs the standard origin and admin-session guard.
// Do not trust UI visibility as an authorization boundary.
export async function handleVendorOrderRequest(request, db, principal) {
  if (!db) return error(503, 'UNAVAILABLE', '排序服務暫時無法使用。');
  if (!principal) return error(403, 'FORBIDDEN', '無權使用店家排序。');
  // LINE whitelist roles are mapped to the generic "final" session role at
  // login. Resolve the current whitelist again; never infer broad rights from
  // that generic role, and immediately honor deactivation or reassignment.
  const lineId = String(principal.line_user_id || (String(principal.actor || '').startsWith('line:') ? principal.id : '') || '');
  let role = String(principal.role || '');
  if (lineId) {
    let access;
    try { access = await db.prepare('SELECT role,allowed_modules,active FROM admin_uid_whitelist WHERE line_user_id=? LIMIT 1').bind(lineId).first(); }
    catch { return error(503, 'ORDER_UNAVAILABLE', '暫時無法確認排序權限。'); }
    const modules = String(access?.allowed_modules || '*').split(',').map(x => x.trim());
    if (!access || Number(access.active)!==1 || (!modules.includes('*') && !modules.includes('vendor'))) return error(403, 'FORBIDDEN', '無權使用店家排序。');
    role = String(access.role || '');
  }
  if (!readable.has(role)) return error(403, 'FORBIDDEN', '無權使用店家排序。');
  if (request.method === 'GET') {
    const u = new URL(request.url), q = String(u.searchParams.get('q') || '').trim().slice(0, 100);
    const rawPage = u.searchParams.get('page') || '1';
    if (!/^[1-9]\d{0,6}$/.test(rawPage)) return error(400, 'INVALID_PAGE', '頁碼不正確。');
    const page = Number(rawPage), like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    try {
      const [state, count, rows] = await db.batch([
        db.prepare('SELECT revision FROM welfare_vendor_order_state WHERE id=1'),
        db.prepare("SELECT COUNT(*) AS total FROM welfare_vendors v WHERE COALESCE(v.is_hidden,0)=0 AND (v.name LIKE ? ESCAPE '\\' OR v.id LIKE ? ESCAPE '\\' OR v.category LIKE ? ESCAPE '\\')").bind(like, like, like),
        db.prepare(`SELECT v.id,v.name,v.category,v.status,v.created_at FROM welfare_vendors v ${vendorOrderJoin()} WHERE COALESCE(v.is_hidden,0)=0 AND (v.name LIKE ? ESCAPE '\\' OR v.id LIKE ? ESCAPE '\\' OR v.category LIKE ? ESCAPE '\\') ORDER BY ${vendorOrderBy()} LIMIT 50 OFFSET ?`).bind(like, like, like, (page-1)*50)
      ]);
      const revision = Number(state.results?.[0]?.revision);
      if (!Number.isSafeInteger(revision)) throw Error('Missing order state');
      const total = Number(count.results?.[0]?.total || 0), items = rows.results || [];
      return json({success:true, items, page, next_page:page*50<total?page+1:null, total, revision, can_write:writable.has(role)});
    } catch { return error(503, 'ORDER_UNAVAILABLE', '排序資料暫時無法讀取。'); }
  }
  if (request.method !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', '不支援此操作。');
  if (!writable.has(role)) return error(403, 'FORBIDDEN', '無權調整店家排序。');
  let body; try { body = await readBoundedAdminJson(request, 4096); } catch { return error(400, 'INVALID_REQUEST', '送出的排序資料有誤。'); }
  const action = String(body?.action || ''), id = String(body?.id || ''), target = String(body?.target_id || ''), requestId = String(body?.request_id || '');
  const revision = body?.revision;
  if (!['top','before','after'].includes(action) || !id || id.length > 150 || target.length > 150 || (action !== 'top' && (!target || id === target)) || (action === 'top' && target) || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId) || !Number.isSafeInteger(revision) || revision < 0) return error(400, 'INVALID_REQUEST', '送出的排序資料有誤。');
  const actor = String(principal.actor || principal.id || '').slice(0, 200);
  if (!actor) return error(403, 'FORBIDDEN', '無法確認操作者。');
  const fingerprint = JSON.stringify([action,id,target]);
  const op = crypto.randomUUID();
  const tokenGuard = 'EXISTS (SELECT 1 FROM welfare_vendor_order_state WHERE id=1 AND operation_token=?)';
  const guard = db.prepare(`UPDATE welfare_vendor_order_state SET revision=revision+1,operation_token=? WHERE id=1 AND revision=? AND NOT EXISTS(SELECT 1 FROM welfare_vendor_order_actions WHERE request_id=?) AND EXISTS(SELECT 1 FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0) AND (?='top' OR EXISTS(SELECT 1 FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0))`).bind(op,revision,requestId,id,action,target);
  // Initialize previously unseen vendors in their creation order. New vendors are
  // always ahead while unranked, including vendors inserted after this transaction.
  const seed = db.prepare(`INSERT INTO welfare_vendor_order(vendor_id,rank)
    SELECT v.id, COALESCE((SELECT MAX(rank) FROM welfare_vendor_order),0) + ROW_NUMBER() OVER (ORDER BY COALESCE(datetime(v.created_at),'0000-01-01') ASC,v.id ASC)*${STEP}
    FROM welfare_vendors v LEFT JOIN welfare_vendor_order o ON o.vendor_id=v.id
    WHERE o.vendor_id IS NULL AND ${tokenGuard}`).bind(op);
  // Sparse integer ranks avoid rewriting the catalog on normal moves. Materialized
  // window snapshot preserves the old order even when rows are updated in-place.
  const rebalance = db.prepare(`WITH ordered AS MATERIALIZED (SELECT vendor_id,rank,LAG(rank) OVER (ORDER BY rank,vendor_id) AS prev FROM welfare_vendor_order),
    need AS MATERIALIZED (SELECT 1 FROM ordered WHERE (prev IS NOT NULL AND rank-prev<=1) OR rank > 8000000000000000000 OR rank < -8000000000000000000 LIMIT 1),
    ranks AS MATERIALIZED (SELECT vendor_id,ROW_NUMBER() OVER (ORDER BY rank,vendor_id)*${STEP} AS n FROM ordered)
    UPDATE welfare_vendor_order SET rank=(SELECT n FROM ranks WHERE ranks.vendor_id=welfare_vendor_order.vendor_id)
    WHERE EXISTS(SELECT 1 FROM need) AND ${tokenGuard}`).bind(op);
  const move = db.prepare(`UPDATE welfare_vendor_order SET rank=CASE ?
    WHEN 'top' THEN COALESCE((SELECT MAX(rank) FROM welfare_vendor_order WHERE vendor_id<>?),0)+${STEP}
    WHEN 'before' THEN (SELECT rank FROM welfare_vendor_order WHERE vendor_id=?) + (COALESCE((SELECT MIN(rank) FROM welfare_vendor_order WHERE vendor_id<>? AND rank>(SELECT rank FROM welfare_vendor_order WHERE vendor_id=?)),(SELECT rank+${STEP} FROM welfare_vendor_order WHERE vendor_id=?))-(SELECT rank FROM welfare_vendor_order WHERE vendor_id=?))/2
    ELSE (SELECT rank FROM welfare_vendor_order WHERE vendor_id=?) - ((SELECT rank FROM welfare_vendor_order WHERE vendor_id=?)-COALESCE((SELECT MAX(rank) FROM welfare_vendor_order WHERE vendor_id<>? AND rank<(SELECT rank FROM welfare_vendor_order WHERE vendor_id=?)),(SELECT rank-${STEP} FROM welfare_vendor_order WHERE vendor_id=?)))/2 END
    WHERE vendor_id=? AND ${tokenGuard}`).bind(action,id,target,id,target,target,target,target,target,id,target,target,id,op);
  const audit = db.prepare(`INSERT INTO welfare_vendor_order_actions(request_id,actor,fingerprint,revision,action,vendor_id,target_id) SELECT ?,?,?,revision,?,?,? FROM welfare_vendor_order_state WHERE id=1 AND operation_token=?`).bind(requestId,actor,fingerprint,action,id,target,op);
  try {
    await db.batch([guard,seed,rebalance,move,audit]);
    const row = await db.prepare('SELECT actor,fingerprint,revision FROM welfare_vendor_order_actions WHERE request_id=?').bind(requestId).first();
    if (row) {
      if (row.actor !== actor || row.fingerprint !== fingerprint) return error(409, 'REQUEST_ID_CONFLICT', '這次操作識別碼已使用，請重新操作。');
      return json({success:true,revision:Number(row.revision)});
    }
    const current = await db.prepare('SELECT revision FROM welfare_vendor_order_state WHERE id=1').first();
    if (!current) return error(503, 'ORDER_UNAVAILABLE', '排序服務暫時無法使用。');
    if (Number(current.revision) !== revision) return error(409, 'REVISION_CONFLICT', '排序已變更，請重新載入。');
    return error(400, 'VENDOR_NOT_FOUND', '店家不存在或已隱藏，請重新載入。');
  } catch { return error(503, 'ORDER_UNAVAILABLE', '排序儲存失敗，請稍後重試。'); }
}
