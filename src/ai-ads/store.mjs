import {LIMITS,assetId,fail,raster} from './policy.mjs';
const hex=bytes=>[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const binaryHash=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
export const assetPublic=row=>({id:row.id,mimeType:row.mime_type,bytes:row.bytes,width:row.width,height:row.height,kind:row.kind,contentUrl:'/admin-api/ai-ads/assets/'+row.id+'/content'});
export async function ownedAsset(db,scope,id){if(!assetId(id))fail('AI_ADS_NOT_FOUND',404);const row=await db.prepare('SELECT * FROM ai_ads_assets WHERE workspace_id=? AND actor_id=? AND id=?').bind(scope.workspaceId,scope.actorId,id).first();if(!row)fail('AI_ADS_NOT_FOUND',404);return row;}
export async function referencesOf(env,scope,ids){
 const assets=[];let total=0;for(const id of ids){const row=await ownedAsset(env.smart_menu_db,scope,id);if(row.kind!=='reference')fail('AI_ADS_REFERENCE_INVALID',422);total+=row.bytes;if(total>LIMITS.uploadBytes)fail('AI_ADS_REFERENCE_BYTES_EXCEEDED',422);assets.push(await readAsset(env,row));}
 if(total>LIMITS.uploadBytes)fail('AI_ADS_REFERENCE_BYTES_EXCEEDED',422);return assets;
}
export async function readAsset(env,row){
 if(!env.AI_ADS_ASSETS)fail('AI_ADS_STORAGE_NOT_CONFIGURED',503);
 const object=await env.AI_ADS_ASSETS.get(row.object_key);if(!object||object.size!==row.bytes||object.size>LIMITS.outputBytes)fail('AI_ADS_ASSET_UNAVAILABLE',409);
 const bytes=new Uint8Array(await object.arrayBuffer());raster(bytes,row.mime_type,LIMITS.outputBytes);if(await binaryHash(bytes)!==row.sha256)fail('AI_ADS_ASSET_UNAVAILABLE',409);
 return {...row,mimeType:row.mime_type,bytes};
}
export async function saveReference(env,scope,bytes,dimensions){
 const id='aia_'+crypto.randomUUID().replaceAll('-',''),objectKey='ai_ads_private_'+crypto.randomUUID()+'_'+id,now=new Date().toISOString();
 const row={workspace_id:scope.workspaceId,actor_id:scope.actorId,id,job_id:null,kind:'reference',object_key:objectKey,mime_type:dimensions.mimeType,bytes:bytes.length,width:dimensions.width,height:dimensions.height,sha256:await binaryHash(bytes),created_at:now};
 await env.AI_ADS_ASSETS.put(objectKey,bytes,{httpMetadata:{contentType:dimensions.mimeType,cacheControl:'private, no-store'}});
 try{await env.smart_menu_db.prepare('INSERT INTO ai_ads_assets(workspace_id,actor_id,id,job_id,kind,object_key,mime_type,bytes,width,height,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(...Object.values(row)).run();}
 catch{await env.AI_ADS_ASSETS.delete(objectKey).catch(()=>{});fail('AI_ADS_STORAGE_FAILED',503);}return assetPublic(row);
}
export async function jobRow(db,scope,id){return db.prepare('SELECT * FROM ai_ads_jobs WHERE workspace_id=? AND actor_id=? AND id=?').bind(scope.workspaceId,scope.actorId,id).first();}
export async function jobPublic(db,scope,id){
 let row=await jobRow(db,scope,id);if(!row)fail('AI_ADS_NOT_FOUND',404);
 if(row.status==='DISPATCHED'&&row.deadline_at<new Date().toISOString()){
  await db.batch([
   db.prepare("UPDATE ai_ads_jobs SET status='UNCERTAIN',error_code='AI_ADS_RESULT_UNCERTAIN',updated_at=? WHERE workspace_id=? AND actor_id=? AND id=? AND status='DISPATCHED'").bind(new Date().toISOString(),scope.workspaceId,scope.actorId,id),
   db.prepare("UPDATE ai_ads_usage_reservations SET state='UNKNOWN',updated_at=? WHERE workspace_id=? AND actor_id=? AND job_id=? AND state='RESERVED'").bind(new Date().toISOString(),scope.workspaceId,scope.actorId,id),
  ]);row=await jobRow(db,scope,id);
 }
 const reservation=await db.prepare('SELECT reserved_micros,state,actual_micros FROM ai_ads_usage_reservations WHERE workspace_id=? AND actor_id=? AND job_id=?').bind(scope.workspaceId,scope.actorId,id).first();
 const result=row.result_asset_id?assetPublic(await ownedAsset(db,scope,row.result_asset_id)):null;
 return {id:row.id,status:row.status,asset:result,parentId:row.parent_id,errorCode:row.error_code,reservationMicros:reservation?.reserved_micros??null,costStatus:reservation?.state??'UNKNOWN',actualCostMicros:reservation?.actual_micros??null,currency:'USD',createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function reserveJob(env,scope,{id,inputHash,parentId,ratio},config){
 const db=env.smart_menu_db,previous=await jobRow(db,scope,id);
 if(previous){if(previous.input_hash!==inputHash)fail('AI_ADS_REQUEST_CONFLICT',409);return {created:false};}
 const nonce=crypto.randomUUID(),now=new Date().toISOString(),day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),deadline=new Date(Date.now()+95000).toISOString();
 let result;try{result=await db.batch([
  // Expire abandoned workspace leases without releasing money or re-dispatching.
  db.prepare("UPDATE ai_ads_jobs SET status='UNCERTAIN',error_code='AI_ADS_RESULT_UNCERTAIN',updated_at=? WHERE workspace_id=? AND status='DISPATCHED' AND deadline_at<?").bind(now,scope.workspaceId,now),
  db.prepare("UPDATE ai_ads_usage_reservations SET state='UNKNOWN',updated_at=? WHERE workspace_id=? AND state='RESERVED' AND EXISTS(SELECT 1 FROM ai_ads_jobs j WHERE j.workspace_id=ai_ads_usage_reservations.workspace_id AND j.actor_id=ai_ads_usage_reservations.actor_id AND j.id=ai_ads_usage_reservations.job_id AND j.status='UNCERTAIN' AND j.error_code='AI_ADS_RESULT_UNCERTAIN' AND j.deadline_at<?)").bind(now,scope.workspaceId,now),
  db.prepare("INSERT INTO ai_ads_jobs(workspace_id,actor_id,id,request_id,input_hash,dispatch_nonce,parent_id,status,model,ratio,created_at,updated_at,deadline_at) SELECT ?,?,?,?,?,?,?,'DISPATCHED',?,?,?,?,? WHERE COALESCE((SELECT SUM(reserved_micros) FROM ai_ads_usage_reservations WHERE workspace_id=? AND day=? AND state!='RELEASED'),0)+?<=? AND NOT EXISTS(SELECT 1 FROM ai_ads_jobs WHERE workspace_id=? AND status='DISPATCHED')").bind(scope.workspaceId,scope.actorId,id,id,inputHash,nonce,parentId,config.model,ratio,now,now,deadline,scope.workspaceId,day,config.reservationMicros,config.dailyBudgetMicros,scope.workspaceId),
  db.prepare("INSERT INTO ai_ads_usage_reservations(workspace_id,actor_id,job_id,day,reserved_micros,state,actual_micros,created_at,updated_at) SELECT workspace_id,actor_id,id,?,?,'RESERVED',NULL,?,? FROM ai_ads_jobs WHERE workspace_id=? AND actor_id=? AND id=? AND dispatch_nonce=?").bind(day,config.reservationMicros,now,now,scope.workspaceId,scope.actorId,id,nonce),
 ]);}catch{const repeated=await jobRow(db,scope,id);if(repeated){if(repeated.input_hash!==inputHash)fail('AI_ADS_REQUEST_CONFLICT',409);return {created:false};}fail('AI_ADS_BUDGET_OR_CONCURRENCY_LIMIT',429);}
 if(!result[2].meta.changes)fail('AI_ADS_BUDGET_OR_CONCURRENCY_LIMIT',429);
 return {created:true,nonce};
}
export async function completeJob(env,scope,id,nonce,result){
 const db=env.smart_menu_db,asset='aia_'+crypto.randomUUID().replaceAll('-',''),key='ai_ads_private_'+crypto.randomUUID()+'_'+asset,now=new Date().toISOString(),hash=await binaryHash(result.bytes);
 await env.AI_ADS_ASSETS.put(key,result.bytes,{httpMetadata:{contentType:result.mimeType,cacheControl:'private, no-store'}});
 try{await db.batch([
  db.prepare("INSERT INTO ai_ads_assets(workspace_id,actor_id,id,job_id,kind,object_key,mime_type,bytes,width,height,sha256,created_at) SELECT workspace_id,actor_id,?,id,'generated',?,?,?,?,?,?,? FROM ai_ads_jobs WHERE workspace_id=? AND actor_id=? AND id=? AND dispatch_nonce=? AND status IN('DISPATCHED','UNCERTAIN')").bind(asset,key,result.mimeType,result.bytes.length,result.width,result.height,hash,now,scope.workspaceId,scope.actorId,id,nonce),
  db.prepare("UPDATE ai_ads_jobs SET status='COMPLETE',result_asset_id=?,error_code=NULL,updated_at=? WHERE workspace_id=? AND actor_id=? AND id=? AND dispatch_nonce=? AND EXISTS(SELECT 1 FROM ai_ads_assets WHERE workspace_id=? AND actor_id=? AND id=?)").bind(asset,now,scope.workspaceId,scope.actorId,id,nonce,scope.workspaceId,scope.actorId,asset),
  db.prepare("UPDATE ai_ads_usage_reservations SET state='UNKNOWN',usage_json=?,provider_request_id=?,updated_at=? WHERE workspace_id=? AND actor_id=? AND job_id=? AND EXISTS(SELECT 1 FROM ai_ads_jobs WHERE workspace_id=? AND actor_id=? AND id=? AND status='COMPLETE')").bind(JSON.stringify(result.usage),result.providerRequestId,now,scope.workspaceId,scope.actorId,id,scope.workspaceId,scope.actorId,id),
 ]);}catch(error){await env.AI_ADS_ASSETS.delete(key).catch(()=>{});throw error;}
}
export async function failJob(env,scope,id,nonce,error){
 const definite=error?.definite===true,now=new Date().toISOString(),code=definite?'AI_ADS_PROVIDER_REJECTED':error?.code==='AI_ADS_PROVIDER_OUTPUT_INVALID'?'AI_ADS_PROVIDER_OUTPUT_INVALID':'AI_ADS_PROVIDER_RESULT_UNCERTAIN';
 await env.smart_menu_db.batch([
  env.smart_menu_db.prepare("UPDATE ai_ads_jobs SET status=?,error_code=?,updated_at=? WHERE workspace_id=? AND actor_id=? AND id=? AND dispatch_nonce=? AND status IN('DISPATCHED','UNCERTAIN')").bind(definite?'FAILED':'UNCERTAIN',code,now,scope.workspaceId,scope.actorId,id,nonce),
  env.smart_menu_db.prepare("UPDATE ai_ads_usage_reservations SET state=?,actual_micros=?,updated_at=? WHERE workspace_id=? AND actor_id=? AND job_id=? AND EXISTS(SELECT 1 FROM ai_ads_jobs WHERE workspace_id=? AND actor_id=? AND id=? AND dispatch_nonce=? AND status IN('FAILED','UNCERTAIN'))").bind(definite?'RELEASED':'UNKNOWN',definite?0:null,now,scope.workspaceId,scope.actorId,id,scope.workspaceId,scope.actorId,id,nonce),
 ]);
}
