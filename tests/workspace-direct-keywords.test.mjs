import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_INTENTS,
  resolveWorkspaceIntent,
} from "../src/workspace/intent-router.js";

const directKeywords = new Map([
  ["新增活動", WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER],
  ["訊息推播", WORKSPACE_INTENTS.PUSH_PLACEHOLDER],
  ["廠商審核", WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER],
  ["聊天室監控", WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER],
  ["AI 風險中心", WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER],
]);

for (const [keyword, expectedIntent] of directKeywords) {
  test(`direct keyword ${keyword} is recognized`, () => {
    assert.equal(
      resolveWorkspaceIntent(keyword),
      expectedIntent,
    );
  });
}
