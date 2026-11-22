// Shared read-time contract policy. Expiry is evaluated in Asia/Taipei and
// remains inclusive of the contract's stated final calendar day.
const taipeiDay = now => {
  const time = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(time)) return '';
  try { return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
  catch { return ''; }
};

function validIsoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Empty contract end means legacy/unspecified and preserves existing behavior.
// An invalid nonempty date is not evidence of a current contract.
export function isVendorContractCurrent(vendor, now = Date.now()) {
  if (!vendor || String(vendor.contract_terminated_at || '').trim()) return false;
  const today = taipeiDay(now);
  if (!today) return false;
  const end = String(vendor.contract_end || '').trim();
  return !end || (validIsoDay(end) && end >= today);
}

export function isVendorPublicEligible(vendor, now = Date.now()) {
  return Boolean(vendor && ['approved', 'active'].includes(String(vendor.status || '').trim()) &&
    Number(vendor.is_hidden || 0) === 0 && isVendorContractCurrent(vendor, now));
}

// SQL counterpart for public directory queries. Alias is a developer-supplied
// identifier, never request data. date(julianday()) rejects invalid dates such
// as February 30 by round-tripping rather than silently rolling them forward.
export function vendorContractCurrentSql(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias || '')) throw new Error('Invalid vendor table alias');
  const end = `TRIM(COALESCE(${alias}.contract_end,''))`;
  return `(TRIM(COALESCE(${alias}.contract_terminated_at,''))=''
    AND (${end}='' OR (${end} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND substr(${end},1,4)<>'0000' AND date(julianday(${end}))=${end}
      AND ${end}>=date('now','+8 hours'))))`;
}

export function vendorPublicEligibleSql(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias || '')) throw new Error('Invalid vendor table alias');
  return `(COALESCE(${alias}.status,'') IN ('approved','active') AND COALESCE(${alias}.is_hidden,0)=0 AND ${vendorContractCurrentSql(alias)})`;
}
