import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../src/index.js';

test('served vendor review and applicant pages keep compilable scripts and supplement entry', async () => {
  for (const path of ['/vendor-management','/vendor-apply','/vendor-login']) {
    const response = await worker.fetch(new Request('https://fixture.test'+path), {}, {});
    assert.equal(response.status, 200);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0);
    for (const [index, match] of scripts.entries()) assert.doesNotThrow(() => new vm.Script(match[1]), `${path} script ${index+1}`);
    if (path === '/vendor-management') assert.match(html, /要求補件/);
    if (path === '/vendor-apply') assert.match(html, /補件完成，重新送審/);
  }
});
