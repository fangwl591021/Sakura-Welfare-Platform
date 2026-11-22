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
#shop button,#detail button,#close,#login{height:44px;padding-block:0}
#detail #itemInfo img{display:block;width:100%;max-height:40vh;object-fit:contain;margin:8px 0 12px}
#apply{margin-top:16px}#apply h3{font-size:18px}
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
  <section id="products" style="margin-top:14px"><label for="filter">搜尋商品</label><input id="filter" type="search" placeholder="品名、系列或分類"><div id="catalog" class="grid" style="margin-top:12px"></div></section>
  <section id="requests" style="margin-top:14px" hidden></section><span id="watermark" class="watermark" aria-hidden="true"></span></div>
  <dialog id="detail" aria-labelledby="itemName"><div class="bar"><button id="closeDetail" type="button">返回商品</button></div><h2 id="itemName"></h2><div id="itemInfo"></div>
  <button id="buy" type="button" class="primary" aria-controls="apply" hidden>我要購買</button>
  <form id="apply" aria-labelledby="applyHeading" hidden><h3 id="applyHeading" tabindex="-1">購買申請</h3><label>數量<input id="quantity" type="number" min="1" required></label><p id="applyAmount" aria-live="polite"></p><label>聯絡方式<input id="contact" required maxlength="120" autocomplete="tel"></label><label>備註<textarea id="comment" maxlength="500"></textarea></label>
  <button class="primary" id="submit">送出購買申請</button></form><p id="detailNotice" role="status"></p></dialog>`,
  `
let products=[], requests=[], selected, submission, pending=false, sdkReady;
function sdk() {
  return sdkReady ||= (async()=>{ await liff.init({liffId:'__SAKURA_LIFF_ID__'}); return liff; })();
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
function render() {
  const filter = q('filter').value.toLocaleLowerCase().trim();
  const cards = products.filter(p => [p.name,p.series,p.category].join(' ').toLocaleLowerCase().includes(filter)).map(p=>{
    const card=node('article',undefined,'card');
    if(p.has_photo) {
      const img=node('img'); img.src='/api/welfare-shop/photo?id='+encodeURIComponent(p.id); img.alt=p.name; img.loading='lazy'; card.append(img);
    }
    card.append(node('div',[p.series,p.category].filter(Boolean).join(' · '),'muted'),node('h3',p.name),node('p',money(p.price_cents),'price'),
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
function openProduct(p) {
  selected=p; submission=crypto.randomUUID();
  q('itemName').textContent=p.name;
  q('itemInfo').replaceChildren(node('p',money(p.price_cents),'price'),node('p','商品狀況｜'+p.condition_note),node('p','取貨｜'+p.pickup_note),node('small',q('watermark').textContent,'muted'));
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
    await call('/api/welfare-shop',post({id:submission,product_id:selected.id,revision:selected.revision,unit_price_cents:wholeYuan(selected.price_cents)*100,quantity:Number(q('quantity').value),contact:q('contact').value,comment:q('comment').value}));
    q('detail').close(); section(false); await load();
    q('notice').textContent='申請已提交，等待福委會確認。';
  } catch(error) {q('detailNotice').textContent=error.message;}
  finally{pending=false;q('submit').disabled=false;}
};
async function load() {
  try {
    const data=await call('/api/welfare-shop');
    products=data.products; requests=data.requests;
    q('watermark').textContent=data.viewer+' · '+time(new Date());
    q('shop').hidden=false; q('login').hidden=true; q('notice').textContent=''; render();
  } catch(error) {
    q('shop').hidden=true; q('notice').textContent=error.message; q('login').hidden=error.status!==401;
    q('catalog').replaceChildren();q('requests').replaceChildren();
    if(error.status===401)throw error;
  }
}
async function signIn(interactive) {
  try {
    const line=await sdk();
    if(!line.isLoggedIn()){
      if(interactive)line.login({redirectUri:location.origin+'/?liff.state='+encodeURIComponent('/welfare-shop')});
      return;
    }
    const token=line.getIDToken();
    if(!token) throw new Error('LINE 登入未取得身分，請從官方帳號重新開啟。');
    await call('/api/vendor-benefits/session',{method:'POST',headers:{'X-Line-Id-Token':token}});
    await load();
  }catch(error){q('notice').textContent=error.message;}
}
q('login').onclick=()=>signIn(true);
q('refresh').onclick=()=>load().catch(()=>signIn(false));
load().catch(()=>signIn(false));
`,true);

export const welfareShopAdminHtml = page('福利品商城管理',
  '<strong>櫻花福委會</strong><a class="button" href="/sakura-admin">返回管理後台</a>',
  `<p id="notice" class="notice" role="status"></p>
  <div id="admin" hidden><div class="bar"><button id="add" type="button" class="primary">新增商品</button><button id="reload" type="button">重新整理</button><a id="entry">LINE 商城入口</a></div>
  <details><summary>匯入 Excel 商品草稿</summary><label>選擇由 Excel 轉出的商城匯入檔<input id="importFile" type="file" accept=".json,application/json"></label><div id="preview"></div><button id="importConfirm" type="button" class="primary" hidden>確認匯入草稿</button></details>
  <h2 style="margin-top:20px">商品</h2><div id="catalog" class="grid"></div>
  <h2 style="margin-top:22px">購買申請</h2><label>申請狀態<select id="status"><option value="pending">等待確認</option><option value="confirmed">已確認</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
  <div id="requests"></div><div class="bar"><button id="prev">上一頁</button><button id="next">下一頁</button></div></div>
  <dialog id="productDialog"><form id="edit"><div class="bar"><button type="button" id="editClose">返回商品列表</button></div><h2 id="editTitle"></h2>
  <label>商品名稱<input name="name" required maxlength="150"></label><div class="row"><label>系列<input name="series" maxlength="80"></label><label>分類<input name="category" required maxlength="50"></label></div>
  <label>商品狀況<textarea name="condition_note" required maxlength="2000"></textarea></label><label>取貨說明<textarea name="pickup_note" maxlength="1000"></textarea></label>
  <div class="row"><label>員工價（元）<input name="price" type="number" min="0" max="1000000" step="1" required></label><label>總庫存（含已申請）<input name="stock" type="number" min="0" max="9999" required></label></div>
  <div class="row"><label>每人可申請上限<input name="employee_limit" type="number" min="1" max="9999" required></label><label>商品狀態<select name="status"><option value="draft">草稿</option><option value="published">上架</option><option value="hidden">下架</option></select></label></div>
  <label>更換商品照片<input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label><p id="editNotice" role="status"></p><button class="primary" id="save">儲存商品</button></form></dialog>`,
  `
let editItem, imported, offset=0, inFlight=false, loadRevision=0, displayedPhotos=[];
const api='/admin-api/welfare-shop';
function auth(options={}) {
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
function edit(item) {
  editItem=item;
  q('edit').reset();
  const data=item?{...item,price:wholeYuan(item.price_cents)}:{price:0,stock:0,employee_limit:1,status:'draft'};
  for(const key of ['name','series','category','condition_note','pickup_note','price','stock','employee_limit','status']){
    q('edit').elements.namedItem(key).value=data[key]??'';
  }
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
      if(p.status==='published')actions.append(button('下架',()=>hideProduct(p)));
      card.append(node('p',[p.series,p.category,labels[p.status]].filter(Boolean).join(' · '),'muted'),
        node('h3',p.name),node('p',money(p.price_cents),'price'),node('p','可申請 '+(p.stock-p.committed)+' 件'),actions);
      return card;
    }):[node('p','目前沒有商品。')]));
    q('requests').replaceChildren(...(data.requests.length?data.requests.map(r=>{
      const card=node('article',undefined,'card');
      card.append(node('h3',r.product_name),node('p',r.employee+' · '+r.quantity+' 件 · '+money(r.price_cents*r.quantity)),
        node('p','聯絡方式｜'+r.contact),node('p',time(r.created_at),'muted'));
      if(r.comment)card.append(node('p','備註｜'+r.comment));
      const actions=node('div',undefined,'bar');
      if(r.status==='pending')actions.append(button('確認申請',()=>status(r,'confirmed')));
      if(r.status==='confirmed')actions.append(button('標記完成',()=>status(r,'completed')));
      if(['pending','confirmed'].includes(r.status))actions.append(button('取消申請',()=>status(r,'cancelled')));
      card.append(actions);return card;
    }):[node('p','此頁沒有申請。')]));
    q('prev').disabled=offset===0; q('next').disabled=!data.next;
  }catch(error){if(generation===loadRevision){q('admin').hidden=true;q('notice').textContent=error.message;}}
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
    q('notice').textContent=error.message;
  }finally{inFlight=false;}
}
async function status(item,next) {
  if(inFlight||!confirm((next==='cancelled'?'取消這筆申請並釋放庫存？':'將這筆申請標記為'+labels[next]+'？')))return;
  inFlight=true;
  try{await request(api,post({action:'status',id:item.id,previous:item.status,status:next}));await load();}
  catch(error){q('notice').textContent=error.message;}
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
  if(state==='published'&&editItem?.status!=='published'&&!confirm('確定讓員工看到此商品？'))return;
  inFlight=true;q('save').disabled=true;
  try{
    await request(api,post({action:'save',id:editItem?.id,revision:editItem?.revision,name:form.get('name'),series:form.get('series'),
      category:form.get('category'),condition_note:form.get('condition_note'),pickup_note:form.get('pickup_note'),price_cents:priceCents,
      stock:Number(form.get('stock')),employee_limit:Number(form.get('employee_limit')),status:state,photo:await imageData(form.get('image'))}));
    q('productDialog').close();await load();q('notice').textContent='商品已儲存。';
  }catch(error){q('editNotice').textContent=error.message;}
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
    const data=await request(api,post({action:'import',products:imported}));
    q('importFile').value='';q('preview').replaceChildren();q('importConfirm').hidden=true;imported=null;
    await load();q('notice').textContent='已建立 '+data.imported+' 件草稿，略過 '+data.skipped+' 件已匯入商品。';
  }catch(error){q('notice').textContent=error.message;}
  finally{inFlight=false;q('importConfirm').disabled=false;q('importFile').disabled=false;}
};
load();
`);
