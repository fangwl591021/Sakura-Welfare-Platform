import test from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_INTENTS } from "../src/workspace/intent-router.js";

import {
  WORKSPACE_ACTION_TARGETS,
  handleWorkspaceActionIntent,
} from "../src/workspace/workspace-action-handler.js";

const expectedPaths = new Map([
  [WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER, "/activity-checkin-admin"],
  [WORKSPACE_INTENTS.PUSH_PLACEHOLDER, "/line-segment-push"],
  [WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER, "/vendor-management"],
  [WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER, "/line-oa-monitor"],
  [WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER, "/line-oa-monitor#risk"],
]);

test("all five dashboard actions have real target paths", () => {
  assert.equal(Object.keys(WORKSPACE_ACTION_TARGETS).length, 5);

  for (const [intent, path] of expectedPaths) {
    assert.equal(WORKSPACE_ACTION_TARGETS[intent].path, path);
  }
});

for (const [intent, expectedPath] of expectedPaths) {
  test(`${intent} returns a working URI Flex`, async () => {
    const result = await handleWorkspaceActionIntent({
      lineUserId: "U_ADMIN",
      intent,
      findAdmin: async () => ({
        role: "admin",
        admin: true,
      }),
      buildUrl: (path) => `https://example.com${path}`,
    });

    assert.equal(result.handled, true);
    assert.equal(result.authorized, true);
    assert.equal(result.targetPath, expectedPath);
    assert.equal(result.message.type, "flex");
    assert.equal(
      result.message.contents.footer.contents[0].action.uri,
      `https://example.com${expectedPath}`,
    );
  });
}

test("non-admin cannot open workspace actions", async () => {
  let buildUrlCalled = false;

  const result = await handleWorkspaceActionIntent({
    lineUserId: "U_MEMBER",
    intent: WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER,
    findAdmin: async () => null,
    buildUrl: () => {
      buildUrlCalled = true;
      return "https://example.com/activity-checkin-admin";
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.authorized, false);
  assert.equal(
    result.text,
    "此功能僅限已授權管理員使用。",
  );
  assert.equal(buildUrlCalled, false);
});

test("unknown intent is not handled", async () => {
  const result = await handleWorkspaceActionIntent({
    lineUserId: "U_ADMIN",
    intent: "unknown",
    findAdmin: async () => ({ admin: true }),
  });

  assert.equal(result.handled, false);
  assert.equal(result.authorized, false);
});

test("missing generated URL returns a safe fallback", async () => {
  const result = await handleWorkspaceActionIntent({
    lineUserId: "U_ADMIN",
    intent: WORKSPACE_INTENTS.PUSH_PLACEHOLDER,
    findAdmin: async () => ({ admin: true }),
    buildUrl: () => "",
  });

  assert.equal(result.handled, true);
  assert.equal(result.authorized, true);
  assert.match(result.text, /無法產生開啟連結/);
});
