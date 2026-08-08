import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../src/rich-menu-editor.html', import.meta.url), 'utf8');

test('rich menu reuses the image that already loaded successfully', () => {
  assert.match(html, /var img = new fabric\.Image\(tempImg\);/);
  assert.doesNotMatch(html, /fabric\.Image\.fromURL\(base64/);
});

test('stale image loads cannot update the canvas', () => {
  assert.match(html, /if \(loadToken !== imageLoadGeneration\) return;/);
});
