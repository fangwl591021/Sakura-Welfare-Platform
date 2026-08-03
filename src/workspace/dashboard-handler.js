import { WORKSPACE_PLACEHOLDER_MESSAGES } from "./intent-router.js";
import { buildWorkspaceDashboardFlex } from "./dashboard-flex.js";

const UNAUTHORIZED_MESSAGE = "此功能僅限已授權管理員使用。";
const FLEX_FALLBACK_MESSAGE = "目前無法顯示完整儀表板，請稍後再試。";

function unavailableSummary() {
  return {
    vendor_pending: null,
    offer_approved: null,
    today_redemption_total: null,
    today_payable_total: null,
  };
}

export async function handleDashboardSummaryIntent({
  lineUserId,
  findAdmin,
  loadSummary,
  buildFlex = buildWorkspaceDashboardFlex,
  now = new Date(),
}) {
  const admin = await findAdmin(lineUserId);
  if (!admin) {
    return { handled: true, authorized: false, text: UNAUTHORIZED_MESSAGE };
  }

  let summary;
  try {
    summary = await loadSummary();
  } catch {
    summary = unavailableSummary();
  }

  try {
    return { handled: true, authorized: true, message: buildFlex(summary, now) };
  } catch {
    return { handled: true, authorized: true, text: FLEX_FALLBACK_MESSAGE };
  }
}

export async function handleWorkspacePlaceholderIntent({ lineUserId, findAdmin, intent }) {
  const admin = await findAdmin(lineUserId);
  if (!admin) {
    return { handled: true, authorized: false, text: UNAUTHORIZED_MESSAGE };
  }
  return {
    handled: true,
    authorized: true,
    text: WORKSPACE_PLACEHOLDER_MESSAGES[intent] || "此功能即將開放",
  };
}
