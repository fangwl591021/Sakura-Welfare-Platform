const VENDOR_PENDING_COUNT_SQL = `
SELECT COUNT(*) AS pending_count
FROM welfare_vendors
WHERE status = 'pending'
  AND COALESCE(is_hidden, 0) = 0
`;

const VENDOR_PENDING_FIRST_SQL = `
SELECT id, name, status, created_at, updated_at
FROM welfare_vendors
WHERE status = 'pending'
  AND COALESCE(is_hidden, 0) = 0
ORDER BY COALESCE(updated_at, created_at) DESC
LIMIT 1
`;

const CHAT_UNRESOLVED_COUNT_SQL = `
SELECT COUNT(*) AS unresolved_count
FROM line_webhook_events
WHERE COALESCE(process_status, 'pending')
  NOT IN ('resolved', 'handled', 'closed', 'done', 'archived')
`;

const CHAT_HIGH_RISK_COUNT_SQL = `
SELECT COUNT(*) AS high_risk_count
FROM line_webhook_events
WHERE priority IN ('high', 'critical')
   OR ai_severity IN ('high', 'critical')
   OR sentiment_type = 'risk'
`;

const CHAT_LATEST_UNRESOLVED_SQL = `
SELECT
  id,
  event_id,
  line_user_id,
  message_text,
  ai_summary,
  priority,
  ai_severity,
  process_status,
  created_at
FROM line_webhook_events
WHERE COALESCE(process_status, 'pending')
  NOT IN ('resolved', 'handled', 'closed', 'done', 'archived')
ORDER BY created_at DESC
LIMIT 1
`;

const RISK_LATEST_SQL = `
SELECT
  id,
  event_id,
  line_user_id,
  message_text,
  ai_summary,
  priority,
  ai_severity,
  sentiment_type,
  suggested_action,
  process_status,
  created_at
FROM line_webhook_events
WHERE priority IN ('high', 'critical')
   OR ai_severity IN ('high', 'critical')
   OR sentiment_type = 'risk'
ORDER BY created_at DESC
LIMIT 1
`;

function numberValue(row, key) {
  const value = Number(row?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function messageSummary(row) {
  return String(
    row?.ai_summary ||
    row?.message_text ||
    "",
  ).trim();
}

export async function loadVendorReviewSummaryReadOnly(db) {
  if (!db) {
    return {
      pendingCount: 0,
      firstVendor: null,
    };
  }

  try {
    const [countRow, firstVendor] = await Promise.all([
      db.prepare(VENDOR_PENDING_COUNT_SQL).first(),
      db.prepare(VENDOR_PENDING_FIRST_SQL).first(),
    ]);

    return {
      pendingCount: numberValue(countRow, "pending_count"),
      firstVendor: firstVendor || null,
    };
  } catch (error) {
    console.warn(
      "loadVendorReviewSummaryReadOnly failed",
      error,
    );

    return {
      pendingCount: 0,
      firstVendor: null,
    };
  }
}

export async function loadChatMonitorSummaryReadOnly(db) {
  if (!db) {
    return {
      unresolvedCount: 0,
      highRiskCount: 0,
      latestMessage: null,
    };
  }

  try {
    const [
      unresolvedRow,
      highRiskRow,
      latestRow,
    ] = await Promise.all([
      db.prepare(CHAT_UNRESOLVED_COUNT_SQL).first(),
      db.prepare(CHAT_HIGH_RISK_COUNT_SQL).first(),
      db.prepare(CHAT_LATEST_UNRESOLVED_SQL).first(),
    ]);

    return {
      unresolvedCount: numberValue(
        unresolvedRow,
        "unresolved_count",
      ),
      highRiskCount: numberValue(
        highRiskRow,
        "high_risk_count",
      ),
      latestMessage: latestRow
        ? {
            ...latestRow,
            summary: messageSummary(latestRow),
          }
        : null,
    };
  } catch (error) {
    console.warn(
      "loadChatMonitorSummaryReadOnly failed",
      error,
    );

    return {
      unresolvedCount: 0,
      highRiskCount: 0,
      latestMessage: null,
    };
  }
}

export async function loadRiskSummaryReadOnly(db) {
  if (!db) {
    return {
      highRiskCount: 0,
      latestRisk: null,
    };
  }

  try {
    const [countRow, latestRow] = await Promise.all([
      db.prepare(CHAT_HIGH_RISK_COUNT_SQL).first(),
      db.prepare(RISK_LATEST_SQL).first(),
    ]);

    return {
      highRiskCount: numberValue(
        countRow,
        "high_risk_count",
      ),
      latestRisk: latestRow
        ? {
            ...latestRow,
            summary: messageSummary(latestRow),
            priority: String(
              latestRow.ai_severity ||
              latestRow.priority ||
              "high",
            ),
          }
        : null,
    };
  } catch (error) {
    console.warn(
      "loadRiskSummaryReadOnly failed",
      error,
    );

    return {
      highRiskCount: 0,
      latestRisk: null,
    };
  }
}
