const EMPLOYEE_TYPES = new Set(['employee', 'foreign_employee', 'manager']);
const COLUMNS = new Map([
  ['部門名稱', 'department_name'], ['部門', 'department_name'], ['所屬部門', 'department_name'],
  ['員工姓名', 'employee_name'], ['員工名稱', 'employee_name'],
  ['工號', 'employee_no'], ['員工工號', 'employee_no'], ['員工編號', 'employee_no'],
  ['員工代號', 'employee_no'], ['員編', 'employee_no']
]);

// Match canonical form labels, never translated labels, LINE nicknames or
// substring matches such as companion/emergency-contact names.
export function activityRosterFieldColumn(field) {
  if (!field || !['text', 'textarea'].includes(field.type) || typeof field.label !== 'string') return null;
  const label = field.label.normalize('NFKC').replace(/\s+/gu, '').replace(/(?:\*|\(必填\)|:)+$/gu, '');
  return COLUMNS.get(label) || null;
}

// The caller supplies a member selected by its verified LINE identity. This
// display lookup neither creates a member nor changes binding or entitlement.
export async function readActivityRosterPrefill(db, member, schema) {
  const fields = (schema?.fields || []).filter(field => activityRosterFieldColumn(field));
  if (!fields.length || member?.status !== 'active' || member?.bind_status !== 'bound'
    || !EMPLOYEE_TYPES.has(member?.member_type) || typeof member?.employee_no !== 'string'
    || typeof member?.line_user_id !== 'string' || !member.line_user_id) return {};
  const employeeNo = member.employee_no.trim();
  if (!employeeNo || employeeNo.length > 100) return {};
  let result;
  try {
    result = await db.prepare(`SELECT employee_no, employee_name, department_name
      FROM employee_roster WHERE trim(employee_no) = ?
      AND EXISTS(SELECT 1 FROM welfare_members m WHERE m.line_user_id = ? AND trim(m.employee_no) = ?
        AND m.status = 'active' AND m.bind_status = 'bound'
        AND m.member_type IN ('employee','foreign_employee','manager'))
      AND (SELECT COUNT(*) FROM welfare_members WHERE trim(employee_no) = ?) = 1
      LIMIT 2`).bind(employeeNo, member.line_user_id, employeeNo, employeeNo).all();
  } catch (error) {
    // Legacy installations retain their original manual form; no implicit DDL.
    if (/no such table:\s*(?:main\.)?employee_roster\b/i.test(String(error?.message || ''))) return {};
    throw error;
  }
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('Roster lookup unavailable');
  if (result.results.length !== 1) return {};
  const row = result.results[0];
  return Object.fromEntries(fields.flatMap(field => {
    const value = row[activityRosterFieldColumn(field)];
    return typeof value === 'string' && value.trim() && value.trim().length <= 300
      ? [[field.id, value.trim()]] : [];
  }));
}

export function applyActivityRosterPrefill(answers, prefill) {
  // Preserve the existing validator's rejection of malformed answer containers.
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return answers;
  return { ...answers, ...prefill };
}
