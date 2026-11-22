import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyWelfareDeployment} from '../scripts/verify-welfare-deployment.mjs';
import {deployTestedBundle} from '../scripts/deploy-welfare-release.mjs';

const entry = process.env.STORE_APP_BUNDLE || fileURLToPath(new URL('../src/index.js',import.meta.url));
const bundle = await readFile(entry);
const {default:worker} = await import(pathToFileURL(entry).href);
const version = '00000000-0000-4000-8000-000000000011';
const previousVersion = '00000000-0000-4000-8000-000000000010';
const token = 'synthetic-read-only';
const bindings = [
  {name:'DB',type:'d1',id:'0a4bf3ce-5827-46a7-9629-155639dc7ac2'},
  {name:'R2_BUCKET',type:'r2_bucket',bucket_name:'sakurakitchen-files'},
  {name:'LINE_CHANNEL_ACCESS_TOKEN',type:'secret_text'}
];
const accountId = '1'.repeat(32);
const scriptPath = '/client/v4/accounts/'+accountId+'/workers/scripts/sakura-welfare-platform';
const success = result => Response.json({success:true,result});
const input = {bundle,version,previousVersion,token,accountId};
let outbound = 0;
globalThis.fetch = () => {
  outbound++;
  throw new Error('Fixture must intercept all network requests');
};

function fixture({wrongVersion=false,wrongContent=false,wrongBinding=false,openRoute=false,rolloutDuringCheck=false,multipart=false,rehearsal=false,rolloutDuringUpload=false,unpublishedVersion=false}={}) {
  const calls = [];
  const writes = [];
  let deploymentReads = 0;
  let staged = false;
  let activeVersion = rehearsal||wrongVersion?previousVersion:version;
  const request = async (raw,options)=>{
    assert.equal(options.redirect,'error');
    const url = new URL(raw);
    calls.push(url.pathname);
    if(url.origin==='https://api.cloudflare.com'){
      assert.equal(options.headers.Authorization,'Bearer '+token);
      assert.ok(url.pathname.startsWith(scriptPath+'/'));
      const path = url.pathname.slice(scriptPath.length);
      if(options.method==='POST'){
        assert.equal(rehearsal,true);
        writes.push(path);
        if(path==='/versions'){
          assert.equal(url.search,'?bindings_inherit=strict');
          assert.deepEqual(JSON.parse(options.body.get('metadata')),{
            main_module:'index.js',bindings:bindings.map(({name})=>({name,type:'inherit'})),
            compatibility_date:'2026-05-08',compatibility_flags:[]
          });
          assert.deepEqual(Buffer.from(await options.body.get('index.js').arrayBuffer()),bundle);
          staged=true;
          return success({id:version});
        }
        assert.equal(path,'/deployments');
        assert.equal(staged,true);
        assert.deepEqual(JSON.parse(options.body),{strategy:'percentage',versions:[{version_id:version,percentage:100}]});
        activeVersion=version;
        return success({id:'activated'});
      }
      assert.equal(options.method,'GET');
      if(path==='/deployments'){
        deploymentReads++;
        return success({deployments:[
          {id:'old',created_on:'2026-11-21',versions:[{version_id:previousVersion,percentage:100}]},
          {id:rolloutDuringCheck&&deploymentReads>1||rolloutDuringUpload&&staged?'updated':activeVersion,
            created_on:'2026-11-22',versions:[{version_id:activeVersion,percentage:100}]}
        ]});
      }
      if(path==='/settings')return success({bindings,compatibility_date:'2026-05-08',compatibility_flags:[]});
      if(path==='/schedules')return success({schedules:[{cron:'*/5 * * * *'},{cron:'* * * * *'}]});
      if(path==='/versions')return success({items:[
        {id:previousVersion,number:10},
        ...(unpublishedVersion?[{id:version,number:11}]:[])
      ]});
      if(path==='/content/v2'){
        if(wrongContent)return new Response('incorrect candidate');
        if(!multipart)return new Response(bundle);
        const parts = new FormData();
        parts.set('index.js',new File([bundle],'index.js',{type:'application/javascript+module'}));
        return new Response(parts);
      }
      if(path==='/versions/'+previousVersion||path==='/versions/'+version){
        const current = structuredClone(bindings);
        if(wrongBinding&&path.endsWith(version))current[1].bucket_name='different';
        return success({resources:{bindings:current,script_runtime:{compatibility_date:'2026-05-08'},script:{handlers:['fetch','scheduled']}}});
      }
      throw new Error('Unexpected Cloudflare route');
    }
    assert.equal(options.method,'GET');
    assert.equal(url.origin,'https://sakura-welfare-platform.fangwl591021.workers.dev');
    assert.deepEqual(options.headers,{});
    if(openRoute&&url.pathname==='/admin-api/welfare-shop')return Response.json({success:true});
    const db = {prepare(){throw new Error('Anonymous page and denial checks must not access data');}};
    return worker.fetch(new Request(url),{DB:db},{waitUntil(){throw new Error('Unexpected background work');}});
  };
  return {calls,writes,request};
}

test('release verifier uses only GET and verifies bundled bytes, versions, pages and anonymous denials',async t=>{
  t.after(()=>assert.equal(outbound,0));
  for(const multipart of [false,true]) {
    const {calls,request} = fixture({multipart});
    const checked = await verifyWelfareDeployment(input,request);
    assert.equal(checked.version,version);
    assert.equal(checked.pages.length,5);
    assert.equal(checked.accessChecks,5);
    assert.equal(checked.bindings,3);
    assert.equal(calls.filter(path=>path.endsWith('/deployments')).length,2);
  }
});

test('release verifier fails on drift or a public private route',async t=>{
  t.after(()=>assert.equal(outbound,0));
  for(const [key,pattern] of [
    ['wrongVersion',/100% 流量/],['wrongContent',/SHA-256/],['wrongBinding',/綁定與前版不同/],
    ['openRoute',/未登入存取狀態不符/],['rolloutDuringCheck',/核對期間正式部署已變更/]
  ]){
    await assert.rejects(verifyWelfareDeployment(input,fixture({[key]:true}).request),pattern);
  }
});

test('manual release rehearses exact bundle upload, activation and read-only verification',async t=>{
  t.after(()=>assert.equal(outbound,0));
  const {writes,request}=fixture({rehearsal:true,multipart:true});
  const receipt=await deployTestedBundle(input,request);
  assert.deepEqual(receipt,{version,previousVersion});
  const checked=await verifyWelfareDeployment({...input,...receipt},request);
  assert.equal(checked.accessChecks,5);
  assert.deepEqual(writes,['/versions','/deployments']);
});

test('manual release stops before activation on binding drift or a competing deployment',async t=>{
  t.after(()=>assert.equal(outbound,0));
  for(const [option,pattern] of [['wrongBinding',/綁定與前版不同/],['rolloutDuringUpload',/上傳期間正式版本已變更/]]){
    const {writes,request}=fixture({rehearsal:true,[option]:true});
    await assert.rejects(deployTestedBundle(input,request),pattern);
    assert.deepEqual(writes,['/versions']);
  }
  const {writes,request}=fixture({rehearsal:true,unpublishedVersion:true});
  await assert.rejects(deployTestedBundle(input,request),/另有版本已上傳但尚未啟用/);
  assert.deepEqual(writes,[]);
});

test('production CLI rejects an isolated manual event and a non-main ref before any operation',()=>{
  const cli = fileURLToPath(new URL('../scripts/deploy-welfare-release.mjs',import.meta.url));
  const actionEnv = {...process.env,GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_REF:'refs/heads/main',WELFARE_RELEASE_MODE:'production',GITHUB_OUTPUT:'synthetic-output'};
  for(const override of [{WELFARE_RELEASE_MODE:'isolated'},{GITHUB_REF:'refs/heads/topic'}]){
    const result=spawnSync(process.execPath,[cli,'nonexistent-bundle.js'],{env:{...actionEnv,...override},encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/正式部署只可由 main/);
  }
});
