import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveWorkspaceIntent,
  WORKSPACE_INTENTS,
  WORKSPACE_PLACEHOLDER_MESSAGES,
  WORKSPACE_POSTBACK_ACTIONS,
} from "../src/workspace/intent-router.js";
import {
  handleDashboardSummaryIntent,
  handleWorkspacePlaceholderIntent,
} from "../src/workspace/dashboard-handler.js";
import { buildWorkspaceDashboardFlex } from "../src/workspace/dashboard-flex.js";

const ADMIN = "U_ADMIN";
const OTHER = "U_OTHER";
const findAdmin = async (lineUserId) => (
  lineUserId === ADMIN ? { line_user_id: ADMIN } : null
);
const summary = {
  vendor_pending: 2,
  offer_approved: 7,
  today_redemption_total: 3,
  today_payable_total: 1280,
};

test("exact traditional dashboard keyword is recognized", () => {
  assert.equal(resolveWorkspaceIntent("儀表板"), WORKSPACE_INTENTS.DASHBOARD_SUMMARY);
});

test("exact simplified dashboard keyword is recognized", () => {
  assert.equal(resolveWorkspaceIntent("仪表板"), WORKSPACE_INTENTS.DASHBOARD_SUMMARY);
});

test("unrelated keywords do not enter the dashboard flow", () => {
  assert.equal(resolveWorkspaceIntent("查看儀表板"), null);
  assert.equal(resolveWorkspaceIntent("儀表板聊天室監控"), null);
  assert.equal(resolveWorkspaceIntent("附近店家"), null);
});

test("non-admin is rejected before dashboard statistics are queried", async () => {
  let queryCount = 0;
  const result = await handleDashboardSummaryIntent({
    lineUserId: OTHER,
    findAdmin,
    loadSummary: async () => {
      queryCount += 1;
      return summary;
    },
  });

  assert.equal(result.authorized, false);
  assert.equal(queryCount, 0);
  assert.match(result.text, /僅限已授權管理員/);
  assert.equal(result.message, undefined);
});

for (const keyword of ["儀表板", "仪表板"]) {
  test(`admin keyword ${keyword} returns a Flex Message`, async () => {
    assert.equal(resolveWorkspaceIntent(keyword), WORKSPACE_INTENTS.DASHBOARD_SUMMARY);
    const result = await handleDashboardSummaryIntent({
      lineUserId: ADMIN,
      findAdmin,
      loadSummary: async () => summary,
      now: new Date("2026-08-03T00:30:00.000Z"),
    });

    assert.equal(result.authorized, true);
    assert.equal(result.message.type, "flex");
    assert.equal(result.message.altText, "櫻花福委會 AI 工作台");
  });
}

test("Flex contains all four live metrics, Taiwan update time, and safe todo text", () => {
  const message = buildWorkspaceDashboardFlex(
    summary,
    new Date("2026-08-03T00:30:00.000Z")
  );
  const serialized = JSON.stringify(message);

  assert.match(serialized, /待審廠商/);
  assert.match(serialized, /已上架優惠/);
  assert.match(serialized, /今日核銷筆數/);
  assert.match(serialized, /今日核銷金額/);
  assert.match(serialized, /2/);
  assert.match(serialized, /7/);
  assert.match(serialized, /3/);
  assert.match(serialized, /1,280/);
  assert.match(serialized, /2026\/08\/03 08:30/);
  assert.match(serialized, /有 2 家廠商等待審核/);
  assert.match(serialized, /聊天室待辦：尚未啟用/);
  assert.match(serialized, /風險事件：尚未啟用/);
});

test("Flex contains five exact workspace postback actions", () => {
  const message = buildWorkspaceDashboardFlex(summary, new Date());
  const actions = message.contents.footer.contents.map((button) => button.action.data);

  assert.deepEqual(actions, [
    "action=workspace.activity.create",
    "action=workspace.push.create",
    "action=workspace.vendor.review",
    "action=workspace.chat.monitor",
    "action=workspace.risk.list",
  ]);
  assert.deepEqual(actions, Object.values(WORKSPACE_POSTBACK_ACTIONS));
});

test("every workspace placeholder returns a clear response through the admin boundary", async () => {
  for (const [intent, action] of Object.entries(WORKSPACE_POSTBACK_ACTIONS)) {
    assert.equal(resolveWorkspaceIntent(action), intent);

    const authorized = await handleWorkspacePlaceholderIntent({
      lineUserId: ADMIN,
      findAdmin,
      intent,
    });
    assert.equal(authorized.authorized, true);
    assert.equal(authorized.text, WORKSPACE_PLACEHOLDER_MESSAGES[intent]);

    const unauthorized = await handleWorkspacePlaceholderIntent({
      lineUserId: OTHER,
      findAdmin,
      intent,
    });
    assert.equal(unauthorized.authorized, false);
    assert.match(unauthorized.text, /僅限已授權管理員/);
  }
});

test("partial metric failure keeps the Flex and marks only failed values unavailable", () => {
  const message = buildWorkspaceDashboardFlex(
    {
      vendor_pending: null,
      offer_approved: 4,
      today_redemption_total: null,
      today_payable_total: 900,
    },
    new Date()
  );
  const metricValues = Object.fromEntries(
    message.contents.body.contents
      .filter((item) => item.type === "box" && item.layout === "horizontal")
      .flatMap((row) => row.contents || [])
      .map((box) => [box.contents?.[0]?.text, box.contents?.[1]?.text])
  );

  assert.equal(metricValues["待審廠商"], "暫時無法取得");
  assert.equal(metricValues["已上架優惠"], "4 項");
  assert.equal(metricValues["今日核銷筆數"], "暫時無法取得");
  assert.equal(metricValues["今日核銷金額"], "NT$900");
  assert.equal(message.contents.footer.contents.length, 5);
});

test("summary query failure still returns a usable Flex", async () => {
  const result = await handleDashboardSummaryIntent({
    lineUserId: ADMIN,
    findAdmin,
    loadSummary: async () => {
      throw new Error("D1 unavailable");
    },
  });

  assert.equal(result.message.type, "flex");
  assert.equal(result.message.contents.footer.contents.length, 5);
  assert.match(JSON.stringify(result.message), /暫時無法取得/);
});

test("Flex assembly failure uses the required plain-text fallback", async () => {
  const result = await handleDashboardSummaryIntent({
    lineUserId: ADMIN,
    findAdmin,
    loadSummary: async () => summary,
    buildFlex: () => {
      throw new Error("invalid flex");
    },
  });

  assert.equal(result.message, undefined);
  assert.equal(result.text, "目前無法顯示完整儀表板，請稍後再試。");
});

test("workspace implementation remains read-only and owns one LINE reply", () => {
  const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const handlerSource = readFileSync(
    new URL("../src/workspace/dashboard-handler.js", import.meta.url),
    "utf8"
  );
  const flexSource = readFileSync(
    new URL("../src/workspace/dashboard-flex.js", import.meta.url),
    "utf8"
  );
  const workspaceSource = `${handlerSource}\n${flexSource}`;

  assert.doesNotMatch(workspaceSource, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.match(indexSource, /resolveWorkspaceIntent\(getLineItemWorkspaceInput\(item\)\)/);
  const workspaceBranch = indexSource.match(
    /const workspaceIntent = resolveWorkspaceIntent\(getLineItemWorkspaceInput\(item\)\);[\s\S]*?\r?\n  }\r?\n  const subcommand =/
  )?.[0] || "";
  assert.match(workspaceBranch, /const result = workspaceIntent === WORKSPACE_INTENTS\.DASHBOARD_SUMMARY/);
  assert.equal((workspaceBranch.match(/await replyLineMessages\(/g) || []).length, 1);
});

test("dashboard SQL is isolated SELECT-only and performs no writes", () => {
  const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const block = indexSource.match(
    /async function readWorkspaceDashboardMetric[\s\S]*?\r?\n}\r?\nasync function getVendorManagementDashboard/
  )?.[0] || "";

  assert.match(block, /SELECT COUNT\(\*\)/);
  assert.match(block, /SELECT COALESCE\(SUM\(payable_price\), 0\)/);
  assert.doesNotMatch(block, /\b(?:INSERT|UPDATE|DELETE)\b/i);
});
