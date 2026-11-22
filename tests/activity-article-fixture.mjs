import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleActivityStoryRequest} from '../src/activity-stories-service.js';

// This fixture has no network transport and only an in-memory SQLite database.
export function articleFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE welfare_clubs(id TEXT PRIMARY KEY,content_json TEXT);
    CREATE TABLE welfare_club_galleries(id TEXT PRIMARY KEY,club_id TEXT,content_json TEXT,updated_at TEXT);
    CREATE TABLE welfare_activity_events(id TEXT PRIMARY KEY,audience_scope TEXT);
    CREATE TABLE welfare_activity_club_links(id TEXT PRIMARY KEY,club_id TEXT);
    CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,member_type TEXT,status TEXT,bind_status TEXT);
    CREATE TABLE admin_uid_whitelist(line_user_id TEXT,display_name TEXT,role TEXT,active INTEGER);`);
  sqlite.exec(readFileSync(new URL('../migrations/0036_activity_stories.sql',import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO welfare_clubs VALUES(?,?)').run('club-a',JSON.stringify({title:'測試社團',status:'active',published:true}));
  const member='U'+'4'.repeat(32);
  sqlite.prepare('INSERT INTO welfare_members VALUES(?,?,?,?)').run(member,'employee','active','bound');
  const queries=[];
  const db={prepare(sql){
    const prepare=(...args)=>({
      async first(){queries.push(sql);return sqlite.prepare(sql).get(...args)||null},
      async all(){queries.push(sql);return {results:sqlite.prepare(sql).all(...args)}},
      async run(){queries.push(sql);return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}
    });return {...prepare(),bind:prepare};
  }};
  db.batch=async statements=>{sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result}catch(error){sqlite.exec('ROLLBACK');throw error}};
  const files=new Map(),aiCalls=[],requests=[];
  const env={DB:db,OPENAI_API_KEY:'synthetic-only',R2_BUCKET:{async put(key,value){files.set(key,value)},async get(key){return files.has(key)?{body:files.get(key)}:null},async delete(key){files.delete(key)}}};
  const deps={
    requireAdmin:async({sessionToken})=>sessionToken==='synthetic-admin'?{ok:true,user:{id:'1',role:'admin'}}:{ok:false},
    findAdmin:async()=>null,
    verifyLine:async(_env,token)=>token==='synthetic-employee'?{lineUserId:member}:null,
    callAi:async(_env,messages,options)=>{const values=JSON.parse(messages[1].content).texts;aiCalls.push({values,options});return {texts:values.map(value=>value?'譯 '+value:'')}}
  };
  async function fetchLocal(path,options={}) {
    const url=new URL(path,'https://fixture.test');
    if(url.origin!=='https://fixture.test')throw Error('External transport is forbidden in this fixture');
    const request=new Request(url,options);requests.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:request.method});
    const response=await handleActivityStoryRequest(request,env,deps);
    return response||new Response('Not found',{status:404});
  }
  const story=(id='article-1',type='article')=>({id,unit_id:'welfare_committee',type,title:'長文測試',summary:'列表用摘要',event_date:'',cover_media_id:'',visibility:'all',status:'draft',blocks:[],gallery_id:'',album_media_ids:[]});
  const post=(content,revision=0,requestId=crypto.randomUUID())=>fetchLocal('/admin-api/activity-stories',{method:'POST',headers:{Authorization:'Bearer synthetic-admin','Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,revision,confirmed:true,story:content})});
  function seedPhoto(id='photo-1',unit='welfare_committee',options={}) {
    const bytes=options.bytes||new Uint8Array([255,216,255,217]);
    sqlite.prepare('INSERT INTO welfare_activity_story_media(id,unit_id,object_key,mime_type,original_name,file_size,actor,request_id) VALUES(?,?,?,?,?,?,?,?)').run(id,unit,'synthetic/'+id,options.mime||'image/jpeg',options.name||'synthetic.jpg',bytes.length,'admin:1','seed-'+id);
    files.set('synthetic/'+id,bytes);return id;
  }
  return {sqlite,env,deps,requests,queries,aiCalls,fetch:fetchLocal,story,post,seedPhoto,close(){sqlite.close()}};
}
