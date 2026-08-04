import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultIdentityProviders,
  resolveWorkspaceIdentity,
} from "../src/workspace/identity-provider-registry.js";

function createDb({ adminRow = null, vendorRow = null } = {}) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("admin_uid_whitelist")) {
                return adminRow;
              }

              if (sql.includes("welfare_vendors")) {
                return vendorRow;
              }

              return null;
            },
          };
        },
      };
    },
  };
}

test("default registry contains admin and vendor LINE providers", () => {
  const providers = createDefaultIdentityProviders();

  assert.equal(providers.length, 2);
  assert.deepEqual(
    providers.map((provider) => provider.name),
    ["admin", "vendor"],
  );
  assert.deepEqual(
    providers.map((provider) => provider.priority),
    [100, 200],
  );
});

test("vendor token provider is added only when verifier is supplied", () => {
  const withoutVerifier = createDefaultIdentityProviders();

  const withVerifier = createDefaultIdentityProviders({
    verifyVendorToken: async () => null,
  });

  assert.equal(withoutVerifier.length, 2);
  assert.equal(withVerifier.length, 3);
  assert.deepEqual(
    withVerifier.map((provider) => provider.name),
    ["admin", "vendor", "vendor"],
  );
});

test("admin identity has priority over vendor LINE identity", async () => {
  const userId = "U_ADMIN_VENDOR";

  const result = await resolveWorkspaceIdentity({
    context: {
      db: createDb({
        adminRow: {
          id: 1,
          line_user_id: userId,
          active: 1,
        },
        vendorRow: {
          id: "vendor-1",
          contact_line_user_id: userId,
        },
      }),
      userId,
    },
  });

  assert.equal(result.provider, "admin");
  assert.equal(result.identity.role, "admin");
  assert.equal(result.identity.admin, true);
});

test("vendor LINE identity is returned when admin does not match", async () => {
  const userId = "U_VENDOR";

  const result = await resolveWorkspaceIdentity({
    context: {
      db: createDb({
        vendorRow: {
          id: "vendor-1",
          name: "測試店家",
          status: "approved",
          contact_line_user_id: userId,
        },
      }),
      userId,
    },
  });

  assert.deepEqual(result, {
    identity: {
      userId,
      role: "vendor",
      authenticated: true,
      lineBound: true,
      admin: false,
      vendorId: "vendor-1",
      employeeId: null,
      authSource: "vendor_line_binding",
      locale: "zh-TW",
    },
    provider: "vendor",
  });
});

test("vendor token identity is returned when LINE binding does not match", async () => {
  const result = await resolveWorkspaceIdentity({
    verifyVendorToken: async (env, token) => {
      assert.equal(env.name, "test");
      assert.equal(token, "valid-token");

      return {
        vendor_id: "vendor-token-1",
        username: "store",
      };
    },
    context: {
      db: createDb(),
      env: { name: "test" },
      portalToken: "valid-token",
    },
  });

  assert.deepEqual(result, {
    identity: {
      userId: null,
      role: "vendor",
      authenticated: true,
      lineBound: false,
      admin: false,
      vendorId: "vendor-token-1",
      employeeId: null,
      authSource: "vendor_session",
      locale: "zh-TW",
    },
    provider: "vendor",
  });
});

test("vendor token verifier is not called when no token exists", async () => {
  let verifierCalled = false;

  const result = await resolveWorkspaceIdentity({
    verifyVendorToken: async () => {
      verifierCalled = true;
      return null;
    },
    context: {
      db: createDb(),
    },
  });

  assert.deepEqual(result, {
    identity: null,
    provider: null,
  });
  assert.equal(verifierCalled, false);
});

test("custom provider injection still overrides default registry", async () => {
  const customProvider = {
    name: "member",
    priority: 50,
    async resolve() {
      return {
        role: "member",
        employeeId: "employee-1",
      };
    },
  };

  const result = await resolveWorkspaceIdentity({
    providers: [customProvider],
    context: {},
  });

  assert.deepEqual(result, {
    identity: {
      role: "member",
      employeeId: "employee-1",
    },
    provider: "member",
  });
});

test("createDefaultIdentityProviders returns fresh instances", () => {
  const first = createDefaultIdentityProviders();
  const second = createDefaultIdentityProviders();

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first[0], second[0]);
  assert.notStrictEqual(first[1], second[1]);
});
