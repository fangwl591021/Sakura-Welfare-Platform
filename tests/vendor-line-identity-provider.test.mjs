import test from "node:test";
import assert from "node:assert/strict";

import { createVendorLineIdentityProvider } from "../src/workspace/vendor-line-identity-provider.js";

function createVendorDb(row = null, error = null) {
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

test("vendor LINE provider has vendor name and priority", () => {
  const provider = createVendorLineIdentityProvider();

  assert.equal(provider.name, "vendor");
  assert.equal(provider.priority, 200);
});

test("vendor LINE provider returns null when userId is missing", async () => {
  const { db, calls } = createVendorDb({
    id: "vendor-1",
  });

  const provider = createVendorLineIdentityProvider();

  const result = await provider.resolve({ db });

  assert.equal(result, null);
  assert.equal(calls.prepareCalled, false);
});

test("vendor LINE provider returns vendor identity when binding matches", async () => {
  const userId = "U_VENDOR";
  const { db, calls } = createVendorDb({
    id: "vendor-1",
    name: "測試店家",
    status: "approved",
    contact_line_user_id: userId,
    submitted_by_line_user_id: "",
  });

  const provider = createVendorLineIdentityProvider();

  const result = await provider.resolve({
    db,
    userId,
  });

  assert.deepEqual(result, {
    userId,
    role: "vendor",
    authenticated: true,
    lineBound: true,
    admin: false,
    vendorId: "vendor-1",
    employeeId: null,
    authSource: "vendor_line_binding",
    locale: "zh-TW",
  });

  assert.deepEqual(calls.bindArgs, [userId, userId]);
  assert.equal(calls.firstCalled, true);
});

test("vendor LINE provider returns null when binding is not found", async () => {
  const { db } = createVendorDb(null);
  const provider = createVendorLineIdentityProvider();

  const result = await provider.resolve({
    db,
    userId: "U_UNKNOWN",
  });

  assert.equal(result, null);
});

test("vendor LINE provider returns null safely when D1 fails", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const { db } = createVendorDb(
      null,
      new Error("D1 unavailable"),
    );

    const provider = createVendorLineIdentityProvider();

    const result = await provider.resolve({
      db,
      userId: "U_VENDOR",
    });

    assert.equal(result, null);
  } finally {
    console.warn = originalWarn;
  }
});

test("vendor LINE provider does not mutate baseIdentity", async () => {
  const baseIdentity = {
    userId: "U_MEMBER",
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

  const { db } = createVendorDb({
    id: "vendor-1",
  });

  const provider = createVendorLineIdentityProvider();

  await provider.resolve({
    db,
    userId: "U_VENDOR",
    baseIdentity,
  });

  assert.deepEqual(baseIdentity, snapshot);
});

test("vendor LINE provider converts numeric vendor id to string", async () => {
  const { db } = createVendorDb({
    id: 123,
  });

  const provider = createVendorLineIdentityProvider();

  const result = await provider.resolve({
    db,
    userId: "U_VENDOR",
  });

  assert.equal(result.vendorId, "123");
});
