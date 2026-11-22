export const LIMITS = Object.freeze({uploadBytes:8*1024*1024,referenceCount:3,outputCount:1,timeoutMs:90000,responseBytes:20*1024*1024,outputBytes:8*1024*1024});
export const MODELS = Object.freeze(['gemini-nano-banana-2.1','gemini-3.1-flash-image','gemini-3-pro-image','gemini-2.5-flash-image']);
export const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
export function closed(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('FIELD_NOT_ALLOWED',422);return value;}
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const assetId=value=>typeof value==='string'&&/^aia_[a-f0-9]{32}$/.test(value);
export function referenceIds(value=[]){if(!Array.isArray(value)||value.length>LIMITS.referenceCount||value.some(id=>!assetId(id))||new Set(value).size!==value.length)fail('AI_ADS_REFERENCES_INVALID',422);return value;}
export async function boundedBytes(body,max){
 if(!body)return new Uint8Array();const reader=body.getReader(),parts=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();fail('AI_ADS_BODY_TOO_LARGE',413);}parts.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
}
export async function jsonBody(request){const type=(request.headers.get('Content-Type')||'').split(';')[0];if(type!=='application/json')fail('AI_ADS_JSON_REQUIRED',415);try{return JSON.parse(new TextDecoder().decode(await boundedBytes(request.body,64000)));}catch(error){if(error.code)throw error;fail('AI_ADS_JSON_INVALID',422);}}
export function configuration(env){
 const positive=value=>/^\d+$/.test(String(value??''))&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
 const model=MODELS.includes(env.AI_ADS_IMAGE_MODEL)?env.AI_ADS_IMAGE_MODEL:null;
 const reservationMicros=positive(env.AI_ADS_IMAGE_RESERVATION_MICROS),dailyBudgetMicros=positive(env.AI_ADS_DAILY_BUDGET_MICROS),reasons=[];
 if(env.AI_ADS_ENABLED!=='1')reasons.push('AI_ADS_DISABLED');
 if(!model)reasons.push('AI_ADS_IMAGE_MODEL_NOT_CONFIGURED');
 if(typeof env.GEMINI_API_KEY!=='string'||!env.GEMINI_API_KEY.trim())reasons.push('AI_ADS_PROVIDER_NOT_CONFIGURED');
 if(!env.AI_ADS_ASSETS)reasons.push('AI_ADS_STORAGE_NOT_CONFIGURED');
 if(env.ENVIRONMENT==='ai-ads-integration-test'&&!env.AI_ADS_TEST_PROVIDER)reasons.push('AI_ADS_TEST_PROVIDER_NOT_CONFIGURED');
 if(!reservationMicros||!dailyBudgetMicros||reservationMicros>dailyBudgetMicros)reasons.push('AI_ADS_BUDGET_NOT_CONFIGURED');
 return {ready:reasons.length===0,model,reservationMicros,dailyBudgetMicros,reasons};
}
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export function raster(bytes,declared,max=LIMITS.uploadBytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<24||bytes.length>max)fail('AI_ADS_IMAGE_INVALID',422);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let mimeType='',width=0,height=0;
 if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
  if(String.fromCharCode(...bytes.slice(12,16))!=='IHDR'||view.getUint32(8)!==13)fail('AI_ADS_IMAGE_INVALID',422);
  mimeType='image/png';width=view.getUint32(16);height=view.getUint32(20);let offset=8,data=false,end=false;
  while(offset+12<=bytes.length){const size=view.getUint32(offset),kind=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(size>bytes.length-offset-12)fail('AI_ADS_IMAGE_INVALID',422);if(kind==='acTL')fail('AI_ADS_ANIMATED_IMAGE_UNSUPPORTED',422);if(kind==='IDAT')data=true;if(kind==='IEND'){end=size===0&&offset+12===bytes.length;break;}offset+=size+12;}if(!data||!end)fail('AI_ADS_IMAGE_INVALID',422);
 }else if(bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
  mimeType='image/jpeg';let offset=2,scan=false;
  while(offset+4<bytes.length){if(bytes[offset++]!==255)fail('AI_ADS_IMAGE_INVALID',422);while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217)break;const size=view.getUint16(offset);if(size<2||offset+size>bytes.length)fail('AI_ADS_IMAGE_INVALID',422);if([192,193,194].includes(marker)){if(size<8)fail('AI_ADS_IMAGE_INVALID',422);height=view.getUint16(offset+3);width=view.getUint16(offset+5);}if(marker===218){scan=true;break;}offset+=size;}if(!scan)fail('AI_ADS_IMAGE_INVALID',422);
 }else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'&&view.getUint32(4,true)+8===bytes.length){
  mimeType='image/webp';const kind=String.fromCharCode(...bytes.slice(12,16)),size=view.getUint32(16,true);if(size>bytes.length-20)fail('AI_ADS_IMAGE_INVALID',422);
  if(kind==='VP8X'&&size>=10){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);if(bytes[20]&2)fail('AI_ADS_ANIMATED_IMAGE_UNSUPPORTED',422);}
  else if(kind==='VP8 '&&size>=10&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}
  else if(kind==='VP8L'&&size>=5&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  let offset=12,hasPixels=false;while(offset+8<=bytes.length){const chunk=String.fromCharCode(...bytes.slice(offset,offset+4)),length=view.getUint32(offset+4,true);if(length>bytes.length-offset-8)fail('AI_ADS_IMAGE_INVALID',422);if(chunk==='ANIM'||chunk==='ANMF')fail('AI_ADS_ANIMATED_IMAGE_UNSUPPORTED',422);if(chunk==='VP8 '||chunk==='VP8L')hasPixels=true;offset+=8+length+(length%2);}if(!hasPixels||offset!==bytes.length)fail('AI_ADS_IMAGE_INVALID',422);
 }else fail('AI_ADS_IMAGE_INVALID',422);
 if(!width||!height||width>12000||height>12000||width*height>40000000||declared&&declared!==mimeType)fail('AI_ADS_IMAGE_INVALID',422);
 return {mimeType,width,height};
}
export function base64(bytes){let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));return btoa(binary);}
