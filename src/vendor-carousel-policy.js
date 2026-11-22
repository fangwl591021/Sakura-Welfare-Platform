export const MAX_VENDOR_CAROUSEL_ITEMS = 6;

export function validateVendorCarouselImage(file) {
  if (!file || !file.base64) throw new Error("請選擇要上傳的 DM 圖片。");
  const mimeType = String(file.mimeType || file.type || "").toLowerCase();
  const size = Number(file.size || 0);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("跑馬燈僅支援 JPG、PNG、WebP。");
  if (!Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) throw new Error("單張 DM 圖片不可超過 5MB。");
  const pureBase64 = String(file.base64).includes(",") ? String(file.base64).split(",").pop() : String(file.base64);
  if (!pureBase64 || pureBase64.length > 7_100_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(pureBase64)) throw new Error("DM 圖片格式不正確。");
  return { name: String(file.name || "dm").slice(0, 120), mimeType, size, base64: pureBase64.replace(/\s+/g, "") };
}

export function normalizeVendorCarouselOrder(ids) {
  if (!Array.isArray(ids)) throw new Error("排序資料格式不正確。");
  const normalized = ids.map((id) => String(id || "").trim()).filter(Boolean);
  if (!normalized.length || normalized.length > MAX_VENDOR_CAROUSEL_ITEMS || new Set(normalized).size !== normalized.length) {
    throw new Error("跑馬燈排序資料不正確。");
  }
  return normalized;
}
