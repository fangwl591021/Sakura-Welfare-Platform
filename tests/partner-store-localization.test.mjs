import test from "node:test";
import assert from "node:assert/strict";

import { getPartnerStoreOptionLabels } from "../src/partner-store-localization.js";

test("Indonesian partner-store filters translate categories and regions", () => {
  const labels = getPartnerStoreOptionLabels("id");
  assert.equal(labels.categories["食"], "Makanan");
  assert.equal(labels.categories["醫療"], "Layanan medis");
  assert.equal(labels.categories["生活服務"], "Layanan sehari-hari");
  assert.equal(labels.regions["北部"], "Utara");
  assert.equal(labels.regions["離島"], "Pulau terluar");
});

test("Thai partner-store filters translate categories and regions", () => {
  const labels = getPartnerStoreOptionLabels("th");
  assert.equal(labels.categories["食"], "อาหาร");
  assert.equal(labels.categories["醫療"], "การแพทย์");
  assert.equal(labels.categories["生活服務"], "บริการในชีวิตประจำวัน");
  assert.equal(labels.regions["北部"], "ภาคเหนือ");
  assert.equal(labels.regions["離島"], "หมู่เกาะรอบนอก");
});

test("unknown locale falls back to the original Chinese values", () => {
  const labels = getPartnerStoreOptionLabels("unknown");
  assert.equal(labels.categories["食"], "食");
  assert.equal(labels.regions["中部"], "中部");
});
