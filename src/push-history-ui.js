export const pushHistoryHtml=`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>推播紀錄與成效｜SAKURA Welfare</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#162236;font:15px/1.6 system-ui,sans-serif}main{width:min(100%,1240px);margin:auto;padding:20px}
header,.actions{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}h1{margin:0;font-size:28px}h2{margin:0;font-size:22px;overflow-wrap:anywhere}
p{margin:8px 0}.muted,#statusText{color:#47576d}.surface{background:#fff;border:1px solid #dce3ec;border-radius:10px;padding:16px;margin:12px 0}
form{display:grid;grid-template-columns:minmax(175px,2fr) repeat(4,minmax(115px,1fr));gap:10px;align-items:end}
label{display:block;font-weight:650}input,select,button,a.button{font:inherit;color:inherit;border:1px solid #bac6d4;border-radius:7px;min-height:42px;padding:7px 10px;background:#fff}
input,select{display:block;width:100%;min-width:0}button,a.button{cursor:pointer}a.button{text-decoration:none}button.primary{background:#b7103e;border-color:#b7103e;color:white;font-weight:700}button:disabled{opacity:.5;cursor:default}
.table{overflow-x:auto}table{width:100%;min-width:925px;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #e5eaf1;padding:10px;vertical-align:middle}
th{background:#f1f4f8;font-weight:700}td:first-child{min-width:125px}td:nth-child(2){min-width:170px;overflow-wrap:anywhere}.metric{text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;border-radius:20px;padding:3px 9px;background:#edf2fa;color:#284366;white-space:nowrap}.pill.needs_review,.pill.partial,.pill.failed{background:#fff2db;color:#783a09}
.pill.sent{background:#e6f7ee;color:#146442}.pager{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:14px}
dialog{width:min(620px,100%);height:100%;max-height:100%;margin:0 0 0 auto;border:1px solid #dce3ec;padding:20px;overflow:auto}dialog::backdrop{background:#111c3766}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}.reason{padding:10px 12px;background:#fff7e8;border-left:4px solid #b46a19;overflow-wrap:anywhere}
#outcomes{padding-left:21px}#outcomes li{margin:6px 0}[hidden]{display:none!important}
#linkStats{min-width:0;table-layout:fixed}#linkStats th:first-child{width:50%}#linkStats td{min-width:0;overflow-wrap:anywhere}
@media(max-width:750px){main{padding:13px}form{grid-template-columns:repeat(2,minmax(0,1fr))}form label:first-child,.actions{grid-column:1/-1}.surface{padding:10px}header h1{font-size:23px}}
</style></head>
<body><main>
<header><h1>推播紀錄與成效</h1><a class="button" id="back" href="/sakura-admin">返回管理後台</a></header>
<p class="muted">查看立即與預約推播的結果及原因。LINE 已接受不代表手機已送達。</p>
<section class="surface" aria-label="查詢條件"><form id="filters">
<label>推播名稱<input name="q" type="search" maxlength="120" placeholder="輸入名稱關鍵字"></label>
<label>起日（台北）<input name="from" type="date"></label><label>迄日（台北）<input name="to" type="date"></label>
<label>傳送方式<select name="type"><option value="">全部方式</option><option value="scheduled">預約</option><option value="immediate">立即</option></select></label>
<label>發送狀態<select name="status"><option value="">全部狀態</option></select></label>
<div class="actions"><button type="submit" class="primary">查詢</button><button type="button" id="reset">清除</button></div></form></section>
<section class="surface" aria-label="推播紀錄"><p id="statusText" role="status"></p>
<div class="table"><table><thead><tr><th scope="col">時間（台北）</th><th scope="col">推播名稱</th><th scope="col">方式</th><th scope="col" class="metric">預計受眾</th><th scope="col" class="metric">LINE 已接受</th><th scope="col" class="metric">LINE 拒絕</th><th scope="col" class="metric">估算開封率</th><th scope="col" class="metric">點擊人數</th><th scope="col">狀態</th><th scope="col">明細</th></tr></thead><tbody id="rows"></tbody></table></div>
<nav class="pager" aria-label="推播紀錄分頁"><button id="prev" disabled>上一頁</button><span id="page">第 1 頁</span><button id="next" disabled>下一頁</button></nav></section>
<dialog id="detail" aria-labelledby="detailTitle"><header><h2 id="detailTitle">推播明細</h2><button id="close">關閉</button></header>
<div id="detailData"><p id="detailStatus" role="status"></p><dl id="summary"></dl><p id="reason" class="reason" hidden></p>
<h3 id="outcomeTitle" hidden>發送明細</h3><ul id="outcomes"></ul><p id="outcomeNote" class="muted"></p>
<details id="recipientReview" hidden><summary>查看需核對的受眾</summary><ul id="recipientReviewRows"></ul></details>
<section id="insights" hidden><h3>LINE 成效</h3><dl id="insightMetrics"></dl>
<p class="muted">估算開封率以 LINE 回報的開封人數除以 LINE 已接受人數。點擊人數由 LINE 去重統計。</p>
<p id="insightNote" class="muted"></p>
<table id="linkStats" hidden><caption>各連結點擊統計</caption><thead><tr><th scope="col">網址</th><th scope="col" class="metric">點擊人數</th><th scope="col" class="metric">點擊次數</th></tr></thead><tbody id="linkRows"></tbody></table>
<p id="linkNote" class="muted"></p></section></div></dialog>
</main><script>
const at=id=>document.getElementById(id);
const filters=at('filters'), dialog=at('detail');
const stateLabels={draft:'草稿',scheduled:'已預約',dispatching:'處理中',sending:'處理中',sent:'LINE 已接受',partial:'部分未完成',needs_review:'需人工確認',cancelled:'已取消',failed:'發送失敗'};
const mode=row=>row.type==='scheduled'?'預約':'立即';
const dataStates={untracked:'未追蹤',pending:'待同步',unavailable:'暫無數據',no_accepted:'無可統計'};
function metric(insights,key,suffix=''){
  const value=insights?.[key];
  if(typeof value==='number')return value+suffix;
  return dataStates[insights?.state||'untracked']||
    (key==='openRate'&&typeof insights?.opens==='number'?'無法估算':'資料不足');
}
const fmt=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const when=value=>{
  if (!value) return '—';
  const input=typeof value==='string'&&!/[zZ]|[+-][0-9]{2}:?[0-9]{2}$/.test(value)?value.replace(' ','T')+'Z':value;
  const date=new Date(input);
  return Number.isNaN(date.getTime())?'—':fmt.format(date);
};
function text(tag,value,className){
  const el=document.createElement(tag);el.textContent=value;
  if(className)el.className=className;
  return el;
}
for(const [state,label] of Object.entries(stateLabels))filters.elements.status.add(new Option(label,state));
if(new URLSearchParams(location.search).get('embedded')==='1')at('back').hidden=true;
async function get(params){
  const response=await fetch('/admin-api/line-push-history?'+params,{cache:'no-store'});
  const data=await response.json();
  if(!response.ok||!data.success)throw Error(data.message||'暫時無法查詢。');
  return data;
}
let page=1, activeFilters=new URLSearchParams(), listVersion=0, detailVersion=0;
function tableRow(row){
  const tr=document.createElement('tr');
  for(const value of [when(row.scheduled_at??row.created_at),row.title||'未命名推播',mode(row)])tr.append(text('td',value));
  for(const value of [row.recipient_count,row.success_count,row.failed_count])tr.append(text('td',value,'metric'));
  tr.append(text('td',metric(row.insights,'openRate','%'),'metric'),text('td',metric(row.insights,'clickers'),'metric'));
  const cell=document.createElement('td');cell.append(text('span',stateLabels[row.status]||'舊紀錄','pill '+(Object.hasOwn(stateLabels,row.status)?row.status:'')));tr.append(cell);
  const action=document.createElement('td'),button=text('button','查看明細');
  button.type='button';button.addEventListener('click',()=>showDetail(row.id));action.append(button);tr.append(action);
  return tr;
}
async function load(pageToRead){
  const run=++listVersion;
  const query=new URLSearchParams(activeFilters);query.set('page',pageToRead);
  at('statusText').textContent='正在讀取推播紀錄…';
  at('rows').replaceChildren();at('prev').disabled=true;at('next').disabled=true;
  try{
    const result=await get(query);
    if(run!==listVersion)return;
    page=result.page;
    at('rows').replaceChildren(...result.items.map(tableRow));
    at('statusText').textContent=result.items.length?'本頁 '+result.items.length+' 筆紀錄':'沒有符合條件的推播紀錄。';
    at('page').textContent='第 '+page+' 頁';
    at('prev').disabled=page===1;at('next').disabled=!result.hasMore;
  }catch(error){if(run===listVersion)at('statusText').textContent=error.message;}
}
filters.addEventListener('submit',e=>{e.preventDefault();activeFilters=new URLSearchParams(new FormData(filters));load(1);});
at('reset').onclick=()=>{filters.reset();activeFilters=new URLSearchParams();load(1);};
at('prev').onclick=()=>load(page-1);at('next').onclick=()=>load(page+1);
at('close').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{detailVersion++;});
function showInsights(insights) {
  at('insights').hidden=false;
  const facts=[['開封人數',metric(insights,'opens')],['估算開封率',metric(insights,'openRate','%')],['點擊人數',metric(insights,'clickers')]];
  at('insightMetrics').replaceChildren(...facts.flatMap(([label,value])=>[text('dt',label),text('dd',value)]));
  at('insightNote').textContent=insights?.updatedAt ? '最後同步（台北）｜'+when(insights.updatedAt) :
    '開封和點擊統計由 LINE 定期回報。';
  const links=insights?.links||[];
  at('linkRows').replaceChildren(...links.map((item,index)=>{
    const row=document.createElement('tr');
    row.append(text('td',(index+1)+'. '+item.label),text('td',item.people??'資料不足','metric'),text('td',item.clicks??'資料不足','metric'));
    return row;
  }));
  at('linkStats').hidden=links.length===0;
  at('linkNote').textContent=links.length?'網址只顯示網域和路徑。':'目前沒有 LINE 回報的連結統計。';
}
async function showDetail(id){
  const run=++detailVersion;
  at('detailTitle').textContent='推播明細';at('detailStatus').textContent='正在讀取…';
  at('summary').replaceChildren();at('outcomes').replaceChildren();at('outcomeNote').textContent='';
  at('recipientReview').hidden=true;at('recipientReview').open=false;at('recipientReviewRows').replaceChildren();
  at('reason').hidden=true;at('outcomeTitle').hidden=true;at('insights').hidden=true;
  if(!dialog.open)dialog.showModal();
  try{
    const {data}=await get(new URLSearchParams({id}));
    if(run!==detailVersion||!dialog.open)return;
    at('detailTitle').textContent=data.title||'未命名推播';
    at('detailStatus').textContent=stateLabels[data.status]||'舊紀錄';
    const facts=[
      ['傳送方式',mode(data)],
      [data.type==='scheduled'?'預約時間':'建立時間',when(data.scheduled_at??data.created_at)],
      ['預計受眾',data.recipient_count],['LINE 已接受',data.success_count],['LINE 拒絕',data.failed_count],
      ['已記錄未發送',data.totals.not_sent],['結果不明',data.totals.unknown]
    ];
    for(const [label,value] of facts)at('summary').append(text('dt',label),text('dd',value));
    at('reason').textContent=data.reason;at('reason').hidden=!data.reason;
    showInsights(data.insights);
    at('outcomeTitle').hidden=false;
    for(const row of data.outcomes)at('outcomes').append(text('li',row.status+' '+row.count+' 人'+(row.reason?'｜'+row.reason:'')));
    const issues=data.recipientIssues||[];
    if(issues.length){
      for(const row of issues){
        const entry=text('li',(row.display_name||'LINE 使用者')+'（末碼 '+row.line_user_id.slice(-6)+'）｜'+row.reason+' ');
        const link=text('a','查看會員資料');
        link.href='/crm-users#user='+encodeURIComponent(row.line_user_id);link.target='_blank';link.rel='noopener noreferrer';
        entry.append(link);at('recipientReviewRows').append(entry);
      }
      at('recipientReview').querySelector('summary').textContent='查看需核對的受眾（'+issues.length+' 人）';
      at('recipientReview').hidden=false;
    }
    at('outcomeNote').textContent=!data.outcomes.length?'這筆紀錄沒有逐人發送明細。':
      data.recorded>0&&data.recorded<data.recipient_count?'部分受眾缺少發送明細，未列入各原因的統計。':'';
  }catch(error){if(run===detailVersion&&dialog.open)at('detailStatus').textContent=error.message;}
}
window.addEventListener('storage',e=>{if(e.key==='sakura_admin_session'&&e.newValue)load(1);});
window.addEventListener('message',e=>{
  if(e.origin===location.origin&&e.source===parent&&e.data?.type==='sakura-admin-session-ready')load(1);
});
load(1);
</script></body></html>`;
