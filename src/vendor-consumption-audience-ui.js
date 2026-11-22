// The vendor audience is a read-only projection of confirmed personal-QR records.
export function vendorConsumptionAudienceHtml() {
  return String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <title>消費會員名單｜櫻花福委會</title>
  <style>
    :root{--ink:#11233a;--muted:#586a7d;--border:#dce4ed;--brand:#dc143d;--bg:#f4f6f9}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI","Noto Sans TC",sans-serif;font-size:16px;line-height:1.55}
    header{background:var(--brand);color:#fff;font-size:20px;font-weight:800;padding:16px 20px}.wrap{max-width:1060px;margin:0 auto;padding:22px 16px 44px}
    .top{display:flex;align-items:start;justify-content:space-between;gap:16px;flex-wrap:wrap}.top h1{font-size:26px;margin:0 0 6px}.top p{margin:0;color:var(--muted)}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 16px;background:#fff;color:var(--ink);border:1px solid #cbd7e4;border-radius:8px;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}
    .button:disabled{opacity:.5;cursor:not-allowed}.button.primary{background:#12304f;border-color:#12304f;color:#fff}.button:focus-visible,input:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}
    .notice{margin:20px 0 16px;padding:14px 16px;border:1px solid #dce8f3;border-left:4px solid #4d8bc6;border-radius:8px;background:#f6fbff;color:#36536c}
    .panel{border:1px solid var(--border);border-radius:12px;background:#fff;overflow:hidden}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding:18px;border-bottom:1px solid var(--border)}
    .search{display:flex;align-items:end;gap:8px;flex:1 1 420px;flex-wrap:wrap}.field{display:flex;flex-direction:column;gap:5px;flex:1 1 220px}.field label{font-weight:700}.field input{width:100%;min-height:44px;font:inherit;color:var(--ink);border:1px solid #cbd7e4;border-radius:8px;padding:8px 12px}.total{margin:0;color:var(--muted)}
    .status{padding:14px 18px;color:var(--muted);min-height:50px}.status.error{background:#fff4f4;color:#9a2430}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:580px}th,td{text-align:left;border-top:1px solid var(--border);padding:13px 18px;vertical-align:top}th{background:#f7f9fb;color:#40556a;font-size:14px}td:first-child{font-weight:700}.empty{text-align:center;padding:40px 18px;color:var(--muted)}
    .pagination{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:16px 18px;border-top:1px solid var(--border);flex-wrap:wrap}.page-label{color:var(--muted);font-weight:600}
    [hidden]{display:none!important}@media(max-width:600px){header{padding:14px 16px}.wrap{padding:16px 12px 32px}.top h1{font-size:23px}.top .button{width:100%}.toolbar{padding:14px}.search{flex-basis:100%}.search .field{flex:1 0 100%}.search .button{flex:1}.notice{font-size:15px}.table-wrap{overflow:visible}table,tbody,tr,td{display:block;width:100%;min-width:0}thead{display:none}tr{padding:12px 14px;border-top:1px solid var(--border)}td{display:flex;justify-content:space-between;gap:18px;border:0;padding:4px 0;text-align:right}td:before{content:attr(data-label);color:var(--muted);font-size:14px;font-weight:600;text-align:left}td:first-child{font-size:17px}.pagination{justify-content:center}}
  </style>
</head>
<body>
  <header>櫻花福委會廠商專區</header>
  <main class="wrap">
    <div class="top"><div><h1>消費會員名單</h1><p>查看本店已完成個人 QR 消費的會員紀錄。</p></div><a class="button" href="/vendor-portal">返回廠商專區</a></div>
    <p class="notice">名單依本店已完成的個人 QR 消費紀錄統計；同一會員重複消費會合併。此名單尚未開放付費推播。</p>
    <section class="panel" aria-label="消費會員">
      <div class="toolbar"><form class="search" id="search-form"><div class="field"><label for="search">搜尋會員</label><input id="search" type="search" maxlength="100" placeholder="輸入會員名稱" autocomplete="off"></div><button class="button primary" type="submit">搜尋</button><button class="button" type="button" id="reset">清除</button></form><p class="total" id="total"></p></div>
      <div class="status" id="status" role="status" aria-live="polite">正在讀取名單…</div>
      <div class="table-wrap" id="table-wrap" hidden><table><thead><tr><th>會員名稱</th><th>首次消費（台北時間）</th><th>最近消費（台北時間）</th><th>消費次數</th></tr></thead><tbody id="rows"></tbody></table></div>
      <p class="empty" id="empty" hidden></p>
      <div class="pagination" id="pagination" hidden><button class="button" type="button" id="previous">上一頁</button><span class="page-label" id="page-label"></span><button class="button" type="button" id="next">下一頁</button></div>
    </section>
  </main>
  <script>
    (()=>{
      const $=id=>document.getElementById(id);let sequence=0,activePage=1,activeQuery='',lastPage=1,loading=false;
      function signedToken(){
        let saved={};try{saved=JSON.parse(localStorage.getItem('sakura_vendor_session')||sessionStorage.getItem('sakura_vendor_session')||'{}')||{};}catch(_){saved={};}
        const token=String(saved.portal_token||'').trim();
        return token.length<=4096&&/^[A-Za-z0-9_-]+\.[a-f0-9]+$/i.test(token)?token:'';
      }
      function dateTaipei(value){
        if(!value)return '—';let s=String(value).trim();
        if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(s))s=s.replace(' ','T')+'Z';
        const d=new Date(s);if(!Number.isFinite(d.getTime()))return '—';
        return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(/\//g,'/');
      }
      function setStatus(message,error){$('status').textContent=message;$('status').classList.toggle('error',!!error);}
      function resetView(){ $('rows').replaceChildren();$('table-wrap').hidden=true;$('empty').hidden=true;$('pagination').hidden=true;$('total').textContent=''; }
      function cell(row,label,value){const td=document.createElement('td');td.dataset.label=label;td.textContent=value;row.append(td);}
      async function load(page,query){
        const requestId=++sequence;loading=true;resetView();setStatus('正在讀取名單…',false);
        const url=new URL('/api/vendor-consumption-audience',location.origin);url.searchParams.set('page',String(page));if(query)url.searchParams.set('q',query);
        const headers={};const token=signedToken();if(token)headers.Authorization='Bearer '+token;
        try{
          const response=await fetch(url.toString(),{headers,credentials:'same-origin',cache:'no-store'}),body=await response.json().catch(()=>null);if(requestId!==sequence)return;
          if(!response.ok||!body||body.success!==true)throw new Error(body&&typeof body.message==='string'?body.message:'無法讀取名單，請稍後再試。');
          const data=body.data;if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.page)||data.page<1||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.page_size)||data.page_size<1||typeof data.has_more!=='boolean')throw new Error('名單資料不完整，請稍後再試。');
          activePage=data.page;activeQuery=query;lastPage=Math.max(1,Math.ceil(data.total/data.page_size));$('total').textContent='符合條件 '+data.total.toLocaleString('zh-TW')+' 位會員';setStatus('',false);$('status').hidden=true;
          if(!data.items.length){$('empty').textContent=query?'找不到符合條件的會員。':'目前沒有符合條件的消費會員紀錄。';$('empty').hidden=false;return;}
          for(const item of data.items){const tr=document.createElement('tr');const name=typeof item.display_name==='string'?item.display_name.trim():'';cell(tr,'會員名稱',name&&!/U[0-9a-f]{32}/i.test(name)?name:'LINE 會員');cell(tr,'首次消費',dateTaipei(item.first_consumed_at));cell(tr,'最近消費',dateTaipei(item.last_consumed_at));const count=Number(item.consumption_count);cell(tr,'消費次數',Number.isSafeInteger(count)&&count>=0?String(count)+' 次':'—');$('rows').append(tr);}
          $('table-wrap').hidden=false;$('pagination').hidden=false;$('page-label').textContent='第 '+activePage+' / '+lastPage+' 頁';$('previous').disabled=activePage<=1;$('next').disabled=!data.has_more;
        }catch(error){if(requestId!==sequence)return;$('status').hidden=false;setStatus(error&&error.message?error.message:'無法讀取名單，請稍後再試。',true);}
        finally{if(requestId===sequence)loading=false;}
      }
      $('search-form').addEventListener('submit',event=>{event.preventDefault();$('status').hidden=false;load(1,$('search').value.trim());});
      $('reset').addEventListener('click',()=>{$('search').value='';$('status').hidden=false;load(1,'');});
      $('previous').addEventListener('click',()=>{if(!loading&&activePage>1){$('status').hidden=false;load(activePage-1,activeQuery);}});
      $('next').addEventListener('click',()=>{if(!loading&&activePage<lastPage){$('status').hidden=false;load(activePage+1,activeQuery);}});
      load(1,'');
    })();
  </script>
</body>
</html>`;
}
