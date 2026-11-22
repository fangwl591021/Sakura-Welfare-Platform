// Each HTTP request owns its authentication promises. Nothing is reused by the
// next request, so whitelist changes and employee revocation remain immediate.
const requests = new WeakMap();
const schemas = new WeakMap();

export function requestEnvironment(env) {
  if (!env.DB) return env;
  const source = env.DB;
  const db = new Proxy(source, { get(target, name) {
    const value = Reflect.get(target, name, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  requests.set(db, { source, memo: new Map() });
  return { ...env, DB: db };
}

export function requestWork(db, kind, key, run) {
  const scope = requests.get(db);
  if (!scope) return run();
  const name = kind + ':' + key;
  if (!scope.memo.has(name)) scope.memo.set(name, Promise.resolve().then(run));
  return scope.memo.get(name);
}

// Only non-sensitive schema-presence flags survive a request. Never share an
// in-flight D1 promise across requests. Failed probes/initializations are retried.
export async function ensureKnownSchema(db, name, probe, initialize) {
  const source = requests.get(db)?.source || db;
  let ready = schemas.get(source);
  if (!ready) schemas.set(source, ready = new Set());
  if (ready.has(name)) return;
  try { await db.prepare(probe).all(); }
  catch (error) {
    if (!/no such (?:table|column)|has no column/i.test(String(error.message))) throw error;
    await initialize(); await db.prepare(probe).all();
  }
  ready.add(name);
}
