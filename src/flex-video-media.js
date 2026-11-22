// Dedicated, public LINE Flex media. Encrypted capabilities expire in 24 hours.
const MAX_VIDEO = 200000000, PART = 8 * 1024 * 1024, MAX_COVER = 1000000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const fail = (message, status=400) => Object.assign(new Error(message), {status});
const videoKey = id => `flex_video_${id}.mp4`;
const coverKey = id => `flex_video_cover_${id}`;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = text => Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function sessionCrypto(secret){if(!secret)throw fail('媒體上傳暫時無法使用。',503);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('flex-video-upload/v1:'+secret));return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt'])}
async function sealSession(session,secret){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await sessionCrypto(secret),new TextEncoder().encode(JSON.stringify(session)));return encode(iv)+'.'+encode(new Uint8Array(encrypted))}

async function readBytes(request, max, exact) {
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced)>max || (exact != null && Number(announced)!==exact))) throw fail('檔案大小不正確。',413);
  const reader=request.body?.getReader(); if(!reader)throw fail('缺少檔案。');
  const chunks=[]; let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){void reader.cancel();throw fail('檔案大小不正確。',413)}chunks.push(value)}
  if(!size || (exact != null && size!==exact))throw fail('檔案不完整，請重新上傳。');
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength}return all;
}
async function readSession(token,actor,secret){
  let session;try{const parts=String(token||'').split('.');if(parts.length!==2||parts[0].length!==16||parts[1].length>2000)throw Error();const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(parts[0])},await sessionCrypto(secret),decode(parts[1]));session=JSON.parse(new TextDecoder().decode(decrypted))}catch(e){if(e.status)throw e;throw fail('上傳連線無效。',403)}
  if(session.actor!==actor)throw fail('無權操作此上傳。',403);
  if(Date.now()>session.expires)throw fail('上傳連線已逾時，請重新上傳。',410);
  if(!uuid.test(session.id||'') || session.key!==videoKey(session.id) || typeof session.uploadId!=='string' || !session.uploadId || !Number.isSafeInteger(session.size) || session.size<1 || session.size>MAX_VIDEO || session.partSize!==PART)throw fail('上傳連線無效。');
  return session;
}
const toUrl=(request,path)=>new URL(path,request.url).href;
export async function handleFlexVideoUpload(request,bucket,actor,secret){
 try {
  if(!actor)throw fail('請先登入管理後台。',403);
  if(!bucket)throw fail('媒體儲存暫時無法使用。',503);
  const url=new URL(request.url), path=url.pathname;
  if(path.endsWith('/init') && request.method==='POST'){
   const content=JSON.parse(new TextDecoder().decode(await readBytes(request,2048)));
   const size=content.size;if(!Number.isSafeInteger(size)||size<1||size>MAX_VIDEO)throw fail('影片須為 200 MB 以下的 MP4。',413);
   await sessionCrypto(secret);
   const id=crypto.randomUUID(), key=videoKey(id);
   const upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:'video/mp4'}});
   const session={id,key,uploadId:upload.uploadId,actor,size,partSize:PART,expires:Date.now()+24*60*60*1000};
   let token;try{token=await sealSession(session,secret)}catch(e){await upload.abort().catch(()=>{});throw e}
   return json({success:true,data:{sessionId:token,partSize:PART}});
  }
  if(path.endsWith('/part') && request.method==='PUT'){
   const s=await readSession(url.searchParams.get('session'),actor,secret), n=Number(url.searchParams.get('part'));
   const count=Math.ceil(s.size/PART);if(!Number.isInteger(n)||n<1||n>count)throw fail('影片分段編號無效。');
   const expected=Math.min(PART,s.size-(n-1)*PART), bytes=await readBytes(request,expected,expected);
   if(n===1 && (bytes.length<12 || String.fromCharCode(...bytes.slice(4,8))!=='ftyp'))throw fail('請選擇有效的 MP4 影片。');
   const upload=bucket.resumeMultipartUpload(s.key,s.uploadId), part=await upload.uploadPart(n,bytes);
   return json({success:true,data:{partNumber:n,etag:part.etag}});
  }
  if(path.endsWith('/complete') && request.method==='POST'){
   const data=JSON.parse(new TextDecoder().decode(await readBytes(request,16000))),s=await readSession(data.sessionId,actor,secret),count=Math.ceil(s.size/PART);
   if(!Array.isArray(data.parts)||data.parts.length!==count)throw fail('影片分段不完整。');
   // Only this handler can upload parts to the encrypted uploadId. Each part
   // was size-checked when written; R2 verifies every etag at completion.
   const parts=[];for(let n=1;n<=count;n++){const supplied=data.parts[n-1];if(supplied?.partNumber!==n||typeof supplied.etag!=='string'||!supplied.etag||supplied.etag.length>200)throw fail('影片分段不一致，請重新上傳。');parts.push({partNumber:n,etag:supplied.etag})}
   await bucket.resumeMultipartUpload(s.key,s.uploadId).complete(parts);
   return json({success:true,data:{url:toUrl(request,`/flex-video/${s.id}.mp4`)}});
  }
  if(path.endsWith('/abort') && request.method==='POST'){
   const data=JSON.parse(new TextDecoder().decode(await readBytes(request,4096))),s=await readSession(data.sessionId,actor,secret);
   await bucket.resumeMultipartUpload(s.key,s.uploadId).abort();
   return json({success:true});
  }
  if(path.endsWith('/cover') && request.method==='POST'){
   const bytes=await readBytes(request,MAX_COVER), t=(request.headers.get('content-type')||'').split(';')[0];
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255, png=[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x);
   if(!((t==='image/jpeg'&&jpeg)||(t==='image/png'&&png)))throw fail('封面請使用 1 MB 以下的 JPG 或 PNG 圖片。');
   const id=crypto.randomUUID();await bucket.put(coverKey(id),bytes,{httpMetadata:{contentType:t}});
   return json({success:true,data:{url:toUrl(request,`/flex-video-cover/${id}`)}});
  }
  throw fail('不支援此操作。',405);
 } catch(e){return json({success:false,message:e.status?e.message:'上傳失敗，請稍後再試。'},e.status||503)}
}

export async function serveFlexVideo(request,bucket){
 const url=new URL(request.url),video=url.pathname.match(/^\/flex-video\/([0-9a-f-]+)\.mp4$/i),cover=url.pathname.match(/^\/flex-video-cover\/([0-9a-f-]+)$/i),id=(video||cover)?.[1];
 if(!id||!uuid.test(id)||!bucket||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
 const key=video?videoKey(id):coverKey(id), meta=await bucket.head(key);if(!meta)return new Response('Not found',{status:404});
 const headers=new Headers();meta.writeHttpMetadata(headers);headers.set('etag',meta.httpEtag);headers.set('Accept-Ranges','bytes');headers.set('X-Content-Type-Options','nosniff');headers.set('Access-Control-Allow-Origin','*');headers.set('Content-Disposition','inline');
 let start=0,end=meta.size-1,status=200;const raw=request.headers.get('range');
 if(raw){const m=raw.match(/^bytes=(\d*)-(\d*)$/);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta.size}`,'Accept-Ranges':'bytes'}});
  if(m[1]){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end}else{const suffix=Number(m[2]);start=Math.max(meta.size-suffix,0);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=meta.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${meta.size}`,'Accept-Ranges':'bytes'}});
  status=206;headers.set('Content-Range',`bytes ${start}-${end}/${meta.size}`);
 }
 const length=end-start+1;headers.set('Content-Length',String(length));
 if(request.method==='HEAD')return new Response(null,{status,headers});
 const obj=await bucket.get(key,status===206?{range:{offset:start,length}}:undefined);if(!obj)return new Response('Not found',{status:404});
 return new Response(obj.body,{status,headers});
}
