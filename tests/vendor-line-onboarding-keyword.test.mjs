import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const helper = source.match(/function isVendorLineOnboardingText\(text\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(helper, 'vendor onboarding text helper must exist');
const isVendorLineOnboardingText = Function(`return (${helper})`)();

test('general offer wording is not treated as vendor onboarding', () => {
  assert.equal(isVendorLineOnboardingText('本期優惠'), false);
  assert.equal(isVendorLineOnboardingText('最新優惠'), false);
});

test('explicit vendor commands remain supported', () => {
  assert.equal(isVendorLineOnboardingText('廠商專區'), true);
  assert.equal(isVendorLineOnboardingText('廠商申請'), true);
  assert.equal(isVendorLineOnboardingText('優惠資料上架'), true);
  assert.equal(isVendorLineOnboardingText('店家優惠政策'), true);
});

test('configured keyword lookup happens before both vendor onboarding passes', () => {
  assert.match(source, /const keywordRule = await findMatchingLineKeywordRule\(env\.DB, item\.text\);\s+const isVendorPortalRule = keywordRule && String\(keywordRule\.action_type \|\| ""\)\.trim\(\) === "vendor_portal";\s+const shouldHandleVendorFirst = \(!keywordRule \|\| isVendorPortalRule\) && isVendorLineOnboardingCandidate\(item\);/);
  assert.match(source, /const vendorAssistantResult = keywordRule && !isVendorPortalRule \? null : await maybeHandleVendorLineOnboarding/);
});
