const fs = require("fs");
const path = require("path");

const root = process.cwd();
const htmlPath = path.join(root, "src", "vendor-management.html");
const indexPath = path.join(root, "src", "index.js");

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>廠商註冊管理 | SAKURA Welfare</title>
  <style>
    :root{--green:#06c755;--ink:#0f172a;--muted:#64748b;--line:#dbe3ee;--bg:#f5f7fa;--red:#df1124;--blue:#2563eb;--amber:#f59e0b}
    *{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;font-size:14px;overflow:hidden}
    button,input,select,textarea{font:inherit}button{cursor:pointer}.wrap{height:100vh;padding:8px 18px 18px;display:flex;flex-direction:column;gap:10px}.hint{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.5}.muted{color:var(--muted);font-size:12px;line-height:1.45}.name{font-weight:900}
    .tabs{display:flex;gap:8px;overflow:auto;border-bottom:1px solid var(--line);min-height:42px}.tab{border:0;background:transparent;padding:9px 12px 10px;font-weight:900;color:#475569;border-bottom:3px solid transparent;white-space:nowrap}.tab.active{color:var(--red);border-bottom-color:var(--red)}
    .stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.stat{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px}.stat span{display:block;color:var(--muted);font-size:12px;font-weight:800}.stat b{display:block;margin-top:3px;font-size:21px;line-height:1.1}
    #view{min-height:0;flex:1;overflow:auto}.panel{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);font-size:16px;font-weight:900}.panel-note{font-size:12px;color:var(--muted);font-weight:700}
    .application-list{display:grid;gap:10px}.application{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}.application.pending{border-color:#facc15;background:#fffdf2}.app-head{display:grid;grid-template-columns:minmax(220px,1.15fr) repeat(5,minmax(100px,.55fr)) 230px;gap:10px;align-items:start;padding:12px 14px;border-bottom:1px solid var(--line);background:#fff}.app-title{font-size:16px;font-weight:950}.app-code{color:#64748b;margin-top:3px}.app-cell span{display:block;color:#64748b;font-size:12px;font-weight:900;margin-bottom:4px}.app-cell b{font-weight:850}.app-body{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px 14px}.info{border:1px solid #edf1f7;border-radius:8px;background:#fbfdff;padding:10px}.info h3{margin:0 0 8px;font-size:13px}.kv{display:grid;grid-template-columns:86px minmax(0,1fr);gap:6px;padding:4px 0}.kv span{color:#64748b;font-weight:800}.kv b{font-weight:650;word-break:break-word}.note{white-space:pre-wrap;line-height:1.7;color:#334155}
    .actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.btn{min-height:34px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:0 10px;font-weight:900;color:var(--ink)}.btn.green{background:var(--green);border-color:var(--green);color:#fff}.btn.red{background:var(--red);border-color:var(--red);color:#fff}.btn.amber{background:#fff7ed;border-color:#fed7aa;color:#c2410c}.btn.blue{background:var(--blue);border-color:var(--blue);color:#fff}.btn.ghost{background:#f8fafc}
    .badge{display:inline-flex;align-items:center;min-height:24px;border-radius:999px;padding:0 9px;font-size:12px;font-weight:900;background:#eef2ff;color:#3730a3}.pending,.pending_review{background:#fef3c7;color:#92400e}.approved,.active,.success,.confirmed{background:#dcfce7;color:#166534}.rejected,.suspended,.inactive,.failed,.archived{background:#fee2e2;color:#991b1b}.draft,.visitor{background:#f1f5f9;color:#475569}.employee{background:#dbeafe;color:#1d4ed8}.new{background:#e0f2fe;color:#075985}.renewing{background:#fef3c7;color:#92400e}.expired,.voided{background:#fee2e2;color:#991b1b}
    .toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.search{width:320px;max-width:100%;height:36px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fff}.empty{padding:26px;text-align:center;color:var(--muted)}.toast{position:fixed;right:18px;bottom:18px;background:#111827;color:#fff;border-radius:8px;padding:12px 14px;box-shadow:0 12px 30px rgba(15,23,42,.22);display:none;z-index:20}.toast.show{display:block}
    .table-wrap{min-height:0;overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}th{background:#f8fafc;color:#475569;font-size:12px;font-weight:900;position:sticky;top:0;z-index:1}td{font-size:13px}.widecell{white-space:normal;min-width:280px}.money{font-variant-numeric:tabular-nums;font-weight:900}
    .formline{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:14px}.field label{display:block;margin-bottom:5px;font-size:12px;color:#475569;font-weight:900}.field input,.field select,.field textarea{width:100%;border:1px solid #cfd8e6;border-radius:8px;padding:9px 10px;background:#fff;min-height:38px}.field textarea{min-height:80px;resize:vertical}.full{grid-column:1/-1}.reply{border:1px solid #bbf7d0;background:#ecfdf5;border-radius:8px;padding:12px;line-height:1.8;white-space:pre-wrap}.map-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:14px}.map-cell{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px;font-weight:900}
    @media(max-width:1260px){body{overflow:auto}.wrap{height:auto}.stats{grid-template-columns:repeat(3,1fr)}#view{overflow:visible}.app-head{grid-template-columns:1fr 1fr}.app-body{grid-template-columns:1fr 1fr}.actions{justify-content:flex-start}.formline{grid-template-columns:1fr 1fr}.map-grid{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:720px){.stats{grid-template-columns:repeat(2,1fr)}.app-head,.app-body,.formline{grid-template-columns:1fr}.map-grid{grid-template-columns:repeat(2,1fr)}.wrap{padding:10px 12px}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="tabs">
      <button class="tab active" data-tab="vendor-review">廠商註冊審核</button>
      <button class="tab" data-tab="vendors">特約店家資料</button>
      <button class="tab" data-tab="offers">商品與優惠上架</button>
      <button class="tab" data-tab="offer-review">優惠審核待辦</button>
      <button class="tab" data-tab="store-map">全省特約店地圖</button>
      <button class="tab" data-tab="ocr">AI OCR 上架助手</button>
      <button class="tab" data-tab="redemptions">消費折抵</button>
      <button class="tab" data-tab="points">點數讀寫</button>
      <button class="tab" data-tab="ai">多語與 AI 詢問</button>
      <button class="tab" data-tab="knowledge">知識庫</button>
      <button class="tab" data-tab="reports">報表</button>
    </div>
    <section class="stats">
      <div class="stat"><span>廠商總數</span><b id="sVendorTotal">0</b></div>
      <div class="stat"><span>待審廠商</span><b id="sVendorPending">0</b></div>
      <div class="stat"><span>已核准廠商</span><b id="sVendorApproved">0</b></div>
      <div class="stat"><span>優惠總數</span><b id="sOfferTotal">0</b></div>
      <div class="stat"><span>待審優惠</span><b id="sOfferPending">0</b></div>
      <div class="stat"><span>折抵筆數</span><b id="sRedemptionTotal">0</b></div>
    </section>
    <section id="view"></section>
  </div>
  <div id="toast" class="toast"></div>
  <script>
    const moduleTabMap = { "vendor-review":"vendor-review", vendors:"vendors", offers:"offers", ocr:"ocr", "offer-review":"offer-review", "store-map":"store-map", redemptions:"redemptions", points:"points", "mother-api":"points", ai:"ai", knowledge:"knowledge", reports:"reports" };
    const initialTab = moduleTabMap[new URL(location.href).searchParams.get("module") || "vendor-review"] || "vendor-review";
    const state = { tab: initialTab, q: "", data: { vendors: [], offers: [], locations: [], redemptions: [], summary: {} } };
    const cats = ["食","衣","住","行","育","樂","醫療","運動","生活服務","其他"];
    const cities = ["基隆市","台北市","新北市","桃園市","新竹縣市","苗栗縣","台中市","彰化縣","南投縣","雲林縣","嘉義縣市","台南市","高雄市","屏東縣","宜花東","澎湖/金門/馬祖"];
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));
    const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
    const money = (v) => Number(v || 0).toLocaleString("zh-TW");
    const timeValue = (v) => Date.parse(v.created_at || v.updated_at || v.reviewed_at || "") || 0;
    function toast(text){ const el = $("#toast"); el.textContent = text; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2400); }
    function label(v){ return ({pending:"待審",approved:"已核准",suspended:"停權",rejected:"退回",draft:"草稿",pending_review:"待審",archived:"封存",active:"啟用",inactive:"停用",new:"新合作",renewing:"續約中",expired:"已到期",confirmed:"已確認",voided:"作廢",employee:"員工",visitor:"用戶",committee:"福委會",vendor:"廠商"}[v] || v || ""); }
    function badge(v){ return '<span class="badge ' + esc(v || "") + '">' + esc(label(v)) + '</span>'; }
    function kv(k,v){ return '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(v || "未填") + '</b></div>'; }
    function linkText(v){ return v ? '<a href="' + esc(v) + '" target="_blank" rel="noopener">查看</a>' : '未附'; }
    async function post(action, data = {}) {
      const r = await fetch("/admin-api/vendor-management", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ action, data }) });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || "操作失敗");
      return j;
    }
    async function load() {
      const r = await fetch("/admin-api/vendor-management?ts=" + Date.now(), { cache:"no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || "讀取失敗");
      state.data = j;
      render();
    }
    function setTab(tab){ state.tab = tab; state.q = ""; $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab)); render(); }
    function searchBox(placeholder){ return '<input class="search" id="searchBox" value="' + esc(state.q) + '" placeholder="' + esc(placeholder || "搜尋") + '">'; }
    function applySearch(list){ const q = state.q.trim().toLowerCase(); if(!q) return list; return list.filter(x => JSON.stringify(x).toLowerCase().includes(q)); }
    function sortedVendors(){ return applySearch((state.data.vendors || []).slice().sort((a,b) => timeValue(b) - timeValue(a))); }
    function sortedOffers(){ return applySearch((state.data.offers || []).slice().sort((a,b) => timeValue(b) - timeValue(a))); }
    function bindSearch(){ const box = $("#searchBox"); if(box) box.oninput = () => { state.q = box.value; render(); }; }
    function applicationList(title, note, vendors) {
      return '<div class="toolbar"><div><div class="name">' + esc(title) + '</div><div class="hint">' + esc(note) + '</div></div>' + searchBox("搜尋廠商、統編、聯絡人、LINE、狀態") + '</div><div class="application-list">' + (vendors.length ? vendors.map(vendorCard).join("") : '<div class="empty">目前沒有廠商申請。</div>') + '</div>';
    }
    function vendorCard(v) {
      const missing = [];
      if(!v.business_license_url) missing.push("缺營登");
      if(!v.insurance_policy_no && !v.insurance_file_url) missing.push("缺保險");
      if(!v.contract_end) missing.push("合約未填");
      const fileText = missing.length ? missing.join(" / ") : "文件齊備";
      return '<article class="application ' + esc(v.status || "") + '">' +
        '<div class="app-head">' +
          '<div><div class="app-title">' + esc(v.name || "未命名廠商") + '</div><div class="app-code">' + esc(v.vendor_code || v.id || "") + '</div><div class="muted">申請時間：' + esc(v.created_at || v.updated_at || "未記錄") + '</div></div>' +
          '<div class="app-cell"><span>分類</span><b>' + esc(v.category || "未分類") + '</b></div>' +
          '<div class="app-cell"><span>統編</span><b>' + esc(v.tax_id || "未填") + '</b></div>' +
          '<div class="app-cell"><span>審核</span>' + badge(v.status) + '</div>' +
          '<div class="app-cell"><span>合作</span>' + badge(v.cooperation_status || "new") + '</div>' +
          '<div class="app-cell"><span>文件</span><b>' + esc(fileText) + '</b></div>' +
          '<div class="actions"><button class="btn green" data-vendor-status="approved" data-id="' + esc(v.id) + '">核准</button><button class="btn amber" data-vendor-status="rejected" data-id="' + esc(v.id) + '">退回</button><button class="btn red" data-vendor-status="suspended" data-id="' + esc(v.id) + '">停權</button></div>' +
        '</div>' +
        '<div class="app-body">' +
          '<section class="info"><h3>公司登記</h3>' + kv("登記名", v.legal_name) + kv("負責人", v.owner_name) + kv("地址", v.company_address) + kv("發票", v.invoice_title) + '</section>' +
          '<section class="info"><h3>聯絡與帳號</h3>' + kv("聯絡人", v.contact_name) + kv("電話", v.phone) + kv("Email", v.email) + kv("LINE", v.contact_line_user_id || v.line_oa_id) + '</section>' +
          '<section class="info"><h3>證照與合約</h3>' + kv("營登", linkText(v.business_license_url)) + kv("食品字號", v.food_registration_no) + kv("保險", v.insurance_policy_no) + kv("合約", (v.contract_start || "未填") + " ~ " + (v.contract_end || "未填")) + '</section>' +
          '<section class="info"><h3>優惠與審核</h3>' + kv("優惠/地點", (v.offer_count || 0) + " 優惠 / " + (v.location_count || 0) + " 地點") + kv("待審優惠", v.pending_offer_count || 0) + kv("標籤", v.tags) + '<div class="note">' + esc(v.ai_review_summary || v.discount_policy || "尚無 AI 初審或優惠政策。") + '</div></section>' +
        '</div>' +
      '</article>';
    }
    function tablePanel(title, note, head, body){ return '<div class="panel"><div class="panel-head"><span>' + title + '</span><span class="panel-note">' + note + '</span></div><div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>'; }
    function offerRows(list){ if(!list.length)return '<tr><td colspan="10" class="empty">目前沒有優惠資料。</td></tr>'; return list.map(o => '<tr><td><div class="name">' + esc(o.title) + '</div><div class="muted">' + esc(o.vendor_name || "") + '</div></td><td>' + esc(o.category || "") + '</td><td class="money">' + money(o.original_price) + '</td><td class="money">' + money(o.employee_price) + '</td><td class="money">' + money(o.visitor_price) + '</td><td>' + esc(o.redemption_method || "qr_code") + '</td><td>' + (Number(o.qr_enabled) ? "啟用" : "停用") + '</td><td>' + badge(o.status) + '</td><td class="widecell">' + esc(o.review_note || o.usage_limit || "") + '</td><td><button class="btn green" data-offer-status="approved" data-id="' + esc(o.id) + '">核准</button> <button class="btn amber" data-offer-status="rejected" data-id="' + esc(o.id) + '">退回</button></td></tr>').join(""); }
    function locationRows(list){ if(!list.length)return '<tr><td colspan="8" class="empty">目前沒有地點資料。</td></tr>'; return list.map(l => '<tr><td><div class="name">' + esc(l.branch_name || "未命名分店") + '</div></td><td>' + esc(l.city || "") + '</td><td>' + esc(l.district || "") + '</td><td class="widecell">' + esc(l.address || "") + '</td><td>' + esc(l.service_area || "") + '</td><td>' + esc(l.business_hours || "") + '</td><td>' + esc(l.contact_phone || "") + '</td><td>' + (l.google_maps_url ? '<a href="' + esc(l.google_maps_url) + '" target="_blank">地圖</a>' : "") + '</td></tr>').join(""); }
    function redemptionRows(list){ if(!list.length)return '<tr><td colspan="8" class="empty">目前沒有折抵紀錄。</td></tr>'; return list.map(r => '<tr><td><div class="name">' + esc(r.offer_title || r.offer_id) + '</div><div class="muted">' + esc(r.vendor_name || r.vendor_id) + '</div></td><td>' + badge(r.member_type) + '</td><td>' + esc(r.line_user_id) + '</td><td class="money">' + money(r.original_price) + '</td><td class="money">' + money(r.payable_price) + '</td><td class="money">' + money(r.discount_amount) + '</td><td>' + badge(r.status) + '</td><td>' + esc(r.redeemed_at || r.created_at || "") + '</td></tr>').join(""); }
    function vendorOptions(){ return (state.data.vendors || []).map(v => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join(""); }
    function offerOptions(){ return (state.data.offers || []).map(o => '<option value="' + esc(o.id) + '">' + esc(o.title) + ' / ' + esc(o.vendor_name || "") + '</option>').join(""); }
    function render() {
      const s = state.data.summary || {};
      sVendorTotal.textContent = s.vendor_total || 0; sVendorPending.textContent = s.vendor_pending || 0; sVendorApproved.textContent = s.vendor_approved || 0; sOfferTotal.textContent = s.offer_total || 0; sOfferPending.textContent = s.offer_pending || 0; sRedemptionTotal.textContent = s.redemption_total || 0;
      if (state.tab === "vendor-review") view.innerHTML = applicationList("廠商註冊審核清單", "新申請依建立時間往上排；委員可直接核准、退回或停權。", sortedVendors());
      else if (state.tab === "vendors") view.innerHTML = applicationList("特約店家資料", "所有店家依最新建立或異動時間排序。", sortedVendors());
      else if (state.tab === "offers" || state.tab === "offer-review") view.innerHTML = '<div class="toolbar"><div><div class="name">' + (state.tab === "offer-review" ? "優惠審核待辦" : "商品與優惠上架") + '</div><div class="hint">員工價、訪客價、QR 核銷與上架狀態。</div></div>' + searchBox("搜尋優惠、廠商、狀態") + '</div>' + tablePanel(state.tab === "offer-review" ? "優惠審核待辦" : "商品與優惠上架", "訪客價不得低於員工價", '<tr><th>優惠</th><th>分類</th><th>原價</th><th>員工價</th><th>訪客價</th><th>核銷</th><th>QR</th><th>狀態</th><th>備註/限制</th><th>操作</th></tr>', offerRows(sortedOffers()));
      else if (state.tab === "store-map") { const locations = applySearch(state.data.locations || []); view.innerHTML = tablePanel("全省特約店地點", "支援全台與離島分布", '<tr><th>分店</th><th>縣市</th><th>區域</th><th>地址</th><th>服務區</th><th>營業</th><th>電話</th><th>Google</th></tr>', locationRows(locations)) + '<div class="map-grid">' + cities.map(c => '<div class="map-cell">' + c + '<div class="muted">' + locations.filter(l => String(l.city || l.service_area || l.island_area || "").includes(c.replace("縣市",""))).length + ' 地點</div></div>').join("") + '</div>'; }
      else if (state.tab === "ocr") view.innerHTML = '<div class="panel"><div class="panel-head"><span>AI OCR 上架助手</span><span class="panel-note">菜單或價目表轉優惠草稿</span></div><form class="formline" data-form="ocr"><div class="field"><label>廠商</label><select name="vendor_id">' + vendorOptions() + '</select></div><div class="field full"><label>貼上菜單、價目表或 OCR 文字</label><textarea name="text" placeholder="廠商可拍照或上傳菜單，AI OCR 後轉成優惠草稿。"></textarea></div><button class="btn green" type="submit">產生優惠草稿</button></form><div class="formline"><div class="reply full" id="ocrResult">AI 會整理商品名稱、原價、員工價、訪客價、使用限制與審核備註。</div></div></div>';
      else if (state.tab === "redemptions") view.innerHTML = tablePanel("消費折抵紀錄", "員工與用戶身分由 QR Code 判定", '<tr><th>優惠</th><th>身分</th><th>LINE</th><th>原價</th><th>實付</th><th>折抵</th><th>狀態</th><th>時間</th></tr>', redemptionRows(state.data.redemptions || []));
      else if (state.tab === "points") view.innerHTML = '<div class="panel"><div class="panel-head"><span>母站點數 API</span><span class="panel-note">點數由母站讀寫</span></div><form class="formline" data-form="points"><div class="field"><label>LINE User ID</label><input name="LINE_user_id"></div><div class="field"><label>母站 shop_id</label><input name="shop_id" type="number"></div><div class="field"><label>點數類型</label><select name="point_type"><option value="system_point">點數</option><option value="gift_money">購物金</option></select></div><button class="btn" data-point-action="query" type="button">查詢</button><button class="btn green" data-point-action="insert" type="button">新增異動</button><pre id="pointResult" class="reply full">尚未查詢</pre></form></div>';
      else if (state.tab === "ai") view.innerHTML = '<div class="panel"><div class="panel-head"><span>多語與 AI 詢問</span><span class="panel-note">支援外籍員工與廠商詢問</span></div><form class="formline" data-form="ai"><div class="field"><label>LINE User ID</label><input name="LINE_user_id"></div><div class="field"><label>語言</label><select name="language"><option value="">自動判斷</option><option value="zh-TW">繁體中文</option><option value="id">印尼文</option><option value="th">泰文</option></select></div><div class="field full"><label>問題</label><textarea name="question" placeholder="例：Saya ingin tahu cara menggunakan diskon karyawan"></textarea></div><button class="btn green" type="submit">取得 AI 回覆</button><div class="reply full" id="aiAnswer">尚未詢問</div></form></div>';
      else if (state.tab === "knowledge") view.innerHTML = '<div class="panel"><div class="panel-head"><span>知識庫</span><span class="panel-note">提供 AI 回覆使用</span></div><form class="formline" data-form="knowledge"><div class="field"><label>標題</label><input name="title" placeholder="員工優惠使用規則"></div><div class="field"><label>語言</label><select name="language"><option value="zh-TW">繁中</option><option value="id">印尼文</option><option value="th">泰文</option></select></div><div class="field"><label>類型</label><select name="asset_type"><option value="text">文字</option><option value="url">網址</option><option value="file">檔案</option></select></div><div class="field full"><label>內容</label><textarea name="body" placeholder="規則、FAQ、店家資料、QR 折抵 SOP。"></textarea></div><button class="btn green" type="submit">儲存知識庫</button></form></div>';
      else if (state.tab === "reports") view.innerHTML = tablePanel("營運報表", "日、週、月資料後續可接圖表", '<tr><th>項目</th><th>數值</th><th>福委會觀察</th></tr>', '<tr><td>折抵筆數</td><td class="money">' + money(s.redemption_total) + '</td><td>觀察員工實際使用率</td></tr><tr><td>實收金額</td><td class="money">' + money(s.payable_total) + '</td><td>廠商營運參考</td></tr><tr><td>折抵金額</td><td class="money">' + money(s.discount_total) + '</td><td>福利價值量化</td></tr><tr><td>地點總數</td><td class="money">' + money(s.location_total) + '</td><td>全台與離島覆蓋率</td></tr>');
      bind();
      bindSearch();
    }
    function bind(){
      $$('[data-vendor-status]').forEach(b => b.onclick = async () => { await post("vendor.status", { id:b.dataset.id, status:b.dataset.vendorStatus, reviewed_by:"福委會" }); toast("廠商狀態已更新"); await load(); });
      $$('[data-offer-status]').forEach(b => b.onclick = async () => { await post("offer.status", { id:b.dataset.id, status:b.dataset.offerStatus, approved_by:"福委會" }); toast("優惠狀態已更新"); await load(); });
      $$('[data-form="ocr"]').forEach(f => f.onsubmit = async e => { e.preventDefault(); try{ const data = Object.fromEntries(new FormData(f)); const j = await post("ocr.draft", data); $("#ocrResult").textContent = "草稿：" + j.data.title + "\\n原價 " + money(j.data.original_price) + " / 員工價 " + money(j.data.employee_price) + " / 訪客價 " + money(j.data.visitor_price) + "\\n" + (j.data.usage_limit || ""); toast("已產生優惠草稿"); } catch(err){ toast(err.message); } });
      $$('[data-form="ai"]').forEach(f => f.onsubmit = async e => { e.preventDefault(); try{ const j = await post("ai.ask", Object.fromEntries(new FormData(f))); $("#aiAnswer").textContent = j.data.answer; toast("AI 已回覆"); } catch(err){ toast(err.message); } });
      $$('[data-form="knowledge"]').forEach(f => f.onsubmit = async e => { e.preventDefault(); try{ await post("knowledge.save", Object.fromEntries(new FormData(f))); toast("知識庫已儲存"); } catch(err){ toast(err.message); } });
      $$('[data-point-action]').forEach(b => b.onclick = async () => { const data = Object.fromEntries(new FormData(b.closest("form"))); try{ const j = await post(b.dataset.pointAction === "query" ? "points.query" : "points.insert", b.dataset.pointAction === "query" ? data : {...data,event_name:"福委會福利點數",event_content:"子站手動點數異動",get_point:1}); $("#pointResult").textContent = JSON.stringify(j, null, 2); } catch(err){ $("#pointResult").textContent = err.message; } });
    }
    $$("[data-tab]").forEach(b => b.onclick = () => setTab(b.dataset.tab));
    setTab(state.tab);
    load().catch(err => view.innerHTML = '<div class="empty">' + esc(err.message) + '</div>');
  </script>
</body>
</html>`;

fs.writeFileSync(htmlPath, html, "utf8");

let index = fs.readFileSync(indexPath, "utf8");
const start = index.indexOf("const vendorManagementHtml = ");
const end = index.indexOf("\\nconst crmUsersHtml = ", start);
if (start === -1 || end === -1) throw new Error("vendorManagementHtml block not found");
index = index.slice(0, start) + "const vendorManagementHtml = " + JSON.stringify(html) + ";\\n" + index.slice(end + 1);
fs.writeFileSync(indexPath, index, "utf8");
