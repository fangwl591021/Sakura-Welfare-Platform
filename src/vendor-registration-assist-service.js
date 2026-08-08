import {
  assertSafeVendorWebsiteUrl,
  chooseMoeaCompanyRecord,
  extractVendorFieldsHeuristically,
  normalizeMoeaCompanyRecord,
  normalizeVendorRegistrationFields,
  validateVendorAssistImage,
} from "./vendor-registration-assist.js";

async function readTextLimited(response, maxBytes = 300_000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("遠端內容超過讀取上限。");
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    if (total > maxBytes) await reader.cancel().catch(() => {});
  }
}

function htmlToUsefulText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim().slice(0, 20_000);
}

async function fetchWebsiteText(rawUrl) {
  let current = assertSafeVendorWebsiteUrl(rawUrl);
  if (!current) return { url: "", text: "" };
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response;
    try {
      response = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "SAKURA-Welfare-Vendor-Assist/1.0" } });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (response.body) await response.body.cancel().catch(() => {});
      if (!location) throw new Error("網站重新導向缺少位置資訊。");
      current = assertSafeVendorWebsiteUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error(`網站讀取失敗（HTTP ${response.status}）。`);
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error("網站不是可讀取的 HTML 或文字內容。");
    }
    return { url: current, text: htmlToUsefulText(await readTextLimited(response)) };
  }
  throw new Error("網站重新導向次數過多。");
}

async function fetchJsonLimited(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw new Error(`經濟部資料查詢失敗（HTTP ${response.status}）。`);
  }
  const text = await readTextLimited(response, 500_000);
  return JSON.parse(text);
}

async function lookupMoeaCompany(fields) {
  const taxId = String(fields.tax_id || "").replace(/\D/g, "");
  const names = [fields.legal_name, fields.name].map((value) => String(value || "").trim()).filter(Boolean);
  let records = [];
  let dataset = "";
  if (taxId.length === 8) {
    const url = new URL("https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6");
    url.searchParams.set("$format", "json");
    url.searchParams.set("$filter", `Business_Accounting_NO eq ${taxId}`);
    records = await fetchJsonLimited(url);
    dataset = "公司登記基本資料-應用一";
  } else if (names.length) {
    const keyword = names[0].replace(/\s+/g, "").slice(0, 80);
    const url = new URL("https://data.gcis.nat.gov.tw/od/data/api/6BBA2268-1367-4B42-9CCA-BC17499EBE8C");
    url.searchParams.set("$format", "json");
    url.searchParams.set("$top", "20");
    url.searchParams.set("$filter", `Company_Name like ${keyword} and Company_Status eq 01`);
    records = await fetchJsonLimited(url);
    dataset = "公司登記關鍵字查詢";
  }
  const selected = chooseMoeaCompanyRecord(records, taxId, names);
  return selected ? { fields: normalizeMoeaCompanyRecord(selected), dataset } : { fields: {}, dataset: "" };
}

export async function handleVendorRegistrationAssistRequest(request, env, dependencies = {}) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 12 * 1024 * 1024) return { success: false, message: "名片與 DM 上傳資料合計不可超過 12MB。" };
  let data;
  try { data = await request.json(); } catch (_) { return { success: false, message: "請求 JSON 格式錯誤。" }; }
  let businessCard;
  let dm;
  let websiteUrl = "";
  try {
    businessCard = validateVendorAssistImage(data.business_card_file || data.businessCardFile, "名片");
    dm = validateVendorAssistImage(data.dm_file || data.dmFile, "DM");
    websiteUrl = assertSafeVendorWebsiteUrl(data.website_url || data.websiteUrl || "");
  } catch (error) { return { success: false, message: error.message }; }
  if (!businessCard && !dm && !websiteUrl) return { success: false, message: "請至少上傳名片、DM，或輸入網站網址。" };

  const warnings = [];
  let website = { url: websiteUrl, text: "" };
  if (websiteUrl) {
    try { website = await fetchWebsiteText(websiteUrl); } catch (error) { warnings.push(error.message); }
  }
  const heuristic = extractVendorFieldsHeuristically(website.text, website.url || websiteUrl);
  let aiFields = {};
  if (env.OPENAI_API_KEY && dependencies.callOpenAiJsonContent) {
    const content = [{ type: "input_text", text: JSON.stringify({ website_url: website.url || websiteUrl, website_text: website.text.slice(0, 12_000) }) }];
    for (const file of [businessCard, dm].filter(Boolean)) content.push({ type: "input_image", image_url: `data:${file.mimeType};base64,${file.base64}` });
    try {
      const result = await dependencies.callOpenAiJsonContent(env, [
        { role: "system", content: [{ type: "input_text", text: "你是台灣特約店家註冊 OCR 助理。從名片、DM 與網站內容抽取公司及聯絡資料。看不清楚就留空，不得猜測。輸出 JSON：{\"name\":\"\",\"legal_name\":\"\",\"tax_id\":\"\",\"owner_name\":\"\",\"company_address\":\"\",\"contact_name\":\"\",\"phone\":\"\",\"email\":\"\",\"website_url\":\"\",\"facebook_url\":\"\",\"line_oa_id\":\"\",\"category\":\"食|衣|住|行|育|樂|醫療|生活服務|其他\",\"discount_policy\":\"\"}。" }] },
        { role: "user", content },
      ]);
      aiFields = normalizeVendorRegistrationFields(result);
    } catch (error) { warnings.push("AI OCR 暫時無法完成，已保留網站規則擷取結果。"); }
  } else {
    warnings.push("AI OCR 尚未設定，已使用網站與格式規則擷取可辨識資料。");
  }
  const fields = normalizeVendorRegistrationFields(Object.fromEntries(Object.keys(heuristic).map((key) => [key, aiFields[key] || heuristic[key]])));
  const currentFields = normalizeVendorRegistrationFields(data.current || {});
  const lookupFields = { ...fields, tax_id: fields.tax_id || currentFields.tax_id, legal_name: fields.legal_name || currentFields.legal_name, name: fields.name || currentFields.name };
  let government = { fields: {}, dataset: "" };
  try { government = await lookupMoeaCompany(lookupFields); } catch (error) { warnings.push("經濟部資料暫時無法查詢，請人工確認公司資訊與統編。"); }
  const governmentFields = normalizeVendorRegistrationFields(government.fields);
  return {
    success: true,
    message: "辨識完成，系統只會填入目前空白欄位。",
    data: {
      fields: { ...fields, ...Object.fromEntries(Object.entries(governmentFields).filter(([, value]) => value)) },
      ai_fields: fields,
      government_fields: governmentFields,
      moea_matched: Boolean(government.dataset),
      moea_dataset: government.dataset,
      sources: [businessCard ? "名片" : "", dm ? "DM" : "", website.text ? "網站" : "", government.dataset ? `經濟部商業發展署 ${government.dataset}` : ""].filter(Boolean),
      warnings,
    },
  };
}
