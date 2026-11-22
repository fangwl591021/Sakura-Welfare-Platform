import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {activityEditorSections} from '../src/activity-form-ui.js';
import worker from '../src/index.js';
import {Node,workspace,settle} from './helpers/editor-ui-vm.mjs';

test('verified activity editor gets three purposes, with truthful scope and existing allowed page paths', async () => {
  const app = await workspace('activity_editor', {pending:true});
  assert.equal(app.buttons.length, 0);
  app.release(); await settle();
  assert.equal(app.buttons.length, 3);
  assert.deepEqual(app.buttons.map(b => b._text), ['活動管理','報名簽到','文章與花絮']);
  assert.equal(app.frame.src, '/activity-checkin-admin?embedded=1&section=manage');
  app.loaded();
  assert.equal(app.nodes.get('#activity-scope').hidden, false);
  assert.equal(app.nodes.get('#club-scope').hidden, true);
  assert.match(app.html, /活動管理／報名簽到：一般活動（非社團活動）；文章與花絮：福委會/);
  app.buttons[2].click();
  assert.equal(app.frame.src, '/activity-stories-admin?embedded=1');
  assert.equal(app.nodes.get('#current-section').textContent, '活動管理');
  app.loaded();
  assert.equal(app.nodes.get('#current-section').textContent, '文章與花絮');
  assert.deepEqual(app.calls, [{url:'/admin-api/editor-context',method:'GET'}]);
  const limited = await workspace('activity_editor', {allowedPages:['/activity-checkin-admin']});
  assert.equal(limited.buttons.length, 2);
});

test('switching management and attendance reuses the same iframe and activates only an accepted section', async () => {
  const app = await workspace('activity_editor'); app.loaded();
  const frameWindow = app.frame.contentWindow, originalSrc = app.frame.src, sections = [];
  frameWindow.sakuraActivityWorkspace = {setSection(section) { sections.push(section); return true; }};
  app.buttons[1].click();
  assert.deepEqual(sections, ['attendance']);
  assert.equal(app.frame.src, originalSrc);
  assert.equal(app.frame.contentWindow, frameWindow);
  assert.equal(app.nodes.get('#current-section').textContent, '報名簽到');
  app.buttons[0].click();
  assert.deepEqual(sections, ['attendance','manage']);
  assert.equal(app.frame.src, originalSrc);
  frameWindow.sakuraActivityWorkspace.setSection = () => false;
  app.buttons[1].click();
  assert.equal(app.nodes.get('#current-section').textContent, '活動管理');
});

test('workspace accepts section notifications only from its own same-origin activity iframe', async () => {
  const app = await workspace('activity_editor'); app.loaded();
  const notify = app.listeners.get('message'), source = app.frame.contentWindow;
  const data = {type:'sakura-activity-section-changed', section:'attendance'};
  for (const event of [
    {origin:'https://outside.test',source,data},
    {origin:'https://isolated.test',source:{},data},
    {origin:'https://isolated.test',source,data:{...data,section:'admin'}},
    {origin:'https://isolated.test',source,data:{...data,type:'other'}}
  ]) { notify(event); assert.equal(app.nodes.get('#current-section').textContent, '活動管理'); }
  notify({origin:'https://isolated.test',source,data});
  assert.equal(app.nodes.get('#current-section').textContent, '報名簽到');
  source.location = new URL('https://isolated.test/activity-stories-admin');
  notify({origin:'https://isolated.test',source,data:{...data,section:'manage'}});
  assert.equal(app.nodes.get('#current-section').textContent, '報名簽到');
});

function sectionApp({query='attendance', allowChange=true, failSelection=false, scannerBusy=false}={}) {
  const ids = new Map(), all = [], messages = [], calls = [], listeners = new Map();
  class Element extends Node {
    constructor(tag='div', id='') {
      super(tag); this.id=id; this.classes=new Set(); this.classList={add:(...names)=>names.forEach(n=>this.classes.add(n)),contains:n=>this.classes.has(n)};
      this.matches=new Map(); this.containers=new Map(); all.push(this); if(id)ids.set(id,this);
    }
    querySelector(s) { return this.matches.get(s)||null; }
    closest(s) { return this.containers.get(s)||null; }
    after(node) { const register=n=>{if(n.id)ids.set(n.id,n);for(const child of n.children)register(child);}; register(node); }
  }
  const body = new Element('body'), top = new Element('div'), title = new Element('h1'), hint = new Element('div'), heading = new Element('h2');
  title.textContent='活動簽到管理'; hint.textContent='原有提示'; heading.textContent='活動列表與出席統計';
  top.matches.set('h1',title); top.matches.set('.hint',hint); top.matches.set('a[href="#af-section"]',new Element('a'));
  const formPanel=new Element('section'), listPanel=new Element('section'), attendanceTable=new Element('table'); listPanel.matches.set('h2',heading);
  for (const id of ['eventForm','calendarBox','af-event-list','af-section','af-registration','qrPanel','af-roster','af-attendance-heading','aq-start','aq-section','aq-close','aq-event','attendanceRows','eventRows','af-registration-settings']) new Element('div',id);
  ids.get('aq-section').hidden=true;
  let scannerCloses=0,scannerStarts=0;
  ids.get('aq-close').onclick=()=>{scannerCloses++;if(!scannerBusy)ids.get('aq-section').hidden=true;};
  ids.get('aq-start').onclick=()=>{scannerStarts++;};
  ids.get('eventForm').containers.set('.panel',formPanel); ids.get('eventRows').containers.set('.panel',listPanel); ids.get('attendanceRows').containers.set('table',attendanceTable);
  const basicDraft = new Element('input'), registrationDraft = new Element('textarea');
  basicDraft.value='尚未儲存活動名稱'; registrationDraft.value='尚未儲存報名欄位';
  let settingsCalls=0; ids.get('af-registration-settings').onclick=()=>{settingsCalls++;};
  const document={body,createElement:tag=>new Element(tag),getElementById:id=>ids.get(id)||null,
    querySelector:s=>s==='.top'?top:s==='.ae-section-heading'?all.find(n=>n.classes.has('ae-section-heading'))||null:null};
  const location=new URL('https://isolated.test/activity-checkin-admin?section='+encodeURIComponent(query));
  const window={parent:{postMessage:(data,origin)=>messages.push({data,origin})},addEventListener:(name,fn)=>listeners.set(name,fn)};
  const env={window,document,location,URL,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},fetch:()=>{throw Error('Navigation must not fetch');}};
  const data={editor_role:'activity_editor',selected_event_id:'event-a',events:[{id:'event-a',title:'活動甲'},{id:'event-b',title:'活動乙'}]};
  const factory=vm.runInNewContext('('+activityEditorSections+')',env);
  let api;
  api=factory(async id=>{calls.push(id);if(failSelection)throw Error('read failed');data.selected_event_id=id;api.update(data);},()=>allowChange);
  return {api,window,document,ids,body,data,calls,messages,heading,formPanel,attendanceTable,basicDraft,registrationDraft,title,hint,settingsCalls:()=>settingsCalls,scannerCloses:()=>scannerCloses,scannerStarts:()=>scannerStarts};
}

test('section query is only presentation after verified activity role; other roles and invalid inputs cannot activate it', () => {
  const app=sectionApp();
  assert.equal(app.window.sakuraActivityWorkspace.setSection('attendance'),false);
  assert.equal(app.body.dataset.activityWorkspace,undefined);
  for (const role of ['admin','club_editor','welfare_editor','',undefined]) {
    app.api.update({...app.data,editor_role:role});
    assert.equal(app.body.dataset.activityWorkspace,undefined);
    assert.equal(app.ids.has('ae-event'),false);
  }
  app.api.update(app.data);
  assert.equal(app.body.dataset.activityWorkspace,'attendance');
  assert.equal(app.ids.get('ae-event').value,'event-a');
  assert.equal(app.window.sakuraActivityWorkspace.setSection('system'),false);
  assert.equal(app.body.dataset.activityWorkspace,'attendance');
  app.api.update({...app.data,editor_role:'club_editor'});
  assert.equal(app.body.dataset.activityWorkspace,undefined);
  assert.equal(app.ids.get('ae-picker').hidden,true);
  assert.equal(app.title.textContent,'活動簽到管理');
  assert.equal(app.heading.textContent,'活動列表與出席統計');
  const invalid=sectionApp({query:'../../admin-uid-whitelist'});invalid.api.update(invalid.data);
  assert.equal(invalid.body.dataset.activityWorkspace,'manage');
});

test('section groups reuse original nodes, keep selected event and both drafts, and perform no fetch or write', () => {
  const app=sectionApp({query:'manage'});app.api.update(app.data);
  const picker=app.ids.get('ae-event');
  assert.ok(app.formPanel.classList.contains('ae-management-only'));
  for (const id of ['calendarBox','af-event-list','af-section']) assert.ok(app.ids.get(id).classList.contains('ae-management-only'));
  for (const id of ['af-registration','qrPanel','af-roster','af-attendance-heading','aq-start','aq-section']) assert.ok(app.ids.get(id).classList.contains('ae-attendance-only'));
  assert.ok(app.attendanceTable.classList.contains('ae-attendance-only'));
  for (const section of ['attendance','manage','attendance']) {
    assert.equal(app.window.sakuraActivityWorkspace.setSection(section),true);
    assert.equal(app.ids.get('ae-event'),picker);assert.equal(picker.value,'event-a');
    assert.equal(app.basicDraft.value,'尚未儲存活動名稱');assert.equal(app.registrationDraft.value,'尚未儲存報名欄位');
  }
  app.api.update(app.data);
  assert.equal(app.body.dataset.activityWorkspace,'attendance','Data refresh does not revert to initial query');
  assert.equal(app.data.selected_event_id,'event-a');assert.deepEqual(app.calls,[]);
  app.ids.get('af-registration-settings').click();
  assert.equal(app.body.dataset.activityWorkspace,'manage');assert.equal(app.settingsCalls(),1);
});

test('event picker uses the original selection callback once and cancelled or forged selections keep current event', async () => {
  const app=sectionApp();app.api.update(app.data);const select=app.ids.get('ae-event');
  select.value='event-b';await select.onchange();
  assert.deepEqual(app.calls,['event-b']);assert.equal(select.value,'event-b');assert.equal(app.data.selected_event_id,'event-b');
  select.value='outside-scope';await select.onchange();
  assert.equal(select.value,'event-b');assert.deepEqual(app.calls,['event-b']);
  select.value='event-b';await select.onchange();assert.deepEqual(app.calls,['event-b']);
  const cancelled=sectionApp({allowChange:false});cancelled.api.update(cancelled.data);
  cancelled.ids.get('ae-event').value='event-b';await cancelled.ids.get('ae-event').onchange();
  assert.equal(cancelled.ids.get('ae-event').value,'event-a');assert.deepEqual(cancelled.calls,[]);
  assert.equal(cancelled.basicDraft.value,'尚未儲存活動名稱');assert.equal(cancelled.registrationDraft.value,'尚未儲存報名欄位');
  const failed=sectionApp({failSelection:true});failed.api.update(failed.data);
  failed.ids.get('ae-event').value='event-b';await failed.ids.get('ae-event').onchange();
  assert.equal(failed.ids.get('ae-event').value,'event-a');assert.match(failed.ids.get('ae-selection-status').textContent,/切換未完成/);
  assert.equal(failed.data.selected_event_id,'event-a');assert.equal(failed.basicDraft.value,'尚未儲存活動名稱');
});

test('section and event changes reuse scanner close, refuse while busy and preserve original scanner start', async () => {
  const app=sectionApp();app.api.update(app.data);app.ids.get('aq-section').hidden=false;
  assert.equal(app.window.sakuraActivityWorkspace.setSection('manage'),true);
  assert.equal(app.scannerCloses(),1);assert.equal(app.ids.get('aq-section').hidden,true);
  app.window.sakuraActivityWorkspace.setSection('attendance');app.ids.get('ae-event').value='event-b';await app.ids.get('ae-event').onchange();
  app.ids.get('aq-start').click();assert.equal(app.scannerStarts(),1);
  assert.equal(app.ids.get('aq-event').children[0].value,'event-b');
  const busy=sectionApp({scannerBusy:true});busy.api.update(busy.data);busy.ids.get('aq-section').hidden=false;
  assert.equal(busy.window.sakuraActivityWorkspace.setSection('manage'),false);
  assert.equal(busy.body.dataset.activityWorkspace,'attendance');
  busy.ids.get('ae-event').value='event-b';await busy.ids.get('ae-event').onchange();
  assert.equal(busy.ids.get('ae-event').value,'event-a');assert.deepEqual(busy.calls,[]);
  assert.match(busy.ids.get('ae-selection-status').textContent,/正在處理/);
});

test('served activity page retains all original form, roster and check-in surfaces with section styles gated by role state', async () => {
  const response=await worker.fetch(new Request('https://isolated.test/activity-checkin-admin'),{},{});
  assert.equal(response.status,200);const html=await response.text();
  for (const id of ['eventForm','calendarBox','af-event-list','af-section','af-registration','qrPanel','af-roster','af-roster-dialog','attendanceRows','aq-start','aq-section']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/body\[data-activity-workspace=manage\] \.ae-attendance-only/);
  assert.match(html,/body\[data-activity-workspace=attendance\] \.ae-management-only/);
  assert.match(html,/editorSections\.update\(result\)/);
});
