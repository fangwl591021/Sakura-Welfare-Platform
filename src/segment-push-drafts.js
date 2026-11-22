import {SegmentPushError} from './segment-audience.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UID=/^U[0-9a-f]{32}$/i;
const fail=(message,status=400)=>{throw new SegmentPushError(message,status);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const bytes=value=>new TextEncoder().encode(value).length;
const contentLimits={messageMode:40,messageText:5000,imageOriginalUrl:2000,imagePreviewUrl:2000,messageOrder:20,templateSelect:200,altText:400,customJson:30000,jsonAltText:400,flexCardTitle:100,flexCardBody:1000,flexCardButton:20,flexCardUrl:1000,deliveryMode:10,scheduledAt:16};
const filterLimits={keyword:500,tagMode:40,memberType:40,bindStatus:40,factory:300,businessUnit:300,department:500};
const modes=new Set(['official_text','official_composite','official_image','system_card','system_template','system_json']);
function checkKeys(value,allowed){for(const key of Object.keys(value))if(!allowed.includes(key))fail('草稿欄位不正確。');}
function actorOf(deps){const actor=deps?.actor;if(typeof actor!=='string'||!actor||actor.length>300)fail('無權限操作草稿。',403);return actor;}
function idOf(value){if(typeof value!=='string'||!UUID.test(value))fail('草稿編號不正確。');return value;}
function revOf(value){if(!Number.isSafeInteger(value)||value<1)fail('草稿版本不正確，請重新載入。');return value;}
function fieldsOf(body){
  const title=typeof body.title==='string'?body.title.trim():'';
  if(title.length>200)fail('草稿名稱不可超過 200 字。');
  const filters=body.filters??{},content=body.content??{},selected=body.selectedLineUserIds??[];
  if(!object(filters)||!object(content)||!Array.isArray(selected)||selected.length>500||selected.some(uid=>typeof uid!=='string'||!UID.test(uid)))fail('草稿內容或受眾格式不正確。');
  checkKeys(filters,[...Object.keys(filterLimits),'tags','factories','maxRecipients']);checkKeys(content,Object.keys(contentLimits));
  for(const [key,value] of Object.entries(filters)){
    if(key==='tags'){if(!Array.isArray(value)||value.length>100||value.some(tag=>typeof tag!=='string'||tag.length>200))fail('草稿標籤格式不正確。');}
    else if(key==='factories'){if(!Array.isArray(value)||value.length>100||value.some(factory=>typeof factory!=='string'||!factory.trim()||factory.length>300))fail('草稿廠別格式不正確。');}
    else if(key==='maxRecipients'){if(!(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=500 || typeof value==='string'&&value.length<=3&&/^\d*$/.test(value)))fail('草稿人數上限格式不正確。');}
    else if(typeof value!=='string'||value.length>filterLimits[key])fail('草稿篩選條件不正確或過長。');
  }
  if(filters.factories!==undefined && typeof filters.factory==='string' && filters.factory.trim())fail('草稿廠別條件衝突。');
  for(const [key,value] of Object.entries(content)){
    if(typeof value!=='string'||value.length>contentLimits[key])fail('草稿內容不正確或過長。');
    if(key==='messageMode'&&!modes.has(value))fail('草稿訊息類型不正確。');
    if(key==='messageOrder'&&!['text_first','image_first'].includes(value))fail('草稿文字與圖片順序不正確。');
    if(key==='deliveryMode'&&!['immediate','scheduled'].includes(value))fail('草稿傳送方式不正確。');
    if(key==='scheduledAt'&&value){const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);if(!m)fail('草稿預約時間格式不正確。');const [year,month,day,hour,minute]=m.slice(1).map(Number),ms=Date.UTC(year,month-1,day,hour,minute),d=new Date(ms);if(year<1970||month<1||month>12||day<1||hour>23||minute>59||d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day||d.getUTCHours()!==hour||d.getUTCMinutes()!==minute)fail('草稿預約時間不正確。');}
    if((key==='imageOriginalUrl'||key==='imagePreviewUrl')&&/^(?:blob|data):/i.test(value.trim()))fail('草稿無法儲存本機圖片，請先上傳。');
  }
  const filtersJson=JSON.stringify(filters),contentJson=JSON.stringify(content),selectedJson=JSON.stringify([...new Set(selected)]);
  if(bytes(filtersJson)+bytes(contentJson)+bytes(selectedJson)>48000)fail('草稿內容過大。',413);
  return {title,filtersJson,contentJson,selectedJson};
}
const publicDraft=row=>({id:row.id,title:row.title,revision:row.revision,filters:JSON.parse(row.filters_json),content:JSON.parse(row.content_json),selectedLineUserIds:JSON.parse(row.selected_json),createdAt:row.created_at,updatedAt:row.updated_at});

// Caller MUST validate the paid-push admin principal and cross-site request before invoking.
// Drafts contain only editable input, never a delivery authorization or a preview snapshot.
export async function handleSegmentDraft(db,body,deps={}){
  const actor=actorOf(deps);if(!object(body))fail('草稿請求不正確。');
  const actionKeys={'draft.list':['action'],'draft.get':['action','id'],'draft.delete':['action','id','revision'],'draft.save':['action','id','revision','title','filters','content','selectedLineUserIds']};
  if(!actionKeys[body.action])fail('不支援的草稿操作。');checkKeys(body,actionKeys[body.action]);
  if(body.action==='draft.list'){
    const rows=await db.prepare('SELECT id,title,revision,created_at,updated_at FROM welfare_segment_push_drafts WHERE actor=? ORDER BY updated_at DESC,id DESC LIMIT 50').bind(actor).all();
    return {success:true,data:{drafts:(rows.results||[]).map(row=>({id:row.id,title:row.title,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at}))}};
  }
  if(body.action==='draft.get'){
    const row=await db.prepare('SELECT id,title,filters_json,content_json,selected_json,revision,created_at,updated_at FROM welfare_segment_push_drafts WHERE id=? AND actor=?').bind(idOf(body.id),actor).first();
    if(!row)fail('找不到草稿。',404);
    return {success:true,data:{draft:publicDraft(row),requiresAudienceReview:true}};
  }
  if(body.action==='draft.delete'){
    const id=idOf(body.id),revision=revOf(body.revision);
    const result=await db.prepare('DELETE FROM welfare_segment_push_drafts WHERE id=? AND actor=? AND revision=?').bind(id,actor,revision).run();
    if(!result.meta?.changes){const row=await db.prepare('SELECT revision FROM welfare_segment_push_drafts WHERE id=? AND actor=?').bind(id,actor).first();if(!row)fail('找不到草稿。',404);fail('草稿已變更，請重新載入。',409);}
    return {success:true,data:{id}};
  }
  if(body.action==='draft.save'){
    const f=fieldsOf(body),now=typeof deps.now==='function'?deps.now():Date.now();
    if(!Number.isSafeInteger(now)||now<0)fail('無法儲存草稿。',503);
    if(body.id===undefined||body.id===null||body.id===''){
      if(body.revision!==undefined&&body.revision!==null)fail('新增草稿不需版本編號。');
      const id=crypto.randomUUID();
      const result=await db.prepare(`INSERT INTO welfare_segment_push_drafts(id,actor,title,filters_json,content_json,selected_json,revision,created_at,updated_at)
        SELECT ?,?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM welfare_segment_push_drafts WHERE actor=?)<50`).bind(id,actor,f.title,f.filtersJson,f.contentJson,f.selectedJson,now,now,actor).run();
      if(!result.meta?.changes)fail('草稿已達 50 筆上限，請先刪除不需要的草稿。',409);
      return {success:true,data:{id,revision:1,createdAt:now,updatedAt:now}};
    }
    const id=idOf(body.id),revision=revOf(body.revision);
    const result=await db.prepare('UPDATE welfare_segment_push_drafts SET title=?,filters_json=?,content_json=?,selected_json=?,revision=revision+1,updated_at=? WHERE id=? AND actor=? AND revision=?').bind(f.title,f.filtersJson,f.contentJson,f.selectedJson,now,id,actor,revision).run();
    if(!result.meta?.changes){const row=await db.prepare('SELECT revision FROM welfare_segment_push_drafts WHERE id=? AND actor=?').bind(id,actor).first();if(!row)fail('找不到草稿。',404);fail('草稿已變更，請重新載入。',409);}
    return {success:true,data:{id,revision:revision+1,updatedAt:now}};
  }
  fail('不支援的草稿操作。');
}
