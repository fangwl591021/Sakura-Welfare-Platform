import { queueRichMenuRefresh } from './rich-menu-refresh.js';

// Explicit, same-language retirement: the current three published projects are
// the authority. Archived identity rows supply source IDs only, never targets.
const REPLACEMENTS = Object.freeze({
  'twmem-menu': { alias: 'guest_zh', language: 'zh-TW' },
  'taimem-menu': { alias: 'new-rich-menu', language: 'th' },
});
const validId = value => /^richmenu-[a-f0-9]{32}$/.test(String(value || ''));
const validUid = value => /^U[0-9A-Za-z_-]{20,128}$/.test(String(value || ''));

export function planRetiredIdentityMenus(projects, rules) {
  const published = new Set(projects.map(p => p.deployed_rich_menu_id).filter(validId));
  const result = new Map();
  for (const rule of rules) {
    const replacement = REPLACEMENTS[rule.rich_menu_alias_id];
    if (!replacement || rule.target_type !== 'employee' || rule.language !== replacement.language) continue;
    const from = rule.rich_menu_id;
    if (!validId(from) || published.has(from)) continue;
    const matches = projects.filter(p => {
      try { const config = JSON.parse(p.config_json); return (config.aliasId || config.richMenuAliasId) === replacement.alias && validId(p.deployed_rich_menu_id); }
      catch { return false; }
    });
    if (matches.length !== 1) continue;
    const project = matches[0], entry = { from, to: project.deployed_rich_menu_id, projectId: project.id, aliasId: replacement.alias };
    if (result.has(from) && result.get(from)?.to !== entry.to) result.set(from, null);
    else if (!result.has(from)) result.set(from, entry);
  }
  return [...result.values()].filter(Boolean);
}

export async function readRetiredIdentityMenus(db) {
  if (!db) return [];
  const projects = await db.prepare('SELECT id,config_json,deployed_rich_menu_id FROM rich_menu_projects').all();
  const rules = await db.prepare("SELECT target_type,language,rich_menu_alias_id,rich_menu_id FROM rich_menu_bindings WHERE target_type='employee'").all();
  return planRetiredIdentityMenus(projects.results || [], rules.results || []);
}

export async function queueRetiredIdentityMenus(db) {
  for (const entry of await readRetiredIdentityMenus(db)) await queueRichMenuRefresh(db, entry.projectId, entry.from);
}

export async function repairRetiredMenuForUser(db, env, uid, options = {}) {
  if (!db || !env.LINE_CHANNEL_ACCESS_TOKEN || !validUid(uid)) return { state: 'ignored' };
  const plan = await readRetiredIdentityMenus(db);
  if (!plan.length) return { state: 'idle' };
  const remaining = Math.min(7000, (options.deadline || Date.now() + 7000) - Date.now());
  if (remaining < 250) return { state: 'deferred' };
  const fetcher = options.fetcher || fetch, signal = AbortSignal.timeout(remaining);
  const path = 'https://api.line.me/v2/bot/user/' + encodeURIComponent(uid) + '/richmenu';
  const headers = { Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN };
  const read = async () => {
    const response = await fetcher(path, { headers, signal });
    return response.ok ? (await response.json()).richMenuId || '' : '';
  };
  try {
    const current = await read(), entry = plan.find(p => p.from === current);
    if (!entry) return { state: 'preserved' };
    // A user may switch language while this background read is in flight.
    if (await read() !== current) return { state: 'changed' };
    const linked = await fetcher(path + '/' + entry.to, { method: 'POST', headers, signal });
    const verified = linked.ok && await read() === entry.to;
    if (options.record) await options.record({ lineUserId: uid, aliasId: entry.aliasId,
      projectId: entry.projectId, d1RichMenuId: entry.to, lineRichMenuId: entry.to,
      status: verified ? 'VERIFIED' : 'FAILED', ok: verified, lineStatus: linked.status,
      note: verified ? 'Retired menu replaced with current same-language project.' : 'Retired menu repair not verified.',
      raw: { from: entry.from, to: entry.to } });
    return { state: verified ? 'repaired' : 'unverified' };
  } catch { return { state: 'deferred' }; }
}

export async function repairRetiredMenuPayload(rawBody, env, verified, record, options = {}) {
  if (!verified || !env.DB) return;
  const payload = JSON.parse(rawBody), users = new Set();
  for (const event of Array.isArray(payload.events) ? payload.events : []) {
    if (event.source?.type === 'user' && ['follow','message','postback'].includes(event.type) && validUid(event.source.userId)) users.add(event.source.userId);
  }
  await Promise.allSettled([...users].map(uid => repairRetiredMenuForUser(env.DB, env, uid, { record, deadline: options.deadline })));
}
