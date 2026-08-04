import test from "node:test";
import assert from "node:assert/strict";

import { findVendorByLineUserIdReadOnly } from "../src/workspace/vendor-line-reader.js";

function createMockDb({ row = null, error = null } = {}) {
  const calls = {
    sql: null,
    bindArgs: null,
    firstCalled: false,
  };

  const db = {
    prepare(sql) {
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

test("missing db returns null", async () => {
  assert.equal(
    await findVendorByLineUserIdReadOnly(null, "U_VENDOR"),
    null,
  );
});

test("missing lineUserId returns null without querying", async () => {
  let prepareCalled = false;

  const db = {
    prepare() {
      prepareCalled = true;
      throw new Error("prepare should not be called");
    },
  };

  const result = await findVendorByLineUserIdReadOnly(db, null);

  assert.equal(result, null);
  assert.equal(prepareCalled, false);
});

test("query uses welfare_vendors and both LINE binding columns", async () => {
  const { db, calls } = createMockDb();

  await findVendorByLineUserIdReadOnly(db, "U_VENDOR");

  assert.match(calls.sql, /\bFROM\s+welfare_vendors\b/i);
  assert.match(calls.sql, /\bcontact_line_user_id\s*=\s*\?/i);
  assert.match(calls.sql, /\bsubmitted_by_line_user_id\s*=\s*\?/i);
});

test("bind receives lineUserId twice in order", async () => {
  const { db, calls } = createMockDb();

  await findVendorByLineUserIdReadOnly(db, "U_VENDOR");

  assert.deepEqual(calls.bindArgs, ["U_VENDOR", "U_VENDOR"]);
});

test("first is called", async () => {
  const { db, calls } = createMockDb();

  await findVendorByLineUserIdReadOnly(db, "U_VENDOR");

  assert.equal(calls.firstCalled, true);
});

test("matched vendor row is returned", async () => {
  const row = {
    id: "vendor-1",
    name: "測試店家",
    status: "approved",
    contact_line_user_id: "U_VENDOR",
    submitted_by_line_user_id: "",
    updated_at: "2026-08-04T09:00:00+08:00",
  };

  const { db } = createMockDb({ row });

  const result = await findVendorByLineUserIdReadOnly(
    db,
    "U_VENDOR",
  );

  assert.strictEqual(result, row);
});

test("not found returns null", async () => {
  const { db } = createMockDb({ row: null });

  assert.equal(
    await findVendorByLineUserIdReadOnly(db, "U_UNKNOWN"),
    null,
  );
});

test("D1 error safely returns null", async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    const error = new Error("D1 unavailable");
    const { db } = createMockDb({ error });

    const result = await findVendorByLineUserIdReadOnly(
      db,
      "U_VENDOR",
    );

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.equal(
      warnings[0][0],
      "findVendorByLineUserIdReadOnly failed",
    );
    assert.strictEqual(warnings[0][1], error);
  } finally {
    console.warn = originalWarn;
  }
});
