import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("D:/OneDrive/文件/New project 5/src/index.js", "utf8");
const service = fs.readFileSync("D:/OneDrive/文件/New project 5/src/vendor-carousel-service.js", "utf8");

test("registration editor and vendor portal share the carousel API", () => {
  assert.ok(source.includes('id="registrationCarouselCard"'));
  assert.ok(source.includes("與廠商專區、店家公開頁共用同一組圖片"));
  assert.ok(source.includes('fetch("/api/vendor-store/carousel"'));
  assert.ok(source.includes("carouselItems = await listVendorCarouselItems"));
  assert.ok(source.includes("canManageCarousel"));
});

test("existing applications require portal account authentication", () => {
  assert.ok(source.includes("既有廠商資料修改必須先使用店家帳號與密碼登入廠商專區。"));
  assert.equal((source.match(/getVendorApplication\(DB, applyVendorPortalCookieToUrl\(request, url\)/g) || []).length, 2);
});

test("post-registration carousel management permits active review states only", () => {
  assert.ok(service.includes('["pending", "rejected", "approved"]'));
});

test("admin registration editor exposes the shared carousel manager", () => {
  assert.ok(source.includes("handleAdminVendorCarouselAction"));
  assert.ok(source.includes('action === "vendor.carousel"'));
  assert.ok(source.includes("carousel_items = carouselByVendor"));
  assert.ok(source.includes("上傳到跑馬燈"));
  assert.ok(source.includes("DM 已同步到廠商專區與店家頁"));
});
