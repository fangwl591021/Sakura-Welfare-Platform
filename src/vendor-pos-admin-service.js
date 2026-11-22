import { readPosDiscounts, handlePosDiscountRequest } from './vendor-pos-discounts.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handleAdminPosDiscountRequest(request, env, { requireAdmin }) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ success: false, message: '請由管理後台操作。' }, 403);
  if (!['GET', 'POST'].includes(request.method)) return json({ success: false, message: '不支援此操作。' }, 405);
  try {
    const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ success: false, code: 'SESSION_REQUIRED', message: '請先登入管理後台。' }, 403);
    const auth = await requireAdmin({ sessionToken: token }, env.DB);
    if (!auth?.ok) return json({ success: false, code: 'SESSION_EXPIRED', message: '後台登入已失效，請重新登入後再載入折扣。' }, 403);
    // Existing system administrators have full backend access regardless of unit scope.
    if (auth.user?.role !== 'admin' || !auth.user?.id) {
      return json({ success: false, code: 'ADMIN_REQUIRED', message: '目前登入帳號不是有效的系統管理員，請確認後台帳號角色。' }, 403);
    }
    if (request.method === 'GET') {
      const vendorId = String(url.searchParams.get('vendor_id') || '').trim();
      if (!vendorId) return json({ success: false, message: '請選擇廠商。' }, 400);
      const vendor = await env.DB.prepare('SELECT id, status FROM welfare_vendors WHERE id = ? AND COALESCE(is_hidden, 0) = 0 LIMIT 1').bind(vendorId).first();
      if (!vendor) return json({ success: false, message: '找不到可管理的廠商。' }, 404);
      return json({ success: true, data: { ...await readPosDiscounts(env.DB, vendorId), editable: vendor.status === 'approved' } });
    }
    return await handlePosDiscountRequest(request, env.DB, env, {
      readCookie: () => null,
      authorize: async (db, unusedEnv, vendorId) => {
        const vendor = await db.prepare('SELECT id FROM welfare_vendors WHERE id = ? AND status = ? AND COALESCE(is_hidden, 0) = 0 LIMIT 1').bind(vendorId, 'approved').first();
        return { success: Boolean(vendor) };
      },
      auditActor: { type: 'admin', id: String(auth.user.id), source: '/admin-api/vendor-pos-discounts' },
    });
  } catch {
    return json({ success: false, message: '暫時無法取得或儲存折扣設定，請重新載入。' }, 503);
  }
}
