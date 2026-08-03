# Transaction Safety Checklist - Sakura Welfare Platform

## Purpose

This checklist applies to every Sakura flow that changes state. It follows the framework principle that completed actions should be auditable, idempotent, and reversible or correctable.

## Covered Flows

| Flow | Type | Current Authority |
| --- | --- | --- |
| Employee binding sync | Identity synchronization | Mother site verifies, child site stores operation cache |
| Rich Menu assignment | Identity presentation | Child site D1 rule plus LINE API result |
| Vendor application submit/edit | Review workflow | Child site D1 |
| Vendor document upload / supplement | Review workflow | Child site D1 + R2 |
| Vendor approval/return/suspend/hide | Admin decision | Child site D1 |
| Vendor micro-site public update | Reviewable content change | Child site D1 |
| POS redemption | Merchant-verified redemption | Child site D1, point authority stays mother site if points are touched |
| Activity QR check-in | Attendance | Child site D1 |
| Segmented broadcast | Messaging operation | Child site D1 / LINE API |

## Mandatory Checks Before Implementation

For each state-changing action, define:

| Check | Required Answer |
| --- | --- |
| Actor | Who is performing the action? visitor, employee, vendor, admin, system |
| Permission | Which permission allows it? |
| Scope | Which vendor, member, activity, or tenant scope is affected? |
| Business reference | What human-readable object is this action about? |
| Idempotency key | How do we prevent duplicate submit / duplicate webhook / double click? |
| Stored result | Where is success/failure stored? |
| Audit | Who, when, before value, after value, source route |
| Correction path | Return, suspend, reverse, correct, hide, or supersede |
| Notification | Is Telegram/LINE/email only notification, or part of the transaction? |

## Flow-Specific Rules

### Employee Binding Sync

- Mother site remains verification authority.
- Child site accepts only signed/API-key protected sync payloads.
- Repeated sync for the same LINE User ID + employee number must update the same member row, not create duplicates.
- Rich Menu link result should be logged separately from identity sync success.
- If LINE Rich Menu API fails, employee sync may still be saved but must return/log menu failure clearly.

### Vendor Application Submit/Edit

- Duplicate applications must be prevented by vendor username, LINE User ID, phone, and normalized company/store name.
- Existing application should reopen edit/status view instead of blank new submit.
- Submission button must lock during submit on mobile.
- Review state must be explicit: pending, returned, approved, suspended, hidden.
- Returned applications must preserve submitted data and show supplement instructions.

### Vendor Public Content Update

- Public-facing changes should create a pending change record if they affect employee-visible content.
- Admin must see before/after values.
- Telegram notification is advisory only; D1 remains source of truth.
- Approved changes should record reviewer and review time.

### POS Redemption

- POS must operate only for the logged-in vendor's own vendor ID.
- Discount rate/rule must come from backend configuration, not vendor-entered final amount.
- Vendor enters original amount and optional note.
- System calculates payable amount and discount.
- Member display name should be resolved; UID should not be shown as the user-facing name.
- Confirmed redemption should show clear success feedback.
- Duplicate redemption should be blocked by QR/session token plus vendor plus time window or explicit idempotency key.
- Completed redemptions should be corrected/reversed by a new record, not deleted.

### Activity Check-in

- Current scope has no point reward.
- Event QR should identify event and check-in session.
- Same member should not create duplicate attendance for the same event unless admin explicitly allows re-entry.
- Attendance records should include event ID, member identity, check-in time, and source.
- Member portal should show activity records separately from consumption records.

### Segmented Broadcast

- Segment criteria must be stored with the broadcast record.
- Preview count and final send count must be recorded.
- Failure from LINE API should not silently disappear.
- Paid or sensitive content requires operator confirmation before sending.

## Minimum Table/Log Expectations

Every important action should have at least:

- Stable action ID.
- Actor ID and actor role.
- Target object ID.
- Previous state when applicable.
- New state.
- Request source route.
- Created time in Taiwan display where shown.
- Machine timestamp for sorting.
- Error text if failed.

## Immediate Risks to Fix First

1. D1 migration ledger drift blocks future migration apply.
2. Vendor duplicate application handling must remain strict.
3. POS redemption needs idempotency and correction path.
4. Employee binding sync must distinguish identity save success from Rich Menu link success.
5. Activity check-in must prevent duplicate attendance.

## Go / No-Go Rule

If a new feature changes records and lacks idempotency, audit, and correction behavior, it is not ready for production use.
