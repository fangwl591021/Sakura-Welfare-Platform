import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { welfareShopHtml, welfareShopAdminHtml, welfareShopSettingsHtml } from '../src/welfare-shop-ui.js';

test('mall pages have complete browser scripts and expose the expected entry actions', () => {
  for (const html of [welfareShopHtml,welfareShopAdminHtml,welfareShopSettingsHtml]) {
    const [, script] = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0];
    new vm.Script(script.replaceAll('__SAKURA_LIFF_ID__','synthetic'));
  }
  assert.match(welfareShopHtml,/返回／關閉/);
  assert.match(welfareShopAdminHtml,/確認匯入草稿/);
});

test('welfare shop protects employee media and reserves stock through the real Worker and D1', {timeout:60000}, async t => {
  const require = createRequire(process.env.WELFARE_DEPENDENCIES || import.meta.url);
  const {build}=require('esbuild'),{Miniflare}=require('miniflare');
  const first='U'+'1'.repeat(32),second='U'+'2'.repeat(32),visitor='U'+'3'.repeat(32);
  const entry=String.raw`
    import {handleWelfareShop} from './src/welfare-shop.js';
    import {handleVendorBenefitAccess} from './src/vendor-benefit-access.js';
    import {flushWelfareShopTelegram} from './src/welfare-shop-telegram.js';
    import {flushWelfareShopDirectorEmail} from './src/welfare-shop-director-email.js';
    import {resolveAdminPrincipal} from './src/editor-access.js';
    const messages=[], emails=[], tasks=new Set();
    const sendMail=async(url,options)=>{
      const mail=JSON.parse(options.body);
      emails.push({url,key:options.headers['Idempotency-Key'],...mail});
      if(mail.to[0]==='timeout@example.test')throw Error('Synthetic response timeout');
      return Response.json({id:'fixture-email'});
    };
    const send=async lines=>{
      const id=lines.find(line=>line.startsWith('申請編號')).split('｜')[1];
      const attempts=messages.filter(message=>message.includes(id)).length;
      messages.push(lines.join('\n'));
      if(id.startsWith('00000000')&&attempts===0)return {ok:false,status:429,retryAfterSeconds:180};
      if(id.startsWith('11111111'))throw Error('Synthetic transport interruption');
      return {ok:true,status:200};
    };
    const flush=(db,id)=>flushWelfareShopTelegram(db,send,'https://isolated.test/welfare-shop-admin',id);
    const adminDeps={
      requireAdmin:async({sessionToken})=>sessionToken==='admin'?{ok:true,user:{role:'admin',id:'fixture'}}:null,
      verifyLine:async (_env,token)=>token==='line-admin'?{lineUserId:'fixture-admin'}:token==='line-editor'?{lineUserId:'fixture-editor'}:null,
      verifyLineAccess:async (_env,token)=>token==='access-admin'?{lineUserId:'fixture-admin'}:null,
      findAdmin:async (_db,uid)=>uid==='fixture-admin'?{role:'admin',active:1}:{role:'activity_editor',active:1}
    };
    export default {fetch(request,env,ctx){
      if(new URL(request.url).pathname==='/fixture/flush')return Promise.all([...tasks]).then(()=>flush(env.DB)).then(()=>Response.json(messages));
      if(new URL(request.url).pathname==='/fixture/mail')return flushWelfareShopDirectorEmail(env,undefined,sendMail).then(()=>Response.json(emails));
      return handleVendorBenefitAccess(request,env,{
        verifyLine:async(_env,token)=>({one:{lineUserId:'${first}'},two:{lineUserId:'${second}'},visitor:{lineUserId:'${visitor}'}}[token]),
        ensureBinding:async()=>{}
      },current=>handleWelfareShop(current,env,()=>resolveAdminPrincipal(current,env.DB,env,adminDeps),id=>{
          const task=flush(env.DB,id).finally(()=>tasks.delete(task));
          tasks.add(task);
          ctx.waitUntil(task);
        }));
    }};`;
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'esm'});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-08',
    d1Databases:['DB'],r2Buckets:['R2_BUCKET'],bindings:{LINE_CHANNEL_SECRET:'synthetic-shop-only',
      WELFARE_SHOP_EMAIL_FROM:'from@example.test',RESEND_API_KEY:'synthetic'}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE welfare_members(line_user_id TEXT PRIMARY KEY,member_type TEXT,status TEXT,bind_status TEXT,display_name TEXT)').run();
  for(const file of ['0049_employee_welfare_shop.sql','0050_welfare_shop_telegram.sql','0053_welfare_shop_contact_phone.sql','0054_welfare_shop_venues.sql']){
    for(const sql of readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
  }
  for(const [uid,type] of [[first,'employee'],[second,'employee'],[visitor,'visitor']]){
    await db.prepare("INSERT INTO welfare_members VALUES(?,?,'active','bound',?)").bind(uid,type,'測試人員').run();
  }
  const call=(path,{cookie='',admin=false,token,body,method=body?'POST':'GET',headers={}}={})=>mf.dispatchFetch('https://isolated.test'+path,{
    method,headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(admin?{Authorization:'Bearer admin'}:{}),...(token?{'X-Line-Id-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const login=async token=>{
    const r=await call('/api/vendor-benefits/session',{token,method:'POST'});
    assert.equal(r.status,200,await r.clone().text());
    return r.headers.get('Set-Cookie').split(';')[0];
  };
  const [one,two,guest]=await Promise.all(['one','two','visitor'].map(login));
  const api='/api/welfare-shop',admin='/admin-api/welfare-shop';
  const settings=admin+'/settings';
  assert.equal((await call(api)).status,401);
  assert.equal((await call(api,{cookie:guest})).status,403);
  assert.equal((await call(admin,{cookie:one})).status,403);
  assert.equal((await call(settings)).status,403);
  assert.equal((await call(settings,{token:'line-editor'})).status,403);
  assert.equal((await call(settings,{headers:{'X-Line-Access-Token':'access-admin','Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await call(settings,{headers:{'X-Line-Access-Token':'access-admin'}})).status,200);
  assert.equal((await call(admin,{headers:{'X-Line-Access-Token':'access-admin'}})).status,403);
  const item={source_key:'fixture:2',category:'廚電',series:'測試',name:'展示品',condition_note:'現品',price_cents:12345,photo:'/9j/2Q=='};
  const importBody={action:'import',products:[item]};
  assert.deepEqual(await (await call(admin,{admin:true,body:importBody})).json(),{imported:1,skipped:0});
  assert.deepEqual(await (await call(admin,{admin:true,body:importBody})).json(),{imported:0,skipped:1});
  const check=await call(admin,{admin:true});
  assert.equal(check.status,200,await check.clone().text());
  const [draft]=(await check.json()).products;
  assert.equal(draft.status,'draft');assert.equal(draft.stock,0);
  const photo=api+'/photo?id='+draft.id;
  assert.equal((await call(photo,{cookie:one})).status,404);
  assert.equal((await call(admin+'/photo?id='+draft.id,{admin:true})).status,200);
  const publish=await call(admin,{admin:true,body:{...draft,action:'save',status:'published',stock:1,pickup_note:'由福委會聯絡'}});
  assert.equal(publish.status,200,await publish.clone().text());
  const view=await call(api,{cookie:one});
  assert.equal(view.headers.get('Cache-Control'),'private, no-store');
  const [product]=(await view.json()).products;
  assert.equal(product.price_cents,12300); assert.equal(product.available,1);
  assert.equal((await call(photo,{cookie:one})).headers.get('Content-Type'),'image/jpeg');
  assert.equal((await call(photo,{cookie:guest})).status,403);
  assert.equal((await call(photo,{cookie:one,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const request=()=>({id:randomUUID(),product_id:draft.id,revision:product.revision,unit_price_cents:product.price_cents,quantity:1,contact:'private-fixture-contact',comment:'private-fixture-note'});
  const {unit_price_cents: unusedQuote,...oldForm}=request();
  assert.equal((await call(api,{cookie:one,body:oldForm})).status,409);
  assert.equal((await call(api,{cookie:one,body:{...request(),unit_price_cents:12345}})).status,409);
  const bodies=[request(),request()],cookies=[one,two];
  const send=(i, body=bodies[i])=>call(api,{cookie:cookies[i],body});
  const outcomes=await Promise.all([send(0),send(1)]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  const winner=outcomes.findIndex(r=>r.status===200),other=1-winner;
  const saved=(await outcomes[winner].json()).request;
  assert.equal(saved.price_cents,product.price_cents);
  const legacyRecord=(await (await call(admin,{admin:true})).json()).requests.find(r=>r.id===saved.id);
  assert.equal(legacyRecord.contact,'private-fixture-contact');
  assert.equal(legacyRecord.contact_phone,null);
  assert.equal(legacyRecord.email_status,null);
  assert.equal((await (await send(winner)).json()).request.id,saved.id);
  assert.equal((await send(winner,request())).status,409);
  assert.equal((await (await call(api,{cookie:cookies[other]})).json()).requests.length,0);
  const journal = id => db.prepare('SELECT status,attempts,provider_status,next_at,updated_at FROM welfare_shop_telegram WHERE request_id=?').bind(id).first();
  const flush = async () => (await call('/fixture/flush')).json();
  let messages = await flush();
  assert.equal(messages.length,1);
  assert.match(messages[0],/展示品/);
  assert.match(messages[0],/金額｜\$123\n/);
  assert.match(messages[0],/welfare-shop-admin/);
  assert.doesNotMatch(messages[0],/private-fixture-|U[12]{32}/);
  assert.equal((await journal(saved.id)).attempts,1);
  assert.equal((await journal(saved.id)).status,'sent');
  assert.equal(await journal(bodies[other].id),null);
  const stale=await call(admin,{admin:true,body:{...draft,action:'save',status:'hidden'}});
  assert.equal(stale.status,409);
  assert.equal((await call(admin,{admin:true,body:{action:'status',id:saved.id,previous:'pending',status:'cancelled'}})).status,200);
  const next=await send(other,{...request(),id:'11111111-1111-4111-8111-111111111111'});assert.equal(next.status,200);
  const nextId=(await next.json()).request.id;
  messages=await flush();
  assert.equal(messages.length,2);
  assert.equal((await journal(nextId)).status,'unknown');
  assert.equal((await flush()).length,2);
  for (const [previous,status] of [['pending','confirmed'],['confirmed','completed']]){
    assert.equal((await call(admin,{admin:true,body:{action:'status',id:nextId,previous,status}})).status,200);
  }
  assert.equal((await (await call(api,{cookie:one})).json()).products[0].available,0);
  const retryId='00000000-0000-4000-8000-000000000001';
  await db.prepare("INSERT INTO welfare_shop_requests(id,product_id,employee_uid,product_name,price_cents,quantity,contact,comment,status,created_at,updated_at) VALUES(?,?,?,?,12345,1,'','','cancelled','fixture','fixture')")
    .bind(retryId,draft.id,first,'隔離重試商品').run();
  await db.prepare('INSERT INTO welfare_shop_telegram(request_id,next_at,updated_at) VALUES(?,0,0)').bind(retryId).run();
  assert.equal((await flush()).length,3);
  const limited=await journal(retryId);
  assert.equal(limited.status,'pending');
  assert.equal(limited.provider_status,429);
  assert.ok(limited.next_at-limited.updated_at>=180000);
  assert.equal((await flush()).length,3);
  await db.prepare('UPDATE welfare_shop_telegram SET next_at=0 WHERE request_id=?').bind(retryId).run();
  assert.equal((await flush()).length,4);
  assert.equal((await journal(retryId)).status,'sent');
  assert.equal((await journal(retryId)).attempts,2);
  const productRow=()=>db.prepare('SELECT * FROM welfare_shop_products WHERE id=?').bind(draft.id).first();
  const savedRequest=()=>db.prepare('SELECT * FROM welfare_shop_requests WHERE id=?').bind(nextId).first();
  const beforeHide=await productRow(), orderBefore=await savedRequest();
  const hide={action:'product.hide',id:draft.id,revision:beforeHide.revision};
  assert.equal((await call(admin,{cookie:one,body:hide})).status,403);
  assert.equal((await call(admin,{admin:true,body:{...hide,revision:hide.revision-1}})).status,409);
  assert.deepEqual(await productRow(),beforeHide);
  const hidden=await call(admin,{admin:true,body:hide});
  assert.equal(hidden.status,200,await hidden.clone().text());
  assert.deepEqual(await hidden.json(),{id:draft.id,status:'hidden'});
  const afterHide=await productRow();
  assert.deepEqual(afterHide,{...beforeHide,status:'hidden',revision:beforeHide.revision+1,updated_at:afterHide.updated_at});
  assert.deepEqual(await savedRequest(),orderBefore);
  assert.equal((await call(admin,{admin:true,body:hide})).status,409);
  assert.equal((await call(admin,{admin:true,body:{...hide,revision:afterHide.revision}})).status,409);
  assert.equal((await (await call(api,{cookie:one})).json()).products.length,0);
  assert.equal((await call(photo,{cookie:one})).status,404);
  assert.equal((await call(admin+'/photo?id='+draft.id,{admin:true})).status,200);
  assert.equal((await flush()).length,4);
  const oldReplay=await call(api,{cookie:one,body:{...oldForm,id:retryId}});
  assert.equal(oldReplay.status,200,await oldReplay.clone().text());
  assert.equal((await oldReplay.json()).request.price_cents,12345);
  const taipeiData={action:'venue.save',name:'台北品牌館',director_name:'隔離台北館長',email:'taipei@example.test'};
  const taichungData={action:'venue.save',name:'台中品牌館',director_name:'隔離台中館長',email:'taichung@example.test'};
  const saveVenue=body=>call(settings,{token:'line-admin',body});
  const saveProduct=body=>call(admin,{admin:true,body});
  assert.equal((await call(settings,{cookie:one,body:taipeiData})).status,403);
  assert.equal((await call(settings,{token:'line-editor',body:taipeiData})).status,403);
  assert.equal((await saveVenue({...taipeiData,email:'a@example.test,b@example.test'})).status,400);
  const {id:taipei}=await (await saveVenue(taipeiData)).json();
  const {id:taichung}=await (await saveVenue(taichungData)).json();
  assert.equal((await saveVenue(taipeiData)).status,409);
  const mail=async()=>(await call('/fixture/mail')).json();
  assert.deepEqual(await mail(),[]);
  const half=await call(admin,{admin:true,body:{action:'save',category:'配件',name:'整元進位測試',
    condition_note:'現品',pickup_note:'現場',price_cents:2359650,stock:2,employee_limit:2,status:'published'}});
  assert.equal(half.status,200,await half.clone().text());
  const halfId=(await half.json()).id;
  const assignment={action:'venue.assign',venue_id:taipei,products:[{id:halfId,revision:1},{id:draft.id,revision:afterHide.revision}]};
  assert.equal((await call(settings,{cookie:one,body:assignment})).status,403);
  assert.equal((await saveVenue({...assignment,products:[assignment.products[0],{...assignment.products[1],revision:1}]})).status,409);
  assert.equal((await db.prepare('SELECT venue_id FROM welfare_shop_products WHERE id=?').bind(halfId).first()).venue_id,null);
  assert.deepEqual(await (await saveVenue(assignment)).json(),{assigned:2});
  const [halfProduct]=(await (await call(api,{cookie:one})).json()).products;
  assert.equal(halfProduct.id,halfId);
  assert.equal(Object.hasOwn(halfProduct,'venue_id'),false);
  assert.equal(halfProduct.price_cents,2359700);
  const phoneOrder={id:randomUUID(),product_id:halfProduct.id,revision:halfProduct.revision,
    unit_price_cents:halfProduct.price_cents,quantity:2};
  for(const invalid of ['', '1234', 'example@invalid.test', 200000000]){
    const response=await call(api,{cookie:one,body:{...phoneOrder,contact_phone:invalid}});
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/聯絡電話/);
  }
  assert.equal((await call(api,{cookie:one,body:phoneOrder})).status,400);
  assert.equal(await journal(phoneOrder.id),null);
  const halfOrder=await call(api,{cookie:one,body:{...phoneOrder,contact_phone:'０２-００００-００００'}});
  assert.equal(halfOrder.status,200,await halfOrder.clone().text());
  const {request:record}=await halfOrder.json();
  assert.equal(record.price_cents*record.quantity,4719400);
  assert.equal(Object.hasOwn(record,'contact_phone'),false);
  const adminPhoneOrder=(await (await call(admin,{admin:true})).json()).requests.find(r=>r.id===record.id);
  assert.equal(adminPhoneOrder.contact_phone,'02-0000-0000');
  assert.equal(adminPhoneOrder.contact,'02-0000-0000');
  assert.equal(adminPhoneOrder.email_status,'pending');
  const [firstMail]=await mail();
  assert.equal(firstMail.url,'https://api.resend.com/emails');
  assert.deepEqual(firstMail.to,['taipei@example.test']);
  assert.equal(firstMail.key,'welfare-shop-director/'+record.id);
  assert.match(firstMail.text,/待福委會確認/);
  assert.match(firstMail.text,/聯絡電話：02-0000-0000/);
  assert.doesNotMatch(firstMail.text,/U[12]{32}/);
  const replay=await call(api,{cookie:one,body:{...phoneOrder,contact_phone:'02-0000-0000'}});
  assert.equal(replay.status,200);
  assert.equal((await mail()).length,1);
  assert.equal((await (await call(admin,{admin:true})).json()).requests.find(r=>r.id===record.id).email_status,'accepted');
  const branchProduct={action:'save',category:'配件',name:'台中樣品',condition_note:'現品',pickup_note:'台中',price_cents:10000,stock:2,employee_limit:1,status:'published'};
  const lineSettings=await (await call(settings,{token:'line-admin'})).json();
  assert.deepEqual(Object.keys(lineSettings).sort(),['email_configured','products','venues']);
  assert.ok(lineSettings.products.every(item=>Object.keys(item).length===4));
  const {id:taichungItem}=await (await saveProduct({...branchProduct,venue_id:taichung})).json();
  assert.equal((await saveProduct({...branchProduct,id:taichungItem,revision:1})).status,200);
  const taichungOrder={id:randomUUID(),product_id:taichungItem,revision:2,unit_price_cents:10000,quantity:1,contact_phone:'04-0000-0000'};
  assert.equal((await call(api,{cookie:two,body:taichungOrder})).status,200);
  const sent=await mail();
  assert.deepEqual(sent.map(item=>item.to),[['taipei@example.test'],['taichung@example.test']]);
  const {id:oldRecipientItem}=await (await saveProduct({...branchProduct,venue_id:taichung})).json();
  const oldRecipientOrder={...taichungOrder,id:randomUUID(),product_id:oldRecipientItem,revision:1};
  assert.equal((await call(api,{cookie:one,body:oldRecipientOrder})).status,200);
  assert.equal((await saveVenue({...taichungData,id:taichung,revision:1,email:'timeout@example.test'})).status,200);
  assert.equal((await saveVenue({...taichungData,id:taichung,revision:1})).status,409);
  assert.equal((await mail()).length,2);
  assert.equal((await (await call(admin,{admin:true})).json()).requests.find(r=>r.id===oldRecipientOrder.id).email_status,'recipient_changed');
  const newOrder={...taichungOrder,id:randomUUID()};
  assert.equal((await call(api,{cookie:one,body:newOrder})).status,200);
  assert.deepEqual((await mail()).at(-1).to,['timeout@example.test']);
  assert.equal((await mail()).length,3);
  assert.equal((await (await call(admin,{admin:true})).json()).requests.find(r=>r.id===newOrder.id).email_status,'unknown');
  const phoneMessage=(await flush()).find(message=>message.includes(record.id));
  assert.match(phoneMessage,/金額｜\$47,194\n/);
  assert.doesNotMatch(phoneMessage,/02-0000-0000/);
  await db.prepare("UPDATE welfare_members SET status='inactive' WHERE line_user_id=?").bind(first).run();
  assert.equal((await call(photo,{cookie:one})).status,403);
  assert.equal((await call(api,{cookie:one})).status,403);
});
