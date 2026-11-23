import {editorPresets} from './editor-access.js';
function bridge(){
  const original=window.fetch.bind(window);
  const managed=p=>p.startsWith('/admin-api/')||p.startsWith('/workspace-api/')||p.startsWith('/api/line-oa/')||p==='/api/admin-access-check'||p==='/api';
  function activityScopeUi(data){
    if(data.editor_role!=='club_editor')return;
    const form=document.getElementById('eventForm');if(!form)return;
    let select=form.elements.namedItem('club_id');
    if(!select){const wrap=document.createElement('div');wrap.className='field';const label=document.createElement('label');label.textContent='所屬社團（新增社團活動必選）';select=document.createElement('select');select.name='club_id';select.id='editor-activity-club';wrap.append(label,select);form.prepend(wrap);}
    const previous=select.value;select.replaceChildren(new Option('請選擇社團',''));for(const club of data.clubs||[])select.add(new Option(club.title,club.id));select.value=previous;
  }
  window.fetch=function(input,init={}){
    const url=new URL(input instanceof Request?input.url:input,location.origin);
    if(url.origin!==location.origin||!managed(url.pathname))return original(input,init);
    const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((v,k)=>headers.set(k,v));
    let session;try{session=JSON.parse(localStorage.getItem('sakura_admin_session')||'null');}catch{}
    if(!headers.has('Authorization')&&!headers.has('X-Line-Id-Token')&&!headers.has('X-Line-Access-Token')&&session?.token)headers.set('Authorization','Bearer '+session.token);
    return original(input,{...init,headers}).then(response=>{
      if(url.pathname==='/admin-api/activity-checkin'&&(init.method||'GET')==='GET'&&response.ok)response.clone().json().then(data=>setTimeout(()=>activityScopeUi(data),0)).catch(()=>{});
      return response;
    });
  };
  if(location.pathname!=='/editor-workspace')document.addEventListener('DOMContentLoaded',async()=>{
    try{const response=await fetch('/admin-api/editor-context',{cache:'no-store'});if(!response.ok)return;const context=await response.json();if(context.editor&&!context.preset.pages.some(page=>page.url===location.pathname))location.replace('/editor-workspace');}catch{}
  });
}
const administrativePages=new Set(['/ai-ads-studio','/activity-stories-admin','/activity-story-grants','/sakura-admin','/admin-uid-whitelist','/activity-checkin-admin','/club-admin','/crm-users','/vendor-management','/vendor-order-admin','/rich-menu-editor','/flex-template-editor','/line-push','/line-oa-center','/line-keyword-rules','/line-oa-monitor','/line-segment-push','/tasks-center','/system-settings','/welfare-reports','/editor-workspace','/welfare-editor']);
export async function decorateAdministrativeResponse(request,response){
  const path=new URL(request.url).pathname;
  if(request.method!=='GET'||(!administrativePages.has(path)&&!['/welfare-shop-admin','/line-push-history'].includes(path))||!response.headers.get('Content-Type')?.includes('text/html'))return response;
  let html=await response.text();
  if(path==='/sakura-admin')html=html.replace('>活動花絮貼文</button></div><div class="metrics">','>活動花絮貼文</button><a class="btn" href="/welfare-shop-admin">福利品專區設定</a></div><div class="metrics">');
  const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');
  return new Response(html.replace(/<head[^>]*>/i,head=>head+'<script>(()=>{const __name=fn=>fn;('+bridge.toString()+')();})();</script>'),{status:response.status,headers});
}
const style=`*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#172d43;background:#f7f9fa}header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:18px 24px;background:white;border-bottom:1px solid #dce4eb}h1{font-size:23px;margin:0;flex:1}button,a.action,input,select,textarea{font:inherit;border:1px solid #cbd5df;border-radius:6px;background:white;padding:9px 13px;min-height:44px}button,a.action{cursor:pointer;color:#16588f;text-decoration:none}main{padding:20px 24px}#notice{color:#526477}iframe{width:100%;height:calc(100dvh - 170px);border:0;background:white}nav{display:flex;gap:10px;flex-wrap:wrap}nav button[aria-pressed=true],button.primary{background:#c8103d;color:white;border-color:#c8103d}.layout{display:grid;grid-template-columns:260px 1fr;gap:24px}aside button{display:block;width:100%;text-align:left;margin-bottom:8px}form{max-width:920px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}label{display:grid;gap:5px}.full{grid-column:1/-1}textarea{min-height:120px}footer{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}[hidden]{display:none!important}@media(max-width:700px){main,header{padding:14px}.layout,.fields{grid-template-columns:1fr}aside{max-height:220px;overflow:auto}iframe{height:calc(100dvh - 210px)}}`;
export function editorWorkspaceHtml(){return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小編工作區</title><style>${style}
body[data-workspace] #notice{color:#263e54;margin:0 0 12px}body[data-workspace] .workspace-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px;align-items:start}body[data-workspace] #tabs{display:grid;gap:8px;position:sticky;top:16px}body[data-workspace] #tabs button{text-align:left;padding:12px 14px;font-weight:700;color:#183a55;background:#fff}body[data-workspace] #tabs button[aria-pressed=true]{background:#c8103d;color:#fff}body[data-workspace] #tabs small{display:block;font-size:14px;line-height:1.5;font-weight:400;margin-top:4px}.workspace-scope{margin:0 0 18px;color:#263e54}.workspace-scope summary{cursor:pointer;font-weight:600;min-height:36px}.workspace-scope p{margin:4px 0}#current-section{font-size:21px;line-height:1.4;margin:0 0 12px}body[data-workspace] #content{height:calc(100dvh - 225px);min-height:440px}body[data-workspace] .workspace-panel{min-width:0}@media(max-width:760px){body[data-workspace] .workspace-layout{grid-template-columns:1fr;gap:16px}body[data-workspace] #tabs{position:static;grid-template-columns:repeat(2,minmax(0,1fr))}body[data-workspace] #tabs button{padding:10px;font-size:16px}body[data-workspace] #content{height:70dvh;min-height:460px}body[data-workspace=activity]>header h1{flex:1 0 100%}body[data-workspace=activity] #tabs button:last-child{grid-column:1/-1}}
</style></head><body><header><h1 id="title">小編工作區</h1><a class="action" href="/sakura-admin">返回後台</a><button id="logout">登出</button></header><main><p id="notice" role="status">正在驗證管理範圍…</p><details id="club-scope" class="workspace-scope" hidden><summary>查看目前管理範圍</summary><p>社團資料／活動／相簿：全部社團；文章與花絮：已授權社團。</p><p>社團相簿用來整理照片；文章與花絮用來編寫圖文貼文。未獲文章授權時，請洽管理員。</p></details><details id="activity-scope" class="workspace-scope" hidden><summary>查看目前管理範圍</summary><p>活動管理／報名簽到：一般活動（非社團活動）；文章與花絮：福委會。</p><p>活動管理用來設定活動與報名欄位；報名簽到用來查看名冊、匯出及處理出席。</p></details><div class="workspace-layout"><nav id="tabs" aria-label="工作區功能"></nav><section class="workspace-panel"><h2 id="current-section" hidden></h2><iframe id="content" title="所屬單位管理功能" hidden></iframe></section></div><section id="presets" hidden></section></main><script>
  const q=s=>document.querySelector(s);let context=null;
  async function lineLogin(){
    q('#notice').textContent='正在確認 LINE 身分與小編權限…';
    if(!window.liff)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://static.line-scdn.net/liff/edge/2/sdk.js';s.onload=resolve;s.onerror=()=>reject(new Error('LINE 登入元件載入失敗，請重新開啟。'));document.head.append(s);});
    await liff.init({liffId:'__SAKURA_LIFF_ID__'});
    if(!liff.isLoggedIn()){liff.login({redirectUri:location.origin+'/?liff.state='+encodeURIComponent('/editor-workspace?line_login=1')});return false;}
    const profile=await liff.getProfile();
    const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'reviewerLineLogin',data:{lineUserId:profile.userId,lineIdToken:liff.getIDToken?.()||'',lineAccessToken:liff.getAccessToken?.()||''}}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(!response.ok||!result.success)throw new Error(result.message||'LINE 登入未完成，請聯絡管理員。');
    if(!['admin','welfare_editor','activity_editor','club_editor'].includes(result.data?.role))throw new Error('此帳號沒有小編工作區權限，請聯絡管理員。');
    localStorage.setItem('sakura_admin_session',JSON.stringify(result.data));return true;
  }
  window.sakuraAdminEnsureSession=async()=>{if(new URLSearchParams(location.search).get('line_login')==='1'){if(!await lineLogin())return false;history.replaceState(null,'',location.pathname);}const r=await fetch('/admin-api/editor-context',{cache:'no-store'});if(!r.ok){q('#notice').textContent='登入已失效，請從聊天室重新開啟或聯絡管理員。';return false;}context=await r.json();window.sakuraAdminSessionRole=context.role;return true;};
  q('#logout').onclick=()=>{localStorage.removeItem('sakura_admin_session');location.replace('/sakura-admin');};
  (async()=>{if(!await window.sakuraAdminEnsureSession())return;
    if(!context.editor){q('#notice').textContent=context.role==='admin'?'管理員可選擇活動、社團或福利功能。':'小編權限範本已備妥；請在 UID 白名單選擇人員及角色後啟用。';q('#presets').hidden=false;for(const preset of context.presets||[]){const section=document.createElement('section'),h=document.createElement('h2'),p=document.createElement('p');h.textContent=context.role==='admin'?preset.label.replace('小編','工作區'):preset.label;p.textContent=context.role==='admin'?({welfare_editor:'管理福利優惠內容。',activity_editor:'管理活動、報名、簽到及花絮。',club_editor:'管理社團資料、活動與花絮。'}[preset.role]||''):preset.description;section.append(h,p);if(context.role==='admin')for(const page of preset.pages||[]){const a=document.createElement('a');a.className='action';a.href=page.url;a.textContent=page.label;section.append(a,document.createTextNode(' '));}q('#presets').append(section);}return;}
    q('#title').textContent=context.preset.label+'工作區';q('#notice').textContent=context.preset.description;
    const club=context.role==='club_editor',activity=context.role==='activity_editor',sectioned=club||activity;
    const entries=club?[
      {label:'社團資料',description:'介紹、聯絡窗口與封面',url:'/club-admin',section:'club'},
      {label:'社團活動／報名簽到',description:'活動、報名名冊與出席',url:'/activity-checkin-admin'},
      {label:'社團相簿',description:'照片、影片與活動相簿',url:'/club-admin',section:'gallery'},
      {label:'社團文章與花絮',description:'長文、圖文貼文與發布',url:'/activity-stories-admin'}
    ]:activity?[
      {label:'活動管理',description:'活動內容、封面與報名欄位',url:'/activity-checkin-admin',section:'manage'},
      {label:'報名簽到',description:'報名名冊、匯出與出席',url:'/activity-checkin-admin',section:'attendance'},
      {label:'文章與花絮',description:'福委會長文、圖文貼文與發布',url:'/activity-stories-admin'}
    ]:context.preset.pages;
    const pages=sectioned?entries.filter(page=>context.preset.pages.some(allowed=>allowed.url===page.url)):entries;
    const activitySections=new Map();
    if(sectioned){document.body.dataset.workspace=club?'club':'activity';q('#notice').textContent='選擇左側功能開始管理；手機請使用下方功能按鈕。';q(club?'#club-scope':'#activity-scope').hidden=false;q('#logout').textContent='登出／離開工作區';}
    for(const page of pages){const b=document.createElement('button');b.type='button';b.textContent=page.label;if(sectioned){const description=document.createElement('small');description.textContent=page.description;b.append(description);}b.onclick=()=>{
      const frame=q('#content'),url=new URL(page.url,location.origin);url.searchParams.set('embedded','1');if(page.section)url.searchParams.set('section',page.section);
      const activate=()=>{q('#tabs').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));frame.title=page.label;if(sectioned){q('#current-section').hidden=false;q('#current-section').textContent=page.label;}};
      if(activity&&page.url==='/activity-checkin-admin'){
        let samePage=false;try{samePage=frame.contentWindow.location.pathname===page.url;}catch{}
        if(samePage){try{if(frame.contentWindow.sakuraActivityWorkspace?.setSection?.(page.section)===true)activate();}catch{}return;}
      }
      frame.hidden=false;if(sectioned){frame.onload=()=>{try{const loaded=new URL(frame.contentWindow.location.href);if(loaded.pathname===url.pathname&&loaded.search===url.search)activate();}catch{}};}else activate();frame.src=url.pathname+url.search;
    };if(activity&&page.url==='/activity-checkin-admin'&&['manage','attendance'].includes(page.section))activitySections.set(page.section,()=>{q('#tabs').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));q('#content').title=page.label;q('#current-section').hidden=false;q('#current-section').textContent=page.label;});q('#tabs').append(b);}
    if(activity)window.addEventListener('message',event=>{
      if(event.origin!==location.origin||event.source!==q('#content').contentWindow||context.role!=='activity_editor'||event.data?.type!=='sakura-activity-section-changed'||!['manage','attendance'].includes(event.data.section))return;
      try{if(q('#content').contentWindow.location.pathname!=='/activity-checkin-admin')return;}catch{return;}
      activitySections.get(event.data.section)?.();
    });
    q('#tabs button')?.click();
  })().catch(error=>q('#notice').textContent=error?.message||'暫時無法確認權限，請稍後重新整理。');
  </script></body></html>`;}
export function welfareEditorHtml(){return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>福利優惠內容</title><style>${style}</style></head><body><header><h1>福利優惠內容</h1><a class="action" href="/editor-workspace">返回工作區</a><button id="reload">重新載入</button></header><main><p id="notice" role="status">正在載入…</p><div class="layout"><aside><button id="new">新增優惠草稿</button><div id="list"></div></aside><form id="form"><div class="fields"><label>特約廠商<select name="vendor_id" required></select></label><label>優惠名稱<input name="title" required maxlength="150"></label><label>分類<input name="category" maxlength="100"></label><label>狀態<select name="status"><option value="draft">草稿</option><option value="pending_review">送審</option></select></label><label class="full">優惠說明<textarea name="description" maxlength="6000"></textarea></label><label>原價<input name="original_price" type="number" min="0" step="0.01"></label><label>員工價<input name="employee_price" type="number" min="0" step="0.01"></label><label>訪客價<input name="visitor_price" type="number" min="0" step="0.01"></label><label>開始時間<input name="starts_at" type="datetime-local"></label><label>結束時間<input name="ends_at" type="datetime-local"></label><label class="full">使用限制<textarea name="usage_limit" maxlength="6000"></textarea></label></div><footer><button id="save" class="primary">儲存草稿／送審</button><button id="copy" type="button">複製為新草稿</button></footer></form></div></main><script>
 const q=s=>document.querySelector(s),form=q('#form'),notice=q('#notice');let state={vendors:[],offers:[]},current=null,requestId=crypto.randomUUID(),dirty=false,busy=false;
 const editable=row=>!row||['draft','pending_review','rejected'].includes(row.status);
 async function api(body){const r=await fetch('/admin-api/editor-welfare',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'}),j=await r.json();if(!r.ok||!j.success)throw Error(j.message||'操作未完成');return j;}
 function edit(row){if(dirty&&!confirm('放棄尚未儲存的修改？'))return;current=row;form.reset();for(const el of form.elements){if(el.name)el.value=row?.[el.name]??(el.name==='status'?'draft':'');el.disabled=!!row&&!editable(row);}if(row&&!editable(row))form.elements.status.value='draft';q('#save').disabled=!editable(row);q('#copy').disabled=!row;q('#copy').hidden=!row;requestId=crypto.randomUUID();dirty=false;notice.textContent=editable(row)?'儲存草稿或送交管理員審核。':'已核准或封存的優惠僅供檢視；可複製成新草稿。';}
 async function load(){if(busy)return;if(dirty&&!confirm('重新載入會放棄未儲存修改，是否繼續？'))return;state=await api();const select=form.elements.vendor_id;select.replaceChildren(new Option('請選擇廠商',''));for(const v of state.vendors)select.add(new Option(v.name,v.id));q('#list').replaceChildren();for(const row of state.offers){const b=document.createElement('button');b.textContent=row.title+'（'+({draft:'草稿',pending_review:'待審',approved:'已核准',rejected:'已退回'}[row.status]||row.status)+'）';b.onclick=()=>edit(row);q('#list').append(b);}dirty=false;edit(state.offers.find(r=>r.id===current?.id)||null);}
 form.oninput=()=>{dirty=true;requestId=crypto.randomUUID();};q('#new').onclick=()=>edit(null);q('#copy').onclick=()=>{const copy={...current,id:'',status:'draft',updated_at:''};edit(copy);};q('#reload').onclick=()=>load().catch(e=>notice.textContent=e.message);
 form.onsubmit=async e=>{e.preventDefault();if(busy||!editable(current))return;const data=Object.fromEntries(new FormData(form));for(const name of ['original_price','employee_price','visitor_price'])data[name]=Number(data[name]||0);data.id=current?.id||'';busy=true;q('#save').disabled=true;try{await api({action:'save',request_id:requestId,revision:current?.updated_at||'',data});dirty=false;busy=false;await load();notice.textContent='已儲存，送審內容由管理員核准後發布。';}catch(e){notice.textContent=e.message;}finally{busy=false;q('#save').disabled=!editable(current);}};
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});load().catch(e=>notice.textContent=e.message);
 </script></body></html>`;}

export function decorateWhitelistEditorPresets(html){
  const presets=editorPresets();
  html=html.replace('<option value="viewer">只讀檢視</option>', '<option value="viewer">只讀檢視</option>'+presets.map(p=>`<option value="${p.role}">${p.label}</option>`).join(''));
  const cards='<section id="editor-role-presets" style="margin:18px 0;padding:14px 0;border-bottom:1px solid #dbe3ee"><h2>單位小編權限</h2><p>尚未選定人員也可先備妥範本；之後填入 LINE UID、選擇角色並儲存即可。</p>'+presets.map(p=>`<details open><summary><b>${p.label}</b> <span data-editor-count="${p.role}">0 人</span></summary><p>${p.description}</p></details>`).join('')+'</section>';
  html=html.replace('<script>',cards+'<script>');
  html=html.replace('renderModules("*");render()}', `renderModules("*");render();document.dispatchEvent(new CustomEvent('editor-whitelist-loaded',{detail:j}));}`);
  html=html.replace('function roleLabel(role){return {', 'function roleLabel(role){return {welfare_editor:"福利小編",activity_editor:"活動小編",club_editor:"社團小編",');
  const client=`<script>(()=>{const presets=${JSON.stringify(presets)};const role=document.getElementById('role');function apply(){const preset=presets.find(p=>p.role===role.value);const options=document.querySelectorAll('#moduleChecks input[type=checkbox]');for(const input of options){if(preset)input.checked=preset.modules.includes(input.value)||(input.value==='activity-stories'&&preset.pages.some(page=>page.url==='/activity-stories-admin'));input.disabled=!!preset;}let note=document.getElementById('editor-preset-note');if(!note){note=document.createElement('p');note.id='editor-preset-note';role.after(note);}note.textContent=preset?preset.description:'依原有角色與允許模組設定。';}role.addEventListener('change',apply);document.addEventListener('click',()=>setTimeout(apply,0));apply();document.addEventListener('editor-whitelist-loaded',event=>{const j=event.detail;apply();for(const preset of presets){const n=document.querySelector('[data-editor-count="'+preset.role+'"]');if(n)n.textContent=(j.rows||[]).filter(row=>row.role===preset.role&&Number(row.active)===1).length+' 人';}});})();</script>`;
  return html.replace('</body>',client+'</body>');
}

export function editorChatCard(role,origin,storyUri='',entryUri=''){
 const preset=role==='admin'?{label:'管理員',description:'開啟活動、社團與福利工作區。'}:editorPresets().find(p=>p.role===role);if(!preset)return null;
 let safeStoryUri='';try{const u=new URL(storyUri);if(u.protocol==='https:'&&u.hostname==='liff.line.me'&&!u.username&&!u.password)safeStoryUri=u.href;}catch{}
 let safeEntry='';try{const u=new URL(entryUri);if(u.protocol==='https:'&&u.hostname==='liff.line.me'&&!u.username&&!u.password)safeEntry=u.href;}catch{}
 const buttons=[{type:'button',style:'primary',action:{type:'uri',label:'開啟我的工作區',uri:safeEntry||new URL('/sakura-admin?line_login=1',origin).toString()}}];
 if(['activity_editor','club_editor'].includes(role)&&safeStoryUri)buttons.push({type:'button',style:'secondary',action:{type:'uri',label:'活動花絮',uri:safeStoryUri}});
 return {type:'flex',altText:preset.label+'工作區',contents:{type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:preset.label+'工作區',weight:'bold',size:'xl'},{type:'text',text:preset.description,wrap:true,size:'sm'}]},footer:{type:'box',layout:'vertical',contents:buttons}}};
}
