import { buildRosterWorkbook } from './activity-roster-xlsx.js';
import { selectEmployeeRosterRows, rosterVerifiedTimestamp } from './employee-roster-view.js';

const EMPLOYEE_MEMBER_TYPES = new Set(['employee', 'foreign_employee', 'manager']);
const LINE_USER_ID_PATTERN = /^U[0-9a-fA-F]{32}$/;

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function isValidVerifiedAt(value) {
  const timestamp = text(value);
  const parts = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):?(\d{2}))?$/);
  if (!parts) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHour, offsetMinute] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return false;
  if (Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return true;
}

function incrementCount(counts, key) {
  if (key) counts.set(key, (counts.get(key) || 0) + 1);
}

/** Read-only projection of the child site's last confirmed binding records. */
export function buildEmployeeRosterProjection(rosterRows, memberRows) {
  if (!Array.isArray(rosterRows) || !Array.isArray(memberRows)) {
    throw new TypeError('Employee roster projection requires row arrays.');
  }

  const rosterEmployeeCounts = new Map();
  const membersByEmployee = new Map();
  const memberUidCounts = new Map();
  for (const row of rosterRows) incrementCount(rosterEmployeeCounts, text(row?.employee_no));
  for (const member of memberRows) {
    const employeeNo = text(member?.employee_no);
    const uid = text(member?.line_user_id);
    if (employeeNo) {
      const matches = membersByEmployee.get(employeeNo) || [];
      matches.push(member);
      membersByEmployee.set(employeeNo, matches);
    }
    incrementCount(memberUidCounts, uid);
  }

  const summary = { total: rosterRows.length, bound: 0, unbound: 0, review: 0 };
  const rows = rosterRows.map(roster => {
    const employeeNo = text(roster?.employee_no);
    const matches = membersByEmployee.get(employeeNo) || [];
    const member = matches.length === 1 ? matches[0] : null;
    const uid = text(member?.line_user_id);
    let status = 'review';
    let reason;
    let verifiedAt = '';

    if (!employeeNo) reason = '名冊缺少工號';
    else if (rosterEmployeeCounts.get(employeeNo) !== 1) reason = '名冊工號重複';
    else if (matches.length === 0) {
      status = 'unbound';
      reason = '子站尚無紀錄';
    } else if (matches.length !== 1) reason = '子站工號對應多筆會員紀錄';
    else if (!LINE_USER_ID_PATTERN.test(uid)) reason = '子站 LINE 綁定資料不完整';
    else if (memberUidCounts.get(uid) !== 1) reason = '子站 LINE 綁定對應多筆會員紀錄';
    else if (text(member.status) !== 'active') reason = '子站會員未啟用';
    else if (text(member.bind_status) !== 'bound') reason = '子站尚未確認綁定';
    else if (!EMPLOYEE_MEMBER_TYPES.has(text(member.member_type))) reason = '子站會員身分尚待確認';
    else if (!isValidVerifiedAt(member.verified_at)) reason = '子站缺少有效綁定確認時間';
    else {
      status = 'bound';
      reason = '子站已有有效綁定紀錄';
      verifiedAt = text(member.verified_at);
    }

    summary[status] += 1;
    const rawSourceRow = roster?.source_row;
    const sourceRow = typeof rawSourceRow === 'number' && Number.isSafeInteger(rawSourceRow) && rawSourceRow >= 0 ? rawSourceRow : null;
    return {
      employeeNo,
      name: text(roster?.employee_name),
      factory: text(roster?.factory),
      businessUnit: text(roster?.business_unit),
      departmentCode: text(roster?.department_code),
      departmentName: text(roster?.department_name),
      identityType: text(roster?.identity_type),
      sourceRow,
      status,
      statusLabel: status === 'bound' ? '已綁定' : status === 'unbound' ? '未綁定' : '待確認',
      reason,
      verifiedAt
    };
  });
  return { success: true, source: 'child-site', summary, rows };
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store', ...extraHeaders } });
}

function readResults(result) {
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('Employee roster read failed.');
  return result.results;
}

// Authentication and CRM module permission checks belong to the calling route.
// This handler never ensures schemas, synchronizes bindings or writes records.
export async function handleEmployeeRosterGet(request, db) {
  if (request?.method !== 'GET') {
    return jsonResponse({ success: false, message: '此介面只接受讀取請求。' }, 405, { Allow: 'GET' });
  }
  if (!db || typeof db.prepare !== 'function') {
    return jsonResponse({ success: false, message: '員工名冊暫時無法讀取。' }, 503);
  }
  try {
    const rosterRows = readResults(await db.prepare(`
      SELECT employee_no, employee_name, factory, business_unit,
             department_code, department_name, identity_type, source_row
      FROM employee_roster
      ORDER BY source_row ASC, employee_no ASC
    `).all());
    const memberRows = readResults(await db.prepare(`
      SELECT employee_no, line_user_id, member_type, status, bind_status, verified_at
      FROM welfare_members
    `).all());
    const projection = buildEmployeeRosterProjection(rosterRows, memberRows);
    const params = new URL(request.url).searchParams;
    if (params.get('format') !== 'xlsx') return jsonResponse(projection);
    const filters = { query: params.get('query') || '', factory: params.get('factory') || '', identityType: params.get('identityType') || '', status: params.get('status') || '', sortDirection: params.get('sort') || '' };
    if (!['', 'bound', 'unbound', 'review'].includes(filters.status) || !['', 'asc', 'desc'].includes(filters.sortDirection)) return jsonResponse({ success: false, message: '匯出條件無效，請重新選擇篩選與排序。' }, 400);
    const rows = selectEmployeeRosterRows(projection.rows, filters);
    const workbook = buildRosterWorkbook(
      ['工號', '姓名', '廠別', '處別', '部門', '身分類別', '子站綁定', '最後確認（臺北）', '說明'],
      rows.map(row => {
        const epoch = rosterVerifiedTimestamp(row.verifiedAt);
        const time = epoch === null ? '' : { number: epoch / 86400000 + 25569 + 8 / 24, date: true };
        return [row.employeeNo, row.name, row.factory, row.businessUnit, [row.departmentCode, row.departmentName].filter(Boolean).join(' '), row.identityType, row.statusLabel, time, row.reason];
      }),
      { sheetName: '員工名冊', columnWidths: [16, 18, 18, 26, 40, 18, 16, 24, 42] }
    );
    const stamp = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
    return new Response(workbook, { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="employee-roster-' + stamp + '.xlsx"',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Roster-Count': String(rows.length),
    } });
  } catch (error) {
    if (error instanceof RangeError) return jsonResponse({ success: false, message: error.message }, 422);
    const message = typeof error?.message === 'string' ? error.message : '';
    const missingTable = /no such table\s*:/i.test(message);
    return jsonResponse({
      success: false,
      message: missingTable ? '員工名冊尚未準備完成。' : '讀取員工名冊失敗，請稍後再試。'
    }, missingTable ? 503 : 500);
  }
}
