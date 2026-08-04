import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_PROVIDER_NAMES,
  IDENTITY_PROVIDER_PRIORITIES,
} from "../src/workspace/identity-provider.js";

import { createAdminIdentityProvider } from "../src/workspace/admin-identity-provider.js";

function createAdminDb(row = null, error = null) {
  const calls = {
    prepareCalled: false,
    sql: null,
    bindArgs: null,
    firstCalled: false,
  };

  const db = {
    prepare(sql) {
      calls.prepareCalled = true;
      calls.sql = sql;

      return {
        bind(...args) {
          calls.bindArgs = args;

          return {
            async first() {
              calls.firstCalled = true;

              if (error) {
                throw error;
              }

              return row;
            },
          };
        },
      };
    },
  };

  return { db, calls };
}

test("admin provider has the expected name and priority", () => {
  const provider = createAdminIdentityProvider();

  assert.equal(provider.name, IDENTITY_PROVIDER_NAMES.ADMIN);
  assert.equal(
    provider.priority,
    IDENTITY_PROVIDER_PRIORITIES.ADMIN,
  );
});

test("admin provider returns admin identity when whitelist matches", async () => {
  const userId = "U_ADMIN";

  const { db, calls } = createAdminDb({
    id: 1,
    line_user_id: userId,
    role: "admin",
    active: 1,
  });

  const provider = createAdminIdentityProvider();

  const identity = await provider.resolve({
    db,
    userId,
  });

  assert.deepEqual(identity, {
    userId,
    role: "admin",
    authenticated: true,
    lineBound: true,
    admin: true,
    vendorId: null,
    employeeId: null,
    authSource: "admin_whitelist",
    locale: "zh-TW",
  });

  assert.deepEqual(calls.bindArgs, [userId]);
  assert.equal(calls.firstCalled, true);
});

test("admin provider returns null when whitelist does not match", async () => {
  const { db } = createAdminDb(null);
  const provider = createAdminIdentityProvider();

  const identity = await provider.resolve({
    db,
    userId: "U_NOT_ADMIN",
  });

  assert.equal(identity, null);
});

test("admin provider does not query D1 when userId is missing", async () => {
  const { db, calls } = createAdminDb({
    line_user_id: "U_ADMIN",
  });

  const provider = createAdminIdentityProvider();

  const identity = await provider.resolve({ db });

  assert.equal(identity, null);
  assert.equal(calls.prepareCalled, false);
});

test("admin provider returns null safely when D1 fails", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const { db } = createAdminDb(
      null,
      new Error("D1 unavailable"),
    );

    const provider = createAdminIdentityProvider();

    const identity = await provider.resolve({
      db,
      userId: "U_ADMIN",
    });

    assert.equal(identity, null);
  } finally {
    console.warn = originalWarn;
  }
});

test("admin provider does not mutate baseIdentity", async () => {
  const baseIdentity = {
    userId: "U_VENDOR",
    role: "vendor",
    authenticated: true,
    lineBound: true,
    admin: false,
    vendorId: "vendor-1",
    employeeId: null,
    authSource: "vendor_line_binding",
    locale: "zh-TW",
  };

  const snapshot = { ...baseIdentity };
  const { db } = createAdminDb(null);
  const provider = createAdminIdentityProvider();

  await provider.resolve({
    db,
    userId: "U_VENDOR",
    baseIdentity,
  });

  assert.deepEqual(baseIdentity, snapshot);
});
