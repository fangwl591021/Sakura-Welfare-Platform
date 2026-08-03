# Feature Classification Gate - Sakura Welfare Platform

## Purpose

Before adding a feature, classify it. This prevents customer-specific behavior, LINE-specific behavior, and reusable platform behavior from being mixed together.

## Classification

| Class | Meaning | Sakura Examples | Rule |
| --- | --- | --- | --- |
| Platform Core | Cross-project invariant | Identity concept, tenant boundary, audit principle | Do not implement as Sakura-specific code without separate framework approval |
| Domain Module | Reusable business capability | Attendance, redemption, referral, broadcast, Rich Menu policy | Needs contract, state model, idempotency, audit |
| Adapter | Provider integration | LINE webhook, LIFF scanner, Telegram, R2 upload, OpenAI | Must not own business rules |
| Extension | Sakura-specific workflow | Welfare committee vendor review, Sakura employee benefit visibility | Can be implemented in Sakura app with clear boundary |
| Application / Configuration | Tenant settings | Rich Menu mapping, language labels, category list, discount policy | Prefer D1 config over code constants |

## Required Questions Before Coding

1. Is this reusable across future projects, or Sakura-only?
2. Does it change state?
3. Which normalized role can use it?
4. Which data table owns the result?
5. Is LINE/LIFF just the channel, or is it the business process?
6. Does the feature need idempotency?
7. Does it need review/approval?
8. Does it affect member-visible or vendor-visible content?
9. Does it require mother-site authority?
10. What is the rollback or correction path?

## Examples

### Employee Binding

- Mother-site verification: external authority / adapter contract.
- Child-site synchronized identity: Sakura extension.
- Identity-to-Rich-Menu mapping: application configuration.

### Vendor POS Redemption

- Scanner: LIFF adapter.
- Redemption record: domain module behavior.
- Sakura discount eligibility: application configuration.
- Vendor login: Sakura application auth.

### Activity Check-in

- QR scan input: adapter.
- Attendance record: domain module behavior.
- Sakura event audience: application configuration.

### Vendor Micro-site

- Public display route: Sakura extension.
- Vendor-editable fields: Sakura application data.
- Approval requirement: review workflow extension.
- Uploaded image storage: R2 adapter plus D1 metadata.

## No-Go Conditions

Do not implement directly if:

- Identity role is unclear.
- State change has no idempotency or audit.
- Source of truth is disputed between mother site and child site.
- A LINE-specific action contains business rules that should be route-independent.
- A customer-specific rule is being added to framework/core terminology.

## Required References

Use these documents before implementation:

- `docs/identity-and-permission-model.md`
- `docs/transaction-safety-checklist.md`
- `DECISIONS.md`
- `KNOWN_ISSUES.md`
- Relevant route/module source file.
