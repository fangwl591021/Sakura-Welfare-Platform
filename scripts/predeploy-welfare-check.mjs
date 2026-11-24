import { readFileSync } from "node:fs";

import { execFileSync } from "node:child_process";

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

execFileSync(process.execPath, ["--test", "tests/vendor-benefit-access.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/entry-performance.test.mjs"], { stdio: "inherit" });
// Display rosters never create members or grant employee access.
execFileSync(process.execPath, ["--test", "tests/employee-roster-projection.test.mjs", "tests/employee-roster-readonly.test.mjs", "tests/employee-roster-routes.test.mjs", "tests/employee-roster-ui.test.mjs", "tests/employee-roster-export.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/vendor-entry-navigation.test.mjs"], { stdio: "inherit" });
// Multi-brand grants never replace bindings; all brand actions recheck current authority.
execFileSync(process.execPath, ["--test", "tests/vendor-brand-access.test.mjs", "tests/vendor-brand-chat.test.mjs", "tests/vendor-brand-qr.test.mjs", "tests/vendor-brand-dispatch.test.mjs", "tests/vendor-brand-admin-ui.test.mjs", "tests/vendor-brand-admin-route.test.mjs", "tests/vendor-brand-portal.test.mjs"], { stdio: "inherit" });
// Branch selectors must not expose pending, hidden, or other vendors' locations.
execFileSync(process.execPath, ["--test", "tests/vendor-branch-picker.test.mjs", "tests/vendor-branch-directory.test.mjs", "tests/vendor-branch-route.test.mjs"], { stdio: "inherit" });
// Customer submissions and legacy vendor confirmations require atomic, idempotent ledger writes.
execFileSync(process.execPath, ["--test", "tests/branch-redemption-service.test.mjs", "tests/branch-qr.test.mjs"], { stdio: "inherit" });
// Check the served HTML after all decorators and legacy decoding, not only its source template.
execFileSync(process.execPath, ["--test", "tests/vendor-supplement-html.test.mjs", "tests/vendor-supplement.test.mjs", "tests/vendor-private-contracts.test.mjs", "tests/vendor-application-chat.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/vendor-supplement-monitor.test.mjs", "tests/vendor-supplement-telegram.test.mjs"], { stdio: "inherit" });
// Fixed editorial roles must remain isolated on every release.
execFileSync(process.execPath, ["--test", "tests/editor-roles.test.mjs", "tests/editor-chat-entry.test.mjs", "tests/club-workspace-navigation.test.mjs", "tests/activity-workspace-navigation.test.mjs"], { stdio: "inherit" });
// Story publication and media must enforce unit and employee visibility on every release.
execFileSync(process.execPath, ["--test", "tests/activity-stories.test.mjs", "tests/whitelist-story-grants.test.mjs"], { stdio: "inherit" });
// Full articles keep scoped detail, complete drafts and safe extensible bodies.
execFileSync(process.execPath, ["--test", "tests/activity-articles.test.mjs", "tests/activity-article-ui.test.mjs", "tests/activity-article-list-ui.test.mjs", "tests/activity-article-runtime.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/activity-rich-text.test.mjs", "tests/activity-wysiwyg-conversion.test.mjs", "tests/activity-wysiwyg-disabled-upload.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/story-dashboard.test.mjs"], { stdio: "inherit" });
// This accepted locale baseline is mandatory for every standard welfare deploy.
execFileSync(process.execPath, ["--test", "tests/employee-binding-sync.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/rich-menu-retirement.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/activity-registration-edit.test.mjs"], { stdio: "inherit" });
// Self-service is owner-scoped and must retain the served activity-page scripts.
execFileSync(process.execPath, ["--test", "tests/activity-self-service.test.mjs", "tests/activity-self-service-html.test.mjs"], { stdio: "inherit" });
// New activity registrations use only the verified employee's own roster data.
execFileSync(process.execPath, ["--test", "tests/activity-roster-prefill.test.mjs"], { stdio: "inherit" });
// Paid pushes require an immutable confirmed snapshot and valid roster bindings.
execFileSync(process.execPath, ["--test", "tests/segment-audience.test.mjs", "tests/segment-push.test.mjs", "tests/segment-push-route.test.mjs", "tests/segment-push-drafts.test.mjs", "tests/segment-multifactory-integration.test.mjs"], { stdio: "inherit" });
// Full registration exports must keep attendance, native Excel and privacy boundaries.
execFileSync(process.execPath, ["--test", "tests/activity-roster.test.mjs"], { stdio: "inherit" });
// Attendance counts must stay owner-verified, bounded and idempotent.
execFileSync(process.execPath, ["--test", "tests/activity-attendance-count.test.mjs", "tests/activity-lottery.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/vendor-store-locale-lock.test.mjs"], { stdio: "inherit" });
// Vendor public-content controls must stay equivalent on admin and mobile entry points.
execFileSync(process.execPath, ["--test", "tests/vendor-content.test.mjs"], { stdio: "inherit" });
// Hidden vendors remain hidden until an explicit authorized restore.
execFileSync(process.execPath, ["--test", "tests/hidden-vendor-persistence.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/vendor-public-documents.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/clubs.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/club-translation.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/club-cover.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/rich-menu-refresh.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/rich-menu-chat.test.mjs"], { stdio: "inherit" });
// The life information entry owns only its exact private events and preserves other webhook deliveries.
execFileSync(process.execPath, ["--test", "tests/life-info-station.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/rich-menu-editor-deployment.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/rich-menu-image-preflight.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/welfare-shop-runtime.test.mjs"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "tests/push-history.test.mjs", "tests/segment-push-insights.test.mjs"], { stdio: "inherit" });
console.log("Welfare predeploy guard passed: Worker, D1, R2, entry file, and accepted store-hours locale are locked.");
