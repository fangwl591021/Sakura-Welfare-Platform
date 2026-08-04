import test from "node:test";
import assert from "node:assert/strict";

import {
  loadVendorReviewSummaryReadOnly,
  loadChatMonitorSummaryReadOnly,
  loadRiskSummaryReadOnly,
} from "../src/workspace/workspace-live-summary-reader.js";

function createMockDb(rows = [], error = null) {
  const calls = [];
  let index = 0;

  const db = {
    prepare(sql) {
      const call = {
        sql,
        firstCalled: false,
      };

      calls.push(call);

      return {
        async first() {
          call.firstCalled = true;

          if (error) {
            throw error;
          }

          const row = rows[index] ?? null;
          index += 1;
          return row;
        },
      };
    },
  };

  return {
    db,
    calls,
  };
}

test("vendor summary returns pending count and first vendor", async () => {
  const vendor = {
    id: "vendor-1",
    name: "測試店家",
    status: "pending",
  };

  const { db, calls } = createMockDb([
    { pending_count: 12 },
    vendor,
  ]);

  const result =
    await loadVendorReviewSummaryReadOnly(db);

  assert.deepEqual(result, {
    pendingCount: 12,
    firstVendor: vendor,
  });

  assert.match(calls[0].sql, /COUNT\(\*\)/i);
  assert.match(calls[0].sql, /status\s*=\s*'pending'/i);
  assert.match(calls[1].sql, /LIMIT\s+1/i);
});

test("chat summary returns unresolved and risk metrics", async () => {
  const { db, calls } = createMockDb([
    { unresolved_count: 8 },
    { high_risk_count: 3 },
    {
      id: 100,
      message_text: "會員回報優惠不能使用",
      ai_summary: "疑似優惠使用客訴",
      priority: "medium",
      process_status: "pending",
    },
  ]);

  const result =
    await loadChatMonitorSummaryReadOnly(db);

  assert.equal(result.unresolvedCount, 8);
  assert.equal(result.highRiskCount, 3);
  assert.equal(
    result.latestMessage.summary,
    "疑似優惠使用客訴",
  );

  assert.match(calls[0].sql, /process_status/i);
  assert.match(calls[1].sql, /ai_severity/i);
  assert.match(calls[2].sql, /ORDER BY created_at DESC/i);
});

test("chat summary falls back to message text", async () => {
  const { db } = createMockDb([
    { unresolved_count: 1 },
    { high_risk_count: 0 },
    {
      id: 101,
      message_text: "原始訊息內容",
      ai_summary: "",
    },
  ]);

  const result =
    await loadChatMonitorSummaryReadOnly(db);

  assert.equal(
    result.latestMessage.summary,
    "原始訊息內容",
  );
});

test("risk summary returns latest high-risk event", async () => {
  const { db, calls } = createMockDb([
    { high_risk_count: 2 },
    {
      id: 200,
      message_text: "會員回報個資疑慮",
      ai_summary: "疑似個資外洩事件",
      priority: "high",
      ai_severity: "critical",
      sentiment_type: "risk",
    },
  ]);

  const result = await loadRiskSummaryReadOnly(db);

  assert.equal(result.highRiskCount, 2);
  assert.equal(
    result.latestRisk.summary,
    "疑似個資外洩事件",
  );
  assert.equal(
    result.latestRisk.priority,
    "critical",
  );

  assert.match(calls[1].sql, /sentiment_type\s*=\s*'risk'/i);
});

test("all summary SQL remains SELECT-only", async () => {
  const { db, calls } = createMockDb([
    { pending_count: 0 },
    null,
    { unresolved_count: 0 },
    { high_risk_count: 0 },
    null,
    { high_risk_count: 0 },
    null,
  ]);

  await loadVendorReviewSummaryReadOnly(db);
  await loadChatMonitorSummaryReadOnly(db);
  await loadRiskSummaryReadOnly(db);

  for (const call of calls) {
    assert.match(call.sql, /^\s*SELECT\b/i);
    assert.doesNotMatch(
      call.sql,
      /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i,
    );
  }
});

test("missing db returns safe empty summaries", async () => {
  assert.deepEqual(
    await loadVendorReviewSummaryReadOnly(null),
    {
      pendingCount: 0,
      firstVendor: null,
    },
  );

  assert.deepEqual(
    await loadChatMonitorSummaryReadOnly(null),
    {
      unresolvedCount: 0,
      highRiskCount: 0,
      latestMessage: null,
    },
  );

  assert.deepEqual(
    await loadRiskSummaryReadOnly(null),
    {
      highRiskCount: 0,
      latestRisk: null,
    },
  );
});

test("D1 errors return safe empty summaries", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const error = new Error("D1 unavailable");

    const vendorResult =
      await loadVendorReviewSummaryReadOnly(
        createMockDb([], error).db,
      );

    const chatResult =
      await loadChatMonitorSummaryReadOnly(
        createMockDb([], error).db,
      );

    const riskResult =
      await loadRiskSummaryReadOnly(
        createMockDb([], error).db,
      );

    assert.equal(vendorResult.pendingCount, 0);
    assert.equal(chatResult.unresolvedCount, 0);
    assert.equal(riskResult.highRiskCount, 0);
  } finally {
    console.warn = originalWarn;
  }
});
