export const VENDOR_ASSIST_FIELDS = Object.freeze([
  "name", "legal_name", "tax_id", "owner_name", "company_address",
  "contact_name", "phone", "email", "website_url", "facebook_url",
  "line_oa_id", "category", "discount_policy",
]);

const PRIVATE_IPV4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^22[4-9]\./, /^23\d\./];

export function assertSafeVendorWebsiteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error("網站網址格式不正確。"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("網站網址僅支援 http 或 https。");
  if (url.username || url.password) throw new Error("網站網址不可包含帳號或密碼。");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("網站網址不可使用非標準連接埠。");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("網站網址不可指向內部主機。");
  }
  if (host.includes(":")) throw new Error("網站網址不可直接使用 IPv6 位址。");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.some((part) => part < 0 || part > 255) || PRIVATE_IPV4.some((pattern) => pattern.test(host)) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)) {
      throw new Error("網站網址不可指向內部網路位址。");
    }
  }
  url.hash = "";
  return url.toString();
}

export function validateVendorAssistImage(file, label = "圖片") {
  if (!file || !file.base64) return null;
  const mimeType = String(file.mimeType || file.type || "").toLowerCase();
  const size = Number(file.size || 0);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error(`${label}僅支援 JPG、PNG、WebP。`);
  if (!Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) throw new Error(`${label}不可超過 5MB。`);
  const pureBase64 = String(file.base64).includes(",") ? String(file.base64).split(",").pop() : String(file.base64);
  if (!pureBase64 || pureBase64.length > 7_100_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(pureBase64)) throw new Error(`${label}內容格式不正確。`);
  return { name: String(file.name || label).slice(0, 120), mimeType, size, base64: pureBase64.replace(/\s+/g, "") };
}

export function normalizeVendorRegistrationFields(input = {}) {
  const output = {};
  for (const field of VENDOR_ASSIST_FIELDS) output[field] = String(input[field] || "").trim().slice(0, field === "discount_policy" ? 1500 : 300);
  output.tax_id = output.tax_id.replace(/\D/g, "").slice(0, 8);
  if (!["食", "衣", "住", "行", "育", "樂", "醫療", "生活服務", "其他"].includes(output.category)) output.category = "";
  return output;
}

export function normalizeMoeaCompanyRecord(record = {}) {
  return {
    legal_name: String(record.Company_Name || "").trim(),
    tax_id: String(record.Business_Accounting_NO || "").replace(/\D/g, "").slice(0, 8),
    owner_name: String(record.Responsible_Name || "").trim(),
    company_address: String(record.Company_Location || "").trim(),
    company_status: String(record.Company_Status_Desc || "").trim(),
    register_organization: String(record.Register_Organization_Desc || "").trim(),
  };
}

function normalizedCompanyName(value) {
  return String(value || "").replace(/[\s　()（）·・,，.。]/g, "").toLowerCase();
}

export function chooseMoeaCompanyRecord(records, taxId, names = []) {
  const list = Array.isArray(records) ? records : [];
  const normalizedTaxId = String(taxId || "").replace(/\D/g, "");
  if (normalizedTaxId.length === 8) {
    return list.find((item) => String(item.Business_Accounting_NO || "").replace(/\D/g, "") === normalizedTaxId) || null;
  }
  const expected = names.map(normalizedCompanyName).filter(Boolean);
  if (!expected.length) return null;
  const exact = list.filter((item) => expected.includes(normalizedCompanyName(item.Company_Name)));
  return exact.length === 1 ? exact[0] : null;
}

export function mergeMissingVendorFields(current = {}, extracted = {}, government = {}) {
  const ai = normalizeVendorRegistrationFields(extracted);
  const moea = normalizeVendorRegistrationFields(government);
  const merged = {};
  const filled = [];
  for (const field of VENDOR_ASSIST_FIELDS) {
    const existing = String(current[field] || "").trim();
    const value = existing || String(moea[field] || ai[field] || "").trim();
    merged[field] = value;
    if (!existing && value) filled.push(field);
  }
  return { fields: merged, filled };
}

export function extractVendorFieldsHeuristically(text, websiteUrl = "") {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = value.match(/(?:\+?886[-\s]?)?(?:0\d{1,2}[-\s]?\d{6,8}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})/)?.[0] || "";
  const taxId = value.match(/(?:統一編號|統編|VAT|Tax\s*ID)\s*[:：#]?\s*(\d{8})/i)?.[1] || value.match(/\b\d{8}\b/)?.[0] || "";
  return normalizeVendorRegistrationFields({ tax_id: taxId, phone, email, website_url: websiteUrl });
}
