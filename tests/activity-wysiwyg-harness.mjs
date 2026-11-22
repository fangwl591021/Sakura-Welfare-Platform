import {inlineHarness} from './activity-article-mock-dom.mjs';

// This is an adapter double, not Quill or a browser. The real converter is tested
// separately and root performs actual editor/toolbar acceptance through CUA.
const clone=value=>JSON.parse(JSON.stringify(value));
export async function wysiwygHarness(html,options={}) {
  const safe=html.replace(/<script\b[^>]*\bdata-article-(?:vendor|editor)\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const instances=[];
  const h=await inlineHarness(safe,{...options,configureSandbox(sandbox,document){
    options.configureSandbox?.(sandbox,document);
    sandbox.createArticleRichEditor=configuration=>{
      let value=[],destroyed=false,enabled=true;
      const content=document.createElement('div');content.className='ql-editor';content.setAttribute('role','textbox');content.setAttribute('aria-label','文章正文');
      configuration.container.append(content);
      const editor={
        content,
        get destroyed(){return destroyed},get enabled(){return enabled},
        getBlocks(){return clone(value)},
        setBlocks(next){value=clone(next);content.textContent=value.map(b=>b.text??b.items?.join('\n')??'').join('\n')},
        inputBlocks(next){this.setBlocks(next);configuration.onChange?.(this.getBlocks())},
        appendBlock(block){this.inputBlocks([...value,clone(block)])},
        moveBlock(from,to){const next=clone(value);next.splice(to,0,next.splice(from,1)[0]);this.inputBlocks(next)},
        blockProxy(type,index=0){return {get value(){const block=value.filter(b=>b.type===type)[index];return type==='list'?block?.items?.join('\n')||'':block?.text||''},async input(text){const next=clone(value),at=next.map((block,i)=>[block,i]).filter(([block])=>block.type===type)[index]?.[1];if(at===undefined)throw Error('Missing synthetic block');if(type==='list'){next[at].items=text.split('\n');delete next[at].item_runs;}else{next[at].text=text;delete next[at].runs;}editor.inputBlocks(next)}}},
        insertImage(image){this.inputBlocks([...value,{type:'image',...clone(image)}])},
        insertVideo(url){this.inputBlocks([...value,{type:'video',url}])},
        focus(){content.focus()},
        rememberSelection(){},
        destroy(){destroyed=true;content.remove()},
        enable(next=true){enabled=next},
        body:{get value(){return value.find(b=>b.type==='text')?.text||''},async input(text){const next=clone(value),index=next.findIndex(b=>b.type==='text');if(index<0)next.unshift({type:'text',text});else{next[index].text=text;delete next[index].runs;}editor.inputBlocks(next)}},
      };
      instances.push(editor);return editor;
    };
  }});
  h.richEditor=()=>instances.findLast(editor=>!editor.destroyed)||null;
  h.richEditors=instances;
  return h;
}
