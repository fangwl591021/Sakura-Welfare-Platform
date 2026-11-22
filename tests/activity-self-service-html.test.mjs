import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.js';

test('served activity entries include own-registration tabs and compilable inline scripts', async () => {
  for (const suffix of ['', '-id', '-th']) {
    const response=await worker.fetch(new Request('https://fixture.test/featured-partner-stores'+suffix+'?view=activities'),{},{});
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,/id="mar-tab-all"/);
    assert.match(html,/id="mar-tab-cancellable"/);
    const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length>0);
    for(const [i,script] of scripts.entries()) assert.doesNotThrow(()=>new vm.Script(script[1]),`${suffix||'zh'} script ${i+1}`);
  }
});
