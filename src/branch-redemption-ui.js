const safeJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));

const styles = `
  .br-workspace{font:16px/1.65 system-ui,-apple-system,"Segoe UI","Noto Sans TC",sans-serif;color:#10263b;overflow-wrap:anywhere}
  .br-workspace *{box-sizing:border-box}.br-workspace [hidden]{display:none!important}
  .br-workspace h1{font-size:25px;margin:0}.br-workspace h2{font-size:21px;margin:0 0 10px}.br-workspace h3{font-size:18px;margin:0}
  .br-workspace p{margin:8px 0}.br-muted{color:#435870}.br-box{padding:18px;border:1px solid #ced9e4;border-radius:12px;background:#fff;margin:14px 0}
  .br-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:12px}.br-workspace button,.br-workspace .br-button{font:inherit;font-weight:650;min-height:46px;border-radius:9px;border:1px solid #aebfcf;background:#fff;color:#10263b;padding:9px 14px;cursor:pointer;text-decoration:none;text-align:center}
  .br-workspace button:disabled{opacity:.5;cursor:not-allowed}.br-workspace .br-primary{background:#008c40;border-color:#008c40;color:#fff}.br-workspace button:focus-visible,.br-workspace a:focus-visible,.br-workspace input:focus-visible{outline:3px solid #2479c7;outline-offset:3px}
  .br-workspace label{display:block;font-weight:650;margin-bottom:6px}.br-workspace input,.br-workspace select{font:inherit;max-width:100%;width:100%;min-height:48px;padding:9px 12px;border:1px solid #aebfcf;border-radius:9px;background:#fff;color:#10263b}
  .br-facts{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:7px 16px;margin:12px 0}.br-facts dt{color:#435870}.br-facts dd{margin:0;font-weight:600}.br-money{font-size:24px;color:#006d34}.br-status{padding:13px 15px;border-left:4px solid #2672b9;background:#edf5ff;margin:12px 0}.br-success{border-color:#008c40;background:#eafaf0}.br-error{border-color:#c93635;background:#fff1ef}
  .br-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.br-row{padding:16px 0;border-bottom:1px solid #dbe3ee}.br-row:last-child{border-bottom:0}.br-qr-row{display:grid;grid-template-columns:88px minmax(0,1fr);gap:14px;align-items:start}.br-qr-row img{width:88px;height:88px;border:1px solid #dbe3ee}.br-small{font-size:14px;color:#435870}.br-workspace dialog{width:min(94vw,520px);max-height:90vh;overflow:auto;border:1px solid #b9c9d8;border-radius:14px;padding:22px;color:#10263b;background:#fff}.br-workspace dialog::backdrop{background:rgb(5 20 35 / .55)}
  .br-pending-badge{display:inline-block;border-radius:99px;background:#fff0c5;color:#6c4b00;padding:3px 10px;font-size:14px;font-weight:700}.br-workspace summary{cursor:pointer;font-size:18px;font-weight:700;padding:10px 0}.br-back{position:sticky;top:0;z-index:3;background:#f5f7fa;padding:10px 0}
  @media(max-width:420px){.br-box{padding:14px}.br-facts{grid-template-columns:95px minmax(0,1fr);gap:6px 10px}.br-actions>button,.br-actions>.br-button{flex:1}.br-workspace h1{font-size:23px}.br-qr-row{grid-template-columns:74px minmax(0,1fr)}.br-qr-row img{width:74px;height:74px}}
`;

const customerScript = String.raw`function customerRuntime(config) {
  const el = id => document.getElementById('br-' + id);
  const locationId = new URL(location.href).searchParams.get('location_id') || '';
  const storageKey = 'sakura_branch_transaction:' + encodeURIComponent(locationId);
  let identityReady = false, profileReady = false, profileLoading = false, canTransact = false, startupLoading = false, quote = null, transaction = null, attemptId = '', busy = false, uncertain = false;
  try { const saved = sessionStorage.getItem(storageKey); if (/^[0-9a-f-]{36}$/i.test(saved || '')) attemptId = saved; } catch {}
  const setMessage = (text, kind = '') => { el('message').textContent = text; el('message').className = 'br-status ' + kind; };
  const money = value => 'NT$ ' + Number(value || 0).toLocaleString('zh-TW');
  function facts(container, pairs) {
    container.replaceChildren();
    for (const [label, value] of pairs) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = String(value ?? ''); container.append(dt, dd); }
  }
  function controls() {
    el('quote-button').disabled = busy || profileLoading || !profileReady || !canTransact || Boolean(transaction) || uncertain;
    el('initiate').disabled = busy || profileLoading || !profileReady || !canTransact || !quote || Boolean(transaction) || uncertain;
    el('amount').disabled = busy || profileLoading || !profileReady || !canTransact || Boolean(transaction) || uncertain;
    el('refresh').disabled = busy || !attemptId || !identityReady;
    el('new').disabled = busy; el('cancel-request').disabled = busy;
    el('profile-retry').disabled = busy || profileLoading || startupLoading;
  }
  async function api(action, data = {}) {
    const token = window.liff?.getIDToken?.();
    if (!token) throw new Error('請先登入 LINE，才能確認您的會員身分。');
    const response = await fetch('/api/branch-redemption', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({ action, id_token: token, location_id: locationId, ...data }) });
    const result = await response.json();
    if (!result.success) { const error = new Error(result.message || '暫時無法完成操作，請稍後重試。'); error.code = result.code; error.status = response.status; error.data = result.data; throw error; }
    return result.data;
  }
  function profileMessage(message, error = false) {
    el('profile-status').textContent = message;
    el('profile-status').className = error ? 'br-status br-error' : 'br-muted';
  }
  function showProfile(data) {
    facts(el('profile-facts'), [['LINE 名稱', data.lineName || '尚未取得 LINE 名稱']]);
    el('profile-facts').hidden = false;
    profileReady = true; canTransact = data.canTransact === true;
    profileMessage(canTransact ? '已帶入您的 LINE 名稱。' : '此帳號目前無法使用核銷，請聯絡福委會。');
  }
  async function loadProfile() {
    if (profileLoading || busy || !identityReady) return false;
    profileLoading = true; profileReady = false; canTransact = false; el('profile-facts').hidden = true; el('profile-facts').replaceChildren(); controls();
    profileMessage('正在讀取您的 LINE 名稱…');
    try { showProfile(await api('profile')); return true; }
    catch (error) { profileMessage('LINE 名稱暫時無法讀取：' + error.message + ' 請按「重新讀取 LINE 名稱」重試。', true); return false; }
    finally { profileLoading = false; el('profile-retry').hidden = false; controls(); }
  }
  function showQuote(data) {
    quote = data;
    el('quote').hidden = false;
    facts(el('quote-facts'), [['LINE 名稱', data.memberName || 'LINE 使用者'], ['消費原價', money(data.original)], ['優惠折數', data.fold + ' 折'], ['折抵金額', money(data.discount)], ['應付金額', money(data.payable)]]);
  }
  function showTransaction(data) {
    transaction = data; uncertain = false;
    el('amount').value = String(data.original ?? '');
    if (data.id) { attemptId = data.id; try { sessionStorage.setItem(storageKey, attemptId); } catch {} }
    el('transaction').hidden = false; el('quote').hidden = true;
    const completed = data.status === 'confirmed', pending = data.status === 'pending';
    el('transaction-title').textContent = completed ? '核銷已完成' : pending ? '尚未完成的舊申請' : data.status === 'expired' ? '本次申請已逾時' : data.status === 'rejected' ? '店員已退回本次申請' : '本次申請已取消';
    el('transaction').className = 'br-box' + (completed ? ' br-success' : '');
    facts(el('transaction-facts'), [['交易編號', data.id], ['廠商', data.vendorName], ['分店', data.branchName], ['LINE 名稱', data.memberName || 'LINE 使用者'], ['消費原價', money(data.original)], ['折抵金額', money(data.discount)], ['應付金額', money(data.payable)], ...(completed ? [['核銷編號', data.redemptionId], ['完成時間', displayTime(data.confirmedAt)]] : [])]);
    el('transaction-note').textContent = completed ? '本次優惠核銷已完成，已寫入消費紀錄。請保留此畫面供核對。' : pending ? '這是舊版流程留下的待確認申請，目前尚未完成核銷。可由店員確認，或先取消本次申請，再重新核對金額並送出。' : '此筆未完成核銷。確認需要消費後，可另外發起一筆新交易。';
    el('new').hidden = pending; el('cancel-request').hidden = !pending; el('refresh').hidden = false;
    setMessage(completed ? '本次核銷已完成，已寫入消費紀錄。' : pending ? '已恢復尚未完成的舊申請，尚未入帳。' : '這筆申請已結束。', completed ? 'br-success' : '');
  }
  function displayTime(value) { if (!value) return '—'; const raw = String(value), date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }); }
  async function refresh() {
    if (busy || !attemptId) return;
    busy = true; controls(); setMessage('正在確認原交易狀態…');
    try { showTransaction(await api('status', { request_id: attemptId })); }
    catch (error) {
      if (error.code === 'request_not_found') { transaction = null; uncertain = false; el('transaction').hidden = true; setMessage('尚未查到這筆交易，請確認金額後再送出；重試會沿用同一交易編號。'); }
      else { uncertain = true; setMessage(error.message || '無法確認交易結果，請更新原交易狀態。', 'br-error'); }
    } finally { busy = false; controls(); }
  }
  el('amount').addEventListener('input', () => { if (!busy && !transaction && !uncertain) { quote = null; el('quote').hidden = true; controls(); } });
  el('form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !identityReady || !profileReady || !canTransact || profileLoading || transaction || uncertain) return;
    const original = Number(el('amount').value);
    if (!Number.isSafeInteger(original) || original < 1 || original > 10000000) { setMessage('消費金額須為 1 到 10,000,000 元的整數。', 'br-error'); return; }
    busy = true; quote = null; el('quote').hidden = true; controls();
    try { showQuote(await api('quote', { original_price: original })); setMessage('請核對店家、分店、LINE 名稱與金額；送出後立即完成核銷並寫入消費紀錄。'); }
    catch (error) { setMessage(error.message, 'br-error'); }
    finally { busy = false; controls(); }
  });
  el('initiate').addEventListener('click', async () => {
    if (busy || !profileReady || !canTransact || profileLoading || !quote || transaction || uncertain) return;
    const current = quote;
    if (!window.confirm('確認向「' + current.vendorName + '／' + current.branchName + '」完成本次消費核銷？\nLINE 名稱：' + (current.memberName || 'LINE 使用者') + '\n原價：' + money(current.original) + '\n應付：' + money(current.payable) + '\n送出後立即完成核銷並寫入消費紀錄。')) return;
    busy = true;
    if (!attemptId) { attemptId = crypto.randomUUID(); try { sessionStorage.setItem(storageKey, attemptId); } catch {} }
    controls();
    try { showTransaction(await api('submit', { confirmed: true, request_id: attemptId, original_price: current.original, payable_price: current.payable, pos_revision: current.revision, pos_member_type: current.memberType })); }
    catch (error) {
      if (error.code === 'pending_request_exists' && error.data?.id) {
        showTransaction(error.data);
        setMessage('已有尚未完成的舊申請，已恢復原交易與金額；本次未入帳。請先處理或取消舊申請。');
        return;
      }
      // A timeout may follow a committed request: hold its ID and ask for readback, never create another transaction.
      uncertain = true; el('refresh').hidden = false; setMessage((error.message || '送出結果尚未確認。') + ' 請按「更新交易狀態」查詢原交易，勿重新發起。', 'br-error');
    } finally { busy = false; controls(); }
  });
  el('cancel-request').addEventListener('click', async () => {
    if (busy || transaction?.status !== 'pending') return;
    if (!window.confirm('確認取消這筆尚未完成的消費申請？')) return;
    busy = true; controls();
    try { showTransaction(await api('cancel', { request_id: attemptId })); }
    catch (error) { uncertain = true; setMessage(error.message + ' 請更新交易狀態確認結果。', 'br-error'); }
    finally { busy = false; controls(); }
  });
  el('refresh').addEventListener('click', refresh);
  el('new').addEventListener('click', () => {
    if (busy || transaction?.status === 'pending' || uncertain) return;
    if (!window.confirm('確認要另外開始一筆新消費？已完成的核銷紀錄仍會保留。')) return;
    transaction = null; quote = null; attemptId = ''; try { sessionStorage.removeItem(storageKey); } catch {}
    el('transaction').hidden = true; el('quote').hidden = true; el('refresh').hidden = true; el('new').hidden = true; el('cancel-request').hidden = true; el('amount').value = ''; controls(); setMessage('請填寫新交易的消費金額。');
  });
  el('login').addEventListener('click', () => {
    if (window.liff?.login) window.liff.login({ redirectUri: location.href });
    else setMessage('LINE 登入工具尚未載入，請重新開啟此 QR 碼。', 'br-error');
  });
  el('close').addEventListener('click', () => { if (window.liff?.isInClient?.()) window.liff.closeWindow(); else location.href = '/partner-stores'; });
  el('profile-retry').addEventListener('click', async () => {
    if (identityReady) {
      const loaded = await loadProfile();
      if (loaded && !transaction && !uncertain) setMessage(canTransact ? '請確認分店與 LINE 名稱正確，再輸入本次消費金額。' : '請先確認上方 LINE 名稱，暫未開放送出交易。');
    } else await load();
  });
  async function load() {
    if (startupLoading) return; startupLoading = true; controls();
    if (!locationId) { startupLoading = false; profileMessage('請先掃描有效的分店 QR 碼。'); setMessage('缺少分店資料，請重新掃描店家 QR 碼。', 'br-error'); controls(); return; }
    try {
      const response = await fetch('/api/branch-redemption?location_id=' + encodeURIComponent(locationId), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const result = await response.json(); if (!result.success) throw new Error(result.message || '這家分店目前無法使用核銷。');
      const data = result.data; el('vendor').textContent = data.vendorName; el('branch').textContent = data.branchName; el('address').textContent = data.address || '地址未提供';
      if (!config.liffId || !window.liff) throw new Error('無法載入 LINE 登入，請從 LINE 重新掃描店家 QR 碼。');
      await window.liff.init({ liffId: config.liffId });
      if (!window.liff.isLoggedIn()) { el('login').hidden = false; profileMessage('尚未登入 LINE。登入後會自動帶入 LINE 名稱。'); setMessage('請先登入 LINE，確認您的身分。'); return; }
      if (!window.liff.getIDToken()) throw new Error('無法確認 LINE 登入身分，請重新開啟。');
      identityReady = true; controls();
      const loadedProfile = await loadProfile();
      if (attemptId) { uncertain = true; el('refresh').hidden = false; await refresh(); }
      else setMessage(loadedProfile && canTransact ? '請確認分店與 LINE 名稱正確，再輸入本次消費金額。' : '請先確認上方 LINE 名稱，暫未開放送出交易。');
    } catch (error) { profileMessage(error.message, true); el('profile-retry').hidden = false; setMessage(error.message, 'br-error'); }
    finally { startupLoading = false; controls(); }
  }
  load();
}`;

export function renderBranchRedemptionHtml(env = {}) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>分店消費核銷 | SAKURA Welfare</title><script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><style>body{margin:0;background:#f5f7fa}.br-page{max-width:620px;margin:0 auto;padding:0 18px 28px}${styles}</style></head><body><main class="br-page br-workspace"><div class="br-back"><button id="br-close" type="button">返回／關閉</button></div><h1>分店消費核銷</h1><section class="br-box" aria-label="交易分店"><p class="br-muted" id="br-vendor">正在確認店家…</p><h2 id="br-branch"></h2><p id="br-address" class="br-muted"></p></section><div id="br-message" class="br-status" role="status" aria-live="polite">正在載入…</div><button id="br-login" type="button" class="br-primary" hidden>登入 LINE</button><section id="br-profile" class="br-box" aria-label="用戶資料"><h2>用戶資料</h2><p id="br-profile-status" class="br-muted" role="status" aria-live="polite">正在確認 LINE 登入與名稱…</p><dl id="br-profile-facts" class="br-facts" hidden></dl><button id="br-profile-retry" type="button" hidden>重新讀取 LINE 名稱</button></section><form id="br-form" class="br-box"><label for="br-amount">本次消費原價（元）</label><input id="br-amount" type="number" inputmode="numeric" min="1" max="10000000" step="1" required autocomplete="off"><p class="br-small">依本店優惠計算，核對金額並送出後立即完成核銷。</p><div class="br-actions"><button id="br-quote-button" class="br-primary" type="submit" disabled>確認優惠與金額</button></div></form><section id="br-quote" class="br-box" hidden><h2>核對本次消費</h2><dl id="br-quote-facts" class="br-facts"></dl><div class="br-actions"><button id="br-initiate" type="button" class="br-primary">送出並完成核銷</button></div></section><section id="br-transaction" class="br-box" hidden><h2 id="br-transaction-title"></h2><dl id="br-transaction-facts" class="br-facts"></dl><p id="br-transaction-note"></p></section><div class="br-actions"><button id="br-refresh" type="button" hidden>更新交易狀態</button><button id="br-cancel-request" type="button" hidden>取消本次申請</button><button id="br-new" type="button" hidden>另起一筆新交易</button></div></main><script>(${customerScript})(${safeJson({ liffId: env.liffId || '' })});</script></body></html>`;
}

const merchantScript = String.raw`function merchantRuntime() {
  const el = id => document.getElementById('br-pos-' + id);
  const root = el('workspace'); if (!root) return;
  const vendorId = typeof currentVendorId !== 'undefined' ? currentVendorId : '';
  const token = typeof portalToken !== 'undefined' ? portalToken : '';
  let busy = false, selected = null, requests = [], recoveryId = '';
  const recoveryKey = 'sakura_branch_confirmation:' + encodeURIComponent(vendorId);
  try { const saved = sessionStorage.getItem(recoveryKey); if (/^[0-9a-f-]{36}$/i.test(saved || '')) recoveryId = saved; } catch {}
  function storeRecovery(id) { recoveryId = id; el('recover').hidden = !id; try { if (id) sessionStorage.setItem(recoveryKey, id); else sessionStorage.removeItem(recoveryKey); } catch {} }
  const money = value => 'NT$ ' + Number(value || 0).toLocaleString('zh-TW');
  const text = (tag, value, className = '') => { const item = document.createElement(tag); item.textContent = String(value ?? ''); if (className) item.className = className; return item; };
  function message(value, error = false) { el('message').textContent = value; el('message').className = 'br-status' + (error ? ' br-error' : ''); }
  function button(label, onClick, className = '') { const b = text('button', label, className); b.type = 'button'; b.addEventListener('click', onClick); return b; }
  async function api(body) {
    const url = '/api/vendor-pos/branch-redemptions' + (body ? '' : '?' + new URLSearchParams({ vendor_id: vendorId, ...(token ? { portal_token: token } : {}), ...(el('filter').value ? { location_id: el('filter').value } : {}) }));
    const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), ...(body ? { body: JSON.stringify({ vendor_id: vendorId, portal_token: token, ...body }) } : {}) });
    const result = await response.json(); if (!result.success) throw new Error(result.message || '無法讀取本店交易。'); return result.data;
  }
  function details(container, row) {
    container.replaceChildren();
    for (const [label, value] of [['交易編號', row.id], ['廠商', row.vendorName], ['分店', row.branchName], ['LINE 名稱', row.memberName || 'LINE 使用者'], ['會員身分', row.memberType === 'employee' ? '員工' : '訪客'], ['消費原價', money(row.original)], ['折抵金額', money(row.discount)], ['應付金額', money(row.payable)]]) container.append(text('dt', label), text('dd', value));
  }
  function render(data) {
    requests = data.requests || [];
    el('vendor').textContent = data.vendor?.name || '本店';
    const previous = el('filter').value; el('filter').replaceChildren(new Option('全部分店', ''));
    for (const row of data.locations || []) el('filter').append(new Option(row.branch_name || '未命名分店', row.id));
    el('filter').value = previous;
    el('branches').replaceChildren();
    for (const row of data.locations || []) {
      const item = text('div', '', 'br-row br-qr-row'), image = document.createElement('img'), content = document.createElement('div');
      image.src = '/api/branch-redemption/qr.svg?location_id=' + encodeURIComponent(row.id); image.alt = (row.branch_name || '分店') + '消費 QR'; image.loading = 'lazy';
      content.append(text('h3', row.branch_name || '未命名分店'), text('p', row.address || '地址未提供', 'br-small'));
      const link = text('a', '下載／列印分店 QR', 'br-button'); link.href = '/branch-qr?location_id=' + encodeURIComponent(row.id); link.target = '_blank'; link.rel = 'noopener'; content.append(link); item.append(image, content); el('branches').append(item);
    }
    if (!(data.locations || []).length) el('branches').append(text('p', '目前沒有可核銷的已公開分店，請先由後台完成分店資料與核准。', 'br-muted'));
    el('requests').replaceChildren();
    for (const row of requests) {
      const item = text('article', '', 'br-row'); item.append(text('span', '待店員確認', 'br-pending-badge'), text('h3', (row.branchName || '分店') + ' · ' + (row.memberName || 'LINE 使用者')));
      item.append(text('p', '原價 ' + money(row.original) + '，折抵 ' + money(row.discount) + '，應付 ' + money(row.payable)), text('p', '交易編號：' + row.id, 'br-small'));
      const actions = text('div', '', 'br-actions'); actions.append(button('核對並確認', () => { if (busy) return; if (recoveryId && recoveryId !== row.id) { message('尚有一筆交易結果待確認，請先按「查詢原交易結果」，避免混淆交易。', true); return; } el('receipt').hidden = true; selected = row; details(el('details'), row); el('confirm').disabled = false; el('dialog').showModal(); }, 'br-primary')); item.append(actions); el('requests').append(item);
    }
    if (!requests.length) el('requests').append(text('p', '目前沒有待確認交易。', 'br-muted'));
    message(data.truncated ? '已顯示最近的待確認交易，請選擇分店縮小範圍。' : '已載入本店分店與待確認交易。');
  }
  async function refresh() {
    if (busy) return; busy = true; el('reload').disabled = true; el('filter').disabled = true; message('正在載入本店資料…');
    try { render(await api()); }
    catch (error) { message(error.message, true); el('requests').replaceChildren(); el('branches').replaceChildren(); }
    finally { busy = false; el('reload').disabled = false; el('filter').disabled = false; }
  }
  function showReceipt(result) {
    el('receipt').hidden = false; el('receipt-title').textContent = '核銷已完成'; details(el('receipt-facts'), result); el('receipt-code').textContent = '核銷編號：' + (result.redemptionId || '');
  }
  async function recover() {
    if (busy || !recoveryId) return;
    const id = recoveryId; busy = true; el('recover').disabled = true;
    try {
      const result = await api({ action: 'status', request_id: id });
      busy = false; await refresh();
      if (result.status === 'confirmed') { showReceipt(result); storeRecovery(''); message('已查到原交易 ' + id + ' 完成核銷，沒有另建交易。'); }
      else if (result.status === 'pending') { el('receipt').hidden = true; message('原交易 ' + id + ' 仍待確認，請在列表核對同一筆交易後再確認。'); }
      else { storeRecovery(''); message('原交易 ' + id + ' 已取消、退回或逾時，未完成核銷。'); }
    } catch (error) { message(error.message + ' 請保留原交易編號，稍後再查詢。', true); }
    finally { busy = false; el('recover').disabled = false; }
  }
  el('cancel').addEventListener('click', () => { if (!busy) { selected = null; el('dialog').close(); } });
  el('dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else selected = null; });
  el('confirm').addEventListener('click', async () => {
    if (busy || !selected) return;
    if (recoveryId && recoveryId !== selected.id) { message('請先查詢原交易結果。', true); return; }
    const row = selected; busy = true; storeRecovery(row.id); el('confirm').disabled = true; el('cancel').disabled = true;
    try {
      const result = await api({ action: 'confirm', confirmed: true, request_id: row.id, location_id: row.locationId, original_price: row.original, payable_price: row.payable, pos_member_type: row.memberType, pos_revision: row.revision });
      if (result.status !== 'confirmed') throw new Error('尚未取得核銷完成結果，請重新整理查看原交易。');
      el('dialog').close(); selected = null;
      showReceipt(result); storeRecovery('');
      busy = false; await refresh(); message('交易 ' + row.id + ' 已完成核銷。重試不會重複建立紀錄。');
    } catch (error) {
      el('dialog').close(); selected = null; message(error.message + ' 請按「查詢原交易結果」確認原交易，不要另建交易。', true);
    } finally { busy = false; el('confirm').disabled = false; el('cancel').disabled = false; }
  });
  el('reload').addEventListener('click', refresh); el('filter').addEventListener('change', refresh);
  el('recover').addEventListener('click', recover); storeRecovery(recoveryId);
  if (vendorId) refresh().then(() => { if (recoveryId) recover(); }); else message('請先使用廠商帳號登入，才可查看分店 QR 與待確認交易。');
}`;

export function decorateVendorPosBranchHtml(html) {
  const section = `<section class="br-workspace br-box" id="br-pos-workspace" aria-label="分店掃碼核銷"><div class="br-toolbar"><h2>分店掃碼核銷</h2><button type="button" id="br-pos-reload">重新整理交易</button></div><p id="br-pos-vendor" class="br-muted"></p><p>用戶掃分店 QR 發起消費，店員核對後才完成核銷。</p><div id="br-pos-message" class="br-status" role="status" aria-live="polite">請先登入本店帳號。</div><button type="button" id="br-pos-recover" hidden>查詢原交易結果</button><details><summary>各分店 QR 碼與下載</summary><div id="br-pos-branches"></div></details><label for="br-pos-filter">待確認交易的分店</label><select id="br-pos-filter"><option value="">全部分店</option></select><div id="br-pos-requests"></div><section class="br-box br-success" id="br-pos-receipt" hidden><h3 id="br-pos-receipt-title"></h3><dl class="br-facts" id="br-pos-receipt-facts"></dl><p id="br-pos-receipt-code" class="br-small"></p></section><dialog id="br-pos-dialog" aria-labelledby="br-pos-dialog-title"><h2 id="br-pos-dialog-title">確認本次優惠核銷</h2><p>請與現場用戶核對以下資料，確認後會建立核銷紀錄。</p><dl class="br-facts" id="br-pos-details"></dl><div class="br-actions"><button id="br-pos-cancel" type="button">取消</button><button id="br-pos-confirm" class="br-primary" type="button">確認完成核銷</button></div></dialog></section>`;
  const marker = '<section class="grid">';
  if (!html.includes(marker) || !html.includes('</body>')) throw new Error('Vendor POS branch enhancement anchor missing');
  return html.replace('</head>', '<style>' + styles + '</style></head>').replace(marker, section + marker).replace('只顯示本店資料。掃描會員 QR 後，記錄消費進帳與折抵。', '用戶掃描分店 QR 發起消費，店員核對後完成核銷。').replace('</body>', '<script>(' + merchantScript + ')();</script></body>');
}
