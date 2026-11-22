export function formatCrmDateTime(value, naiveZone = 'UTC') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw = raw.replace(' ', 'T') + (naiveZone === 'Asia/Taipei' ? '+08:00' : 'Z');
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = Object.fromEntries(parts.filter(v => v.type !== 'literal').map(v => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function decorateCrmUsersHtml(html) {
  html = html.replace('esc(u.last_interaction_at || u.updated_at || "")', 'esc(formatCrmDateTime(u.last_interaction_at || u.updated_at, u.last_interaction_at ? "UTC" : "Asia/Taipei"))');
  html = html.replace('esc(u.bind_status || "unbound")', 'esc(u.bind_status === "bound" ? "已同步綁定" : "待母站確認")');
  html = html.replace('if (!selected && users[0]) openUser(users[0].line_user_id);', 'if (selected) openUser(selected.line_user_id); else if (users[0]) openUser(users[0].line_user_id);');
  html = html.replace('field("選單套用時間", selected.rich_menu_checked_at)', 'field("母站報到時間", formatCrmDateTime(selected.mother_reported_at, "Asia/Taipei")) + field("子站同步時間", formatCrmDateTime(selected.verified_at, "Asia/Taipei")) + field("選單套用時間", formatCrmDateTime(selected.rich_menu_checked_at, "Asia/Taipei"))');
  html = html.replace('<h2>CRM 用戶列表</h2>', '<div><h2>CRM 用戶列表</h2><div class="sub">時間：臺灣 UTC+8；待母站確認不代表使用者未操作。</div></div>');
  html = html.replace('<div id="tableWrap">', '<div class="crm-scroll-controls" role="group" aria-label="用戶列表左右移動"><span>左右移動列表</span><button type="button" id="crmScrollLeft" aria-label="用戶列表向左移動" aria-controls="tableWrap" disabled>← 向左</button><button type="button" id="crmScrollRight" aria-label="用戶列表向右移動" aria-controls="tableWrap" disabled>向右 →</button></div><div id="tableWrap">');
  html = html.replace('</style>', '#tableWrap{overflow-x:auto;overscroll-behavior-x:contain}.panel-head{flex-wrap:wrap}.crm-scroll-controls{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:1px solid var(--line);color:var(--muted);font-size:12px}.crm-scroll-controls button{min-height:36px;padding:0 12px;border:1px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;font-weight:700;cursor:pointer}.crm-scroll-controls button:hover:not(:disabled){background:#1e40af;border-color:#1e40af}.crm-scroll-controls button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}.crm-scroll-controls button:disabled{background:#e2e8f0;border-color:#cbd5e1;color:#64748b;cursor:not-allowed}@media(max-width:480px){.crm-scroll-controls{justify-content:flex-start}.crm-scroll-controls span{flex-basis:100%}}</style>');
  const start = '    load().catch((err) =>';
  const client = `
    ${formatCrmDateTime.toString()}
    const crmTableWrap = document.getElementById('tableWrap');
    const crmScrollLeft = document.getElementById('crmScrollLeft');
    const crmScrollRight = document.getElementById('crmScrollRight');
    function updateCrmScrollControls() {
      const remaining = crmTableWrap.scrollWidth - crmTableWrap.clientWidth;
      crmScrollLeft.disabled = crmTableWrap.scrollLeft <= 1;
      crmScrollRight.disabled = remaining <= 1 || crmTableWrap.scrollLeft >= remaining - 1;
    }
    function moveCrmTable(direction) {
      crmTableWrap.scrollBy({ left: direction * Math.max(220, Math.round(crmTableWrap.clientWidth * 0.75)), behavior: 'smooth' });
    }
    crmScrollLeft.addEventListener('click', () => moveCrmTable(-1));
    crmScrollRight.addEventListener('click', () => moveCrmTable(1));
    crmTableWrap.addEventListener('scroll', updateCrmScrollControls, { passive: true });
    window.addEventListener('resize', updateCrmScrollControls);
    new MutationObserver(updateCrmScrollControls).observe(crmTableWrap, { childList: true, subtree: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(updateCrmScrollControls).observe(crmTableWrap);
    updateCrmScrollControls();
    let autoSyncRunning = false;
    const autoNote = document.createElement('div');
    autoNote.className = 'hint';
    autoNote.id = 'bindingAutoSyncStatus';
    document.getElementById('metrics').before(autoNote);
    const journal=document.createElement('details');journal.id='bindingHistory';journal.open=true;
    journal.innerHTML='<summary>櫻花報到紀錄</summary><p id="bindingHistoryNote" class="hint">登入後顯示報到與 Telegram 通知紀錄。</p><div style="overflow:auto;max-height:260px"><table><thead><tr><th>臺灣時間</th><th>用戶</th><th>報到狀態</th><th>Telegram 通知</th></tr></thead><tbody id="bindingHistoryRows"></tbody></table></div>';
    document.getElementById('metrics').after(journal);
    async function loadBindingHistory(headers){
      if(!headers)return;
      const note=document.getElementById('bindingHistoryNote');
      try{
        const response=await fetch('/admin-api/employee-binding-history',{headers,cache:'no-store',signal:AbortSignal.timeout(10000)});
        const result=await response.json();if(!response.ok||!result.success)throw Error('history');
        const labels={pending:'待發送',sending:'發送中',sent:'Telegram 已發送',retry:'稍後重試',disabled:'通知未啟用',missing_credentials:'通知設定未完成',failed:'發送失敗',unknown:'送達狀態待確認'};
        document.getElementById('bindingHistoryRows').innerHTML=(result.records||[]).map(row=>'<tr><td>'+esc(formatCrmDateTime(row.created_at))+'</td><td>'+esc(row.display_name||row.line_user_id)+'</td><td>'+esc(row.summary)+'</td><td>'+esc(labels[row.notification_state]||'—')+'</td></tr>').join('');
        note.textContent=result.records?.length?'最近 '+result.records.length+' 筆；保留報到開始、綁定完成及通知結果。':'目前尚無報到紀錄；新的三語報到會自動記錄。';
      }catch{note.textContent='報到紀錄讀取失敗，請確認登入後重新整理。';}
    }
    async function autoBindingHeaders() {
      try {
        if (parent !== window && parent.location.origin === location.origin && typeof parent.sakuraAdminEnsureSession === 'function') {
          if (!await parent.sakuraAdminEnsureSession()) return null;
        }
        const session = JSON.parse(localStorage.getItem('sakura_admin_session') || 'null');
        if (session && session.token) return { Authorization: 'Bearer ' + session.token };
        const sdk = window.liff || (parent !== window && parent.location.origin === location.origin ? parent.liff : null);
        if (sdk && sdk.isLoggedIn() && sdk.getIDToken()) return { 'X-Line-Id-Token': sdk.getIDToken() };
      } catch {}
      return null;
    }
    async function refreshBindingState() {
      if (autoSyncRunning || document.hidden) return;
      autoSyncRunning = true;
      try {
        const headers = await autoBindingHeaders();
        if (headers) {
          autoNote.textContent = '正在核對母站已完成的員工綁定…';
          const response = await fetch('/admin-api/employee-binding-sync/refresh', {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
            cache: 'no-store', signal: AbortSignal.timeout(30000)
          });
          const result = await response.json();
          autoNote.textContent = response.ok && result.success
            ? (result.state === 'busy' ? '母站同步進行中，稍後自動更新。' : '母站核對時間：' + formatCrmDateTime(result.checkedAt) + '（臺灣時間）。')
            : '母站同步未完成，列表暫以子站資料顯示，不能據此判斷尚未綁定。';
        } else autoNote.textContent = '請由已登入的管理後台開啟以即時同步；系統另有每五分鐘自動補同步。';
        await load();
        await loadBindingHistory(headers);
      } catch {
        autoNote.textContent = '母站同步暫時失敗，稍後會重試；原有綁定資料保留。';
      } finally { autoSyncRunning = false; }
    }
    window.addEventListener('message', e => {
      if (e.source === parent && e.origin === location.origin && e.data?.type === 'sakura-admin-session-ready') refreshBindingState();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBindingState(); });
    setInterval(refreshBindingState, 60000);
`;
  return html.replace(start, client + '\n    load().then(refreshBindingState).catch((err) =>');
}
