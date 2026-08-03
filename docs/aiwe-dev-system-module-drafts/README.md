# AIWE Dev System Module Drafts from Sakura Welfare Platform

These files are drafts for future back-porting into `fangwl591021/aiwe-dev-system/modules/`.

They are intentionally documentation-first. Do not extract shared runtime code until at least one real project flow has been verified and the module boundary is stable.

## Draft Modules

- `line-dual-webhook/README.md`
- `rich-menu-d1-projects/README.md`
- `liff-vendor-pos-scanner/README.md`
- `vendor-onboarding-review/README.md`
- `line-oa-monitoring/README.md`
- `activity-qr-checkin/README.md`

## Back-port Rule

When copying to `aiwe-dev-system`, keep each module as:

- purpose
- verified source project
- routes/tables involved
- environment variables
- risks
- extraction status

Do not mark a module as production reusable until it has a clean example, setup instructions, and acceptance checks.

