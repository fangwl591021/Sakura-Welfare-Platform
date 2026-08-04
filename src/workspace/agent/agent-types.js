export const AGENT_STATUS = Object.freeze({
  RUNNING: "running",
  CONFIRMING: "confirming",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
});

export const AGENT_RESULT_TYPES = Object.freeze({
  CONTINUE: "continue",
  CONFIRM: "confirm",
  COMPLETE: "complete",
  CANCEL: "cancel",
  ERROR: "error",
});

export const AGENT_COMMANDS = Object.freeze({
  CANCEL: "cancel",
  RESTART: "restart",
  BACK: "back",
  CONFIRM: "confirm",
});

export function createAgentResult({
  type,
  step = "",
  status = "",
  payload = {},
  text = "",
  message = null,
  error = null,
} = {}) {
  if (!Object.values(AGENT_RESULT_TYPES).includes(type)) {
    throw new TypeError("Invalid agent result type.");
  }

  return Object.freeze({
    type,
    step: String(step || "").trim(),
    status: String(status || "").trim(),
    payload:
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload)
        ? { ...payload }
        : {},
    text: String(text || ""),
    message: message || null,
    error: error || null,
  });
}
