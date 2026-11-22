import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {LIFE_INFO_STATION_COMMANDS} from '../src/life-info-station.js';

const html=fs.readFileSync(new URL('../src/rich-menu-editor.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('MenuModule.init();','');
const origin='https://sakura-welfare-platform.fangwl591021.workers.dev';
const image=origin+'/file/original-menu.jpg';
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture({command=LIFE_INFO_STATION_COMMANDS.zh,isDefaultHome=true,configDefault=isDefaultHome,id='guest_zh',aliasId=id}={}) {
 const elements=new Map(),calls=[],alerts=[];
 let canvasConversions=0;
 class Element {
  constructor(){this.value='';this.style={};this.innerHTML='';this.innerText='';this.disabled=false;this.children=[];this.events={};const classes=new Set(['hidden','translate-x-full']);this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle:(v,force)=>force===undefined?(classes.has(v)?classes.delete(v):classes.add(v)):(force?classes.add(v):classes.delete(v))};}
  addEventListener(type,fn){this.events[type]=fn;}
  appendChild(child){this.children.push(child);}
 }
 const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 class Rect {constructor(data){Object.assign(this,{scaleX:1,scaleY:1},data);this.type='rect';}getScaledWidth(){return this.width*this.scaleX;}getScaledHeight(){return this.height*this.scaleY;}}
 class Text {constructor(){this.type='text';}}
 class Canvas {
  constructor(){this.width=600;this.objects=[];}
  on(){} renderAll(){} setWidth(v){this.width=v;}setHeight(v){this.height=v;}getWidth(){return this.width;}
  setBackgroundImage(img,done){this.backgroundImage=img;done();}
  getObjects(type){return this.objects.filter(o=>o.type===type);}
  add(o){this.objects.push(o);}remove(o){this.objects=this.objects.filter(v=>v!==o);}
 }
 class Image {constructor(){this.width=2500;this.height=1686;}set src(value){this.value=value;this.onload?.();}}
 const config={size:{width:2500,height:1686},selected:true,name:'Current project',chatBarText:'Menu',aliasId,
  retainedMetadata:{keep:'unchanged'},deployedRichMenuId:'richmenu-original',
  areas:[{bounds:{x:0,y:288,width:1250,height:1398},action:{type:'message',text:command}},
   {bounds:{x:0,y:0,width:865,height:288},action:{type:'richmenuswitch',richMenuAliasId:'guest_zh',data:'switch:guest_zh'}}]};
 if(configDefault!==undefined)config.isDefaultHome=configDefault;
 const item={id,name:config.name,chatBarText:config.chatBarText,aliasId,isDefaultHome,imageUrl:image,config};
 const sandbox={console,URL,location:{origin},Image,alert:msg=>alerts.push(msg),
  document:{getElementById:el,querySelector:()=>new Element(),createElement:tag=>{
   if(tag!=='canvas')return new Element();
   canvasConversions++;
   return {width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,Y2FudmFz'};
  }},fabric:{Canvas,Rect,Text,Image:class{constructor(img){this.width=img.width;this.height=img.height;this._element=img;}}},
  fetch:async(url,init)=>{
   const body=JSON.parse(init.body);calls.push(clone(body));
   const data=body.action==='RICH_MENU_LIST'?[{id,name:config.name}]:body.action==='RICH_MENU_LOAD'?clone(item):body.action==='RICH_MENU_SAVE'?{id}: {richMenuId:'richmenu-new'};
   return {ok:true,text:async()=>JSON.stringify({success:true,data})};
  }};
 sandbox.window=sandbox;
 vm.createContext(sandbox);new vm.Script(script).runInContext(sandbox);
 sandbox.MenuModule.init();sandbox.StorageModule.toggleDrawer=()=>{};
 return {sandbox,config,item,el,calls,alerts,canvasConversions:()=>canvasConversions,
  async load(){await sandbox.StorageModule.renderList();await sandbox.StorageModule.loadFromIndex(0);},
  deployment(){return calls.findLast(c=>c.action==='DEPLOY_RICH_MENU')?.data;}};
}

test('served editor script is compilable and the three exact command strings follow the routing export',()=>{
 new vm.Script(script);
 const encoded=html.match(/const lifeInfoStationCommands = (\[[^;]+\]);/)[1];
 assert.deepEqual(JSON.parse(encoded),Object.values(LIFE_INFO_STATION_COMMANDS));
});

test('an unchanged stored HTTPS image deploys its original URL without a canvas rewrite or R2 upload bytes',async()=>{
 const f=fixture();await f.load();await f.sandbox.MenuModule.executeDeploy();
 const payload=f.deployment();assert.ok(payload);
 assert.equal(payload.imageUrl,image);assert.equal(Object.hasOwn(payload,'imageBase64'),false);
 assert.equal(f.canvasConversions(),0);assert.equal(payload.id,'guest_zh');
 assert.equal(payload.aliasId,'guest_zh');assert.equal(payload.setDefault,true);
 assert.equal(payload.richMenuConfig.isDefaultHome,true);
 assert.deepEqual(payload.richMenuConfig.retainedMetadata,{keep:'unchanged'});
 assert.deepEqual(payload.richMenuConfig.areas,f.config.areas);
});

test('a newly uploaded data image keeps the existing base64 deployment path',async()=>{
 const f=fixture();await f.load();const bytes='data:image/jpeg;base64,b3JpZ2luYWw=';
 f.sandbox.MenuModule.load('new.jpg',encodeURIComponent(JSON.stringify(f.config)),bytes,bytes);
 await f.sandbox.MenuModule.executeDeploy();
 assert.equal(f.deployment().imageBase64,bytes);assert.equal(Object.hasOwn(f.deployment(),'imageUrl'),false);
 assert.equal(f.canvasConversions(),0);
});

test('non-default projects never set a global default and current-default metadata survives an ordinary same-project save',async()=>{
 const other=fixture({id:'indo-menu',isDefaultHome:false,configDefault:true});await other.load();await other.sandbox.MenuModule.executeDeploy();
 assert.equal(other.deployment().setDefault,false);assert.equal(other.deployment().richMenuConfig.isDefaultHome,false);
 const main=fixture();await main.load();const bytes='data:image/jpeg;base64,Ynl0ZXM=';
 main.sandbox.MenuModule.load('same.jpg',encodeURIComponent(JSON.stringify(main.config)),bytes,bytes);
 await main.sandbox.StorageModule.saveCurrent(false);await main.sandbox.MenuModule.executeDeploy();
 assert.equal(main.deployment().setDefault,true);assert.equal(main.sandbox.StorageModule.getCurrentMeta().isDefaultHome,true);
});

test('saving as a new project does not inherit the loaded project global-default status',async()=>{
 const f=fixture();await f.load();const bytes='data:image/jpeg;base64,Ynl0ZXM=';
 f.sandbox.MenuModule.load('new.jpg',encodeURIComponent(JSON.stringify(f.config)),bytes,bytes);
 await f.sandbox.StorageModule.saveCurrent(true);await f.sandbox.MenuModule.executeDeploy();
 assert.equal(f.deployment().setDefault,false);assert.equal(f.deployment().richMenuConfig.isDefaultHome,false);
});

test('only the three exact life-information message commands defer existing-user refresh',async()=>{
 for(const command of Object.values(LIFE_INFO_STATION_COMMANDS)){
  const f=fixture({command});await f.load();await f.sandbox.MenuModule.executeDeploy();assert.equal(f.deployment().deferUserMenuRefresh,true,command);
 }
 for(const command of ['會員QR碼','員工生活情報站說明',' 員工生活情報站','員工生活情報站 ']){
  const f=fixture({command});await f.load();await f.sandbox.MenuModule.executeDeploy();assert.equal(f.deployment().deferUserMenuRefresh,false,command);
 }
 const uri=fixture();uri.config.areas[0].action={type:'uri',uri:'https://example.test/員工生活情報站'};
 await uri.load();await uri.sandbox.MenuModule.executeDeploy();assert.equal(uri.deployment().deferUserMenuRefresh,false);
});

test('untrusted cross-origin stored images do not use the no-reencoding same-origin fast path',async()=>{
 const f=fixture();f.item.imageUrl='https://other.example/menu.jpg';await f.load();await f.sandbox.MenuModule.executeDeploy();
 assert.equal(f.canvasConversions(),1);assert.equal(Object.hasOwn(f.deployment(),'imageUrl'),false);
});
