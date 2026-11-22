import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {QUILL_JS} from '../src/article-quill-assets.js';
import {articleEditorFactory,articleConversionTools} from '../src/article-rich-editor.js';

// Run the vendored Quill's real updateContents/modify gate, Delta, and History.
// Only DOM rendering and its editor storage are replaced; there is no browser,
// network, real upload, or production state in this regression.
function harness(t,{onChange}={}){
 const noop=()=>{},context={navigator:{platform:'Win32'},document:{addEventListener:noop},Node:{TEXT_NODE:3,ELEMENT_NODE:1}};
 context.self=context;context.window=context;vm.runInNewContext(QUILL_JS,context);
 const Quill=context.Quill,Delta=Quill.import('delta'),History=Quill.import('modules/history');let instance;
 class QuillWithMemoryEditor{
  constructor(container,options){
   instance=this;this.enabled=true;this.selection={index:0,length:0};this.listeners=new Map();this.root={setAttribute:noop,addEventListener:noop,removeEventListener:noop,querySelectorAll:()=>[],contains:()=>false};this.keyboard={addBinding:noop};this.scroll={query:()=>null};this.clipboard={addMatcher:noop};this.allowReadOnlyEdits=false;
   this.editor={delta:new Delta().insert('\n'),applyDelta:delta=>{if(this.failApply)throw Error('synthetic storage failure');this.editor.delta=this.editor.delta.compose(delta);return delta;}};
   this.emitter={emit:(event,...args)=>{for(const callback of this.listeners.get(event)||[])callback(...args);}};
   this.history=new History(this,options.modules.history);
  }
  static import(name){return Quill.import(name);}static register(...args){Quill.register(...args);}
  on(event,callback){const callbacks=this.listeners.get(event)||[];callbacks.push(callback);this.listeners.set(event,callbacks);}
  off(event,callback){this.listeners.set(event,(this.listeners.get(event)||[]).filter(item=>item!==callback));}
  enable(value=true){this.enabled=value;}disable(){this.enable(false);}isEnabled(){return this.enabled;}
  getContents(){return this.editor.delta;}getLength(){return this.editor.delta.length();}getSelection(){return {...this.selection};}
  setSelection(index,length=0,source='api'){if(typeof index==='object'){source=length;this.selection={...index};}else{if(typeof length==='string'){source=length;length=0;}this.selection={index,length};}if(source!=='silent')this.emitter.emit('selection-change',{...this.selection});}
  setContents(ops){this.editor.delta=new Delta(ops);}update(){}focus(){}
  updateContents(...args){return Quill.prototype.updateContents.apply(this,args);}
 }
 const prior=globalThis.window;globalThis.window={Quill:QuillWithMemoryEditor};t.after(()=>{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;});
 const tools=articleConversionTools(),toolbar={parentElement:{querySelector:()=>null},querySelector:()=>null},editor=articleEditorFactory(tools)({container:{replaceChildren:noop},toolbar,onChange:blocks=>onChange?.(blocks,instance),onError:message=>{throw Error(message);}});
 return {editor,quill:()=>instance,Delta,plain:value=>JSON.parse(JSON.stringify(value))};
}

test('the actual Quill user gate ignores writes while disabled, reproducing the upload failure',t=>{
 const h=harness(t),quill=h.quill();h.editor.setBlocks([{type:'text',text:'before after'}]);h.editor.enable(false);
 quill.updateContents(new h.Delta().retain(7).insert({storyImage:{media_id:'uploaded-photo',caption:''}}),'user');
 assert.deepEqual(h.editor.getBlocks(),[{type:'text',text:'before after'}]);assert.equal(quill.history.stack.undo.length,0);
});

test('busy upload inserts once at the saved selection, remains locked, and supports real Quill undo/redo',t=>{
 const changes=[];const h=harness(t,{onChange(blocks,quill){changes.push(blocks);quill.enable(false);}}),quill=h.quill();
 h.editor.setBlocks([{type:'text',text:'before replace after'}]);quill.setSelection(7,7);h.editor.rememberSelection();h.editor.enable(false);
 h.editor.insertImage({media_id:'uploaded-photo',caption:'caption',width:50,align:'center'});
 const inserted=h.editor.getBlocks();assert.equal(inserted.filter(block=>block.type==='image').length,1);assert.deepEqual(inserted,[{type:'text',text:'before '},{type:'image',media_id:'uploaded-photo',caption:'caption',width:50,align:'center'},{type:'text',text:' after'}]);
 assert.equal(changes.length,1,'selection deletion and insertion must be one change even when the host immediately locks the editor');assert.equal(quill.isEnabled(),false);assert.equal(quill.history.stack.undo.length,1);
 h.editor.enable(true);quill.history.undo();assert.deepEqual(h.editor.getBlocks(),[{type:'text',text:'before replace after'}]);assert.equal(quill.isEnabled(),false,'host busy gate still controls editing');
 h.editor.enable(true);quill.history.redo();assert.deepEqual(h.editor.getBlocks(),inserted);assert.equal(quill.isEnabled(),false);
});

test('a failed insertion restores the prior disabled state and retains the document',t=>{
 const h=harness(t),quill=h.quill();h.editor.setBlocks([{type:'text',text:'keep all content'}]);h.editor.enable(false);quill.failApply=true;
 assert.throws(()=>h.editor.insertImage({media_id:'uploaded-photo'}),/synthetic storage failure/);assert.equal(quill.isEnabled(),false);assert.deepEqual(h.editor.getBlocks(),[{type:'text',text:'keep all content'}]);
});

test('an editor with failed content loading cannot be temporarily unlocked for insertion',t=>{
 const h=harness(t),quill=h.quill();h.editor.setBlocks([{type:'text',text:'previous'}]);assert.throws(()=>h.editor.setBlocks([{type:'unsupported'}]),/不支援/);
 assert.throws(()=>h.editor.insertImage({media_id:'uploaded-photo'}),/不支援/);assert.equal(quill.isEnabled(),false);
});
