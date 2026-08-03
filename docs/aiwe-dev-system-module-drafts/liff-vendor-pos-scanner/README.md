# Module Draft - LIFF Vendor POS Scanner

Status: Candidate for reuse.

Verified source project: Sakura Welfare Platform.

## Purpose

Allow approved vendors to scan member QR codes and record redemptions using account/password login as the primary auth method, with LIFF used for scanner capability where needed.

## Core Pattern

1. Vendor logs in with vendor account/password.
2. Backend returns vendor portal token and vendor ID.
3. POS page loads vendor data before scanner initialization.
4. Scanner opens through LIFF or supported browser camera path.
5. QR content resolves member identity.
6. Vendor enters original amount and optional note.
7. Backend applies discount rules and saves redemption.
8. UI displays success popup and confirmation sound.

## Sakura Routes

- `/vendor-login`
- `/vendor-portal`
- `/vendor-pos`
- `/api/vendor-login`
- `/api/vendor-pos`

## Key Tables

- `welfare_vendors`
- `welfare_redemptions`
- `welfare_members` or member profile records where available.

## Required Capabilities

- Secure account/password validation.
- Portal token validation.
- LIFF scanner or camera fallback.
- Backend discount calculation.
- Member display name lookup.

## Risks

- Scanner cannot open outside supported context.
- LINE in-app browser permission differs from external browser.
- Loading LIFF before vendor data can cause stuck loading state.
- Showing UID or internal source labels creates poor member UX.

## Acceptance Checks

- Vendor can log in with account/password.
- POS loads only that vendor's own data.
- Camera scanner opens in supported LIFF context.
- Member name appears after scan.
- Original amount converts to payable and discount.
- Optional note is saved.
- Success popup appears after redemption.
- Member record page shows clean redemption history.

