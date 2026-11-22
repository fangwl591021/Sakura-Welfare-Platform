import {
  AGENT_RESULT_TYPES,
  AGENT_STATUS,
  createAgentResult,
} from "./agent-types.js";

function normalizeString(value) {
  return String(value || "").trim();
}

function isTerminalResult(result) {
  return [
    AGENT_RESULT_TYPES.COMPLETE,
    AGENT_RESULT_TYPES.CANCEL,
    AGENT_RESULT_TYPES.ERROR,
  ].includes(result?.type);
}

export function createAgentRuntime({
  registry,
  ensureSessionTable,
  getSession,
  saveSession,
  clearSession,
} = {}) {
  if (!registry || typeof registry.get !== "function") {
    throw new TypeError(
      "Agent runtime requires a registry.",
    );
  }

  if (typeof getSession !== "function") {
    throw new TypeError(
      "Agent runtime requires getSession().",
    );
  }

  if (typeof saveSession !== "function") {
    throw new TypeError(
      "Agent runtime requires saveSession().",
    );
  }

  if (typeof clearSession !== "function") {
    throw new TypeError(
      "Agent runtime requires clearSession().",
    );
  }

  async function initialize(db) {
    if (typeof ensureSessionTable !== "function") {
      return true;
    }

    return ensureSessionTable(db);
  }

  async function persistResult({
    db,
    lineUserId,
    agentName,
    previousPayload = {},
    result,
  }) {
    if (isTerminalResult(result)) {
      await clearSession(db, lineUserId);
      return;
    }

    const status =
      result.status ||
      (
        result.type === AGENT_RESULT_TYPES.CONFIRM
          ? AGENT_STATUS.CONFIRMING
          : AGENT_STATUS.RUNNING
      );

    await saveSession(db, {
      lineUserId,
      agent: agentName,
      step: result.step,
      status,
      payload: {
        ...previousPayload,
        ...result.payload,
      },
    });
  }

  async function start({
    db,
    lineUserId,
    agentName,
    context = {},
  } = {}) {
    const normalizedLineUserId =
      normalizeString(lineUserId);

    const normalizedAgentName =
      normalizeString(agentName).toLowerCase();

    if (!normalizedLineUserId) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "缺少 LINE 使用者識別。",
      });
    }

    const agent = registry.get(
      normalizedAgentName,
    );

    if (!agent) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "找不到指定的工作助理。",
      });
    }

    await initialize(db);

    const existingSession =
      await getSession(db, normalizedLineUserId);

    if (existingSession) {
      await clearSession(
        db,
        normalizedLineUserId,
      );
    }

    try {
      const result = await agent.start({
        ...context,
        db,
        lineUserId: normalizedLineUserId,
      });

      await persistResult({
        db,
        lineUserId: normalizedLineUserId,
        agentName: normalizedAgentName,
        result,
      });

      return result;
    } catch (error) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "工作助理啟動失敗，請稍後再試。",
        error,
      });
    }
  }

  async function resume({
    db,
    lineUserId,
    input,
    context = {},
  } = {}) {
    const normalizedLineUserId =
      normalizeString(lineUserId);

    if (!normalizedLineUserId) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "缺少 LINE 使用者識別。",
      });
    }

    const session =
      await getSession(db, normalizedLineUserId);

    if (!session) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "目前沒有進行中的工作流程。",
      });
    }

    const agent = registry.get(session.agent);

    if (!agent) {
      await clearSession(
        db,
        normalizedLineUserId,
      );

      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "工作流程已失效，請重新開始。",
      });
    }

    try {
      const result = await agent.resume({
        ...context,
        db,
        lineUserId: normalizedLineUserId,
        input,
        session,
      });

      await persistResult({
        db,
        lineUserId: normalizedLineUserId,
        agentName: session.agent,
        previousPayload: session.payload,
        result,
      });

      return result;
    } catch (error) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "工作流程處理失敗，請稍後再試。",
        error,
      });
    }
  }

  async function cancel({
    db,
    lineUserId,
  } = {}) {
    const normalizedLineUserId =
      normalizeString(lineUserId);

    if (!normalizedLineUserId) {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        text: "缺少 LINE 使用者識別。",
      });
    }

    await clearSession(
      db,
      normalizedLineUserId,
    );

    return createAgentResult({
      type: AGENT_RESULT_TYPES.CANCEL,
      status: AGENT_STATUS.CANCELLED,
      text: "已取消目前的工作流程。",
    });
  }

  return Object.freeze({
    initialize,
    start,
    resume,
    cancel,
  });
}
