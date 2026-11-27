export const activityHistoryHtml = `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>活動列表總覽 | SAKURA Welfare</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#182333;font:16px/1.5 system-ui,sans-serif}
main{max-width:1240px;margin:auto;padding:20px}.top,.actions,.paging{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.top,.paging{justify-content:space-between}h1{margin:0;font-size:clamp(23px,4vw,31px)}
section{background:#fff;border:1px solid #d8e1eb;border-radius:12px;overflow:hidden;margin-top:16px}
form{display:flex;gap:12px;align-items:end;flex-wrap:wrap;padding:16px;border-bottom:1px solid #d8e1eb}
label{display:grid;min-width:0;gap:5px;font-weight:600}label.search{flex:1 1 230px}
button,input,select,a.button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #bfccda;border-radius:8px;background:#fff;color:inherit}
button,a.button{font-weight:600;cursor:pointer}button:disabled{opacity:.55;cursor:default}
a.button{display:inline-flex;align-items:center;text-decoration:none}.primary{background:#a71944;color:#fff;border-color:#a71944}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #e4eaf0;vertical-align:top}
th{background:#f1f4f8;font-weight:600;font-size:14px;white-space:nowrap}
td:first-child{min-width:160px;font-weight:650;overflow-wrap:anywhere}td:last-child{min-width:205px}td .actions{gap:6px}
.meta,.paging,output{padding:10px 16px;color:#435970}output:empty{display:none}output{display:block}output a{margin-inline-start:8px;color:#9c1742}td span{white-space:nowrap}
@media(max-width:640px){
  main{padding:12px}form{align-items:stretch}label.search{flex-basis:100%}.scroll{overflow:visible}
  table,tbody,td{display:block}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  tr{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:12px;border-bottom:1px solid #d8e1eb}
  td,td:first-child,td:last-child{min-width:0;border:0;padding:2px;overflow-wrap:anywhere}
  td:first-child,td:last-child{grid-column:1/-1}td:not(:first-child):not(:last-child)::before{content:attr(data-label);display:block;color:#526880;font-size:13px}
}
</style></head><body><main>
<div class="top"><h1>活動列表總覽</h1><a class="button" id="calendar" href="/activity-checkin-admin">返回活動行事曆</a></div>
<section aria-label="活動清單"><form id="filters">
  <label>顯示範圍<select id="filter"><option value="past">過往活動</option><option value="all">全部活動</option><option value="draft">草稿</option></select></label>
  <label class="search">活動名稱或地點<input id="term" type="search" maxlength="100"></label>
  <button type="submit" class="primary">搜尋</button>
</form><p class="meta" id="status" role="status" aria-live="polite"></p><output id="notice" aria-live="polite"></output>
<div class="scroll"><table><thead><tr><th scope="col">活動</th><th scope="col">活動時間（台北）</th><th scope="col">地點</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead>
<tbody id="rows"></tbody></table></div>
<div class="paging"><button id="previous" disabled>上一頁</button><span id="page">第 1 頁</span><button id="next" disabled>下一頁</button></div>
</section></main>
<script>
const q=id=>document.getElementById(id);
const embedded=new URLSearchParams(location.search).get('embedded')==='1';
const calendar='/activity-checkin-admin';
const api='/admin-api/activity-checkin?view=history';
const titles={active:'啟用',draft:'草稿',closed:'關閉',archived:'封存'};
const date=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'});
let page=1, version=0, pending=false;
const copyIds=new Map();
q('calendar').href=calendar+(embedded?'?embedded=1':'');
function node(tag,label){
  const element=document.createElement(tag);
  if(label!==undefined)element.textContent=label;
  return element;
}
function link(label,id){
  const anchor=node('a',label);
  anchor.href=calendar+'?event_id='+encodeURIComponent(id)+(embedded?'&embedded=1':'');
  anchor.className='button';return anchor;
}
function taipeiTime(value){
  if(!value)return '—';
  if(/(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)){
    const instant=new Date(value);
    if(!Number.isNaN(instant.getTime()))return date.format(instant);
  }
  return value.replace('T',' ').slice(0,16);
}
async function call(url,options){
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000),...options});
  const data=await response.json();
  if(!response.ok||!data.success)throw Object.assign(new Error(data.message||'活動資料暫時無法讀取。'),{status:response.status});
  return data;
}
async function copy(event,button){
  if(pending)return;
  pending=true;button.disabled=true;
  const previous=copyIds.get(event.id),requestId=previous||crypto.randomUUID();
  copyIds.set(event.id,requestId);
  q('notice').textContent='正在複製活動…';
  try{
    const data=await call(api,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'copy_event',data:{id:event.id,request_id:requestId}})});
    copyIds.delete(event.id);
    q('notice').replaceChildren(document.createTextNode('已建立草稿「'+data.draft.title+'」。'),link('編輯新草稿',data.draft.id));
    if(q('filter').value==='draft')await load(1);
  }catch(error){
    const confirmed=error.status>=400&&error.status<500;
    if(confirmed)copyIds.delete(event.id);
    q('notice').textContent=confirmed?error.message:'目前無法確認複製結果，請按同一活動的「複製為草稿」重試。';
  }finally{pending=false;button.disabled=false;}
}
function render(events){
  q('rows').replaceChildren(...events.map(event=>{
    const row=node('tr');
    const values=[['活動',event.title],['活動時間',taipeiTime(event.start_at)],['地點',event.location||'—'],['狀態',titles[event.status]||event.status]];
    for(const [label,value] of values){
      const cell=node('td',value);cell.dataset.label=label;row.append(cell);
    }
    const operations=node('td'),buttons=node('div'),button=node('button','複製為草稿');
    buttons.className='actions';button.type='button';button.onclick=()=>copy(event,button);
    buttons.append(link('查看活動',event.id),button);operations.append(buttons);row.append(operations);
    return row;
  }));
}
async function load(target=1){
  const request=++version;
  q('previous').disabled=q('next').disabled=true;
  q('status').textContent='正在讀取活動…';
  const search=new URLSearchParams({filter:q('filter').value,q:q('term').value,page:String(target)});
  try{
    const result=await call(api+'&'+search);
    if(request!==version)return;
    page=target;render(result.events);
    q('status').textContent=result.events.length?'':'目前沒有符合條件的活動。';
    q('page').textContent='第 '+page+' 頁';
    q('previous').disabled=page===1;
    q('next').disabled=!result.has_next;
  }catch(error){
    if(request!==version)return;
    q('rows').replaceChildren();
    q('status').textContent=error.message||'讀取失敗，請按搜尋重試。';
  }
}
q('filters').onsubmit=event=>{event.preventDefault();load(1);};
q('filter').onchange=()=>load(1);
q('previous').onclick=()=>load(page-1);
q('next').onclick=()=>load(page+1);
load();
</script></body></html>`;
