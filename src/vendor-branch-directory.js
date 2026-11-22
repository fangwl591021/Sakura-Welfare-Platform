// Only explicitly created Skylark draft brands use grouped cards. Other
// directory entries retain their existing per-location behavior.
export function groupSelectedBrandCards(stores,allStores=stores) {
  const ids=new Set(['skylark-group-v1-grazie','skylark-group-v1-yokohama','skylark-group-v1-syabuhana','skylark-group-v1-musashi','skylark-group-v1-skylark','skylark-group-v1-syabuyo']);
  const counts=new Map();
  for(const s of allStores)if(ids.has(s.vendorId))counts.set(s.vendorId,(counts.get(s.vendorId)||0)+1);
  const seen=new Set(), out=[];
  for(const s of stores){
    if(!ids.has(s.vendorId)){out.push(s);continue;}
    if(seen.has(s.vendorId))continue;
    seen.add(s.vendorId);
    out.push({...s,branchName:'',branchCount:counts.get(s.vendorId),address:'',phone:'',businessHours:'',hasBusinessHours:false,openNow:false,mapsUrl:'',storeUrl:'/vendor-store?vendor_id='+encodeURIComponent(s.vendorId)});
  }
  return out;
}

export function branchCountLabel(count,locale) {
  return locale==='id'?`Total ${count} cabang`:locale==='th'?`รวม ${count} สาขา`:`共 ${count} 間分店`;
}

export function isSelectedBranchBrand(vendorId) {
  return ['skylark-group-v1-grazie','skylark-group-v1-yokohama','skylark-group-v1-syabuhana','skylark-group-v1-musashi','skylark-group-v1-skylark','skylark-group-v1-syabuyo'].includes(String(vendorId||''));
}

export function filterSelectedBrandDirectoryRows(rows) {
  return rows.filter(row=>!isSelectedBranchBrand(row.vendor_id)||
    Boolean(row.id)&&String(row.status||'active').trim()==='active');
}

// Keep the established directory, filtering, and single-store sheet intact;
// only the six explicitly identified brand cards navigate to the branch picker.
export function decorateSelectedBrandDirectory(html) {
  function replaceOnce(before,after){
    const index=html.indexOf(before);
    if(index<0||html.indexOf(before,index+before.length)>=0)throw Error('Branch directory integration marker changed');
    html=html.slice(0,index)+after+html.slice(index+before.length);
  }
  replaceOnce('let allStores=[];',`let allStores=[];const groupSelectedBrandCards=${groupSelectedBrandCards.toString()};const branchCountLabel=${branchCountLabel.toString()};`);
  replaceOnce('const list=allStores.filter((s)=>{','const filtered=allStores.filter((s)=>{');
  replaceOnce('});$("empty").style.display=list.length?','});const list=groupSelectedBrandCards(filtered,allStores);$("empty").style.display=list.length?');
  replaceOnce('function addressSummary(s){return esc(String(s.address||"").trim()||TEXT.noAddress)}','function addressSummary(s){return s.branchCount?esc(branchCountLabel(s.branchCount,STORE_LOCALE)):esc(String(s.address||"").trim()||TEXT.noAddress)}');
  replaceOnce('if(!s)return;$("sheetName").textContent=storeTitle(s);','if(!s)return;if(s.branchCount){location.href=localizeStoreUrl(s.storeUrl,STORE_LOCALE,location.origin);return;}$("sheetName").textContent=storeTitle(s);');
  const region="'</span><span class=\"pill\">'+esc(regionLabel(s.region))+'</span>'";
  if(html.split(region).length!==3)throw Error('Branch directory region marker changed');
  html=html.split(region).join("'</span>'+(s.branchCount?'':'<span class=\"pill\">'+esc(regionLabel(s.region))+'</span>')");
  return html;
}
