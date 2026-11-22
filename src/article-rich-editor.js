import {QUILL_JS,QUILL_CSS,QUILL_VERSION} from './article-quill-assets.js';
import {youtubeVideoId} from './youtube-video.js';

// This factory is stringified for the browser as well as called by pure tests.
export function articleConversionTools(){
 const inlineKeys=['bold','italic','underline','strike'];
 const link=value=>{if(typeof value!=='string'||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))return '';try{const u=new URL(value);return ['http:','https:','mailto:','tel:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const marks=value=>{const result={};for(const key of inlineKeys)if(value?.[key]===true)result[key]=true;if(value?.link){const href=link(value.link);if(!href)throw Error('連結格式不正確。');result.link=href;}return result;};
 const align=value=>['left','center','right','justify'].includes(value)?value:'left';
 const imageAlign=value=>['left','center','right'].includes(value)?value:'left';
 const width=value=>[25,50,75,100].includes(Number(value))?Number(value):'auto';
 const appendRun=(runs,value,attributes={})=>{if(!value)return;const run={text:value,...marks(attributes)},last=runs.at(-1);if(last&&JSON.stringify(marks(last))===JSON.stringify(marks(run)))last.text+=value;else runs.push(run);};
 const rich=runs=>runs.some(r=>Object.keys(r).some(k=>k!=='text'));
 function sourceRuns(text,runs){if(!Array.isArray(runs))return [{text}];if(runs.some(r=>!r||typeof r.text!=='string')||runs.map(r=>r.text).join('')!==text)throw Error('正文格式與文字不一致。');return runs.map(r=>({text:r.text,...marks(r)}));}
 function blocksToDeltaOps(blocks){
  if(!Array.isArray(blocks))throw Error('正文格式不正確。');
  const ops=[];
  const insert=(value,attributes={})=>{if(value==='')return;const attrs=Object.fromEntries(Object.entries(attributes).filter(([,v])=>v!==undefined&&v!==null&&v!==false&&v!==''));const op={insert:value};if(Object.keys(attrs).length)op.attributes=attrs;ops.push(op);};
  function line(text,runs,attributes){for(const run of sourceRuns(text,runs)){const chunks=run.text.split('\n');for(let i=0;i<chunks.length;i++){insert(chunks[i],marks(run));if(i<chunks.length-1)insert('\n',attributes);}}insert('\n',attributes);}
  for(const block of blocks){
   if(!block||typeof block!=='object')throw Error('正文格式不正確。');
   const attributes={};if(align(block.align)!=='left')attributes.align=align(block.align);
   if(['text','heading','quote'].includes(block.type)){
    if(block.type==='heading'){if(![2,3].includes(block.level))throw Error('小標題層級不正確。');attributes.header=block.level;}
    if(block.type==='quote')attributes.blockquote=true;
    line(String(block.text||''),block.runs,attributes);
   }else if(block.type==='list'){
    if(!Array.isArray(block.items)||!['bullet','ordered'].includes(block.style))throw Error('清單格式不正確。');
    for(let i=0;i<block.items.length;i++)line(String(block.items[i]),block.item_runs?.[i],{...attributes,list:block.style});
   }else if(block.type==='image'){
    if(typeof block.media_id!=='string'||!block.media_id)throw Error('圖片編號不正確。');
    const attrs={};if(width(block.width)!=='auto')attrs.imageWidth=String(width(block.width));if(imageAlign(block.align)!=='left')attrs.imageAlign=imageAlign(block.align);
    insert({storyImage:{media_id:block.media_id,caption:String(block.caption||'')}},attrs);
   }else if(block.type==='video'){
    let url;try{if(typeof block.url!=='string'||block.url.length>2000||/[\u0000-\u001f\u007f]/.test(block.url))throw Error();url=new URL(block.url);}catch{throw Error('影片連結格式不正確。');}if(url.protocol!=='https:'||url.username||url.password)throw Error('影片連結須為 HTTPS。');
    insert({storyVideo:url.href});
   }else throw Error('這篇文章含有目前不支援的內容，請勿直接覆蓋儲存。');
  }
  if(!ops.length||typeof ops.at(-1).insert!=='string'||!ops.at(-1).insert.endsWith('\n'))insert('\n');
  return ops;
 }
 function deltaOpsToBlocks(input){
  const ops=Array.isArray(input)?input:input?.ops;if(!Array.isArray(ops))throw Error('編輯器正文格式不正確。');
  const blocks=[];let runs=[];let endedWithMedia=false;
  function flush(attributes={},isLast=false){
   const text=runs.map(r=>r.text).join(''),alignment=align(attributes.align),extra=alignment==='left'?{}:{align:alignment};
   if(isLast&&!text&&endedWithMedia){runs=[];return;}
   if(attributes.list){
    if(!['bullet','ordered'].includes(attributes.list))throw Error('清單格式不支援。');
    const previous=blocks.at(-1),block=previous?.type==='list'&&previous.style===attributes.list&&align(previous.align)===alignment?previous:{type:'list',style:attributes.list,items:[],...extra};
    if(block!==previous)blocks.push(block);block.items.push(text);
    if(rich(runs)||block.item_runs){if(!block.item_runs)block.item_runs=block.items.slice(0,-1).map(value=>[{text:value}]);block.item_runs.push(runs.length?runs.map(r=>({...r})):[{text:''}]);}
   }else{
    const type=attributes.header?'heading':attributes.blockquote?'quote':'text';
    if(attributes.header&&![2,3].includes(Number(attributes.header)))throw Error('小標題層級不支援。');
    const previous=blocks.at(-1),merge=['text','quote'].includes(type)&&previous?.type===type&&align(previous.align)===alignment&&previous.text.length+1+text.length<=(type==='quote'?20000:50000);
    if(merge){const oldText=previous.text,oldRuns=previous.runs||[{text:oldText}];previous.text+='\n'+text;if(rich(runs)||previous.runs){const merged=[];for(const run of oldRuns)appendRun(merged,run.text,run);appendRun(merged,'\n');for(const run of runs)appendRun(merged,run.text,run);previous.runs=merged;}}
    else{const block={type,text,...extra};if(type==='heading')block.level=Number(attributes.header);if(rich(runs))block.runs=runs.map(r=>({...r}));blocks.push(block);}
   }
   runs=[];endedWithMedia=false;
  }
  for(let oi=0;oi<ops.length;oi++){
   const op=ops[oi];if(!op||!Object.hasOwn(op,'insert'))throw Error('正文含不支援的操作。');
   if(typeof op.insert==='string'){
    let from=0;for(let i=0;i<op.insert.length;i++)if(op.insert[i]==='\n'){appendRun(runs,op.insert.slice(from,i),op.attributes);flush(op.attributes||{},oi===ops.length-1&&i===op.insert.length-1);from=i+1;}appendRun(runs,op.insert.slice(from),op.attributes);
   }else if(op.insert&&typeof op.insert==='object'){
    if(runs.length)flush();
    if(op.insert.storyImage){const value=op.insert.storyImage;if(typeof value.media_id!=='string'||!value.media_id)throw Error('圖片必須先上傳至本系統。');const block={type:'image',media_id:value.media_id,caption:String(value.caption||'')};const size=width(op.attributes?.imageWidth??value.width),alignment=imageAlign(op.attributes?.imageAlign??value.align);if(size!=='auto')block.width=size;if(alignment!=='left')block.align=alignment;blocks.push(block);}
    else if(op.insert.storyVideo){let url;try{if(typeof op.insert.storyVideo!=='string'||op.insert.storyVideo.length>2000||/[\u0000-\u001f\u007f]/.test(op.insert.storyVideo))throw Error();url=new URL(op.insert.storyVideo);}catch{throw Error('影片連結格式不正確。');}if(url.protocol!=='https:'||url.username||url.password)throw Error('影片連結須為 HTTPS。');blocks.push({type:'video',url:url.href});}
    else throw Error('請使用編輯器的插入圖片或影片工具，不可直接貼入外部媒體。');
    endedWithMedia=true;
   }else throw Error('正文格式不正確。');
  }
  if(runs.length)flush();
  return blocks.length?blocks:[{type:'text',text:''}];
 }
 return {blocksToDeltaOps,deltaOpsToBlocks};
}
export function blocksToDeltaOps(blocks){return articleConversionTools().blocksToDeltaOps(blocks);}
export function deltaOpsToBlocks(ops){return articleConversionTools().deltaOpsToBlocks(ops);}

export function articleEditorFactory(tools,parseYouTube=youtubeVideoId){
 const allowedLink=value=>{if(typeof value!=='string'||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))return '';try{const url=new URL(value);return ['http:','https:','mailto:','tel:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
 return function createArticleRichEditor(options){
  const Quill=window.Quill;if(!Quill)throw Error('文章編輯器無法載入，請重新整理。');
  const BlockEmbed=Quill.import('blots/block/embed'),Delta=Quill.import('delta');
  class StoryImage extends BlockEmbed{
   static blotName='storyImage';static tagName='FIGURE';static className='article-media-image';
   static create(value){const node=super.create();node.contentEditable='false';node.dataset.mediaId=String(value.media_id||'');node.dataset.caption=String(value.caption||'');node.dataset.width='auto';node.dataset.align='left';const img=document.createElement('img');img.alt=String(value.caption||'文章圖片');img.draggable=false;const caption=document.createElement('figcaption');caption.textContent=String(value.caption||'');caption.hidden=!value.caption;node.append(img,caption);return node;}
   static value(node){return {media_id:node.dataset.mediaId,caption:node.dataset.caption||''};}
   static formats(node){const formats={};if([25,50,75,100].includes(Number(node.dataset.width)))formats.imageWidth=node.dataset.width;if(['left','center','right'].includes(node.dataset.align)&&node.dataset.align!=='left')formats.imageAlign=node.dataset.align;return formats;}
   format(name,value){if(name==='imageWidth'){const width=[25,50,75,100].includes(Number(value))?String(value):'auto';this.domNode.dataset.width=width;this.domNode.style.width=width==='auto'?'fit-content':width+'%';return;}if(name==='imageAlign'){const align=['left','center','right'].includes(value)?value:'left';this.domNode.dataset.align=align;this.domNode.style.textAlign=align;this.domNode.style.marginLeft=align==='left'?'0':'auto';this.domNode.style.marginRight=align==='right'?'0':'auto';return;}super.format(name,value);}
  }
  class StoryVideo extends BlockEmbed{
   static blotName='storyVideo';static tagName='DIV';static className='article-media-video';
   static create(value){const node=super.create();node.contentEditable='false';node.dataset.url=String(value);const id=parseYouTube(String(value));if(id){const frame=document.createElement('iframe');frame.src='https://www.youtube.com/embed/'+id;frame.title='YouTube 影片';frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';frame.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');frame.setAttribute('allowfullscreen','');node.append(frame);}const text=document.createElement('a');text.textContent='在 YouTube 開啟影片';text.href=id?'https://www.youtube.com/watch?v='+id:String(value);if(!id)text.textContent='開啟原影片';text.target='_blank';text.rel='noopener noreferrer';node.append(text);return node;}
   static value(node){return node.dataset.url||'';}
  }
  Quill.register(StoryImage,true);Quill.register(StoryVideo,true);
  const toolbar=options.toolbar,container=options.container;let fault='';const fail=message=>{fault=message;options.onError?.(message);};
  const quill=new Quill(container,{theme:'snow',placeholder:'開始撰寫文章…',formats:['bold','italic','underline','strike','header','list','blockquote','align','link','storyImage','storyVideo'],modules:{toolbar:{container:toolbar,handlers:{link(value){if(!value){quill.format('link',false,'user');return;}const url=prompt('輸入連結網址（https://、mailto: 或 tel:）');if(url===null)return;const href=allowedLink(url);if(!href){fail('連結格式不正確。');return;}quill.format('link',href,'user');},image(){remember();options.onImageRequest?.();},video(){remember();const url=prompt('請輸入 YouTube 影片網址');if(url===null)return;if(!parseYouTube(url)){options.onError?.('請輸入有效的 YouTube 影片網址。',{blocking:false});return;}try{insertVideo(url);}catch(error){fail(error.message||'影片插入失敗，請重試。');}}}},history:{delay:700,maxStack:100,userOnly:true}}});
  quill.root.setAttribute('role','textbox');quill.root.setAttribute('aria-label','文章正文編輯器');quill.root.setAttribute('aria-multiline','true');
  quill.clipboard.addMatcher('IMG',()=>{fail('請使用插入圖片工具上傳圖片，外部圖片未加入。');return new Delta();});
  quill.clipboard.addMatcher('IFRAME',()=>{fail('請使用插入影片連結工具。');return new Delta();});
  let loading=false,loadFailed=false,range={index:0,length:0},selectedImage=null,destroyed=false,mediaGeneration=0;
  const properties=toolbar.parentElement.querySelector('[data-image-properties]'),sizeInput=properties?.querySelector('[data-image-size]'),alignInput=properties?.querySelector('[data-image-align]'),captionInput=properties?.querySelector('[data-image-caption]');
  function remember(){const next=quill.getSelection();if(next)range={index:next.index,length:next.length};}
  function selectedIndex(){if(!selectedImage||!selectedImage.isConnected)return -1;const blot=Quill.find(selectedImage);return blot?quill.getIndex(blot):-1;}
  function clearImageSelection(){selectedImage?.classList.remove('article-image-selected');selectedImage=null;if(properties)properties.hidden=true;}
  function onEditorClick(event){const image=event.target.closest('.article-media-image');clearImageSelection();if(!image||!quill.root.contains(image))return;selectedImage=image;image.classList.add('article-image-selected');if(properties)properties.hidden=false;if(sizeInput)sizeInput.value=image.dataset.width||'auto';if(alignInput)alignInput.value=image.dataset.align||'left';if(captionInput)captionInput.value=image.dataset.caption||'';}
  function hydrate(){const generation=++mediaGeneration;for(const figure of quill.root.querySelectorAll('.article-media-image')){const id=figure.dataset.mediaId,img=figure.querySelector('img');if(!id||!img)continue;Promise.resolve(options.resolveImage?.(id)).then(url=>{if(!destroyed&&generation===mediaGeneration&&figure.isConnected&&url)img.src=url;}).catch(()=>{if(figure.isConnected){img.alt='圖片暫時無法載入';options.onError?.('部分圖片暫時無法載入，原始圖片編號仍保留。',{blocking:false});}});}}
  function emit(){if(loading||destroyed||loadFailed)return;try{const next=tools.deltaOpsToBlocks(quill.getContents().ops);fault='';options.onChange?.(next);hydrate();}catch(error){fail(error.message);}}
  quill.on('text-change',emit);quill.on('selection-change',next=>{if(next)range={index:next.index,length:next.length};});quill.root.addEventListener('click',onEditorClick);quill.root.addEventListener('paste',onPaste,true);
  function onPaste(event){const html=event.clipboardData?.getData('text/html');if(!html)return;const pasted=new DOMParser().parseFromString(html,'text/html');if(pasted.querySelector('img,iframe,object,embed,script,svg')||[...pasted.querySelectorAll('a[href]')].some(a=>!allowedLink(a.getAttribute('href')))){event.preventDefault();event.stopImmediatePropagation();fail('貼上內容含外部媒體或不安全連結，請移除後再貼上；圖片請使用上傳工具。');}}
  const undo=toolbar.querySelector('[data-editor-undo]'),redo=toolbar.querySelector('[data-editor-redo]');if(undo)undo.onclick=()=>quill.history.undo();if(redo)redo.onclick=()=>quill.history.redo();
  if(sizeInput)sizeInput.onchange=()=>{const index=selectedIndex();if(index>=0)quill.formatText(index,1,'imageWidth',sizeInput.value,'user');};
  if(alignInput)alignInput.onchange=()=>{const index=selectedIndex();if(index>=0)quill.formatText(index,1,'imageAlign',alignInput.value,'user');};
  if(captionInput)captionInput.onchange=()=>{const index=selectedIndex();if(index<0)return;const value=StoryImage.value(selectedImage),attributes=StoryImage.formats(selectedImage);value.caption=captionInput.value;quill.history.cutoff();quill.updateContents(new Delta().retain(index).delete(1).insert({storyImage:value},attributes),'user');hydrate();clearImageSelection();quill.history.cutoff();};
  function setBlocks(blocks){const previous=range;fault='';loadFailed=false;loading=true;try{clearImageSelection();quill.setContents(tools.blocksToDeltaOps(blocks),'silent');quill.history.clear();range={index:Math.min(previous.index,Math.max(0,quill.getLength()-1)),length:0};hydrate();}catch(error){fault=error.message;loadFailed=true;quill.disable();throw error;}finally{loading=false;}}
  function insertImage(value){if(loadFailed||destroyed)throw Error(fault||'文章編輯器目前無法插入圖片，請重新載入。');const wasEnabled=quill.isEnabled();try{if(!wasEnabled)quill.enable(true);const index=Math.min(range.index,Math.max(0,quill.getLength()-1));quill.history.cutoff();const attributes={};if([25,50,75,100].includes(Number(value.width)))attributes.imageWidth=String(value.width);if(['center','right'].includes(value.align))attributes.imageAlign=value.align;const change=new Delta().retain(index);if(range.length)change.delete(range.length);change.insert({storyImage:{media_id:value.media_id,caption:value.caption||''}},attributes);quill.updateContents(change,'user');range={index:index+1,length:0};quill.setSelection(range.index,0,'silent');hydrate();quill.history.cutoff();}finally{if(!wasEnabled)quill.enable(false);}}
  function insertVideo(url){const id=parseYouTube(url);if(!id)throw Error('請輸入有效的 YouTube 影片網址。');const index=Math.min(range.index,Math.max(0,quill.getLength()-1));quill.history.cutoff();if(range.length)quill.deleteText(index,range.length,'user');quill.insertEmbed(index,'storyVideo','https://www.youtube.com/watch?v='+id,'user');range={index:index+1,length:0};quill.setSelection(range.index,0,'silent');quill.history.cutoff();}
  return {getBlocks(){quill.update('user');if(fault)throw Error(fault);return tools.deltaOpsToBlocks(quill.getContents().ops);},setBlocks,insertImage,insertVideo,focus(){quill.focus();quill.setSelection(Math.min(range.index,Math.max(0,quill.getLength()-1)),range.length,'silent');},enable(value=true){quill.enable(value&&!loadFailed);},destroy(){destroyed=true;mediaGeneration++;quill.off('text-change',emit);quill.root.removeEventListener('click',onEditorClick);quill.root.removeEventListener('paste',onPaste,true);quill.disable();container.replaceChildren();clearImageSelection();},rememberSelection:remember};
 };
}

export function articleEditorHtml(){return `<section id="article-rich-editor" hidden><div id="article-rich-toolbar" aria-label="文章排版工具列"><span class="ql-formats"><button type="button" data-editor-undo aria-label="復原">↶</button><button type="button" data-editor-redo aria-label="重做">↷</button></span><span class="ql-formats"><select class="ql-header" aria-label="段落樣式"><option selected value="">正文</option><option value="2">標題</option><option value="3">副標題</option></select></span><span class="ql-formats"><button type="button" class="ql-bold" aria-label="粗體"></button><button type="button" class="ql-italic" aria-label="斜體"></button><button type="button" class="ql-underline" aria-label="底線"></button><button type="button" class="ql-strike" aria-label="刪除線"></button></span><span class="ql-formats"><button type="button" class="ql-list" value="ordered" aria-label="編號清單"></button><button type="button" class="ql-list" value="bullet" aria-label="項目清單"></button><button type="button" class="ql-blockquote" aria-label="引用"></button><select class="ql-align" aria-label="文字對齊"><option selected value="">靠左</option><option value="center">置中</option><option value="right">靠右</option><option value="justify">左右對齊</option></select></span><span class="ql-formats"><button type="button" class="ql-link" aria-label="插入連結"></button><button type="button" class="ql-image" aria-label="插入圖片"></button><button type="button" class="ql-video" aria-label="插入影片連結"></button><button type="button" class="ql-clean" aria-label="清除格式"></button></span></div><div class="article-image-properties" data-image-properties hidden><strong>圖片設定</strong><label>大小<select data-image-size aria-label="圖片大小"><option value="auto">原始大小</option><option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option></select></label><label>對齊<select data-image-align aria-label="圖片對齊"><option value="left">靠左</option><option value="center">置中</option><option value="right">靠右</option></select></label><label>圖片說明<input data-image-caption aria-label="圖片說明" maxlength="500"></label></div><div id="article-rich-canvas"></div><p class="hint">直接在文章內輸入與排版；點選圖片可調整大小、對齊與說明。</p></section>`;}
export function articleEditorAssets(){
 const safeScript=QUILL_JS.replace(/<\/script/gi,'<\\/script').replace(/\/\/# sourceMappingURL=.*$/m,'');
 return `<style data-article-editor-style>${QUILL_CSS}\n#article-rich-editor{margin:12px 0}#article-rich-toolbar{position:sticky;top:0;background:#fff;z-index:5;border-radius:8px 8px 0 0;display:flex;align-items:center;flex-wrap:wrap;gap:3px}#article-rich-toolbar .ql-formats{display:inline-flex;align-items:center;margin:2px 6px 2px 0}#article-rich-toolbar button{padding:5px;min-width:32px;min-height:32px;height:32px;border:0;border-radius:3px}#article-rich-toolbar button.ql-active{background:#edf4ff}#article-rich-toolbar .ql-picker{min-height:32px}#article-rich-toolbar select{min-height:32px;padding:4px}.article-mode #article-rich-canvas{font-size:17px;line-height:1.8;border-radius:0 0 8px 8px;min-height:420px;background:#fff}.article-mode #article-rich-canvas .ql-editor{min-height:420px;line-height:1.85;padding:22px 24px;overflow-wrap:anywhere}.article-mode #article-rich-canvas .ql-editor p{margin:.65em 0}.article-mode #article-rich-canvas .ql-editor figure{max-width:100%;margin:18px 0}.article-mode #article-rich-canvas .ql-editor figure img{display:block;width:100%;height:auto;max-height:none}.article-mode #article-rich-canvas .ql-editor figure[data-width="auto"]{width:fit-content}.article-mode #article-rich-canvas .ql-editor figure[data-width="auto"] img{width:auto;max-width:100%}.article-mode #article-rich-canvas .ql-editor figcaption{font-size:14px;color:#526475;white-space:pre-wrap}.article-mode #article-rich-canvas .ql-editor .article-image-selected{outline:2px solid #1661ab;outline-offset:3px}.article-media-video{border-left:3px solid #cbd5e1;padding:12px;overflow-wrap:anywhere;background:#f8fafc}.article-media-video iframe{display:block;width:100%;max-width:800px;aspect-ratio:16/9;min-width:200px;min-height:200px;border:0}.article-media-video a{display:inline-block;margin-top:8px}.article-image-properties{display:flex;flex-wrap:wrap;align-items:end;gap:10px;background:#f1f6fd;border:1px solid #cad5e2;padding:10px}.article-image-properties[hidden]{display:none}.article-image-properties label{font-size:13px;gap:4px}.article-image-properties input,.article-image-properties select{min-height:34px;padding:5px 8px}.article-image-properties strong{align-self:center}@media(max-width:700px){#article-rich-toolbar{position:static}.article-mode #article-rich-canvas .ql-editor{padding:14px;min-height:360px}#article-rich-toolbar .ql-formats{margin-right:2px}}</style><script data-article-vendor data-version="${QUILL_VERSION}">${safeScript}</script><script data-article-editor>(()=>{const __name=fn=>fn;const tools=(${articleConversionTools.toString()})();const parseYouTube=(${youtubeVideoId.toString()});window.createArticleRichEditor=(${articleEditorFactory.toString()})(tools,parseYouTube);})();</script>`;
}
