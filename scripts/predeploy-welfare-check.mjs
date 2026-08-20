import { readFileSync } from "node:fs";

const EXPECTED = {
  workerName: "sakura-welfare-platform",
  main: "src/entry.js",
  legacyMain: "src/index.js",
  d1Name: "sakura-welfare-db",
  d1Id: "0a4bf3ce-5827-46a7-9629-155639dc7ac2",
  r2Bucket: "sakurakitchen-files"
};

const wrangler = readFileSync("wrangler.sakura-welfare.toml", "utf8");
const entry = readFileSync(EXPECTED.main, "utf8");
const worker = readFileSync(EXPECTED.legacyMain, "utf8");

const failures = [];

function mustContain(label, text) {
  if (!wrangler.includes(text)) failures.push(`${label} mismatch. Expected ${text}`);
}

mustContain("Worker name", `name = "${EXPECTED.workerName}"`);
mustContain("Worker entry", `main = "${EXPECTED.main}"`);
mustContain("D1 database_name", `database_name = "${EXPECTED.d1Name}"`);
mustContain("D1 database_id", `database_id = "${EXPECTED.d1Id}"`);
mustContain("R2 bucket", `bucket_name = "${EXPECTED.r2Bucket}"`);

if (/sakura-scholarship-db|scholarship-worker|第三十七屆櫻花教育獎學金申請系統/.test(wrangler)) {
  failures.push("wrangler.sakura-welfare.toml contains scholarship Worker names or database names.");
}

if (!entry.includes('import worker from "./index.js"')) {
  failures.push("Wrapper entry does not delegate to src/index.js.");
}

if (!entry.includes("partner-store-favorites") || !entry.includes("welfare_store_favorites")) {
  failures.push("Partner store favorites wrapper markers not found in src/entry.js.");
}

if (!worker.includes("vendor-store") && !worker.includes("line-oa-monitor")) {
  failures.push("Welfare platform route marker not found in src/index.js.");
}

if (failures.length) {
  console.error("Welfare predeploy guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Welfare predeploy guard passed: wrapper entry, legacy Worker, D1, and R2 are locked.");
