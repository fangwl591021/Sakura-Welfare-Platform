import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeVendorWebsiteUrl, chooseMoeaCompanyRecord, mergeMissingVendorFields, normalizeMoeaCompanyRecord } from "../src/vendor-registration-assist.js";

test("website URL guard rejects local and private targets", () => {
  for (const value of ["http://localhost/test", "http://127.0.0.1/", "http://192.168.1.9/", "ftp://example.com/file"]) {
    assert.throws(() => assertSafeVendorWebsiteUrl(value));
  }
  assert.equal(assertSafeVendorWebsiteUrl("https://example.com/about"), "https://example.com/about");
});

test("MOEA exact match maps authoritative company fields", () => {
  const source = { Business_Accounting_NO: "22099131", Company_Name: "台灣積體電路製造股份有限公司", Responsible_Name: "張三", Company_Location: "新竹市測試路1號" };
  assert.equal(chooseMoeaCompanyRecord([source], "22099131"), source);
  assert.deepEqual(normalizeMoeaCompanyRecord(source), {
    legal_name: "台灣積體電路製造股份有限公司", tax_id: "22099131", owner_name: "張三", company_address: "新竹市測試路1號", company_status: "", register_organization: "",
  });
});

test("assistant never overwrites manually entered fields", () => {
  const result = mergeMissingVendorFields(
    { name: "人工店名", phone: "04-1234567" },
    { name: "AI 店名", phone: "09-9999999", email: "ai@example.com" },
    { legal_name: "政府公司名", tax_id: "12345678" },
  );
  assert.equal(result.fields.name, "人工店名");
  assert.equal(result.fields.phone, "04-1234567");
  assert.equal(result.fields.email, "ai@example.com");
  assert.equal(result.fields.legal_name, "政府公司名");
});
