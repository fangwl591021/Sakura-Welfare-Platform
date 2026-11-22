import assert from 'node:assert/strict';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {chromium} from 'playwright';
const bundle=process.env.STORE_APP_BUNDLE;
const {default:worker}=await import(bundle?pathToFileURL(bundle).href:'../src/index.js');
const origin='https://welfare-shop-price.test';
const fixtures=[
  {id:'down',name:'隔離伸縮龍頭',price_cents:2359610,total:'$23,596'},
  {id:'half',name:'隔離進位驗證',price_cents:2359650,total:'$23,597'},
  {id:'up',name:'隔離烤箱',price_cents:1903660,total:'$19,037'}
].map(item=>({...item,revision:1,status:'published',stock:3,available:3,committed:0,employee_limit:3,series:'隔離測試',
  category:'廚電',condition_note:'展示品',pickup_note:'隔離取貨',has_photo:0}));
test('mall cards, purchase totals and admin records agree at phone and desktop widths',{timeout:60000},async t=>{
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  t.after(()=>browser.close());
  for(const width of [390,1366])await t.test(String(width),async()=>{
    const page=await browser.newPage({viewport:{width,height:880}});
    const submissions=[],orders=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.hostname==='static.line-scdn.net')return route.fulfill({body:''});
      if(url.origin!==origin)return route.abort();
      if(['/welfare-shop','/welfare-shop-admin'].includes(url.pathname)){
        const response=await worker.fetch(new Request(req.url()),{},{});
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
        return route.fulfill({json:{products:fixtures,requests:orders,viewer:'隔離員工'}});
      }
      if(url.pathname==='/admin-api/welfare-shop'){
        return route.fulfill({json:{products:fixtures,requests:orders.map(r=>({...r,employee:'隔離員工',contact:'synthetic'})),next:false}});
      }
      if(url.pathname==='/admin-api/editor-context')return route.fulfill({json:{success:true,role:'admin',editor:false}});
      return route.fulfill({status:204,body:''});
    });
    await page.goto(origin+'/welfare-shop');
    for(const fixture of fixtures){
      await page.locator('#catalog article').filter({hasText:fixture.name}).getByText(fixture.total,{exact:true}).waitFor();
    }
    await page.locator('#catalog article').filter({hasText:'隔離進位驗證'}).getByRole('button',{name:'查看商品'}).click();
    await page.locator('#itemInfo').getByText('$23,597',{exact:true}).waitFor();
    await page.getByRole('button',{name:'我要購買'}).click();
    assert.equal(await page.locator('#applyAmount').textContent(),'單價 $23,597 · 申請總額 $23,597');
    await page.getByLabel('數量').fill('2');
    assert.equal(await page.locator('#applyAmount').textContent(),'單價 $23,597 · 申請總額 $47,194');
    await page.getByLabel('聯絡方式').fill('synthetic');
    await page.getByRole('button',{name:'送出購買申請'}).click();
    await page.locator('#requests').getByText(/\$47,194/).waitFor();
    assert.deepEqual(submissions.map(b=>[b.unit_price_cents,b.quantity]),[[2359700,2]]);
    await page.goto(origin+'/welfare-shop-admin');
    await page.locator('#requests').getByText(/\$47,194/).waitFor();
    const card=page.locator('#catalog article').filter({hasText:'隔離進位驗證'});
    await card.getByText('$23,597',{exact:true}).waitFor();
    await card.getByRole('button',{name:'編輯商品'}).click();
    assert.equal(await page.getByLabel('員工價（元）').inputValue(),'23597');
    assert.deepEqual(errors,[]);
    await page.close();
  });
});
