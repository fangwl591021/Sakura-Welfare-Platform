import {spawnSync} from 'node:child_process';
import {constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const project = fileURLToPath(new URL('../',import.meta.url));
const require = createRequire(import.meta.url);
const environment = {...process.env};
for (const name of Object.keys(environment)) {
  if (/^(CLOUDFLARE_|CF_API_|LINE_|TELEGRAM_|WRANGLER_API_TOKEN$|PLAYWRIGHT_MODULE_PATH$|WELFARE_DEPENDENCIES$)/i.test(name)) {
    delete environment[name];
  }
}
environment.WRANGLER_SEND_METRICS = 'false';
environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

const suites = [
  'tests/welfare-shop-runtime.test.mjs',
  'tests/welfare-shop-browser.test.mjs',
  'tests/segment-push-browser.test.mjs',
  'tests/segment-push-schedule-workerd.test.mjs',
  'tests/segment-domestic-independent.test.mjs',
  'tests/vendor-brand-portal.test.mjs',
  'tests/vendor-brand-admin-route.test.mjs',
  'tests/vendor-dashboard-qr.test.mjs',
  'tests/verify-welfare-deployment.test.mjs'
];

function run(args) {
  const result = spawnSync(process.execPath,args,{cwd:project,env:environment,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('隔離驗證指令失敗（'+(result.status??result.signal)+'）。');
}

const tempRoot = realpathSync(tmpdir());
const prefix = 'sakura-welfare-smoke-';
const build = mkdtempSync(join(tempRoot,prefix));
try {
  const {values} = parseArgs({options:{'bundle-out':{type:'string'}}});
  const wrangler = join(dirname(require.resolve('wrangler/package.json')),'bin','wrangler.js');
  const {chromium} = require('playwright');
  if(!environment.PLAYWRIGHT_CHANNEL&&!existsSync(chromium.executablePath()))environment.PLAYWRIGHT_CHANNEL='chrome';
  environment.WRANGLER_LOG_PATH = join(build,'wrangler.log');
  environment.STORE_APP_BUNDLE = join(build,'index.js');
  console.log('準備本機候選包（Wrangler dry-run）');
  run([wrangler,'deploy','--dry-run','--outdir',build,'-c','wrangler.sakura-welfare.toml']);
  console.log('驗證商城、推播受眾、廠商權限與部署後核對。瀏覽器：'+(environment.PLAYWRIGHT_CHANNEL||'Chromium'));
  run(['--test','--test-concurrency=3',...suites]);
  if(values['bundle-out']){
    const target = resolve(values['bundle-out']);
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(environment.STORE_APP_BUNDLE,target,constants.COPYFILE_EXCL);
    console.log('已保留驗證通過的打包檔。');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  const created = realpathSync(build);
  if(dirname(created)===tempRoot&&basename(created).startsWith(prefix)){
    rmSync(created,{recursive:true,force:true});
  }
}
