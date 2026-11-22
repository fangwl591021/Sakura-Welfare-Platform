import {buildPrompt,buildRevision} from '../../packages/ai-ads/prompt.mjs';
import {LIMITS,configuration,closed,jsonBody,boundedBytes,raster,referenceIds,uuid,digest,fail} from './policy.mjs';
import {generateImage} from './provider.mjs';
import {ownedAsset,readAsset,referencesOf,saveReference,jobRow,jobPublic,reserveJob,completeJob,failJob} from './store.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization, Cookie'}});
const editText=(value,code)=>{if(value===undefined)return '';if(typeof value!=='string'||!value.trim()||value.length>16000)fail(code,422);return value.trim();};
const testMode=env=>env.ENVIRONMENT==='ai-ads-integration-test'&&Boolean(env.AI_ADS_TEST_PROVIDER);
function capabilities(env){const c=configuration(env);return {success:true,enabled:env.AI_ADS_ENABLED==='1',configured:c.ready,reasonCodes:c.reasons,limits:{uploadBytes:LIMITS.uploadBytes,outputBytes:LIMITS.outputBytes,referenceCount:LIMITS.referenceCount,referenceTotalBytes:LIMITS.uploadBytes,modelInputBytes:LIMITS.uploadBytes,previousImageIncludedInInputLimit:true,outputCount:1,timeoutMs:LIMITS.timeoutMs},provider:{name:'google',model:c.model},policy:{reservationMicros:c.reservationMicros,dailyBudgetMicros:c.dailyBudgetMicros,currency:'USD',reservationIsHardProviderCap:false,actualCostPolicy:'UNKNOWN_UNTIL_RECONCILED'},testMode:testMode(env)};}
function catalogPage(url,catalog){
 const items=Array.isArray(catalog)?catalog:catalog?.items??[],search=(url.searchParams.get('search')||'').trim().toLocaleLowerCase(),kind=url.searchParams.get('kind')||'',rawPage=url.searchParams.get('page')||'1';
 if(search.length>160||kind.length>50||!/^\d{1,6}$/.test(rawPage)||Number(rawPage)<1)fail('AI_ADS_QUERY_INVALID',422);
 const page=Number(rawPage),pageSize=24,filtered=items.filter(item=>(!kind||item.kind===kind)&&(!search||[item.name,item.group,item.command,item.description,item.direction].some(value=>String(value??'').toLocaleLowerCase().includes(search))));
 return {success:true,items:filtered.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:filtered.length,totalPages:Math.ceil(filtered.length/pageSize),kinds:[...new Set(items.map(item=>item.kind))]};
}
async function upload(request,env,scope){
 if(env.AI_ADS_ENABLED!=='1')fail('AI_ADS_DISABLED',503);if(!env.AI_ADS_ASSETS)fail('AI_ADS_STORAGE_NOT_CONFIGURED',503);
 const contentType=request.headers.get('Content-Type')||'';if(!/^multipart\/form-data;\s*boundary=/i.test(contentType))fail('AI_ADS_MULTIPART_REQUIRED',415);
 const bytes=await boundedBytes(request.body,LIMITS.uploadBytes+65536);let form;
 try{form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();}catch{fail('AI_ADS_UPLOAD_INVALID',422);}
 if([...form.keys()].some(key=>key!=='file')||form.getAll('file').length!==1)fail('FIELD_NOT_ALLOWED',422);
 const file=form.get('file');if(!file||typeof file==='string'||file.size>LIMITS.uploadBytes||!['image/png','image/jpeg','image/webp'].includes(file.type))fail('AI_ADS_IMAGE_INVALID',422);
 const image=new Uint8Array(await file.arrayBuffer()),dimensions=raster(image,file.type);
 return json({success:true,asset:await saveReference(env,scope,image,dimensions)},201);
}
async function prepare(body,env,scope,catalog,parentId){
 const revision=Boolean(parentId);closed(body,revision?['requestId','type','note','referenceAssetIds','editedInstruction']:['requestId','input','referenceAssetIds','editedPrompt']);
 if(!uuid(body.requestId))fail('AI_ADS_REQUEST_ID_REQUIRED',422);
 body={...body,requestId:body.requestId.toLowerCase()};
 const ids=referenceIds(body.referenceAssetIds),references=await referencesOf(env,scope,ids),verified=references.map(asset=>({id:asset.id,mimeType:asset.mimeType}));
 let prompt,ratio='1:1';
 if(revision){
  const parent=await jobRow(env.smart_menu_db,scope,parentId);if(!parent)fail('AI_ADS_NOT_FOUND',404);if(parent.status!=='COMPLETE'||!parent.result_asset_id)fail('AI_ADS_PREVIOUS_IMAGE_REQUIRED',409);
  if(body.type==='accuracy'&&!references.some(asset=>asset.kind==='reference'))fail('REFERENCE_REQUIRED',422);
  const built=buildRevision({type:body.type,...body.note===undefined?{}:{note:body.note}},{verifiedReferenceAssets:verified});
  prompt=editText(body.editedInstruction,'AI_ADS_EDITED_INSTRUCTION_INVALID')||built.prompt;ratio=parent.ratio;
  references.unshift(await readAsset(env,await ownedAsset(env.smart_menu_db,scope,parent.result_asset_id)));
  prompt='Edit the first attached image. Additional attached images are authorized references only. Return one raster image.\n'+prompt;
 }else{
  const built=buildPrompt(body.input,{catalog,verifiedReferenceAssets:verified});prompt=editText(body.editedPrompt,'AI_ADS_EDITED_PROMPT_INVALID')||built.prompt;ratio=built.ratio;
 }
 if(references.reduce((sum,asset)=>sum+asset.bytes.length,0)>LIMITS.uploadBytes)fail('AI_ADS_REFERENCE_BYTES_EXCEEDED',422);
 if(!references.length)prompt='No reference image was supplied. Do not claim faithful preservation of a real identity, product label, or exact original photo.\n'+prompt;
 const inputHash=await digest({revision:parentId??null,body,prompt,ratio,references:references.map(asset=>({id:asset.id,sha256:asset.sha256}))});
 return {id:body.requestId,inputHash,parentId:parentId??null,prompt,ratio,references};
}
async function generation(request,env,scope,catalog,fetcher,parentId){
 const prepared=await prepare(await jsonBody(request),env,scope,catalog,parentId),config=configuration(env);
 // A completed request remains recoverable if generation is subsequently disabled.
 const prior=await jobRow(env.smart_menu_db,scope,prepared.id);
 if(prior){if(prior.input_hash!==prepared.inputHash)fail('AI_ADS_REQUEST_CONFLICT',409);return json({success:true,idempotent:true,generation:await jobPublic(env.smart_menu_db,scope,prepared.id)});}
 if(!config.ready)fail(config.reasons[0],503);
 const claim=await reserveJob(env,scope,prepared,config);
 if(!claim.created)return json({success:true,idempotent:true,generation:await jobPublic(env.smart_menu_db,scope,prepared.id)});
 try{
  const providerFetch=testMode(env)?(url,init)=>env.AI_ADS_TEST_PROVIDER.fetch(new Request(url,init)):fetcher;
  const result=await generateImage({env,config,prompt:prepared.prompt,references:prepared.references,ratio:prepared.ratio,fetcher:providerFetch});
  await completeJob(env,scope,prepared.id,claim.nonce,result);
 }catch(error){await failJob(env,scope,prepared.id,claim.nonce,error);}
 return json({success:true,generation:await jobPublic(env.smart_menu_db,scope,prepared.id),testMode:testMode(env)},201);
}

/** scope is supplied only by the authenticated host; never pass request JSON here. */
export async function handleAiAdsRequest(request,env,scope,{catalog,fetcher=fetch}={}){
 try{
  if(!scope?.workspaceId||scope.workspaceId==='default'||!scope.actorId)fail('AI_ADS_FORBIDDEN',403);
  const url=new URL(request.url),path=url.pathname.replace(/^\/admin-api\/ai-ads/,'')||'/',method=request.method;
  if(path==='/capabilities'&&method==='GET')return json(capabilities(env));
  if(path==='/catalog'&&method==='GET')return json(catalogPage(url,catalog));
  if(path==='/prompt'&&method==='POST'){
   const body=closed(await jsonBody(request),['input','referenceAssetIds']),references=await referencesOf(env,scope,referenceIds(body.referenceAssetIds));
   return json({success:true,...buildPrompt(body.input,{catalog,verifiedReferenceAssets:references.map(asset=>({id:asset.id,mimeType:asset.mimeType}))})});
  }
  if(path==='/assets'&&method==='POST')return await upload(request,env,scope);
  if(path==='/generations'&&method==='GET'){
   const raw=url.searchParams.get('limit')||'12';if(!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>20)fail('AI_ADS_QUERY_INVALID',422);
   const before=url.searchParams.get('before')||'',beforeId=url.searchParams.get('beforeId')||'';
   if((before||beforeId)&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before)||!uuid(beforeId)||!Number.isFinite(Date.parse(before))||new Date(before).toISOString()!==before))fail('AI_ADS_QUERY_INVALID',422);
   const rows=await env.smart_menu_db.prepare("SELECT id,created_at FROM ai_ads_jobs WHERE workspace_id=? AND actor_id=? AND (?='' OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?").bind(scope.workspaceId,scope.actorId,before,before,before,beforeId,Number(raw)+1).all();
   const items=rows.results||[],more=items.length>Number(raw),page=items.slice(0,Number(raw)),last=page.at(-1);
   return json({success:true,generations:await Promise.all(page.map(row=>jobPublic(env.smart_menu_db,scope,row.id))),nextCursor:more&&last?{before:last.created_at,beforeId:last.id}:null});
  }
  const asset=path.match(/^\/assets\/(aia_[a-f0-9]{32})\/content$/);
  if(asset&&method==='GET'){
   const row=await ownedAsset(env.smart_menu_db,scope,asset[1]);if(!env.AI_ADS_ASSETS)fail('AI_ADS_STORAGE_NOT_CONFIGURED',503);
   const stored=await env.AI_ADS_ASSETS.get(row.object_key);if(!stored||stored.size!==row.bytes)fail('AI_ADS_ASSET_UNAVAILABLE',409);
   return new Response(stored.body,{headers:{'Content-Type':row.mime_type,'Content-Length':String(row.bytes),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Vary':'Authorization, Cookie'}});
  }
  if(path==='/generations'&&method==='POST')return await generation(request,env,scope,catalog,fetcher);
  const job=path.match(/^\/generations\/([a-f0-9-]{36})(?:\/(revisions))?$/i);
  if(job&&uuid(job[1])){
   if(method==='GET'&&!job[2])return json({success:true,generation:await jobPublic(env.smart_menu_db,scope,job[1].toLowerCase())});
   if(method==='POST'&&job[2])return await generation(request,env,scope,catalog,fetcher,job[1].toLowerCase());
  }
  if(path==='/revisions'&&method==='POST')fail('AI_ADS_PARENT_ROUTE_REQUIRED',422);
  fail('AI_ADS_NOT_FOUND',404);
 }catch(error){const safe=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599;return json({success:false,error:safe?(error.code||'AI_ADS_REQUEST_REJECTED'):'AI_ADS_UNAVAILABLE'},safe?error.status:503);}
}
export function registerAiAdsRoutes(app,{authorize,catalog}){
 const handle=async c=>{try{const scope=await authorize(c);return await handleAiAdsRequest(c.req.raw,c.env,scope,{catalog});}catch(error){const denied=['FORBIDDEN_ROLE','MODULE_NOT_ENABLED','MODULE_DEPENDENCY_NOT_ENABLED','AUTH_REQUIRED','MEMBERSHIP_REQUIRED'].includes(error?.message),moduleDenied=['MODULE_NOT_ENABLED','MODULE_DEPENDENCY_NOT_ENABLED'].includes(error?.message);return json({success:false,error:moduleDenied?'MODULE_NOT_ENABLED':denied?'AI_ADS_FORBIDDEN':'AI_ADS_UNAVAILABLE'},denied?403:503);}};
 app.all('/admin-api/ai-ads',handle);app.all('/admin-api/ai-ads/*',handle);
}
