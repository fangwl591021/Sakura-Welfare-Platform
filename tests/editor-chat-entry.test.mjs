import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {editorWorkspaceHtml,editorChatCard} from '../src/editor-ui.js';
import {editorPresets} from '../src/editor-access.js';
import {environment,script,settle} from './helpers/editor-ui-vm.mjs';

test('chat entry accepts only safe LIFF destination for editor cards',()=>{
 const uri='https://liff.line.me/123-test/editor-workspace?line_login=1';
 for(const role of ['activity_editor','club_editor','welfare_editor'])assert.equal(editorChatCard(role,'https://test.invalid','',uri).contents.footer.contents[0].action.uri,uri);
 assert.equal(editorChatCard('outsider','https://test.invalid','',uri),null);
 assert.equal(editorChatCard('club_editor','https://test.invalid','','https://liff.line.me.evil.invalid/').contents.footer.contents[0].action.uri,'https://test.invalid/sakura-admin?line_login=1');
});
async function run(role,valid=true){
 const html=editorWorkspaceHtml(),e=environment(html,'https://isolated.test/editor-workspace?line_login=1'),calls=[],stored=[];
 e.context.localStorage={getItem:()=>null,setItem:(k,v)=>stored.push([k,JSON.parse(v)]),removeItem(){}};
 const preset=editorPresets().find(p=>p.role===role);let checked=0;e.context.URLSearchParams=URLSearchParams;e.context.history={replaceState(){}};
 e.context.liff=e.context.window.liff={init:async()=>{},isLoggedIn:()=>true,getProfile:async()=>({userId:'U-test'}),getIDToken:()=> 'mock-id',getAccessToken:()=> 'mock-access'};
 e.context.fetch=async(url,options)=>{calls.push([url,options?.method||'GET']);if(url==='/admin-api/editor-context'){checked++;return Response.json({success:true,role,editor:role!=='admin',preset,presets:role==='admin'?editorPresets():[]});}if(url==='/api'){assert.equal(JSON.parse(options.body).action,'reviewerLineLogin');return Response.json(valid?{success:true,data:{role,token:'mock-session'}}:{success:false,message:'未授權'});}throw Error('unexpected');};
 vm.runInNewContext(script(html),e.context);await settle();return {...e,calls,stored};
}
test('direct entry authenticates then queries current role before showing the workspace',async()=>{const e=await run('activity_editor');assert.equal(e.stored.length,1);assert.deepEqual(e.calls.map(x=>x[0]),['/api','/admin-api/editor-context']);assert.equal(e.nodes.get('#tabs').children.length,3);});
test('failed LINE verification leaves workspace closed',async()=>{const e=await run('activity_editor',false);assert.equal(e.stored.length,0);assert.equal(e.nodes.get('#tabs').children.length,0);assert.equal(e.nodes.get('#notice').textContent,'未授權');});



test('verified administrator enters the workspace without changing role and sees all editor areas',async()=>{const e=await run('admin');assert.equal(e.stored[0][1].role,'admin');assert.equal(e.nodes.get('#presets').children.length,3);assert.match(e.nodes.get('#presets').textContent,/活動/);assert.match(e.nodes.get('#presets').textContent,/社團/);assert.match(e.nodes.get('#presets').textContent,/福利/);});
