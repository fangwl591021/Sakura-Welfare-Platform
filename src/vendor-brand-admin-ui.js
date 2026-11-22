// The controller is independent of the DOM so confirmation and uncertain-result
// rules can be exercised without touching LINE or production vendor data.
export function createVendorBrandAdminController({ api, persist = () => {}, restored = null, onChange = () => {} }) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const sorted = values => [...new Set(values.map(String))].sort();
  const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
  const validAttempt = value => Boolean(value && /^U[0-9a-f]{32}$/i.test(value.lineUserId || '') && /^[0-9a-f-]{36}$/i.test(value.operationId || '') && /^[0-9a-f]{64}$/i.test(value.revision || '') && Array.isArray(value.vendorIds) && value.vendorIds.length && value.vendorIds.every(id => typeof id === 'string' && id));
  const state = { stage: restored ? 'uncertain' : 'select', busy: false, users: [], truncated: false, user: null, catalog: [], catalogLoaded: false, brands: [], selectedIds: [], preview: null, pending: validAttempt(restored) ? clone(restored) : null, receipt: null, message: restored ? (validAttempt(restored) ? '上次操作結果尚未確認，請先查詢原操作；不會重新送出授權。' : '上次保存的操作資料無法讀取。請先聯絡管理員核對紀錄，勿重新授權。') : '', reloadRequired: false };
  const emit = () => onChange(clone(state));
  const editable = () => !state.busy && !state.pending && !['done', 'uncertain'].includes(state.stage);
  const failure = error => error?.message || '無法讀取資料，請稍後重試。';
  function clearPreview() { state.preview = null; state.stage = 'select'; }
  function verifyReceipt(receipt, attempt) {
    if (!receipt || receipt.operationId !== attempt.operationId || receipt.revision !== attempt.revision || receipt.lineUserId !== attempt.lineUserId || !Array.isArray(receipt.vendorIds) || !same(receipt.vendorIds, attempt.vendorIds)) throw new Error('原操作結果無法核對，請保留操作編號並聯絡管理員。');
    return receipt;
  }
  function completed(receipt) {
    state.receipt = verifyReceipt(receipt, state.pending);
    persist(null); state.pending = null; state.preview = null; state.stage = 'done';
    state.message = '已完成所選品牌的綁定與管理授權；其他品牌關聯保持原樣。';
  }
  async function read(task) {
    if (state.busy) return;
    state.busy = true; state.message = '正在讀取…'; emit();
    try { await task(); } catch (error) { state.message = failure(error); }
    finally { state.busy = false; emit(); }
  }
  async function loadCatalog(existingRows, force = false) {
    if (!editable() || state.user || (state.catalogLoaded && !force)) return;
    await read(async () => {
      state.catalog = clone(Array.isArray(existingRows) ? existingRows : await api('catalog', {}));
      state.brands = clone(state.catalog); state.catalogLoaded = true;
      state.selectedIds = state.selectedIds.filter(id => state.brands.some(brand => brand.id === id));
      state.message = '';
    });
  }
  function clearUser() {
    state.user = null;
    state.brands = state.catalogLoaded ? clone(state.catalog) : state.brands.map(({ id, name, status }) => ({ id, name, status }));
  }
  return {
    snapshot: () => clone(state),
    loadCatalog,
    async search(query) {
      if (!editable()) return;
      const value = String(query || '').trim();
      clearPreview(); clearUser(); state.users = []; state.truncated = false; state.reloadRequired = false;
      if (!value) { state.message = '請輸入 LINE 名稱或完整 LINE User ID。'; emit(); return; }
      await read(async () => {
        const result = await api('search', { query: value });
        state.users = (result.users || []).filter(item => /^U[0-9a-f]{32}$/i.test(item.lineUserId || ''));
        state.truncated = result.truncated === true;
        state.message = state.users.length ? '請核對 LINE 名稱與完整 User ID，再選擇一位用戶。' : '找不到符合的 LINE 用戶。請對方先加入福委會官方帳號並傳送一則訊息，再重新搜尋；不能只輸入姓名建立關聯。';
      });
    },
    async selectUser(lineUserId) {
      if (!editable()) return;
      const matches = state.users.filter(item => item.lineUserId === lineUserId);
      if (matches.length !== 1) { state.message = '請從搜尋結果選擇唯一的 LINE 用戶。'; emit(); return; }
      const selectedIds = [...state.selectedIds];
      clearPreview(); clearUser(); state.reloadRequired = false;
      await read(async () => {
        const data = await api('options', { lineUserId });
        if (data.lineUserId !== lineUserId) throw new Error('用戶資料不一致，請重新搜尋。');
        state.user = { lineUserId, lineDisplayName: data.lineDisplayName || '' };
        state.brands = data.brands || [];
        state.selectedIds = selectedIds.filter(id => state.brands.some(brand => brand.id === id));
        const removed = selectedIds.length - state.selectedIds.length;
        state.message = removed ? `已選擇管理人；${removed} 個品牌目前不可授權，已取消勾選。請核對剩餘品牌後預覽。` : '已選擇管理人，原先勾選的品牌已保留。請核對品牌後按「預覽綁定與管理授權」。';
      });
    },
    async reload() {
      if (!editable()) return;
      if (!state.user) return loadCatalog(null, true);
      const uid = state.user.lineUserId;
      clearPreview(); state.selectedIds = []; state.reloadRequired = true;
      await read(async () => {
        const data = await api('options', { lineUserId: uid });
        if (data.lineUserId !== uid) throw new Error('用戶資料不一致，請重新搜尋。');
        state.user = { lineUserId: uid, lineDisplayName: data.lineDisplayName || '' }; state.brands = data.brands || []; state.reloadRequired = false;
        state.message = '已重新載入目前關聯，請重新勾選並預覽。';
      });
    },
    toggle(vendorId, checked) {
      if (!editable() || state.reloadRequired || !state.brands.some(item => item.id === vendorId)) return;
      clearPreview(); state.selectedIds = checked ? sorted([...state.selectedIds, vendorId]) : state.selectedIds.filter(id => id !== vendorId);
      state.message = `已選 ${state.selectedIds.length} 個品牌；未選的既有關聯保持原樣。`; emit();
    },
    edit() { if (editable()) { clearPreview(); state.message = '可調整選擇後重新預覽，尚未寫入資料。'; emit(); } },
    async preview() {
      if (!editable() || !state.user || !state.selectedIds.length || state.reloadRequired) return;
      const lineUserId = state.user.lineUserId, vendorIds = sorted(state.selectedIds);
      clearPreview();
      await read(async () => {
        const data = await api('preview', { lineUserId, vendorIds });
        if (!validAttempt(data) || data.lineUserId !== lineUserId || !same(data.vendorIds, vendorIds) || !Array.isArray(data.brands) || !same(data.brands.map(item => item.id), vendorIds)) throw new Error('預覽對象不一致，請重新載入後再選擇。');
        state.preview = clone(data); state.stage = 'preview'; state.message = '請核對以下唯一用戶與品牌清單，確認後才會寫入。';
      });
    },
    async confirm(acknowledged) {
      if (!editable() || state.stage !== 'preview' || !state.preview || acknowledged !== true) return;
      const preview = state.preview;
      const attempt = { lineUserId: preview.lineUserId, vendorIds: sorted(preview.vendorIds), revision: preview.revision, operationId: preview.operationId, confirmed: true };
      try { persist(attempt); } catch { state.message = '無法保存原操作編號，尚未送出。請允許此後台使用瀏覽器儲存後再試。'; emit(); return; }
      state.pending = clone(attempt); state.busy = true; state.message = '正在綁定並授權管理，請稍候…'; emit();
      try { completed(await api('confirm', attempt)); }
      catch (error) {
        if (error?.definitive === true) {
          try { persist(null); state.pending = null; state.preview = null; state.stage = 'select'; state.selectedIds = []; state.reloadRequired = true; state.message = failure(error) + ' 請重新載入目前關聯，再重新選擇及預覽。'; }
          catch { state.stage = 'uncertain'; state.message = '無法更新瀏覽器保存的操作狀態，請先查詢原操作結果。'; }
        } else { state.stage = 'uncertain'; state.message = '目前無法確認是否已完成。請查詢原操作結果；不要重新建立另一筆授權。操作編號：' + attempt.operationId; }
      } finally { state.busy = false; emit(); }
    },
    async check() {
      if (!state.pending || state.busy) return;
      await read(async () => {
        const result = await api('status', state.pending);
        if (result) completed(result);
        else { state.stage = 'uncertain'; state.message = '目前尚未查到原操作結果，仍不能確認是否完成。請稍後再次查詢，或提供操作編號給管理員核對；不會重新送出。'; }
      });
    },
    reset() {
      if (state.busy || state.pending || state.stage === 'uncertain') return;
      Object.assign(state, { stage: 'select', users: [], truncated: false, user: null, brands: clone(state.catalog), selectedIds: [], preview: null, receipt: null, message: '', reloadRequired: false }); emit();
    },
  };
}

export function vendorBrandAdminScrollTarget(previous, current) {
  if (current.stage !== previous?.stage && ['preview', 'done'].includes(current.stage)) return current.stage;
  if (current.stage === 'select' && current.user?.lineUserId && current.user.lineUserId !== previous?.user?.lineUserId) return 'user';
  return null;
}

// Display-only catalog filtering; options and preview still revalidate authority.
export function vendorBrandAdminCatalog(rows, now = Date.now()) {
  const today = new Date(Number(now) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!row?.id || !['approved', 'active'].includes(String(row.status || '').trim()) || Number(row.is_hidden || 0) !== 0 || String(row.contract_terminated_at || '').trim()) return false;
    const end = String(row.contract_end || '').trim();
    if (!end) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end.startsWith('0000-')) return false;
    const date = new Date(end + 'T00:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === end && end >= today;
  }).map(row => ({ id: String(row.id), name: String(row.name || ''), status: row.status }));
}

function vendorBrandAdminRuntime(createController, scrollTarget, catalogRows) {
  const boot = () => {
    const view = document.getElementById('view');
    if (!view || document.getElementById('vba-open')) return;
    const node = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = String(text); if (className) item.className = className; return item; };
    const button = (text, callback, className = '') => { const item = node('button', text, className); item.type = 'button'; item.onclick = callback; return item; };
    const name = user => user.lineDisplayName || '尚未取得 LINE 名稱';
    const relation = brand => `${brand.bindingStatus === 'revoked' ? '已解除關聯' : brand.bindingStatus === 'active' || brand.direct ? '已關聯' : '尚未關聯'} · ${brand.canManage ? '已有管理權限' : '尚未授權管理'}`;
    const actionName = value => ({ add: '新增綁定並授權管理', enable: '保留關聯並授權管理', restore: '恢復已解除關聯並授權管理', unchanged: '保留既有關聯與管理權限' }[value] || '請重新預覽');
    const storageKey = 'sakura_vendor_brand_admin_attempt';
    const bar = node('div', undefined, 'vba-launchbar'), open = button('多品牌 LINE 管理', () => {
      dialog.showModal(); render(controller.snapshot()); query.focus();
      controller.loadCatalog();
    }); open.id = 'vba-open'; bar.append(open); view.before(bar);
    const dialog = node('dialog', undefined, 'vba-dialog'); dialog.id = 'vba-dialog'; dialog.setAttribute('aria-labelledby', 'vba-title');
    const header = node('header'), heading = node('h2', '多品牌 LINE 管理'); heading.id = 'vba-title';
    const close = button('關閉', () => dialog.close()); close.setAttribute('aria-label', '關閉多品牌 LINE 管理'); header.append(heading, close);
    const body = node('div', undefined, 'vba-body'), notice = node('p', '選一位管理人、勾選品牌，再預覽確認。', 'vba-note');
    const steps = node('ol', undefined, 'vba-steps'); steps.setAttribute('aria-label', '多品牌管理操作步驟');
    for (const text of ['1 選擇管理人', '2 勾選品牌', '3 預覽確認']) steps.append(node('li', text));
    const summary = node('p', '', 'vba-summary'); summary.id = 'vba-summary'; summary.setAttribute('aria-live', 'polite');
    const message = node('p', '', 'vba-message'); message.id = 'vba-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
    const selection = node('section'); selection.id = 'vba-selection'; const columns = node('div', undefined, 'vba-columns'), peopleBox = node('section', undefined, 'vba-step-panel'); peopleBox.append(node('h3', '1 選擇管理人'), node('p', '搜尋後選定一位；同名請核對完整 User ID。', 'vba-note'));
    const searchForm = node('form'), searchLabel = node('label', '搜尋 LINE 名稱或完整 User ID'); searchLabel.htmlFor = 'vba-query';
    const searchRow = node('div', undefined, 'vba-row'), query = node('input'); query.id = 'vba-query'; query.type = 'search'; query.maxLength = 100; query.autocomplete = 'off'; query.placeholder = '例如 LINE 顯示名稱';
    const search = node('button', '搜尋用戶'); search.type = 'submit'; searchRow.append(query, search); searchForm.append(searchLabel, searchRow);
    const results = node('div'); results.id = 'vba-users'; const resultNote = node('p', '', 'vba-note');
    const target = node('div', undefined, 'vba-target'); target.id = 'vba-target'; target.tabIndex = -1;
    const brandBox = node('section', undefined, 'vba-step-panel'); brandBox.id = 'vba-brands-section'; const brandHeader = node('div', undefined, 'vba-row'), brandHeading = node('h3', '2 勾選品牌'), reload = button('重新載入品牌', () => controller.reload()); brandHeader.append(brandHeading, reload);
    const brandLabel = node('label', '搜尋品牌'); brandLabel.htmlFor = 'vba-brand-search'; const brandQuery = node('input'); brandQuery.id = 'vba-brand-search'; brandQuery.type = 'search'; brandQuery.placeholder = '輸入品牌名稱';
    const existing = node('p', '', 'vba-note'); existing.id = 'vba-existing'; const brands = node('div', undefined, 'vba-brands'); brands.id = 'vba-brands';
    const count = node('p', '', 'vba-note'); count.id = 'vba-count'; const previewButton = button('預覽綁定與管理授權', () => controller.preview(), 'vba-primary'); previewButton.id = 'vba-preview-button';
    brandBox.append(brandHeader, existing, brandLabel, brandQuery, brands, count); peopleBox.append(searchForm, results, resultNote, target); columns.append(peopleBox, brandBox); selection.append(columns);
    const preview = node('section'); preview.id = 'vba-preview'; const previewTitle = node('h3', '3 預覽確認'), previewUser = node('div', undefined, 'vba-target'), previewList = node('ul', undefined, 'vba-preview-list'), restoreWarning = node('p', '', 'vba-warning'); restoreWarning.id = 'vba-restore-warning'; previewTitle.tabIndex = -1;
    const ackLabel = node('label', undefined, 'vba-ack'), ack = node('input'); ack.type = 'checkbox'; ack.id = 'vba-ack'; ackLabel.append(ack, node('span', '我已核對 LINE 名稱、完整 User ID、品牌清單及恢復關聯項目。'));
    const previewActions = node('div', undefined, 'vba-row'), back = button('返回修改', () => controller.edit()), confirm = button('確認綁定並授權管理', () => controller.confirm(ack.checked), 'vba-primary'); confirm.id = 'vba-confirm'; previewActions.append(back, confirm);
    preview.append(previewTitle, previewUser, previewList, restoreWarning, ackLabel, previewActions);
    const uncertain = node('section'); uncertain.id = 'vba-uncertain'; const operation = node('p', '', 'vba-uid'), check = button('查詢原操作結果', () => controller.check()); check.id = 'vba-check'; uncertain.append(node('h3', '先確認原操作結果'), operation, check);
    const done = node('section'); done.id = 'vba-done'; const doneTitle = node('h3', '已完成授權'), receipt = node('div', undefined, 'vba-target'), again = button('選擇其他用戶', () => { controller.reset(); query.value = ''; brandQuery.value = ''; query.focus(); }); doneTitle.tabIndex = -1; done.append(doneTitle, receipt, again);
    const footer = node('footer'), cancel = button('取消／關閉', () => dialog.close()); cancel.style.marginLeft = 'auto'; footer.append(previewButton, cancel);
    body.append(steps, notice, summary, message, selection, preview, uncertain, done); dialog.append(header, body, footer); document.body.append(dialog);
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { saved = { unreadable: true }; }
    let previewId = '', lastState = null;
    const controller = createController({ api, restored: saved, persist(value) { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); }, onChange: render });
    async function api(action, data) {
      let session; try { session = JSON.parse(localStorage.getItem('sakura_admin_session') || 'null'); } catch {}
      if (!session?.token) { const error = new Error('請先登入管理後台，再使用多品牌 LINE 管理。'); error.definitive = true; throw error; }
      const readOnly = ['catalog', 'search', 'options', 'status'].includes(action), url = new URL('/admin-api/vendor-management', location.origin);
      const headers = { Authorization: 'Bearer ' + session.token }, request = { method: readOnly ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers, signal: AbortSignal.timeout(20000) };
      if (action === 'catalog') url.searchParams.set('module', 'vendors');
      else if (readOnly) { url.searchParams.set('action', 'vendor.brands.' + action); for (const [key, value] of Object.entries(data)) if (key !== 'confirmed') url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value)); }
      else { headers['Content-Type'] = 'application/json'; request.body = JSON.stringify({ action: 'vendor.brands.' + action, data }); }
      const response = await fetch(url.href, request), json = await response.json();
      if (!response.ok || !json.success) { const error = new Error(json.message || '操作未完成，請重新載入確認。'); error.code = json.code; error.definitive = response.status >= 400 && response.status < 500; throw error; }
      return action === 'catalog' ? catalogRows(json.vendors) : json.data;
    }
    function renderUser(container, user) { container.replaceChildren(); if (!user) return; container.append(node('strong', name(user)), node('p', user.lineUserId, 'vba-uid')); }
    function renderBrands(state) {
      brands.replaceChildren(); const term = brandQuery.value.trim().toLocaleLowerCase();
      const filtered = state.brands.filter(item => !term || String(item.name || '').toLocaleLowerCase().includes(term) || String(item.id || '').toLocaleLowerCase().includes(term));
      for (const brand of filtered) {
        const row = node('label', undefined, 'vba-brand'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.value = brand.id; checkbox.checked = state.selectedIds.includes(brand.id); checkbox.disabled = state.busy || state.reloadRequired; checkbox.onchange = () => controller.toggle(brand.id, checkbox.checked);
        const text = node('span'); text.append(node('strong', brand.name || '未命名品牌')); if (state.user) text.append(node('span', relation(brand), 'vba-note')); row.append(checkbox, text); brands.append(row);
      }
      if (!filtered.length) brands.append(node('p', state.brands.length ? '沒有符合搜尋的品牌。' : state.catalogLoaded || state.user ? '目前沒有可授權的有效品牌。' : '品牌清單載入中；若未出現，請按「重新載入品牌」。', 'vba-note'));
      count.textContent = `已選 ${state.selectedIds.length} 個品牌 · 符合搜尋 ${filtered.length} 個／可選 ${state.brands.length} 個。未選項目不會解除。`;
    }
    function render(state) {
      const moveTo = scrollTarget(lastState, state);
      lastState = state; message.textContent = state.message; message.hidden = !state.message;
      close.disabled = cancel.disabled = state.busy;
      selection.hidden = state.stage !== 'select'; preview.hidden = state.stage !== 'preview'; uncertain.hidden = state.stage !== 'uncertain'; done.hidden = state.stage !== 'done';
      summary.textContent = `已選管理人：${state.user ? name(state.user) : '尚未選擇'}　｜　已選品牌：${state.selectedIds.length} 個`;
      summary.hidden = !['select', 'preview'].includes(state.stage);
      query.disabled = search.disabled = state.busy; results.replaceChildren();
      for (const user of state.users) {
        const row = node('label', undefined, 'vba-user'), choose = node('input'); choose.type = 'radio'; choose.name = 'vba-manager'; choose.value = user.lineUserId; choose.checked = state.user?.lineUserId === user.lineUserId; choose.disabled = state.busy;
        choose.onchange = () => { if (choose.checked) controller.selectUser(user.lineUserId); };
        const information = node('div'); renderUser(information, user); information.prepend(node('span', choose.checked ? '已選管理人' : '選這位管理人', 'vba-choice-label')); row.append(choose, information); results.append(row);
      }
      resultNote.textContent = state.truncated ? '結果超過 20 位，請輸入更完整的 LINE 名稱或 User ID。' : '';
      target.hidden = !state.user; renderUser(target, state.user);
      const linked = state.brands.filter(item => item.bindingStatus === 'active' || item.direct), managed = state.brands.filter(item => item.canManage);
      existing.textContent = state.user ? `已關聯 ${linked.length} 個品牌，可管理 ${managed.length} 個；未勾選不會解除。` : '可先勾品牌，選好管理人後再核對權限。';
      reload.disabled = brandQuery.disabled = state.busy; renderBrands(state);
      previewButton.disabled = state.busy || !state.user || !state.selectedIds.length || state.reloadRequired;
      previewButton.hidden = state.stage !== 'select';
      if (state.stage === 'preview') {
        const data = state.preview; renderUser(previewUser, data); previewList.replaceChildren();
        for (const item of data.brands) { const row = node('li'); row.append(node('strong', item.name || '未命名品牌'), node('p', actionName(item.action))); previewList.append(row); }
        const restored = data.brands.filter(item => item.action === 'restore'); restoreWarning.hidden = !restored.length; restoreWarning.textContent = restored.length ? '注意：將恢復以下已解除的關聯：' + restored.map(item => item.name).join('、') + '。這些帳號將重新取得所選品牌管理權限。' : '';
        if (previewId !== data.operationId) { ack.checked = false; previewId = data.operationId; }
      } else { ack.checked = false; previewId = ''; }
      ack.disabled = back.disabled = state.busy; confirm.disabled = state.busy || !ack.checked;
      operation.textContent = state.pending ? '操作編號：' + state.pending.operationId + '\nLINE User ID：' + state.pending.lineUserId : ''; check.disabled = state.busy || !state.pending;
      if (state.receipt) { renderUser(receipt, state.receipt); receipt.append(node('p', '已核對品牌數：' + state.receipt.vendorIds.length), node('p', '操作編號：' + state.receipt.operationId, 'vba-uid')); }
      again.disabled = state.busy;
      if (moveTo) { ({ preview: previewTitle, done: doneTitle, user: target })[moveTo].focus(); body.scrollTop = 0; }
    }
    searchForm.onsubmit = event => { event.preventDefault(); controller.search(query.value); };
    brandQuery.oninput = () => { if (lastState) renderBrands(lastState); };
    ack.onchange = () => { confirm.disabled = controller.snapshot().busy || !ack.checked; };
    dialog.addEventListener('cancel', event => { if (controller.snapshot().busy) event.preventDefault(); });
    const showEntry = () => { bar.hidden = !document.querySelector('.tab.active[data-tab="vendors"]'); };
    const tabs = document.querySelector('.tabs'); if (tabs) new MutationObserver(showEntry).observe(tabs, { attributes: true, subtree: true, attributeFilter: ['class'] });
    showEntry(); render(controller.snapshot());
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
}

export function decorateVendorBrandAdminHtml(html) {
  if (typeof html !== 'string' || html.includes('id="vendor-brand-admin-runtime"')) return html;
  const assets = `<style id="vendor-brand-admin-style">
.vba-launchbar{display:flex;justify-content:flex-end;flex-shrink:0}.vba-launchbar[hidden]{display:none}.vba-launchbar button,.vba-dialog button{font:600 16px/1.5 system-ui,sans-serif;min-height:44px;padding:9px 14px;border:1px solid #bdcad8;border-radius:8px;background:#fff;color:#10273d;cursor:pointer}.vba-launchbar button{background:#173e5e;color:#fff;border-color:#173e5e}.vba-dialog{box-sizing:border-box;inset:0 0 0 auto;margin:0;width:min(780px,100%);max-width:100%;height:100dvh;max-height:100dvh;padding:0;border:0;border-left:1px solid #b8c5d4;color:#122b42;background:#fff;font:16px/1.6 system-ui,sans-serif}.vba-dialog[open]{display:flex;flex-direction:column}.vba-dialog::backdrop{background:rgba(15,23,42,.45)}.vba-dialog *{box-sizing:border-box}.vba-dialog [hidden]{display:none!important}.vba-dialog header,.vba-dialog footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 20px;flex-shrink:0;background:#f6f8fb}.vba-dialog header{border-bottom:1px solid #d3dce7}.vba-dialog footer{border-top:1px solid #d3dce7;justify-content:flex-end}.vba-dialog h2{font-size:23px;line-height:1.4;margin:0}.vba-dialog h3{font-size:19px;margin:18px 0 10px}.vba-body{padding:18px 20px;overflow:auto;min-height:0;flex:1}.vba-dialog p{margin:8px 0;overflow-wrap:anywhere}.vba-dialog label{font-weight:600;display:block}.vba-dialog input[type=search]{font:inherit;min-width:0;width:100%;min-height:46px;padding:10px 12px;border:1px solid #aebfd1;border-radius:8px;color:#122b42;background:#fff}.vba-dialog input::placeholder{color:#586d80;opacity:1}.vba-dialog input[type=checkbox]{width:20px;height:20px;flex:none;accent-color:#164e77}.vba-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0}.vba-row input{flex:1 1 250px}.vba-dialog button:disabled{opacity:.55;cursor:not-allowed}.vba-dialog :focus-visible{outline:3px solid #1474ba;outline-offset:2px}.vba-dialog .vba-primary{background:#164e77;color:#fff;border-color:#164e77}.vba-note{font-size:16px;color:#3f556b;line-height:1.65}.vba-message{padding:12px 14px;border-left:4px solid #1674ad;background:#edf6ff;white-space:pre-wrap}.vba-user{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #d5dfeb}.vba-user>div{min-width:0}.vba-user strong,.vba-target strong{display:block;font-size:18px;overflow-wrap:anywhere}.vba-uid{font:16px/1.6 ui-monospace,Consolas,monospace;color:#3f556b;overflow-wrap:anywhere;white-space:pre-wrap}.vba-target{margin:16px 0;padding:14px;border:1px solid #bbccdd;border-radius:8px;background:#f2f7fb}.vba-brands{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.vba-dialog .vba-brand{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #c5d2df;border-radius:8px;min-width:0;cursor:pointer}.vba-brand strong,.vba-brand span{display:block;overflow-wrap:anywhere}.vba-brand input{margin-top:3px}.vba-preview-list{padding-left:24px}.vba-preview-list li{padding:8px 0;overflow-wrap:anywhere}.vba-preview-list p{margin:2px 0}.vba-warning{padding:12px;color:#842b0d;background:#fff4df;border:1px solid #e3b35e;border-radius:8px}.vba-dialog .vba-ack{display:flex;align-items:flex-start;gap:10px;margin:18px 0}.vba-ack input{margin-top:3px}@media(max-width:520px){.vba-dialog header,.vba-dialog footer{padding:12px}.vba-body{padding:14px 12px}.vba-dialog h2{font-size:21px}.vba-brands{grid-template-columns:1fr}.vba-user{flex-direction:column;align-items:stretch}.vba-user button{align-self:flex-start}.vba-row button{max-width:100%;white-space:normal}.vba-launchbar{justify-content:flex-start}}
.vba-dialog{width:min(1100px,100%)}.vba-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;list-style:none;padding:0;margin:0 0 14px}.vba-steps li{padding:10px;border-radius:8px;background:#eaf2f8;color:#173e5e;font-size:17px;font-weight:700}.vba-columns{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.2fr);gap:20px;align-items:start}.vba-step-panel{min-width:0;border:1px solid #c5d2df;border-radius:10px;padding:14px}.vba-step-panel h3{margin:0 0 10px}.vba-summary{padding:12px 14px;border:1px solid #a7c8dd;border-radius:8px;background:#eef7fb;font-weight:700}.vba-review-step{padding-top:16px}.vba-dialog .vba-user{display:flex;align-items:flex-start;justify-content:flex-start;gap:12px;margin:10px 0;padding:12px;border:1px solid #b8cadb;border-radius:9px;cursor:pointer}.vba-user input[type=radio]{width:20px;height:20px;flex:none;margin:4px 0 0;accent-color:#164e77}.vba-user:has(input:checked){border:2px solid #164e77;background:#eef7fb}.vba-choice-label{display:block;color:#164e77;font-weight:700;margin-bottom:4px}@media(max-width:760px){.vba-columns{grid-template-columns:1fr}.vba-steps li{font-size:16px;padding:8px}.vba-dialog .vba-user{flex-direction:row}.vba-step-panel{padding:12px}}
</style><script id="vendor-brand-admin-runtime">(()=>{const __name=fn=>fn;(${vendorBrandAdminRuntime.toString()})(${createVendorBrandAdminController.toString()},${vendorBrandAdminScrollTarget.toString()},${vendorBrandAdminCatalog.toString()});})();</script>`;
  return html.replace('</head>', assets + '</head>');
}
