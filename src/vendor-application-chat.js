const LINE_UID = /^U[0-9a-f]{32}$/i;
const APPLICATION_STATUSES = new Set(['pending', 'rejected', 'needs_supplement', 'suspended']);

function text(value, limit = 2000) {
  return (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '').slice(0, limit);
}

// This is a candidate check only; verified notification identity is required separately.
export function isPrivateVendorApplicationCandidate(vendor, item) {
  const uid = text(item?.LINE_user_id, 64);
  const sourceType = text(item?.source?.type || item?.sourceType, 20);
  if (!LINE_UID.test(uid) || !vendor?.id || Number(vendor.is_hidden || 0) !== 0) return false;
  if (item?.sourceGroupId || item?.sourceRoomId || (sourceType && sourceType !== 'user')) return false;
  if (!APPLICATION_STATUSES.has(text(vendor.status, 40))) return false;
  return [vendor.submitted_by_line_user_id, vendor.contact_line_user_id].some(value => text(value, 64) === uid);
}

export function buildVendorApplicationStatusFlex(vendor, origin) {
  const status = text(vendor?.status, 40);
  const statusLabel = {pending: '待審核', rejected: '未通過審核', needs_supplement: '需補件', suspended: '已停用'}[status];
  if (!statusLabel) throw new TypeError('Unsupported vendor application status.');
  const supplement = vendor?.supplement || {};
  const needsSupplement = status === 'needs_supplement';
  const contents = [
    {type: 'text', text: '廠商申請進度', weight: 'bold', size: 'lg', wrap: true},
    {type: 'text', text: text(vendor.name, 120) || '廠商申請', color: '#334155', size: 'sm', wrap: true},
    {type: 'text', text: '申請狀態：' + statusLabel, color: needsSupplement ? '#b45309' : '#475569', weight: 'bold', size: 'md', wrap: true},
  ];
  if (needsSupplement) {
    const items = Array.isArray(supplement.items) ? supplement.items : Array.isArray(vendor.supplement_items) ? vendor.supplement_items : [];
    const requested = [...new Set(items.map(value => text(value, 150)).filter(Boolean))].slice(0, 20);
    if (requested.length) {
      contents.push({type: 'text', text: '補件項目', weight: 'bold', size: 'sm', wrap: true});
      for (const value of requested) contents.push({type: 'text', text: '• ' + value, size: 'sm', wrap: true});
    }
    const reason = text(supplement.note || vendor.review_note, 1800);
    if (reason) contents.push({type: 'text', text: '補件原因：' + reason, size: 'sm', wrap: true});
    contents.push({type: 'text', text: '請使用店家帳號與密碼登入，完成補件後重新送審。', size: 'sm', color: '#475569', wrap: true});
  } else if (status === 'pending') {
    contents.push({type: 'text', text: '申請已送出，等待福委會審核。', size: 'sm', color: '#475569', wrap: true});
  } else {
    const reason = text(vendor.review_note, 1800);
    if (reason) contents.push({type: 'text', text: '審核說明：' + reason, size: 'sm', wrap: true});
  }
  const login = new URL('/vendor-login?next=supplement', origin);
  return {
    type: 'flex', altText: '廠商申請狀態：' + statusLabel,
    contents: {
      type: 'bubble', size: 'mega',
      body: {type: 'box', layout: 'vertical', spacing: 'md', contents},
      footer: {type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        {type: 'button', style: 'primary', color: '#06c755', action: {type: 'uri', label: needsSupplement ? '登入補件' : '登入查看申請', uri: login.href}},
      ]},
    },
  };
}
