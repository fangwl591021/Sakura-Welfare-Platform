export const WORKSPACE_INTENTS = Object.freeze({
  DASHBOARD_SUMMARY: "dashboard_summary",
  VENDOR_PORTAL: "vendor_portal",
  VENDOR_MANAGEMENT: "vendor_management",
  ACTIVITY_PLACEHOLDER: "activity_placeholder",
  PUSH_PLACEHOLDER: "push_placeholder",
  VENDOR_REVIEW_PLACEHOLDER: "vendor_review_placeholder",
  CHAT_MONITOR_PLACEHOLDER: "chat_monitor_placeholder",
  RISK_CENTER_PLACEHOLDER: "risk_center_placeholder",
});

export const WORKSPACE_POSTBACK_ACTIONS = Object.freeze({
  [WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER]: "action=workspace.activity.create",
  [WORKSPACE_INTENTS.PUSH_PLACEHOLDER]: "action=workspace.push.create",
  [WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER]: "action=workspace.vendor.review",
  [WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER]: "action=workspace.chat.monitor",
  [WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER]: "action=workspace.risk.list",
});

export const WORKSPACE_PLACEHOLDER_MESSAGES = Object.freeze({
  [WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER]: "新增活動工作台即將開放",
  [WORKSPACE_INTENTS.PUSH_PLACEHOLDER]: "訊息推播工作台即將開放",
  [WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER]: "廠商審核工作台即將開放",
  [WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER]: "聊天室監控工作台即將開放",
  [WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER]: "AI 風險中心即將開放",
});

const WORKSPACE_ACTION_INTENTS = new Map([
  ...Object.entries(WORKSPACE_POSTBACK_ACTIONS).map(([intent, action]) => [action, intent]),
  ["AI工作台｜新增活動", WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER],
  ["AI工作台｜分眾推播", WORKSPACE_INTENTS.PUSH_PLACEHOLDER],
  ["AI工作台｜廠商審核", WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER],
  ["AI工作台｜聊天室監控", WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER],
  ["AI工作台｜AI風險中心", WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER],
]);

export function resolveWorkspaceIntent(input) {
  const normalized = String(input || "").trim();
  if (normalized === "儀表板" || normalized === "仪表板") {
    return WORKSPACE_INTENTS.DASHBOARD_SUMMARY;
  }
  if (normalized === "廠商專區" || normalized === "厂商专区") {
    return WORKSPACE_INTENTS.VENDOR_PORTAL;
  }
  if (normalized === "廠商管理" || normalized === "厂商管理") {
    return WORKSPACE_INTENTS.VENDOR_MANAGEMENT;
  }
  if (normalized === "新增活動" || normalized === "新增活动") {
    return WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER;
  }
  if (normalized === "訊息推播" || normalized === "消息推送") {
    return WORKSPACE_INTENTS.PUSH_PLACEHOLDER;
  }
  if (normalized === "廠商審核" || normalized === "厂商审核") {
    return WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER;
  }
  if (normalized === "聊天室監控" || normalized === "聊天室监控") {
    return WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER;
  }
  if (
    normalized === "AI 風險中心" ||
    normalized === "AI風險中心" ||
    normalized === "AI 风险中心" ||
    normalized === "AI风险中心"
  ) {
    return WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER;
  }
  return WORKSPACE_ACTION_INTENTS.get(normalized) || null;
}
