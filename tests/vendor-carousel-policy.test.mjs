import test from "node:test";
import assert from "node:assert/strict";
import { MAX_VENDOR_CAROUSEL_ITEMS, normalizeVendorCarouselOrder, validateVendorCarouselImage } from "../src/vendor-carousel-policy.js";

test("carousel is limited to six unique items", () => {
  assert.equal(MAX_VENDOR_CAROUSEL_ITEMS, 6);
  assert.deepEqual(normalizeVendorCarouselOrder(["a", "b"]), ["a", "b"]);
  assert.throws(() => normalizeVendorCarouselOrder(["a", "a"]));
  assert.throws(() => normalizeVendorCarouselOrder(["1", "2", "3", "4", "5", "6", "7"]));
});

test("carousel accepts supported images and rejects invalid input", () => {
  const valid = validateVendorCarouselImage({ name: "dm.jpg", mimeType: "image/jpeg", size: 4, base64: "YWJjZA==" });
  assert.equal(valid.mimeType, "image/jpeg");
  assert.throws(() => validateVendorCarouselImage({ name: "dm.pdf", mimeType: "application/pdf", size: 4, base64: "YWJjZA==" }));
});
