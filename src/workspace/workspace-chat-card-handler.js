import { WORKSPACE_INTENTS } from "./intent-router.js";

const UNAUTHORIZED_MESSAGE = "此功能僅限已授權管理員使用。";

function text(value, options = {}) {
  return {
    type: "text",
    text: String(value),
    wrap: true,
    ...options,
  };
}

function postbackButton(label, data, displayText) {
  return {
    type: "button",
    style: "primary",
    action: {
      type: "postback",
      label,
      data,
      displayText: displayText || label,
    },
  };
}

function uriButton(label, uri) {
  return {
    type: "button",
    style: "secondary",
    action: {
      type: "uri",
      label,
      uri,
    },
  };
}

function bubble(title, description, bodyContents, footerContents) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          text(title, {
            weight: "bold",
            size: "xl",
          }),
          text(description, {
            size: "sm",
            color: "#475569",
          }),
          ...bodyContents,
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: footerContents,
      },
    },
  };
}

function buildActivityCard(buildUrl) {
  return bubble(
    "新增活動",
    "選擇快速建立，或開啟完整活動管理頁。",
    [
      text("快速建立會在聊天室中逐步詢問活動名稱、日期、名額與確認資料。", {
        size: "sm",
        color: "#64748B",
      }),
    ],
    [
      postbackButton(
        "快速建立",
        "action=workspace.activity.quick.start",
        "快速建立活動",
      ),
      uriButton(
        "進階建立",
        buildUrl("/activity-checkin-admin"),
      ),
    ],
  );
}

function buildPushCard(buildUrl) {
  return bubble(
    "訊息推播",
    "選擇推播方式，後續可在聊天室中輸入內容與確認受眾。",
    [],
    [
      postbackButton(
        "立即推播",
        "action=workspace.push.immediate.start",
        "建立立即推播",
      ),
      postbackButton(
        "排程推播",
        "action=workspace.push.schedule.start",
        "建立排程推播",
      ),
      postbackButton(
        "查看草稿",
        "action=workspace.push.drafts.list",
        "查看推播草稿",
      ),
      uriButton(
        "完整推播工作台",
        buildUrl("/line-segment-push"),
      ),
    ],
  );
}

function buildVendorReviewCard(summary, buildUrl) {
  const pendingCount = Number(summary?.pendingCount || 0);
  const first = summary?.firstVendor || null;

  const bodyContents = [
    text(`待審廠商：${pendingCount} 家`, {
      weight: "bold",
      size: "lg",
    }),
  ];

  if (first) {
    bodyContents.push(
      text(`最新申請：${first.name || "未命名廠商"}`, {
        size: "sm",
      }),
      text(`狀態：${first.status || "pending"}`, {
        size: "sm",
        color: "#64748B",
      }),
    );
  } else {
    bodyContents.push(
      text("目前沒有待審廠商。", {
        size: "sm",
        color: "#64748B",
      }),
    );
  }

  const footerContents = [];

  if (first?.id) {
    footerContents.push(
      postbackButton(
        "查看第一筆",
        `action=workspace.vendor.review.detail&vendor_id=${encodeURIComponent(first.id)}`,
        "查看待審廠商",
      ),
    );
  }

  footerContents.push(
    uriButton(
      "完整廠商管理",
      buildUrl("/vendor-management"),
    ),
  );

  return bubble(
    "廠商審核",
    "快速查看待審案件，或進入完整管理頁。",
    bodyContents,
    footerContents,
  );
}

function buildChatMonitorCard(summary, buildUrl) {
  const unresolvedCount = Number(summary?.unresolvedCount || 0);
  const highRiskCount = Number(summary?.highRiskCount || 0);
  const latest = summary?.latestMessage || null;

  const bodyContents = [
    text(`未處理訊息：${unresolvedCount} 筆`, {
      weight: "bold",
      size: "lg",
    }),
    text(`高風險訊息：${highRiskCount} 筆`, {
      weight: "bold",
      size: "lg",
    }),
  ];

  if (latest) {
    bodyContents.push(
      text(`最新摘要：${latest.summary || latest.text || "無摘要"}`, {
        size: "sm",
        color: "#64748B",
      }),
    );
  }

  return bubble(
    "聊天室監控",
    "查看未處理訊息與高風險對話摘要。",
    bodyContents,
    [
      postbackButton(
        "查看下一筆",
        "action=workspace.chat.next",
        "查看下一筆未處理訊息",
      ),
      uriButton(
        "完整聊天室監控",
        buildUrl("/line-oa-monitor"),
      ),
    ],
  );
}

function buildRiskCard(summary, buildUrl) {
  const highRiskCount = Number(summary?.highRiskCount || 0);
  const event = summary?.latestRisk || null;

  const bodyContents = [
    text(`高風險事件：${highRiskCount} 筆`, {
      weight: "bold",
      size: "lg",
    }),
  ];

  if (event) {
    bodyContents.push(
      text(`事件：${event.summary || "未提供摘要"}`, {
        size: "sm",
      }),
      text(`等級：${event.priority || "high"}`, {
        size: "sm",
        color: "#B45309",
      }),
    );
  } else {
    bodyContents.push(
      text("目前沒有高風險事件。", {
        size: "sm",
        color: "#64748B",
      }),
    );
  }

  return bubble(
    "AI 風險中心",
    "查看需要立即注意的訊息、抱怨與稽核事件。",
    bodyContents,
    [
      postbackButton(
        "標記處理",
        "action=workspace.risk.resolve",
        "處理高風險事件",
      ),
      uriButton(
        "完整風險監控",
        buildUrl("/line-oa-monitor#risk"),
      ),
    ],
  );
}

export async function handleWorkspaceChatCardIntent({
  lineUserId,
  findAdmin,
  intent,
  buildVendorPortalCard,
  buildUrl,
  loadVendorReviewSummary,
  loadChatMonitorSummary,
  loadRiskSummary,
} = {}) {
  if (
    intent === WORKSPACE_INTENTS.VENDOR_PORTAL ||
    intent === WORKSPACE_INTENTS.VENDOR_MANAGEMENT
  ) {
    if (
      typeof buildVendorPortalCard !==
      "function"
    ) {
      return {
        handled: true,
        authorized: false,
        authenticated: false,
        vendorId: null,
        text:
          "廠商專區暫時無法開啟，請稍後再試。",
      };
    }

    const result =
      await buildVendorPortalCard({
        lineUserId,
      });

    return {
      handled: true,
      authorized:
        result?.authorized === true,
      authenticated:
        result?.authenticated === true,
      vendorId:
        result?.vendorId || null,
      message:
        result?.message || null,
      text:
        result?.text || "",
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

  const safeBuildUrl = (path) => {
    if (typeof buildUrl !== "function") {
      return "";
    }

    return String(buildUrl(path) || "").trim();
  };

  if (intent === WORKSPACE_INTENTS.ACTIVITY_PLACEHOLDER) {
    return {
      handled: true,
      authorized: true,
      message: buildActivityCard(safeBuildUrl),
    };
  }

  if (intent === WORKSPACE_INTENTS.PUSH_PLACEHOLDER) {
    return {
      handled: true,
      authorized: true,
      message: buildPushCard(safeBuildUrl),
    };
  }

  if (intent === WORKSPACE_INTENTS.VENDOR_REVIEW_PLACEHOLDER) {
    const summary =
      typeof loadVendorReviewSummary === "function"
        ? await loadVendorReviewSummary()
        : {};

    return {
      handled: true,
      authorized: true,
      message: buildVendorReviewCard(summary, safeBuildUrl),
    };
  }

  if (intent === WORKSPACE_INTENTS.CHAT_MONITOR_PLACEHOLDER) {
    const summary =
      typeof loadChatMonitorSummary === "function"
        ? await loadChatMonitorSummary()
        : {};

    return {
      handled: true,
      authorized: true,
      message: buildChatMonitorCard(summary, safeBuildUrl),
    };
  }

  if (intent === WORKSPACE_INTENTS.RISK_CENTER_PLACEHOLDER) {
    const summary =
      typeof loadRiskSummary === "function"
        ? await loadRiskSummary()
        : {};

    return {
      handled: true,
      authorized: true,
      message: buildRiskCard(summary, safeBuildUrl),
    };
  }

  return {
    handled: false,
    authorized: true,
    text: "找不到對應的聊天室工作卡。",
  };
}
