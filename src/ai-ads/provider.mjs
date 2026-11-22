import {LIMITS,base64,boundedBytes,raster,fail} from './policy.mjs';

// Existing platform credential stays in this request's backend memory. No fallback.
export async function generateImage({env,config,prompt,references,ratio,fetcher=fetch}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),LIMITS.timeoutMs);
 try{
  const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,{
   method:'POST',redirect:'manual',signal:controller.signal,
   headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
   body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt},...references.map(asset=>({inlineData:{mimeType:asset.mimeType,data:base64(asset.bytes)}}))]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:ratio||'1:1'}}}),
  });
  const bytes=await boundedBytes(response.body,LIMITS.responseBytes);let body;
  try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('AI_ADS_PROVIDER_RESULT_UNCERTAIN',502);}
  if(!response.ok){
   const definite=[400,401,403,404].includes(response.status)&&!body.candidates&&!body.usageMetadata&&['INVALID_ARGUMENT','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND'].includes(body.error?.status);
   throw Object.assign(new Error(definite?'AI_ADS_PROVIDER_REJECTED':'AI_ADS_PROVIDER_RESULT_UNCERTAIN'),{code:definite?'AI_ADS_PROVIDER_REJECTED':'AI_ADS_PROVIDER_RESULT_UNCERTAIN',status:502,definite});
  }
  // Ignore private thought parts/signatures; only one final raster is accepted.
  const images=(Array.isArray(body.candidates)?body.candidates:[]).flatMap(candidate=>Array.isArray(candidate.content?.parts)?candidate.content.parts:[]).filter(part=>part.thought!==true).map(part=>part.inlineData??part.inline_data).filter(Boolean);
  if(images.length!==1)fail('AI_ADS_PROVIDER_OUTPUT_INVALID',502);
  const image=images[0],mimeType=image.mimeType??image.mime_type,data=image.data;
  if(!['image/png','image/jpeg','image/webp'].includes(mimeType)||typeof data!=='string'||data.length>Math.ceil(LIMITS.outputBytes/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail('AI_ADS_PROVIDER_OUTPUT_INVALID',502);
  const output=Uint8Array.from(atob(data),char=>char.charCodeAt(0));let dimensions;
  try{dimensions=raster(output,mimeType,LIMITS.outputBytes);}catch{fail('AI_ADS_PROVIDER_OUTPUT_INVALID',502);}
  // Token metadata does not establish image pricing. Never fabricate actual cost.
  const usage=body.usageMetadata;const safeUsage={};for(const key of ['promptTokenCount','candidatesTokenCount','totalTokenCount'])if(Number.isSafeInteger(usage?.[key])&&usage[key]>=0)safeUsage[key]=usage[key];
  return {bytes:output,...dimensions,usage:safeUsage,providerRequestId:response.headers.get('x-request-id')?.slice(0,120)||null};
 }catch(error){if(error?.definite)throw error;throw Object.assign(new Error(error?.code==='AI_ADS_PROVIDER_OUTPUT_INVALID'?'AI_ADS_PROVIDER_OUTPUT_INVALID':'AI_ADS_PROVIDER_RESULT_UNCERTAIN'),{code:error?.code==='AI_ADS_PROVIDER_OUTPUT_INVALID'?'AI_ADS_PROVIDER_OUTPUT_INVALID':'AI_ADS_PROVIDER_RESULT_UNCERTAIN',status:502});}
 finally{clearTimeout(timer);}
}
