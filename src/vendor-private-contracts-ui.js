function privateContractsRuntime(){
  const mounted=new WeakMap();
  function mount(root,vendorId,admin=false){
    if(!root||!vendorId||mounted.get(root)===vendorId)return;
    mounted.set(root,vendorId);
    const box=document.createElement('section');box.className='private-contracts';
    box.innerHTML='<h3>合作合約（私密附件）</h3><p>僅供已登入的申請廠商與授權管理員查看，供福委會審核。新檔會保留舊版本；上傳後請完成申請表並重新送審。</p><p data-contract-notice role="status" aria-live="polite">正在載入合約…</p><label>補交合約（PDF、JPG、PNG、Word；10 MB 以內）<input data-contract-file type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" form="vendor-private-contract-form"></label><button data-contract-upload type="button" disabled>私密上傳合約</button><button data-contract-reload type="button">重新載入合約</button><div data-contract-list></div>';
    root.append(box);
    const notice=box.querySelector('[data-contract-notice]'),list=box.querySelector('[data-contract-list]'),input=box.querySelector('[data-contract-file]'),upload=box.querySelector('[data-contract-upload]');
    const base=admin?'/admin-api/vendor-contracts':'/api/vendor-application/contracts';
    const endpoint=base+'?vendor_id='+encodeURIComponent(vendorId);
    let revision=0,editable=false,busy=false,attempt=null;
    const status=(message,error=false)=>{notice.textContent=message;notice.setAttribute('role',error?'alert':'status');};
    function headers(){
      let session;try{session=JSON.parse(localStorage.getItem(admin?'sakura_admin_session':'sakura_vendor_session')||'null');}catch{}
      const token=admin?session?.token:new URLSearchParams(location.search).get('portal_token')||session?.portal_token;
      return token?{Authorization:'Bearer '+token}:{};
    }
    function lock(){upload.disabled=busy||!editable;input.disabled=busy||!editable;box.querySelector('[data-contract-reload]').disabled=busy;}
    async function download(item){
      if(busy)return;busy=true;lock();
      try{
        const response=await fetch(item.download_url,{headers:headers(),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Error((await response.json()).message||'合約下載失敗。');
        const blob=await response.blob(),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=item.original_filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);status('已下載合約。');
      }catch(error){status(error.message||'合約下載失敗，請重新登入。',true);}finally{busy=false;lock();}
    }
    function draw(data){
      revision=data.revision;editable=data.editable;list.replaceChildren();
      if(!data.items.length){const empty=document.createElement('p');empty.textContent='尚未補交合作合約。';list.append(empty);}
      for(const item of data.items){const row=document.createElement('p'),name=document.createElement('span'),button=document.createElement('button');name.textContent='版本 '+item.revision+'：'+item.original_filename+' ';button.type='button';button.textContent='下載合約';button.onclick=()=>download(item);row.append(name,button);list.append(row);}
    }
    async function load(){
      busy=true;lock();
      try{const response=await fetch(endpoint,{headers:headers(),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)}),result=await response.json();if(!response.ok||!result.success)throw Error(result.message);draw(result.data);status('合約僅供本人與授權管理員查看。');}
      catch(error){editable=false;list.replaceChildren();status(error.message||'合約載入失敗，請重新登入。',true);}finally{busy=false;lock();}
    }
    upload.onclick=async()=>{
      const file=input.files?.[0];if(busy||!editable)return;
      if(!file||!file.size||file.size>10485760)return status('請選擇非空白合約，檔案不可超過 10 MB。',true);
      const fingerprint=JSON.stringify([file.name,file.size,file.lastModified]);if(attempt?.fingerprint!==fingerprint)attempt={fingerprint,id:crypto.randomUUID(),expectedRevision:revision};
      const form=new FormData();form.append('file',file);form.append('request_id',attempt.id);form.append('expected_revision',String(attempt.expectedRevision));busy=true;lock();status('正在私密上傳合約…');
      try{const response=await fetch(endpoint,{method:'POST',headers:headers(),credentials:'same-origin',body:form,signal:AbortSignal.timeout(120000)}),result=await response.json();if(!response.ok||!result.success)throw Error(result.message);draw(result.data);input.value='';attempt=null;status(result.message);}
      catch(error){status(error.message||'上傳結果尚未確認，請重新載入合約。',true);}finally{busy=false;lock();}
    };
    input.onchange=()=>{attempt=null;};
    box.querySelector('[data-contract-reload]').onclick=load;load();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(location.pathname==='/vendor-apply'){
      const form=document.getElementById('vendorApplyForm'),params=new URLSearchParams(location.search);let session;try{session=JSON.parse(localStorage.getItem('sakura_vendor_session')||'null');}catch{}
      const vendorId=params.get('vendor_id')||session?.vendor_id;
      if(vendorId)mount(form?.querySelector('[name="contract_end"]')?.closest('section')||form,vendorId);
    }
    if(location.pathname==='/vendor-management'){
      const attach=()=>{const form=document.querySelector('[data-form="vendor-edit"]');if(form)mount(form,form.querySelector('[name="id"]')?.value,true);};
      const view=document.getElementById('view');if(view)new MutationObserver(attach).observe(view,{childList:true});attach();
    }
  });
}

export function decorateVendorPrivateContractHtml(html){
  if(typeof html!=='string'||html.includes('id="private-contract-runtime"'))return html;
  return html.replace('</head>','<style>.private-contracts{margin:18px 0;padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}.private-contracts h3{margin-top:0}.private-contracts p{overflow-wrap:anywhere;line-height:1.6}.private-contracts input{display:block;max-width:100%;margin:8px 0}.private-contracts button{min-height:42px;margin:4px;padding:8px 12px}.private-contracts [role=alert]{color:#991b1b}</style><script id="private-contract-runtime">(()=>{const __name=fn=>fn;('+privateContractsRuntime.toString()+')();})();</script></head>');
}
