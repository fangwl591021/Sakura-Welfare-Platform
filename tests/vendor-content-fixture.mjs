import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { resolveVendorCover } from '../src/vendor-default-cover.js';
import { validateVendorPortalCredentialInput } from '../src/vendor-portal-credential-policy.js';
import { isVendorContractCurrent } from '../src/vendor-contract-policy.js';

export const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
export function contentFixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0008_sakura_welfare_core', '0009_vendor_registration_details', '0014_vendor_store_url', '0015_vendor_soft_hide', '0027_vendor_current_featured']) {
    sqlite.exec(readFileSync(new URL('../migrations/' + migration + '.sql', import.meta.url), 'utf8'));
  }
  sqlite.exec("INSERT INTO welfare_vendors(id,name,status,discount_policy,vendor_portal_username,vendor_portal_password) VALUES('a','Fixture Store','approved','Legacy policy','shop-a','fixture-password'),('b','Other Store','approved','Other policy','shop-b','fixture-password');");
  sqlite.exec(readFileSync(new URL('../migrations/0032_vendor_store_intro.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0045_vendor_contract_termination.sql', import.meta.url), 'utf8'));
  const queries = [];
  const db = { prepare(sql) {
    queries.push(sql);
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() {
        if (/FROM welfare_vendor_showcase_assets|FROM welfare_vendor_documents/.test(sql)) return { results: [] };
        return { results: sqlite.prepare(sql).all(...values) };
      },
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; }
    };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const row = (id = 'a') => sqlite.prepare('SELECT * FROM welfare_vendors WHERE id=?').get(id);
  const context = vm.createContext({ URL, console, crypto, Object,
    taiwanNowString: () => '2026-10-04 12:00:00', taiwanDateTimeString: value => value,
    normalizeVendorStatus: value => value, normalizeNumericRow: value => value,
    ensureVendorPortalCredentialColumns: async () => {}, seedVendorManagementDemo: async () => {},
    ensureVendorShowcaseTables: async () => {}, listVendorCarouselItems: async () => [],
    resolveVendorCover, isVendorContractCurrent, buildLiffUrl: (_env, path) => path,
    verifyVendorPortalToken: async (_env, token) => token === 'token-a' ? { vendor_id: 'a', username: 'shop-a' } : token === 'token-b' ? { vendor_id: 'b', username: 'shop-b' } : null,
    readVendorPortalCookie: () => null, findDuplicateVendorApplication: async () => null,
    validateVendorPortalCredentialInput, processVendorFileUploads: async (_env, _origin, data) => data,
    getVendorNotifySnapshot: async (_db, id) => row(id), vendorNotifyLines: () => [], sendTelegramNotification: async () => {},
  });
  for (const name of ['sanitizeVendorRichText', 'normalizeVendorStorefront', 'canEditVendorStorefront', 'saveWelfareVendor', 'saveVendorApplication', 'getVendorApplication', 'getVendorStorefront', 'saveVendorStorefrontProfile']) {
    const match = source.match(new RegExp('(?:async )?function ' + name + '\\([\\s\\S]*?\n\\}'));
    if (!match) throw new Error('Missing ' + name);
    vm.runInContext(match[0], context);
  }
  return { sqlite, db, row, context, queries, close: () => sqlite.close(),
    save: data => context.saveWelfareVendor(db, data),
    application: () => context.getVendorApplication(db, new URL('https://fixture.test/api/vendor-apply?vendor_id=a&portal_token=token-a'), {}),
    storefront: () => context.getVendorStorefront(db, new URL('https://fixture.test/api/vendor-store?vendor_id=a&portal_token=token-a'), {}),
    apply: data => context.saveVendorApplication(new Request('https://fixture.test/api/vendor-apply', { method: 'POST', body: JSON.stringify(data) }), db, {}, 'https://fixture.test'),
    profile: data => context.saveVendorStorefrontProfile(new Request('https://fixture.test/api/vendor-store/profile', { method: 'POST', body: JSON.stringify(data) }), db, {}),
  };
}
