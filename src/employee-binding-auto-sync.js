import {requestWork} from "./request-work.js";
const LEASE = 'employee_binding_auto_sync_lease';
export const AUTO_SYNC_STATUS = 'employee_binding_auto_sync_status';

export class EmployeeBindingAccessError extends Error {
  constructor(conflict = false) {
    super(conflict ? '母站與平台的綁定資料需要確認，請聯絡管理員。' : '暫時無法向母站確認綁定，請重新整理後再試。');
    this.status = conflict ? 409 : 503;
    this.code = conflict ? 'binding_conflict' : 'binding_check_unavailable';
  }
}

// The caller must obtain the UID from LINE token verification, a signed webhook,
// or an authenticated cashier lookup. No global batch lease or negative cache:
// the very next access after mother binding can observe the new record.
export async function ensureEmployeeBindingOnAccess(db, env, lineUserId, pull, options = {}) {
  return requestWork(db,"binding",String(lineUserId)+":"+Boolean(options.preserveHigherIdentity),async()=>{
  if (!/^U[0-9A-Za-z_-]{20,128}$/.test(lineUserId || '')) throw new EmployeeBindingAccessError();
  const read = () => db.prepare('SELECT member_type,status,bind_status,employee_no FROM welfare_members WHERE line_user_id=?').bind(lineUserId).first();
  const bound = row => row?.status === 'active' && row.bind_status === 'bound' && ['employee','foreign_employee','manager'].includes(row.member_type);
  try {
    if (options.preserveHigherIdentity) {
      const higher = await db.prepare(`SELECT 1 AS found FROM admin_uid_whitelist WHERE line_user_id=? AND active=1
        UNION SELECT 1 AS found FROM welfare_vendors WHERE (contact_line_user_id=? OR submitted_by_line_user_id=?) LIMIT 1`)
        .bind(lineUserId,lineUserId,lineUserId).first();
      if (higher) return { state: 'other_identity' };
    }
    const before = await read();
    if (before && before.status !== 'active') return { state: 'restricted' };
    if (bound(before)) return { state: 'bound' };
    const result = await pull(new Request('https://internal/employee-binding-on-access', { method: 'POST', body: '{}' }), db, env,
      { ...options, automatic: true, targetLineUserId: lineUserId });
    // Identity persistence determines eligibility; a menu failure must not deny
    // an employee whose authoritative binding was already stored.
    const after = await read();
    if (after && after.status !== 'active') return { state: 'restricted' };
    if (bound(after)) return { state: 'bound' };
    if (result.accessConflict) throw new EmployeeBindingAccessError(true);
    if (result.success === false || result.failed) throw new EmployeeBindingAccessError();
    return { state: 'unbound' };
  } catch (error) {
    if (error instanceof EmployeeBindingAccessError) throw error;
    throw new EmployeeBindingAccessError();
  }
  });
}

export function planAutomaticMotherRows(rows, knownUsers) {
  const byUid = new Map(), byCode = new Map();
  for (const row of rows) {
    const uid = String(row.motherLineId || '').trim(), code = String(row.employeeNo || '').trim();
    if (!/^U[0-9A-Za-z_-]{20,128}$/.test(uid) || !code) continue;
    if (!byUid.has(uid)) byUid.set(uid, new Set());
    if (!byCode.has(code)) byCode.set(code, new Set());
    byUid.get(uid).add(code); byCode.get(code).add(uid);
  }
  const used = new Set();
  return rows.filter(row => {
    const uid = String(row.motherLineId || '').trim(), code = String(row.employeeNo || '').trim();
    const time = String(row.reportedAt || '').replace(' ', 'T');
    if (!knownUsers.has(uid) || byUid.get(uid)?.size !== 1 || byCode.get(code)?.size !== 1 || used.has(uid)) return false;
    if (!time || !Number.isFinite(Date.parse(time + (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(time) ? '' : '+08:00')))) return false;
    used.add(uid); return true;
  });
}

export async function readEmployeeAutoSyncStatus(db) {
  try {
    const row = await db.prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?').bind(AUTO_SYNC_STATUS).first();
    return JSON.parse(row?.setting_value || 'null');
  } catch { return null; }
}

// Call the existing roster synchronization pipeline. Only its internal automatic
// mode may select known users by a mother-confirmed LINE UID and report time.
export async function runEmployeeAutoSync(db, env, pull, now = Date.now()) {
  if (!db) return { success: false, state: 'unavailable' };
  await db.prepare("INSERT OR IGNORE INTO system_settings (setting_key,setting_value,updated_at) VALUES (?, '0', '')").bind(LEASE).run();
  const lease = String(now + 120000);
  const claimed = await db.prepare('UPDATE system_settings SET setting_value = ? WHERE setting_key = ? AND CAST(setting_value AS INTEGER) < ?').bind(lease, LEASE, now).run();
  if (!claimed.meta?.changes) return { success: true, state: 'busy' };
  try {
    const previous = await readEmployeeAutoSyncStatus(db);
    if (previous && now - Date.parse(previous.checkedAt) < 45000) return { ...previous, state: 'recent' };
    let result;
    try {
      const response = await pull(new Request('https://internal/employee-binding-auto-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      }), db, env, { automatic: true });
      const ok = response.success !== false && !response.failed;
      result = { success: ok, state: ok ? 'synced' : 'error',
        checkedAt: new Date(now).toISOString(), scanned: response.motherRosterScanned || 0,
        bound: response.bound || 0, menuApplied: response.menuApplied || 0, failed: response.failed || 0 };
    } catch {
      // Persist no roster, birthday, credential, upstream body, or internal error.
      result = { success: false, state: 'error', checkedAt: new Date(now).toISOString() };
    }
    await db.prepare(`INSERT INTO system_settings (setting_key,setting_value,updated_at) VALUES (?,?,?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at`)
      .bind(AUTO_SYNC_STATUS, JSON.stringify(result), result.checkedAt).run();
    return result;
  } finally {
    await db.prepare("UPDATE system_settings SET setting_value='0' WHERE setting_key=? AND setting_value=?").bind(LEASE, lease).run();
  }
}

export async function authorizeEmployeeAutoSync(request, db, env, deps) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (token) {
    const auth = await deps.requireAdmin({ sessionToken: token }, db);
    if (auth?.ok && auth.user?.role === 'admin') return true;
  }
  const idToken = request.headers.get('X-Line-Id-Token');
  if (!idToken) return false;
  const identity = await deps.verifyLine(env, idToken);
  if (!identity?.lineUserId) return false;
  const admin = await deps.findAdmin(db, identity.lineUserId);
  if (!admin || Number(admin.active) !== 1 || ['viewer', 'readonly'].includes(admin.role)) return false;
  const modules = (String(admin.allowed_modules || '').trim() || '*').split(',').map(v => v.trim());
  return modules.some(v => ['*', 'visitors', 'employees'].includes(v));
}
