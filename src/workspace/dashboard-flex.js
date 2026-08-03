export const WORKSPACE_DASHBOARD_ALT_TEXT = "櫻花福委會 AI 工作台";

const DASHBOARD_ACTIONS = Object.freeze([
  ["新增活動", "action=workspace.activity.create", "#06c755"],
  ["訊息推播", "action=workspace.push.create", "#2563eb"],
  ["廠商審核", "action=workspace.vendor.review", "#ed174c"],
  ["聊天室監控", "action=workspace.chat.monitor", "#111827"],
  ["AI 風險中心", "action=workspace.risk.list", "#b45309"],
]);

function availableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMetric(value, suffix = "") {
  const parsed = availableNumber(value);
  return parsed === null ? "暫時無法取得" : `${parsed.toLocaleString("zh-TW")}${suffix}`;
}

function formatMoney(value) {
  const parsed = availableNumber(value);
  return parsed === null
    ? "暫時無法取得"
    : `NT$${parsed.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
}

function formatTaiwanDateTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/[\u2000-\u200B\u202F\u205F\u3000]/g, " ");
}

function metricBox(label, value, color) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    backgroundColor: "#f8fafc",
    cornerRadius: "6px",
    paddingAll: "12px",
    contents: [
      { type: "text", text: label, size: "xs", color: "#64748b", wrap: true },
      { type: "text", text: value, size: value === "暫時無法取得" ? "xs" : "lg", weight: "bold", color, margin: "sm", wrap: true },
    ],
  };
}

function postbackButton(label, data, color) {
  return {
    type: "button",
    style: "primary",
    height: "sm",
    color,
    action: { type: "postback", label, data, displayText: label },
  };
}

export function buildWorkspaceDashboardFlex(summary = {}, now = new Date()) {
  const vendorPending = availableNumber(summary.vendor_pending);
  const vendorTodo = vendorPending === null
    ? "待審廠商：暫時無法取得"
    : vendorPending > 0
      ? `有 ${vendorPending} 家廠商等待審核`
      : "目前沒有待審廠商";

  return {
    type: "flex",
    altText: WORKSPACE_DASHBOARD_ALT_TEXT,
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#ed174c",
        paddingAll: "18px",
        contents: [
          { type: "text", text: "櫻花福委會 AI 工作台", size: "xl", weight: "bold", color: "#ffffff", wrap: true },
          { type: "text", text: "今日營運摘要", size: "sm", color: "#ffffff", margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "sm", contents: [
              metricBox("待審廠商", formatMetric(summary.vendor_pending, " 家"), "#ed174c"),
              metricBox("已上架優惠", formatMetric(summary.offer_approved, " 項"), "#00897b"),
            ],
          },
          {
            type: "box", layout: "horizontal", spacing: "sm", contents: [
              metricBox("今日核銷筆數", formatMetric(summary.today_redemption_total, " 筆"), "#2563eb"),
              metricBox("今日核銷金額", formatMoney(summary.today_payable_total), "#7c3aed"),
            ],
          },
          { type: "separator", margin: "md" },
          { type: "text", text: "今日待辦", size: "md", weight: "bold", color: "#0f172a" },
          {
            type: "box", layout: "vertical", backgroundColor: "#fff7ed", cornerRadius: "6px", paddingAll: "12px", spacing: "sm",
            contents: [
              { type: "text", text: vendorTodo, size: "sm", color: "#9a3412", wrap: true },
              { type: "text", text: "聊天室待辦：尚未啟用", size: "sm", color: "#475569", wrap: true },
              { type: "text", text: "風險事件：尚未啟用", size: "sm", color: "#475569", wrap: true },
            ],
          },
          { type: "text", text: `資料更新時間：${formatTaiwanDateTime(now)}`, size: "xs", color: "#94a3b8", align: "end", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "sm",
        contents: DASHBOARD_ACTIONS.map(([label, data, color]) => postbackButton(label, data, color)),
      },
    },
  };
}
