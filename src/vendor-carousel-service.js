import { MAX_VENDOR_CAROUSEL_ITEMS, normalizeVendorCarouselOrder, validateVendorCarouselImage } from "./vendor-carousel-policy.js";

export async function listVendorCarouselItems(db, vendorId) {
  const rows = await db.prepare(`
    SELECT id, image_url, original_filename, display_order, created_at
    FROM welfare_vendor_carousel_items
    WHERE vendor_id = ? AND status = 'active'
    ORDER BY display_order ASC, created_at ASC
    LIMIT ?
  `).bind(String(vendorId || "").trim(), MAX_VENDOR_CAROUSEL_ITEMS).all();
  return rows.results || [];
}

async function requirePortalAccount(db, env, vendorId, portalToken, verifyVendorPortalToken) {
  const payload = await verifyVendorPortalToken(env, portalToken);
  if (!payload || String(payload.vendor_id || "") !== vendorId) return null;
  const vendor = await db.prepare(`
    SELECT id, name, status, vendor_portal_username
    FROM welfare_vendors
    WHERE id = ? AND COALESCE(is_hidden, 0) = 0
    LIMIT 1
  `).bind(vendorId).first();
  if (!vendor || !["pending", "rejected", "approved"].includes(String(vendor.status || "pending"))) return null;
  if (String(payload.username || "") !== String(vendor.vendor_portal_username || "")) return null;
  return { vendor, username: String(payload.username || "") };
}

async function storeCarouselImage(bucket, origin, vendorId, file) {
  const safeName = String(file.name || "dm").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
  const key = `vendor_carousel_${vendorId}_${Date.now()}_${crypto.randomUUID()}_${safeName}`;
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
  await bucket.put(key, bytes, { httpMetadata: { contentType: file.mimeType } });
  return { key, url: `${origin}/file/${encodeURIComponent(key)}` };
}

export async function handleVendorCarouselRequest(request, db, env, origin, dependencies = {}) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8 * 1024 * 1024) return { success: false, message: "單次上傳資料不可超過 8MB。" };
  let data;
  try { data = await request.json(); } catch (_) { return { success: false, message: "請求 JSON 格式錯誤。" }; }

  const cookieSession = dependencies.readVendorPortalCookie ? dependencies.readVendorPortalCookie(request) : {};
  const vendorId = String(data.vendor_id || data.vendorId || cookieSession.vendor_id || "").trim();
  const portalToken = String(data.portal_token || data.portalToken || cookieSession.portal_token || "").trim();
  if (!vendorId || !portalToken) return { success: false, message: "請先使用店家帳號與密碼登入廠商專區。" };
  const access = await requirePortalAccount(db, env, vendorId, portalToken, dependencies.verifyVendorPortalToken);
  if (!access) return { success: false, message: "店家登入已失效，請重新使用帳號與密碼登入。" };

  const action = String(data.action || "upload").trim();
  if (action === "upload") {
    const requestId = String(data.request_id || data.requestId || "").trim().slice(0, 80);
    if (requestId) {
      const duplicate = await db.prepare(`SELECT id FROM welfare_vendor_carousel_items WHERE vendor_id = ? AND request_id = ? LIMIT 1`).bind(vendorId, requestId).first();
      if (duplicate) return { success: true, message: "這張 DM 已上傳。", data: { items: await listVendorCarouselItems(db, vendorId), duplicate: true } };
    }
    const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM welfare_vendor_carousel_items WHERE vendor_id = ? AND status = 'active'`).bind(vendorId).first();
    const count = Number(countRow && countRow.count || 0);
    if (count >= MAX_VENDOR_CAROUSEL_ITEMS) return { success: false, message: `跑馬燈最多 ${MAX_VENDOR_CAROUSEL_ITEMS} 張，請先刪除舊圖片。` };
    if (!env.R2_BUCKET) return { success: false, message: "R2_BUCKET 尚未設定，無法上傳 DM。" };
    let file;
    try { file = validateVendorCarouselImage(data.file || data.image_file || data.imageFile); } catch (error) { return { success: false, message: error.message }; }
    const stored = await storeCarouselImage(env.R2_BUCKET, origin, vendorId, file);
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO welfare_vendor_carousel_items (
        id, vendor_id, image_url, storage_key, original_filename, request_id,
        actor_username, display_order, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `).bind(id, vendorId, stored.url, stored.key, file.name, requestId, access.username, count).run();
    if (dependencies.auditWelfareEvent) await dependencies.auditWelfareEvent(db, access.username, "vendor_approved", "vendor.carousel.upload", "vendor", vendorId, "店家新增 DM 跑馬燈圖片", { id, filename: file.name });
    return { success: true, message: "DM 已加入跑馬燈。", data: { items: await listVendorCarouselItems(db, vendorId) } };
  }

  if (action === "reorder") {
    let ids;
    try { ids = normalizeVendorCarouselOrder(data.ids); } catch (error) { return { success: false, message: error.message }; }
    const current = await listVendorCarouselItems(db, vendorId);
    const currentIds = current.map((item) => String(item.id));
    if (ids.length !== currentIds.length || ids.some((id) => !currentIds.includes(id))) return { success: false, message: "排序清單與目前圖片不一致，請重新整理。" };
    await db.batch(ids.map((id, index) => db.prepare(`UPDATE welfare_vendor_carousel_items SET display_order = ?, updated_at = datetime('now') WHERE id = ? AND vendor_id = ? AND status = 'active'`).bind(index, id, vendorId)));
    if (dependencies.auditWelfareEvent) await dependencies.auditWelfareEvent(db, access.username, "vendor_approved", "vendor.carousel.reorder", "vendor", vendorId, "店家調整 DM 跑馬燈順序", { ids });
    return { success: true, message: "跑馬燈順序已更新。", data: { items: await listVendorCarouselItems(db, vendorId) } };
  }

  if (action === "delete") {
    const id = String(data.id || "").trim();
    if (!id) return { success: false, message: "缺少要刪除的圖片代碼。" };
    const result = await db.prepare(`UPDATE welfare_vendor_carousel_items SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND vendor_id = ? AND status = 'active'`).bind(id, vendorId).run();
    if (!Number(result.meta && result.meta.changes || 0)) return { success: false, message: "找不到這張跑馬燈圖片。" };
    const remaining = await listVendorCarouselItems(db, vendorId);
    if (remaining.length) await db.batch(remaining.map((item, index) => db.prepare(`UPDATE welfare_vendor_carousel_items SET display_order = ?, updated_at = datetime('now') WHERE id = ? AND vendor_id = ?`).bind(index, item.id, vendorId)));
    if (dependencies.auditWelfareEvent) await dependencies.auditWelfareEvent(db, access.username, "vendor_approved", "vendor.carousel.archive", "vendor", vendorId, "店家移除 DM 跑馬燈圖片", { id });
    return { success: true, message: "DM 已從跑馬燈移除。", data: { items: await listVendorCarouselItems(db, vendorId) } };
  }

  return { success: false, message: "不支援的跑馬燈操作。" };
}
