import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultIdentityProviders,
  resolveWorkspaceIdentity,
} from "../src/workspace/identity-provider-registry.js";

test("default registry contains only the admin provider", () => {
  const providers = createDefaultIdentityProviders();

  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, "admin");
  assert.equal(providers[0].priority, 100);
});

test("resolveWorkspaceIdentity returns admin identity when whitelist matches", async () => {
  const userId = "U_ADMIN";

  const db = {
    prepare() {
      return {
        bind(boundUserId) {
          assert.equal(boundUserId, userId);

          return {
            async first() {
              return {
                id: 1,
                line_user_id: userId,
                role: "admin",
                active: 1,
              };
            },
          };
        },
      };
    },
  };

  const result = await resolveWorkspaceIdentity({
    context: {
      db,
      userId,
    },
  });

  assert.deepEqual(result, {
    identity: {
      userId,
      role: "admin",
      authenticated: true,
      lineBound: true,
      admin: true,
      vendorId: null,
      employeeId: null,
      authSource: "admin_whitelist",
      locale: "zh-TW",
    },
    provider: "admin",
  });
});

test("resolveWorkspaceIdentity returns null result when admin does not match", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return null;
            },
          };
        },
      };
    },
  };

  const result = await resolveWorkspaceIdentity({
    context: {
      db,
      userId: "U_NOT_ADMIN",
    },
  });

  assert.deepEqual(result, {
    identity: null,
    provider: null,
  });
});

test("resolveWorkspaceIdentity supports custom injected providers", async () => {
  const customProvider = {
    name: "vendor",
    priority: 200,
    async resolve(context) {
      return context.vendorId
        ? {
            role: "vendor",
            vendorId: context.vendorId,
          }
        : null;
    },
  };

  const result = await resolveWorkspaceIdentity({
    providers: [customProvider],
    context: {
      vendorId: "vendor-1",
    },
  });

  assert.deepEqual(result, {
    identity: {
      role: "vendor",
      vendorId: "vendor-1",
    },
    provider: "vendor",
  });
});

test("createDefaultIdentityProviders returns a new array each time", () => {
  const first = createDefaultIdentityProviders();
  const second = createDefaultIdentityProviders();

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first[0], second[0]);
});
