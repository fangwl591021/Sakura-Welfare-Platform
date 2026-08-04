import test from "node:test";
import assert from "node:assert/strict";

import { createVendorTokenIdentityProvider } from "../src/workspace/vendor-token-identity-provider.js";

test("vendor token provider requires verifyToken", () => {
  assert.throws(
    () => createVendorTokenIdentityProvider(),
    /verifyToken function is required/i,
  );
});

test("vendor token provider has vendor name and priority", () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => null,
  });

  assert.equal(provider.name, "vendor");
  assert.equal(provider.priority, 200);
});

test("vendor token provider returns null when token is missing", async () => {
  let verifyCalled = false;

  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => {
      verifyCalled = true;
      return null;
    },
  });

  const result = await provider.resolve({});

  assert.equal(result, null);
  assert.equal(verifyCalled, false);
});

test("vendor token provider accepts portalToken", async () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async (env, token) => {
      assert.equal(env.name, "test");
      assert.equal(token, "token-1");

      return {
        vendor_id: "vendor-1",
        username: "shop",
      };
    },
  });

  const result = await provider.resolve({
    env: { name: "test" },
    portalToken: "token-1",
  });

  assert.deepEqual(result, {
    userId: null,
    role: "vendor",
    authenticated: true,
    lineBound: false,
    admin: false,
    vendorId: "vendor-1",
    employeeId: null,
    authSource: "vendor_session",
    locale: "zh-TW",
  });
});

test("vendor token provider accepts portal_token alias", async () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async (env, token) => {
      assert.equal(token, "token-2");

      return {
        vendor_id: 2,
        username: "store",
      };
    },
  });

  const result = await provider.resolve({
    portal_token: "token-2",
  });

  assert.equal(result.vendorId, "2");
});

test("vendor token provider accepts vendorPortalToken alias", async () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => ({
      vendor_id: "vendor-3",
      username: "branch",
    }),
  });

  const result = await provider.resolve({
    vendorPortalToken: "token-3",
  });

  assert.equal(result.vendorId, "vendor-3");
});

test("vendor token provider rejects invalid payload", async () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => ({
      vendor_id: "vendor-1",
    }),
  });

  const result = await provider.resolve({
    portalToken: "invalid-payload",
  });

  assert.equal(result, null);
});

test("vendor token provider rejects invalid token", async () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => null,
  });

  const result = await provider.resolve({
    portalToken: "invalid-token",
  });

  assert.equal(result, null);
});

test("vendor token provider marks lineBound when userId exists", async () => {
  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => ({
      vendor_id: "vendor-1",
      username: "shop",
    }),
  });

  const result = await provider.resolve({
    userId: "U_VENDOR",
    portalToken: "token-1",
  });

  assert.equal(result.userId, "U_VENDOR");
  assert.equal(result.lineBound, true);
});

test("vendor token provider does not mutate baseIdentity", async () => {
  const baseIdentity = {
    userId: "U_EXISTING",
    role: "member",
    authenticated: true,
    lineBound: true,
    admin: false,
    vendorId: null,
    employeeId: "employee-1",
    authSource: "member_binding",
    locale: "zh-TW",
  };

  const snapshot = { ...baseIdentity };

  const provider = createVendorTokenIdentityProvider({
    verifyToken: async () => ({
      vendor_id: "vendor-1",
      username: "shop",
    }),
  });

  await provider.resolve({
    baseIdentity,
    portalToken: "token-1",
  });

  assert.deepEqual(baseIdentity, snapshot);
});
