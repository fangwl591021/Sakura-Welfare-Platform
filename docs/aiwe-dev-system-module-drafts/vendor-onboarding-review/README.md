# Module Draft - Vendor Onboarding and Review

Status: Candidate for reuse.

Verified source project: Sakura Welfare Platform.

## Purpose

Provide vendor application, document upload, review, approval, return, suspension, soft-hide, and approved vendor portal entry.

## Core Sections

Vendor application is divided into three independent sections:

1. Vendor basic information.
2. License/document section.
3. Offer content section.

Each section can be supplemented or edited without forcing all data to be re-entered.

## Sakura Routes

- `/vendor-apply`
- `/vendor-status`
- `/vendor-login`
- `/vendor-portal`
- Admin vendor review in `/sakura-admin`

## Required Behavior

- Prevent duplicate applications by same account/LINE/user identity where possible.
- Existing applicant should reopen existing data instead of blank form.
- Approved vendors can enter vendor portal.
- Returned applications show review result and supplement instructions.
- Vendor-created or system-created accounts both work.
- File uploads must be stored as files, not URL-only fields.

## Key Data

- Vendor ID.
- Vendor account/password.
- Contact person.
- Phone/email/LINE.
- Business registration document.
- Food registration number/file where applicable.
- Insurance number/file.
- Contract dates.
- Offer policy.
- Website/social/shop URLs.
- Review status and reviewer notes.

## Risks

- Duplicate application creates inconsistent records.
- Mobile submit button not locking causes repeated submissions.
- Review count and visible table count drift.
- Missing uploaded file preview makes review impossible.

## Acceptance Checks

- New application appears in review list.
- Existing applicant can edit existing data.
- File upload is visible to reviewer.
- Approve/return/suspend/hide states are clear.
- Vendor login works after account is set.

