const fs = require("fs");

let html = fs.readFileSync("reference-gas-admin-user.html", "utf8");

if (!html.includes("https://static.line-scdn.net/liff/edge/2/sdk.js")) {
  html = html.replace(
    "</head>",
    '  <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n</head>'
  );
}

const shim = String.raw`
<style>
  #nav-richmenu,
  #nav-calendar,
  #nav-admin,
  #richmenu-tools,
  #menu-workspace,
  #admin-workspace,
  #calendar-pop {
    display: none !important;
  }
  .app-panel {
    display: none !important;
  }
  .app-sub-sidebar {
    display: none !important;
  }
  .app-main {
    right: 0 !important;
  }
  body.sub-sidebar-open .app-main,
  body.sidebar-collapsed.sub-sidebar-open .app-main {
    left: var(--sidebar-width) !important;
  }
  body.sidebar-collapsed .app-main {
    left: var(--sidebar-collapsed-width) !important;
  }
  #auth-layer {
    display: none !important;
  }
  #main-app {
    display: block !important;
  }
  #nav-custom,
  #nav-capture {
    display: flex !important;
  }
  #label-project-name::after {
    content: " / 自由版與網址擷取器";
    color: #94a3b8;
  }
</style>
<script>
(function SakuraWorkerBridge(){
  const DEFAULT_LIFF_ID = '2009117474-pwyW1R4u';
  const PENDING_SHARE_KEY = 'sakura_gas_original_pending_flex_share';
  const apiBase = location.origin;

  function callSuccess(fn, value) { setTimeout(function(){ if (typeof fn === 'function') fn(value); }, 0); }
  function callFailure(fn, err) { setTimeout(function(){ if (typeof fn === 'function') fn(err); else console.error(err); }, 0); }
  async function postFlex(action, data) {
    const res = await fetch(apiBase + '/admin-api/flex-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Flex API 執行失敗');
    return json;
  }
  async function listFlex() {
    const res = await fetch(apiBase + '/admin-api/flex-templates');
    const json = await res.json();
    if (!json.success) throw new Error(json.message || '讀取 Flex 版型失敗');
    return (json.templates || []).map(function(item){
      const category = item.category || 'flex_v2';
      const sheet = category.includes('v1') ? 'flex_v1' : (category.includes('v3') ? 'flex_v3' : 'flex_v2');
      return {
        filename: item.name || item.keyword || ('Flex ' + item.id),
        time: item.updated_at || item.created_at || '',
        json: JSON.stringify(item.payload || {}),
        image: '',
        sheet,
        id: item.id
      };
    });
  }
  function saveFlexFromGas(method, data, success, failure) {
    const mode = method === 'saveFlexV1' ? 'flex_v1' : (method === 'saveFlexV3' ? 'flex_v3' : 'flex_v2');
    let payload = {};
    try { payload = JSON.parse(data && data.json || '{}'); } catch (err) { callFailure(failure, err); return; }
    postFlex('template.save', {
      keyword: data.filename || mode,
      name: data.filename || mode,
      category: mode,
      note: 'Imported from GAS original editor',
      replyType: 'FLEX',
      active: true,
      payload
    }).then(function(result){ callSuccess(success, { success: true, id: result.data && result.data.id }); })
      .catch(function(err){ callFailure(failure, err); });
  }
  function createRunner(success, failure) {
    return new Proxy({}, {
      get: function(_, prop) {
        if (prop === 'withSuccessHandler') return function(fn){ return createRunner(fn, failure); };
        if (prop === 'withFailureHandler') return function(fn){ return createRunner(success, fn); };
        return function() {
          const args = Array.prototype.slice.call(arguments);
          try {
            if (prop === 'loginUser') {
              callSuccess(success, { success: true, user: { username: 'admin', name: 'SAKURA Admin', permissions: '12345', rmQuota: '∞', flexQuota: '∞', company: 'SAKURA' } });
            } else if (prop === 'getAllFlexProjects') {
              listFlex().then(function(files){ callSuccess(success, files); }).catch(function(err){ callFailure(failure, err); });
            } else if (prop === 'getMyMenus') {
              callSuccess(success, []);
            } else if (prop === 'saveFlexV1' || prop === 'saveFlexV2' || prop === 'saveFlexV3') {
              saveFlexFromGas(prop, args[0] || {}, success, failure);
            } else if (prop === 'saveRichMenu') {
              callSuccess(success, { success: true, msg: 'Rich Menu 已暫存於 Worker 版本' });
            } else if (prop === 'publishRichMenuToLine') {
              callSuccess(success, { success: false, msg: '請改用系統內 Rich Menu 設定頁部署。' });
            } else if (prop === 'uploadImageToDrive') {
              const base64 = args[0] || '';
              fetch(apiBase + '/api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'UPLOAD_IMAGE', payload: { imageBase64: base64 } })
              }).then(function(r){ return r.json(); })
                .then(function(j){ callSuccess(success, { success: !!(j.data && j.data.url), url: j.data && j.data.url || base64 }); })
                .catch(function(){ callSuccess(success, { success: true, url: base64 }); });
            } else if (prop === 'getMenuImageBase64') {
              callSuccess(success, args[0] || '');
            } else if (prop === 'getAllUsers') {
              callSuccess(success, { success: true, data: [] });
            } else if (prop === 'saveUserData') {
              callSuccess(success, { success: true });
            } else if (prop === 'fetchMonthEvents') {
              callSuccess(success, { success: true, data: [] });
            } else if (prop === 'getLineVoomMedia') {
              callSuccess(success, { success: false, error: 'Worker 版尚未接入 VOOM 擷取後端' });
            } else {
              callSuccess(success, { success: true, data: [] });
            }
          } catch (err) { callFailure(failure, err); }
        };
      }
    });
  }
  window.google = window.google || { script: { run: createRunner() } };
  if (!window.google.script) window.google.script = { run: createRunner() };
  if (!window.google.script.run) window.google.script.run = createRunner();

  function getJsonPayload() {
    const el = document.getElementById('json-output');
    if (!el || !el.value.trim()) throw new Error('目前沒有可分享的 Flex JSON，請先選擇或產生名片版型。');
    return JSON.parse(el.value);
  }
  function buildShareMessage() {
    const filename = document.getElementById('save-filename');
    return { type: 'flex', altText: (filename && filename.value) || '櫻花 Flex 訊息', contents: getJsonPayload() };
  }
  function savePendingShare(message) {
    localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({ createdAt: Date.now(), message }));
  }
  function readPendingShare() {
    try {
      const data = JSON.parse(localStorage.getItem(PENDING_SHARE_KEY) || 'null');
      if (!data || !data.message) return null;
      if (Date.now() - Number(data.createdAt || 0) > 10 * 60 * 1000) return null;
      return data.message;
    } catch (err) { return null; }
  }
  function isInFrame() {
    try { return window.top !== window.self; } catch (err) { return true; }
  }
  async function shareByLiff(message) {
    if (!window.liff) throw new Error('LIFF SDK 尚未載入。');
    const liffId = localStorage.getItem('sakura_liff_id') || DEFAULT_LIFF_ID;
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return false;
    }
    if (!liff.isApiAvailable('shareTargetPicker')) throw new Error('Share Target Picker 尚未開啟，請確認 LIFF 權限與條款。');
    return !!(await liff.shareTargetPicker([message]));
  }
  async function shareCurrentFlex() {
    try {
      const message = buildShareMessage();
      savePendingShare(message);
      if (isInFrame()) {
        const u = new URL('/flex-template-editor', location.origin);
        u.searchParams.set('share', '1');
        u.searchParams.set('t', Date.now().toString());
        window.top.location.href = u.toString();
        return;
      }
      const sent = await shareByLiff(message);
      if (sent) {
        localStorage.removeItem(PENDING_SHARE_KEY);
        if (typeof showToast === 'function') showToast('已開啟 LINE 通訊錄');
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes('not allowed')) {
        alert('LIFF 分享權限已更新，將清除舊 Token 並重新登入。');
        try { liff.logout(); } catch (_) {}
        location.reload();
      } else alert(msg);
    }
  }
  window.sakuraShareCurrentFlex = shareCurrentFlex;

  function liffStateRequestsShare() {
    const params = new URLSearchParams(location.search);
    if (params.get('share') === '1') return true;
    const liffState = params.get('liff.state');
    if (!liffState) return false;
    try {
      const stateUrl = new URL(decodeURIComponent(liffState), location.origin);
      return stateUrl.pathname === '/flex-template-editor' && stateUrl.searchParams.get('share') === '1';
    } catch (err) { return false; }
  }
  function bootstrapWorkerMode() {
    const auth = document.getElementById('auth-layer');
    const app = document.getElementById('main-app');
    if (auth) auth.classList.add('workspace-hidden');
    if (app) app.classList.remove('hidden');
    window.currentUser = { username: 'admin', name: 'SAKURA Admin', permissions: '12345', rmQuota: '∞', flexQuota: '∞' };
    const userInfo = document.getElementById('user-info');
    if (userInfo) userInfo.textContent = 'SAKURA Admin';
    const flexTools = document.getElementById('flex-tools');
    if (flexTools && !document.getElementById('sakura-share-flex-btn')) {
      const btn = document.createElement('button');
      btn.id = 'sakura-share-flex-btn';
      btn.className = 'px-6 py-2 bg-[#06C755] text-white rounded-md text-sm font-black uppercase shadow-sm';
      btn.textContent = '分享好友';
      btn.onclick = shareCurrentFlex;
      flexTools.appendChild(btn);
    }
    const richMenuNav = document.getElementById('nav-richmenu');
    const calendarNav = document.getElementById('nav-calendar');
    const adminNav = document.getElementById('nav-admin');
    const richMenuTools = document.getElementById('richmenu-tools');
    [richMenuNav, calendarNav, adminNav, richMenuTools].forEach(function(el){ if (el) el.remove(); });
    const sidebarTitle = document.getElementById('sub-sidebar-title');
    if (sidebarTitle) sidebarTitle.textContent = '自由版 Flex 專案';
    const addBtn = document.getElementById('btn-add-new');
    if (addBtn) addBtn.textContent = '＋ 建立 Flex 版型';
    function forceFlexHome() {
      document.body.classList.remove('sub-sidebar-open', 'full-workspace');
      const ids = ['template-selector', 'menu-workspace', 'flex-workspace-v1', 'flex-workspace-v2', 'v3-workspace', 'capture-workspace', 'admin-workspace'];
      ids.forEach(function(id){
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'template-selector') el.classList.remove('workspace-hidden');
        else el.classList.add('workspace-hidden');
      });
      const flexTools = document.getElementById('flex-tools');
      const panelEditor = document.getElementById('panel-editor-ui');
      if (flexTools) flexTools.classList.add('workspace-hidden');
      if (panelEditor) panelEditor.classList.add('workspace-hidden');
      const filename = document.getElementById('save-filename');
      if (filename) filename.value = '';
    }
    const originalCreateNewFlex = window.createNewFlex;
    window.createNewFlex = function(t) {
      document.body.classList.remove('sub-sidebar-open');
      if (typeof openWorkspace === 'function') openWorkspace(t);
      else if (typeof originalCreateNewFlex === 'function') originalCreateNewFlex(t);
      if (window['loadFlexTemplate_' + t]) window['loadFlexTemplate_' + t]();
    };
    const customNav = document.getElementById('nav-custom');
    if (customNav) {
      customNav.onclick = function() {
        forceFlexHome();
      };
    }
    const captureNav = document.getElementById('nav-capture');
    if (captureNav) {
      captureNav.onclick = function() {
        document.body.classList.remove('sub-sidebar-open');
        if (typeof openCaptureWorkspace === 'function') openCaptureWorkspace();
      };
    }
    window.handleCreateNew = function() {
      forceFlexHome();
    };
    if (!window.__sakuraOriginalOpenSubSidebar && typeof window.openSubSidebar === 'function') {
      window.__sakuraOriginalOpenSubSidebar = window.openSubSidebar;
      window.openSubSidebar = function(cat) {
        if (cat === 'custom' && typeof openWorkspace === 'function') {
          forceFlexHome();
          return;
        }
        if (cat !== 'custom') window.__sakuraOriginalOpenSubSidebar(cat);
      };
    }
    try {
      forceFlexHome();
    } catch (err) { console.warn(err); }
    if (liffStateRequestsShare()) {
      setTimeout(function(){
        const pending = readPendingShare();
        if (pending) shareByLiff(pending)
          .then(function(sent){ if (sent) localStorage.removeItem(PENDING_SHARE_KEY); })
          .catch(function(err){ alert(err.message || err); });
      }, 500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(bootstrapWorkerMode, 50); });
  else setTimeout(bootstrapWorkerMode, 50);
})();
</script>
`;

html = html.replace("</body>", shim + "\n</body>");
fs.writeFileSync("src/flex-template-editor.html", html, "utf8");
console.log("wrote src/flex-template-editor.html", html.length);
