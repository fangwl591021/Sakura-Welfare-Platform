import { WORKSPACE_INTENTS } from "./intent-router.js";

const UNAUTHORIZED_MESSAGE = "此功能僅限已授權管理員使用。";

export const WORKSPACE_ACTION_TARGETS = Object.freeze({
  [WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER]: Object.freeze({
    title: "活動管理",
    description: "新增活動、管理報名與現場報到。",
    buttonLabel: "開啟活動管理",
    path: "/activity-checkin-admin",
  }),

  [WORKSPACE_INTENTS.PUSH_PLACEHOLDER]: Object.freeze({
    title: "訊息推播",
    description: "進入 LINE 分眾推播工作台。",
    buttonLabel: "開啟訊息推播",
    path: "/line-segment-push",
  }),

  [WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER]: Object.freeze({
    title: "廠商審核",
    description: "查看廠商資料、待審案件與合作狀態。",
    buttonLabel: "開啟廠商管理",
    path: "/vendor-management",
  }),

  [WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER]: Object.freeze({
    title: "聊天室監控",
    description: "查看 LINE OA 對話、事件與訊息處理狀況。",
    buttonLabel: "開啟聊天室監控",
    path: "/line-oa-monitor",
  }),

  [WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER]: Object.freeze({
    title: "AI 風險中心",
    description: "查看高風險訊息、抱怨與需要管理員處理的事件。",
    buttonLabel: "開啟風險監控",
    path: "/line-oa-monitor#risk",
  }),
});

function buildWorkspaceActionFlex(target, url) {
  return {
    type: "flex",
    altText: target.title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: target.title,
            weight: "bold",
            size: "xl",
            wrap: true,
          },
          {
            type: "text",
            text: target.description,
            size: "sm",
            color: "#475569",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: target.buttonLabel,
              uri: url,
            },
          },
        ],
      },
    },
  };
}

export async function handleWorkspaceActionIntent({
  lineUserId,
  findAdmin,
  intent,
  buildUrl,
} = {}) {
  const target = WORKSPACE_ACTION_TARGETS[intent];

  if (!target) {
    return {
      handled: false,
      authorized: false,
      text: "找不到對應的工作台功能。",
    };
  }

  const admin =
    typeof findAdmin === "function"
      ? await findAdmin(lineUserId)
      : null;

  if (!admin) {
    return {
      handled: true,
      authorized: false,
      text: UNAUTHORIZED_MESSAGE,
    };
  }

  const url =
    typeof buildUrl === "function"
      ? String(buildUrl(target.path) || "").trim()
      : "";

  if (!url) {
    return {
      handled: true,
      authorized: true,
      text: `${target.title}目前無法產生開啟連結，請稍後再試。`,
    };
  }

  return {
    handled: true,
    authorized: true,
    targetPath: target.path,
    message: buildWorkspaceActionFlex(target, url),
  };
}
