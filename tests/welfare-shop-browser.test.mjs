import assert from 'node:assert/strict';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {buildWorkspaceDashboardFlex} from '../src/workspace/dashboard-flex.js';
const bundle=process.env.STORE_APP_BUNDLE;
const {default:worker}=await import(bundle?pathToFileURL(bundle).href:'../src/index.js');
const origin='https://welfare-shop-price.test';
const liveOrigin='https://sakura-welfare-platform.fangwl591021.workers.dev';
const livePaths=['/welfare-shop','/welfare-shop-admin','/welfare-shop-settings'];
const fixtures=[
  {id:'down',name:'隔離伸縮龍頭',venue_name:'台北館',price_cents:2359610,total:'$23,596'},
  {id:'half',name:'隔離進位驗證',venue_name:'台中館',price_cents:2359650,total:'$23,597'},
  {id:'up',name:'【通電異常】隔離烤箱',venue_name:'高雄館',price_cents:1903660,total:'$19,037'}
].map(item=>({...item,revision:1,status:'published',stock:3,available:3,committed:0,employee_limit:3,series:'隔離測試',
  category:'廚電',condition_note:item.id==='up'?'通電異常，原因未排除。':'展示品',pickup_note:'隔離取貨',has_photo:0}));
test('mall cards, purchase totals and admin records agree at phone and desktop widths',{timeout:60000},async t=>{
  const livePages=new Map();
  // Replay production HTML only. The browser origin and all APIs still use the isolated fixtures.
  if(process.env.WELFARE_SHOP_LIVE_UI==='1'){
    await Promise.all(livePaths.map(async path=>{
      const response=await fetch(liveOrigin+path,{redirect:'error',signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,200);
      livePages.set(path,await response.text());
    }));
  }
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  t.after(()=>browser.close());
  for(const width of [390,1366])await t.test(String(width),async()=>{
    const page=await browser.newPage({viewport:{width,height:880}});
    const submissions=[],orders=[],errors=[];
    const products=fixtures.map(item=>({...item}));
    const venues=[],batches=[];
    let denySettings=false,timedReads=0,timedCatalog=false,timedStart;
    await page.addInitScript(()=>localStorage.setItem('sakura_admin_session',JSON.stringify({token:'isolated-admin'})));
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.hostname==='static.line-scdn.net')return route.fulfill({contentType:'application/javascript',body:`
        window.liff = {
          init: async () => {}, isLoggedIn: () => true, isInClient: () => true,
          getIDToken: () => 'isolated-line-admin',
          closeWindow: () => { window.closedByLiff = true; }
        };
      `});
      if(url.origin!==origin)return route.abort();
      if(['/','/sakura-admin','/welfare-shop','/welfare-shop-admin','/welfare-shop-settings'].includes(url.pathname)){
        const response=livePages.has(url.pathname)?new Response(livePages.get(url.pathname)):
          await worker.fetch(new Request(req.url()),{},{});
        const html=await response.text();
        for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(script.trim())new vm.Script(script);
        return route.fulfill({status:response.status,contentType:'text/html;charset=UTF-8',body:html});
      }
      if(url.pathname==='/api/welfare-shop'){
        if(req.method()==='POST'){
          const body=req.postDataJSON();submissions.push(body);
          const record={id:body.id,product_id:body.product_id,product_name:'隔離進位驗證',
            price_cents:body.unit_price_cents,quantity:body.quantity,status:'pending',created_at:'2026-11-22T00:00:00Z'};
          orders.push(record);
          return route.fulfill({json:{request:record}});
        }
        if(timedCatalog){
          timedReads++;
          timedStart??=Date.now()+3000;
          const endsAt=timedStart+5000;
          const now=timedReads===1?timedStart-3000:timedReads===2?timedStart:endsAt;
          const timedProducts=timedReads===2
            ? fixtures.map(item=>item.id==='up'?{...item,ends_at:new Date(endsAt).toISOString()}:item)
            : fixtures.filter(item=>item.id!=='up');
          return route.fulfill({json:{products:timedProducts,requests:orders,viewer:'隔離員工',
            server_time:new Date(now).toISOString(),next_starts_at:timedReads===1?new Date(timedStart).toISOString():null}});
        }
        return route.fulfill({json:{products:fixtures,requests:orders,viewer:'隔離員工'}});
      }
      if(url.pathname==='/admin-api/welfare-shop/settings'){
        assert.equal(req.headers()['x-line-id-token'],'isolated-line-admin');
        assert.equal(req.headers().authorization,undefined);
        if(denySettings)return route.fulfill({status:403,json:{error:'forbidden'}});
        if(req.method()==='POST'){
          const body=req.postDataJSON();
          if(body.action==='venue.save'){
            venues.push({...body,id:'taipei',revision:1});
            return route.fulfill({json:{id:'taipei'}});
          }
          if(body.action==='venue.assign'){
            for(const item of products.filter(p=>body.products.some(s=>s.id===p.id)))item.venue_id=body.venue_id;
            return route.fulfill({json:{assigned:body.products.length}});
          }
          if(body.action==='batch.save'){
            assert.equal(body.starts_at,'2099-12-31T17:00');
            assert.equal(body.ends_at,'2099-12-31T18:00');
            batches.push({...body,id:'batch-one',starts_at:'2099-12-31T09:00:00.000Z',ends_at:'2099-12-31T10:00:00.000Z',
              revision:1,scheduled:1,expired:0,product_count:0});
            return route.fulfill({json:{id:'batch-one'}});
          }
          if(body.action==='batch.assign'){
            for(const item of products.filter(p=>body.products.some(s=>s.id===p.id)))item.batch_id=body.batch_id;
            batches[0].product_count=body.products.length;
            return route.fulfill({json:{assigned:body.products.length}});
          }
        }
        return route.fulfill({json:{products,venues,email_configured:false}});
      }
      if(url.pathname==='/admin-api/welfare-shop'){
        if(req.headers()['x-line-id-token']){
          assert.equal(req.headers()['x-line-id-token'],'isolated-line-admin');
          assert.equal(req.headers().authorization,undefined);
          if(denySettings)return route.fulfill({status:403,json:{error:'forbidden'}});
        }
        return route.fulfill({json:{products,venues,batches,email_configured:false,
          requests:orders.map((r,i)=>({...r,employee:'隔離員工',contact_phone:submissions[i].contact_phone})),next:false}});
      }
      if(url.pathname==='/admin-api/editor-context')return route.fulfill({json:{success:true,role:'admin',editor:false}});
      if(url.pathname==='/api'&&req.method()==='POST')return route.fulfill({json:{success:true,data:{role:'admin'}}});
      return route.fulfill({status:204,body:''});
    });
    await page.goto(origin+'/welfare-shop');
    for(const fixture of fixtures){
      const card=page.locator('#catalog article').filter({hasText:fixture.name});
      await card.getByText(fixture.total,{exact:true}).waitFor();
      await card.getByText(fixture.venue_name,{exact:true}).waitFor();
    }
    const venueFilter=page.getByRole('combobox',{name:'館別',exact:true});
    for(const fixture of fixtures){
      await venueFilter.selectOption(fixture.venue_name);
      assert.deepEqual(await page.locator('#catalog h3').allTextContents(),[fixture.name]);
    }
    const search=page.getByRole('searchbox',{name:'搜尋商品'});
    await search.fill('伸縮龍頭');
    await page.getByText('目前沒有符合的商品。',{exact:true}).waitFor();
    await search.fill('');
    await venueFilter.selectOption('');
    const warningTitle=page.locator('#catalog h3.condition-warning');
    assert.equal(await warningTitle.textContent(),'【通電異常】隔離烤箱');
    assert.equal(await warningTitle.evaluate(el=>getComputedStyle(el).color),'rgb(178, 28, 52)');
    await page.locator('#catalog article').filter({hasText:'隔離進位驗證'}).getByRole('button',{name:'查看商品'}).click();
    await page.locator('#itemInfo').getByText('$23,597',{exact:true}).waitFor();
    await page.locator('#itemInfo').getByText('出貨館別｜台中館',{exact:true}).waitFor();
    await page.getByRole('button',{name:'我要購買'}).click();
    assert.equal(await page.locator('#applyAmount').textContent(),'單價 $23,597 · 申請總額 $23,597');
    await page.getByLabel('數量').fill('2');
    assert.equal(await page.locator('#applyAmount').textContent(),'單價 $23,597 · 申請總額 $47,194');
    const phone=page.getByRole('textbox',{name:'聯絡電話'});
    assert.equal(await phone.getAttribute('type'),'tel');
    assert.equal(await phone.inputValue(),'');
    await page.getByRole('button',{name:'送出購買申請'}).click();
    assert.equal(await phone.evaluate(input=>input.validity.valueMissing),true);
    assert.equal(submissions.length,0);
    await phone.fill('02-0000-0000');
    await page.getByRole('button',{name:'送出購買申請'}).click();
    await page.locator('#requests').getByText(/\$47,194/).waitFor();
    assert.deepEqual(submissions.map(b=>[b.unit_price_cents,b.quantity,b.contact_phone]),[[2359700,2,'02-0000-0000']]);
    await page.clock.install();
    timedCatalog=true;
    await page.reload();
    await page.locator('#catalog').getByText('隔離伸縮龍頭',{exact:true}).waitFor();
    assert.equal(await page.locator('#catalog').getByText('【通電異常】隔離烤箱',{exact:true}).count(),0);
    await page.clock.runFor(3300);
    await page.locator('#catalog article').filter({hasText:'隔離烤箱'}).getByRole('button',{name:'查看商品'}).click();
    assert.equal(await page.locator('#itemName.condition-warning').textContent(),'【通電異常】隔離烤箱');
    assert.match(await page.locator('#itemInfo .condition-warning').textContent(),/通電異常，原因未排除/);
    await page.getByRole('button',{name:'我要購買'}).click();
    await page.clock.runFor(5300);
    await page.getByText(/商品已下架，已送出的申請/).waitFor();
    assert.equal(await page.locator('#apply').isVisible(),false);
    assert.equal(await page.locator('#catalog').getByText('【通電異常】隔離烤箱',{exact:true}).count(),0);
    assert.equal(submissions.length,1);
    const flex=buildWorkspaceDashboardFlex({},new Date(),{welfareShopUri:'https://liff.line.me/synthetic/welfare-shop-settings'});
    const uri=flex.contents.footer.contents.find(item=>item.action?.label==='福利品專區設定').action.uri;
    const path=new URL(uri).pathname.replace('/synthetic','');
    await page.goto(origin+'/?liff.state='+encodeURIComponent(path));
    await page.waitForURL('**/welfare-shop-settings');
    const menu=page.getByRole('navigation',{name:'福利品商城功能'});
    await page.locator('#productPanel').getByText('隔離進位驗證',{exact:true}).waitFor();
    const menuBounds=await menu.boundingBox(),productBounds=await page.locator('#productPanel').boundingBox();
    if(width>720)assert.ok(menuBounds.x+menuBounds.width<=productBounds.x);
    else assert.ok(menuBounds.y+menuBounds.height<=productBounds.y);
    await menu.getByRole('button',{name:'館長與通知信箱'}).click();
    const settings=page.locator('#venues');
    await settings.getByLabel('館別名稱').fill('隔離台北品牌館');
    await settings.getByLabel('館長姓名').fill('隔離台北館長');
    await settings.getByLabel('預訂通知信箱').fill('taipei@example.test');
    await settings.getByRole('button',{name:'儲存館別'}).click();
    await settings.getByText('taipei@example.test',{exact:true}).waitFor();
    await settings.getByText('批次指定商品的出貨館別',{exact:true}).click();
    await settings.getByLabel('指定出貨館別').selectOption({label:'隔離台北品牌館'});
    await settings.getByRole('checkbox',{name:/隔離進位驗證/}).check();
    page.once('dialog',dialog=>dialog.accept());
    await settings.getByRole('button',{name:'套用到勾選的商品'}).click();
    await settings.getByText('已指定 1 件商品。',{exact:true}).waitFor();
    await menu.getByRole('button',{name:'批次與上下架時間'}).click();
    const batchPanel=page.locator('#batchPanel');
    await batchPanel.getByLabel('批次名稱').fill('台北樣品第一批');
    await batchPanel.getByLabel('上架時間（台北時間）').fill('2099-12-31T17:00');
    await batchPanel.getByLabel('下架時間（台北時間）').fill('2099-12-31T18:00');
    await batchPanel.getByRole('button',{name:'儲存批次'}).click();
    await batchPanel.getByRole('heading',{name:'台北樣品第一批'}).waitFor();
    await batchPanel.getByText('預約上架',{exact:true}).waitFor();
    await batchPanel.getByRole('button',{name:'編輯 台北樣品第一批'}).click();
    assert.equal(await batchPanel.getByLabel('上架時間（台北時間）').inputValue(),'2099-12-31T17:00');
    await batchPanel.getByRole('button',{name:'取消編輯'}).click();
    await batchPanel.getByRole('combobox',{name:'指定批次',exact:true}).selectOption('batch-one');
    await batchPanel.getByRole('checkbox',{name:/隔離進位驗證/}).check();
    page.once('dialog',dialog=>dialog.accept());
    await batchPanel.getByRole('button',{name:'套用批次與上下架時間'}).click();
    await batchPanel.getByText('已套用到 1 件商品。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回／關閉'}).click();
    assert.equal(await page.evaluate(()=>window.closedByLiff),true);
    denySettings=true;
    await page.reload();
    await page.getByText('目前的 LINE 帳號沒有福利品專區設定權限。',{exact:true}).waitFor();
    assert.equal(await settings.isVisible(),false);
    await page.goto(origin+'/sakura-admin');
    await page.getByRole('link',{name:'福利品專區設定',exact:true}).click();
    await page.waitForURL('**/welfare-shop-admin');
    await page.locator('#productPanel').getByText('隔離進位驗證',{exact:true}).waitFor();
    await menu.getByRole('button',{name:'購買申請'}).click();
    await page.locator('#requests').getByText(/\$47,194/).waitFor();
    await page.locator('#requests').getByText('聯絡電話｜02-0000-0000',{exact:true}).waitFor();
    await menu.getByRole('button',{name:'商品管理'}).click();
    const card=page.locator('#catalog article').filter({hasText:'隔離進位驗證'});
    await card.getByText('$23,597',{exact:true}).waitFor();
    await card.getByText('尚未開放申請',{exact:true}).waitFor();
    await card.getByText(/隔離台北品牌館/).waitFor();
    await card.getByRole('button',{name:'編輯商品'}).click();
    assert.equal(await page.getByLabel('員工價（元）').inputValue(),'23597');
    assert.equal(await page.getByLabel('出貨館別',{exact:true}).inputValue(),'taipei');
    assert.equal(await page.getByLabel('上架批次',{exact:true}).inputValue(),'batch-one');
    assert.deepEqual(errors,[]);
    await page.close();
  });
});
test('shop prompts first-time LINE login, renews rejected browser tokens and keeps visitor access closed',
  {timeout:35000},async t=>{
    const entry='/welfare-shop';
    const pageResponse=process.env.WELFARE_SHOP_LIVE_UI==='1'
      ?await fetch(liveOrigin+entry,{redirect:'error',signal:AbortSignal.timeout(10000)})
      :await worker.fetch(new Request(origin+entry),{},{});
    assert.equal(pageResponse.status,200);
    const html=await pageResponse.text();
    const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
    t.after(()=>browser.close());
    for(const scenario of ['first','expired','line-client','visitor'])await t.test(scenario,async()=>{
      const page=await browser.newPage();
      try{
        const tokens=[];
        let accepted=false;
        await page.route('**/*',async route=>{
          const req=route.request(),url=new URL(req.url());
          if(url.hostname==='static.line-scdn.net')return route.fulfill({contentType:'application/javascript',body:
            'const mode='+JSON.stringify(scenario)+';'+
            'const returning=new URLSearchParams(location.search).has("fixture_callback");'+
            'window.liff={init:async()=>{},isInClient:()=>mode==="line-client",'+
            'isLoggedIn:()=>returning||mode!=="first",getIDToken:()=>returning||mode==="visitor"?"fixture-fresh":"fixture-expired",'+
            'logout:()=>sessionStorage.setItem("fixtureLogout",String(Number(sessionStorage.getItem("fixtureLogout")||0)+1)),'+
            'closeWindow:()=>{window.fixtureClosed=true;},'+
            'login:({redirectUri})=>{sessionStorage.setItem("fixtureRedirect",redirectUri);location.assign(redirectUri+"?fixture_callback=1");}};'
          });
          if(url.origin!==origin)return route.abort();
          if(url.pathname===entry)return route.fulfill({contentType:'text/html;charset=UTF-8',body:html});
          if(url.pathname==='/api/vendor-benefits/session'){
            const token=req.headers()['x-line-id-token'];
            tokens.push(token);
            if(token!=='fixture-fresh')return route.fulfill({status:403,json:{message:'LINE 登入已失效，請重新登入。'}});
            accepted=true;
            return route.fulfill({json:{success:true,employee:scenario!=='visitor',identified:true}});
          }
          if(url.pathname==='/api/welfare-shop'){
            if(!accepted)return route.fulfill({status:401,json:{error:'請先登入 LINE。'}});
            if(scenario==='visitor')return route.fulfill({status:403,json:{error:'福利品商城限已綁定的在職員工使用。'}});
            return route.fulfill({json:{products:fixtures,requests:[],viewer:'測試員工'}});
          }
          return route.fulfill({status:204,body:''});
        });
        await page.goto(origin+entry);
        if(scenario==='visitor'){
          await page.getByText('福利品商城限已綁定的在職員工使用。',{exact:true}).waitFor();
          assert.equal(await page.locator('#shop').isVisible(),false);
          assert.equal(await page.locator('#login').isVisible(),false);
          assert.deepEqual(tokens,['fixture-fresh']);
          return;
        }
        if(scenario==='line-client'){
          await page.getByRole('button',{name:'返回 LINE 聊天室',exact:true}).click();
          assert.equal(await page.evaluate(()=>window.fixtureClosed),true);
          assert.deepEqual(tokens,['fixture-expired']);
          return;
        }
        if(scenario==='first')await page.getByText('請登入 LINE，系統會確認員工資格。',{exact:true}).waitFor();
        await page.getByRole('button',{name:scenario==='first'?'登入 LINE':'重新登入 LINE',exact:true}).click();
        await page.waitForURL('**/welfare-shop?fixture_callback=1');
        await page.getByRole('searchbox',{name:'搜尋商品'}).waitFor();
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixtureRedirect')),origin+entry);
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixtureLogout')),scenario==='first'?null:'1');
        assert.deepEqual(tokens,scenario==='first'?['fixture-fresh']:['fixture-expired','fixture-fresh']);
      }finally{await page.close();}
    });
  });
