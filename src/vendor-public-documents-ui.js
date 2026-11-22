import { decorateActivityTutorialHtml } from './activity-tutorial-ui.js';

function documentsRuntime() {
  const copy = {
    zh: { title:'文件下載', preview:'預覽', view:'查看', download:'下載', close:'關閉', empty:'目前沒有公開文件。', failed:'文件載入失敗，請重試。', retry:'重新載入', external:'以外部瀏覽器開啟', public:'公開', hidden:'隱藏' },
    id: { title:'Unduh dokumen', preview:'Pratinjau', view:'Lihat', download:'Unduh', close:'Tutup', empty:'Belum ada dokumen publik.', failed:'Gagal memuat dokumen. Coba lagi.', retry:'Muat ulang', external:'Buka di browser eksternal', public:'Publik', hidden:'Tersembunyi' },
    th: { title:'ดาวน์โหลดเอกสาร', preview:'ดูตัวอย่าง', view:'ดู', download:'ดาวน์โหลด', close:'ปิด', empty:'ยังไม่มีเอกสารสาธารณะ', failed:'โหลดเอกสารไม่สำเร็จ กรุณาลองอีกครั้ง', retry:'โหลดใหม่', external:'เปิดในเบราว์เซอร์ภายนอก', public:'สาธารณะ', hidden:'ซ่อน' },
  };
  const lang = document.documentElement.lang.startsWith('id') ? 'id' : document.documentElement.lang.startsWith('th') ? 'th' : 'zh';
  const T = copy[lang];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const size = bytes => bytes < 1e6 ? Math.max(1, Math.round(bytes / 1000)) + ' KB' : (bytes / 1e6).toFixed(1).replace(/\.0$/, '') + ' MB';
  const format = item => item.mime_type === 'application/pdf' ? 'PDF' : item.mime_type.startsWith('image/') ? item.mime_type === 'image/png' ? 'PNG' : 'JPG' : 'Word';
  const params = new URLSearchParams(window.location.search);
  const token = params.get('portal_token') || params.get('token') || params.get('vendor_portal_token') || '';
  const managers = new WeakMap();
  let publicReload = null;

  function link(item, download = false, external = false) {
    const url = '/vendor-document/' + encodeURIComponent(item.id) + (download ? '?download=1' : '');
    const href = external ? url + (download ? '&' : '?') + 'openExternalBrowser=1' : url;
    return '<a class="vdoc-action" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" '+(download?'download="'+esc(item.original_filename)+'"':'')+' title="'+esc(external?T.external:download?T.download:T.preview)+'">'+(external?'↗ ':download?'↓ ':'◉ ')+esc(external?T.external:download?T.download:T.preview)+'</a>';
  }

  function manager(root, vendorId, admin = false) {
    if (!root || !vendorId) return;
    if (managers.get(root) === vendorId) return;
    managers.set(root, vendorId);
    const uid = 'vdoc-' + crypto.randomUUID();
    const box = document.createElement('div'); box.className = 'vdoc-manager'; box.dataset.vendorDocumentsManager = vendorId;
    box.innerHTML = '<h3>客戶下載文件</h3><div class="vdoc-message" role="status" aria-live="polite">正在載入文件…</div><div class="vdoc-upload"><label for="'+uid+'-file">公開文件（JPG、PNG、PDF、Word；每檔 50 MB 以內）</label><input id="'+uid+'-file" data-doc-file type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" form="vendor-public-documents-form"><label for="'+uid+'-title">文件名稱</label><input id="'+uid+'-title" data-doc-title maxlength="120" form="vendor-public-documents-form"><label for="'+uid+'-note">簡短說明</label><input id="'+uid+'-note" data-doc-note maxlength="500" form="vendor-public-documents-form"><button type="button" class="vdoc-command" data-doc-upload>上傳文件（預設隱藏）</button><progress max="100" value="0" hidden aria-label="文件上傳進度"></progress></div><div class="vdoc-manager-list"></div><button type="button" class="vdoc-command" data-doc-reload title="重新載入文件">↻ 重新載入</button>';
    root.appendChild(box);
    window.SakuraTutorials?.attach(box.querySelector('h3'), 'vendorDocuments', 0, '上傳文件與客戶下載');
    const message = box.querySelector('.vdoc-message'), list = box.querySelector('.vdoc-manager-list');
    let items = [], editable = false, busy = false, attempt = null;
    const endpoint = (admin ? '/admin-api/vendor-documents' : '/api/vendor-store/documents') + '?vendor_id=' + encodeURIComponent(vendorId) + '&manage=1';
    function headers() {
      let current = token;
      if (admin) { try { current = JSON.parse(localStorage.getItem('sakura_admin_session') || 'null')?.token || ''; } catch {} }
      return current ? { Authorization:'Bearer ' + current } : {};
    }
    function status(value, error = false) { message.textContent = value; message.classList.toggle('vdoc-error', error); message.setAttribute('role',error?'alert':'status'); }
    function lock(value) { busy = value; box.querySelectorAll('button,input,select').forEach(control => control.disabled = value || !editable); box.querySelector('[data-doc-reload]').disabled = value; }
    function draw() {
      list.innerHTML = items.length ? items.map(item => '<div class="vdoc-managed" data-doc-id="'+esc(item.id)+'"><div class="vdoc-meta"><b>'+esc(format(item))+'</b><span>'+size(item.file_size)+' · '+esc(item.status==='published'?'公開':'隱藏')+'</span></div><label>文件名稱<input data-doc-item-title value="'+esc(item.title)+'" maxlength="120" form="vendor-public-documents-form"></label><label>簡短說明<input data-doc-item-note value="'+esc(item.description)+'" maxlength="500" form="vendor-public-documents-form"></label><div class="vdoc-edit-grid"><label>順序<input data-doc-order type="number" min="1" max="999" value="'+item.display_order+'" form="vendor-public-documents-form"></label><label>顯示狀態<select data-doc-status form="vendor-public-documents-form"><option value="hidden" '+(item.status==='hidden'?'selected':'')+'>隱藏</option><option value="published" '+(item.status==='published'?'selected':'')+'>公開</option></select></label></div><div class="vdoc-buttons"><button type="button" class="vdoc-command" data-doc-save>確認儲存</button><button type="button" class="vdoc-command" data-doc-archive>下架文件</button></div><label>替換原檔<input data-doc-replace-file type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" form="vendor-public-documents-form"></label><button type="button" class="vdoc-command" data-doc-replace>替換檔案</button></div>').join('') : '<p class="vdoc-empty">尚未上傳客戶下載文件。</p>';
      list.querySelectorAll('[data-doc-id]').forEach(row => {
        const item = items.find(item => item.id === row.dataset.docId);
        const values = () => ({ id:item.id, revision:item.revision, title:row.querySelector('[data-doc-item-title]').value, description:row.querySelector('[data-doc-item-note]').value, display_order:row.querySelector('[data-doc-order]').value, status:row.querySelector('[data-doc-status]').value });
        row.querySelector('[data-doc-save]').onclick = () => mutate({ action:'update', ...values() });
        row.querySelector('[data-doc-replace]').onclick = () => mutate({ action:'replace', ...values() }, row.querySelector('[data-doc-replace-file]').files[0]);
        row.querySelector('[data-doc-archive]').onclick = () => { if(confirm('下架「'+item.title+'」？客戶將無法下載，檔案與紀錄仍保留。')) mutate({action:'archive',id:item.id,revision:item.revision}); };
      });
      lock(busy);
    }
    async function load() {
      if (busy) return;
      lock(true); status('正在載入文件…');
      try { const response = await fetch(endpoint, { headers:headers(), credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(20000) }); const result = await response.json(); if(!result.success)throw new Error(result.message); items=result.data.items; editable=result.data.editable; draw(); status(editable?'文件 '+items.length+' / 20':'此店家尚未核准或已停權，文件僅供查看。'); }
      catch(error) { editable=false; status(error.message || '文件載入失敗，請重新載入。',true); }
      finally { lock(false); }
    }
    function upload(data, file) {
      return new Promise((resolve,reject) => {
        const form = new FormData(); Object.entries(data).forEach(([key,value])=>form.append(key,String(value)));form.append('file',file);
        const xhr = new XMLHttpRequest();xhr.open('POST',endpoint);xhr.withCredentials=true;xhr.timeout=180000;Object.entries(headers()).forEach(([key,value])=>xhr.setRequestHeader(key,value));
        const progress=box.querySelector('progress');progress.hidden=false;progress.value=0;xhr.upload.onprogress=event=>{if(event.lengthComputable)progress.value=Math.round(event.loaded/event.total*100);};
        xhr.onload=()=>{try{resolve(JSON.parse(xhr.responseText));}catch{reject(new Error('文件上傳失敗，請重新載入。'));}};xhr.onerror=()=>reject(new Error('網路中斷，請重新載入以確認上傳結果。'));xhr.ontimeout=()=>reject(new Error('上傳逾時，請重新載入以確認結果。'));xhr.onloadend=()=>progress.hidden=true;xhr.send(form);
      });
    }
    async function mutate(data, file) {
      if(busy || !editable)return;
      if(['upload','replace'].includes(data.action) && (!file || !file.size || file.size>50_000_000))return status('請選擇非空白文件，每個檔案不可超過 50 MB。',true);
      if(data.action !== 'archive' && !String(data.title||'').trim())return status('請填寫文件名稱。',true);
      if(data.status==='published') { if(!confirm('確認此文件可供所有客戶從商城店家頁公開下載？請勿上傳證照、保險、合約或個人資料。'))return;data.confirmed=true; }
      const key=JSON.stringify([data,file?.name,file?.size,file?.lastModified]);
      if(attempt?.key!==key)attempt={key,id:crypto.randomUUID()};
      data.request_id=attempt.id;lock(true);status('正在儲存文件…');
      try { const result=file?await upload(data,file):await (await fetch(endpoint,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(data),signal:AbortSignal.timeout(20000)})).json();if(!result.success)throw new Error(result.message);attempt=null;items=result.data.items;draw();status(result.message||'操作已完成。');if(data.action==='upload'){box.querySelector('[data-doc-file]').value='';box.querySelector('[data-doc-title]').value='';box.querySelector('[data-doc-note]').value='';}if(publicReload)await publicReload(); }
      catch(error){status(error.message||'文件操作失敗。',true);}
      finally{lock(false);}
    }
    box.querySelector('[data-doc-file]').onchange=()=>{const file=box.querySelector('[data-doc-file]').files[0];if(file&&!box.querySelector('[data-doc-title]').value)box.querySelector('[data-doc-title]').value=file.name.replace(/\.[^.]+$/,'');};
    box.querySelector('[data-doc-upload]').onclick=()=>mutate({action:'upload',title:box.querySelector('[data-doc-title]').value,description:box.querySelector('[data-doc-note]').value,status:'hidden'},box.querySelector('[data-doc-file]').files[0]);
    box.querySelector('[data-doc-reload]').onclick=load;
    load();
  }

  function storefront(vendorId) {
    const quick=document.querySelector('.quick');if(!quick||!vendorId)return;
    const entry=document.createElement('button');entry.type='button';entry.className='vdoc-entry';entry.id='vendorDocumentsOpen';entry.hidden=true;entry.setAttribute('aria-haspopup','dialog');entry.setAttribute('aria-controls','vendorDocumentsDialog');quick.after(entry);
    const dialog=document.createElement('dialog');dialog.className='vdoc-dialog';dialog.id='vendorDocumentsDialog';dialog.setAttribute('aria-labelledby','vendorDocumentsHeading');dialog.innerHTML='<header><h2 id="vendorDocumentsHeading">'+esc(T.title)+'</h2><button type="button" class="vdoc-icon" data-doc-close title="'+esc(T.close)+'" aria-label="'+esc(T.close)+'">✕</button></header><div class="vdoc-public-list"></div>';document.body.appendChild(dialog);
    const list=dialog.querySelector('.vdoc-public-list');let previousOverflow='';
    entry.onclick=()=>{previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();};
    dialog.querySelector('[data-doc-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{document.body.style.overflow=previousOverflow;entry.focus();});dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
    publicReload=async()=>{
      try { const response=await fetch('/api/vendor-store/documents?vendor_id='+encodeURIComponent(vendorId),{cache:'no-store',signal:AbortSignal.timeout(20000)});const result=await response.json();if(!result.success){entry.hidden=true;if(dialog.open)dialog.close();return;}const items=result.data.items;entry.hidden=!items.length;entry.textContent='↓ '+T.title+' ('+items.length+')';list.innerHTML=items.length?items.map(item=>'<article class="vdoc-public-row"><div class="vdoc-file-icon" data-format="'+esc(format(item))+'">'+esc(format(item))+'</div><div class="vdoc-public-info"><h3>'+esc(item.title)+'</h3><p>'+esc(format(item))+' · '+size(item.file_size)+'</p>'+(item.description?'<p>'+esc(item.description)+'</p>':'')+'<div class="vdoc-buttons">'+(['application/pdf','image/jpeg','image/png'].includes(item.mime_type)?link(item):'')+link(item,true)+'</div></div></article>').join('')+'<div class="vdoc-external">'+items.map(item=>'<div>'+link(item,true,true)+' · '+esc(item.title)+'</div>').join('')+'</div>':'<p>'+esc(T.empty)+'</p>';if(!items.length&&dialog.open)dialog.close(); }
      catch { entry.hidden=false;entry.textContent='↓ '+T.title;list.innerHTML='<p role="alert">'+esc(T.failed)+'</p><button type="button" class="vdoc-command" data-doc-retry>'+esc(T.retry)+'</button>';list.querySelector('[data-doc-retry]').onclick=publicReload; }
    };
    window.addEventListener("sakura-benefits-changed",event=>event.detail.push(publicReload()));
    publicReload();
  }
  window.SakuraVendorDocuments={ manager, application(vendorId){const root=document.getElementById('vendorPublicDocumentsApplication');if(root)manager(root,vendorId);}, owner(vendorId,allowed){if(allowed)manager(document.getElementById('builder'),vendorId);} };
  document.addEventListener('DOMContentLoaded',()=>{
    if(document.querySelector('.quick'))storefront(params.get('vendor_id'));
    if(window.location.pathname==='/vendor-management'){
      const attach=()=>{const form=document.querySelector('[data-form="vendor-edit"]');if(form)manager(form,form.querySelector('[name="id"]')?.value,true);};
      new MutationObserver(attach).observe(document.getElementById('view'),{childList:true});attach();
    }
  });
}

export function decorateVendorDocumentsHtml(html) {
  const styles = `<style>
    .vdoc-entry[hidden],.vdoc-manager progress[hidden]{display:none!important}.vdoc-entry{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin:12px 0 0;padding:10px 14px;border:1px solid #e9103b;border-left:5px solid #e9103b;border-radius:8px;background:#fff;color:#b50930;font:inherit;font-weight:800;cursor:pointer}.vdoc-dialog{position:fixed;inset:auto 0 0;width:min(100%,540px);max-height:82dvh;margin:0 auto;padding:0;border:1px solid #dbe3ee;border-radius:8px 8px 0 0;background:#fff;color:#071226;overflow:auto}.vdoc-dialog::backdrop{background:rgba(0,0,0,.4)}.vdoc-dialog header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;padding:16px;border-bottom:1px solid #dbe3ee;z-index:1}.vdoc-dialog h2{font-size:20px;margin:0}.vdoc-icon{width:40px;height:40px;border:1px solid #cfd8e6;border-radius:6px;background:#fff;font-size:20px;cursor:pointer}.vdoc-public-list{padding:0 16px calc(16px + env(safe-area-inset-bottom))}.vdoc-public-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;padding:18px 0;border-bottom:1px solid #dbe3ee}.vdoc-file-icon{height:48px;display:grid;place-items:center;background:#eaf2ff;color:#1d4ed8;border-radius:6px;font-size:13px;font-weight:800}.vdoc-file-icon[data-format=PDF]{background:#fff1f2;color:#b91c1c}.vdoc-file-icon[data-format=JPG],.vdoc-file-icon[data-format=PNG]{background:#ecfdf5;color:#047857}.vdoc-public-info h3{font-size:16px;margin:0;overflow-wrap:anywhere}.vdoc-public-info p{font-size:13px;color:#64748b;line-height:1.6;margin:6px 0;overflow-wrap:anywhere}.vdoc-buttons{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.vdoc-action{display:inline-flex;align-items:center;min-height:40px;color:#1d4ed8;text-decoration:none;font-size:14px;font-weight:700;padding:4px 8px}.vdoc-external{margin-top:16px;border-top:1px solid #dbe3ee;padding-top:8px;font-size:12px;color:#64748b;overflow-wrap:anywhere}.vdoc-manager{padding:16px 0;margin-top:16px;border-top:2px solid #e9103b;min-width:0}.vdoc-manager h3{font-size:17px;color:#b50930;margin:0 0 12px;padding:0;cursor:default}.vdoc-manager h3::after{content:none}.vdoc-manager label{display:block;font-size:13px;font-weight:700;margin:10px 0;min-width:0}.vdoc-manager input,.vdoc-manager select{display:block;width:100%;min-height:42px;margin-top:6px;padding:8px;border:1px solid #cfd8e6;border-radius:6px;background:#fff;font:inherit;box-sizing:border-box}.vdoc-manager input[type=file]{font-size:13px;max-width:100%}.vdoc-command{min-height:40px;padding:8px 12px;border:1px solid #cfd8e6;border-radius:6px;background:#fff;color:#123966;font:inherit;font-size:14px;cursor:pointer}.vdoc-command:disabled{opacity:.5;cursor:not-allowed}.vdoc-message{padding:10px;margin-bottom:12px;background:#f0f6ff;color:#1e3a5f;font-size:13px;line-height:1.6;overflow-wrap:anywhere;border:1px solid #dbe3ee;border-radius:6px}.vdoc-error{border:2px solid #b91c1c;background:#fff1f2;color:#991b1b}.vdoc-managed{border-top:1px solid #dbe3ee;padding:16px 0}.vdoc-meta{display:flex;gap:12px;align-items:center;color:#64748b;font-size:13px}.vdoc-meta b{color:#123966}.vdoc-edit-grid{display:grid;grid-template-columns:100px minmax(0,1fr);gap:12px}.vdoc-manager progress{width:100%;height:14px;margin-top:12px}.vdoc-empty{color:#64748b;font-size:14px}.vdoc-manager:focus-within{outline-offset:4px}[data-form=vendor-edit]>.vdoc-manager{padding:16px}#vendorPublicDocumentsApplication{padding:0 16px;background:#fff;border:1px solid #dbe3ee;border-radius:8px;margin-bottom:14px}
  </style>`;
  return decorateActivityTutorialHtml(html.replace('</head>', styles+'<script>(()=>{const __name=target=>target;('+documentsRuntime.toString()+')();})();</script></head>'));
}
