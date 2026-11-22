export function decorateVendorOrderingHtml(html) {
  return html
    .replace('Date.now()+(visibility==="hidden"?', 'Date.now()+(state.tab==="vendors"?"&module=vendors":"")+(visibility==="hidden"?')
    .replace('function setTab(tab){ const wasHidden=state.visibility==="hidden";', 'function setTab(tab){ const wasVendor=state.tab==="vendors"; const wasHidden=state.visibility==="hidden";')
    .replace('if(wasHidden)load().catch(err=>toast(err.message)); }', 'if(wasHidden||wasVendor!==(tab==="vendors"))load().catch(err=>toast(err.message)); }')
    .replace('return applySearch([...(state.data.vendors || [])].filter(matchesVendorMode).sort((a,b)=>sortTime(b)-sortTime(a)));', 'const items=[...(state.data.vendors || [])].filter(matchesVendorMode);if(state.tab!=="vendors")items.sort((a,b)=>sortTime(b)-sortTime(a));return applySearch(items);')
    .replace("+ filter + searchBox(", "+ (state.tab===\"vendors\"?'<a class=\"btn\" href=\"/vendor-order-admin\" title=\"可搜尋全部店家並調整前台排序\">調整排序（搜尋全部店家）</a>':'') + filter + searchBox(");
}
