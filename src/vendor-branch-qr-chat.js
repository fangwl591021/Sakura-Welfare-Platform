import { readEligibleVendorLinks } from './vendor-push-audience.js';
import { readCheckoutBranch } from './branch-redemption-service.js';
import { vendorPublicEligibleSql } from './vendor-contract-policy.js';

const PREFIX = 'action=vendor.branch_qr.';
const PAGE_SIZE = 5;
const UID = /^U[0-9a-f]{32}$/i;
const clean = value => String(value || '').trim();
const text = (value, extra = {}) => ({ type: 'text', text: clean(value) || '—', wrap: true, size: 'sm', color: '#334155', ...extra });
const postback = (label, command) => ({ type: 'button', height: 'sm', style: 'secondary', action: { type: 'postback', label, data: PREFIX + command } });
const link = (label, uri) => ({ type: 'button', height: 'sm', style: 'link', action: { type: 'uri', label, uri } });
const url = (origin, path) => {
  const value = new URL(path, origin);
  if (value.protocol !== 'https:') throw new Error('HTTPS origin required');
  return value.href;
};
const flex = (title, contents, buttons) => ({ type: 'flex', altText: title, contents: {
  type: 'bubble', size: 'mega', body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [text(title, { size: 'lg', weight: 'bold', color: '#0f172a' }), ...contents] },
  footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
} });

export function isVendorBranchQrChatCandidate(item) {
  return clean(item?.postbackData).startsWith(PREFIX) || ['店家QR碼', '廠商儀表板'].includes(clean(item?.text));
}

export function partitionVendorQrForwardPayload(rawBody, verified) {
  const unchanged = { body: rawBody, changed: false, shouldForward: true };
  if (verified !== true) return unchanged;
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return unchanged; }
  if (!Array.isArray(payload?.events)) return unchanged;
  const events = payload.events.filter(event => !isVendorBranchQrChatCandidate({
    postbackData: event?.type === 'postback' ? event?.postback?.data : '',
    text: event?.type === 'message' && event?.message?.type === 'text' ? event.message.text : '',
  }));
  return events.length === payload.events.length ? unchanged : { body: JSON.stringify({ ...payload, events }), changed: true, shouldForward: events.length > 0 };
}

const vendorSuffix = vendorId => vendorId ? '&vendor_id=' + encodeURIComponent(vendorId) : '';
const dashboardButton = vendorId => vendorId
  ? { type: 'button', height: 'sm', style: 'secondary', action: { type: 'postback', label: '返回品牌儀表板', data: 'action=vendor.brand.home&surface=dashboard&vendor_id=' + encodeURIComponent(vendorId) } }
  : postback('返回儀表板', 'home');
export function vendorQrListButton(vendorId = '') { return postback('店家 QR 碼', 'list&page=0' + vendorSuffix(clean(vendorId))); }

// Add an owned-store shortcut without replacing the existing admin/editor card
// or granting the merchant's portal/POS authority to that role.
export async function withVendorQrDashboardButton({ db, item, message }) {
  const uid = clean(item?.LINE_user_id);
  if (item?.activitySignatureVerified !== true || item?.sourceType !== 'user' || !UID.test(uid) || !item?.replyToken ||
      message?.type !== 'flex' || message.contents?.type !== 'bubble') return message;
  try {
    const links = (await readEligibleVendorLinks(db, uid)).get(uid) || [];
    if (!links.length) return message;
    const footer = message.contents.footer || { type: 'box', layout: 'vertical', spacing: 'sm', contents: [] };
    if (!Array.isArray(footer.contents)) return message;
    if (JSON.stringify(footer.contents).includes(PREFIX + 'list')) return message;
    return { ...message, contents: { ...message.contents, footer: { ...footer, contents: [...footer.contents, vendorQrListButton()] } } };
  } catch {
    // The original dashboard remains available if merchant lookup is unavailable.
    return message;
  }
}

export function buildVendorQrHomeMessage({ origin }) {
  return flex('廠商儀表板', [text('選擇自己的分店，顯示 QR 碼讓顧客使用 LINE 掃描。'), text('掃碼只會發起申請，仍需店員登入核銷工作台確認。')], [
    vendorQrListButton(),
    link('新增操作人教學', url(origin, '/vendor-tutorials?topic=operators')),
    link('掃碼核銷教學', url(origin, '/vendor-tutorials?topic=branchQr')),
  ]);
}

export function buildVendorQrListMessage({ origin, branches, page, total, vendorId = '' }) {
  const scope = vendorSuffix(vendorId);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = branches.map(branch => ({ type: 'box', layout: 'vertical', spacing: 'xs', contents: [
    text(branch.vendorName, { size: 'xs', color: '#64748b' }),
    text(branch.branchName, { weight: 'bold' }),
    text(branch.address || '地址未提供', { size: 'xs' }),
    postback('顯示此分店 QR 碼', 'show&location_id=' + encodeURIComponent(branch.locationId) + '&page=' + page + scope),
  ] }));
  const buttons = [];
  if (page > 0) buttons.push(postback('上一頁', 'list&page=' + (page - 1) + scope));
  if (page + 1 < pages) buttons.push(postback('下一頁', 'list&page=' + (page + 1) + scope));
  if (vendorId) buttons.push(postback('全部店家 QR', 'list&page=0'));
  buttons.push(dashboardButton(vendorId), link('掃碼核銷教學', url(origin, '/vendor-tutorials?topic=branchQr')));
  return flex('選擇分店', [text(total ? `共 ${total} 個分店，第 ${page + 1} / ${pages} 頁` : '目前沒有可用分店，請洽福委會確認分店資料及公開狀態。'), ...rows], buttons);
}

export function buildVendorQrMessage({ origin, branch, page = 0, vendorId = '' }) {
  const query = '?location_id=' + encodeURIComponent(branch.locationId);
  const message = flex('店家 QR 碼', [text(branch.vendorName, { weight: 'bold' }), text(branch.branchName, { size: 'lg', weight: 'bold' }), text(branch.address || '地址未提供'),
    { type: 'image', url: url(origin, '/api/branch-redemption/qr.png' + query), size: 'full', aspectRatio: '1:1', aspectMode: 'fit', action: { type: 'uri', label: '放大 QR 碼', uri: url(origin, '/branch-qr' + query) } },
    text('請顧客開啟 LINE 掃描。顧客送出申請後，店員須在核銷工作台確認，才會完成核銷。')], [
    link('放大／下載 QR 碼', url(origin, '/branch-qr' + query)), postback('返回分店列表', 'list&page=' + page + vendorSuffix(vendorId)),
    ...(vendorId ? [postback('全部店家 QR', 'list&page=0')] : []), dashboardButton(vendorId), link('掃碼核銷教學', url(origin, '/vendor-tutorials?topic=branchQr')),
  ]);
  message.altText = `店家 QR 碼｜${branch.vendorName}｜${branch.branchName}`.slice(0, 350);
  return message;
}

function commandFor(item) {
  const data = clean(item.postbackData);
  if (!data) return { action: clean(item.text) === '廠商儀表板' ? 'home' : 'list', page: 0 };
  if (data.length > 300) return null;
  const params = new URLSearchParams(data);
  const action = clean(params.get('action')).replace('vendor.branch_qr.', '');
  const pageValue = params.get('page') || '0';
  if (!['home', 'list', 'show'].includes(action) || !/^\d{1,6}$/.test(pageValue)) return null;
  const id = clean(params.get('location_id')), vendorId = clean(params.get('vendor_id'));
  if (action === 'show' && (!id || id.length > 128 || /[\x00-\x1f]/.test(id))) return null;
  if (vendorId.length > 200 || /[\x00-\x1f]/.test(vendorId) || params.getAll('vendor_id').length > 1) return null;
  return { action, page: Number(pageValue), id, vendorId };
}

// Public QR access only: this projection never grants portal/POS tokens or writes
// vendor sessions. A shared code association cannot read financial summaries.
export async function buildVendorQrChatPlan({ db, item, origin, buildDashboard }) {
  const uid = clean(item?.LINE_user_id);
  if (item?.activitySignatureVerified !== true || item?.sourceType !== 'user' || !UID.test(uid) || !item?.replyToken ||
      !((item.eventType === 'postback' && clean(item.postbackData).startsWith(PREFIX)) || (item.eventType === 'message' && item.messageType === 'text'))) {
    return { handled: true, authorized: false, messages: [] };
  }
  const command = commandFor(item);
  const fail = message => ({ handled: true, authorized: false, messages: [flex('店家 QR 碼', [text(message)], [postback('返回儀表板', 'home')])] });
  if (!command) return fail('此操作已失效，請重新選擇分店。');
  try {
    const links = (await readEligibleVendorLinks(db, uid)).get(uid) || [];
    if (!links.length) return fail('此 LINE 帳號尚未關聯可用店家，或店家已停用／合約到期。請洽福委會確認。');
    if (command.vendorId && !links.some(entry => entry.id === command.vendorId)) return fail('此品牌目前不在您的店家關聯範圍，請重新選擇品牌。');
    if (command.action === 'home') {
      if (buildDashboard) {
        // Preserve the existing direct merchant dashboard authority. Serial-only
        // contacts receive the QR navigation card, never operational statistics.
        const direct = await db.prepare(`SELECT * FROM welfare_vendors v WHERE (trim(v.contact_line_user_id)=? OR trim(v.submitted_by_line_user_id)=?) AND ${vendorPublicEligibleSql('v')} ORDER BY v.id`).bind(uid, uid).all();
        if (direct?.success === false || !Array.isArray(direct?.results)) throw new Error('Vendor dashboard unavailable');
        const vendor = direct.results.find(row => (!command.vendorId || row.id === command.vendorId) && links.some(entry => entry.id === row.id));
        if (vendor) return { handled: true, authorized: true, messages: [await buildDashboard(vendor)] };
      }
      return { handled: true, authorized: true, messages: [buildVendorQrHomeMessage({ origin })] };
    }
    if (command.action === 'show') {
      const branch = await readCheckoutBranch(db, command.id);
      if (!links.some(entry => entry.id === branch.vendorId) || (command.vendorId && command.vendorId !== branch.vendorId)) return fail('此分店目前無法使用，請重新選擇自己的分店。');
      return { handled: true, authorized: true, messages: [buildVendorQrMessage({ origin, branch, page: command.page, vendorId: command.vendorId })] };
    }
    const vendorIds = links.filter(entry => !command.vendorId || entry.id === command.vendorId).map(entry => entry.id);
    const predicate = `l.status='active' AND ${vendorPublicEligibleSql('v')} AND v.id IN (${vendorIds.map(() => '?').join(',')})`;
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM welfare_vendor_locations l JOIN welfare_vendors v ON v.id=l.vendor_id WHERE ${predicate}`).bind(...vendorIds).first();
    if (!count || !Number.isSafeInteger(Number(count.n)) || Number(count.n) < 0) throw new Error('Branch count unavailable');
    const total = Number(count.n), page = Math.min(command.page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
    const rows = await db.prepare(`SELECT l.id AS locationId,l.vendor_id AS vendorId,v.name AS vendorName,l.branch_name AS branchName,l.address FROM welfare_vendor_locations l JOIN welfare_vendors v ON v.id=l.vendor_id WHERE ${predicate} ORDER BY v.name,v.id,l.branch_name,l.id LIMIT ? OFFSET ?`).bind(...vendorIds, PAGE_SIZE, page * PAGE_SIZE).all();
    if (rows?.success === false || !Array.isArray(rows?.results)) throw new Error('Branches unavailable');
    if (total === 1 && rows.results.length === 1) {
      const branch = await readCheckoutBranch(db, rows.results[0].locationId);
      if (!vendorIds.includes(branch.vendorId)) return fail('此分店目前無法使用，請重新選擇自己的分店。');
      return { handled: true, authorized: true, messages: [buildVendorQrMessage({ origin, branch, page: 0, vendorId: command.vendorId })] };
    }
    return { handled: true, authorized: true, messages: [buildVendorQrListMessage({ origin, branches: rows.results.map(row => ({ ...row, branchName: clean(row.branchName) || row.vendorName })), page, total, vendorId: command.vendorId })] };
  } catch {
    return fail('暫時無法取得店家 QR 碼，請稍後重新選擇分店。');
  }
}
