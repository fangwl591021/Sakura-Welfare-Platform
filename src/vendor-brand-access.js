import { vendorPublicEligibleSql } from './vendor-contract-policy.js';

const UID = /^U[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION = /^[0-9a-f]{64}$/;
const MAX_BRANDS = 50;
const AUDIT_EVENT = 'vendor.brand.management.grant';
const clean = value => typeof value === 'string' ? value.trim() : '';
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const directSql = "(trim(COALESCE(v.contact_line_user_id,''))=? OR trim(COALESCE(v.submitted_by_line_user_id,''))=?)";
const manageSql = `${vendorPublicEligibleSql('v')} AND (b.status IS NULL OR b.status='active')
  AND (${directSql} OR (b.status='active' AND b.management_enabled=1))`;
const joinedFields = `v.*,b.status AS brand_binding_status,b.management_enabled AS brand_management_enabled,
  b.source AS brand_binding_source,b.created_at AS brand_binding_created_at,b.updated_at AS brand_binding_updated_at`;

function uidValue(value) {
  const uid = clean(value);
  if (!UID.test(uid)) throw fail(400, 'invalid_line_user', '請選擇正確的完整 LINE User ID。');
  return uid;
}
function selectedIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BRANDS)
    throw fail(400, 'invalid_brands', `請選擇 1 到 ${MAX_BRANDS} 個品牌。`);
  const ids = value.map(id => clean(id));
  if (ids.some(id => !id || id.length > 200 || /[\x00-\x1f]/.test(id)) || new Set(ids).size !== ids.length)
    throw fail(400, 'invalid_brands', '品牌資料不正確，請重新選擇。');
  return ids.sort();
}
function checkedRows(result) {
  if (result?.success === false || !Array.isArray(result?.results)) throw fail(503, 'brand_access_unavailable', '暫時無法確認品牌權限。');
  return result.results;
}
function isDirect(vendor, uid) { return [clean(vendor.contact_line_user_id), clean(vendor.submitted_by_line_user_id)].includes(uid); }
function managedVendor(vendor, uid) {
  return { ...vendor, management_source: isDirect(vendor, uid) ? 'direct' : 'admin' };
}

// Full vendor rows remain server-side for the existing dashboard/portal builders.
// Public/admin JSON responses must use the explicitly projected options below.
export async function readManageableVendorBrands(db, uid) {
  uid = uidValue(uid);
  const rows = checkedRows(await db.prepare(`SELECT ${joinedFields} FROM welfare_vendors v
    LEFT JOIN welfare_vendor_line_bindings b ON b.vendor_id=v.id AND b.line_user_id=?
    WHERE ${manageSql} ORDER BY v.name,v.id`).bind(uid,uid,uid).all());
  return rows.map(row => managedVendor(row, uid));
}

export async function readManageableVendorBrand(db, uid, vendorId) {
  uid = uidValue(uid); vendorId = clean(vendorId);
  if (!vendorId || vendorId.length > 200) return null;
  const vendor = await db.prepare(`SELECT ${joinedFields} FROM welfare_vendors v
    LEFT JOIN welfare_vendor_line_bindings b ON b.vendor_id=v.id AND b.line_user_id=?
    WHERE v.id=? AND ${manageSql}`).bind(uid,vendorId,uid,uid).first();
  return vendor ? managedVendor(vendor, uid) : null;
}

export async function readSelectedManagedVendor(db, uid) {
  uid = uidValue(uid);
  const selected = await db.prepare('SELECT vendor_id FROM welfare_vendor_line_sessions WHERE line_user_id=?').bind(uid).first();
  return selected?.vendor_id ? readManageableVendorBrand(db, uid, selected.vendor_id) : null;
}

export async function selectManagedVendorBrand(db, uid, vendorId) {
  uid = uidValue(uid); vendorId = clean(vendorId);
  if (!await readManageableVendorBrand(db, uid, vendorId)) throw fail(403, 'brand_access_denied', '此 LINE 帳號目前無法管理這個品牌。');
  const stamp = new Date().toISOString();
  // The session is a selection cache only. Preserve existing onboarding metadata.
  const result = await db.prepare(`INSERT INTO welfare_vendor_line_sessions(line_user_id,vendor_id,created_at,updated_at)
    SELECT ?,v.id,?,? FROM welfare_vendors v
    LEFT JOIN welfare_vendor_line_bindings b ON b.vendor_id=v.id AND b.line_user_id=?
    WHERE v.id=? AND ${manageSql}
    ON CONFLICT(line_user_id) DO UPDATE SET vendor_id=excluded.vendor_id,updated_at=excluded.updated_at`)
    .bind(uid,stamp,stamp,uid,vendorId,uid,uid).run();
  if (result?.success === false || Number(result?.meta?.changes) !== 1) throw fail(409, 'selection_changed', '品牌權限已更新，請重新選擇。');
  const vendor = await readManageableVendorBrand(db, uid, vendorId);
  if (!vendor) throw fail(409, 'selection_changed', '品牌權限已更新，請重新選擇。');
  return vendor;
}

export async function searchVendorBrandManagementUsers(db, query) {
  query = clean(query);
  if (!query || query.length > 100) return { users: [], truncated: false };
  const escaped = query.replace(/[\\%_]/g, '\\$&');
  const rows = checkedRows(await db.prepare(`SELECT line_user_id,display_name FROM line_user_profiles
    WHERE line_user_id=? OR display_name LIKE ? ESCAPE '\\'
    ORDER BY display_name COLLATE NOCASE,line_user_id LIMIT 21`).bind(query,'%'+escaped+'%').all());
  return { users: rows.slice(0,20).filter(row => UID.test(row.line_user_id)).map(row => ({ lineUserId: row.line_user_id, lineDisplayName: clean(row.display_name) })), truncated: rows.length > 20 };
}

async function profileSnapshot(db, uid) {
  const row = await db.prepare('SELECT display_name,updated_at FROM line_user_profiles WHERE line_user_id=?').bind(uid).first();
  return row ? [row.display_name ?? null, row.updated_at ?? null] : null;
}
function option(vendor, uid) {
  const direct = isDirect(vendor, uid), bindingStatus = vendor.brand_binding_status || 'none';
  const managementEnabled = Number(vendor.brand_management_enabled || 0) === 1;
  return { id: vendor.id, name: clean(vendor.name), status: vendor.status, bindingStatus, managementEnabled, direct,
    canManage: bindingStatus !== 'revoked' && (direct || (bindingStatus === 'active' && managementEnabled)) };
}
async function optionRows(db, uid, vendorIds = null) {
  const predicate = vendorIds ? ' AND v.id IN (' + vendorIds.map(() => '?').join(',') + ')' : '';
  return checkedRows(await db.prepare(`SELECT ${joinedFields} FROM welfare_vendors v
    LEFT JOIN welfare_vendor_line_bindings b ON b.vendor_id=v.id AND b.line_user_id=?
    WHERE ${vendorPublicEligibleSql('v')}${predicate} ORDER BY v.id`).bind(uid,...(vendorIds || [])).all());
}

export async function readVendorBrandManagementOptions(db, lineUserId) {
  const uid = uidValue(lineUserId);
  const [profile,rows] = await Promise.all([profileSnapshot(db,uid),optionRows(db,uid)]);
  if (!profile) throw fail(404, 'line_profile_not_found', '尚未取得此 LINE 帳號資料，請先由聊天室建立 LINE 名稱紀錄。');
  return { lineUserId: uid, lineDisplayName: clean(profile?.[0]), brands: rows.map(row => option(row,uid)) };
}

const snapshotFields = ['id','name','status','is_hidden','contract_end','contract_terminated_at','contact_line_user_id','submitted_by_line_user_id','updated_at',
  'brand_binding_status','brand_management_enabled','brand_binding_source','brand_binding_created_at','brand_binding_updated_at'];
const snapshotVendor = vendor => Object.fromEntries(snapshotFields.map(key => [key,vendor[key] ?? null]));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2,'0')).join('');
const actionFor = row => row.brand_binding_status === 'revoked' ? 'restore' : !row.brand_binding_status ? 'add' : Number(row.brand_management_enabled) === 1 ? 'unchanged' : 'enable';

async function batchSnapshot(db, input) {
  const lineUserId = uidValue(input?.lineUserId), vendorIds = selectedIds(input?.vendorIds);
  const [profile,rows] = await Promise.all([profileSnapshot(db,lineUserId),optionRows(db,lineUserId,vendorIds)]);
  if (!profile) throw fail(404, 'line_profile_not_found', '尚未取得此 LINE 帳號資料，請先由聊天室建立 LINE 名稱紀錄。');
  if (rows.length !== vendorIds.length || rows.some((row,index) => row.id !== vendorIds[index]))
    throw fail(409, 'brands_changed', '選定品牌已變更或目前無法授權，請重新預覽。');
  const brands = rows.map(row => ({ ...option(row,lineUserId), action: actionFor(row) }));
  const snapshots = rows.map(snapshotVendor);
  return { lineUserId, lineDisplayName: clean(profile?.[0]), vendorIds, brands, snapshots, profile,
    revision: await digest(['vendor-brand-management-v1',lineUserId,profile,snapshots]) };
}

export async function previewVendorBrandManagement(db, input) {
  const snapshot = await batchSnapshot(db,input);
  const { profile, snapshots, ...data } = snapshot;
  return { ...data, operationId: crypto.randomUUID() };
}

function operationInput(operationId, expected) {
  if (!UUID.test(clean(operationId)) || !REVISION.test(clean(expected?.revision)))
    throw fail(400, 'invalid_preview', '請先預覽品牌與 LINE 帳號，再確認授權。');
  return { operationId: clean(operationId), revision: clean(expected.revision), lineUserId: uidValue(expected.lineUserId), vendorIds: selectedIds(expected.vendorIds) };
}
function operationKey(operationId) { return 'vendor-brand-management:' + operationId; }

export async function getVendorBrandManagementOperation(db, operationId, expected) {
  const input = operationInput(operationId, expected);
  const row = await db.prepare('SELECT event_type,raw_json FROM welfare_audit_events WHERE id=?').bind(operationKey(input.operationId)).first();
  if (!row) return null;
  let stored;
  try { stored = JSON.parse(row.raw_json); } catch { throw fail(409, 'operation_conflict', '操作紀錄無法核對，請保留操作編號。'); }
  if (row.event_type !== AUDIT_EVENT || stored.operationId !== input.operationId || stored.revision !== input.revision || stored.lineUserId !== input.lineUserId || JSON.stringify(stored.vendorIds) !== JSON.stringify(input.vendorIds))
    throw fail(409, 'operation_conflict', '此操作編號已用於不同的品牌或 LINE 帳號，請查核原操作。');
  return { operationId: stored.operationId, revision: stored.revision, lineUserId: stored.lineUserId, lineDisplayName: stored.lineDisplayName,
    vendorIds: stored.vendorIds, appliedCount: stored.appliedCount, duplicated: true };
}

// Version checks are evaluated once inside the same D1 transaction as all grants.
// json_each keeps the bound parameter count small for a multi-brand selection.
const snapshotComparisons = snapshotFields.filter(key => key !== 'id').map(key => {
  const source = key.startsWith('brand_binding_') ? 'b.' + key.replace('brand_binding_', '')
    : key === 'brand_management_enabled' ? 'b.management_enabled' : 'v.' + key;
  return `${source} IS NOT json_extract(expected.value,'$.${key}')`;
}).join(' OR ');
const snapshotGate = `NOT EXISTS(SELECT 1 FROM json_each(?) expected
  LEFT JOIN welfare_vendors v ON v.id=json_extract(expected.value,'$.id')
  LEFT JOIN welfare_vendor_line_bindings b ON b.vendor_id=v.id AND b.line_user_id=?
  WHERE v.id IS NULL OR NOT ${vendorPublicEligibleSql('v')} OR ${snapshotComparisons})`;

export async function confirmVendorBrandManagement(db, input, actor) {
  if (input?.confirmed !== true) throw fail(400, 'confirmation_required', '請核對 LINE 名稱、完整 UID 與品牌後確認。');
  if (actor?.type !== 'admin' || !clean(actor.id) || clean(actor.id).length > 200) throw fail(403, 'admin_required', '需要管理員授權。');
  const expected = operationInput(input.operationId,input);
  const existing = await getVendorBrandManagementOperation(db,expected.operationId,expected);
  if (existing) return existing;
  const snapshot = await batchSnapshot(db,expected);
  if (snapshot.revision !== expected.revision) throw fail(409, 'preview_changed', 'LINE 名稱、品牌或現有權限已更新，請重新預覽。');
  const now = new Date().toISOString(), claim = crypto.randomUUID(), auditId = operationKey(expected.operationId);
  const appliedCount = snapshot.brands.filter(brand => brand.action !== 'unchanged').length;
  const receipt = { ...expected, lineDisplayName: snapshot.lineDisplayName, appliedCount };
  const raw = JSON.stringify({ ...receipt, claim, brands: snapshot.brands });
  const ownClaim = "EXISTS(SELECT 1 FROM welfare_audit_events WHERE id=? AND event_type=? AND json_extract(raw_json,'$.claim')=?)";
  const statements = [db.prepare(`INSERT INTO welfare_audit_events(id,actor_type,actor_id,event_type,target_type,target_id,summary,raw_json,created_at)
    SELECT ?,'admin',?,?,'line_user',?,'批次授予選定品牌管理權',?,? WHERE ${snapshotGate}
      AND COALESCE((SELECT json_array(display_name,updated_at) FROM line_user_profiles WHERE line_user_id=?),'null')=?
    ON CONFLICT(id) DO NOTHING`)
    .bind(auditId,clean(actor.id),AUDIT_EVENT,snapshot.lineUserId,raw,now,JSON.stringify(snapshot.snapshots),snapshot.lineUserId,snapshot.lineUserId,JSON.stringify(snapshot.profile))];
  for (const brand of snapshot.brands) statements.push(db.prepare(`INSERT INTO welfare_vendor_line_bindings(vendor_id,line_user_id,status,source,created_at,updated_at,management_enabled)
    SELECT ?,?,'active','admin_brand_management',?,?,1 WHERE ${ownClaim}
    ON CONFLICT(vendor_id,line_user_id) DO UPDATE SET status='active',management_enabled=1,updated_at=excluded.updated_at
      WHERE welfare_vendor_line_bindings.status<>'active' OR welfare_vendor_line_bindings.management_enabled<>1`)
    .bind(brand.id,snapshot.lineUserId,now,now,auditId,AUDIT_EVENT,claim));
  try { await db.batch(statements); }
  catch {
    const recovered = await getVendorBrandManagementOperation(db,expected.operationId,expected);
    if (recovered) return recovered;
    throw fail(503, 'grant_unavailable', '授權結果暫時無法確認，請保留原操作編號查詢，勿重新建立操作。');
  }
  const result = await getVendorBrandManagementOperation(db,expected.operationId,expected);
  if (!result) throw fail(409, 'preview_changed', 'LINE 名稱、品牌或現有權限已更新，未套用授權，請重新預覽。');
  const saved = await db.prepare('SELECT raw_json FROM welfare_audit_events WHERE id=?').bind(auditId).first();
  return { ...result, duplicated: JSON.parse(saved.raw_json).claim !== claim };
}
