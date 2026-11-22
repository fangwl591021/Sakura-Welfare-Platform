import {
  AGENT_RESULT_TYPES,
  AGENT_STATUS,
  createAgentResult,
} from "./agent/agent-types.js";

export const ACTIVITY_AGENT_STEPS = Object.freeze({
  TITLE: "activity_title",
  START_AT: "activity_start_at",
  LOCATION: "activity_location",
  CONFIRM: "activity_confirm",
});

function normalizeInput(value) {
  return String(value || "").trim();
}

function buildConfirmation(payload) {
  return [
    "請確認活動資料：",
    `名稱：${payload.title || "未填"}`,
    `日期：${payload.startAt || "未填"}`,
    `地點：${payload.location || "未填"}`,
    "",
    "輸入「確認」建立，或輸入「取消」放棄。",
  ].join("\n");
}

export function createActivityAgent({
  saveActivity,
} = {}) {
  if (typeof saveActivity !== "function") {
    throw new TypeError(
      "Activity agent requires saveActivity().",
    );
  }

  return Object.freeze({
    name: "activity",

    async start() {
      return createAgentResult({
        type: AGENT_RESULT_TYPES.CONTINUE,
        step: ACTIVITY_AGENT_STEPS.TITLE,
        text: "請輸入活動名稱。",
      });
    },

    async resume({
      db,
      input,
      session,
    } = {}) {
      const value = normalizeInput(input);
      const payload = {
        ...(session?.payload || {}),
      };

      if (!value) {
        return createAgentResult({
          type: AGENT_RESULT_TYPES.CONTINUE,
          step:
            session?.step ||
            ACTIVITY_AGENT_STEPS.TITLE,
          payload,
          text: "輸入內容不能為空白，請重新輸入。",
        });
      }

      if (value === "取消") {
        return createAgentResult({
          type: AGENT_RESULT_TYPES.CANCEL,
          status: AGENT_STATUS.CANCELLED,
          text: "已取消新增活動。",
        });
      }

      if (
        session?.step ===
        ACTIVITY_AGENT_STEPS.TITLE
      ) {
        payload.title = value;

        return createAgentResult({
          type: AGENT_RESULT_TYPES.CONTINUE,
          step: ACTIVITY_AGENT_STEPS.START_AT,
          payload,
          text:
            "請輸入活動日期時間，例如：2026-08-20 14:00。",
        });
      }

      if (
        session?.step ===
        ACTIVITY_AGENT_STEPS.START_AT
      ) {
        payload.startAt = value;

        return createAgentResult({
          type: AGENT_RESULT_TYPES.CONTINUE,
          step: ACTIVITY_AGENT_STEPS.LOCATION,
          payload,
          text: "請輸入活動地點。",
        });
      }

      if (
        session?.step ===
        ACTIVITY_AGENT_STEPS.LOCATION
      ) {
        payload.location = value;

        return createAgentResult({
          type: AGENT_RESULT_TYPES.CONFIRM,
          step: ACTIVITY_AGENT_STEPS.CONFIRM,
          status: AGENT_STATUS.CONFIRMING,
          payload,
          text: buildConfirmation(payload),
        });
      }

      if (
        session?.step ===
        ACTIVITY_AGENT_STEPS.CONFIRM
      ) {
        if (value !== "確認") {
          return createAgentResult({
            type: AGENT_RESULT_TYPES.CONFIRM,
            step: ACTIVITY_AGENT_STEPS.CONFIRM,
            status: AGENT_STATUS.CONFIRMING,
            payload,
            text:
              buildConfirmation(payload) +
              "\n\n請輸入完整的「確認」。",
          });
        }

        const result = await saveActivity(db, {
          title: payload.title,
          start_at: payload.startAt,
          location: payload.location,
          status: "active",
          audience_scope: ["all"],
        });

        if (!result?.success) {
          return createAgentResult({
            type: AGENT_RESULT_TYPES.ERROR,
            status: AGENT_STATUS.FAILED,
            payload,
            text:
              result?.message ||
              "活動建立失敗，請稍後再試。",
          });
        }

        return createAgentResult({
          type: AGENT_RESULT_TYPES.COMPLETE,
          status: AGENT_STATUS.COMPLETED,
          payload: {
            ...payload,
            eventId: result.event?.id || "",
          },
          text: [
            "活動建立完成。",
            `名稱：${payload.title}`,
            `日期：${payload.startAt}`,
            `地點：${payload.location}`,
          ].join("\n"),
        });
      }

      return createAgentResult({
        type: AGENT_RESULT_TYPES.ERROR,
        status: AGENT_STATUS.FAILED,
        payload,
        text: "活動流程狀態無效，請重新開始。",
      });
    },
  });
}
