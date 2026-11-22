const UID = /^U[0-9a-f]{32}$/i;
const MAX_RECORDS = 50;
const PUBLIC_STATES = new Set(['pending','sending','accepted','failed','unknown','skipped_unverified','skipped_missing_recipient','skipped_disabled']);
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

// Supplement events are already the durable source of truth. Read them without
// creating chat messages, changing unread counters, or repeating a push.
export async function handleVendorSupplementMonitor(request, db, {authorizeVendorAdmin} = {}) {
  if(request.method !== 'GET') return Response.json({success:false,message:'不支援此操作。'},{status:405,headers});
  if(!db || typeof authorizeVendorAdmin !== 'function') return Response.json({success:false,message:'暫時無法讀取通知紀錄。'},{status:503,headers});
  try {
    const admin = await authorizeVendorAdmin(request, db);
    const units = String(admin?.business_units || '').split(',').map(x=>x.trim()).filter(Boolean);
    if(!admin || !(units.includes('*') || (units.includes('vendors') && units.includes('line')))) {
      return Response.json({success:false,message:'需要廠商管理及 LINE OA 專區權限。'},{status:403,headers});
    }
    const rows = await db.prepare(`SELECT e.event_id, e.created_at, e.notification_state, e.recipient_uid, v.name AS vendor_name
      FROM welfare_vendor_review_events e LEFT JOIN welfare_vendors v ON v.id=e.vendor_id
      WHERE e.next_status='needs_supplement' ORDER BY e.created_at DESC, e.event_id DESC LIMIT ?`).bind(MAX_RECORDS).all();
    const records = (rows.results || []).map(row=>{
      const original = String(row.notification_state || 'unknown');
      const state = PUBLIC_STATES.has(original) ? (original==='sending'?'unknown':original) : 'unknown';
      const uid=String(row.recipient_uid||'').trim();
      // UID is a stored snapshot, not the vendor's current applicant identity.
      return {id:String(row.event_id||''),createdAt:String(row.created_at||''),vendorName:String(row.vendor_name||'廠商資料已不存在'),state,recipientUid:UID.test(uid)?uid:''};
    });
    return Response.json({success:true,records,limit:MAX_RECORDS},{headers});
  } catch (err) {
    if (/no such table.*(?:welfare_vendor_review_events|welfare_vendors)/i.test(String(err?.message||err))) return Response.json({success:true,records:[],limit:MAX_RECORDS,schemaUnavailable:true},{headers});
    return Response.json({success:false,message:'暫時無法讀取通知紀錄，請稍後再試。'},{status:503,headers});
  }
}

// Adds a self-contained, read-only panel to the existing monitor page. Its
// request is independent of the chat APIs; the original UI stays untouched.
export function decorateVendorSupplementMonitor(html) {
  const injection = `<style>
  #vendor-supplement-monitor{margin:8px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;overflow:hidden;flex-shrink:0}
  #vendor-supplement-monitor summary{padding:10px;cursor:pointer;font-weight:700;color:#134e4a}
  #vendor-supplement-monitor .vsm-body{padding:0 10px 10px;max-height:240px;overflow:auto;font-size:13px;overflow-wrap:anywhere}
  #vendor-supplement-monitor .vsm-record{padding:9px 0;border-top:1px solid #e2e8f0;line-height:1.5}
  #vendor-supplement-monitor .vsm-uid{font-family:monospace;overflow-wrap:anywhere}
  body.left-collapsed #vendor-supplement-monitor{display:none}
  </style><script>(()=>{
    const anchor=document.getElementById('threadList'); if(!anchor)return;
    const box=document.createElement('details');box.id='vendor-supplement-monitor';
    const title=document.createElement('summary');title.textContent='廠商補件推播紀錄';box.appendChild(title);
    const body=document.createElement('div');body.className='vsm-body';
    const refresh=document.createElement('button');refresh.type='button';refresh.textContent='重新載入';
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='展開後載入最近 50 筆紀錄。';
    const list=document.createElement('div');body.append(refresh,status,list);box.appendChild(body);anchor.parentNode.insertBefore(box,anchor);
    const labels={accepted:'LINE 已接受（不代表已送達或已讀）',failed:'LINE 拒絕，未發送',unknown:'結果待確認，請勿重送',pending:'尚未發送',skipped_unverified:'未核對身分，未發送',skipped_missing_recipient:'沒有有效收件 UID，未發送',skipped_disabled:'未設定推播，未發送'};
    let busy=false;
    async function load(){if(busy)return;busy=true;refresh.disabled=true;status.textContent='讀取中…';list.replaceChildren();
      try{let saved={};try{saved=JSON.parse(localStorage.getItem('sakura_admin_session')||'{}')}catch(_){};
        const h={};if(saved.token)h.Authorization='Bearer '+saved.token;
        const response=await fetch('/admin-api/vendor-supplement-monitor',{headers:h,cache:'no-store'});const data=await response.json();if(!response.ok||!data.success)throw new Error(data.message||'讀取失敗。');
        status.textContent=data.schemaUnavailable?'尚未建立補件紀錄。':data.records.length?'最近 '+data.limit+' 筆補件通知紀錄（廠商為目前名稱）。':'目前沒有補件通知紀錄。';
        for(const row of data.records){const el=document.createElement('div');el.className='vsm-record';const name=document.createElement('strong');name.textContent=row.vendorName;
          const when=document.createElement('div');const date=new Date(row.createdAt);when.textContent=Number.isNaN(date.getTime())?row.createdAt:date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
          const state=document.createElement('div');state.textContent=labels[row.state]||labels.unknown;
          const uid=document.createElement('div');uid.className='vsm-uid';uid.textContent=(row.state==='pending'||row.state.startsWith('skipped_')?'預定對象 UID（未發送）：':'通知目標 UID：')+(row.recipientUid||'無紀錄');
          el.append(name,when,state,uid);list.appendChild(el)}
      }catch(error){status.textContent=error.message||'讀取失敗，請稍後再試。'}finally{busy=false;refresh.disabled=false}}
    box.addEventListener('toggle',()=>{if(box.open)load()});refresh.addEventListener('click',load);
  })();</script>`;
  return html.replace('</body>', injection+'</body>');
}
