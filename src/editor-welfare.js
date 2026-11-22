import {readBoundedAdminJson} from './editor-access.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fields=['vendor_id','title','category','description','original_price','employee_price','visitor_price','discount_type','discount_value','starts_at','ends_at','public_title','public_description','employee_discount_label','visitor_discount_label','usage_limit','redemption_method','qr_enabled','employee_only','publish_channels'];
const editable=new Set(['draft','pending_review','rejected']);
export async function handleEditorWelfare(request,db,principal,saveOffer) {
  if(!principal||!['admin','welfare_editor'].includes(principal.role))return json({success:false,message:'沒有福利內容管理權限。'},403);
  if(request.method==='GET'){
    const vendors=(await db.prepare("SELECT id,name FROM welfare_vendors WHERE status='approved' AND COALESCE(is_hidden,0)=0 ORDER BY name LIMIT 500").all()).results;
    const offers=(await db.prepare(`SELECT id,${fields.join(',')},status,updated_at FROM welfare_offers ORDER BY updated_at DESC LIMIT 300`).all()).results;
    return json({success:true,vendors,offers});
  }
  if(request.method!=='POST')return json({success:false,message:'不支援此操作。'},405);
  if(Number(request.headers.get('Content-Length'))>65000)return json({success:false,message:'內容過大。'},413);
  let body;try{body=await readBoundedAdminJson(request);}catch(error){return json({success:false,message:'資料格式不正確或內容過大。'},error.status||400);}
  if(!body||body.action!=='save'||!body.data||typeof body.data!=='object'||Array.isArray(body.data)||!/^[0-9a-f-]{36}$/i.test(body.request_id||''))return json({success:false,message:'請重新載入表單後儲存。'},400);
  if(!['draft','pending_review'].includes(body.data.status))return json({success:false,message:'小編只能儲存草稿或送審。'},403);
  if(Object.keys(body.data).some(k=>![...fields,'id','status'].includes(k)))return json({success:false,message:'包含不允許編輯的欄位。'},403);
  const data=Object.fromEntries(fields.filter(k=>Object.hasOwn(body.data,k)).map(k=>[k,body.data[k]]));
  if(fields.some(k=>typeof data[k]==='string'&&data[k].length>6000))return json({success:false,message:'內容長度超過限制。'},400);
  for(const k of ['original_price','employee_price','visitor_price','discount_value'])if(!Number.isFinite(Number(data[k]||0))||Number(data[k]||0)<0)return json({success:false,message:'金額必須為有效的非負數。'},400);
  const actor=principal.actor,auditId='editor-offer:'+body.request_id;
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({data:body.data,revision:body.revision||''}))))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const replay=async()=>{const row=await db.prepare('SELECT actor_id,target_id,raw_json FROM welfare_audit_events WHERE id=?').bind(auditId).first();if(!row)return null;let stored;try{stored=JSON.parse(row.raw_json);}catch{return false;}return row.actor_id===actor&&stored.fingerprint===fingerprint?row.target_id:false;};
  const previous=await replay();if(previous!==null)return previous?json({success:true,data:{id:previous},replayed:true}):json({success:false,message:'操作編號已使用，請重新載入。'},409);
  const id=String(body.data.id||''),current=id?await db.prepare('SELECT * FROM welfare_offers WHERE id=?').bind(id).first():null;
  if(current)for(const field of fields)if(!Object.hasOwn(data,field))data[field]=current[field];
  if(id&&!current)return json({success:false,message:'找不到優惠。'},404);
  if(current&&(!editable.has(current.status)||current.updated_at!==body.revision))return json({success:false,message:editable.has(current.status)?'資料已更新，請重新載入。':'已核准或封存的優惠僅供檢視，可複製成新草稿。'},409);
  if(current&&current.vendor_id!==data.vendor_id)return json({success:false,message:'既有優惠不可改掛其他廠商。'},403);
  const vendor=await db.prepare("SELECT id FROM welfare_vendors WHERE id=? AND status='approved' AND COALESCE(is_hidden,0)=0").bind(String(data.vendor_id||'')).first();
  if(!vendor)return json({success:false,message:'請選擇已核准的特約廠商。'},400);
  try{
    const result=await saveOffer(db,{...data,id:id||crypto.randomUUID(),status:body.data.status,review_note:current?.review_note||'',approved_by:'',approved_at:''},{editor:true,expectedUpdatedAt:current?.updated_at||'',actor,auditId,auditRaw:JSON.stringify({fingerprint,before_revision:current?.updated_at||''})});
    return json(result,result.success?200:result.status||400);
  }catch{const saved=await replay();return saved?json({success:true,data:{id:saved},replayed:true}):json({success:false,message:'儲存未完成，請保留內容後重試。'},503);}
}
