export function decorateVendorPosAdminHtml(html) {
  const styles = `<style>
    [data-admin-pos-discounts] .admin-pos-message{margin:0 0 16px;padding:12px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;line-height:1.6;overflow-wrap:anywhere}
    [data-admin-pos-discounts] .admin-pos-message strong{display:none}
    [data-admin-pos-discounts] .admin-pos-message[data-state="error"]{border:2px solid #e11d48;background:#fff1f2;color:#9f1239}
    [data-admin-pos-discounts] .admin-pos-message[data-state="error"] strong{display:block;font-size:16px;margin-bottom:4px}
    [data-admin-pos-discounts] .admin-pos-message[data-state="error"]:focus{outline:3px solid #9f1239;outline-offset:2px}
    [data-admin-pos-discounts] input[aria-invalid="true"]{border:2px solid #e11d48;background:#fff1f2}
    [data-admin-pos-discounts] .admin-pos-message[data-state="success"]{border-color:#15803d;background:#f0fdf4;color:#166534}
  </style>`;
  const script = String.raw`
    function adminPosDiscountSection(v){return '<div class="form-section" data-admin-pos-discounts data-vendor-id="'+esc(v.id)+'"><h3>本店核銷折扣設定</h3><div id="adminPosDiscountMessage" class="admin-pos-message" data-admin-pos-message role="status" aria-live="polite" tabindex="-1"><strong>請確認折扣設定</strong><span>正在讀取本店設定，目前顯示系統預設：員工 8 折／訪客 9 折。</span></div><div class="form-grid"><div class="field"><label for="adminEmployeeFold">員工折數</label><input id="adminEmployeeFold" type="number" min="0.1" max="9.9" step="0.1" value="8" aria-describedby="adminPosDiscountMessage" disabled></div><div class="field"><label for="adminVisitorFold">訪客折數</label><input id="adminVisitorFold" type="number" min="0.2" max="10" step="0.1" value="9" aria-describedby="adminPosDiscountMessage" disabled></div><div class="actions"><button class="btn green" type="button" data-save-admin-pos disabled>儲存核銷折扣</button><button class="btn" type="button" data-reload-admin-pos>重新載入折扣</button></div></div></div>';}
    function bindAdminPosDiscounts(){
      const box=$('[data-admin-pos-discounts]');if(!box)return;
      const employee=box.querySelector('#adminEmployeeFold'),visitor=box.querySelector('#adminVisitorFold'),save=box.querySelector('[data-save-admin-pos]'),reload=box.querySelector('[data-reload-admin-pos]'),message=box.querySelector('[data-admin-pos-message]');
      // Discount controls save independently of the enclosing vendor-details form.
      employee.setAttribute('form','admin-pos-discount-form');visitor.setAttribute('form','admin-pos-discount-form');
      let policy=null,lastLoaded=null,attempt=null,busy=false,validationError=false;
      function clearInvalid(){employee.removeAttribute('aria-invalid');visitor.removeAttribute('aria-invalid');validationError=false;}
      function showMessage(text,state='info',reveal=false){message.querySelector('span').textContent=text;message.dataset.state=state;message.setAttribute('role',state==='error'?'alert':'status');message.setAttribute('aria-live',state==='error'?'assertive':'polite');if(reveal){message.scrollIntoView({block:'center'});message.focus({preventScroll:true});}}
      function edited(){if(validationError){clearInvalid();showMessage('修改後請再次儲存；員工折數必須小於訪客折數。');}}
      employee.addEventListener('input',edited);visitor.addEventListener('input',edited);
      async function api(data){let session;try{session=JSON.parse(localStorage.getItem('sakura_admin_session')||'null')}catch{}
        if(!session?.token)throw new Error('請先登入管理後台。');
        const response=await fetch('/admin-api/vendor-pos-discounts'+(data?'':'?vendor_id='+encodeURIComponent(box.dataset.vendorId)),{method:data?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(20000)});
        const result=await response.json();if(!result.success)throw new Error(result.message||'折扣設定操作失敗。');return result.data;}
      async function load(){if(busy)return;busy=true;employee.disabled=visitor.disabled=save.disabled=true;reload.disabled=true;clearInvalid();showMessage('正在讀取折扣設定…');
        try{policy=await api();lastLoaded=policy;employee.value=policy.employeeFold;visitor.value=policy.visitorFold;employee.disabled=visitor.disabled=save.disabled=!policy.editable;attempt=null;showMessage(policy.editable?'員工折數須小於訪客折數，確認儲存後立即生效。未設定預設為員工 8／訪客 9 折。':'此店家尚未核准或已停權，折扣設定僅供查看。');}
        catch(error){policy=null;employee.value=lastLoaded?.employeeFold??8;visitor.value=lastLoaded?.visitorFold??9;showMessage(error.message+(lastLoaded?' 顯示上次已載入的折數，重新載入成功前無法儲存。':' 尚未取得本店設定，僅顯示系統預設：員工 8 折／訪客 9 折，無法儲存。'),'error');}
        finally{busy=false;reload.disabled=false;}}
      reload.onclick=load;
      save.onclick=async()=>{if(busy||!policy?.editable)return;const employeeFold=employee.value,visitorFold=visitor.value;
        const validFold=value=>/^\d{1,2}(\.\d)?$/.test(value)&&Number(value)>0&&Number(value)<=10;
        const validEmployee=validFold(employeeFold),validVisitor=validFold(visitorFold),invalidOrder=validEmployee&&validVisitor&&Number(employeeFold)>=Number(visitorFold);
        if(!validEmployee||!validVisitor||invalidOrder){clearInvalid();validationError=true;if(!validEmployee||invalidOrder)employee.setAttribute('aria-invalid','true');if(!validVisitor||invalidOrder)visitor.setAttribute('aria-invalid','true');showMessage(invalidOrder?'無法儲存：員工 '+employeeFold+' 折／訪客 '+visitorFold+' 折。員工折數必須小於訪客折數，員工優惠才能大於訪客。':'無法儲存：折數須為 0.1 到 10、最多一位小數，且員工折數必須小於訪客折數。','error',true);return;}
        clearInvalid();
        if(!confirm('確認員工 '+employeeFold+' 折、訪客 '+visitorFold+' 折？儲存後立即生效。'))return;
        const key=JSON.stringify([employeeFold,visitorFold,policy.revision]);if(attempt?.key!==key)attempt={key,requestId:crypto.randomUUID()};
        busy=true;save.disabled=employee.disabled=visitor.disabled=reload.disabled=true;showMessage('正在儲存核銷折扣…');
        try{const updated=await api({vendor_id:box.dataset.vendorId,employeeFold,visitorFold,confirmed:true,revision:policy.revision,requestId:attempt.requestId});policy={...updated,editable:true};lastLoaded=policy;attempt=null;showMessage('核銷折扣已儲存，新的個人 QR 核銷立即生效。','success');}
        catch(error){showMessage(error.message,'error',true);}
        finally{busy=false;save.disabled=employee.disabled=visitor.disabled=reload.disabled=false;}};
      load();
    }
  `;
  const section = '+ businessHoursSection(v) + carouselSection(v)';
  if (!html.includes(section) || !html.includes('function bind(){')) throw new Error('Vendor admin discount integration marker missing');
  return html.replace(section, '+ businessHoursSection(v) + adminPosDiscountSection(v) + carouselSection(v)')
    .replace('function bind(){', 'function bind(){ bindAdminPosDiscounts();')
    .replace('<script>', styles + '<script>\n' + script);
}
