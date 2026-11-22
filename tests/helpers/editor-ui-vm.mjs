import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {editorWorkspaceHtml} from '../../src/editor-ui.js';
import {editorPresets} from '../../src/editor-access.js';

// Execute the actual emitted scripts with a minimal DOM and synthetic responses.
// No browser, credentials, database, external fetch, or write endpoint is used.
export class Node {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.hidden = false; this.disabled = false; this._text = ''; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parentElement = this; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  add(node) { this.append(node); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelectorAll(selector) { return selector === 'button' ? this.children.filter(n => n.tagName === 'BUTTON') : []; }
  click() { return this.onclick?.({target: this}); }
  focus() {}
}
export const script = html => [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean).at(-1);
export const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
export function environment(html, href) {
  const nodes = new Map(), listeners = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const node = new Node(match[1]); node.hidden = /\bhidden\b/.test(match[0]); nodes.set('#' + match[2], node);
  }
  const body = new Node('body');
  const document = {body, readyState: 'complete', createElement: tag => new Node(tag), createTextNode: text => { const n = new Node('#text'); n.textContent = text; return n; }, querySelector(selector) {
    if (selector === '#tabs button') return nodes.get('#tabs')?.children[0];
    if (!nodes.has(selector)) nodes.set(selector, new Node());
    return nodes.get(selector);
  }, addEventListener(name, fn) { listeners.set(name, fn); }};
  const location = new URL(href); location.replace = url => { location.replaced = url; };
  const window = {addEventListener(name, fn) { listeners.set(name, fn); }};
  const context = {window, document, location, parent: window, URL, URLSearchParams, Headers, Request, Response, FormData, AbortSignal, AbortController, crypto: {randomUUID}, setTimeout, clearTimeout,
    Option: class extends Node { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } },
    localStorage: {getItem: () => JSON.stringify({token: 'synthetic-session'}), removeItem() {}}, confirm: () => false};
  window.location = location;
  return {nodes, listeners, context, document};
}
export async function workspace(role, {pending = false, allowedPages} = {}) {
  const html = editorWorkspaceHtml(), env = environment(html, 'https://isolated.test/editor-workspace');
  const preset = structuredClone(editorPresets().find(p => p.role === role));
  if (allowedPages) preset.pages = preset.pages.filter(p => allowedPages.includes(p.url));
  const calls = [];
  let release;
  const contextResponse = {success: true, role, editor: !!preset, preset, presets: editorPresets()};
  env.context.fetch = async (url, init) => {
    calls.push({url, method: init?.method || 'GET'});
    if (pending) await new Promise(resolve => { release = resolve; });
    return Response.json(contextResponse);
  };
  vm.runInNewContext(script(html), env.context);
  await settle();
  const frame = env.nodes.get('#content');
  return {...env, html, calls, release, buttons: env.nodes.get('#tabs').children, frame,
    loaded(url = frame.src) { frame.contentWindow = {location: new URL(url, 'https://isolated.test')}; frame.onload?.(); }};
}
