import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium }=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const bundle=process.env.STORE_APP_BUNDLE;
const worker=bundle?(await import(pathToFileURL(bundle).href)).default:null;
const origin='https://isolated-segment-push.test';
const users=[
  {line_user_id:'synthetic-A',display_name:'id target',employee_name:'合成甲',member_type:'employee',bind_status:'bound',employee_no:'0001',factory:'烏日二廠',business_unit:'製造處',department_code:'D1',department_name:'製造部',department_key:'department-A',language:'zh',tags:'VIP,健康'},
  {line_user_id:'synthetic-B',display_name:'other',employee_name:'合成乙',member_type:'foreign_employee',bind_status:'bound',employee_no:'0002',factory:'大雅廠',business_unit:'製造處',department_code:'D2',department_name:'製造部',department_key:'department-B',language:'id',tags:'健康'},
  {line_user_id:'synthetic-C',display_name:'Manager',employee_name:'合成丙',member_type:'manager',bind_status:'bound',employee_no:'0003',factory:'烏日二廠',business_unit:'管理處',department_code:'D3',department_name:'管理部',department_key:'department-C',language:'zh',tags:'VIP'},
  {line_user_id:'synthetic-D',display_name:'Visitor',member_type:'visitor',bind_status:'unbound',language:'zh',tags:''},
];

test('typing in push message preserves focus, selection and composition across consecutive input', {timeout:90000}, async t => {
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  try{
    for(const width of [390,1366]) for(const order of ['text_only','text_first','image_first']) await t.test(`viewport ${width}, ${order}`,async()=>{
      const h=await setup(browser,{width});
      try{
        await h.selectAll();
        await h.openEditor();
        if(order!=='text_only'){
          await h.page.locator('#addImageMode').click();
          await h.page.locator('#messageOrder').selectOption(order);
          await h.page.locator('#officialImageFields summary').click();
          await h.page.locator('#imageOriginalUrl').fill('https://synthetic.invalid/original.jpg');
          const textPrecedesImage=await h.page.locator('#officialTextFields').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('officialImageFields')) & Node.DOCUMENT_POSITION_FOLLOWING));
          assert.equal(textPrecedesImage,order==='text_first','editor order follows the selected message order');
        }
        await h.preview();
        await h.openEditor();
        assert.equal(await h.page.locator('#sendBtn').isDisabled(),false);
        const input=h.page.locator('#messageText');
        await input.fill('');
        await input.focus();
        await h.page.keyboard.insertText('第');
        assert.equal(await input.evaluate(el=>document.activeElement===el),true,'first character must not blur the textarea');
        assert.equal(await h.page.locator('#sendBtn').isDisabled(),true,'editing invalidates the confirmed preview');
        await h.page.keyboard.insertText('二');
        assert.equal(await input.inputValue(),'第二');
        await input.evaluate(el=>{el.setSelectionRange(1,1);el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));});
        await h.page.keyboard.insertText('中');
        await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'})));
        assert.equal(await input.evaluate(el=>document.activeElement===el),true,'composition must retain focus');
        assert.equal(await input.inputValue(),'第中二');
        assert.equal(await input.evaluate(el=>el.selectionStart),2);
        await h.page.keyboard.insertText('文');
        assert.equal(await input.inputValue(),'第中文二');
        assert.equal(await h.page.locator('#messagePreview .preview-message-text').innerText(),'第中文二');
        if(order!=='text_only'){
          const tags=await h.page.locator('#messagePreview').evaluate(el=>[...el.children].map(child=>child.tagName));
          assert.deepEqual(tags,order==='text_first'?['DIV','IMG']:['IMG','DIV']);
          const opposite=order==='text_first'?'image_first':'text_first';
          await h.page.locator('#messageOrder').selectOption(opposite);
          let precedes=await h.page.locator('#officialTextFields').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('officialImageFields')) & Node.DOCUMENT_POSITION_FOLLOWING));
          assert.equal(precedes,opposite==='text_first');
          await h.page.locator('#messageOrder').selectOption(order);
          precedes=await h.page.locator('#officialTextFields').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('officialImageFields')) & Node.DOCUMENT_POSITION_FOLLOWING));
          assert.equal(precedes,order==='text_first');
          assert.equal(await input.inputValue(),'第中文二','switching order retains text');
          if(order==='image_first'){
            await h.page.locator('[data-message-mode="system_card"]').click();
            await h.page.locator('#flexCardImageOpen').click();
            const cardFirst=await h.page.locator('#flexCardFields').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('officialImageFields')) & Node.DOCUMENT_POSITION_FOLLOWING));
            assert.equal(cardFirst,true,'image controls follow the Flex card fields');
          }
        }
        assert.equal(h.calls.some(call=>call.action==='send'),false);
        await h.clean();
      }finally{await h.close();}
    });
  }finally{await browser.close();}
});
const options={factories:[{value:'烏日二廠',label:'烏日二廠'},{value:'大雅廠',label:'大雅廠'}],businessUnits:[{value:'製造處',label:'製造處',factory:'烏日二廠'},{value:'管理處',label:'管理處',factory:'烏日二廠'},{value:'製造處',label:'製造處',factory:'大雅廠'}],departments:[{value:'department-A',label:'D1 製造部',factory:'烏日二廠',businessUnit:'製造處'},{value:'department-B',label:'D2 製造部',factory:'大雅廠',businessUnit:'製造處'},{value:'department-C',label:'D3 管理部',factory:'烏日二廠',businessUnit:'管理處'}]};
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function setup(browser,config={}){
  const context=await browser.newContext({viewport:{width:config.width||1366,height:900}}),calls=[],uploads=[],editorContextCalls=[],errors=[],external=[],dialogs=[];
  let previewNumber=0,lastRequest='',html;
  if(worker){const response=await worker.fetch(new Request(origin+'/line-segment-push'),{},{});assert.equal(response.status,200);html=await response.text();}
  else html=await readFile(new URL('../src/line-segment-push.html',import.meta.url),'utf8');
  const result={status:'sent',recipientCount:2,successCount:2,failedCount:0,unknownCount:0,notSentCount:0,results:[]};
  function audience(filters){
    // Fixture expectations, not the UI's filtering implementation. In particular,
    // keyword=id deliberately returns language=id plus name=id target recipients.
    if(filters.keyword==='none')return [];
    if(filters.department)return users.filter(user=>user.department_key===filters.department);
    if(filters.factories?.length)return users.filter(user=>filters.factories.includes(user.factory)&&(!filters.businessUnit||user.business_unit===filters.businessUnit));
    if(filters.businessUnit==='管理處')return [users[2]];
    if(filters.keyword==='id')return [users[0],users[1]];
    if(filters.memberType==='employee')return users.slice(0,3);
    if(filters.bindStatus==='bound')return users.slice(0,3);
    if(filters.bindStatus==='unbound')return [users[3]];
    return users;
  }
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='https://synthetic.invalid'&&['/preview.jpg','/original.jpg'].includes(url.pathname))return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=','base64')});
    if(url.origin!==origin){external.push(request.method()+' '+url.origin);return route.abort();}
    if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
    if(url.pathname==='/mock-push-image.jpg')return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9sAAAAASUVORK5CYII=','base64')});
    if(url.pathname==='/admin-api/segment-push-image'){
      assert.equal(request.method(),'POST');uploads.push({body:request.postDataBuffer(),contentType:request.headers()['content-type']});
      if(config.uploadGate)await config.uploadGate.promise;
      if(config.uploadFail)return route.fulfill({status:503,json:{success:false,message:'模擬圖片上傳失敗'}});
      return route.fulfill({json:{success:true,originalContentUrl:origin+'/mock-push-image.jpg',previewImageUrl:origin+'/mock-push-image.jpg',width:1024,height:768}});
    }

    if(url.pathname==='/line-segment-push')return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname==='/admin-api/editor-context'){
      editorContextCalls.push({path:url.pathname,method:request.method()});
      assert.equal(request.method(),'GET','The existing administrative bridge only reads its context');
      return config.denied
        ?route.fulfill({status:403,json:{success:false,message:'沒有推播管理權限。'}})
        :route.fulfill({json:{success:true,role:'admin',editor:false,preset:null,presets:[]}});
    }
    if(url.pathname!=='/admin-api/line-segment-push'){external.push(request.method()+' '+url.pathname);return route.abort();}
    if(request.method()==='GET'){
      if(config.denied)return route.fulfill({status:403,json:{success:false,message:'沒有推播管理權限。'}});
      return route.fulfill({json:{success:true,data:{users,summary:{pushableUsers:4},tags:['VIP','健康'],templates:[{id:'template-1',name:'合成版型'}],options}}});
    }
    const body=request.postDataJSON();calls.push(body);
    if(body.action==='audience'){
      if(config.audienceGate?.(body))await config.audienceGate(body).promise;
      const rows=audience(body.filters);return route.fulfill({json:{success:true,data:{recipients:rows,matchedCount:rows.length}}});
    }
    if(body.action==='preview'){
      if(config.previewGate)await config.previewGate.promise;
      const ids=new Set(body.filters.selectedLineUserIds),rows=audience(body.filters).filter(user=>ids.has(user.line_user_id));
      const number=++previewNumber;lastRequest='00000000-0000-4000-8000-'+String(number).padStart(12,'0');
      return route.fulfill({json:{success:true,data:{preview_id:'preview-'+number,preview_revision:'revision-'+number,request_id:lastRequest,expires_at:Date.now()+(config.expiryMs||60000),recipientCount:rows.length,recipients:rows,title:body.title,messageSummary:'合成內容預覽'}}});
    }
    if(body.action==='send'){
      assert.deepEqual(Object.keys(body).sort(),['action','confirmed','preview_id','preview_revision','request_id']);
      assert.equal(body.request_id,lastRequest);assert.equal(body.confirmed,true);
      if(config.sendAbort)return route.abort('failed');
      if(config.recipientConflict)return route.fulfill({status:409,json:{success:false,message:'本次請求未發送。',
        recipientIssues:[{line_user_id:users[1].line_user_id,display_name:'合成乙',reason:'員工 LINE 綁定尚未確認。'}]}});
      if(config.staleSend)return route.fulfill({status:409,json:{success:false,message:'名單已變更，請重新預覽。'}});
      return route.fulfill({json:{success:true,data:{...result,recipientCount:config.count||2,successCount:config.count||2}}});
    }
    if(body.action==='status')return route.fulfill({json:{success:true,data:{...result,...config.status}}});
    errors.push('Unknown action '+body.action);return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());if(config.cancelConfirm || config.dialogDecision?.(dialog.message())===false)await dialog.dismiss();else await dialog.accept();});
  await page.goto(origin+'/line-segment-push');
  if(!config.denied)await page.locator('#audienceBody[data-ready="true"]').waitFor();
  return {page,context,calls,uploads,editorContextCalls,errors,external,dialogs,audience,async selectAll(){await page.locator('#selectAllBtn').click();},async openEditor(){if(!await page.locator('#contentDrawer').evaluate(el=>el.open))await page.locator('#contentDrawerOpen').click();},async preview(){if(await page.locator('#contentDrawer').evaluate(el=>el.open))await page.locator('#contentDrawerClose').click();await page.locator('#previewBtn').click();await page.waitForFunction(()=>!document.getElementById('sendBtn').disabled);},async waitRows(ids){await page.waitForFunction(expected=>{const body=document.getElementById('audienceBody');return body.dataset.ready==='true'&&JSON.stringify([...body.querySelectorAll('input')].map(input=>input.dataset.id))===JSON.stringify(expected);},ids);},async clean(){assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(editorContextCalls.every(call=>call.path==='/admin-api/editor-context'&&call.method==='GET'));if(worker)assert.ok(editorContextCalls.length>=1,'Built HTML must execute its existing administrative context bridge');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));},async close(){await context.close();}};
}

test('paid push UI uses authoritative audience snapshots and never retries delivery automatically',{timeout:150000},async t=>{
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  try{
    for(const width of [390,1366])await t.test(width+' identity conflict identifies recipient and allows exclusion before preview',async()=>{
      const h=await setup(browser,{width,recipientConflict:true});
      try{
        await h.selectAll();await h.preview();await h.page.locator('#sendBtn').click();
        const issues=h.page.locator('#audienceReview');
        await issues.getByText('需核對的受眾（1 人）').waitFor();
        assert.match(await issues.innerText(),/合成乙.*員工 LINE 綁定尚未確認/);
        assert.equal(await issues.getByRole('link',{name:'查看會員資料'}).getAttribute('href'),'/crm-users#user=synthetic-B');
        await issues.getByRole('button',{name:'從本次移除'}).click();
        assert.equal(await h.page.locator('#selectedUsers').innerText(),'3');
        assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        await h.preview();
        assert.deepEqual(h.calls.findLast(call=>call.action==='preview').filters.selectedLineUserIds,['synthetic-A','synthetic-C','synthetic-D']);
        assert.equal(h.calls.filter(call=>call.action==='send').length,1);
        assert.equal(h.calls.filter(call=>call.action==='status').length,0);
        await h.clean();
      }finally{await h.close();}
    });
    for(const width of [390,1366])await t.test(width+' initial empty selection and organization filters',async()=>{
      const h=await setup(browser,{width});try{
        assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        await h.page.locator('#factorySummary').click();await h.page.locator('#factoryChoices input[value="烏日二廠"]').check();await h.waitRows(['synthetic-A','synthetic-C']);
        assert.equal(await h.page.locator('#department option[value="department-B"]').count(),0);
        await h.page.locator('#businessUnit').selectOption('製造處');await h.page.locator('#department').selectOption('department-A');await h.waitRows(['synthetic-A']);await h.selectAll();await h.preview();
        const payload=h.calls.findLast(call=>call.action==='preview');assert.deepEqual(payload.filters.factories,['烏日二廠']);assert.equal(payload.filters.businessUnit,'製造處');assert.equal(payload.filters.department,'department-A');assert.deepEqual(payload.filters.selectedLineUserIds,['synthetic-A']);
        await h.clean();
      }finally{await h.close();}
    });
    for(const width of [390,1366])await t.test(width+' factory multi-select is synchronized with roster tags and invalidates preview',async()=>{
      const h=await setup(browser,{width});try{
        await h.page.locator('#factorySummary').click();await h.page.locator('#factoryChoices input[value="烏日二廠"]').check();await h.waitRows(['synthetic-A','synthetic-C']);
        const size=await h.page.locator('#factoryChoices input[value="烏日二廠"]').boundingBox();assert.ok(size.width<=20&&size.height<=20);assert.equal(await h.page.locator('#factoryChoices label').first().evaluate(el=>getComputedStyle(el).display),'flex');
        assert.equal(await h.page.locator('#factoryTagChoices input[value="烏日二廠"]').isChecked(),true);
        const tagSize=await h.page.locator('#factoryTagChoices input[value="烏日二廠"]').boundingBox();assert.ok(tagSize.width<=20&&tagSize.height<=20);
        await h.page.locator('#factoryTagChoices input[value="大雅廠"]').check();await h.waitRows(['synthetic-A','synthetic-B','synthetic-C']);
        assert.equal(await h.page.locator('#factoryChoices input[value="大雅廠"]').isChecked(),true);assert.match(await h.page.locator('#factorySummary').innerText(),/已選 2 個廠別/);
        assert.equal(await h.page.locator('#department option[value="department-A"]').count(),1);assert.equal(await h.page.locator('#department option[value="department-B"]').count(),1);
        await h.selectAll();await h.preview();assert.deepEqual(h.calls.findLast(call=>call.action==='preview').filters.factories,['烏日二廠','大雅廠']);
        await h.page.locator('#factoryTagChoices input[value="大雅廠"]').uncheck();await h.waitRows(['synthetic-A','synthetic-C']);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(await h.page.locator('#factoryChoices input[value="大雅廠"]').isChecked(),false);
        await h.page.locator('#factoryClear').click();await h.waitRows(['synthetic-A','synthetic-B','synthetic-C','synthetic-D']);assert.equal(await h.page.locator('#factoryTagChoices input:checked').count(),0);assert.equal(await h.page.locator('#selectedUsers').innerText(),'2');await h.clean();
      }finally{await h.close();}
    });
    await t.test('factory changes retain only valid unit and department and do not add recipients',async()=>{
      const h=await setup(browser);try{
        await h.page.locator('#factorySummary').click();await h.page.locator('#factoryChoices input[value="烏日二廠"]').check();await h.waitRows(['synthetic-A','synthetic-C']);
        await h.page.locator('#businessUnit').selectOption('管理處');await h.page.locator('#department').selectOption('department-C');await h.waitRows(['synthetic-C']);await h.selectAll();
        await h.page.locator('#factoryTagChoices input[value="大雅廠"]').check();await h.waitRows(['synthetic-C']);assert.equal(await h.page.locator('#businessUnit').inputValue(),'管理處');assert.equal(await h.page.locator('#department').inputValue(),'department-C');
        await h.page.locator('#factoryTagChoices input[value="烏日二廠"]').uncheck();await h.waitRows(['synthetic-B']);assert.equal(await h.page.locator('#businessUnit').inputValue(),'');assert.equal(await h.page.locator('#department').inputValue(),'');assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');await h.clean();
      }finally{await h.close();}
    });
    await t.test('language/name keyword response displays and confirms the same two recipients',async()=>{
      const h=await setup(browser);try{
        await h.page.locator('#keyword').fill('id');await h.waitRows(['synthetic-A','synthetic-B']);assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');await h.selectAll();await h.preview();assert.match(await h.page.locator('#reviewBox').innerText(),/已選取 2 位候選受眾/);await h.page.locator('#sendBtn').click();await h.page.locator('#logBox').filter({hasText:'LINE 已接受'}).waitFor();assert.match(await h.page.locator('#logBox').innerText(),/LINE 已接受 2/);
        assert.match(h.dialogs[0],/2 位受眾/);assert.equal(h.calls.filter(call=>call.action==='send').length,1);assert.equal(h.calls.find(call=>call.action==='send').preview_id,'preview-1');await h.clean();
      }finally{await h.close();}
    });
    await t.test('unchecked users stay unchecked after apply; clear remains zero',async()=>{
      const h=await setup(browser);try{
        await h.selectAll();await h.page.locator('#audienceBody input[data-id="synthetic-B"]').uncheck();await h.page.locator('#filterBtn').click();await h.page.locator('#audienceBody[data-ready="true"]').waitFor();
        assert.equal(await h.page.locator('#audienceBody input[data-id="synthetic-B"]').isChecked(),false);assert.equal(await h.page.locator('#selectedUsers').innerText(),'3');
        await h.page.locator('#clearSelectionBtn').click();assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);assert.equal(h.calls.some(call=>call.action==='preview'||call.action==='send'),false);await h.clean();
      }finally{await h.close();}
    });
    await t.test('employee category includes external employees and managers, and filter changes prune hidden selections',async()=>{
      const h=await setup(browser);try{
        await h.selectAll();await h.page.locator('#memberTypeChips button[data-value="employee"]').click();await h.waitRows(['synthetic-A','synthetic-B','synthetic-C']);assert.equal(await h.page.locator('#selectedUsers').innerText(),'3');
        await h.page.locator('#factorySummary').click();await h.page.locator('#factoryChoices input[value="大雅廠"]').check();await h.waitRows(['synthetic-B']);assert.equal(await h.page.locator('#selectedUsers').innerText(),'1');await h.page.locator('#factoryClear').click();await h.waitRows(['synthetic-A','synthetic-B','synthetic-C']);assert.equal(await h.page.locator('#selectedUsers').innerText(),'1');await h.clean();
      }finally{await h.close();}
    });
    await t.test('title, content, selection and filter changes invalidate a reviewed snapshot',async()=>{
      const h=await setup(browser);try{
        await h.selectAll();await h.preview();await h.openEditor();await h.page.locator('#campaignTitle').fill('合成新標題');assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        await h.preview();await h.openEditor();await h.page.locator('#messageText').fill('合成新文字');assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        await h.preview();await h.page.locator('#audienceBody input[data-id="synthetic-D"]').uncheck();assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        await h.preview();await h.page.locator('#bindStatus').selectOption('bound');await h.waitRows(['synthetic-A','synthetic-B','synthetic-C']);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(h.calls.some(call=>call.action==='send'),false);await h.clean();
      }finally{await h.close();}
    });
    await t.test('all four original message modes are frozen through preview',async()=>{
      const h=await setup(browser);try{
        await h.selectAll();await h.preview();assert.equal(h.calls.findLast(call=>call.action==='preview').message.mode,'official_text');
        await h.openEditor();await h.page.locator('#messageMode').selectOption('official_image');await h.page.locator('#officialImageFields summary').click();await h.page.locator('#imageOriginalUrl').fill('https://synthetic.invalid/original.jpg');await h.page.locator('#imagePreviewUrl').fill('https://synthetic.invalid/preview.jpg');await h.preview();assert.equal(h.calls.findLast(call=>call.action==='preview').message.originalContentUrl,'https://synthetic.invalid/original.jpg');
        await h.openEditor();await h.page.locator('#messageMode').selectOption('system_template');await h.preview();assert.equal(h.calls.findLast(call=>call.action==='preview').message.templateId,'template-1');
        await h.openEditor();await h.page.locator('#messageMode').selectOption('system_json');await h.page.locator('#customJson').fill('{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[]}}');await h.preview();assert.equal(h.calls.findLast(call=>call.action==='preview').message.contents.type,'bubble');await h.clean();
      }finally{await h.close();}
    });
    await t.test('late preview response cannot restore send after the message changes',async()=>{
      const gate=defer(),h=await setup(browser,{previewGate:gate});try{
        await h.selectAll();const response=h.page.waitForResponse(response=>response.url()===origin+'/admin-api/line-segment-push'&&response.request().method()==='POST'&&response.request().postDataJSON().action==='preview');await h.page.locator('#previewBtn').click();await h.openEditor();await h.page.locator('#messageText').fill('changed while preview pending');gate.resolve();await (await response).finished();await h.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));await h.page.locator('#workflowStatus').filter({hasText:'重新預覽'}).waitFor();assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(h.calls.some(call=>call.action==='send'),false);await h.clean();
      }finally{gate.resolve();await h.close();}
    });
    await t.test('late audience response cannot replace a newer factory selection',async()=>{
      const gate=defer(),h=await setup(browser,{audienceGate:body=>body.filters.factories?.length===1&&body.filters.factories[0]==='烏日二廠'?gate:null});try{
        const response=h.page.waitForResponse(response=>response.url()===origin+'/admin-api/line-segment-push'&&response.request().method()==='POST'&&response.request().postDataJSON().action==='audience'&&response.request().postDataJSON().filters.factories?.[0]==='烏日二廠');await h.page.locator('#factorySummary').click();await h.page.locator('#factoryChoices input[value="烏日二廠"]').check();await h.page.waitForFunction(()=>document.getElementById('audienceBody').dataset.ready==='false');await h.page.locator('#factoryChoices input[value="烏日二廠"]').uncheck();await h.page.locator('#factoryChoices input[value="大雅廠"]').check();await h.waitRows(['synthetic-B']);gate.resolve();await (await response).finished();await h.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));await h.page.locator('#audienceBody input[data-id="synthetic-B"]').waitFor();assert.equal(await h.page.locator('#audienceBody input[data-id="synthetic-A"]').count(),0);assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');await h.clean();
      }finally{gate.resolve();await h.close();}
    });
    await t.test('expired preview disables send without producing a delivery call',async()=>{
      const h=await setup(browser,{expiryMs:400});try{await h.selectAll();await h.preview();await h.page.locator('#workflowStatus').filter({hasText:'已過期'}).waitFor();assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(h.calls.some(call=>call.action==='send'),false);await h.clean();}finally{await h.close();}
    });
    await t.test('ambiguous send queries the original request and never sends again, including reload recovery',async()=>{
      const h=await setup(browser,{sendAbort:true,status:{status:'needs_review',unknownCount:1}});try{
        await h.selectAll();await h.preview();await h.page.locator('#sendBtn').click();await h.page.locator('#logBox').filter({hasText:'需人工確認'}).waitFor();const send=h.calls.find(call=>call.action==='send');assert.equal(h.calls.find(call=>call.action==='status').request_id,send.request_id);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        await h.page.reload();await h.page.locator('#logBox').filter({hasText:'需人工確認'}).waitFor();await h.page.locator('#statusBtn').click();await h.page.locator('#logBox').filter({hasText:'需人工確認'}).waitFor();assert.equal(h.calls.filter(call=>call.action==='send').length,1);assert.ok(h.calls.filter(call=>call.action==='status').every(call=>call.request_id===send.request_id));await h.clean();
      }finally{await h.close();}
    });
    await t.test('server rejects a changed snapshot; UI cannot retry delivery',async()=>{
      const h=await setup(browser,{staleSend:true,status:{status:'needs_review'}});try{await h.selectAll();await h.preview();await h.page.locator('#sendBtn').click();await h.page.locator('#logBox').filter({hasText:'需人工確認'}).waitFor();assert.equal(h.calls.filter(call=>call.action==='send').length,1);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);await h.clean();}finally{await h.close();}
    });
    await t.test('empty or invalid maximum never falls back to a broad audience',async()=>{
      const h=await setup(browser);try{await h.selectAll();await h.preview();const count=h.calls.filter(call=>call.action==='audience').length;await h.page.locator('#maxRecipients').fill('');await h.page.locator('#workflowStatus').filter({hasText:'安全上限'}).waitFor();assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);assert.equal(h.calls.filter(call=>call.action==='audience').length,count);await h.page.locator('#maxRecipients').fill('500');await h.waitRows(users.map(user=>user.line_user_id));assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');await h.clean();}finally{await h.close();}
    });
    await t.test('starting a fresh preview after uncertainty requires an explicit duplicate warning',async()=>{
      const h=await setup(browser,{sendAbort:true,status:{status:'needs_review'},dialogDecision:message=>!message.includes('上一筆推播')});try{await h.selectAll();await h.preview();await h.page.locator('#sendBtn').click();await h.page.locator('#logBox').filter({hasText:'需人工確認'}).waitFor();await h.page.locator('#previewBtn').click();assert.ok(h.dialogs.some(message=>message.includes('可能重複推播')));assert.equal(h.calls.filter(call=>call.action==='preview').length,1);assert.equal(h.calls.filter(call=>call.action==='send').length,1);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);await h.clean();}finally{await h.close();}
    });
    await t.test('canceling the send confirmation makes zero send calls',async()=>{
      const h=await setup(browser,{cancelConfirm:true});try{await h.selectAll();await h.preview();await h.page.locator('#sendBtn').click();assert.equal(h.calls.some(call=>call.action==='send'),false);assert.equal(await h.page.locator('#sendBtn').isDisabled(),false);await h.clean();}finally{await h.close();}
    });
    await t.test('expired or denied administrator session cannot select, preview or send',async()=>{
      const h=await setup(browser,{denied:true});try{await h.page.locator('#workflowStatus').filter({hasText:'沒有推播管理權限'}).waitFor();assert.equal(await h.page.locator('#selectAllBtn').isDisabled(),true);assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(h.calls.length,0);await h.clean();}finally{await h.close();}
    });
  }finally{await browser.close();}
});


test('candidate notice makes LINE friendship and delivery uncertainty explicit',{timeout:90000},async t=>{
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  try{
    for(const width of [390,1366])await t.test(String(width),async()=>{
      const h=await setup(browser,{width});try{
        assert.equal(await h.page.getByText('CRM 候選名單',{exact:true}).count(),1);
        assert.equal(await h.page.getByText('CRM 可推播名單',{exact:true}).count(),0);
        assert.equal(await h.page.getByText('LINE 好友／封鎖狀態尚未確認；LINE 接受推播請求不代表訊息已實際送達。',{exact:true}).isVisible(),true);
        assert.equal(await h.page.locator('#selectedUsers').innerText(),'0');
        assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);
        assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
        assert.equal(h.calls.some(call=>call.action==='send'||call.action==='preview'),false);
        await h.clean();
      }finally{await h.close();}
    });
  }finally{await browser.close();}
});


function jpegSizeFromMultipart(payload){
  const start=payload.indexOf(Buffer.from([0xff,0xd8])),end=payload.lastIndexOf(Buffer.from([0xff,0xd9]));assert.ok(start>=0&&end>start,'multipart contains JPEG');const b=payload.subarray(start,end+2);let i=2;
  while(i<b.length-9){if(b[i++]!==0xff)continue;while(b[i]===0xff)i++;const marker=b[i++];if(marker===0xd9||marker===0xda)break;const len=b.readUInt16BE(i);if([0xc0,0xc1,0xc2].includes(marker))return {width:b.readUInt16BE(i+5),height:b.readUInt16BE(i+3),bytes:b.length};i+=len;}
  throw Error('JPEG dimensions missing');
}
async function syntheticPng(page){const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const ctx=c.getContext('2d');ctx.fillStyle='#12b455';ctx.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];});return Buffer.from(data,'base64');}

test('full-screen content drawer supports text plus uploaded image safely',{timeout:90000},async t=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
 try{for(const width of [390,1366])await t.test(String(width),async()=>{
  const gate=defer(),h=await setup(browser,{width,uploadGate:gate});try{
   await h.selectAll();await h.preview();assert.equal(await h.page.locator('#sendBtn').isDisabled(),false);
   await h.openEditor();assert.equal(await h.page.locator('#contentDrawer').evaluate(el=>el.open),true);
   const drawer=await h.page.locator('#contentDrawer').boundingBox();assert.ok(drawer.width>=width-2&&drawer.height>=898,'drawer occupies viewport');
   await h.page.locator('#messageText').fill('合成文字');await h.page.locator('#addImageMode').click();assert.equal(await h.page.locator('#messageMode').inputValue(),'official_composite');await h.page.keyboard.press('Escape');assert.equal(await h.page.locator('#contentDrawer').evaluate(el=>el.open),false);await h.openEditor();assert.equal(await h.page.locator('#messageText').inputValue(),'合成文字');assert.equal(await h.page.locator('#messageMode').inputValue(),'official_composite');
   await h.page.locator('#pushImageFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});
   assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
   await h.page.locator('#uploadImageBtn').click();await h.page.locator('#uploadStatus').filter({hasText:'正在壓縮並上傳'}).waitFor();assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(await h.page.locator('#messageMode').isDisabled(),true);assert.equal(await h.page.locator('#imageOriginalUrl').isDisabled(),true);assert.equal(await h.page.locator('#imagePreviewUrl').isDisabled(),true);
   gate.resolve();await h.page.locator('#uploadStatus').filter({hasText:'圖片已上傳'}).waitFor();assert.equal(h.uploads.length,1);
   assert.match(h.uploads[0].contentType,/multipart\/form-data/);const dims=jpegSizeFromMultipart(h.uploads[0].body);assert.equal(dims.width,1024);assert.equal(dims.height,768);assert.ok(dims.bytes<1000000);
   assert.equal(await h.page.locator('#messagePreview img').count(),1);assert.match(await h.page.locator('#messagePreview').innerText(),/合成文字/);assert.equal(await h.page.locator('#previewMessageHint').innerText(),'文字與圖片會依序作為兩則訊息。');assert.deepEqual(await h.page.locator('#messagePreview').evaluate(el=>[...el.children].map(x=>x.tagName)),['DIV','IMG']);const gap=await h.page.locator('#messagePreview').evaluate(el=>el.children[1].getBoundingClientRect().top-el.children[0].getBoundingClientRect().bottom);assert.ok(gap>0,'text and image render in separate bubbles');if(process.env.DRAWER_SCREENSHOTS){await mkdir(process.env.DRAWER_SCREENSHOTS,{recursive:true});await h.page.screenshot({path:process.env.DRAWER_SCREENSHOTS+'/drawer-'+width+'.png'});}
   await h.preview();const snapshot=h.calls.findLast(call=>call.action==='preview');assert.deepEqual(snapshot.message,{mode:'official_composite',text:'合成文字',originalContentUrl:origin+'/mock-push-image.jpg',previewImageUrl:origin+'/mock-push-image.jpg'});
   await h.openEditor();await h.page.locator('#pushImageFile').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);
   await h.page.locator('#removeImageBtn').click();assert.equal(await h.page.locator('#messagePreview img').count(),0);assert.match(await h.page.locator('#messagePreview').innerText(),/合成文字/);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
   await h.preview();const withoutImage=h.calls.findLast(call=>call.action==='preview');assert.deepEqual(withoutImage.message,{mode:'official_composite',text:'合成文字',originalContentUrl:'',previewImageUrl:''});
   assert.equal(h.calls.filter(call=>call.action==='send').length,0);await h.clean();
  }finally{await h.close();}
 });}finally{await browser.close();}
});

test('failed image upload cannot retain a valid preview or silently send stale content',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),h=await setup(browser,{uploadFail:true});
 try{await h.selectAll();await h.preview();await h.openEditor();await h.page.locator('#addImageMode').click();await h.page.locator('#messageText').fill('保留的文字');await h.page.locator('#officialImageFields summary').click();await h.page.locator('#imageOriginalUrl').fill('https://synthetic.invalid/original.jpg');await h.page.locator('#imagePreviewUrl').fill('https://synthetic.invalid/preview.jpg');await h.page.locator('#pushImageFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});await h.page.locator('#uploadImageBtn').click();await h.page.locator('#uploadStatus').filter({hasText:'模擬圖片上傳失敗'}).waitFor();assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(await h.page.locator('#messageText').inputValue(),'保留的文字');assert.equal(await h.page.locator('#imageOriginalUrl').inputValue(),'https://synthetic.invalid/original.jpg');assert.equal(await h.page.locator('#imagePreviewUrl').inputValue(),'https://synthetic.invalid/preview.jpg');await h.page.locator('#cancelImageBtn').click();assert.equal(await h.page.locator('#imageOriginalUrl').inputValue(),'https://synthetic.invalid/original.jpg');assert.equal(await h.page.locator('#imagePreviewUrl').inputValue(),'https://synthetic.invalid/preview.jpg');assert.equal(await h.page.locator('#previewBtn').isDisabled(),false);await h.page.locator('#pushImageFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);await h.page.locator('#removeImageBtn').click();assert.equal(await h.page.locator('#previewBtn').isDisabled(),false);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(h.calls.filter(call=>call.action==='send').length,0);await h.clean();}finally{await h.close();await browser.close();}
});


test('composite preview allows original image as preview and rejects incomplete or empty content',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),h=await setup(browser);
 try{
  await h.selectAll();await h.openEditor();await h.page.locator('#addImageMode').click();await h.page.locator('#messageText').fill('');await h.page.locator('#officialImageFields summary').click();await h.page.locator('#imageOriginalUrl').fill('https://synthetic.invalid/original.jpg');await h.preview();
  assert.deepEqual(h.calls.findLast(x=>x.action==='preview').message,{mode:'official_composite',text:'',originalContentUrl:'https://synthetic.invalid/original.jpg',previewImageUrl:'https://synthetic.invalid/original.jpg'});
  await h.openEditor();await h.page.locator('#imageOriginalUrl').fill('');await h.page.locator('#imagePreviewUrl').fill('https://synthetic.invalid/preview.jpg');const count=h.calls.filter(x=>x.action==='preview').length;await h.page.locator('#contentDrawerClose').click();await h.page.locator('#previewBtn').click();await h.page.locator('#workflowStatus').filter({hasText:'請提供有效的 HTTPS'}).waitFor();assert.equal(h.calls.filter(x=>x.action==='preview').length,count);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
  await h.openEditor();await h.page.locator('#removeImageBtn').click();await h.page.locator('#contentDrawerClose').click();await h.page.locator('#previewBtn').click();await h.page.locator('#workflowStatus').filter({hasText:'請輸入文字或加入圖片'}).waitFor();assert.equal(h.calls.filter(x=>x.action==='preview').length,count);assert.equal(h.calls.filter(x=>x.action==='send').length,0);await h.clean();
 }finally{await h.close();await browser.close();}
});


test('HEIC with empty MIME is decoded by device or fails without losing content',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),h=await setup(browser);
 try{
  await h.openEditor();await h.page.locator('#messageText').fill('手機測試文字');await h.page.locator('#addImageMode').click();
  await h.page.locator('#pushImageFile').setInputFiles({name:'photo.heic',mimeType:'',buffer:Buffer.from('not an image')});await h.page.locator('#uploadImageBtn').click();await h.page.locator('#uploadStatus').filter({hasText:'此裝置無法讀取圖片，請改用 JPG 或 PNG'}).waitFor();assert.equal(await h.page.locator('#messageText').inputValue(),'手機測試文字');assert.equal(h.uploads.length,0);await h.page.locator('#cancelImageBtn').click();
  await h.page.locator('#pushImageFile').setInputFiles({name:'photo.heic',mimeType:'',buffer:await syntheticPng(h.page)});await h.page.locator('#uploadImageBtn').click();await h.page.locator('#uploadStatus').filter({hasText:'圖片已上傳'}).waitFor();assert.equal(h.uploads.length,1);const dims=jpegSizeFromMultipart(h.uploads[0].body);assert.equal(dims.width,1024);assert.equal(dims.height,768);assert.equal(await h.page.locator('#messageText').inputValue(),'手機測試文字');assert.equal(h.calls.filter(x=>x.action==='send').length,0);await h.clean();
 }finally{await h.close();await browser.close();}
});


test('custom Flex card builds a bounded bubble and preserves review safeguards',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),h=await setup(browser,{width:390});
 try{
  await h.selectAll();await h.openEditor();await h.page.locator('#messageMode').selectOption('system_card');
  await h.page.locator('#flexCardTitle').fill('年度活動');await h.page.locator('#flexCardBody').fill('歡迎參加\n請準時入場');await h.page.locator('#flexCardButton').fill('查看詳情');await h.page.locator('#flexCardUrl').fill('https://example.com/event');
  await h.page.locator('#flexCardImageOpen').click();await h.page.locator('#pushImageFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});
  assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);await h.page.locator('#uploadImageBtn').click();await h.page.locator('#uploadStatus').filter({hasText:'圖片已上傳'}).waitFor();
  assert.equal(await h.page.locator('.flex-card-preview img').count(),1);assert.match(await h.page.locator('.flex-card-preview').innerText(),/年度活動/);
  await h.page.locator('#dismissImageChoice').click();assert.equal(await h.page.locator('#messageMode').inputValue(),'system_card');assert.equal(await h.page.locator('#flexCardTitle').inputValue(),'年度活動');assert.equal(await h.page.locator('#officialImageFields').isVisible(),false);
  await h.preview();const message=h.calls.findLast(x=>x.action==='preview').message;assert.equal(message.mode,'system_json');assert.equal(message.altText,'年度活動');assert.equal(message.contents.type,'bubble');assert.equal(message.contents.hero.url,origin+'/mock-push-image.jpg');assert.equal(message.contents.body.contents[1].text,'歡迎參加\n請準時入場');assert.deepEqual(message.contents.footer.contents[0].action,{type:'uri',label:'查看詳情',uri:'https://example.com/event'});
  await h.openEditor();await h.page.locator('#flexCardBody').fill('修改後內容');assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
  await h.page.locator('#flexCardUrl').fill('http://example.com');await h.page.locator('#contentDrawerClose').click();const count=h.calls.filter(x=>x.action==='preview').length;await h.page.locator('#previewBtn').click();await h.page.locator('#workflowStatus').filter({hasText:'HTTPS'}).waitFor();assert.equal(h.calls.filter(x=>x.action==='preview').length,count);
  await h.openEditor();await h.page.locator('#flexCardUrl').fill('');await h.page.locator('#flexCardButton').fill('');await h.page.locator('#flexCardTitle').fill('');await h.page.locator('#contentDrawerClose').click();await h.page.locator('#previewBtn').click();await h.page.locator('#workflowStatus').filter({hasText:'卡片標題'}).waitFor();assert.equal(h.calls.filter(x=>x.action==='send').length,0);await h.clean();
 }finally{await h.close();await browser.close();}
});

test('desktop Flex review is invalidated by each content edit and X cancels image selection',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'}),h=await setup(browser,{width:1366});
 try{
  await h.selectAll();await h.openEditor();await h.page.locator('#messageMode').selectOption('system_card');
  await h.page.locator('#flexCardTitle').fill('活動資訊');await h.page.locator('#flexCardBody').fill('內文');
  await h.page.locator('#flexCardButton').fill('查看');await h.page.locator('#flexCardUrl').fill('https://example.com/first');
  await h.page.locator('#flexCardImageOpen').click();await h.page.locator('#pushImageFile').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});
  assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);
  await h.page.locator('#dismissImageChoice').click();assert.equal(await h.page.locator('#officialImageFields').isVisible(),false);
  assert.equal(await h.page.locator('#pushImageFile').evaluate(el=>el.files.length),0);assert.equal(h.uploads.length,0);
  assert.equal(await h.page.locator('#previewBtn').isDisabled(),false);assert.equal(await h.page.locator('#messageMode').inputValue(),'system_card');
  await h.page.locator('#contentDrawerDismiss').click();assert.equal(await h.page.locator('#contentDrawer').evaluate(el=>el.open),false);
  await h.openEditor();assert.equal(await h.page.locator('#flexCardTitle').inputValue(),'活動資訊');
  for(const [field,value] of [['flexCardTitle','更新標題'],['flexCardBody','更新內文'],['flexCardButton','了解更多'],['flexCardUrl','https://example.com/updated']]){
   await h.preview();await h.openEditor();await h.page.locator('#'+field).fill(value);assert.equal(await h.page.locator('#sendBtn').isDisabled(),true,field+' invalidates preview');
  }
  await h.page.locator('#flexCardImageOpen').click();await h.page.locator('#officialImageFields summary').click();
  await h.page.locator('#imageOriginalUrl').fill('https://synthetic.invalid/original.jpg');await h.preview();
  assert.equal(h.calls.findLast(x=>x.action==='preview').message.contents.hero.url,'https://synthetic.invalid/original.jpg');
  await h.openEditor();await h.page.locator('#imageOriginalUrl').fill('https://synthetic.invalid/preview.jpg');assert.equal(await h.page.locator('#sendBtn').isDisabled(),true,'image URL invalidates preview');
  await h.preview();await h.openEditor();await h.page.locator('#pushImageFile').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:await syntheticPng(h.page)});
  assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);assert.equal(await h.page.locator('#previewBtn').isDisabled(),true);
  await h.page.locator('#dismissImageChoice').click();assert.equal(await h.page.locator('#pushImageFile').evaluate(el=>el.files.length),0);
  assert.equal(await h.page.locator('#imageOriginalUrl').inputValue(),'https://synthetic.invalid/preview.jpg');assert.equal(await h.page.locator('#sendBtn').isDisabled(),true);
  assert.equal(h.calls.filter(x=>x.action==='send').length,0);await h.clean();
 }finally{await h.close();await browser.close();}
});
