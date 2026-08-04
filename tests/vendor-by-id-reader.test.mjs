import test from "node:test";
import assert from "node:assert/strict";

import { findVisibleVendorByIdReadOnly } from "../src/workspace/vendor-by-id-reader.js";

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
    await findVisibleVendorByIdReadOnly(null, "vendor-1"),
    null,
  );
});

test("missing vendorId returns null without querying", async () => {
  let prepareCalled = false;

  const db = {
    prepare() {
      prepareCalled = true;
      throw new Error("prepare should not be called");
    },
  };

  const result = await findVisibleVendorByIdReadOnly(db, "");

  assert.equal(result, null);
  assert.equal(prepareCalled, false);
});

test("query uses welfare_vendors and excludes hidden vendors", async () => {
  const { db, calls } = createMockDb();

  await findVisibleVendorByIdReadOnly(db, "vendor-1");

  assert.match(calls.sql, /\bFROM\s+welfare_vendors\b/i);
  assert.match(
    calls.sql,
    /COALESCE\s*\(\s*is_hidden\s*,\s*0\s*\)\s*=\s*0/i,
  );
  assert.match(calls.sql, /\bLIMIT\s+1\b/i);
});

test("bind receives normalized vendorId", async () => {
  const { db, calls } = createMockDb();

  await findVisibleVendorByIdReadOnly(db, " vendor-1 ");

  assert.deepEqual(calls.bindArgs, ["vendor-1"]);
});

test("first is called", async () => {
  const { db, calls } = createMockDb();

  await findVisibleVendorByIdReadOnly(db, "vendor-1");

  assert.equal(calls.firstCalled, true);
});

test("matched vendor row is returned", async () => {
  const row = {
    id: "vendor-1",
    name: "測試店家",
    status: "approved",
  };

  const { db } = createMockDb({ row });

  const result = await findVisibleVendorByIdReadOnly(
    db,
    "vendor-1",
  );

  assert.strictEqual(result, row);
});

test("not found returns null", async () => {
  const { db } = createMockDb({ row: null });

  assert.equal(
    await findVisibleVendorByIdReadOnly(db, "vendor-missing"),
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

    const result = await findVisibleVendorByIdReadOnly(
      db,
      "vendor-1",
    );

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.equal(
      warnings[0][0],
      "findVisibleVendorByIdReadOnly failed",
    );
    assert.strictEqual(warnings[0][1], error);
  } finally {
    console.warn = originalWarn;
  }
});
