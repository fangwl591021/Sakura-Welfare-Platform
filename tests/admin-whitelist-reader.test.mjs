import test from "node:test";
import assert from "node:assert/strict";

import { findAdminUidWhitelistRowReadOnly } from "../src/workspace/admin-whitelist-reader.js";

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

test("缺少 db 時回傳 null", async () => {
  const result = await findAdminUidWhitelistRowReadOnly(
    null,
    "U1234567890",
  );

  assert.equal(result, null);
});

test("缺少 lineUserId 時回傳 null", async () => {
  let prepareCalled = false;

  const db = {
    prepare() {
      prepareCalled = true;
      throw new Error("prepare should not be called");
    },
  };

  const result = await findAdminUidWhitelistRowReadOnly(db, null);

  assert.equal(result, null);
  assert.equal(prepareCalled, false);
});

test("prepare 收到的 SQL 包含 admin_uid_whitelist", async () => {
  const { db, calls } = createMockDb();

  await findAdminUidWhitelistRowReadOnly(db, "U1234567890");

  assert.match(calls.sql, /\bFROM\s+admin_uid_whitelist\b/i);
});

test("SQL 包含 active = 1", async () => {
  const { db, calls } = createMockDb();

  await findAdminUidWhitelistRowReadOnly(db, "U1234567890");

  assert.match(calls.sql, /\bactive\s*=\s*1\b/i);
});

test("bind 只收到 lineUserId", async () => {
  const lineUserId = "U1234567890";
  const { db, calls } = createMockDb();

  await findAdminUidWhitelistRowReadOnly(db, lineUserId);

  assert.deepEqual(calls.bindArgs, [lineUserId]);
});

test("first 有被呼叫", async () => {
  const { db, calls } = createMockDb();

  await findAdminUidWhitelistRowReadOnly(db, "U1234567890");

  assert.equal(calls.firstCalled, true);
});

test("命中時回傳 row object", async () => {
  const row = {
    id: 1,
    line_user_id: "U1234567890",
    display_name: "Tony",
    role: "admin",
    allowed_modules: "all",
    active: 1,
    note: "",
  };
  const { db } = createMockDb({ row });

  const result = await findAdminUidWhitelistRowReadOnly(
    db,
    row.line_user_id,
  );

  assert.strictEqual(result, row);
});

test("未命中時回傳 null", async () => {
  const { db } = createMockDb();

  const result = await findAdminUidWhitelistRowReadOnly(
    db,
    "U_NOT_FOUND",
  );

  assert.equal(result, null);
});

test("D1 丟出例外時安全回傳 null", async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    const error = new Error("D1 query failed");
    const { db } = createMockDb({ error });

    const result = await findAdminUidWhitelistRowReadOnly(
      db,
      "U1234567890",
    );

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.equal(
      warnings[0][0],
      "findAdminUidWhitelistRowReadOnly failed",
    );
    assert.strictEqual(warnings[0][1], error);
  } finally {
    console.warn = originalWarn;
  }
});
