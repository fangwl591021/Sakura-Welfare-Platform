// Render the typed inline subset shared by article preview and public reading.
// Stored content is never assigned to innerHTML.
export function appendArticleRichText(parent,text,runs){
 const source=typeof text==='string'?text:'';
 const values=Array.isArray(runs)&&runs.every(r=>r&&typeof r.text==='string')&&runs.map(r=>r.text).join('')===source?runs:[{text:source}];
 for(const run of values){
  let element=document.createElement('span');element.textContent=run.text;
  for(const [key,tag] of [['bold','strong'],['italic','em'],['underline','u'],['strike','s']])if(run[key]===true){const wrapper=document.createElement(tag);wrapper.append(element);element=wrapper;}
  if(typeof run.link==='string'){
   try{const url=new URL(run.link);if(['https:','http:','mailto:','tel:'].includes(url.protocol)&&!url.username&&!url.password&&!/[\u0000-\u001f\u007f]/.test(run.link)){const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.className='article-inline-link';link.append(element);element=link;}}catch{}
  }
  parent.append(element);
 }
 return parent;
}
