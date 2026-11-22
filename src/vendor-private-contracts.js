import {validatePublicDocument} from './vendor-public-documents.js';

export const PRIVATE_CONTRACT_PREFIX = 'vendor_private_contract_';
export const CONTRACT_MAX_BYTES = 10 * 1024 * 1024;
const HEADERS = {'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json = (value,status=200) => Response.json(value,{status,headers:HEADERS});
class ContractError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const fail = (message,status=400) => {throw new ContractError(message,status);};
const clean = (value,max) => typeof value==='string'?value.trim().slice(0,max):'';
const tokenFrom = request => (request.headers.get('Authorization')||'').match(/^Bearer\s+(\S+)$/i)?.[1]||'';
const vendorSql = "SELECT id,status,vendor_portal_username FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0 LIMIT 1";
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');

async function actorFor(request,env,deps,vendorId,admin) {
  const bearer=tokenFrom(request);
  if(admin){
    const user=await deps.authorizeAdmin?.(request,env.DB);
    if(user?.role!=='admin'||!user?.id)fail('沒有合約審核權限。',403);
    return {type:'admin',id:String(user.id)};
  }
  const cookie=deps.readVendorPortalCookie(request)||{};
  const token=bearer||cookie.portal_token||'';
  if(!token||token.length>4096)fail('請先使用廠商帳號與密碼登入。',403);
  const principal=await deps.verifyVendorPortalToken(env,token);
  if(!principal||String(principal.vendor_id)!==vendorId||!principal.username)fail('無權讀取或上傳此申請的合約。',403);
  return {type:'vendor',id:String(principal.username)};
}

function metadata(row,base,vendorId){
  return {id:row.id,original_filename:row.original_filename,mime_type:row.mime_type,file_size:row.file_size,
    revision:row.revision,created_at:row.created_at,download_url:base+'?'+new URLSearchParams({vendor_id:vendorId,id:row.id})};
}

async function listing(db,vendorId,base,editable){
  const rows=(await db.prepare('SELECT id,original_filename,mime_type,file_size,revision,created_at FROM welfare_vendor_private_contracts WHERE vendor_id=? ORDER BY revision DESC LIMIT 100').bind(vendorId).all()).results||[];
  return {items:rows.map(row=>metadata(row,base,vendorId)),revision:rows[0]?.revision||0,editable};
}

async function formData(request){
  if(!/^multipart\/form-data\b/i.test(request.headers.get('Content-Type')||''))fail('請使用檔案上傳。');
  const limit=CONTRACT_MAX_BYTES+131072;
  if(Number(request.headers.get('Content-Length'))>limit)fail('合約檔案不可超過 10 MB。',413);
  if(!request.body)fail('請選擇合約檔案。');
  let size=0;
  const stream=request.body.pipeThrough(new TransformStream({transform(chunk,controller){size+=chunk.byteLength;if(size>limit)throw new ContractError('合約檔案不可超過 10 MB。',413);controller.enqueue(chunk);}}));
  return new Response(stream,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();
}

export async function hasUpdatedVendorContract(db,vendorId,supplement){
  if(!Number.isSafeInteger(supplement?.revision)||supplement.revision<1||!supplement.last_event_id)return false;
  const row=await db.prepare('SELECT id FROM welfare_vendor_private_contracts WHERE vendor_id=? AND supplement_revision=? AND supplement_event_id=? LIMIT 1').bind(vendorId,supplement.revision,supplement.last_event_id).first();
  return Boolean(row?.id);
}

export async function handlePrivateVendorContracts(request,env,deps,admin=false){
  let provisional=null,requestId='',vendorId='';
  try{
    const url=new URL(request.url),base=admin?'/admin-api/vendor-contracts':'/api/vendor-application/contracts';
    if(!['GET','HEAD','POST'].includes(request.method))fail('不支援此操作。',405);
    if((request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')fail('請由已登入的申請頁或管理後台操作。',403);
    if(!env.DB||!env.R2_BUCKET)fail('合約附件服務尚未準備完成。',503);
    vendorId=clean(url.searchParams.get('vendor_id'),100);
    if(!vendorId)fail('請選擇原申請記錄。');
    const actor=await actorFor(request,env,deps,vendorId,admin);
    const vendor=await env.DB.prepare(vendorSql).bind(vendorId).first();
    if(!vendor)fail('找不到可用的申請記錄。',404);
    if(actor.type==='vendor'&&(actor.id!==vendor.vendor_portal_username||!['pending','rejected','approved'].includes(vendor.status)))fail('店家登入已失效或申請已停用。',403);
    const editable=actor.type==='admin'||['pending','rejected'].includes(vendor.status);
    const id=clean(url.searchParams.get('id'),100);
    if(request.method==='GET'||request.method==='HEAD'){
      if(!id){if(request.method==='HEAD')return new Response(null,{headers:HEADERS});return json({success:true,data:await listing(env.DB,vendorId,base,editable)});}
      const row=await env.DB.prepare('SELECT * FROM welfare_vendor_private_contracts WHERE id=? AND vendor_id=? LIMIT 1').bind(id,vendorId).first();
      if(!row||!String(row.storage_key).startsWith(PRIVATE_CONTRACT_PREFIX))fail('找不到此合約附件。',404);
      const object=await env.R2_BUCKET.get(row.storage_key);
      if(!object)fail('找不到此合約附件。',404);
      const filename=row.original_filename.replace(/[^A-Za-z0-9._-]/g,'_');
      const encoded=encodeURIComponent(row.original_filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
      return new Response(request.method==='HEAD'?null:object.body,{headers:{...HEADERS,'Content-Type':row.mime_type,'Content-Length':String(row.file_size),
        'Content-Disposition':'attachment; filename="'+filename+'"; filename*=UTF-8\'\''+encoded,'Content-Security-Policy':"sandbox; default-src 'none'"}});
    }
    if(!editable)fail('目前申請狀態不能補交合約，請聯絡福委會。',403);
    const form=await formData(request),file=form.get('file');
    requestId=clean(form.get('request_id'),80);
    const expected=Number(form.get('expected_revision'));
    if(!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)||form.get('expected_revision')===null||!Number.isSafeInteger(expected)||expected<0)fail('上傳資料不完整，請重新載入。');
    if(!file||typeof file.arrayBuffer!=='function'||file.size>CONTRACT_MAX_BYTES)fail('合約檔案不可超過 10 MB。',413);
    let mime;
    try{mime=await validatePublicDocument(file);}catch(error){fail(error.message,error.status===413?413:400);}
    const bytes=new Uint8Array(await file.arrayBuffer()),sha=await digest(bytes);
    const filename=String(file.name).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
    const supplement=await env.DB.prepare('SELECT revision,last_event_id FROM welfare_vendor_supplements WHERE vendor_id=?').bind(vendorId).first();
    const supplementRevision=supplement?.revision||0,supplementEvent=supplement?.last_event_id||'';
    const fingerprint=JSON.stringify({vendorId,actor,filename,mime,size:file.size,sha,expected,supplementRevision,supplementEvent});
    const replay=await env.DB.prepare('SELECT request_fingerprint FROM welfare_vendor_private_contracts WHERE request_id=?').bind(requestId).first();
    if(replay){if(replay.request_fingerprint!==fingerprint)fail('上傳代碼已使用，請重新選擇檔案。',409);return json({success:true,duplicate:true,data:await listing(env.DB,vendorId,base,editable)});}
    const current=await env.DB.prepare('SELECT id,revision FROM welfare_vendor_private_contracts WHERE vendor_id=? ORDER BY revision DESC LIMIT 1').bind(vendorId).first();
    if((current?.revision||0)!==expected)fail('合約附件已更新，請重新載入後再上傳。',409);
    const documentId=crypto.randomUUID(),key=PRIVATE_CONTRACT_PREFIX+crypto.randomUUID();
    provisional=key;
    await env.R2_BUCKET.put(key,bytes,{httpMetadata:{contentType:mime}});
    const scope=actor.type==='vendor'?" AND vendor_portal_username=? AND status IN ('pending','rejected')":'';
    const result=await env.DB.prepare(`INSERT INTO welfare_vendor_private_contracts(id,vendor_id,storage_key,original_filename,mime_type,file_size,sha256,revision,previous_document_id,supplement_revision,supplement_event_id,request_id,request_fingerprint,uploaded_by,actor_type)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM welfare_vendors WHERE id=? AND COALESCE(is_hidden,0)=0${scope})
      AND COALESCE((SELECT MAX(revision) FROM welfare_vendor_private_contracts WHERE vendor_id=?),0)=?
      AND COALESCE((SELECT revision FROM welfare_vendor_supplements WHERE vendor_id=?),0)=?
      AND COALESCE((SELECT last_event_id FROM welfare_vendor_supplements WHERE vendor_id=?),'')=?`).bind(documentId,vendorId,key,filename,mime,file.size,sha,expected+1,current?.id||'',supplementRevision,supplementEvent,requestId,fingerprint,actor.id,actor.type,vendorId,...(actor.type==='vendor'?[actor.id]:[]),vendorId,expected,vendorId,supplementRevision,vendorId,supplementEvent).run();
    if(!result.meta?.changes)fail('申請或合約附件已更新，請重新載入。',409);
    provisional=null;
    return json({success:true,message:'合約已私密保存，請完成申請表後重新送審。',data:await listing(env.DB,vendorId,base,editable)});
  }catch(error){
    if(provisional){
      // Never delete a possibly committed object after an ambiguous DB response.
      try{const committed=await env.DB.prepare('SELECT storage_key FROM welfare_vendor_private_contracts WHERE request_id=? AND vendor_id=?').bind(requestId,vendorId).first();if(!committed||committed.storage_key!==provisional)await env.R2_BUCKET.delete(provisional);}catch{}
    }
    return json({success:false,message:error instanceof ContractError?error.message:'合約附件暫時無法處理，請重新載入後再試。'},error instanceof ContractError?error.status:503);
  }
}
