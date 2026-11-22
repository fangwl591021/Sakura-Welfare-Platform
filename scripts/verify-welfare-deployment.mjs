import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual, parseArgs} from 'node:util';
import vm from 'node:vm';

const worker = 'sakura-welfare-platform';
const origin = 'https://sakura-welfare-platform.fangwl591021.workers.dev';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const pages = [
  ['/welfare-shop','福利品商城','送出購買申請'],
  ['/welfare-shop-admin','福利品商城管理','編輯商品'],
  ['/line-segment-push','LINE 分眾推播','受眾與送出確認','id="previewChat"','id="previewList"'],
  ['/line-push-history','推播紀錄與成效','查看明細'],
  ['/vendor-management','多品牌 LINE 管理','確認綁定並授權管理']
];
const restricted = [
  ['/api/welfare-shop',401],
  ['/admin-api/welfare-shop',403],
  ['/admin-api/line-segment-push',403],
  ['/admin-api/line-push-history',403],
  ['/admin-api/vendor-management?action=vendor.brands.search',403]
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const byName = bindings => [...bindings].sort((a,b)=>a.name.localeCompare(b.name));
export const cronRules = ['* * * * *','*/5 * * * *'].sort();

function check(ok, message) {
  if(!ok)throw new Error(message);
}

export function welfareWorkerApi(accountId) {
  check(typeof accountId==='string'&&/^[a-f0-9]{32}$/i.test(accountId),'請設定 CLOUDFLARE_ACCOUNT_ID。');
  return 'https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/scripts/'+worker;
}

export function checkWelfareTarget(settings,schedules) {
  check(Array.isArray(settings.bindings),'無法取得正式 Worker 綁定。');
  const db = settings.bindings.find(b=>b.name==='DB'&&b.type==='d1');
  const bucket = settings.bindings.find(b=>b.name==='R2_BUCKET'&&b.type==='r2_bucket');
  check((db?.id||db?.database_id)==='0a4bf3ce-5827-46a7-9629-155639dc7ac2'&&bucket?.bucket_name==='sakurakitchen-files',
    '正式 D1 或 R2 綁定與 Sakura 設定不同。');
  check(Array.isArray(schedules.schedules)&&isDeepStrictEqual(schedules.schedules.map(row=>row.cron).sort(),cronRules),
    '正式排程與 Sakura 設定不同。');
}

export function checkVersionResources(before,after) {
  const oldResources = before.resources;
  const newResources = after.resources;
  check(Array.isArray(oldResources?.bindings)&&Array.isArray(newResources?.bindings)&&
    isDeepStrictEqual(byName(oldResources.bindings),byName(newResources.bindings)),'Worker 綁定與前版不同。');
  check(oldResources.script_runtime&&newResources.script_runtime&&
    isDeepStrictEqual(oldResources.script_runtime,newResources.script_runtime),'Worker 執行設定與前版不同。');
  check(Array.isArray(oldResources.script?.handlers)&&Array.isArray(newResources.script?.handlers)&&
    isDeepStrictEqual([...oldResources.script.handlers].sort(),[...newResources.script.handlers].sort()),'Worker 入口與前版不同。');
}

export function latestDeployment(result) {
  const deployments = result.deployments || result;
  check(Array.isArray(deployments), '無法讀取目前正式部署。');
  return [...deployments].sort((a,b)=>b.created_on.localeCompare(a.created_on))[0];
}

async function workerEntry(response) {
  if(!response.headers.get('content-type')?.includes('multipart/form-data')){
    return Buffer.from(await response.arrayBuffer());
  }
  const form = await response.formData();
  const entries = [...form].filter(([key,value])=>typeof value?.arrayBuffer==='function'&&(key==='index.js'||value.name==='index.js'));
  check(entries.length===1,'讀回內容沒有唯一的 Worker 入口 index.js。');
  return Buffer.from(await entries[0][1].arrayBuffer());
}

export async function verifyWelfareDeployment({bundle,version,previousVersion,token,accountId}, request=fetch) {
  check(Buffer.isBuffer(bundle)&&bundle.length>0,'請提供本次上傳的 Worker 打包檔。');
  check(uuid.test(version||'')&&uuid.test(previousVersion||''),'請提供部署版與前版的 Worker 版本 ID。');
  check(typeof token==='string'&&token.trim(),'請設定具備 Workers Scripts Read 的 CLOUDFLARE_API_TOKEN。');
  const api = welfareWorkerApi(accountId);
  const sha256 = hash(bundle);

  async function get(base, path, headers={}) {
    try {
      return await request(base+path,{
        method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)
      });
    } catch {
      throw new Error(path+' 讀取失敗或逾時。');
    }
  }
  async function metadata(path) {
    const response = await get(api,path,{Authorization:'Bearer '+token});
    check(response.ok,path+' 讀取失敗（HTTP '+response.status+'）。');
    const json = await response.json().catch(()=>null);
    check(json?.success&&json.result,path+' 無法取得核對資料。');
    return json.result;
  }
  async function assertActiveVersion() {
    const active = latestDeployment(await metadata('/deployments'));
    check(isDeepStrictEqual(active?.versions,[{version_id:version,percentage:100}]),'指定版本尚未承接正式站 100% 流量。');
    return active.id;
  }

  const deployment = await assertActiveVersion();
  const [before,after,settings,schedules,response] = await Promise.all([
    metadata('/versions/'+previousVersion),metadata('/versions/'+version),
    metadata('/settings'),metadata('/schedules'),get(api,'/content/v2',{Authorization:'Bearer '+token})
  ]);
  checkVersionResources(before,after);
  checkWelfareTarget(settings,schedules);
  check(Array.isArray(settings.bindings)&&isDeepStrictEqual(
    byName(settings.bindings).map(({name,type})=>({name,type})),
    byName(after.resources.bindings).map(({name,type})=>({name,type}))), '目前正式 Worker 綁定與部署版本不同。');
  check(response.ok,'Worker 程式讀回失敗（HTTP '+response.status+'）。');
  check(hash(await workerEntry(response))===sha256,'正式 Worker 程式與本次打包檔的 SHA-256 不同。');

  const pageResults = await Promise.all(pages.map(async ([path,...markers])=>{
    const result = await get(origin,path);
    check(result.status===200&&result.headers.get('content-type')?.includes('text/html'),path+' 無法載入 HTML。');
    const html = await result.text();
    const readableHtml = html.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    for(const marker of markers)check(readableHtml.includes(marker),path+' 缺少預期的介面內容。');
    for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
      if(!script.trim())continue;
      try {new vm.Script(script);} catch {throw new Error(path+' 的頁面程式無法解析。');}
    }
    return path;
  }));
  await Promise.all(restricted.map(async ([path,status])=>{
    const result = await get(origin,path);
    await result.body?.cancel();
    check(result.status===status,path+' 的未登入存取狀態不符（HTTP '+result.status+'）。');
  }));
  check(await assertActiveVersion()===deployment,'核對期間正式部署已變更。');
  return {worker,version,sha256,pages:pageResults,accessChecks:restricted.length,bindings:settings.bindings.length,crons:cronRules};
}

async function main() {
  const {values} = parseArgs({
    options:{bundle:{type:'string'},version:{type:'string'},'previous-version':{type:'string'},help:{type:'boolean'}}
  });
  if(values.help){
    console.log('npm run verify:welfare -- --bundle <index.js> --version <新版本 ID> --previous-version <前一正式版本 ID>');
    return;
  }
  check(values.bundle,'缺少 --bundle。執行 npm run verify:welfare -- --help 查看用法。');
  const bundle = await readFile(values.bundle);
  console.log(JSON.stringify(await verifyWelfareDeployment({
    bundle,version:values.version,previousVersion:values['previous-version'],
    token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID
  }),null,2));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error('正式核對失敗。'+error.message);process.exitCode=1;});
}
