import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const handler=source.match(/async function handleVendorManagementAction\([^]*?\n\}/)?.[0];
assert.ok(handler);

test('補件 Telegram shows the event target and truthful provider status without re-notifying replays',async()=>{
  const eventUid='U'+'1'.repeat(32),changedApplicant='U'+'2'.repeat(32);
  for(const [state,uid,status] of [
    ['accepted',eventUid,/LINE 已接受推播，實際送達尚未確認/],
    ['failed',eventUid,/LINE 拒絕推播/],
    ['unknown',eventUid,/結果未確認，請勿重複推送/],
    ['skipped_unverified','',/身分未驗證，未推送/],
    ['skipped_missing_recipient','',/沒有有效申請人 LINE UID，未推送/],
    ['skipped_disabled',eventUid,/未設定，未推送/],
  ]){
    let sends=[];let replayed=false;
    const ctx=vm.createContext({URL,console,crypto,
      requestVendorSupplement:async()=>({success:true,replayed,data:{notification:{state,recipient_uid:uid},vendor:{submitted_by_line_user_id:changedApplicant}}}),
      authorizeVendorSupplementAdmin:async()=>({id:'admin'}),requireAdmin:async()=>{},
      getVendorNotifySnapshot:async()=>({name:'示範商家',submitted_by_line_user_id:changedApplicant}),
      vendorNotifyLines:(_title,vendor)=>['廠商：'+vendor.name],
      sendTelegramNotification:async(_db,_env,key,lines)=>sends.push({key,lines}),
    });
    vm.runInContext(handler,ctx);
    const invoke=()=>ctx.handleVendorManagementAction(new Request('https://example.test/admin-api/vendor-management',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'vendor.status',data:{id:'vendor',status:'needs_supplement'}})}),{},{});
    assert.equal((await invoke()).success,true);
    assert.equal(sends.length,1);
    const output=sends[0].lines.join('\n');
    assert.match(output,/廠商：示範商家/);
    assert.match(output,status);
    assert.ok(output.includes(uid||'未記錄'));
    assert.ok(!output.includes(changedApplicant));
    replayed=true;
    assert.equal((await invoke()).success,true);
    assert.equal(sends.length,1);
  }
});
