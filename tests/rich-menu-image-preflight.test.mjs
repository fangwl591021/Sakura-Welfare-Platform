import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function declaration(name){
 const pattern=/^(?:async )?function ([A-Za-z0-9_]+)\(/gm;
 const positions=[...source.matchAll(pattern)];
 const at=positions.findIndex(m=>m[1]===name);
 assert.notEqual(at,-1,name);
 return source.slice(positions[at].index,positions[at+1]?.index??source.length);
}
const names=['deployAndSaveRichMenu','deployRichMenuToLine','loadRichMenuImageBytes','dataUrlToUint8Array','normalizeRichMenuAliasId','normalizeRichMenuSwitchData','normalizeRichMenuSwitchActions','sanitizeRichMenuAction','isVisitorDefaultRichMenuAlias','richMenuDefaultHomeGuardMessage'];
const origin='https://sakura-welfare-platform.fangwl591021.workers.dev';
const key='rich_menu_fixture_繁體中文.jpg';
const bytes=Uint8Array.from([255,216,1,2,3,255,217]);
function fixture({object=true,empty=false,remoteStatus=200,remoteType='image/png'}={}){
 const events=[],r2Keys=[],uploads=[],lineCalls=[];
 const env={LINE_CHANNEL_ACCESS_TOKEN:'synthetic',R2_BUCKET:{async get(value){
  events.push('r2:get');r2Keys.push(value);
  return object?{httpMetadata:{contentType:'image/jpeg'},async arrayBuffer(){events.push('r2:bytes');return (empty?new Uint8Array():bytes).buffer;}}:null;
 }}};
 const context={console,URL,Uint8Array,atob,env,events,
  taiwanNowString:()=> 'synthetic-now',VISITOR_DEFAULT_RICH_MENU_ALIAS_ID:'guest_zh',
  lineApi:async(url,_env,options)=>{
   lineCalls.push({url,options});
   if(url==='https://api.line.me/v2/bot/richmenu'){events.push('line:create');return {ok:true,json:{richMenuId:'richmenu-synthetic'}};}
   if(url.includes('/content')){events.push('line:upload');uploads.push(options);return {ok:true};}
   throw Error('Unexpected provider call');
  },
  upsertRichMenuAlias:async()=>{events.push('line:alias');return 'guest_zh';},
  fetch:async url=>{
   events.push('http:'+url);
   return {ok:remoteStatus>=200&&remoteStatus<300,status:remoteStatus,headers:{get:()=>remoteType},arrayBuffer:async()=>bytes.buffer};
  }};
 vm.createContext(context);new vm.Script(names.map(declaration).join('\n')).runInContext(context);
 const data={id:'guest_zh',aliasId:'guest_zh',imageUrl:origin+'/file/'+encodeURIComponent(key),
  richMenuConfig:{name:'Existing menu',chatBarText:'Menu',size:{width:2500,height:1686},selected:true,aliasId:'guest_zh',
   areas:[{bounds:{x:0,y:288,width:1250,height:1398},action:{type:'message',text:'員工生活情報站'}}]}};
 return {context,env,data,events,r2Keys,uploads,lineCalls,run:()=>context.deployRichMenuToLine(data,env,origin)};
}

test('same-origin stored rich-menu artwork is read from R2 before create, with exact bytes and metadata',async()=>{
 const f=fixture();const result=await f.run();
 assert.equal(result.success,true);assert.deepEqual(f.r2Keys,[key]);
 assert.deepEqual(f.events,['r2:get','r2:bytes','line:create','line:upload','line:alias']);
 assert.equal(f.uploads[0].contentType,'image/jpeg');assert.deepEqual(f.uploads[0].body,bytes);
});

test('missing or empty R2 artwork fails without HTTP fallback or any LINE mutation',async()=>{
 for(const options of [{object:false},{empty:true}]){
  const f=fixture(options);const result=await f.run();
  assert.equal(result.success,false);assert.equal(f.lineCalls.length,0);assert.ok(f.events.every(e=>!e.startsWith('http:')));
 }
 const f=fixture();delete f.env.R2_BUCKET;assert.equal((await f.run()).success,false);assert.equal(f.lineCalls.length,0);
});

test('same-origin R2 mapping rejects credential URLs, encoded separators and malformed encodings',async()=>{
 for(const path of ['/file/rich_menu_test%2Factivity_story_private_x','/file/rich_menu_test%5Cother','/file/rich_menu_test%00x','/file/rich_menu_test%ZZ']){
  const f=fixture();f.data.imageUrl=origin+path;
  assert.equal((await f.run()).success,false,path);assert.equal(f.r2Keys.length,0,path);assert.equal(f.lineCalls.length,0,path);
 }
 const f=fixture();f.data.imageUrl=origin.replace('https://','https://name:pass@')+'/file/rich_menu_test.jpg';
 assert.equal((await f.run()).success,false);assert.equal(f.r2Keys.length,0);assert.equal(f.lineCalls.length,0);
});

test('other file namespaces keep the existing HTTP authorization path and never read private R2 keys',async()=>{
 for(const path of ['/file/activity_story_private_x','/file/club_private_media_x','/file/vendor_public_document_x']){
  const f=fixture({remoteStatus:403});f.data.imageUrl=origin+path;
  assert.equal((await f.run()).success,false);assert.deepEqual(f.r2Keys,[]);assert.equal(f.lineCalls.length,0);
  assert.deepEqual(f.events,['http:'+origin+path]);
 }
});

test('external image URLs retain the original fetch path, MIME and bytes, but are fetched before LINE create',async()=>{
 const f=fixture();f.data.imageUrl='https://cdn.example.test/file/rich_menu_remote.png';
 assert.equal((await f.run()).success,true);assert.deepEqual(f.r2Keys,[]);
 assert.equal(f.events[0],'http:'+f.data.imageUrl);assert.equal(f.events[1],'line:create');
 assert.equal(f.uploads[0].contentType,'image/png');assert.deepEqual(f.uploads[0].body,bytes);
});

test('remote HTTP errors, missing sources and malformed base64 all stop before creating orphan menus',async()=>{
 const remote=fixture({remoteStatus:404});remote.data.imageUrl='https://cdn.example.test/missing.jpg';
 assert.equal((await remote.run()).success,false);assert.equal(remote.lineCalls.length,0);
 const absent=fixture();delete absent.data.imageUrl;assert.equal((await absent.run()).success,false);assert.equal(absent.lineCalls.length,0);
 const invalid=fixture();invalid.data.imageBase64='data:image/png;base64,%%%';
 assert.equal((await invalid.run()).success,false);assert.equal(invalid.lineCalls.length,0);assert.deepEqual(invalid.r2Keys,[]);
});

test('new base64 uploads retain their original path without adding dimensions or format restrictions',async()=>{
 const f=fixture();f.data.imageBase64='data:image/png;base64,AQID';f.data.richMenuConfig.size.height=843;
 assert.equal((await f.run()).success,true);assert.deepEqual(f.r2Keys,[]);
 assert.equal(f.events[0],'line:create');assert.equal(f.uploads[0].contentType,'image/png');assert.deepEqual(f.uploads[0].body,Uint8Array.from([1,2,3]));
});

test('the publisher receives trusted request origin rather than any client supplied origin',async()=>{
 const f=fixture(),origins=[];f.context.captureOrigin=value=>origins.push(value);
 new vm.Script('deployRichMenuToLine=async (data,env,requestOrigin)=>{captureOrigin(requestOrigin);return {success:false};};').runInContext(f.context);
 f.data.origin='https://untrusted.example';f.data.requestOrigin=f.data.origin;
 await f.context.deployAndSaveRichMenu(f.data,null,f.env,{url:origin+'/api'});
 assert.deepEqual(origins,[origin]);
});
