// A separate, deliberately public asset namespace for LINE image messages.
// This handler never selects recipients, creates previews, or sends messages.
const MAX_FILE_BYTES = 1000000; // strictly less than LINE's 1 MB preview limit
const MAX_BODY_BYTES = MAX_FILE_BYTES + 65536;
const MAX_EDGE = 1024;
const PATH = /^\/push-image\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png)$/;
const reply = (data, status = 200) => Response.json(data, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail = (message,status=400) => reply({success:false,message},status);
const u32 = (b,i) => ((b[i]*0x1000000)+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3])>>>0;
const eq = (b,i,s) => [...s].every((x,j)=>b[i+j]===x);
function crc32(b,start,end) { let crc=0xffffffff; for(let i=start;i<end;i++){crc^=b[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function validSize(width,height){return Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=MAX_EDGE&&height<=MAX_EDGE;}
function pngSize(bytes){
 if(bytes.length<57||!eq(bytes,0,[137,80,78,71,13,10,26,10]))return null;
 let offset=8,width=0,height=0,idat=false,ihdr=false,ended=false,count=0;
 while(offset+12<=bytes.length&&count++<4096){
  const size=u32(bytes,offset),start=offset+4,end=start+4+size;
  if(end+4>bytes.length||crc32(bytes,start,end)!==u32(bytes,end))return null;
  const type=String.fromCharCode(...bytes.slice(start,start+4));
  if(!ihdr){if(type!=='IHDR'||size!==13)return null;width=u32(bytes,start+4);height=u32(bytes,start+8);ihdr=true;if(!validSize(width,height))return null;}
  else if(type==='IHDR')return null;
  if(type==='IDAT')idat=true;
  if(type==='IEND'){if(size!==0||!idat||end+4!==bytes.length)return null;ended=true;break;}
  offset=end+4;
 }
 return ended?{width,height,contentType:'image/png',extension:'png'}:null;
}
function jpegSize(bytes){
 if(bytes.length<14||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return null;
 let offset=2,width=0,height=0,scan=false,count=0;
 while(offset<bytes.length-2&&count++<4096){
  if(bytes[offset++]!==255)return null;
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];
  if(marker===0||marker===216||marker===217||offset+2>bytes.length)return null;
  if(marker>=0xd0&&marker<=0xd7)continue;
  const size=(bytes[offset]<<8)|bytes[offset+1];if(size<2||offset+size>bytes.length-2)return null;
  if([0xc0,0xc1,0xc2].includes(marker)){
   if(size<8||width||height)return null; height=(bytes[offset+3]<<8)|bytes[offset+4];width=(bytes[offset+5]<<8)|bytes[offset+6];if(!validSize(width,height))return null;
  }
  if(marker===0xda){if(!width||!height||size<6)return null;scan=true;break;}
  offset+=size;
 }
 return scan?{width,height,contentType:'image/jpeg',extension:'jpg'}:null;
}
export function inspectSegmentPushImage(bytes,declaredType){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>=MAX_FILE_BYTES)return null;
 if(declaredType==='image/jpeg')return jpegSize(bytes);
 if(declaredType==='image/png')return pngSize(bytes);
 return null;
}
async function boundedForm(request){
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY_BYTES))throw Object.assign(new Error('圖片過大。'),{status:413});
 const type=request.headers.get('content-type')||'';if(!/^multipart\/form-data\s*;/i.test(type)||!request.body)throw Object.assign(new Error('上傳資料格式不正確。'),{status:400});
 const reader=request.body.getReader(),chunks=[];let total=0;
 for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BODY_BYTES){await reader.cancel().catch(()=>{});throw Object.assign(new Error('圖片過大。'),{status:413});}chunks.push(value);}
 const bytes=new Uint8Array(total);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
 return new Response(bytes,{headers:{'Content-Type':type}}).formData();
}
export async function handleSegmentPushImageUpload(request,env,{authorize,authorizeAiAsset}={}){
 if(request.method!=='POST')return fail('不支援此操作。',405);
 const url=new URL(request.url);if(url.protocol!=='https:')return fail('請使用安全的 HTTPS 後台。',400);
 if((request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return fail('請由管理後台操作。',403);
 if(typeof authorize!=='function')return fail('沒有上傳權限。',403);
 try{if(await authorize()!==true)return fail('沒有上傳權限。',403);}catch{return fail('暫時無法確認上傳權限。',503);}
 if(!env?.R2_BUCKET?.put)return fail('圖片儲存暫時無法使用。',503);
 let form;try{form=await boundedForm(request);}catch(error){return fail(error?.message==='圖片過大。'?'圖片需小於 1 MB。':'上傳資料格式不正確。',error?.status===413?413:400);}
 const files=form.getAll('file');if(files.length!==1||!(files[0] instanceof File)||!files[0].size)return fail('請選擇一張 JPG 或 PNG 圖片。');
 if(files[0].size>=MAX_FILE_BYTES)return fail('圖片需小於 1 MB。',413);
 const bytes=new Uint8Array(await files[0].arrayBuffer()),meta=inspectSegmentPushImage(bytes,files[0].type);
 if(!meta)return fail('圖片格式不正確，或尺寸超過 1024 × 1024，請重新選擇。');
 const sourceValues=form.getAll('aiAssetId');
 if(sourceValues.length>1 || (sourceValues.length && (typeof sourceValues[0]!=='string'||!/^aia_[a-f0-9]{32}$/.test(sourceValues[0]))))return fail('AI 作品資料不正確。');
 let sourceActor='';
 if(sourceValues.length){
  if(typeof authorizeAiAsset!=='function')return fail('沒有使用此作品的權限。',403);
  try{sourceActor=await authorizeAiAsset(sourceValues[0]);}catch{return fail('暫時無法確認作品權限。',503);}
  if(!sourceActor)return fail('沒有使用此作品的權限。',403);
 }
 try{if(await authorize()!==true)return fail('沒有上傳權限。',403);}catch{return fail('暫時無法確認上傳權限。',503);}
 let name=crypto.randomUUID()+'.'+meta.extension;
 if(sourceValues.length){
  try{if(await authorizeAiAsset(sourceValues[0])!==sourceActor)return fail('沒有使用此作品的權限。',403);}catch{return fail('暫時無法確認作品權限。',503);}
  const secret=String(env.LINE_CHANNEL_SECRET||env.DASHBOARD_TOKEN||'');if(!secret)return fail('作品轉換暫時不可用。',503);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),encoded=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const hash=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('ai-ads-push-v1\0'+sourceActor+'\0'+sourceValues[0]+'\0'+encoded)));
  hash[6]=(hash[6]&15)|64;hash[8]=(hash[8]&63)|128;const hex=[...hash.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('');
  name=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20)+'.'+meta.extension;
 }
 const key='push_public_image_'+name;
 try{
  const existing=sourceValues.length?await env.R2_BUCKET.get(key):null;
  if(existing){const previous=new Uint8Array(await existing.arrayBuffer());const a=new Uint8Array(await crypto.subtle.digest('SHA-256',previous)),b=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));if(a.some((x,i)=>x!==b[i]))return fail('圖片版本不一致，請重新選取。',409);}
  else await env.R2_BUCKET.put(key,bytes,{httpMetadata:{contentType:meta.contentType}});
 }catch{return fail('圖片上傳失敗，請稍後重試。',503);}
 const imageUrl=url.origin+'/push-image/'+name;
 return reply({success:true,originalContentUrl:imageUrl,previewImageUrl:imageUrl,width:meta.width,height:meta.height});
}
export async function serveSegmentPushImage(request,env){
 if(request.method!=='GET'&&request.method!=='HEAD')return fail('不支援此操作。',405);
 const match=new URL(request.url).pathname.match(PATH);if(!match)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 if(!env?.R2_BUCKET?.get)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 const object=await env.R2_BUCKET.get('push_public_image_'+match[1]+'.'+match[2]);if(!object)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 const headers=new Headers({'Content-Type':match[2]==='jpg'?'image/jpeg':'image/png','Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});
 if(object.httpEtag)headers.set('ETag',object.httpEtag);
 return new Response(request.method==='HEAD'?null:object.body,{status:200,headers});
}
