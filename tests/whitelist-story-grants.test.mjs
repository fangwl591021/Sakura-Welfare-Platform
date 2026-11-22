import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.js';
import {EDITOR_ROLES} from '../src/editor-access.js';
import {editorFixture} from './editor-roles.test.mjs';

test('whitelist exposes one activity story module option without the extra grant panel or API calls',async()=>{
 const f=editorFixture();try{
  const data=await(await f.call('/admin-api/admin-uid-whitelist')).json();
  assert.deepEqual(data.moduleOptions.filter(option=>option.id==='activity-stories'),[{id:'activity-stories',label:'活動花絮'}]);
  const response=await worker.fetch(new Request('https://activity.test/admin-uid-whitelist'),{},{});
  const html=await response.text();assert.equal(response.status,200);
  assert.match(html,/id="moduleChecks"/);
  assert.doesNotMatch(html,/whitelist-story-grants|儲存單位授權|重新載入授權|\/admin-api\/activity-story-grants/);
  for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 }finally{f.close();}
});
test('existing eligible editor presets show the story module without changing roles or unit gates',()=>{
 assert.deepEqual(EDITOR_ROLES.activity_editor.modules,['activities']);
 assert.equal(EDITOR_ROLES.activity_editor.pages.some(page=>page.url==='/activity-stories-admin'),true);
 assert.deepEqual(EDITOR_ROLES.club_editor.modules,['clubs']);
 assert.equal(EDITOR_ROLES.club_editor.pages.some(page=>page.url==='/activity-stories-admin'),true);
 assert.equal(EDITOR_ROLES.welfare_editor.modules.includes('activity-stories'),false);
});
test('legacy grants URL goes to the common whitelist page',async()=>{
 const response=await worker.fetch(new Request('https://activity.test/activity-story-grants'),{},{});
 assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'https://activity.test/admin-uid-whitelist');
});
