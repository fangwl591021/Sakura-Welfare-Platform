// Shared by the private export and the table; filtering always precedes paging.
export function rosterVerifiedTimestamp(value) {
  let raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!raw) return null;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw = raw.replace(' ', 'T') + '+08:00';
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function selectEmployeeRosterRows(rows, { query = '', factory = '', identityType = '', status = '', sortDirection = '' } = {}) {
  query = query.trim().toLocaleLowerCase('zh-TW');
  const matches = rows.filter(row => (!factory || row.factory === factory) && (!identityType || row.identityType === identityType) && (!status || row.status === status) && (!query || [row.employeeNo, row.name, row.departmentCode, row.departmentName, row.businessUnit].some(value => String(value || '').toLocaleLowerCase('zh-TW').includes(query))));
  if (!sortDirection) return matches;
  return matches.map(row => ({ row, epoch: rosterVerifiedTimestamp(row.verifiedAt) })).sort((a, b) => {
    if (a.epoch === null) return b.epoch === null ? 0 : 1;
    if (b.epoch === null) return -1;
    return (a.epoch - b.epoch) * (sortDirection === 'asc' ? 1 : -1);
  }).map(item => item.row);
}
