import { readFileSync } from "node:fs";

const EXPECTED = {
  workerName: "sakura-welfare-platform",
  main: "src/index.js",
  d1Name: "sakura-welfare-db",
  d1Id: "0a4bf3ce-5827-46a7-9629-155639dc7ac2",
  r2Bucket: "sakurakitchen-files"
};

const wrangler = readFileSync("wrangler.sakura-welfare.toml", "utf8");
const worker = readFileSync(EXPECTED.main, "utf8");

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

if (!worker.includes("vendor-store") && !worker.includes("line-oa-monitor")) {
  failures.push("Welfare platform route marker not found in src/index.js.");
}

if (failures.length) {
  console.error("Welfare predeploy guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Welfare predeploy guard passed: Worker, D1, R2, and entry file are locked.");
