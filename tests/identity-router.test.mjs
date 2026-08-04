import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_SOURCES,
  IDENTITY_ROLES,
  createIdentity,
  resolveAdminIdentity,
} from "../src/workspace/identity-router.js";

const anonymousIdentity = {
  userId: null,
  role: "anonymous",
  authenticated: false,
  lineBound: false,
  admin: false,
  vendorId: null,
  employeeId: null,
  authSource: "anonymous",
  locale: "zh-TW",
};

test("createIdentity returns the complete anonymous identity by default", () => {
  assert.deepEqual(createIdentity(), anonymousIdentity);
});

test("createIdentity allows every identity field to be overridden", () => {
  assert.deepEqual(
    createIdentity({
      userId: "U123",
      role: "admin",
      authenticated: true,
      lineBound: true,
      admin: true,
      vendorId: "vendor-1",
      employeeId: "employee-1",
      authSource: "admin_whitelist",
      locale: "id-ID",
    }),
    {
      userId: "U123",
      role: "admin",
      authenticated: true,
      lineBound: true,
      admin: true,
      vendorId: "vendor-1",
      employeeId: "employee-1",
      authSource: "admin_whitelist",
      locale: "id-ID",
    },
  );
});

test("createIdentity preserves defaults for fields not overridden", () => {
  assert.deepEqual(createIdentity({ role: "member", userId: "U456" }), {
    ...anonymousIdentity,
    userId: "U456",
    role: "member",
  });
});

test("createIdentity does not mutate the overrides object", () => {
  const overrides = { role: "vendor", vendorId: "vendor-2" };
  const snapshot = { ...overrides };

  createIdentity(overrides);

  assert.deepEqual(overrides, snapshot);
});

test("IDENTITY_ROLES contains all supported roles", () => {
  assert.deepEqual(
    new Set(Object.values(IDENTITY_ROLES)),
    new Set(["admin", "vendor", "member", "anonymous"]),
  );
});

test("AUTH_SOURCES contains all supported authentication sources", () => {
  assert.deepEqual(
    new Set(Object.values(AUTH_SOURCES)),
    new Set([
      "admin_whitelist",
      "vendor_line_binding",
      "vendor_session",
      "member_binding",
      "anonymous",
    ]),
  );
});


function createAdminLookupDb(row = null, error = null) {
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

test("resolveAdminIdentity does not query D1 when userId is missing", async () => {
  const { db, calls } = createAdminLookupDb({
    line_user_id: "U_ADMIN",
  });

  const result = await resolveAdminIdentity({ db });

  assert.deepEqual(result, anonymousIdentity);
  assert.equal(calls.prepareCalled, false);
});

test("resolveAdminIdentity returns admin identity when whitelist matches", async () => {
  const userId = "U_ADMIN";
  const { db, calls } = createAdminLookupDb({
    id: 1,
    line_user_id: userId,
    role: "admin",
    active: 1,
  });

  const result = await resolveAdminIdentity({
    db,
    userId,
  });

  assert.deepEqual(result, {
    ...anonymousIdentity,
    userId,
    role: "admin",
    authenticated: true,
    lineBound: true,
    admin: true,
    authSource: "admin_whitelist",
  });

  assert.deepEqual(calls.bindArgs, [userId]);
  assert.equal(calls.firstCalled, true);
});

test("resolveAdminIdentity preserves base identity when whitelist misses", async () => {
  const baseIdentity = createIdentity({
    userId: "U_VENDOR",
    role: "vendor",
    authenticated: true,
    lineBound: true,
    vendorId: "vendor-1",
    authSource: "vendor_line_binding",
  });

  const { db } = createAdminLookupDb(null);

  const result = await resolveAdminIdentity({
    db,
    userId: "U_VENDOR",
    baseIdentity,
  });

  assert.deepEqual(result, baseIdentity);
});

test("resolveAdminIdentity does not mutate baseIdentity", async () => {
  const baseIdentity = createIdentity({
    role: "member",
    employeeId: "employee-1",
  });
  const snapshot = { ...baseIdentity };

  const { db } = createAdminLookupDb({
    id: 1,
    line_user_id: "U_ADMIN",
    active: 1,
  });

  await resolveAdminIdentity({
    db,
    userId: "U_ADMIN",
    baseIdentity,
  });

  assert.deepEqual(baseIdentity, snapshot);
});

test("resolveAdminIdentity safely preserves identity when D1 fails", async () => {
  const baseIdentity = createIdentity({
    userId: "U_MEMBER",
    role: "member",
    employeeId: "employee-2",
    authenticated: true,
    lineBound: true,
    authSource: "member_binding",
  });

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const { db } = createAdminLookupDb(
      null,
      new Error("D1 unavailable"),
    );

    const result = await resolveAdminIdentity({
      db,
      userId: "U_MEMBER",
      baseIdentity,
    });

    assert.deepEqual(result, baseIdentity);
    assert.equal(result.admin, false);
  } finally {
    console.warn = originalWarn;
  }
});
