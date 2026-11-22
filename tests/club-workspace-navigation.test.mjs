import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildClubAdminHtml} from '../src/club-admin-ui.js';
import {Node,script,settle,environment,workspace} from './helpers/editor-ui-vm.mjs';

test('verified club workspace separates four purposes and maps them to existing pages without writes', async () => {
  const app = await workspace('club_editor', {pending: true});
  assert.equal(app.buttons.length, 0, 'No functions shown before role verification');
  app.release(); await settle();
  const expected = [
    ['社團資料', '/club-admin?embedded=1&section=club'],
    ['社團活動／報名簽到', '/activity-checkin-admin?embedded=1'],
    ['社團相簿', '/club-admin?embedded=1&section=gallery'],
    ['社團文章與花絮', '/activity-stories-admin?embedded=1']
  ];
  assert.equal(app.buttons.length, expected.length);
  assert.equal(app.nodes.get('#club-scope').hidden, false);
  assert.match(app.html, /社團資料／活動／相簿：全部社團；文章與花絮：已授權社團/);
  for (const [index, [label, url]] of expected.entries()) {
    const b = app.buttons[index]; assert.ok(b.textContent.startsWith(label)); b.click();
    assert.equal(app.frame.src, url); app.loaded();
    assert.equal(app.nodes.get('#current-section').textContent, label);
    assert.equal(b.getAttribute('aria-pressed'), 'true');
    assert.equal(app.frame.title, label);
  }
  assert.deepEqual(app.calls, [{url: '/admin-api/editor-context', method: 'GET'}]);
});

test('cancelled or mismatched iframe navigation keeps the previous selected section', async () => {
  const app = await workspace('club_editor'); app.loaded();
  app.buttons[2].click();
  assert.equal(app.nodes.get('#current-section').textContent, '社團資料', 'Selection waits for frame navigation');
  app.loaded('/club-admin?embedded=1&section=club');
  assert.equal(app.buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(app.nodes.get('#current-section').textContent, '社團資料');
  app.loaded();
  assert.equal(app.nodes.get('#current-section').textContent, '社團相簿');
});

test('new club navigation cannot introduce a page absent from verified preset', async () => {
  const app = await workspace('club_editor', {allowedPages: ['/club-admin']});
  assert.equal(app.buttons.length, 2);
  for (const button of app.buttons) { button.click(); assert.equal(new URL(app.frame.src, 'https://isolated.test').pathname, '/club-admin'); }
});

test('welfare editor retains its original page entry; admins retain preset overview', async () => {
  for (const [role, urls] of [
    ['welfare_editor', ['/welfare-editor?embedded=1']]
  ]) {
    const app = await workspace(role);
    assert.equal(app.buttons.length, urls.length);
    assert.equal(app.nodes.get('#club-scope').hidden, true);
    assert.equal(app.document.body.dataset.workspace, undefined);
    for (const [i, button] of app.buttons.entries()) { button.click(); assert.equal(app.frame.src, urls[i]); assert.equal(button.getAttribute('aria-pressed'), 'true'); }
  }
  const admin = await workspace('admin');
  assert.equal(admin.buttons.length, 0); assert.equal(admin.nodes.get('#presets').hidden, false);
  assert.equal(admin.nodes.get('#presets').children.length, 3);
});

async function clubPage({role = 'club_editor', section = 'gallery', failActivities = false, pending = false} = {}) {
  const html = buildClubAdminHtml(), env = environment(html, 'https://isolated.test/club-admin?embedded=1&section=' + encodeURIComponent(section));
  const form = env.nodes.get('#editor'), fields = new Map(), requests = [];
  for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*\bname="([^"]+)"[^>]*>/g)) {
    const id = match[0].match(/\bid="([^"]+)"/), node = id ? env.nodes.get('#' + id[1]) : new Node(match[1]);
    node.name = match[2]; fields.set(node.name, node);
  }
  const translations = env.nodes.get('#translations');
  translations.append = node => { translations.children.push(node); for (const input of node.children) fields.set(input.name, input); };
  form.elements = {namedItem: name => fields.get(name)};
  form.reset = () => { for (const node of fields.values()) { node.value = ''; node.checked = false; } };
  const scoped = [...html.matchAll(/data-kinds="([^"]+)"/g)].map(m => { const n = new Node(); n.dataset.kinds = m[1]; return n; });
  form.querySelectorAll = selector => selector === '[data-kinds]' ? scoped : [];
  env.nodes.get('#kind').value = 'club';
  const back = env.document.querySelector('header a[href="/sakura-admin"]'); back.href = '/sakura-admin';
  const records = {success: true, club: [{id: 'club-1', title: '合成社團', status: 'active'}], gallery: [{id: 'album-1', club_id: 'club-1', title: '合成相簿', media_ids: []}], activity: [], media: []};
  let release;
  env.context.fetch = async (url, init = {}) => {
    requests.push({url, method: init.method || 'GET'});
    assert.equal(init.method || 'GET', 'GET', 'Test must never write');
    if (url === '/admin-api/clubs') return Response.json(records);
    if (url === '/admin-api/activity-checkin') {
      if (pending) await new Promise(resolve => { release = resolve; });
      return failActivities ? Response.json({success: false, message: 'Denied'}, {status: 403}) : Response.json({success: true, editor_role: role, events: []});
    }
    throw Error('Unexpected request: ' + url);
  };
  vm.runInNewContext(script(html), env.context);
  await settle();
  return {...env, fields, form, requests, release, back, scoped, records};
}

test('club section opens only after successful authenticated role response; unknown/forged values have no effect', async () => {
  const pending = await clubPage({pending: true});
  assert.equal(pending.nodes.get('#kind').value, 'club');
  pending.release(); await settle();
  assert.equal(pending.nodes.get('#kind').value, 'gallery');
  assert.equal(pending.nodes.get('#heading').textContent, '社團相簿');
  assert.equal(pending.back.href, '/editor-workspace'); assert.equal(pending.back.target, '_top');
  assert.match(pending.nodes.get('#message').textContent, /全部社團/);
  for (const options of [{role: 'admin'}, {role: 'activity_editor'}, {role: ''}, {section: 'activity'}, {section: '../admin-uid-whitelist'}, {failActivities: true}]) {
    const app = await clubPage(options);
    assert.equal(app.nodes.get('#kind').value, 'club', JSON.stringify(options));
  }
});

test('section is initial navigation only: changing type and refreshing retains selection without saving', async () => {
  const app = await clubPage(), kind = app.nodes.get('#kind');
  assert.equal(kind.value, 'gallery');
  kind.value = 'club'; kind.onchange();
  await app.nodes.get('#refresh').click(); await settle();
  assert.equal(kind.value, 'club');
  assert.equal(app.nodes.get('#heading').textContent, '社團資料');
  assert.deepEqual(app.requests.map(x => x.method), ['GET', 'GET', 'GET', 'GET']);
  assert.equal(app.records.club.length, 1); assert.equal(app.records.gallery.length, 1);
});

test('unsaved club/album fields still prevent cancelled type switch, reload and unload without any writes', async () => {
  const app = await clubPage(), kind = app.nodes.get('#kind'), title = app.fields.get('title');
  title.value = '尚未儲存的相簿'; app.form.oninput({target: title});
  kind.value = 'club'; kind.onchange();
  assert.equal(kind.value, 'gallery'); assert.equal(title.value, '尚未儲存的相簿');
  await app.nodes.get('#refresh').click(); await settle();
  assert.equal(app.requests.length, 2, 'Cancelled reload must not reload data or write');
  let prevented = false;
  const event = {preventDefault() { prevented = true; }}; app.listeners.get('beforeunload')(event);
  assert.equal(prevented, true); assert.equal(event.returnValue, '');
  assert.equal(title.value, '尚未儲存的相簿');
});
