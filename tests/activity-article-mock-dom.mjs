import vm from 'node:vm';

// A deliberately small DOM for executing the production inline scripts as pure
// JavaScript tests. It is not a browser and has no real layout or network APIs.
const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const voidTags=new Set(['INPUT','IMG','META','LINK','BR','HR','SOURCE']);
function matches(element,selector) {
  if(!element?.tagName)return false;
  if(selector.includes(','))return selector.split(',').some(item=>matches(element,item.trim()));
  const parts=selector.trim().split(/\s+/);
  if(parts.length>1){if(!matches(element,parts.pop()))return false;let parent=element.parentElement;while(parent){if(matches(parent,parts.join(' ')))return true;parent=parent.parentElement}return false}
  const id=selector.match(/#([\w-]+)/)?.[1];if(id&&element.id!==id)return false;
  const klass=selector.match(/\.([\w-]+)/)?.[1];if(klass&&!element.className.split(/\s+/).includes(klass))return false;
  const tag=selector.match(/^[a-z][\w-]*/i)?.[0];if(tag&&element.tagName!==tag.toUpperCase())return false;
  for(const [,key,value] of selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)){
    if(!element.hasAttribute(key))return false;if(value!==undefined&&element.getAttribute(key)!==value)return false;
  }
  return true;
}
export class MockNode {
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.parentElement=null;this.children=[];this.attributes=new Map();this.dataset={};this.style={};this.value='';this.disabled=false;this.hidden=false;this.inert=false;this.open=false;this.listeners=new Map();this.files=[];this._text='';}
  get id(){return this.attributes.get('id')||''}set id(value){this.setAttribute('id',value)}
  get name(){return this.attributes.get('name')||''}set name(value){this.setAttribute('name',value)}
  get className(){return this.attributes.get('class')||''}set className(value){this.attributes.set('class',String(value))}
  get classList(){return {toggle:(name,force)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));const active=force===undefined?!values.has(name):force;if(active)values.add(name);else values.delete(name);this.className=[...values].join(' ');return active},add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/),...names])].filter(Boolean).join(' ')},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ')},contains:name=>this.className.split(/\s+/).includes(name)}}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  set textContent(value){this._text=String(value??'');for(const child of this.children)child.parentElement=null;this.children=[];}
  get innerText(){return this.textContent}
  get innerHTML(){return this.textContent}
  set innerHTML(value){this.replaceChildren();parseInto(String(value),this,this.ownerDocument)}
  get scrollHeight(){return Math.max(100,(String(this.value||this.textContent).split('\n').length+Math.ceil(String(this.value||'').length/70))*24)}
  get isConnected(){let node=this;while(node){if(node===this.ownerDocument.body)return true;node=node.parentElement}return false}
  get parentNode(){return this.parentElement}
  get nextSibling(){const siblings=this.parentElement?.children||[];return siblings[siblings.indexOf(this)+1]||null}
  get elements(){return {namedItem:name=>this.querySelector('[name="'+name+'"]')}}
  setAttribute(name,value){value=String(value);this.attributes.set(name,value);if(name==='value')this.value=value;if(name==='hidden')this.hidden=true;if(name==='disabled')this.disabled=true;if(name==='type')this.type=value;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;}
  getAttribute(name){if(name==='value')return this.attributes.get(name)??null;if(name.startsWith('data-'))return this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null;return this.attributes.get(name)??null}
  hasAttribute(name){return this.attributes.has(name)||name.startsWith('data-')&&this.getAttribute(name)!==null}
  removeAttribute(name){this.attributes.delete(name);if(name==='src')this.src='';if(name==='hidden')this.hidden=false}
  append(...nodes){for(let node of nodes){if(typeof node!=='object'){const text=this.ownerDocument.createElement('#text');text.textContent=node;node=text}if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node)}}
  appendChild(node){this.append(node);return node}
  insertBefore(node,reference){if(!reference){this.append(node);return node}if(reference.parentElement!==this)throw Error('Reference is not a child');if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);const index=this.children.indexOf(reference);node.parentElement=this;this.children.splice(index,0,node);return node}
  add(node){this.append(node);if(this.tagName==='SELECT'&&this.children.length===1)this.value=node.value}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...nodes)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(matches(child,selector))found.push(child);found.push(...child.querySelectorAll(selector))}return found}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){let element=this;while(element){if(matches(element,selector))return element;element=element.parentElement}return null}
  addEventListener(name,listener){const list=this.listeners.get(name)||[];list.push(listener);this.listeners.set(name,list)}
  async fire(name){const event={type:name,target:this,currentTarget:this,preventDefault(){},stopPropagation(){}};if(typeof this['on'+name]==='function')await this['on'+name](event);for(const fn of this.listeners.get(name)||[])await fn(event);if(this.parentElement)for(const fn of this.parentElement.listeners.get(name)||[])await fn(event);const form=this.closest('form');if(form&&form!==this.parentElement)for(const fn of form.listeners.get(name)||[])await fn(event);}
  async click(){if(this.disabled)return;await this.fire('click');if(this.tagName==='BUTTON'&&(this.type==='submit'||!this.type)){const form=this.closest('form');if(form?.onsubmit)await form.onsubmit({type:'submit',target:form,submitter:this,preventDefault(){}})}}
  reset(){for(const element of this.querySelectorAll('input,select,textarea')){if(element.tagName==='SELECT'){const selected=element.querySelector('option[selected]')||element.querySelector('option');element.value=selected?.value||''}else element.value=element.getAttribute('value')||'';}}
  async input(value){this.value=String(value);await this.fire('input')}
  async change(value){if(value!==undefined)this.value=String(value);await this.fire('change')}
  focus(){this.ownerDocument.activeElement=this}
  scrollIntoView(){}
  showModal(){this.open=true}
  close(){this.open=false;for(const listener of this.listeners.get('close')||[])listener({target:this})}
}
class MockTextArea extends MockNode {}
function parseInto(html,parent,document){
  const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
  const stack=[parent];
  for(const token of clean.match(/<[^>]+>|[^<]+/g)||[]){
    if(token.startsWith('<!'))continue;
    if(token.startsWith('</')){const tag=token.match(/^<\/([\w-]+)/)?.[1].toUpperCase();const at=stack.findLastIndex(node=>node.tagName===tag);if(at>0)stack.splice(at);continue}
    if(token.startsWith('<')){const match=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);if(!match)continue;const element=document.createElement(match[1]);for(const attr of match[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))element.setAttribute(attr[1],decode(attr[2]??attr[3]??attr[4]??''));stack.at(-1).append(element);if(!voidTags.has(element.tagName)&&!token.endsWith('/>'))stack.push(element);continue}
    const raw=decode(token);if(raw.trim()||stack.at(-1).tagName==='TEXTAREA'){const text=document.createElement('#text');text.textContent=raw;stack.at(-1).append(text);if(stack.at(-1).tagName==='TEXTAREA')stack.at(-1).value+=raw;}
  }
  for(const select of parent.querySelectorAll('select')){const first=select.querySelector('option[selected]')||select.querySelector('option');if(first)select.value=first.getAttribute('value')??first.textContent;}
}
export class MockDocument {
  constructor(html){this.created=[];this.listeners=new Map();this.body=this.createElement('body');parseInto(html,this.body,this);this.activeElement=this.body;}
  createElement(tag){const node=tag.toLowerCase()==='textarea'?new MockTextArea(tag,this):new MockNode(tag,this);this.created.push(node);return node}
  createTextNode(value){const node=this.createElement('#text');node.textContent=value;return node}
  querySelector(selector){return matches(this.body,selector)?this.body:this.body.querySelector(selector)}
  querySelectorAll(selector){return this.body.querySelectorAll(selector)}
  getElementById(id){return this.querySelector('#'+id)}
  addEventListener(name,listener){const list=this.listeners.get(name)||[];list.push(listener);this.listeners.set(name,list)}
  async fire(name){for(const fn of this.listeners.get(name)||[])await fn({target:this})}
}
export async function inlineHarness(html,{fetch,url='https://fixture.test/activity-stories-admin',session=true,configureSandbox}={}) {
  const document=new MockDocument(html),events=new Map(),storage=new Map();
  if(session)storage.set('sakura_admin_session',JSON.stringify({token:'synthetic-admin'}));
  const location=new URL(url),LocalURL=class extends URL{};let nextBlob=0;
  LocalURL.createObjectURL=()=>`blob:synthetic-${++nextBlob}`;LocalURL.revokeObjectURL=()=>{};
  const sandbox={document,location,URL:LocalURL,URLSearchParams,AbortController,AbortSignal,Response,Request,Headers,Blob,File,FormData,TextEncoder,crypto,console,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer},clearTimeout,queueMicrotask,structuredClone,HTMLTextAreaElement:MockTextArea,HTMLElement:MockNode,HTMLInputElement:MockNode,
    requestAnimationFrame:fn=>{queueMicrotask(fn);return 1},cancelAnimationFrame(){},scrollTo(){},getComputedStyle:()=>({paddingTop:'0',paddingBottom:'0',borderTopWidth:'0',borderBottomWidth:'0'}),
    fetch:(...args)=>{if(!fetch)throw Error('Network disabled');return fetch(...args)},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    confirm:()=>true,alert:()=>{},liff:{init:async()=>{},isLoggedIn:()=>false,getIDToken:()=>'',isInClient:()=>false,login(){throw Error('Real login forbidden')},logout(){}},
    addEventListener(name,listener){const list=events.get(name)||[];list.push(listener);events.set(name,list)},history:{pushState(_state,_title,next){location.href=String(next)},replaceState(_state,_title,next){location.href=String(next)}}};
  sandbox.Option=class {constructor(label,value){const node=document.createElement('option');node.textContent=label;node.value=String(value);node.setAttribute('value',value);return node}};
  sandbox.window=sandbox;sandbox.parent=sandbox;
  configureSandbox?.(sandbox,document);
  const context=vm.createContext(sandbox);
  for(const [,script] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script).runInContext(context);
  await document.fire('DOMContentLoaded');
  const settle=async(predicate=()=>true)=>{for(let i=0;i<50;i++){await new Promise(resolve=>setImmediate(resolve));if(predicate())return}throw Error('Mock UI did not settle')};
  await settle();
  return {document,context,q:selector=>document.querySelector(selector),all:selector=>document.querySelectorAll(selector),settle,events,storage};
}
