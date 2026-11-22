import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import {isVendorBindingCommand,hasVendorBindingPayload,redactVendorBindingBody,redactVendorBindingPayload,partitionVendorBindingPayload} from '../src/vendor-line-binding.js';
import {isVendorBranchQrChatCandidate, partitionVendorQrForwardPayload} from '../src/vendor-branch-qr-chat.js';
import {isVendorBrandChatCandidate, partitionVendorBrandForwardPayload} from '../src/vendor-brand-chat.js';
import {buildWelfareShopMessage, isWelfareShopCommand, isWelfareShopEvent} from '../src/welfare-shop-chat.js';
import {
  LIFE_INFO_STATION_COMMANDS, lifeInfoStationLanguage, lifeInfoStationItemLanguage,
  buildLifeInfoStationMessage, partitionLifeInfoForwardPayload, signLifeInfoForwardPayload,
} from '../src/life-info-station.js';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const secret = 'synthetic-life-station-secret';
const event = (text = LIFE_INFO_STATION_COMMANDS.zh, id = 'one', sourceType = 'user') => ({
  type: 'message', source: { type: sourceType, userId: 'synthetic-user' },
  message: { type: 'text', id, text }, webhookEventId: id, replyToken: 'synthetic-reply-' + id, timestamp: 123456,
});
const sign = body => createHmac('sha256', secret).update(body).digest('base64');
const plain = value => JSON.parse(JSON.stringify(value));

function realFunction(name, context) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert.ok(match, name);
  const next = /^(?:async )?function |^const |^export /m.exec(source.slice(match.index + match[0].length));
  const end = next ? match.index + match[0].length + next.index : source.length;
  return vm.runInNewContext('(' + source.slice(match.index, end).trim() + ')', context);
}

function harness({ replyFailure = '', db = false, bindingGate = null, replyGate = null, bindingFailure = false, claimFailure = false, claimGate = null } = {}) {
  const replies = [], forwards = [], stored = [], storedPayloads = [], bindings = [], waits = [], detections = [], repairs = [], claims = new Set();
  const noop = async () => null;
  const context = {
    crypto, TextEncoder, Uint8Array, btoa, URL, Request, Response,
    lifeInfoStationItemLanguage, buildLifeInfoStationMessage, partitionLifeInfoForwardPayload, signLifeInfoForwardPayload,
    buildWelfareShopMessage, isWelfareShopCommand, isWelfareShopEvent,
    isVendorBindingCommand,hasVendorBindingPayload,redactVendorBindingBody,redactVendorBindingPayload,partitionVendorBindingPayload,
    isVendorBranchQrChatCandidate, partitionVendorQrForwardPayload, isVendorBrandChatCandidate, partitionVendorBrandForwardPayload,
    claimVendorLineEvent: async (_db,id,verified)=>{if(claimGate)await claimGate;if(claimFailure)throw Error('synthetic claim failure');if(!verified || !id || claims.has(id))return false;claims.add(id);return true;},
    consumeVendorLineCode: async (_db,item,verified)=>{bindings.push({text:item.text,verified});if(bindingGate)await bindingGate;if(bindingFailure)throw Error('synthetic db failure');return {success:true,message:'關聯完成'}} ,
    isMotherOnlyLineKeyword: text=>text==='會員分享', observeBindingChatStart:noop, findMatchingLineKeywordRule:noop, bindingChatLanguage:()=>'', storeLineKeywordHit:noop,
    DEFAULT_MOTHER_WEBHOOK_URL: 'https://mother.test/receive',
    getPublicOrigin: () => 'https://worker.test', buildLiffUrl: (_env, path) => 'https://liff.line.me/test-liff' + path,
    classifyMessageSentiment: () => ({ type: 'neutral', tags: [], action: '' }),
    storeWebhookIntake: noop, storeLineWebhookEvent: async (_db, item, payload) => {stored.push(plain(item));storedPayloads.push(plain(payload))}, storeLineThreadMessage: noop,
    detectBindingChatPayload: async body => { detections.push(body); }, handleEmployeeBindingPullMother: noop,
    repairRetiredMenuPayload: async body => { repairs.push(body); }, queueBindingNotifications: noop,
    recordEmployeeBindingRichMenuApply: noop,
    replyLineMessages: async (_env, token, messages) => {
      replies.push({ token, messages: plain(messages) });
      if(replyGate && token==='synthetic-reply-binding')await replyGate;
      if (replyFailure === 'throw') throw new Error('synthetic uncertain transport');
      return { ok: replyFailure !== 'http', status: replyFailure === 'http' ? 503 : 200 };
    },
    forwardLineWebhook: async (url, body, signature, type) => {
      forwards.push({ url, body, signature, type }); return { ok: true, status: 200 };
    },
    corsJson: value => Response.json(value),
  };
  for (const name of ['arrayBufferToBase64', 'timingSafeEqual', 'verifyLineSignature', 'buildFastLineEvent', 'processLineChildPayload', 'handleLineDualWebhook', 'handleLineChildWebhook']) context[name] = realFunction(name, context);
  const send = async (events, { signed = true, secretConfigured = true, route = 'dual', secondary = false, rawBody } = {}) => {
    const body = rawBody || JSON.stringify({ destination: 'synthetic-channel', events });
    const response = await context[route === 'dual' ? 'handleLineDualWebhook' : 'handleLineChildWebhook'](
      new Request('https://worker.test/line-' + (route === 'dual' ? 'webhook' : 'child-webhook'), {
        method: 'POST', body, headers: { 'x-line-signature': signed ? sign(body) : 'forged' },
      }),
      { LINE_CHANNEL_SECRET: secretConfigured ? secret : '', LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-token',
        ...(db ? { DB: {} } : {}), ...(secondary ? { CHILD_WEBHOOK_URL: 'https://secondary.test/child', MONITOR_WEBHOOK_URL: 'https://monitor.test/intake' } : {}) },
      { waitUntil: task => waits.push(task) },
    );
    while (waits.length) await Promise.all(waits.splice(0));
    const responseText = await response.text();
    return { response, body, json: responseText.startsWith('{') ? JSON.parse(responseText) : null };
  };
  return { send, replies, forwards, stored, storedPayloads, bindings, detections, repairs };
}

test('signed mixed binding and life-info batch owns reply once and never stores code',async()=>{
  const f=harness({db:true}),secretCode='V-'+'b'.repeat(24),binding=event(secretCode,'binding');binding.source.userId='U'+'1'.repeat(32);
  const result=await f.send([event(LIFE_INFO_STATION_COMMANDS.zh),binding],{secondary:true});
  assert.equal(result.response.status,200);assert.equal(f.forwards.length,0);assert.equal(f.replies.length,2);
  assert.equal(f.bindings.length,1);assert.equal(f.bindings[0].verified,true);
  assert.ok(!JSON.stringify(f.stored).includes(secretCode));assert.ok(!JSON.stringify(f.storedPayloads).includes(secretCode));
});
test('signed private shop keyword replies with one LIFF button and leaves other events to their owners',async()=>{
  const f=harness({db:true});
  const shop=event('員工福利品','shop');
  const result=await f.send([shop,structuredClone(shop),event('會員分享','normal')],{secondary:true});
  assert.equal(result.response.status,200);
  assert.equal(f.replies.length,1);
  assert.deepEqual(f.replies[0].messages[0].contents.footer.contents[0].action,{
    type:'uri',label:'開啟福利品商城',uri:'https://liff.line.me/test-liff/welfare-shop'
  });
  assert.equal(f.forwards.length,3);
  for(const forward of f.forwards){
    assert.deepEqual(JSON.parse(forward.body).events,[event('會員分享','normal')]);
    assert.equal(forward.signature,sign(forward.body));
  }
});
test('shop keyword is exact, private, and requires a signed delivery',async()=>{
  assert.equal(isWelfareShopEvent(event('員工福利品商城')),false);
  assert.equal(isWelfareShopEvent(event('員工福利品','group','group')),false);
  assert.equal(isWelfareShopEvent({...event('員工福利品'),replyToken:''}),false);
  const f=harness();
  assert.equal((await f.send([event('員工福利品')],{signed:false})).response.status,403);
  assert.equal(f.replies.length,0);
});
test('binding duplicate reply token is not consumed twice and missing secret fails closed',async()=>{
  const f=harness({db:true}),code='V-'+'c'.repeat(24),a=event(code,'dup');a.source.userId='U'+'2'.repeat(32);
  const b=structuredClone(a);const result=await f.send([a,b]);assert.equal(result.response.status,200);assert.equal(f.replies.length,1);
  assert.equal(f.bindings.filter(x=>x.verified).length,1);
  const noSecret=harness({db:true});const denied=await noSecret.send([a],{secretConfigured:false});assert.equal(denied.response.status,503);assert.equal(noSecret.forwards.length,0);assert.equal(noSecret.bindings.length,0);
});
for(const delayed of ['binding','reply'])test('slow vendor '+delayed+' does not delay normal mother forwarding',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve});
  const f=harness({db:true,...(delayed==='binding'?{bindingGate:gate}:{replyGate:gate})});
  const code='V-'+'d'.repeat(24),binding=event(code,'binding');binding.source.userId='U'+'3'.repeat(32);
  const pending=f.send([binding,event('會員分享','normal')]);
  try {
    const deadline=Date.now()+2000;while(!f.forwards.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.forwards.length,1);const forwarded=JSON.parse(f.forwards[0].body);assert.equal(forwarded.events.length,1);assert.equal(forwarded.events[0].message.text,'會員分享');
    assert.ok(!f.forwards[0].body.includes(code));assert.equal(f.forwards[0].signature,sign(f.forwards[0].body));
  } finally {release();await pending;}
});
test('failed vendor database or reply does not block another event or produce a second reply',async()=>{
  const f=harness({db:true,bindingFailure:true,replyFailure:'throw'}),binding=event('V-'+'e'.repeat(24),'binding');binding.source.userId='U'+'4'.repeat(32);
  const result=await f.send([binding,event('會員分享','normal')]);assert.equal(result.response.status,200);assert.equal(f.forwards.length,1);assert.equal(f.replies.length,1);
});
test('signed bare code is masked and never forwarded in a mixed batch',async()=>{
  const f=harness({db:true}),code='V-'+'f'.repeat(24),binding=event(' '+code+' ','binding');binding.source.userId='U'+'5'.repeat(32);
  const result=await f.send([binding,event('會員分享','normal')],{secondary:true});assert.equal(result.response.status,200);
  assert.equal(f.bindings.length,1);assert.equal(f.bindings[0].verified,true);assert.equal(f.replies.length,1);
  assert.equal(f.forwards.length,3);for(const forward of f.forwards){assert.ok(!forward.body.includes(code));assert.equal(JSON.parse(forward.body).events[0].message.text,'會員分享');assert.equal(forward.signature,sign(forward.body));}
  assert.ok(!JSON.stringify(f.stored).includes(code));assert.ok(!JSON.stringify(f.storedPayloads).includes(code));
});
test('same signed event delivered in separate requests has one owner',async()=>{
  const f=harness({db:true}),a=event('V-'+'a'.repeat(24),'unique-event-id');a.source.userId='U'+'7'.repeat(32);
  await f.send([a]);await f.send([a]);assert.equal(f.bindings.length,1);assert.equal(f.replies.length,1);
});
test('claim failure cannot bind or reply and does not stop ordinary forwarding',async()=>{
  const f=harness({db:true,claimFailure:true}),a=event('V-'+'b'.repeat(24),'unique-event-id');a.source.userId='U'+'8'.repeat(32);
  await f.send([a,event('會員分享','normal')]);assert.equal(f.bindings.length,0);assert.equal(f.replies.length,0);assert.equal(f.forwards.length,1);
});
test('slow claim does not delay ordinary forwarding',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve}),f=harness({db:true,claimGate:gate});
  const a=event('V-'+'c'.repeat(24),'unique-event-id');a.source.userId='U'+'9'.repeat(32);
  const pending=f.send([a,event('會員分享','normal')]);
  try{const deadline=Date.now()+2000;while(!f.forwards.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.forwards.length,1);}finally{release();await pending;}
});
test('signed malformed payload containing a serial never forwards or exposes parser errors',async()=>{
  const code='V-'+'a'.repeat(24),rawBody='{"events":[{"message":{"text":"'+code+'"';
  for(const route of ['dual','child']){
    const f=harness({db:true}),result=await f.send([],{route,rawBody,secondary:true});
    assert.equal(f.forwards.length,0);assert.equal(f.replies.length,0);assert.equal(f.bindings.length,0);
    assert.ok(!JSON.stringify(result.json).includes(code));
  }
});

for (const [language, command] of Object.entries(LIFE_INFO_STATION_COMMANDS)) {
  test(language + ': exact private message command and five localized LIFF URI actions', () => {
    assert.equal(lifeInfoStationLanguage(' ' + command + ' '), language);
    assert.equal(lifeInfoStationLanguage(command + ' please'), '');
    assert.equal(lifeInfoStationItemLanguage({ eventType: 'message', messageType: 'text', sourceType: 'user', replyToken: 'synthetic', text: command }), language);
    const message = buildLifeInfoStationMessage(language, 'https://worker.test', path => 'https://liff.line.me/test-liff' + path);
    assert.equal(message.type, 'image'); assert.equal(message.originalContentUrl, 'https://worker.test/file/line-life-info/20261030/share.png');
    assert.equal(message.previewImageUrl, 'https://worker.test/file/line-life-info/20261030/share-preview.jpg');
    const actions = message.quickReply.items.map(item => item.action);
    assert.equal(actions.length, 5); assert.ok(actions.every(action => action.type === 'uri'));
    assert.equal(new Set(actions.map(action => action.uri)).size, 5);
    assert.deepEqual(actions.map(action => new URL(action.uri).search), ['', '?view=directory', '?view=activities', '?view=clubs', '?view=activities&stories=1']);
    assert.ok(actions.every(action => new URL(action.uri).pathname === '/test-liff/featured-partner-stores' + (language === 'zh' ? '' : '-' + language)));
    assert.ok(actions.every(action => action.label.length <= 20));
    if (language === 'zh') assert.deepEqual(actions.map(action => action.label), ['本期優惠', '特約店家', '活動專區', '社團資訊', '活動花絮']);
  });

  test(language + ': real signed dual handler replies once and never forwards its reply token', async () => {
    const f = harness({ db: true });
    const result = await f.send([event(command)], { secondary: true });
    assert.equal(result.response.status, 200); assert.equal(f.replies.length, 1); assert.equal(f.forwards.length, 0);
    assert.equal(f.replies[0].token, 'synthetic-reply-one'); assert.equal(f.replies[0].messages.length, 1);
    assert.equal(f.replies[0].messages[0].quickReply.items.length, 5);
    assert.equal(f.stored.length, 1); assert.equal(f.stored[0].action, 'life_info_station');
    assert.equal(f.detections.length, 0); assert.equal(f.repairs.length, 0);
  });
}

test('lookalikes, group/room, postback, non-text and tokenless events are not owned', () => {
  const variants = [event('員工生活情報站說明'), event(LIFE_INFO_STATION_COMMANDS.zh, 'g', 'group'), event(LIFE_INFO_STATION_COMMANDS.zh, 'r', 'room'),
    { ...event(), type: 'postback' }, { ...event(), message: { type: 'image', text: LIFE_INFO_STATION_COMMANDS.zh } }, { ...event(), replyToken: '' }];
  for (const value of variants) {
    const body = JSON.stringify({ events: [value] });
    const partition = partitionLifeInfoForwardPayload(body, true);
    assert.equal(partition.changed, false); assert.equal(partition.body, body);
  }
});

test('no match keeps all envelope bytes and original signature for mother and secondaries', async () => {
  const f = harness();
  const body = '{ "destination": "channel", "events": [' + JSON.stringify(event('櫻花報到')) + '], "extra": {"keep":true} }';
  await f.send([], { rawBody: body, secondary: true });
  assert.equal(f.replies.length, 0); assert.equal(f.forwards.length, 3);
  for (const forwarded of f.forwards) { assert.equal(forwarded.body, body); assert.equal(forwarded.signature, sign(body)); }
  assert.deepEqual(f.detections, [body]); assert.deepEqual(f.repairs, [body]);
});

test('mixed batch retains every unrelated event and envelope field, with fresh valid signatures', async () => {
  const f = harness(), rest = [event('櫻花報到', 'mother'), event('會員分享', 'share'), event('其他訊息', 'other')];
  const rawBody = JSON.stringify({ destination: 'synthetic-channel', events: [rest[0], event(), rest[1], rest[2]], extra: { retained: 123 } });
  await f.send([], { rawBody, secondary: true });
  assert.equal(f.replies.length, 1); assert.equal(f.forwards.length, 3);
  for (const forwarded of f.forwards) {
    assert.deepEqual(JSON.parse(forwarded.body), { destination: 'synthetic-channel', events: rest, extra: { retained: 123 } });
    assert.equal(forwarded.signature, sign(forwarded.body)); assert.notEqual(forwarded.signature, sign(rawBody));
  }
  assert.deepEqual(f.detections, [f.forwards[0].body]); assert.deepEqual(f.repairs, [f.forwards[0].body]);
});

test('several owned events each use their own token once, without unrequested push or mother forwarding', async () => {
  const f = harness();
  await f.send([event(LIFE_INFO_STATION_COMMANDS.zh, 'a'), event(LIFE_INFO_STATION_COMMANDS.id, 'b')]);
  assert.deepEqual(f.replies.map(reply => reply.token), ['synthetic-reply-a', 'synthetic-reply-b']); assert.equal(f.forwards.length, 0);
});

for (const replyFailure of ['', 'throw', 'http']) test('duplicate owned events never reuse a reply token after ' + (replyFailure || 'success'), async () => {
  const f = harness({ replyFailure });
  await f.send([event(), event(), event(LIFE_INFO_STATION_COMMANDS.zh, 'other')], { secondary: true });
  assert.deepEqual(f.replies.map(reply => reply.token), ['synthetic-reply-one', 'synthetic-reply-other']);
  assert.equal(f.forwards.length, 0);
});

for (const replyFailure of ['throw', 'http']) test('reply ' + replyFailure + ' retains child ownership and never retries/falls through', async () => {
  const f = harness({ replyFailure });
  await f.send([event()], { secondary: true });
  assert.equal(f.replies.length, 1); assert.equal(f.forwards.length, 0);
});

test('invalid signature cannot reply or forward; missing configured secret retains prior forwarding only', async () => {
  const bad = harness(); assert.equal((await bad.send([event()], { signed: false })).response.status, 403);
  assert.equal(bad.replies.length, 0); assert.equal(bad.forwards.length, 0);
  const missing = harness(); const result = await missing.send([event()], { secretConfigured: false });
  assert.equal(missing.replies.length, 0); assert.equal(missing.forwards.length, 1); assert.equal(missing.forwards[0].body, result.body);
});

test('direct child route requires verified signature for the new entry', async () => {
  const f = harness(); await f.send([event()], { route: 'child', signed: false }); assert.equal(f.replies.length, 0);
  await f.send([event()], { route: 'child' }); assert.equal(f.replies.length, 1); assert.equal(f.forwards.length, 0);
});

test('empty verification batches and malformed input retain existing untouched forwarding bytes', () => {
  for (const body of ['{ "events" : [] }', 'not-json', '{"other":1}']) {
    const result = partitionLifeInfoForwardPayload(body, true);
    assert.equal(result.body, body); assert.equal(result.changed, false); assert.equal(result.shouldForward, true);
  }
});

test('owned partition is not selected without trusted signature; signing is standard HMAC-SHA256', async () => {
  const body = JSON.stringify({ events: [event()] }); assert.equal(partitionLifeInfoForwardPayload(body, false).body, body);
  assert.equal(await signLifeInfoForwardPayload(body, secret), sign(body));
  await assert.rejects(signLifeInfoForwardPayload(body, ''), /Missing channel secret/);
});

test('image origins and quick reply destinations reject insecure or credential-bearing URLs', () => {
  for (const origin of ['http://worker.test', 'https://user:pass@worker.test']) assert.throws(() => buildLifeInfoStationMessage('zh', origin, path => 'https://liff.line.me/test' + path));
  for (const uri of ['https://evil.test/', 'http://liff.line.me/test', 'https://user:pass@liff.line.me/test']) assert.throws(() => buildLifeInfoStationMessage('zh', 'https://worker.test', () => uri));
});
