// UI only: the caller must supply server-authorized, visible locations and own
// navigation. This component does not read benefits, write data or build URLs.
function vendorBranchPickerRuntime() {
  const copy = {
    zh: {choose:'選擇分店',hint:'請選擇要查看的分店。',current:'目前分店',switch:'切換分店',missing:'地址未提供',unnamed:'未命名分店',unavailable:'找不到這家可用分店，請重新選擇。'},
    id: {choose:'Pilih cabang',hint:'Pilih cabang yang ingin Anda lihat.',current:'Cabang saat ini',switch:'Ganti cabang',missing:'Alamat belum tersedia',unnamed:'Cabang tanpa nama',unavailable:'Cabang tidak tersedia. Silakan pilih lagi.'},
    th: {choose:'เลือกสาขา',hint:'กรุณาเลือกสาขาที่ต้องการดู',current:'สาขาปัจจุบัน',switch:'เปลี่ยนสาขา',missing:'ยังไม่ระบุที่อยู่',unnamed:'สาขาที่ยังไม่มีชื่อ',unavailable:'ไม่พบสาขาที่ใช้งานได้ กรุณาเลือกอีกครั้ง'}
  };
  function mount({container,locations,selectedId='',locale='zh',onSelect}={}) {
    if (!(container instanceof Element) || typeof onSelect !== 'function') throw new TypeError('branch picker requires a container and selection handler');
    const t=copy[locale]||copy.zh, seen=new Set();
    const rows=(Array.isArray(locations)?locations:[]).filter(item=>{
      const id=String(item?.id||'').trim(),status=String(item?.status||'active').trim().toLowerCase();
      if(!id||seen.has(id)||status!=='active')return false;
      seen.add(id);return true;
    });
    const requested=String(selectedId||'').trim(), selected=rows.find(row=>String(row.id)===requested);
    const invalid=Boolean(requested&&!selected);
    const chosen=selected||(!requested&&rows.length===1?rows[0]:null);
    const requiresChoice=invalid||(!chosen&&rows.length>1);
    container.replaceChildren();
    container.hidden=!requiresChoice&&rows.length<2;
    if(container.hidden)return {requiresChoice,selectedId:chosen?String(chosen.id):''};
    const section=document.createElement('section');section.className='svbp-panel';section.setAttribute('aria-label',t.choose);
    const heading=document.createElement('h2');heading.className='svbp-heading';heading.textContent=chosen?t.current:t.choose;section.appendChild(heading);
    if(invalid){const notice=document.createElement('p');notice.className='svbp-notice';notice.setAttribute('role','status');notice.textContent=t.unavailable;section.appendChild(notice);}
    let expanded=!chosen;
    const current=document.createElement('div');current.className='svbp-current';
    const list=document.createElement('div');list.className='svbp-list';list.setAttribute('role','group');list.setAttribute('aria-label',t.choose);
    if(chosen){
      const name=document.createElement('strong');name.textContent=String(chosen.branch_name||'').trim()||t.unnamed;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='svbp-switch';toggle.textContent=t.switch;toggle.setAttribute('aria-expanded','false');
      toggle.addEventListener('click',()=>{expanded=!expanded;list.hidden=!expanded;toggle.setAttribute('aria-expanded',String(expanded));});
      current.append(name,toggle);section.appendChild(current);
    } else if(!invalid){const hint=document.createElement('p');hint.className='svbp-hint';hint.textContent=t.hint;section.appendChild(hint);}
    for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className='svbp-branch';button.dataset.branchId=String(row.id);
      const name=document.createElement('strong');name.textContent=String(row.branch_name||'').trim()||t.unnamed;
      const address=document.createElement('span');address.textContent=String(row.address||'').trim()||t.missing;
      button.append(name,address);button.addEventListener('click',()=>onSelect(String(row.id)));list.appendChild(button);
    }
    list.hidden=!expanded;section.appendChild(list);container.appendChild(section);
    return {requiresChoice,selectedId:chosen?String(chosen.id):''};
  }
  window.SakuraVendorBranchPicker=Object.freeze({mount});
}

export function vendorBranchPickerAssets() {
  return `<style id="sakura-vendor-branch-picker-style">
  .svbp-panel{box-sizing:border-box;border:1px solid #dbe3ee;border-radius:14px;background:#fff;padding:16px;margin:12px 0;color:#14263a}
  .svbp-heading{font-size:18px;line-height:1.4;margin:0 0 8px}.svbp-hint,.svbp-notice{margin:0 0 12px;color:#52627a;line-height:1.5}.svbp-notice{color:#a33a20}
  .svbp-current{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.svbp-switch{border:1px solid #a9b9c9;border-radius:8px;background:#fff;color:#14263a;padding:9px 12px;min-height:42px;cursor:pointer}
  .svbp-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px;margin-top:10px}.svbp-list[hidden]{display:none}
  .svbp-branch{box-sizing:border-box;text-align:left;min-width:0;min-height:64px;padding:11px 12px;border:1px solid #d7e2ec;border-radius:10px;background:#fff;color:#14263a;cursor:pointer;overflow-wrap:anywhere}
  .svbp-branch strong,.svbp-branch span{display:block}.svbp-branch span{margin-top:4px;color:#52627a;font-size:13px;line-height:1.5}.svbp-branch:focus-visible,.svbp-switch:focus-visible{outline:3px solid #4b9de5;outline-offset:2px}
  @media(max-width:480px){.svbp-list{grid-template-columns:1fr}.svbp-panel{padding:14px}}
  </style><script>(()=>{const __name=(target)=>target;(${vendorBranchPickerRuntime.toString()})();})();</script>`;
}
