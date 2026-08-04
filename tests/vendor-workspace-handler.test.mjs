import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_INTENTS,
  resolveWorkspaceIntent,
} from "../src/workspace/intent-router.js";

import { handleVendorPortalIntent } from "../src/workspace/vendor-workspace-handler.js";

test("traditional vendor portal keyword is recognized", () => {
  assert.equal(
    resolveWorkspaceIntent("廠商專區"),
    WORKSPACE_INTENTS.VENDOR_PORTAL,
  );
});

test("simplified vendor portal keyword is recognized", () => {
  assert.equal(
    resolveWorkspaceIntent("厂商专区"),
    WORKSPACE_INTENTS.VENDOR_PORTAL,
  );
});

test("bound vendor receives vendor workspace Flex", async () => {
  const vendor = {
    id: "vendor-1",
    name: "測試店家",
  };

  const expectedFlex = {
    type: "flex",
    altText: "廠商工作台",
    contents: {
      type: "bubble",
    },
  };

  const result = await handleVendorPortalIntent({
    lineUserId: "U_VENDOR",
    resolveIdentity: async ({ userId }) => ({
      identity: {
        userId,
        role: "vendor",
        authenticated: true,
        lineBound: true,
        vendorId: "vendor-1",
      },
      provider: "vendor",
    }),
    loadVendor: async (vendorId) => {
      assert.equal(vendorId, "vendor-1");
      return vendor;
    },
    buildVendorFlex: async (loadedVendor) => {
      assert.strictEqual(loadedVendor, vendor);
      return expectedFlex;
    },
    loginUrl: "https://example.com/vendor-login",
  });

  assert.deepEqual(result, {
    handled: true,
    authorized: true,
    authenticated: true,
    vendorId: "vendor-1",
    message: expectedFlex,
  });
});

test("unbound vendor receives login Flex", async () => {
  const loginUrl = "https://example.com/vendor-login";

  const result = await handleVendorPortalIntent({
    lineUserId: "U_UNKNOWN",
    resolveIdentity: async () => ({
      identity: null,
      provider: null,
    }),
    loginUrl,
  });

  assert.equal(result.handled, true);
  assert.equal(result.authorized, false);
  assert.equal(result.authenticated, false);
  assert.equal(result.vendorId, null);
  assert.equal(result.message.type, "flex");
  assert.equal(
    result.message.contents.footer.contents[0].action.uri,
    loginUrl,
  );
});

test("missing vendor row falls back to login", async () => {
  const result = await handleVendorPortalIntent({
    lineUserId: "U_VENDOR",
    resolveIdentity: async () => ({
      identity: {
        role: "vendor",
        authenticated: true,
        vendorId: "vendor-missing",
      },
      provider: "vendor",
    }),
    loadVendor: async () => null,
    loginUrl: "https://example.com/vendor-login",
  });

  assert.equal(result.authorized, false);
  assert.equal(result.message.type, "flex");
});

test("missing login URL uses plain-text fallback", async () => {
  const result = await handleVendorPortalIntent({
    lineUserId: "U_UNKNOWN",
    resolveIdentity: async () => null,
  });

  assert.deepEqual(result, {
    handled: true,
    authorized: false,
    authenticated: false,
    vendorId: null,
    text: "請先登入廠商專區。",
  });
});

test("non-vendor identity cannot enter vendor workspace", async () => {
  let loadVendorCalled = false;

  const result = await handleVendorPortalIntent({
    lineUserId: "U_ADMIN",
    resolveIdentity: async () => ({
      identity: {
        role: "admin",
        authenticated: true,
        admin: true,
      },
      provider: "admin",
    }),
    loadVendor: async () => {
      loadVendorCalled = true;
      return {};
    },
    loginUrl: "https://example.com/vendor-login",
  });

  assert.equal(result.authorized, false);
  assert.equal(loadVendorCalled, false);
});
