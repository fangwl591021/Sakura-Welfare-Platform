# NEXT SPRINT - Sakura Welfare Platform

## Sprint Goal

Stabilize the core operating loop:

Identity -> correct menu -> vendor visibility -> POS redemption -> member/admin records -> reporting.


- Apply the identity and permission model before changing role-dependent routes.
- Apply the transaction safety checklist to POS redemption, activity check-in, vendor review, and employee binding sync.

- Verify mother-site employee binding callback in live LINE flow and confirm the selected three-language Rich Menu appears on the client.
- Align vendor application counts and visible review list.
- Prevent duplicate vendor applications by LINE user, vendor username, or existing application state. Backend duplicate guard for visible records was tightened on 2026-07-16; remaining work is live mobile UX confirmation.
- Ensure vendor edit/status page always preloads existing data.
- Keep Taiwan timezone display consistent across vendor/admin/member records.

## Priority 2 - Vendor and POS

- Make vendor POS show only the logged-in vendor's own data.
- Keep scanner working through LIFF while login remains account/password.
- Add backend-managed discount rules in admin.
- Ensure POS shows member display name and cumulative historical consumption amount.
- Confirm success popup and sound after redemption.
- Confirm member consumption history hides UID and internal source text.

## Priority 3 - LINE OA and Rich Menu

- Audit keyword rules for mother-site vs child-site ownership.
- Confirm Rich Menu switch action logs response time and status.
- Confirm Rich Menu image replacement preserves areas.
- Confirm non-guest Rich Menu deploy does not change global default; only `guest_zh` may be set as visitor default.
- Document identity-to-Rich-Menu binding rules for visitor, employee languages, vendor pending, vendor approved, and admin.

## Priority 4 - Public Listings

- Validate medical provider route in Chinese, Indonesian, and Thai.
- Validate partner store route in Chinese, Indonesian, and Thai.
- Make filter controls compact on mobile.
- Ensure each vendor has a micro-site button from list/detail views.

## Priority 5 - Activity Check-in

- Finalize admin calendar editor.
- Add audience visibility options: all, visitor, employee, manager.
- Generate event QR code.
- Record attendance without points.
- Show member activity records under member portal.

## Deferred

- AI menu/DM generation and OCR product showcase.
- Full e-commerce product catalog.
- Advanced Google Places nearby ranking.
- Automated public-content approval by AI.








