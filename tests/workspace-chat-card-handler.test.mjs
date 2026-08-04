import test from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_INTENTS } from "../src/workspace/intent-router.js";
import { handleWorkspaceChatCardIntent } from "../src/workspace/workspace-chat-card-handler.js";

const findAdmin = async () => ({
  role: "admin",
  admin: true,
});

const buildUrl = (path) => `https://example.com${path}`;

function footerActions(result) {
  return result.message.contents.footer.contents.map(
    (item) => item.action,
  );
}

test("activity card offers quick and advanced creation", async () => {
  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_ADMIN",
    findAdmin,
    intent: WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER,
    buildUrl,
  });

  const actions = footerActions(result);

  assert.equal(result.authorized, true);
  assert.equal(
    actions[0].data,
    "action=workspace.activity.quick.start",
  );
  assert.equal(
    actions[1].uri,
    "https://example.com/activity-checkin-admin",
  );
});

test("push card offers immediate scheduled and draft actions", async () => {
  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_ADMIN",
    findAdmin,
    intent: WORKSPACE_INTENTS.PUSH_PLACEHOLDER,
    buildUrl,
  });

  const actions = footerActions(result);

  assert.equal(
    actions[0].data,
    "action=workspace.push.immediate.start",
  );
  assert.equal(
    actions[1].data,
    "action=workspace.push.schedule.start",
  );
  assert.equal(
    actions[2].data,
    "action=workspace.push.drafts.list",
  );
});

test("vendor review card shows pending count and first vendor", async () => {
  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_ADMIN",
    findAdmin,
    intent: WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER,
    buildUrl,
    loadVendorReviewSummary: async () => ({
      pendingCount: 12,
      firstVendor: {
        id: "vendor-1",
        name: "測試店家",
        status: "pending",
      },
    }),
  });

  const body = JSON.stringify(result.message.contents.body);
  const actions = footerActions(result);

  assert.match(body, /12/);
  assert.match(body, /測試店家/);
  assert.match(actions[0].data, /vendor_id=vendor-1/);
});

test("chat monitor card shows unresolved and high-risk counts", async () => {
  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_ADMIN",
    findAdmin,
    intent: WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER,
    buildUrl,
    loadChatMonitorSummary: async () => ({
      unresolvedCount: 8,
      highRiskCount: 3,
      latestMessage: {
        summary: "疑似食安客訴",
      },
    }),
  });

  const body = JSON.stringify(result.message.contents.body);

  assert.match(body, /8/);
  assert.match(body, /3/);
  assert.match(body, /疑似食安客訴/);
});

test("risk card shows latest high-risk event", async () => {
  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_ADMIN",
    findAdmin,
    intent: WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER,
    buildUrl,
    loadRiskSummary: async () => ({
      highRiskCount: 2,
      latestRisk: {
        summary: "會員回報個資疑慮",
        priority: "high",
      },
    }),
  });

  const body = JSON.stringify(result.message.contents.body);
  const actions = footerActions(result);

  assert.match(body, /2/);
  assert.match(body, /會員回報個資疑慮/);
  assert.equal(
    actions[0].data,
    "action=workspace.risk.resolve",
  );
});

test("non-admin is rejected before loaders run", async () => {
  let loaderCalled = false;

  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_MEMBER",
    findAdmin: async () => null,
    intent: WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER,
    buildUrl,
    loadVendorReviewSummary: async () => {
      loaderCalled = true;
      return {};
    },
  });

  assert.equal(result.authorized, false);
  assert.equal(loaderCalled, false);
});

test("unknown intent is not handled", async () => {
  const result = await handleWorkspaceChatCardIntent({
    lineUserId: "U_ADMIN",
    findAdmin,
    intent: "unknown",
    buildUrl,
  });

  assert.equal(result.handled, false);
});
