const style = `
*{box-sizing:border-box}body{margin:0;color:#142236;background:#f5f6f8;font:16px/1.55 system-ui,sans-serif}
header{position:sticky;top:0;z-index:4;background:#fff;border-bottom:1px solid #ddd;padding:12px max(16px,calc((100% - 1060px)/2));display:flex;justify-content:space-between;gap:8px;align-items:center}
main{max-width:1060px;margin:auto;padding:22px 16px 42px}h1{margin:0 0 14px;font-size:clamp(26px,4vw,36px)}h2,h3{margin:0 0 8px}p{margin:6px 0 12px;white-space:pre-wrap}a{color:#9d183e}
button,input,select,textarea{color:inherit;font:inherit}button,.button{border:1px solid #c3cbd5;background:#fff;border-radius:8px;padding:8px 12px;min-height:44px;cursor:pointer}
button.primary{background:#aa1541;color:#fff;border-color:#aa1541;font-weight:650}button:disabled{cursor:default;opacity:.55}input,select,textarea{display:block;width:100%;padding:8px 10px;min-height:44px;border:1px solid #bac4d1;border-radius:8px;background:#fff}label{display:block;margin:8px 0}textarea{resize:vertical}
.card{background:#fff;border:1px solid #dce1e8;border-radius:13px;padding:16px;margin:0 0 10px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:13px}.grid .card{margin:0}.card img{display:block;width:100%;height:156px;object-fit:contain;background:#f4f4f6;border-radius:7px;margin-bottom:10px}.price{font-size:20px;color:#951039;font-weight:750}.muted{color:#485b72}.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bar>*{width:auto}.notice{min-height:1.55em}[hidden]{display:none!important}
dialog{width:min(540px,calc(100% - 26px));max-height:85dvh;border:1px solid #bfcad7;border-radius:13px;padding:20px}dialog::backdrop{background:#0a142680}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.watermark{position:fixed;right:12px;bottom:8px;z-index:5;pointer-events:none;background:#ffffffdf;color:#485b72;padding:2px 6px;border-radius:4px;font-size:12px}details{margin:15px 0}summary{cursor:pointer;font-weight:650}
#products .card{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}
#products .card img{flex-shrink:0}
#products .card button{margin-top:auto;align-self:flex-start}
.catalog-filters{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:12px}
.product-venue{align-self:flex-start;border-radius:6px;padding:2px 8px;margin:0 0 6px;background:#edf1f6;color:#273e58;font-weight:650}
@media(max-width:520px){.catalog-filters{grid-template-columns:minmax(0,1fr);gap:0}}
#shop button,#detail button,#close,#login{height:44px;padding-block:0}
#detail #itemInfo img{display:block;width:100%;max-height:40vh;object-fit:contain;margin:8px 0 12px}
.condition-warning{color:#b21c34;font-weight:700}
#apply{margin-top:16px}#apply h3{font-size:18px}
.venue-checklist{max-height:260px;overflow:auto;border:1px solid #dce1e8;border-radius:8px;padding:8px 12px}
.venue-checklist label{display:flex;align-items:flex-start;gap:8px}
.venue-checklist input[type=checkbox]{width:auto;min-height:0;margin-top:6px;flex:none}
.shop-management{display:grid;grid-template-columns:200px minmax(0,1fr);gap:24px;align-items:start}
.shop-menu{display:grid;gap:8px;position:sticky;top:80px}
.shop-menu button,.shop-menu a{text-align:left}
.shop-menu button[aria-pressed=true]{background:#aa1541;border-color:#aa1541;color:white;font-weight:650}
.shop-content{min-width:0}.shop-content .card{overflow-wrap:anywhere}.shop-content form{margin-top:14px}
#batchForm .batch-name{grid-column:1/-1}
.shop-content fieldset{border:0;padding:0;margin:12px 0}.shop-content legend{font-weight:650}
@media(max-width:720px){
  .shop-management{grid-template-columns:minmax(0,1fr);gap:14px}
  .shop-menu{position:static;grid-template-columns:repeat(2,minmax(0,1fr))}
  .shop-content .row{grid-template-columns:minmax(0,1fr)}
}
`;
const browserHelpers = `
const q = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const out = document.createElement(tag);
  if (text !== undefined) out.textContent = text;
  if (cls) out.className = cls;
  return out;
};
const button = (text, fn) => {
  const out = node('button', text);
  out.type = 'button'; out.onclick = fn;
  return out;
};
const warningClass = product => product.name.startsWith('【通電異常】') ? 'condition-warning' : '';
const wholeYuan = cents => Math.round(cents/100);
const yuanFormatter = new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0,minimumFractionDigits:0});
const money = cents => yuanFormatter.format(wholeYuan(cents));
const labels = {pending:'等待福委會確認',confirmed:'已確認',completed:'已完成',cancelled:'已取消',draft:'草稿',published:'上架中',hidden:'已下架'};
const time = value => new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
async function call(path, options = {}) {
  const response = await fetch(path,{cache:'no-store',...options});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || '暫時無法完成，請稍後再試。'),{status:response.status});
  return data;
}
const post = body => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
`;
function page(title, header, body, script, sdk=false) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}｜SAKURA Welfare</title><style>${style}</style></head><body><header>${header}</header><main><h1>${title}</h1>${body}</main>${sdk ? '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' : ''}<script>${browserHelpers}${script}</script></body></html>`;
}

export const welfareShopHtml = page('福利品商城',
  '<strong>櫻花福委會</strong><button type="button" id="close">返回／關閉</button>',
  `<p id="notice" class="notice" role="status"></p><button id="login" type="button" class="primary" hidden>登入 LINE</button>
  <div id="shop" hidden><nav class="bar" aria-label="商城分頁"><button id="productsTab">商品</button><button id="requestsTab">我的申請</button><button id="refresh">重新整理</button></nav>
  <section id="products" style="margin-top:14px"><div class="catalog-filters">
  <label>館別<select id="venueFilter"><option value="">全部館別</option></select></label>
  <label>搜尋商品<input id="filter" type="search" placeholder="品名、系列或分類"></label></div><div id="catalog" class="grid" style="margin-top:12px"></div></section>
  <section id="requests" style="margin-top:14px" hidden></section><span id="watermark" class="watermark" aria-hidden="true"></span></div>
  <dialog id="detail" aria-labelledby="itemName"><div class="bar"><button id="closeDetail" type="button">返回商品</button></div><h2 id="itemName"></h2><div id="itemInfo"></div>
  <button id="buy" type="button" class="primary" aria-controls="apply" hidden>我要購買</button>
  <form id="apply" aria-labelledby="applyHeading" hidden><h3 id="applyHeading" tabindex="-1">購買申請</h3><label>數量<input id="quantity" type="number" min="1" required></label><p id="applyAmount" aria-live="polite"></p>
  <label>聯絡電話<input id="contactPhone" type="tel" inputmode="tel" required maxlength="32" autocomplete="tel" aria-describedby="contactPhoneHint"></label>
  <small id="contactPhoneHint" class="muted">請填寫可聯絡的電話，供安排取貨使用。</small>
  <label>備註<textarea id="comment" maxlength="500"></textarea></label>
  <button class="primary" id="submit">送出購買申請</button></form><p id="detailNotice" role="status"></p></dialog>`,
  `
let products=[], requests=[], selected, submission, pending=false, sdkReady, availabilityTimer, loadGeneration=0;
let signInPending=false, needsNewLineLogin=false;
function sdk() {
  return sdkReady ||= (async()=>{
    await liff.init({liffId:'__SAKURA_LIFF_ID__'});
    return liff;
  })().catch(error=>{sdkReady=undefined;throw error;});
}
q('close').onclick = () => { if (window.liff?.isInClient()) liff.closeWindow(); else location.assign('/'); };
q('closeDetail').onclick = () => { if (!pending) q('detail').close(); };
q('detail').oncancel = event => { if (pending) event.preventDefault(); };
function section(showProducts) {
  q('products').hidden=!showProducts; q('requests').hidden=showProducts;
  q('productsTab').setAttribute('aria-pressed',showProducts);
  q('requestsTab').setAttribute('aria-pressed',!showProducts);
}
q('productsTab').onclick=()=>section(true);
q('requestsTab').onclick=()=>section(false);
section(true);
function updateVenueFilter() {
  const field=q('venueFilter'), current=field.value;
  const names=[...new Set(products.map(product=>product.venue_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  field.replaceChildren(new Option('全部館別',''),...names.map(name=>new Option(name,name)));
  if(names.includes(current))field.value=current;
}
function render() {
  const filter = q('filter').value.toLocaleLowerCase().trim();
  const venue=q('venueFilter').value;
  const cards = products.filter(p => (!venue||p.venue_name===venue) &&
    [p.name,p.series,p.category,p.venue_name].join(' ').toLocaleLowerCase().includes(filter)).map(p=>{
    const card=node('article',undefined,'card');
    if(p.has_photo) {
      const img=node('img'); img.src='/api/welfare-shop/photo?id='+encodeURIComponent(p.id); img.alt=p.name; img.loading='lazy'; card.append(img);
    }
    if(p.venue_name)card.append(node('p',p.venue_name,'product-venue'));
    card.append(node('div',[p.series,p.category].filter(Boolean).join(' · '),'muted'),node('h3',p.name,warningClass(p)),node('p',money(p.price_cents),'price'),
      node('p',p.available > 0 ? '剩餘 '+p.available+' 件' : '暫無可申請庫存'),button('查看商品',()=>openProduct(p)));
    return card;
  });
  q('catalog').replaceChildren(...(cards.length?cards:[node('p','目前沒有符合的商品。')]));
  q('requests').replaceChildren(...(requests.length?requests.map(r=>{
    const card=node('article',undefined,'card');
    card.append(node('h3',r.product_name),node('p',labels[r.status]+' · '+r.quantity+' 件 · '+money(r.price_cents*r.quantity)),node('p',time(r.created_at),'muted'));
    return card;
  }):[node('p','目前沒有購買申請。')]));
}
q('filter').oninput=render;
q('venueFilter').onchange=render;
function openProduct(p) {
  selected=p; submission=crypto.randomUUID();
  q('itemName').textContent=p.name;
  q('itemName').className=warningClass(p);
  q('itemInfo').replaceChildren(node('p',money(p.price_cents),'price'),node('p','商品狀況｜'+p.condition_note,warningClass(p)),node('p','取貨｜'+p.pickup_note),node('small',q('watermark').textContent,'muted'));
  if(p.venue_name)q('itemInfo').prepend(node('p','出貨館別｜'+p.venue_name,'product-venue'));
  if(p.has_photo){
    const img=node('img');img.src='/api/welfare-shop/photo?id='+encodeURIComponent(p.id);img.alt=p.name;
    q('itemInfo').prepend(img);
  }
  q('apply').reset(); q('quantity').max=Math.min(p.available,p.employee_limit); q('quantity').value=1;
  const already=requests.some(r=>r.product_id===p.id&&r.status!=='cancelled');
  q('apply').hidden=true;
  q('buy').hidden=p.available<1 || already;
  q('detailNotice').textContent=already?'您已有這件商品的申請。':p.available<1?'暫無可申請庫存。':'';
  q('detail').showModal();
}
q('buy').onclick=()=>{
  q('buy').hidden=true;
  q('apply').hidden=false;
  updateApplyAmount();
  q('applyHeading').focus();
};
function updateApplyAmount() {
  const input=q('quantity'), quantity=input.valueAsNumber;
  const unit=wholeYuan(selected.price_cents)*100;
  const total=input.validity.valid?money(unit*quantity):'—';
  q('applyAmount').textContent='單價 '+money(unit)+' · 申請總額 '+total;
}
q('quantity').oninput=updateApplyAmount;
q('apply').onsubmit=async event=>{
  event.preventDefault(); if(pending)return;
  pending=true; q('submit').disabled=true;
  try {
    await call('/api/welfare-shop',post({id:submission,product_id:selected.id,revision:selected.revision,unit_price_cents:wholeYuan(selected.price_cents)*100,quantity:Number(q('quantity').value),contact_phone:q('contactPhone').value,comment:q('comment').value}));
    q('detail').close(); section(false); await load();
    q('notice').textContent='申請已提交，等待福委會確認。';
  } catch(error) {q('detailNotice').textContent=error.message;}
  finally{pending=false;q('submit').disabled=false;}
};
async function load() {
  const generation=++loadGeneration;
  clearTimeout(availabilityTimer);
  try {
    const data=await call('/api/welfare-shop');
    if(generation!==loadGeneration)return;
    products=data.products; requests=data.requests;
    updateVenueFilter();
    if(q('detail').open&&selected?.ends_at&&!products.some(item=>item.id===selected.id)){
      q('buy').hidden=true;q('apply').hidden=true;
      q('itemInfo').querySelector('img')?.remove();
      const expired=Date.parse(selected.ends_at)<=Date.parse(data.server_time);
      q('detailNotice').textContent=(expired?'商品已下架':'商品目前未開放申請')+'，已送出的申請可在「我的申請」查看。';
    }
    const serverTime=Date.parse(data.server_time);
    const changes=[data.next_starts_at,...products.map(item=>item.ends_at)].map(Date.parse);
    const nextChange=Math.min(...changes.filter(instant=>instant>serverTime));
    if(Number.isFinite(nextChange)){
      const delay=Math.max(1000,nextChange-serverTime+250);
      availabilityTimer=setTimeout(()=>load().catch(()=>signIn(false)),Math.min(delay,2147483647));
    }
    q('watermark').textContent=data.viewer+' · '+time(new Date());
    q('shop').hidden=false; q('login').hidden=true; q('notice').textContent=''; render();
  } catch(error) {
    if(generation!==loadGeneration)return;
    q('shop').hidden=true;
    q('notice').textContent=error.status===401?'正在確認 LINE 登入…':error.message;
    q('login').hidden=true;
    q('catalog').replaceChildren();q('requests').replaceChildren();
    if(error.status===401)throw error;
  }
}
function loginNotice(message, label='登入 LINE') {
  q('notice').textContent=message;
  q('login').textContent=label;
  q('login').hidden=false;
}
function renewLoginNotice(inLine) {
  needsNewLineLogin=true;
  if(inLine)loginNotice('請返回櫻花福委會聊天室，重新開啟「員工福利品」。','返回 LINE 聊天室');
  else loginNotice('LINE 登入已失效，請重新登入。','重新登入 LINE');
}
function openLineLogin(line) {
  q('notice').textContent='正在前往 LINE 登入…';
  line.login({redirectUri:new URL('/welfare-shop',location.origin).href});
}
async function signIn(interactive) {
  if(signInPending)return;
  signInPending=true;
  q('login').disabled=true;
  try {
    const line=await sdk();
    const inLine=line.isInClient();
    if(interactive&&needsNewLineLogin){
      if(inLine){line.closeWindow();return;}
      if(line.isLoggedIn())line.logout();
      openLineLogin(line);
      return;
    }
    if(!line.isLoggedIn()) {
      if(inLine)renewLoginNotice(true);
      else if(interactive)openLineLogin(line);
      else loginNotice('請登入 LINE，系統會確認員工資格。');
      return;
    }
    const token=line.getIDToken();
    if(!token){renewLoginNotice(inLine);return;}
    try {
      await call('/api/vendor-benefits/session',{method:'POST',headers:{'X-Line-Id-Token':token}});
    } catch(error) {
      if(error.status===403){renewLoginNotice(inLine);return;}
      throw error;
    }
    needsNewLineLogin=false;
    try{await load();}
    catch(error){
      if(error.status!==401)throw error;
      loginNotice('瀏覽器未能保留登入狀態。請從 LINE 聊天室開啟商城，或允許此網站使用 Cookie 後重試。','重試登入');
    }
  }catch(error){
    loginNotice(error.status?error.message:'暫時無法開啟 LINE 登入，請稍後重試。','重試登入');
  }finally{
    signInPending=false;
    q('login').disabled=false;
  }
}
q('login').onclick=()=>signIn(true);
q('refresh').onclick=()=>load().catch(()=>signIn(false));
load().catch(()=>signIn(false));
`,true);

function managementPage(fromLine) {
  return page('福利品商城管理',
    fromLine ? '<strong>櫻花福委會</strong><button id="close" type="button">返回／關閉</button>'
      : '<strong>櫻花福委會</strong><a class="button" href="/sakura-admin">返回管理後台</a>',
    `<p id="notice" class="notice" role="status"></p>
  <div id="admin" class="shop-management" hidden>
  <nav id="managementMenu" class="shop-menu" aria-label="福利品商城功能">
    <button type="button" data-panel="productPanel" aria-controls="productPanel">商品管理</button>
    <button type="button" data-panel="batchPanel" aria-controls="batchPanel">批次與上下架時間</button>
    <button type="button" data-panel="venues" aria-controls="venues">館長與通知信箱</button>
    <button type="button" data-panel="orderPanel" aria-controls="orderPanel">購買申請</button>
    <a id="entry" class="button">LINE 商城入口</a>
  </nav>
  <div class="shop-content"><section id="productPanel" aria-labelledby="productsHeading">
  <div class="bar"><button id="add" type="button" class="primary">新增商品</button><button id="reload" type="button">重新整理</button></div>
  <details><summary>匯入 Excel 商品草稿</summary><label>選擇由 Excel 轉出的商城匯入檔<input id="importFile" type="file" accept=".json,application/json"></label><label>匯入批次<select id="importBatch"></select></label><div id="preview"></div><button id="importConfirm" type="button" class="primary" hidden>確認匯入草稿</button></details>
  <h2 id="productsHeading">商品</h2><div id="catalog" class="grid"></div></section>
  <section id="batchPanel" hidden aria-labelledby="batchesHeading">
  <h2 id="batchesHeading">批次與上下架時間</h2>
  <div class="card"><form id="batchForm"><h3 id="batchFormHeading">新增批次</h3>
  <div class="row"><label class="batch-name">批次名稱<input name="name" maxlength="80" required></label>
  <label>上架時間（台北時間）<input name="starts_at" type="datetime-local" aria-describedby="batchTimingHint"></label>
  <label>下架時間（台北時間）<input name="ends_at" type="datetime-local" required></label></div>
  <p class="muted" id="batchTimingHint">上架時間留空時，已設為上架的商品會立即顯示。草稿須先設為上架。到期自動下架，已送出的申請可繼續處理。</p>
  <div class="bar"><button class="primary" id="saveBatch">儲存批次</button><button id="resetBatch" type="button" hidden>取消編輯</button></div>
  <p id="batchNotice" role="status"></p></form></div>
  <div id="batchList" class="grid"></div>
  <form id="batchAssignment" class="card"><h3>將商品加入批次</h3>
  <label><span id="assignmentBatchLabel">指定批次</span><select id="assignmentBatch" aria-labelledby="assignmentBatchLabel" required></select></label>
  <fieldset><legend>選擇商品</legend><div class="bar"><button type="button" id="toggleBatchProducts">全選</button></div>
  <div id="batchProducts" class="venue-checklist"></div></fieldset>
  <button class="primary" id="saveBatchAssignment" disabled>套用批次與上下架時間</button>
  <p id="batchAssignmentNotice" role="status"></p></form></section>
  <section id="orderPanel" hidden aria-labelledby="ordersHeading"><h2 id="ordersHeading">購買申請</h2><label>申請狀態<select id="status"><option value="pending">等待確認</option><option value="confirmed">已確認</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
  <div id="requests"></div><div class="bar"><button id="prev">上一頁</button><button id="next">下一頁</button></div></section>
  <section id="venues" class="card" hidden aria-labelledby="venuesHeading"><h2 id="venuesHeading">館長與通知信箱</h2>
  <p id="emailSetup" class="muted"></p><p id="venueNotice" role="status"></p>
  <div id="venueList" class="grid"></div>
  <form id="venueForm"><h3 id="venueFormHeading">新增館別</h3>
  <div class="row"><label>館別名稱<input name="name" required maxlength="80" placeholder="例：台北品牌館"></label>
  <label>館長姓名<input name="director_name" required maxlength="80"></label></div>
  <label>預訂通知信箱<input name="email" type="email" required maxlength="254"></label>
  <div class="bar"><button class="primary" id="saveVenue">儲存館別</button><button type="button" id="resetVenue" hidden>取消編輯</button></div></form>
  <details id="assignProducts"><summary>批次指定商品的出貨館別</summary>
  <form id="venueAssignment"><label>指定出貨館別<select id="assignmentVenue" required></select></label>
  <div id="venueProducts" class="venue-checklist" role="group" aria-label="選擇要指定館別的商品"></div>
  <button class="primary" id="saveAssignment" disabled>套用到勾選的商品</button><p id="assignmentNotice" role="status"></p></form></details></section>
  </div></div>
  <dialog id="productDialog"><form id="edit"><div class="bar"><button type="button" id="editClose">返回商品列表</button></div><h2 id="editTitle"></h2>
  <label>商品名稱<input name="name" required maxlength="150"></label><div class="row"><label>系列<input name="series" maxlength="80"></label><label>分類<input name="category" required maxlength="50"></label></div>
  <label>商品狀況<textarea name="condition_note" required maxlength="2000"></textarea></label><label>取貨說明<textarea name="pickup_note" maxlength="1000"></textarea></label>
  <label><span id="productVenueLabel">出貨館別</span><select name="venue_id" aria-labelledby="productVenueLabel"></select></label>
  <label><span id="productBatchLabel">上架批次</span><select name="batch_id" aria-labelledby="productBatchLabel"></select></label>
  <div class="row"><label>員工價（元）<input name="price" type="number" min="0" max="1000000" step="1" required></label><label>總庫存（含已申請）<input name="stock" type="number" min="0" max="9999" required></label></div>
  <div class="row"><label>每人可申請上限<input name="employee_limit" type="number" min="1" max="9999" required></label><label>商品狀態<select name="status"><option value="draft">草稿</option><option value="published">上架</option><option value="hidden">下架</option></select></label></div>
  <label>更換商品照片<input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label><p id="editNotice" role="status"></p><button class="primary" id="save">儲存商品</button></form></dialog>`,
  `
const fromLine = ${fromLine};
let editItem, imported, offset=0, inFlight=false, loadRevision=0, displayedPhotos=[], venues=[], venueEdit, catalog=[], batches=[], batchEdit;
const api='/admin-api/welfare-shop';
function auth(options={}) {
  if(fromLine){
    const identity=liff.getIDToken?.(), access=liff.getAccessToken?.();
    if(!identity&&!access)throw new Error('無法取得 LINE 身分，請回聊天室重新開啟。');
    return {...options,headers:{...options.headers,...(identity?{'X-Line-Id-Token':identity}:{}),...(access?{'X-Line-Access-Token':access}:{})}};
  }
  let token='';
  try{token=JSON.parse(localStorage.getItem('sakura_admin_session')||'null')?.token||'';}catch{}
  return {...options,headers:{...(options.headers||{}),...(token?{Authorization:'Bearer '+token}:{})}};
}
const request = (path, options) => call(path,auth(options));
q('entry').href='https://liff.line.me/'+encodeURIComponent('__SAKURA_LIFF_ID__')+'/welfare-shop';
q('editClose').onclick=()=>{if(!inFlight)q('productDialog').close();};
q('productDialog').oncancel=event=>{if(inFlight)event.preventDefault();};
q('add').onclick=()=>edit(null);
q('reload').onclick=()=>load();
q('status').onchange=()=>{offset=0;load();};
q('prev').onclick=()=>{offset=Math.max(0,offset-50);load();};
q('next').onclick=()=>{offset+=50;load();};
if(fromLine)q('close').onclick=()=>{
  if(window.liff?.isInClient())liff.closeWindow();
  else if(history.length>1)history.back();
  else location.assign('/');
};
function showError(error, element=q('notice')) {
  if(error.status===403){
    q('admin').hidden=true;
    q('notice').textContent=fromLine?'目前的 LINE 帳號沒有福利品專區設定權限。':'請使用福委會管理員帳號。';
  }else element.textContent=error.message;
}
const menuButtons=[...q('managementMenu').querySelectorAll('button[data-panel]')];
function selectPanel(id) {
  for(const toggle of menuButtons){
    const selected=toggle.dataset.panel===id;
    toggle.setAttribute('aria-pressed',selected);
    q(toggle.dataset.panel).hidden=!selected;
  }
}
for(const toggle of menuButtons)toggle.onclick=()=>selectPanel(toggle.dataset.panel);
selectPanel('productPanel');
function editVenue(venue) {
  venueEdit=venue;
  const form=q('venueForm');
  form.reset();
  q('venueFormHeading').textContent=venue?'編輯館別':'新增館別';
  q('resetVenue').hidden=!venue;
  if(venue){
    for(const key of ['name','director_name','email'])form.elements.namedItem(key).value=venue[key];
    form.elements.namedItem('name').focus();
  }
}
q('resetVenue').onclick=()=>editVenue(null);
q('venueForm').onsubmit=async event=>{
  event.preventDefault();
  if(inFlight)return;
  inFlight=true;q('saveVenue').disabled=true;
  try{
    const fields=Object.fromEntries(new FormData(q('venueForm')));
    await request(api+'/settings',post({action:'venue.save',id:venueEdit?.id,revision:venueEdit?.revision,...fields}));
    editVenue(null);
    await load();
    q('venueNotice').textContent='館別與館長資訊已儲存。';
  }catch(error){showError(error,q('venueNotice'));}
  finally{inFlight=false;q('saveVenue').disabled=false;}
};
function toggleAssignment() {
  q('saveAssignment').disabled=inFlight||!q('assignmentVenue').value||!q('venueProducts').querySelector('input:checked');
}
q('venueAssignment').onchange=toggleAssignment;
q('venueAssignment').onsubmit=async event=>{
  event.preventDefault();
  const venue=venues.find(item=>item.id===q('assignmentVenue').value);
  const checked=new Set([...q('venueProducts').querySelectorAll('input:checked')].map(input=>input.value));
  const products=catalog.filter(item=>checked.has(item.id)).map(({id,revision})=>({id,revision}));
  if(inFlight||!venue||!products.length||!confirm('將 '+products.length+' 件商品的出貨館別設為「'+venue.name+'」？'))return;
  inFlight=true;toggleAssignment();
  try{
    const result=await request(api+'/settings',post({action:'venue.assign',venue_id:venue.id,products}));
    await load();
    q('assignmentNotice').textContent='已指定 '+result.assigned+' 件商品。';
  }catch(error){showError(error,q('assignmentNotice'));}
  finally{inFlight=false;toggleAssignment();}
};
function showVenues(data) {
  venues=data.venues||[];
  catalog=data.products;
  q('emailSetup').textContent=data.email_configured
    ?'新預訂依商品的出貨館別寄給對應館長。'
    :'寄信服務尚未設定。可先儲存館長與通知信箱。';
  q('venueList').replaceChildren(...venues.map(venue=>{
    const card=node('article',undefined,'card');
    card.append(node('h3',venue.name),node('p',venue.director_name),node('p',venue.email),
      button('編輯 '+venue.name,()=>{if(!inFlight)editVenue(venue);}));
    return card;
  }));
  q('assignmentVenue').replaceChildren(new Option('請選擇館別',''),...venues.map(venue=>new Option(venue.name,venue.id)));
  q('venueProducts').replaceChildren(...catalog.map(item=>{
    const label=node('label'), input=node('input');
    input.type='checkbox';input.value=item.id;
    label.append(input,node('span',item.name+' · '+(venues.find(venue=>venue.id===item.venue_id)?.name||'未指定')));
    return label;
  }));
  q('assignProducts').hidden=!venues.length||!catalog.length;
  toggleAssignment();
}
function populateBatches(select, label, selected=select.value) {
  select.replaceChildren(new Option(label,''),...batches.filter(batch=>!batch.expired||batch.id===selected)
    .map(batch=>new Option(batch.name+(batch.expired?'（已到期）':batch.scheduled?'（預約上架）':''),batch.id)));
  select.value=batches.some(batch=>batch.id===selected)?selected:'';
}
const taipeiInput = value => value ? new Date(Date.parse(value)+8*60*60*1000).toISOString().slice(0,16) : '';
function editBatch(batch) {
  batchEdit=batch;
  const form=q('batchForm');
  form.reset();
  q('batchFormHeading').textContent=batch?'編輯批次':'新增批次';
  q('resetBatch').hidden=!batch;
  if(batch){
    form.elements.name.value=batch.name;
    form.elements.starts_at.value=taipeiInput(batch.starts_at);
    form.elements.ends_at.value=taipeiInput(batch.ends_at);
    form.elements.name.focus();
  }
}
q('resetBatch').onclick=()=>editBatch();
q('batchForm').onsubmit=async event=>{
  event.preventDefault();
  if(inFlight)return;
  if(batchEdit?.expired&&batchEdit.product_count&&!confirm('延後下架時間可能會讓此批原本上架的商品重新出現在員工商城。確定儲存？'))return;
  inFlight=true;q('saveBatch').disabled=true;
  try{
    const fields=Object.fromEntries(new FormData(q('batchForm')));
    await request(api+'/settings',post({action:'batch.save',id:batchEdit?.id,revision:batchEdit?.revision,...fields}));
    editBatch();
    await load();
    q('batchNotice').textContent='批次與上下架時間已儲存。';
  }catch(error){showError(error,q('batchNotice'));}
  finally{inFlight=false;q('saveBatch').disabled=false;}
};
function updateBatchAssignment() {
  const inputs=[...q('batchProducts').querySelectorAll('input')];
  const checked=inputs.filter(input=>input.checked).length;
  q('toggleBatchProducts').textContent=inputs.length&&checked===inputs.length?'取消全選':'全選';
  q('saveBatchAssignment').disabled=inFlight||!q('assignmentBatch').value||!checked;
}
q('batchAssignment').onchange=updateBatchAssignment;
q('toggleBatchProducts').onclick=()=>{
  const inputs=[...q('batchProducts').querySelectorAll('input')];
  const checked=!inputs.every(input=>input.checked);
  for(const input of inputs)input.checked=checked;
  updateBatchAssignment();
};
q('batchAssignment').onsubmit=async event=>{
  event.preventDefault();
  const batch=batches.find(item=>item.id===q('assignmentBatch').value);
  const checked=new Set([...q('batchProducts').querySelectorAll('input:checked')].map(input=>input.value));
  const selected=catalog.filter(item=>checked.has(item.id));
  if(inFlight||!batch||!selected.length)return;
  const willReopen=selected.some(item=>item.status==='published'&&batches.some(previous=>previous.id===item.batch_id&&previous.expired));
  const start=batch.scheduled?'，已上架的商品將於 '+time(batch.starts_at)+' 開放申請':'';
  const confirmation='將 '+selected.length+' 件商品加入「'+batch.name+'」'+start+'，統一於 '+time(batch.ends_at)+'（台北時間）下架？';
  if(!confirm(confirmation+(willReopen&&!batch.scheduled?'已到期的上架商品將重新開放申請。':'')))return;
  const products=selected.map(({id,revision})=>({id,revision}));
  inFlight=true;updateBatchAssignment();
  try{
    const result=await request(api+'/settings',post({action:'batch.assign',batch_id:batch.id,products}));
    await load();
    q('batchAssignmentNotice').textContent='已套用到 '+result.assigned+' 件商品。';
  }catch(error){showError(error,q('batchAssignmentNotice'));}
  finally{inFlight=false;updateBatchAssignment();}
};
function showBatches(data) {
  batches=data.batches||[];
  q('batchList').replaceChildren(...batches.map(batch=>{
    const card=node('article',undefined,'card');
    card.append(node('h3',batch.name),node('p',batch.expired?'已到期':batch.scheduled?'預約上架':'開放中','muted'),
      node('p','上架時間｜'+(batch.starts_at?time(batch.starts_at)+'（台北時間）':'即時'),'muted'),
      node('p','下架時間｜'+time(batch.ends_at)+'（台北時間）','muted'),
      node('p',batch.product_count+' 件商品'),button('編輯 '+batch.name,()=>{if(!inFlight)editBatch(batch);}));
    return card;
  }));
  populateBatches(q('importBatch'),'先匯入草稿，之後指定');
  populateBatches(q('assignmentBatch'),'請選擇批次','');
  q('batchAssignment').hidden=!catalog.length||!batches.some(batch=>!batch.expired);
  q('batchProducts').replaceChildren(...catalog.map(item=>{
    const label=node('label'), input=node('input');
    input.type='checkbox';input.value=item.id;
    label.append(input,node('span',item.name+' · '+(batches.find(batch=>batch.id===item.batch_id)?.name||'未指定批次')));
    return label;
  }));
  updateBatchAssignment();
}

function edit(item) {
  editItem=item;
  q('edit').reset();
  const data=item?{...item,price:wholeYuan(item.price_cents)}:{price:0,stock:0,employee_limit:1,status:'draft'};
  for(const key of ['name','series','category','condition_note','pickup_note','price','stock','employee_limit','status']){
    q('edit').elements.namedItem(key).value=data[key]??'';
  }
  const venue=q('edit').elements.namedItem('venue_id');
  venue.replaceChildren(new Option('未指定',''),...venues.map(item=>new Option(item.name,item.id)));
  venue.value=item?.venue_id||'';
  populateBatches(q('edit').elements.namedItem('batch_id'),'未指定批次',item?.batch_id||'');
  q('editTitle').textContent=item?'編輯商品':'新增商品';
  q('editNotice').textContent=item?.committed?'已申請或完成 '+item.committed+' 件':'';
  q('productDialog').showModal();
}
async function load() {
  const generation=++loadRevision;
  try {
    const data=await request(api+'?status='+encodeURIComponent(q('status').value)+'&offset='+offset);
    if(generation!==loadRevision)return;
    for(const photo of displayedPhotos)URL.revokeObjectURL(photo);
    displayedPhotos=[];
    q('notice').textContent=''; q('admin').hidden=false;
    showVenues(data);
    showBatches(data);
    q('catalog').replaceChildren(...(data.products.length?data.products.map(p=>{
      const card=node('article',undefined,'card');
      if(p.has_photo){
        const img=node('img');img.alt=p.name;
        fetch(api+'/photo?id='+encodeURIComponent(p.id),auth({cache:'no-store'})).then(async response=>{
          if(!response.ok)return;
          const blob=await response.blob();
          if(!img.isConnected)return;
          img.src=URL.createObjectURL(blob);displayedPhotos.push(img.src);
        }).catch(()=>{});
        card.append(img);
      }
      const actions=node('div',undefined,'bar');
      actions.append(button('編輯商品',()=>{if(!inFlight)edit(p);}));
      const batch=batches.find(item=>item.id===p.batch_id);
      if(p.status==='published')actions.append(button('下架',()=>hideProduct(p)));
      const expired=p.status==='published'&&batch?.expired;
      const scheduled=p.status==='published'&&batch?.scheduled&&!expired;
      card.append(node('p',[p.series,p.category,venues.find(venue=>venue.id===p.venue_id)?.name,
        expired?'已到期下架':scheduled?'預約上架':labels[p.status]].filter(Boolean).join(' · '),'muted'),
        node('h3',p.name,warningClass(p)),node('p',money(p.price_cents),'price'),node('p',expired?'已停止申請':scheduled?'尚未開放申請':'可申請 '+(p.stock-p.committed)+' 件'));
      if(scheduled)card.append(node('p','上架 '+time(batch.starts_at),'muted'));
      card.append(node('p',batch?batch.name+' · 下架 '+time(batch.ends_at):'未設定下架時間','muted'),actions);
      return card;
    }):[node('p','目前沒有商品。')]));
    q('requests').replaceChildren(...(data.requests.length?data.requests.map(r=>{
      const card=node('article',undefined,'card');
      card.append(node('h3',r.product_name),node('p',r.employee+' · '+r.quantity+' 件 · '+money(r.price_cents*r.quantity)));
      if(r.contact_phone)card.append(node('p','聯絡電話｜'+r.contact_phone));
      if(r.contact && r.contact!==r.contact_phone)card.append(node('p','聯絡方式｜'+r.contact));
      if(r.email_status){
        const emailStatus={pending:'待寄送',sending:'處理中',accepted:'寄信服務已接受',failed:'寄送失敗',unknown:'需人工確認',disabled:'寄信服務未設定',cancelled:'申請已取消',recipient_changed:'館長信箱已變更，未寄送'};
        card.append(node('p','館長通知｜'+r.venue_name+' · '+emailStatus[r.email_status],'muted'));
      }
      card.append(node('p',time(r.created_at),'muted'));
      if(r.comment)card.append(node('p','備註｜'+r.comment));
      const actions=node('div',undefined,'bar');
      if(r.status==='pending')actions.append(button('確認申請',()=>status(r,'confirmed')));
      if(r.status==='confirmed')actions.append(button('標記完成',()=>status(r,'completed')));
      if(['pending','confirmed'].includes(r.status))actions.append(button('取消申請',()=>status(r,'cancelled')));
      card.append(actions);return card;
    }):[node('p','此頁沒有申請。')]));
    q('prev').disabled=offset===0; q('next').disabled=!data.next;
  }catch(error){if(generation===loadRevision){q('admin').hidden=true;showError(error);}}
}
async function hideProduct(item) {
  if(inFlight||!confirm('確定下架「'+item.name+'」？下架後，員工商城會隱藏此商品。'))return;
  inFlight=true;
  try{
    await request(api,post({action:'product.hide',id:item.id,revision:item.revision}));
    await load();
    q('notice').textContent='「'+item.name+'」已下架。'+(q('admin').hidden?'商品列表未能更新，請重新整理。':'');
  }catch(error){
    if(error.status===409)await load();
    showError(error);
  }finally{inFlight=false;}
}
async function status(item,next) {
  if(inFlight||!confirm((next==='cancelled'?'取消這筆申請並釋放庫存？':'將這筆申請標記為'+labels[next]+'？')))return;
  inFlight=true;
  try{await request(api,post({action:'status',id:item.id,previous:item.status,status:next}));await load();}
  catch(error){showError(error);}
  finally{inFlight=false;}
}
async function imageData(file) {
  if(!file?.size)return '';
  if(file.size>2*1024*1024)throw new Error('照片須為 2 MB 以內。');
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(new Error('讀取照片失敗。'));reader.readAsDataURL(file);
  });
}
q('edit').onsubmit=async event=>{
  event.preventDefault();if(inFlight)return;
  const form=new FormData(q('edit')); const state=form.get('status');
  const price=Number(form.get('price'));
  const priceCents=editItem&&price===wholeYuan(editItem.price_cents)?editItem.price_cents:price*100;
  const nextBatch=form.get('batch_id');
  const rescheduling=editItem?.batch_id!==nextBatch&&batches.some(batch=>batch.id===editItem?.batch_id&&batch.expired);
  if(state==='published'&&(editItem?.status!=='published'||rescheduling)&&!confirm('確定讓員工看到此商品？'))return;
  inFlight=true;q('save').disabled=true;
  try{
    await request(api,post({action:'save',id:editItem?.id,revision:editItem?.revision,name:form.get('name'),series:form.get('series'),
      category:form.get('category'),condition_note:form.get('condition_note'),pickup_note:form.get('pickup_note'),price_cents:priceCents,
      stock:Number(form.get('stock')),employee_limit:Number(form.get('employee_limit')),status:state,
      venue_id:form.get('venue_id'),batch_id:nextBatch,photo:await imageData(form.get('image'))}));
    q('productDialog').close();await load();q('notice').textContent='商品已儲存。';
  }catch(error){
    if(error.status===403)q('productDialog').close();
    showError(error,q('editNotice'));
  }
  finally{inFlight=false;q('save').disabled=false;}
};
q('importFile').onchange=async()=>{
  imported=null;q('importConfirm').hidden=true;q('preview').replaceChildren();
  const file=q('importFile').files[0];
  if(!file)return;
  try{
    if(file.size>7900000)throw new Error('匯入檔超過大小限制。');
    const batch=JSON.parse(await file.text());
    if(q('importFile').files[0]!==file)return;
    if(!Array.isArray(batch.products)||batch.products.length<1||batch.products.length>50)throw new Error('匯入檔格式不正確。');
    imported=batch.products;
    const group=node('div',undefined,'grid');
    group.append(...imported.map(p=>{
      const card=node('article',undefined,'card');
      if(['image/jpeg','image/png','image/webp'].includes(p.photo_type)&&typeof p.photo==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(p.photo)){
        const img=node('img');img.alt=p.name;img.src='data:'+p.photo_type+';base64,'+p.photo;card.append(img);
      }
      card.append(node('h3',p.name),node('p',p.series+' · '+p.category),node('p',money(p.price_cents),'price'),node('p',p.condition_note));
      return card;
    }));
    q('preview').append(node('p','共 '+imported.length+' 件商品，請核對價格、狀況與照片。'),group);
    q('importConfirm').hidden=false;
  } catch(error){imported=null;q('importConfirm').hidden=true;q('preview').textContent=error.message;}
};
q('importConfirm').onclick=async()=>{
  if(!imported||inFlight)return;
  inFlight=true;q('importConfirm').disabled=true;q('importFile').disabled=true;
  try{
    const data=await request(api,post({action:'import',batch_id:q('importBatch').value,products:imported}));
    q('importFile').value='';q('preview').replaceChildren();q('importConfirm').hidden=true;imported=null;
    await load();q('notice').textContent='已建立 '+data.imported+' 件草稿，略過 '+data.skipped+' 件已匯入商品。';
  }catch(error){showError(error);}
  finally{inFlight=false;q('importConfirm').disabled=false;q('importFile').disabled=false;}
};
async function start() {
  try {
    if(fromLine){
      q('notice').textContent='正在驗證 LINE 管理員身分…';
      if(!window.liff)throw new Error('請從 LINE 聊天室重新開啟。');
      await liff.init({liffId:'__SAKURA_LIFF_ID__'});
      if(!liff.isLoggedIn()){
        if(liff.isInClient()||new URL(location.href).searchParams.has('line_auth_callback')){
          throw new Error('無法確認 LINE 登入狀態，請回聊天室重新開啟。');
        }
        liff.login({redirectUri:location.origin+'/?liff.state='+encodeURIComponent('/welfare-shop-settings?line_auth_callback=1')});
        return;
      }
    }
    await load();
  }catch(error){showError(error);}
}
start();
`,fromLine);
}

export const welfareShopAdminHtml = managementPage(false);
export const welfareShopSettingsHtml = managementPage(true);
