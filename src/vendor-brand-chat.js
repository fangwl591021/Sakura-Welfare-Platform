import { readManageableVendorBrands, readManageableVendorBrand, readSelectedManagedVendor, selectManagedVendorBrand } from './vendor-brand-access.js';

const PREFIX = 'action=vendor.brand.';
const PAGE_SIZE = 5;
const UID = /^U[0-9a-f]{32}$/i;
const clean = value => typeof value === 'string' ? value.trim() : '';
const defaultAccess = { list: readManageableVendorBrands, get: readManageableVendorBrand, selected: readSelectedManagedVendor, select: selectManagedVendorBrand };
const surfaceFor = value => value === 'portal' ? 'portal' : 'dashboard';
const text = (value, extra = {}) => ({ type: 'text', text: clean(value) || '—', wrap: true, size: 'sm', color: '#334155', ...extra });
const button = (label, command) => {
  const data = PREFIX + command;
  if (data.length > 300) throw new Error('Brand action too long');
  return { type: 'button', height: 'sm', style: 'secondary', action: { type: 'postback', label, data } };
};
const messageButton = (label, value) => ({ type: 'button', height: 'sm', style: 'secondary', action: { type: 'message', label, text: value } });
const flex = (title, contents, buttons) => ({ type: 'flex', altText: title, contents: {
  type: 'bubble', size: 'mega', body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [text(title, { size: 'lg', weight: 'bold', color: '#0f172a' }), ...contents] },
  footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
} });
const verifiedPrivate = item => item?.activitySignatureVerified === true && item?.sourceType === 'user' && UID.test(clean(item?.LINE_user_id)) && Boolean(item?.replyToken);

// Only the new explicit postbacks are exclusive child-owned commands. Existing
// dashboard/portal keywords retain the original routing and forwarding policy.
export function isVendorBrandChatCandidate(item) {
  return clean(item?.postbackData).startsWith(PREFIX);
}

export function partitionVendorBrandForwardPayload(rawBody, verified) {
  const unchanged = { body: rawBody, changed: false, shouldForward: true };
  if (verified !== true) return unchanged;
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return unchanged; }
  if (!Array.isArray(payload?.events)) return unchanged;
  const events = payload.events.filter(event => !(event?.type === 'postback' && event?.source?.type === 'user' && UID.test(clean(event.source.userId)) && isVendorBrandChatCandidate({ postbackData: event.postback?.data })));
  return events.length === payload.events.length ? unchanged : { body: JSON.stringify({ ...payload, events }), changed: true, shouldForward: events.length > 0 };
}

export function vendorBrandSwitchButton(surface = 'dashboard') {
  return button('切換品牌', 'list&surface=' + surfaceFor(surface) + '&page=0');
}

function appendSwitch(message, surface) {
  if (message?.type !== 'flex') return message;
  const contents = message.contents;
  const bubble = contents?.type === 'bubble' ? contents : contents?.type === 'carousel' && contents.contents?.[0]?.type === 'bubble' ? contents.contents[0] : null;
  if (!bubble) return message;
  const footer = bubble.footer || { type: 'box', layout: 'vertical', spacing: 'sm', contents: [] };
  if (!Array.isArray(footer.contents) || JSON.stringify(footer.contents).includes(PREFIX + 'list')) return message;
  const next = { ...bubble, footer: { ...footer, contents: [...footer.contents, vendorBrandSwitchButton(surface)] } };
  return { ...message, contents: contents.type === 'bubble' ? next : { ...contents, contents: [next, ...contents.contents.slice(1)] } };
}

// A vendor-specific dashboard keeps its QR shortcut on that vendor. The QR
// handler independently rechecks association; this parameter grants no access.
export function scopeVendorBrandQrButtons(message, vendorId) {
  const id = clean(vendorId);
  if (!id || id.length > 200) return message;
  function visit(node) {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    const copy = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, visit(value)]));
    if (copy.type === 'postback' && typeof copy.data === 'string') {
      const params = new URLSearchParams(copy.data);
      if (params.get('action') === 'vendor.branch_qr.list') {
        params.set('vendor_id', id);
        const data = params.toString();
        if (data.length <= 300) copy.data = data;
      }
    }
    return copy;
  }
  return visit(message);
}

// Admin/editor cards stay intact. A UID whitelist role alone never creates a
// vendor shortcut; only two or more currently manageable brands add a switch.
export async function withVendorBrandSwitchButton({ db, item, message, surface = 'dashboard', access = defaultAccess }) {
  if (!verifiedPrivate(item)) return message;
  try {
    const brands = await access.list(db, clean(item.LINE_user_id));
    return Array.isArray(brands) && brands.length > 1 ? appendSwitch(message, surface) : message;
  } catch { return message; }
}

function commandFor(item) {
  if (item.eventType === 'postback') {
    const raw = clean(item.postbackData);
    if (!raw.startsWith(PREFIX) || raw.length > 300) return null;
    const params = new URLSearchParams(raw);
    for (const key of params.keys()) if (!['action', 'surface', 'page', 'vendor_id'].includes(key) || params.getAll(key).length !== 1) return null;
    const action = params.get('action')?.slice('vendor.brand.'.length);
    const surface = params.get('surface') || 'dashboard', page = params.get('page') || '0', vendorId = clean(params.get('vendor_id'));
    if (!['list', 'select', 'home'].includes(action) || !['dashboard', 'portal'].includes(surface) || !/^\d{1,6}$/.test(page)) return null;
    if (vendorId.length > 200 || /[\x00-\x1f]/.test(vendorId) || (action === 'select' && !vendorId)) return null;
    return { action, surface, page: Number(page), vendorId };
  }
  if (item.eventType !== 'message' || item.messageType !== 'text') return null;
  const value = clean(item.text);
  if (['儀表板', '仪表板', '廠商儀表板'].includes(value)) return { action: 'entry', surface: 'dashboard', page: 0, vendorId: '' };
  if (['廠商專區', '厂商专区', '店家專區', '特約店家專區'].includes(value)) return { action: 'entry', surface: 'portal', page: 0, vendorId: '' };
  return null;
}

function listMessage(brands, command) {
  const pages = Math.max(1, Math.ceil(brands.length / PAGE_SIZE)), page = Math.min(command.page, pages - 1), suffix = '&surface=' + command.surface;
  const rows = brands.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(vendor => ({ type: 'box', layout: 'vertical', spacing: 'xs', contents: [
    text(vendor.name, { weight: 'bold' }), button('管理此品牌', 'select&vendor_id=' + encodeURIComponent(vendor.id) + suffix),
  ] }));
  const buttons = [];
  if (page > 0) buttons.push(button('上一頁', 'list' + suffix + '&page=' + (page - 1)));
  if (page + 1 < pages) buttons.push(button('下一頁', 'list' + suffix + '&page=' + (page + 1)));
  buttons.push(messageButton('返回儀表板', '儀表板'));
  return flex('選擇管理品牌', [text(`共 ${brands.length} 個品牌，第 ${page + 1} / ${pages} 頁`), ...rows], buttons);
}

// No LINE send or credential creation here. The existing dispatcher owns the
// reply token and supplies the existing dashboard/portal builders.
export async function buildVendorBrandChatPlan({ db, item, buildDashboard, buildPortal, access = defaultAccess }) {
  const exclusive = isVendorBrandChatCandidate(item);
  if (!verifiedPrivate(item)) return { handled: exclusive, authorized: false, messages: [] };
  const command = commandFor(item);
  const failure = value => ({ handled: true, authorized: false, messages: [flex('品牌管理', [text(value)], [vendorBrandSwitchButton(command?.surface), messageButton('返回儀表板', '儀表板')])] });
  if (!command) return exclusive ? failure('此操作已失效，請重新選擇品牌。') : { handled: false, authorized: false, messages: [] };
  const uid = clean(item.LINE_user_id);
  try {
    const brands = await access.list(db, uid);
    if (!Array.isArray(brands)) throw new Error('Brand list unavailable');
    if (!brands.length) return command.action === 'entry' ? { handled: false, authorized: false, messages: [] } : failure('目前沒有可管理的品牌，請洽福委會確認管理權限。');
    if (command.action === 'list') return { handled: true, authorized: true, messages: [listMessage(brands, command)] };
    let vendor;
    if (command.vendorId) {
      if (!brands.some(row => row.id === command.vendorId)) return failure('此品牌目前不在您的管理範圍，請重新選擇品牌。');
      vendor = command.action === 'select' ? await access.select(db, uid, command.vendorId) : await access.get(db, uid, command.vendorId);
    } else if (brands.length === 1) vendor = await access.get(db, uid, brands[0].id);
    else vendor = await access.selected(db, uid);
    if (!vendor) return command.vendorId ? failure('此品牌的管理權限已變更，請重新選擇品牌。') : { handled: true, authorized: true, messages: [listMessage(brands, command)] };
    if (!brands.some(row => row.id === vendor.id)) return failure('此品牌目前不在您的管理範圍，請重新選擇品牌。');
    const builder = command.surface === 'portal' ? buildPortal : buildDashboard;
    if (typeof builder !== 'function') throw new Error('Brand card builder unavailable');
    let message = scopeVendorBrandQrButtons(await builder(vendor, item), vendor.id);
    if (!message?.type) throw new Error('Brand card unavailable');
    if (brands.length > 1) message = appendSwitch(message, command.surface);
    return { handled: true, authorized: true, vendorId: vendor.id, surface: command.surface, messages: [message] };
  } catch { return failure('品牌管理暫時無法開啟，請稍後重新選擇品牌。'); }
}
