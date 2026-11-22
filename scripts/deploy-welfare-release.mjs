import {appendFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {checkVersionResources,checkWelfareTarget,latestDeployment,welfareWorkerApi} from './verify-welfare-deployment.mjs';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function deployTestedBundle({bundle,accountId,token}, request=fetch) {
  if(!Buffer.isBuffer(bundle)||!bundle.length)throw new Error('缺少已通過冒煙測試的打包檔。');
  if(!token)throw new Error('未設定 Cloudflare 部署憑證。');
  const api = welfareWorkerApi(accountId);
  async function call(path, options={}) {
    const response = await request(api+path,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(60000),...options,
      headers:{Authorization:'Bearer '+token,...options.headers}
    }).catch(()=>null);
    const json = await response?.json().catch(()=>null);
    if(!response?.ok||!json?.success||!json.result){
      throw new Error('Cloudflare '+path+' 操作未確認（HTTP '+(response?.status||'無回應')+'）。');
    }
    return json.result;
  }
  const [settings,schedules,list,versions] = await Promise.all([
    call('/settings'),call('/schedules'),call('/deployments'),call('/versions')
  ]);
  checkWelfareTarget(settings,schedules);
  const current = latestDeployment(list);
  const previousVersion = current?.versions?.[0]?.version_id;
  if(!current?.id||current.versions.length!==1||current.versions[0].percentage!==100||!uuid.test(previousVersion||'')){
    throw new Error('無法確認唯一的前一正式版本，停止部署。');
  }
  const history=versions.items||versions;
  const latest=Array.isArray(history)?[...history].sort((a,b)=>b.number-a.number)[0]:null;
  if(latest?.id!==previousVersion)throw new Error('另有版本已上傳但尚未啟用，停止部署。');
  const before = await call('/versions/'+previousVersion);
  if(settings.bindings.length!==before.resources?.bindings?.length||
    !settings.bindings.every(a=>before.resources.bindings.some(b=>b.name===a.name&&b.type===a.type))){
    throw new Error('正式設定與前版綁定不同，停止部署。');
  }

  const metadata = {
    main_module:'index.js',
    bindings:settings.bindings.map(({name})=>({name,type:'inherit'})),
    compatibility_date:settings.compatibility_date,
    compatibility_flags:settings.compatibility_flags||[]
  };
  for(const key of ['logpush','tail_consumers','placement','limits','observability']){
    if(settings[key]!==undefined)metadata[key]=settings[key];
  }
  const form = new FormData();
  form.set('metadata',JSON.stringify(metadata));
  form.set('index.js',new File([bundle],'index.js',{type:'application/javascript+module'}));
  const {id:version} = await call('/versions?bindings_inherit=strict',{method:'POST',body:form});
  if(!uuid.test(version||''))throw new Error('上傳後未取得有效版本 ID，停止部署。');
  checkVersionResources(before,await call('/versions/'+version));
  if(latestDeployment(await call('/deployments'))?.id!==current.id){
    throw new Error('上傳期間正式版本已變更，停止部署。');
  }
  await call('/deployments',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({strategy:'percentage',versions:[{version_id:version,percentage:100}]})
  });
  return {version,previousVersion};
}

async function main() {
  const bundlePath = process.argv[2];
  if(!bundlePath||process.argv.length!==3)throw new Error('需要傳入已驗證的 Worker 打包檔。');
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
    process.env.GITHUB_REF!=='refs/heads/main'||process.env.WELFARE_RELEASE_MODE!=='production'||!process.env.GITHUB_OUTPUT){
    throw new Error('正式部署只可由 main 上的手動 production 工作執行。');
  }
  const {version,previousVersion}=await deployTestedBundle({
    bundle:await readFile(bundlePath),accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN
  });
  await appendFile(process.env.GITHUB_OUTPUT,'version='+version+'\nprevious_version='+previousVersion+'\n');
  console.log(JSON.stringify({version,previousVersion}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
