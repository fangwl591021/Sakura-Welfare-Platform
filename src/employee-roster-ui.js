import { selectEmployeeRosterRows, rosterVerifiedTimestamp } from './employee-roster-view.js';

function employeeRosterRuntime() {
  const $ = id => document.getElementById(id);
  const labels = { bound: '已綁定', unbound: '未綁定', review: '待確認' };
  const state = { rows: [], page: 1, pageSize: 50, sortDirection: '', loaded: false, loading: false, version: 0, controller: null, exporting: false, exportController: null };
  const text = value => ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
  const esc = value => text(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function verifiedTime(value) {
    if (!text(value).trim()) return '—';
    const timestamp = rosterVerifiedTimestamp(value);
    if (timestamp === null) return '時間待確認';
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  }

  function notice(message, error = false) {
    $('rosterNotice').textContent = message;
    $('rosterNotice').classList.toggle('error', error);
    $('rosterNotice').setAttribute('role', error ? 'alert' : 'status');
  }

  function controls() {
    $('rosterReload').disabled = state.loading;
    $('rosterExport').disabled = !state.loaded || state.loading || state.exporting;
    $('rosterExport').textContent = state.exporting ? '正在匯出…' : '下載 Excel';
    $('rosterReload').textContent = state.loading ? '讀取中…' : '重新載入';
    for (const id of ['employeeRosterSearch', 'employeeRosterFactory', 'employeeRosterIdentity', 'employeeRosterBinding', 'rosterPageSize', 'rosterVerifiedSort']) $(id).disabled = !state.loaded;
  }

  function resetView(message) {
    state.exportController?.abort();
    state.rows = [];
    state.loaded = false;
    state.page = 1;
    for (const id of ['rosterTotal', 'rosterBound', 'rosterUnbound', 'rosterReview']) $(id).textContent = '—';
    $('employeeRosterRows').innerHTML = '<tr><td colspan="9" class="empty">' + esc(message) + '</td></tr>';
    $('rosterResultStatus').textContent = '';
    $('rosterPageNote').textContent = '尚未載入名冊';
    $('rosterPrevious').disabled = $('rosterNext').disabled = true;
    controls();
  }

  async function headers() {
    try {
      let sameParent = false;
      try { sameParent = parent !== window && parent.location.origin === location.origin; } catch {}
      if (sameParent && typeof parent.sakuraAdminEnsureSession === 'function' && !await parent.sakuraAdminEnsureSession()) return null;
      let session = null;
      try { session = JSON.parse(localStorage.getItem('sakura_admin_session') || 'null'); } catch {}
      if (session?.token) return { Authorization: 'Bearer ' + session.token };
      const sdk = window.liff || (sameParent ? parent.liff : null);
      if (sdk && sdk.isLoggedIn() && sdk.getIDToken()) return { 'X-Line-Id-Token': sdk.getIDToken() };
    } catch {}
    return null;
  }

  function project(row) {
    const status = Object.hasOwn(labels, row?.status) ? row.status : 'review';
    return {
      employeeNo: text(row?.employeeNo), name: text(row?.name), factory: text(row?.factory),
      businessUnit: text(row?.businessUnit), departmentCode: text(row?.departmentCode), departmentName: text(row?.departmentName),
      identityType: text(row?.identityType), sourceRow: text(row?.sourceRow), status,
      statusLabel: status === row?.status ? text(row.statusLabel) || labels[status] : labels.review,
      reason: text(row?.reason), verifiedAt: text(row?.verifiedAt), verifiedEpoch: rosterVerifiedTimestamp(row?.verifiedAt),
    };
  }

  function render() {
    if (!state.loaded) return;
    const matches = selectEmployeeRosterRows(state.rows, currentFilters());
    $('rosterVerifiedHeader').setAttribute('aria-sort', state.sortDirection === 'desc' ? 'descending' : state.sortDirection === 'asc' ? 'ascending' : 'none');
    $('rosterSortDirection').textContent = state.sortDirection === 'desc' ? '▼（降冪）' : state.sortDirection === 'asc' ? '▲（升冪）' : '↕';
    $('rosterVerifiedSort').setAttribute('aria-label', '依最後確認時間排序：' + (state.sortDirection === 'desc' ? '由舊到新（升冪）' : '由新到舊（降冪）'));
    const pages = Math.max(1, Math.ceil(matches.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize, shown = matches.slice(start, start + state.pageSize);
    $('employeeRosterRows').innerHTML = shown.length ? shown.map(row => '<tr><td class="employee-code">' + esc(row.employeeNo) + '</td><td>' + esc(row.name || '未提供') + '</td><td>' + esc(row.factory || '未提供') + '</td><td>' + esc(row.businessUnit || '未提供') + '</td><td>' + esc([row.departmentCode, row.departmentName].filter(Boolean).join(' ')) + '</td><td>' + esc(row.identityType || '未提供') + '</td><td><span class="roster-pill ' + row.status + '">' + esc(row.statusLabel) + '</span></td><td class="roster-time">' + esc(verifiedTime(row.verifiedAt)) + '</td><td class="roster-reason">' + esc(row.reason || '—') + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">沒有符合搜尋或篩選條件的員工。</td></tr>';
    $('rosterResultStatus').textContent = '名冊共 ' + state.rows.length.toLocaleString('zh-TW') + ' 人，符合條件 ' + matches.length.toLocaleString('zh-TW') + ' 人。';
    $('rosterPageNote').textContent = shown.length ? '第 ' + (start + 1) + '–' + (start + shown.length) + ' 筆，第 ' + state.page + '／' + pages + ' 頁' : '第 0 筆，共 0 頁';
    $('rosterPrevious').disabled = state.page <= 1;
    $('rosterNext').disabled = !shown.length || state.page >= pages;
  }

  function currentFilters() {
    return { query: $('employeeRosterSearch').value, factory: $('employeeRosterFactory').value, identityType: $('employeeRosterIdentity').value, status: $('employeeRosterBinding').value, sortDirection: state.sortDirection };
  }

  async function exportRoster() {
    if (!state.loaded || state.loading || state.exporting) return;
    const version = state.version, filters = currentFilters();
    const controller = new AbortController();
    state.exportController = controller;
    state.exporting = true;
    controls();
    notice('正在匯出符合條件的全部名冊…');
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const authHeaders = await headers();
      if (version !== state.version || controller.signal.aborted) return;
      if (!authHeaders) {
        resetView('請先登入管理後台，再重新載入名冊。');
        notice('請先登入管理後台，再重新載入名冊。', true);
        return;
      }
      const params = new URLSearchParams({ format: 'xlsx', query: filters.query, factory: filters.factory, identityType: filters.identityType, status: filters.status, sort: filters.sortDirection });
      const response = await fetch('/admin-api/employee-roster?' + params, { method: 'GET', headers: authHeaders, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (version !== state.version || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        resetView('登入已失效或沒有名冊查看權限，請返回管理後台。');
        notice('登入已失效或沒有名冊查看權限，請返回管理後台。', true);
        return;
      }
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || 'Excel 匯出失敗，請稍後重試。');
      }
      if (!response.headers.get('Content-Type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) throw new Error('匯出格式錯誤，請重新載入後重試。');
      const blob = await response.blob();
      if (version !== state.version || controller.signal.aborted) return;
      const filename = /filename="(employee-roster-[0-9]+\.xlsx)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'employee-roster.xlsx';
      const href = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = href; link.download = filename; document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000); }
      const count = response.headers.get('X-Roster-Count');
      notice('已下載 Excel' + (/^\d+$/.test(count || '') ? '，共 ' + Number(count).toLocaleString('zh-TW') + ' 人' : '') + '。內容為下載時的最新子站紀錄。');
    } catch (error) {
      if (version !== state.version) return;
      notice(controller.signal.aborted ? 'Excel 匯出逾時，請重試。' : error.message || 'Excel 匯出失敗，請稍後重試。', true);
    } finally {
      clearTimeout(timeout);
      state.exporting = false;
      if (state.exportController === controller) state.exportController = null;
      controls();
    }
  }

  async function loadRoster() {
    state.exportController?.abort();
    const version = ++state.version;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    controls();
    notice('正在讀取子站員工名冊…');
    let timeout;
    try {
      const authHeaders = await headers();
      if (version !== state.version) return;
      if (!authHeaders) {
        resetView('請先登入管理後台，再重新載入名冊。');
        notice('請先登入管理後台，再重新載入名冊。');
        return;
      }
      timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch('/admin-api/employee-roster', { method: 'GET', headers: authHeaders, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (version !== state.version) return;
      if (response.status === 401 || response.status === 403) {
        resetView('登入已失效或沒有名冊查看權限，請返回管理後台。');
        notice('登入已失效或沒有名冊查看權限，請返回管理後台。', true);
        return;
      }
      if (response.status === 503) {
        resetView('名冊尚未匯入或暫時無法讀取，請稍後重新載入。');
        notice('名冊尚未匯入或暫時無法讀取，請稍後重新載入。');
        return;
      }
      if (!response.ok) throw new Error('read');
      const result = await response.json();
      if (version !== state.version) return;
      if (!result.success || result.source !== 'child-site' || !Array.isArray(result.rows)) throw new Error('response');
      const rows = result.rows.map(project);
      const summary = { total: rows.length, bound: 0, unbound: 0, review: 0 };
      for (const row of rows) summary[row.status] += 1;
      for (const key of Object.keys(summary)) if (!Number.isSafeInteger(result.summary?.[key]) || result.summary[key] !== summary[key]) throw new Error('summary');
      state.rows = rows;
      state.loaded = true;
      for (const [id, key, label] of [['employeeRosterFactory', 'factory', '全部廠別'], ['employeeRosterIdentity', 'identityType', '全部身分類別']]) {
        const select = $(id), previous = select.value;
        const values = [...new Set(rows.map(row => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-TW'));
        select.replaceChildren(new Option(label, ''));
        for (const value of values) select.add(new Option(value, value));
        if (values.includes(previous)) select.value = previous;
      }
      for (const [id, key] of [['rosterTotal', 'total'], ['rosterBound', 'bound'], ['rosterUnbound', 'unbound'], ['rosterReview', 'review']]) $(id).textContent = summary[key].toLocaleString('zh-TW');
      render();
      notice('已載入子站名冊。綁定狀態以子站目前紀錄顯示。');
    } catch (error) {
      if (version !== state.version) return;
      resetView('名冊讀取失敗，請重新載入。');
      notice(controller.signal.aborted ? '名冊讀取逾時，請重新載入。' : '名冊讀取失敗，請重新載入。', true);
    } finally {
      clearTimeout(timeout);
      if (version === state.version) { state.loading = false; controls(); }
    }
  }

  $('rosterExport').addEventListener('click', exportRoster);
  $('rosterReload').addEventListener('click', loadRoster);
  $('rosterVerifiedSort').addEventListener('click', () => { state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc'; state.page = 1; render(); });
  for (const id of ['employeeRosterSearch', 'employeeRosterFactory', 'employeeRosterIdentity', 'employeeRosterBinding']) $(id).addEventListener(id === 'employeeRosterSearch' ? 'input' : 'change', () => { state.page = 1; render(); });
  $('rosterPageSize').addEventListener('change', () => { state.pageSize = $('rosterPageSize').value === '100' ? 100 : 50; state.page = 1; render(); });
  $('rosterPrevious').addEventListener('click', () => { state.page = Math.max(1, state.page - 1); render(); });
  $('rosterNext').addEventListener('click', () => { state.page += 1; render(); });
  window.addEventListener('message', event => { if (event.source === parent && event.origin === location.origin && event.data?.type === 'sakura-admin-session-ready') loadRoster(); });
  window.addEventListener('storage', event => { if (event.key === 'sakura_admin_session') { resetView('正在確認管理登入狀態…'); loadRoster(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadRoster, { once: true }); else loadRoster();
}

export const employeeRosterHtml = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>員工名冊 | SAKURA Welfare</title><style>
:root{--ink:#14263a;--muted:#5b6c7f;--line:#dce4ed;--bg:#f4f7fa;--accent:#16654a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans TC",sans-serif}button,input,select{font:inherit}input,select{font-size:16px}button,a.action{min-height:42px;border:1px solid #cbd7e4;border-radius:8px;background:#fff;color:var(--ink);padding:8px 13px;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}button:disabled{opacity:.55;cursor:default}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #8bc4ed;outline-offset:2px}.page{max-width:1640px;margin:auto;padding:22px 24px 30px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}h1{font-size:26px;line-height:1.25;margin:0 0 8px}.scope{max-width:850px;margin:0;color:var(--muted)}.actions{display:flex;gap:8px;flex-wrap:wrap}.roster-view-nav{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.roster-view-nav a{display:inline-flex;align-items:center;min-height:42px;padding:8px 16px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);text-decoration:none;font-weight:750}.roster-view-nav a[aria-current=page]{background:var(--ink);border-color:var(--ink);color:#fff}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}.metric{border:1px solid var(--line);border-radius:10px;background:#fff;padding:14px 16px}.metric span{display:block;color:var(--muted);font-size:15px}.metric strong{display:block;font-size:27px;margin-top:5px}#rosterNotice{margin:12px 0;color:var(--muted)}#rosterNotice.error{color:#9e2538}.panel{min-width:0;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}.filters{display:grid;grid-template-columns:minmax(220px,1fr) minmax(140px,200px) minmax(160px,210px) minmax(150px,200px);gap:12px;padding:16px;border-bottom:1px solid var(--line)}.filters label{display:grid;gap:5px;font-size:15px;color:var(--muted);min-width:0}.filters input,.filters select,.page-size{min-height:42px;width:100%;min-width:0;border:1px solid #cbd7e4;border-radius:7px;background:#fff;padding:8px 10px;color:var(--ink)}.results{padding:10px 16px;margin:0;color:var(--muted);font-size:15px}.table-wrap{width:100%;overflow-x:auto}table{width:100%;min-width:1120px;border-collapse:collapse;font-size:16px}th,td{padding:11px 13px;text-align:left;border-bottom:1px solid #e6ecf3;vertical-align:top}th{background:#f3f6f9;color:#40546b;font-weight:750;white-space:nowrap}td.employee-code{font-variant-numeric:tabular-nums;white-space:nowrap}.time-sort{border:0;border-radius:4px;background:transparent;color:inherit;font-weight:inherit;min-height:42px;padding:0;gap:5px;white-space:nowrap}.time-sort:hover:not(:disabled){color:var(--accent);text-decoration:underline}.roster-time{white-space:nowrap}.roster-reason{min-width:220px;max-width:360px;overflow-wrap:anywhere}.roster-pill{display:inline-block;border-radius:999px;padding:3px 9px;white-space:nowrap;background:#edf1f5;color:#45566a}.roster-pill.bound{background:#e9f5ed;color:#22613b}.roster-pill.review{background:#fff2d6;color:#855900}.empty{padding:30px 18px;text-align:center;color:var(--muted)}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px}.pagination-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.page-label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:15px}.page-size{width:95px}.privacy{font-size:15px;color:var(--muted);margin:14px 0 0}@media(min-width:761px) and (max-width:1100px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.page{padding:16px 12px 24px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.filters{grid-template-columns:1fr;padding:12px}.top{display:block}.actions{margin-top:14px}.pagination{align-items:flex-start}.pagination-controls{width:100%}h1{font-size:23px}}
</style></head><body><main class="page"><header class="top"><div><h1>員工名冊</h1><p class="scope">顯示子站員工名冊及目前綁定紀錄。「未綁定」表示子站尚無對應綁定紀錄；列入名冊不會授予員工身分或福利權限。</p></div><div class="actions"><a class="action" href="/sakura-admin">返回管理後台</a><button class="primary" id="rosterExport" type="button" disabled>下載 Excel</button><button id="rosterReload" type="button">重新載入</button></div></header><nav class="roster-view-nav" aria-label="會員資料檢視"><a href="/crm-users?view=roster" aria-current="page">員工名冊</a><a href="/crm-users?view=line">LINE 用戶</a></nav><section class="metrics" aria-label="名冊統計"><div class="metric"><span>名冊總數</span><strong id="rosterTotal">—</strong></div><div class="metric"><span>已綁定</span><strong id="rosterBound">—</strong></div><div class="metric"><span>未綁定</span><strong id="rosterUnbound">—</strong></div><div class="metric"><span>待確認</span><strong id="rosterReview">—</strong></div></section><p id="rosterNotice" role="status" aria-live="polite">正在確認管理登入狀態…</p><section class="panel" aria-label="員工名冊列表"><div class="filters"><label for="employeeRosterSearch">搜尋工號、姓名或部門<input id="employeeRosterSearch" type="search" placeholder="輸入工號、姓名、部門代碼或名稱" autocomplete="off" disabled></label><label for="employeeRosterFactory">廠別<select id="employeeRosterFactory" disabled><option value="">全部廠別</option></select></label><label for="employeeRosterIdentity">身分類別<select id="employeeRosterIdentity" disabled><option value="">全部身分類別</option></select></label><label for="employeeRosterBinding">子站綁定狀態<select id="employeeRosterBinding" disabled><option value="">全部狀態</option><option value="bound">已綁定</option><option value="unbound">未綁定</option><option value="review">待確認</option></select></label></div><p id="rosterResultStatus" class="results" role="status" aria-live="polite"></p><p class="results">Excel 依目前搜尋、廠別、身分類別、綁定狀態與排序，匯出全部符合條件的名單。</p><div class="table-wrap" tabindex="0" aria-label="員工名冊，可左右捲動"><table><thead><tr><th scope="col">工號</th><th scope="col">姓名</th><th scope="col">廠別</th><th scope="col">處別</th><th scope="col">部門</th><th scope="col">身分類別</th><th scope="col">子站綁定</th><th scope="col" id="rosterVerifiedHeader" aria-sort="none"><button id="rosterVerifiedSort" class="time-sort" type="button" aria-label="依最後確認時間排序：由新到舊（降冪）" disabled>最後確認（臺北） <span id="rosterSortDirection" aria-hidden="true">↕</span></button></th><th scope="col">說明</th></tr></thead><tbody id="employeeRosterRows"><tr><td colspan="9" class="empty">登入後載入名冊。</td></tr></tbody></table></div><div class="pagination"><span id="rosterPageNote">尚未載入名冊</span><div class="pagination-controls"><label class="page-label" for="rosterPageSize">每頁<select id="rosterPageSize" class="page-size" disabled><option value="50">50 筆</option><option value="100">100 筆</option></select></label><button id="rosterPrevious" type="button" disabled>上一頁</button><button id="rosterNext" type="button" disabled>下一頁</button></div></div></section><p class="privacy">此頁僅供授權管理員查看子站紀錄。重新載入只讀取名冊，不會建立 LINE 用戶或觸發母站同步。</p></main><script>(()=>{const __name=fn=>fn;const rosterVerifiedTimestamp=${rosterVerifiedTimestamp.toString()};const selectEmployeeRosterRows=${selectEmployeeRosterRows.toString()};(${employeeRosterRuntime.toString()})();})();</script></body></html>`;

export function decorateCrmUsersWithRosterLink(html) {
  if (typeof html !== 'string' || html.includes('id="crmRosterViewLinks"')) return html;
  const marker = '<div class="metrics" id="metrics"></div>';
  if (!html.includes(marker)) return html;
  const links = '<nav id="crmRosterViewLinks" class="crm-roster-switch" aria-label="會員資料檢視"><a href="/crm-users?view=roster">員工名冊</a><a href="/crm-users?view=line" aria-current="page">LINE 用戶</a></nav>';
  const style = '<style id="crmRosterViewStyle">.crm-roster-switch{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.crm-roster-switch a{display:inline-flex;align-items:center;min-height:40px;padding:8px 14px;border:1px solid #dce5ef;border-radius:8px;background:#fff;color:#14263a;text-decoration:none;font-weight:750}.crm-roster-switch a[aria-current=page]{background:#14263a;border-color:#14263a;color:#fff}.crm-roster-switch a:focus-visible{outline:3px solid #8bc4ed;outline-offset:2px}</style>';
  return html.replace(marker, links + marker).replace('</head>', style + '</head>');
}
