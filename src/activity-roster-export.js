import { buildRosterWorkbook } from './activity-roster-xlsx.js';

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const answerText = value => Array.isArray(value) ? value.join("、") : String(value ?? "");
const dateValue = value => value ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(value)) ? String(value) : String(value).replace(' ', 'T') + '+08:00') : null;
const timestamp = value => {
  if (!value) return "";
  // Legacy event timestamps are Taipei wall time; registrations use ISO UTC.
  const text = String(value);
  const date = dateValue(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hourCycle: 'h23' });
};
const fieldKey = field => JSON.stringify([field.id, field.label, field.type]);

function actualAttendance(row) {
  if (!row.checkin_id) return '';
  try {
    const count = JSON.parse(row.checkin_payload || '{}')?.attendance_count;
    return Number.isSafeInteger(count) && count >= 1 && count <= 10000 ? count : '';
  } catch { return ''; }
}

function entriesFrom(rows) {
  return rows.map(row => {
    const schema = JSON.parse(row.schema_json), answers = JSON.parse(row.answers_json);
    if (!Array.isArray(schema?.fields) || !answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Invalid saved registration");
    return { name: row.display_name || "LINE 會員", time: timestamp(row.created_at), createdAt: row.created_at,
      attendance: row.checkin_id ? '已簽到' : '未簽到', checkedAt: row.checkin_id ? row.checked_at || '' : '', actualCount: actualAttendance(row), fields: schema.fields,
      values: new Map(schema.fields.map(field => [fieldKey(field), Object.hasOwn(answers, field.id) ? answerText(answers[field.id]) : ""])) };
  });
}

export function csvCell(value) {
  let text = String(value ?? "");
  // Quote CSV delimiters, and neutralize spreadsheet formulas and leading-zero IDs.
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) || /^0\d/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function rosterTable(rows) {
  const entries = entriesFrom(rows), columns = new Map();
  for (const entry of entries) for (const field of entry.fields) columns.set(fieldKey(field), field.label);
  const labels = [...columns.values()];
  const used = new Set(['序號', 'LINE 顯示名稱', '報名時間（台北）', '出席狀況', '簽到時間（臺北）', '實到人數', '簽到／簽名']);
  const answerHeaders = labels.map((label, i) => {
    let unique = String(label), suffix = i + 1;
    while (used.has(unique)) unique = String(label) + '（欄位 ' + suffix++ + '）';
    used.add(unique); return unique;
  });
  const headers = ["序號", "LINE 顯示名稱", "報名時間（台北）", '出席狀況', '簽到時間（臺北）', '實到人數', ...answerHeaders, "簽到／簽名"];
  const lines = entries.map((entry, i) => [i + 1, entry.name, entry.time, entry.attendance, timestamp(entry.checkedAt), entry.actualCount, ...[...columns.keys()].map(key => entry.values.get(key) ?? ""), ""]);
  return { headers, lines, entries };
}

export function buildActivityRosterCsv(rows) {
  const { headers, lines: values } = rosterTable(rows);
  const lines = [headers, ...values];
  return "\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildActivityRosterXlsx(rows) {
  const { headers, lines, entries } = rosterTable(rows);
  const serial = value => {
    const date = dateValue(value);
    return date && Number.isFinite(date.getTime()) ? { number: (date.getTime() + 8 * 3600000) / 86400000 + 25569, date: true } : timestamp(value);
  };
  for (let i = 0; i < lines.length; i++) {
    lines[i][0] = { number: i + 1 };
    lines[i][2] = serial(entries[i].createdAt);
    lines[i][4] = serial(entries[i].checkedAt);
    if (entries[i].actualCount !== '') lines[i][5] = { number: entries[i].actualCount };
  }
  return buildRosterWorkbook(headers, lines);
}

export function buildActivityRosterPrint(event, rows) {
  const entries = entriesFrom(rows), e = escapeHtml;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(event.title)}｜報名簽到表</title>
<style>
*{box-sizing:border-box}body{margin:24px auto;padding:0 16px;max-width:1000px;color:#111;background:#fff;font:14px/1.5 system-ui,sans-serif;letter-spacing:0}h1{font-size:22px;margin:0 0 8px;overflow-wrap:anywhere}p{margin:4px 0;overflow-wrap:anywhere}.toolbar{display:flex;justify-content:flex-end;margin-bottom:16px}button{font:inherit;padding:8px 16px;border:1px solid #555;border-radius:4px;background:white;cursor:pointer}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:650px;table-layout:fixed;margin-top:16px}th,td{border:1px solid #555;padding:8px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{text-align:left;background:#eee}td{height:72px}.number{width:8%}.name{width:19%}.signature{width:25%}.answer{margin:0 0 4px}.time{font-size:12px;color:#444}.empty{text-align:center;height:72px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
@page{size:A4 portrait;margin:12mm}@media print{body{margin:0;padding:0;max-width:none;font-size:11px}.toolbar{display:none}.table-wrap{overflow:visible}table{min-width:0}th,td{padding:6px}td{height:20mm}h1{font-size:18px}.time{font-size:10px}}
</style></head><body><div class="toolbar"><button id="print" type="button">列印／另存 PDF</button></div><h1>${e(event.title)}｜報名簽到表</h1>
<p>活動時間：${e(timestamp(event.start_at))}${event.end_at ? " ～ " + e(timestamp(event.end_at)) : ""}</p><p>地點：${e(event.location || "未設定")}</p><p>共 ${entries.length} 筆報名（每筆報名一列，含尚未核銷者）</p><p>匯出時間：${e(timestamp(new Date().toISOString()))}（台北）</p>
<div class="table-wrap"><table><thead><tr><th class="number" scope="col">序號</th><th class="name" scope="col">LINE 顯示名稱</th><th scope="col">報名自填資料</th><th scope="col">出席狀況／簽到時間（臺北）</th><th class="signature" scope="col">簽到／簽名</th></tr></thead><tbody>
${entries.map((entry, i) => `<tr><td>${i + 1}</td><td>${e(entry.name)}<div class="time">${e(entry.time)}</div></td><td>${entry.fields.filter(field => entry.values.get(fieldKey(field)) !== "").map(field => `<div class="answer"><strong>${e(field.label)}：</strong>${e(entry.values.get(fieldKey(field)))}</div>`).join("")}</td><td>${e(entry.attendance)}<div class="time">${e(timestamp(entry.checkedAt))}</div></td><td class="signature"></td></tr>`).join("") || '<tr><td class="empty" colspan="5">目前沒有報名資料</td></tr>'}
</tbody></table></div><script>document.getElementById("print").addEventListener("click",function(){window.print();});</script></body></html>`;
}

// Called only after the existing activity administrator authorization and event lookup.
export async function exportActivityRoster(db, event, format) {
  const rows = await db.prepare(`SELECT r.display_name, r.schema_json, r.answers_json, r.created_at, c.id AS checkin_id, c.checked_at, c.raw_payload AS checkin_payload
    FROM welfare_activity_registrations r LEFT JOIN welfare_activity_checkins c ON c.event_id=r.event_id AND c.line_user_id=r.line_user_id
    WHERE r.event_id = ? ORDER BY r.created_at ASC, r.id ASC LIMIT 10001`).bind(event.id).all();
  if (rows.results.length > 10000) return new Response(JSON.stringify({ success: false, message: "報名名冊超過 10,000 筆，請聯絡管理員分批匯出，未下載不完整名冊。" }), { status: 413, headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store" } });
  const extension = format === 'xlsx' ? 'xlsx' : format === 'csv' ? 'csv' : 'html';
  const filename = (String(event.title).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").slice(0, 70) || "activity") + "-報名簽到表." + extension;
  let body;
  try { body = format === 'xlsx' ? buildActivityRosterXlsx(rows.results) : format === 'csv' ? buildActivityRosterCsv(rows.results) : buildActivityRosterPrint(event, rows.results); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return Response.json({ success: false, message: error.message }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(body, {
    headers: { "Content-Type": format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === "csv" ? "text/csv;charset=UTF-8" : "text/html;charset=UTF-8",
      "Content-Disposition": `attachment; filename="activity-roster.${extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
