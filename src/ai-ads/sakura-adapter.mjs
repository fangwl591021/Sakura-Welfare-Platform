import catalog from "../../packages/ai-ads/catalog.json" with { type: "json" };
import {handleAiAdsRequest} from "./router.mjs";

// The host resolves this principal from the existing admin session. Never take
// a workspace, role or actor from request parameters or JSON.
export async function handleSakuraAiAds(request, env, principal, options = {}) {
  if (!principal || !["admin", "operator"].includes(String(principal.role || "")) || typeof principal.actor !== "string" || !principal.actor.trim()) {
    return Response.json({success:false,error:"AI_ADS_FORBIDDEN"},{status:403,headers:{"Cache-Control":"private, no-store"}});
  }
  if (!env.DB || !env.R2_BUCKET) {
    return Response.json({success:false,error:"AI_ADS_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
  // Assets use ai_ads_private_ keys: the public /file/ route must deny that
  // prefix before this adapter is exposed. All reads use ownedAsset().
  const scopedEnv = {...env, smart_menu_db:env.DB, AI_ADS_ASSETS:env.R2_BUCKET};
  return handleAiAdsRequest(request, scopedEnv, {workspaceId:"sakura_welfare",actorId:principal.actor}, {catalog,...options});
}
