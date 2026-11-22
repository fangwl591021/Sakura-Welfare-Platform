import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { localizeBusinessHours, localizeStoreUrl } from "../src/vendor-store-localization.js";

// Tony accepted release f52143ed on 2026-09-18. Changes require his approval;
// never update this hash merely to make deployment pass.
const ACCEPTED_HOURS_SHA256 = "a62457550065b482516c1a5b2a3c927617637c65a4d388103db87f37a242996e";
const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const raw = "營業時間：\n星期一\t休息\n星期二\t11:00–00:00\n星期三\t11:00–00:00\n星期四\t11:00–00:00\n星期五\t11:00–00:00\n星期六\t11:00–00:00\n星期日\t11:00–00:00";

function requireWiring(text) {
  const start = text.indexOf("function buildVendorStoreHtml(");
  const end = text.indexOf("const vendorRedeemHtml", start);
  assert.ok(start >= 0 && end > start, "Locked storefront renderer missing");
  const store = text.slice(start, end);
  const listStart = text.indexOf("function buildPartnerStoresHtml(");
  const listEnd = text.indexOf("async function getMedicalProviderDirectory", listStart);
  assert.ok(listStart >= 0 && listEnd > listStart, "Locked directory renderer missing");
  const list = text.slice(listStart, listEnd);
  assert.ok(text.includes('buildVendorStoreHtml(url.searchParams.get("lang"))'), "Store route must keep lang");
  for (const template of [store, list]) assert.ok(template.includes("${localizeBusinessHours.toString()}"), "Both pages must load the hours translator");
  assert.ok(store.includes("multiline(localizeBusinessHours(primary.business_hours,STORE_LOCALE))"), "Store details must translate and escape hours");
  assert.ok(list.includes("[TEXT.hours,localizeBusinessHours(s.businessHours,STORE_LOCALE)]"), "Directory sheet must translate hours");
  assert.ok(list.includes(String.raw`esc(v||TEXT.empty).replace(/\\r?\\n/g,"<br>")`), "Directory must retain escaped multiline hours");
  assert.ok(list.includes("localizeStoreUrl(normalizeUrl(s.storeUrl||s.websiteUrl),STORE_LOCALE,location.origin)"), "Store links must carry locale");
  assert.ok(store.includes('input.value=primary.business_hours||""'), "Editor must retain original schedule");
  assert.ok(store.includes('const businessHours=input.value||""'), "Saving must use editable source, not translated display");
}

test("accepted business-hours implementation cannot be silently rewritten", () => {
  const actual = createHash("sha256").update(localizeBusinessHours.toString().replaceAll("\r\n", "\n")).digest("hex");
  assert.equal(actual, ACCEPTED_HOURS_SHA256, "Locked hours implementation changed. Obtain Tony approval; do not silently update the baseline.");
});
test("accepted seven-day Chinese, Indonesian and Thai schedule output is fixed", () => {
  assert.equal(localizeBusinessHours(raw, "zh"), raw);
  assert.equal(localizeBusinessHours(raw, "id"), "Jam operasional：\nSenin\tTutup\nSelasa\t11:00–00:00\nRabu\t11:00–00:00\nKamis\t11:00–00:00\nJumat\t11:00–00:00\nSabtu\t11:00–00:00\nMinggu\t11:00–00:00");
  assert.equal(localizeBusinessHours(raw, "th"), "เวลาเปิดทำการ：\nวันจันทร์\tปิด\nวันอังคาร\t11:00–00:00\nวันพุธ\t11:00–00:00\nวันพฤหัสบดี\t11:00–00:00\nวันศุกร์\t11:00–00:00\nวันเสาร์\t11:00–00:00\nวันอาทิตย์\t11:00–00:00");
});
test("hours remain editable data rather than hardcoded acceptance times", () => {
  for (const locale of ["zh", "id", "th"]) {
    assert.equal(localizeBusinessHours("08:15–22:45", locale), "08:15–22:45");
    assert.equal(localizeBusinessHours("備註待確認", locale), "備註待確認");
  }
  assert.equal(localizeBusinessHours("星期二 08:15–22:45", "id"), "Selasa 08:15–22:45");
});
test("both display entries, locale links and original editing values remain wired", () => requireWiring(source));
test("guard rejects removal from either display entry and translated edit values", () => {
  requireWiring(source);
  for (const [from, to] of [
    ["multiline(localizeBusinessHours(primary.business_hours,STORE_LOCALE))", "multiline(primary.business_hours)"],
    ["[TEXT.hours,localizeBusinessHours(s.businessHours,STORE_LOCALE)]", "[TEXT.hours,s.businessHours]"],
    ['input.value=primary.business_hours||""', 'input.value=localizeBusinessHours(primary.business_hours,STORE_LOCALE)'],
  ]) assert.throws(() => requireWiring(source.replace(from, to)), assert.AssertionError);
});
test("directory links keep locale without rewriting external merchant URLs", () => {
  for (const locale of ["id", "th"]) {
    assert.equal(localizeStoreUrl("/vendor-store?vendor_id=fixture", locale, "https://fixture.test"), "/vendor-store?vendor_id=fixture&lang=" + locale);
    assert.equal(localizeStoreUrl("https://merchant.test/", locale, "https://fixture.test"), "https://merchant.test/");
  }
});
