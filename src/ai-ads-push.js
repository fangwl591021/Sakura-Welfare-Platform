// Read only completed images for the authenticated owner. Keyset pagination
// keeps older works reachable without relying on the changing first page.
const idPattern = /^aia_[a-f0-9]{32}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const json = (value, status=200) => Response.json(value, {status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function listAiAdsPushAssets(request,db,actor) {
 const url=new URL(request.url), created=url.searchParams.get('before')||'', id=url.searchParams.get('beforeId')||'';
 if((created||id) && (!datePattern.test(created)||!idPattern.test(id)))return json({success:false,message:'作品分頁資料不正確。'},400);
 const rows=await db.prepare(`SELECT a.id,a.created_at,a.width,a.height FROM ai_ads_assets a JOIN ai_ads_jobs j ON j.workspace_id=a.workspace_id AND j.actor_id=a.actor_id AND j.id=a.job_id AND j.result_asset_id=a.id WHERE a.workspace_id=? AND a.actor_id=? AND a.kind='generated' AND j.status='COMPLETE' AND (?='' OR a.created_at<? OR (a.created_at=? AND a.id<?)) ORDER BY a.created_at DESC,a.id DESC LIMIT 9`).bind('sakura_welfare',actor,created,created,created,id).all();
 const items=rows.results||[], more=items.length>8; if(more)items.pop();
 const last=items.at(-1);
 return json({success:true,items:items.map(x=>({id:x.id,createdAt:x.created_at,width:x.width,height:x.height,contentUrl:'/admin-api/ai-ads/assets/'+x.id+'/content'})),next:more&&last?{before:last.created_at,beforeId:last.id}:null});
}
export async function isOwnedCompletedAiAsset(db,actor,id) {
 if(!idPattern.test(String(id||'')))return false;
 return !!await db.prepare("SELECT a.id FROM ai_ads_assets a JOIN ai_ads_jobs j ON j.workspace_id=a.workspace_id AND j.actor_id=a.actor_id AND j.id=a.job_id AND j.result_asset_id=a.id WHERE a.workspace_id=? AND a.actor_id=? AND a.id=? AND a.kind='generated' AND j.status='COMPLETE' LIMIT 1").bind('sakura_welfare',actor,id).first();
}
