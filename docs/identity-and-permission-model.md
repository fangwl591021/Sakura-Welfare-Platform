# Identity and Permission Model - Sakura Welfare Platform

## Purpose

This document fixes the Sakura identity boundary before more features are added.

The platform must not treat LINE UID, employee number, vendor account, and admin UID as the same thing. Each one is an identity signal. Access must be decided by a normalized Sakura role and permission state.

## Identity Sources

| Source | Owner | Used For | Must Not Be Used For |
| --- | --- | --- | --- |
| LINE User ID | LINE OA / LIFF | Messaging, LIFF profile, Rich Menu link target, member display | Employee verification by itself |
| Employee number + birthday MMDD | Mother site | Employee verification | Child-site standalone verification authority |
| Mother-site member / point APIs | Mother site | Point ledger and existing member authority | Child-site independent point balance |
| Vendor account/password | Child site | Vendor portal and POS login | Admin access |
| Admin UID whitelist | Child site | Admin backend access | Employee or vendor proof |
| D1 synchronized member row | Child site | Sakura operation cache and page access | Replacing mother-site identity authority |

## Normalized Sakura Roles

| Role | Meaning | Entry | Default Rich Menu Class | Main Permissions |
| --- | --- | --- | --- | --- |
| `visitor` | LINE friend or public user not yet employee-bound | LINE OA, public LIFF pages | Visitor menu | Public listings, vendor application, binding entry |
| `employee` | Mother-site verified active employee | Mother-site binding then child sync | Employee language menu | Employee welfare pages, employee discount eligibility, member records, activity visibility |
| `foreign_employee` | Employee using Indonesian / Thai language experience | Mother-site binding plus language | Employee language-specific menu | Same as employee, localized entry |
| `vendor_pending` | Vendor applicant not approved | LINE keyword or vendor login | Vendor pending menu | Upload/edit application, view review result |
| `vendor_approved` | Approved vendor operator | Vendor account/password, optional LIFF for scanner | Vendor approved menu | Vendor portal, micro-site edit, POS redemption |
| `admin` | Authorized committee/admin operator | UID whitelist/admin backend | Admin menu or backend | Review, reports, keyword, Rich Menu, vendor management |
| `manager` | Company cadre / elevated audience group | Employee sync or admin assignment | Manager-capable menu | Manager-only events/content if configured |

## Identity Resolution Order

When a request needs access control, resolve identity in this order:

1. Admin route: validate admin session / UID whitelist / role assignment.
2. Vendor route: validate vendor portal token or account/password session.
3. LIFF/member route: resolve LINE User ID, then synchronized `welfare_members` record.
4. Public route: treat as `visitor`.

Do not infer admin or vendor permissions from a display name, URL parameter alone, or visible front-end state.

## Rich Menu Assignment Rules

Rich Menu assignment must be driven by normalized identity, not by ad hoc keywords alone.

| Condition | Target Type | Language | Expected Result |
| --- | --- | --- | --- |
| No binding | `visitor` | selected/default language | Visitor menu |
| Active employee bound | `employee` | `zh-TW`, `vi`, `th`, `id` | Employee menu for language |
| Vendor application pending | `vendor_pending` | selected/default language | Vendor application/status menu |
| Vendor approved | `vendor_approved` | selected/default language | Vendor operations menu |
| Admin UID matched | `admin` | selected/default language | Admin/operator menu |

The D1 table `rich_menu_bindings` should remain the source of truth for identity-to-menu policy. `rich_menu_projects` stores deployed project metadata and alias mapping.

## Page and API Access Matrix

| Area | Visitor | Employee | Vendor Pending | Vendor Approved | Admin |
| --- | --- | --- | --- | --- | --- |
| Public partner store / medical listing | Read | Read | Read | Read | Manage |
| Employee-only benefit content | No | Read | No | No, unless also employee | Manage |
| Member consumption records | Own public/visitor record only if identified | Own records | No | No | Search/report |
| Vendor application form | Create | Create if applying vendor | Edit own application | View/edit own vendor data | Review/manage |
| Vendor portal | No | No | Own application/status | Own vendor operations | Impersonation only if logged/audited |
| Vendor POS | No | No | No | Own vendor only | Audit/report |
| Admin backend | No | No | No | No | Yes |
| Activity calendar | Public audience only | Employee audience | Vendor audience only if configured | Vendor audience only if configured | Manage |

## Data Storage Rules

- Store LINE User ID only where needed for messaging, LIFF identity, or linking records.
- Do not expose LINE UID on member-facing pages.
- Store employee verification as a synchronized result from mother site; do not store raw birthday MMDD unless there is a specific approved need.
- Vendor account/password belongs to child site and must not be mixed with admin credentials.
- Public-facing vendor changes should create a reviewable change request when the field affects employee-facing content.

## Immediate Implementation Gates

Before adding or changing a route, answer:

1. Which normalized role can use it?
2. Which identity source proves that role?
3. Which table is the source of truth?
4. Does this route need Rich Menu change, page access, or both?
5. What is logged if the action changes state?

If these cannot be answered, the feature should stay in proposal/design state.

