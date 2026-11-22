import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkspaceDashboardFlex} from '../src/workspace/dashboard-flex.js';
import {handleDashboardSummaryIntent} from '../src/workspace/dashboard-handler.js';
import {editorChatCard} from '../src/editor-ui.js';
const STORY='https://liff.line.me/2009117474-pwyW1R4u/activity-stories-admin';
const original=['action=workspace.activity.create','action=workspace.richmenu.change','action=workspace.push.create','action=workspace.vendor.review','action=workspace.chat.monitor','action=workspace.risk.list'];
test('authorized dashboard preserves six actions and adds the LIFF story entry',async()=>{
 const result=await handleDashboardSummaryIntent({lineUserId:'U_admin',findAdmin:async()=>({admin:true}),loadSummary:async()=>({}),storyUri:STORY});
 assert.equal(result.authorized,true);const rows=result.message.contents.footer.contents;assert.equal(rows.length,4);
 assert.deepEqual(rows.slice(0,3).flatMap(row=>row.contents.map(button=>button.action.data)),original);
 const link=rows[3].contents[0].action;assert.deepEqual(link,{type:'uri',label:'活動花絮',uri:STORY});
});
test('dashboard identity is still required and unsafe story links are rejected',async()=>{
 const result=await handleDashboardSummaryIntent({lineUserId:'U_none',findAdmin:async()=>null,loadSummary:async()=>{throw Error('must not run')},storyUri:STORY});assert.equal(result.authorized,false);assert.equal(result.message,undefined);
 for(const storyUri of ['https://liff.line.me.attacker.invalid/path','http://liff.line.me/x','javascript:alert(1)',''])assert.equal(buildWorkspaceDashboardFlex({},new Date(),{storyUri}).contents.footer.contents.length,3);
});
test('LINE editor cards expose story entry only for activity and club editors',()=>{
 for(const role of ['activity_editor','club_editor']){const actions=editorChatCard(role,'https://test.invalid',STORY).contents.footer.contents.map(x=>x.action);assert.equal(actions[0].label,'開啟我的工作區');assert.deepEqual(actions[1],{type:'uri',label:'活動花絮',uri:STORY});}
 const welfare=editorChatCard('welfare_editor','https://test.invalid',STORY);assert.equal(welfare.contents.footer.contents.length,1);
 assert.equal(editorChatCard('club_editor','https://test.invalid','https://evil.invalid').contents.footer.contents.length,1);
 assert.equal(editorChatCard('outsider','https://test.invalid',STORY),null);
});
