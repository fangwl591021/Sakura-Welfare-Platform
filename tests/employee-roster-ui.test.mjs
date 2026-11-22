import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { employeeRosterHtml, decorateCrmUsersWithRosterLink } from '../src/employee-roster-ui.js';

test('independent roster shell uses one read-only child-site endpoint and has reachable navigation', () => {
  const scripts = [...employeeRosterHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  for (const script of scripts) new vm.Script(script);
  assert.match(employeeRosterHtml, /fetch\('\/admin-api\/employee-roster', \{ method: 'GET'/);
  assert.equal([...employeeRosterHtml.matchAll(/\bfetch\(/g)].length, 2);
  assert.match(employeeRosterHtml, /fetch\('\/admin-api\/employee-roster\?' \+ params, \{ method: 'GET'/);
  assert.match(employeeRosterHtml, /id="rosterExport" type="button" disabled/);
  assert.doesNotMatch(employeeRosterHtml, /method:\s*['"](?:POST|PUT|PATCH|DELETE)|employee-binding-sync|pull-mother|birthday|line_user_id|lineUserId/);
  for (const link of ['/sakura-admin', '/crm-users?view=roster', '/crm-users?view=line']) assert.ok(employeeRosterHtml.includes('href="' + link + '"'));
  for (const id of ['rosterTotal', 'rosterBound', 'rosterUnbound', 'rosterReview', 'employeeRosterSearch', 'employeeRosterFactory', 'employeeRosterIdentity', 'employeeRosterBinding', 'rosterPageSize']) assert.ok(employeeRosterHtml.includes('id="' + id + '"'));
  assert.match(employeeRosterHtml, /列入名冊不會授予員工身分或福利權限/);
  assert.match(employeeRosterHtml, /event\.source === parent && event\.origin === location\.origin/);
});

test('LINE-page decorator adds static navigation only and preserves existing script and controls', () => {
  const script = 'window.oldBehavior=()=>{document.getElementById("tableWrap").textContent="existing"};';
  const original = '<!doctype html><html><head><title>existing</title></head><body><div class="metrics" id="metrics"></div><input id="search"><div id="tableWrap"></div><script>' + script + '</script></body></html>';
  const result = decorateCrmUsersWithRosterLink(original);
  assert.match(result, /id="crmRosterViewLinks"/);
  assert.match(result, /href="\/crm-users\?view=line" aria-current="page"/);
  assert.equal([...result.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1], script);
  assert.equal(result.replace(/<nav id="crmRosterViewLinks"[\s\S]*?<\/nav>/, '').replace(/<style id="crmRosterViewStyle">[\s\S]*?<\/style>/, ''), original);
  assert.equal(decorateCrmUsersWithRosterLink(result), result);
  assert.equal(decorateCrmUsersWithRosterLink('<html>other page</html>'), '<html>other page</html>');
  assert.equal(decorateCrmUsersWithRosterLink(null), null);
});
