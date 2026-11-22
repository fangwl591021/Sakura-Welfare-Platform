import { readFileSync } from 'node:fs';
import { coverFixture } from './activity-cover.test.mjs';
import { handleClubRequest } from '../src/club-service.js';
export function clubFixture() {
  const f=coverFixture();f.sqlite.exec(readFileSync(new URL('../migrations/0034_clubs_and_highlights.sql',import.meta.url),'utf8'));
  f.env.OPENAI_API_KEY='synthetic-club-key';
  f.deps.callAi=async (_env,messages)=>({texts:JSON.parse(messages[1].content).texts.map(text=>'translated: '+text)});
  f.env.R2_BUCKET.delete=async key=>f.files.delete(key);
  const call=(path,body,token='',extra={})=>handleClubRequest(new Request('https://activity.test'+path,{method:body?'POST':'GET',headers:{Authorization:token?'Bearer '+token:'',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),f.env,f.deps);
  const save=(kind,data,revision=0,extra={})=>call('/admin-api/clubs',{kind,data,revision,request_id:crypto.randomUUID(),confirmed:true,...extra},'test-admin');
  const club=id=>{const r=f.sqlite.prepare('SELECT * FROM welfare_clubs WHERE id=?').get(id);return {...JSON.parse(r.content_json),id:r.id,revision:r.revision};};
  const upload=(club='club-yoga',requestId=crypto.randomUUID(),bytes=new Uint8Array([255,216,255,217]),token='test-admin')=>{const body=new FormData();body.set('file',new File([bytes],'photo.jpg',{type:'image/jpeg'}));return call('/admin-api/club-media?club_id='+club+'&request_id='+requestId,body,token);};
  return {...f,call,save,club,upload,close:()=>f.sqlite.close()};
}
