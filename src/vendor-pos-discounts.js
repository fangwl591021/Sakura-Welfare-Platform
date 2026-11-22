const DEFAULTS = Object.freeze({ employee_tenths: 80, visitor_tenths: 90, revision: 'default', updated_at: '' });
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' }
});

export function validatePosDiscounts(employee, visitor) {
  const parse = value => {
    if (!['string', 'number'].includes(typeof value) || !/^\d{1,2}(\.\d)?$/.test(String(value).trim())) throw new Error('折數請輸入 0.1 到 10，最多一位小數。');
    const number = Math.round(Number(value) * 10);
    if (!Number.isInteger(number) || number < 1 || number > 100) throw new Error('折數請輸入 0.1 到 10，最多一位小數。');
    return number;
  };
  const employee_tenths = parse(employee), visitor_tenths = parse(visitor);
  if (employee_tenths >= visitor_tenths) throw new Error('員工折數必須小於訪客折數，員工優惠不可相同或更少。');
  return { employee_tenths, visitor_tenths };
}

export async function readPosDiscounts(db, vendorId) {
  // A missing row uses defaults. Database/schema failures must not masquerade as defaults.
  const row = await db.prepare('SELECT employee_tenths, visitor_tenths, revision, updated_at FROM welfare_vendor_pos_discounts WHERE vendor_id = ?').bind(vendorId).first();
  const policy = row || DEFAULTS;
  validatePosDiscounts(policy.employee_tenths / 10, policy.visitor_tenths / 10);
  return { employeeFold: policy.employee_tenths / 10, visitorFold: policy.visitor_tenths / 10,
    revision: policy.revision, updatedAt: policy.updated_at, isDefault: !row };
}

export function posMemberType(member) {
  if (!member) return 'visitor';
  if (member.status !== 'active') throw new Error('用戶狀態無法核銷，請先確認會員資料。');
  return ['employee', 'foreign_employee', 'manager'].includes(member.member_type) && member.bind_status === 'bound' ? 'employee' : 'visitor';
}

export function posDiscountFor(policy, memberType) {
  const employee = memberType === 'employee';
  return { type: 'percent', value: employee ? policy.employeeFold : policy.visitorFold,
    label: (employee ? '員工 ' : '訪客 ') + (employee ? policy.employeeFold : policy.visitorFold) + ' 折',
    source: '本店個人 QR 折扣', revision: policy.revision, memberType };
}

export function calculatePosPayment(original, policy, memberType) {
  if (!Number.isSafeInteger(original) || original < 1 || original > 10000000) throw new Error('消費金額須為 1 到 10,000,000 元的整數。');
  const rule = validatePosDiscounts(policy.employeeFold, policy.visitorFold);
  const rate = memberType === 'employee' ? rule.employee_tenths : rule.visitor_tenths;
  const payable = Math.floor((original * rate + 50) / 100);
  return { original, payable, discount: original - payable, memberType, revision: policy.revision, fold: rate / 10 };
}

export async function quotePersonalQr(db, vendorId, lineUserId, original) {
  const member = await db.prepare('SELECT * FROM welfare_members WHERE line_user_id = ?').bind(lineUserId).first();
  const memberType = posMemberType(member), policy = await readPosDiscounts(db, vendorId);
  return { member, policy, memberType, posDiscount: posDiscountFor(policy, memberType),
    ...(original === undefined ? {} : { payment: calculatePosPayment(original, policy, memberType) }) };
}

export function posRequestId(vendorId, requestId) {
  if (!uuid(requestId)) throw new Error('請重新掃碼確認本次交易。');
  return 'pos:' + vendorId + ':' + requestId;
}

export async function handlePosDiscountRequest(request, db, env, deps) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return response({ success: false, message: '請由本店工作台儲存折數。' }, 403);
  let data;
  try {
    if (Number(request.headers.get('Content-Length')) > 8192) throw new Error();
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
  } catch { return response({ success: false, message: '折扣設定格式不正確。' }, 400); }
  const cookie = deps.readCookie(request) || {};
  const vendorId = String(data.vendor_id || cookie.vendor_id || '').trim();
  const portalToken = String(data.portal_token || cookie.portal_token || '').trim();
  try {
    const access = await deps.authorize(db, env, vendorId, { portalToken });
    if (!access.success) return response({ success: false, message: '請先登入已核准的本店帳號。' }, 403);
    let rules;
    try {
      rules = validatePosDiscounts(data.employeeFold, data.visitorFold);
      if (data.confirmed !== true || !uuid(data.requestId) || typeof data.revision !== 'string') throw new Error('請確認折數後再儲存。');
    } catch (error) { return response({ success: false, message: error.message }, 400); }
    const before = await readPosDiscounts(db, vendorId);
    if (before.revision === data.requestId && before.employeeFold === rules.employee_tenths / 10 && before.visitorFold === rules.visitor_tenths / 10) return response({ success: true, data: before });
    if (before.revision !== data.revision) return response({ success: false, message: '折數已在其他頁面更新，請重新載入後再儲存。' }, 409);
    const now = new Date().toISOString();
    const actor = deps.auditActor || { type: 'vendor', id: vendorId, source: '/api/vendor-pos/discounts' };
    // Optimistic update and its audit are one transaction; losing saves leave no audit.
    const result = await db.batch([
      db.prepare(`INSERT INTO welfare_vendor_pos_discounts (vendor_id, employee_tenths, visitor_tenths, revision, updated_at)
        SELECT ?, ?, ?, ?, ? WHERE ? = 'default' OR EXISTS (
          SELECT 1 FROM welfare_vendor_pos_discounts WHERE vendor_id = ? AND revision = ?)
        ON CONFLICT(vendor_id) DO UPDATE SET employee_tenths = excluded.employee_tenths,
          visitor_tenths = excluded.visitor_tenths, revision = excluded.revision, updated_at = excluded.updated_at
        WHERE welfare_vendor_pos_discounts.revision = ?`).bind(vendorId, rules.employee_tenths, rules.visitor_tenths, data.requestId, now, data.revision, vendorId, data.revision, data.revision),
      db.prepare(`INSERT INTO welfare_audit_events (id, actor_type, actor_id, event_type, target_type, target_id, summary, raw_json, created_at)
        SELECT ?, ?, ?, 'vendor.pos_discounts.update', 'vendor', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM welfare_vendor_pos_discounts WHERE vendor_id = ? AND revision = ?)
        ON CONFLICT(id) DO NOTHING`).bind('pos-policy:' + vendorId + ':' + data.requestId, actor.type, actor.id, vendorId,
        '更新個人 QR 員工／訪客折數', JSON.stringify({ before, after: { employeeFold: rules.employee_tenths / 10, visitorFold: rules.visitor_tenths / 10 }, source: actor.source }), now, vendorId, data.requestId)
    ]);
    if (!Number(result[0]?.meta?.changes)) return response({ success: false, message: '折數已更新，請重新載入。' }, 409);
    return response({ success: true, message: '折數已儲存，後續個人 QR 核銷立即生效。', data: await readPosDiscounts(db, vendorId) });
  } catch { return response({ success: false, message: '目前無法儲存折數，請重新載入確認後再試。' }, 503); }
}
