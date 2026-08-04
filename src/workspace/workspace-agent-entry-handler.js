import {
  createAgentRegistry,
} from "./agent/agent-registry.js";

import {
  createAgentRuntime,
} from "./agent/agent-runtime.js";

import {
  createActivityAgent,
} from "./activity-agent.js";

import {
  saveWorkspaceActivity,
} from "./activity-writer.js";

import {
  ensureWorkspaceAgentSessionTable,
  getWorkspaceAgentSession,
  saveWorkspaceAgentSession,
  clearWorkspaceAgentSession,
} from "./workspace-agent-session.js";

export const ACTIVITY_QUICK_START_ACTION =
  "action=workspace.activity.quick.start";

const UNAUTHORIZED_MESSAGE =
  "此功能僅限已授權管理員使用。";

function normalizeString(value) {
  return String(value || "").trim();
}

export function createWorkspaceActivityRuntime({
  ensureActivityTables,
  normalizeActivityDate,
} = {}) {
  const activityAgent = createActivityAgent({
    saveActivity: (db, data) =>
      saveWorkspaceActivity(
        db,
        data,
        {
          ensureTables: ensureActivityTables,
          normalizeDate: normalizeActivityDate,
        },
      ),
  });

  const registry = createAgentRegistry([
    activityAgent,
  ]);

  return createAgentRuntime({
    registry,
    ensureSessionTable:
      ensureWorkspaceAgentSessionTable,
    getSession:
      getWorkspaceAgentSession,
    saveSession:
      saveWorkspaceAgentSession,
    clearSession:
      clearWorkspaceAgentSession,
  });
}

export async function handleWorkspaceAgentTurn({
  db,
  lineUserId,
  input,
  isPostback = false,
  findAdmin,
  runtime,
} = {}) {
  const normalizedLineUserId =
    normalizeString(lineUserId);

  const normalizedInput =
    normalizeString(input);

  if (
    !db ||
    !normalizedLineUserId ||
    !normalizedInput ||
    !runtime
  ) {
    return null;
  }

  const isActivityStart =
    normalizedInput ===
    ACTIVITY_QUICK_START_ACTION;

  let session = null;

  if (!isActivityStart && !isPostback) {
    session = await getWorkspaceAgentSession(
      db,
      normalizedLineUserId,
    );
  }

  if (!isActivityStart && !session) {
    return null;
  }

  const admin =
    typeof findAdmin === "function"
      ? await findAdmin(normalizedLineUserId)
      : null;

  if (!admin) {
    return {
      handled: true,
      authorized: false,
      text: UNAUTHORIZED_MESSAGE,
      agent: session?.agent || (
        isActivityStart ? "activity" : ""
      ),
    };
  }

  if (isActivityStart) {
    const result = await runtime.start({
      db,
      lineUserId: normalizedLineUserId,
      agentName: "activity",
      context: {
        identity: admin,
      },
    });

    return {
      handled: true,
      authorized: true,
      agent: "activity",
      result,
      text: result.text,
      message: result.message,
    };
  }

  if (normalizedInput === "取消") {
    const result = await runtime.cancel({
      db,
      lineUserId: normalizedLineUserId,
    });

    return {
      handled: true,
      authorized: true,
      agent: session.agent,
      result,
      text: result.text,
      message: result.message,
    };
  }

  const result = await runtime.resume({
    db,
    lineUserId: normalizedLineUserId,
    input: normalizedInput,
    context: {
      identity: admin,
    },
  });

  return {
    handled: true,
    authorized: true,
    agent: session.agent,
    result,
    text: result.text,
    message: result.message,
  };
}
