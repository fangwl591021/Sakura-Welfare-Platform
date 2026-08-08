import test from "node:test";
import assert from "node:assert/strict";

import {
  featuredPartnerStoreSqlFilter,
  isFeaturedPartnerStoreQuery,
  normalizeFeaturedVendorFlag,
  resolveFeaturedPartnerStoreLocale,
} from "../src/featured-partner-stores.js";

test("featured-store routes resolve all supported locales and aliases", () => {
  assert.equal(resolveFeaturedPartnerStoreLocale("/featured-partner-stores"), "zh");
  assert.equal(resolveFeaturedPartnerStoreLocale("/featured-partner-stores-id"), "id");
  assert.equal(resolveFeaturedPartnerStoreLocale("/featured-partner-stores-th"), "th");
  assert.equal(resolveFeaturedPartnerStoreLocale("/current-offers"), "zh");
  assert.equal(resolveFeaturedPartnerStoreLocale("/partner-stores"), null);
});

test("featured query is opt-in", () => {
  assert.equal(isFeaturedPartnerStoreQuery(new URL("https://example.test/api?featured=1")), true);
  assert.equal(isFeaturedPartnerStoreQuery(new URL("https://example.test/api?featured=true")), true);
  assert.equal(isFeaturedPartnerStoreQuery(new URL("https://example.test/api")), false);
  assert.equal(isFeaturedPartnerStoreQuery(new URL("https://example.test/api?featured=0")), false);
});

test("admin checkbox values normalize to a D1 integer", () => {
  for (const value of [true, 1, "1", "true", "yes", "on"]) {
    assert.equal(normalizeFeaturedVendorFlag(value), 1);
  }
  for (const value of [false, 0, "0", "false", "", null]) {
    assert.equal(normalizeFeaturedVendorFlag(value), 0);
  }
});

test("featured SQL filter is explicit and alias-safe", () => {
  assert.equal(featuredPartnerStoreSqlFilter(false), "");
  assert.equal(featuredPartnerStoreSqlFilter(true), "AND COALESCE(v.is_current_featured, 0) = 1");
  assert.throws(() => featuredPartnerStoreSqlFilter(true, "v; DROP TABLE x"));
});
