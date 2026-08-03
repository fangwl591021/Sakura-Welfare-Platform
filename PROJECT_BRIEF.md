# PROJECT BRIEF - Sakura Welfare Platform

## Project

櫻花福委會福利資訊整合平台。

The platform is a LINE OA based welfare operation system for Sakura employees, welfare committee administrators, partner vendors, and visitors. It is not only a benefit announcement page. It must support identity binding, vendor onboarding, approved vendor visibility, welfare content, redemptions, activity check-in, LINE OA monitoring, and management reporting.

## Primary Goals

- Give employees a LINE-first entry to welfare information, approved partner vendors, medical partners, club activities, events, and redemption history.
- Let partner vendors register, submit required documents, maintain basic store information, and operate approved micro-site and POS redemption flows.
- Let welfare committee administrators review vendor applications, monitor LINE OA conversations, manage Rich Menu and keywords, publish segmented messages, and inspect platform performance.
- Preserve mother-site authority for employee verification and point records.
- Keep the child site responsible for Sakura-specific welfare content, vendor workflows, LIFF pages, D1 records, R2 files, and operational views.

## User Roles

- Visitor: LINE OA friend who has not completed employee binding. Can browse public content and apply as a vendor if needed.
- Employee: verified by mother site through employee number and birthday MMDD. Can access employee-only welfare content and QR redemption.
- Vendor: partner store operator. Uses vendor account/password as the primary login method. LINE Login is optional for vendors who choose to bind LINE for faster future access. LIFF is used only where LINE identity or camera/scanner capabilities are needed.
- Committee/Admin: Sakura welfare committee or authorized operator. Uses admin backend, UID whitelist, and role-based access.
- Mother site: authority for employee identity, existing member records, point read/write, and legacy keyword functions.
- Child site: Sakura Welfare Platform Worker, D1, R2, LIFF pages, vendor operations, LINE OA monitoring, and presentation.

## Core Flows

### Employee Binding

1. User enters the LINE OA.
2. User opens the mother-site binding flow.
3. Mother site validates employee number and birthday MMDD.
4. Mother site returns or exposes a binding result for the child site.
5. Child site stores the synchronized binding result for Sakura operations.
6. Rich Menu and page access are selected by identity and language on the child site.

### Vendor Registration

1. Vendor starts from the application URL or LINE OA keyword.
2. Vendor fills basic information, license/document section, and offer content section.
3. Form submission writes to D1 and appears in admin review.
4. Committee reviews, approves, returns, suspends, or hides the application.
5. Approved vendor can use vendor portal and POS redemption.

### Vendor Portal / Micro-site

1. Vendor logs in with account/password.
2. Vendor edits allowed public fields such as store description, business notes, address, phone, LINE link, owned website, and social links.
3. Sensitive changes or public-facing content updates can be reviewed by committee before publication.
4. Vendor micro-site is available through `/vendor-store?vendor_id=...`.

### POS Redemption

1. Vendor logs in with account/password.
2. Vendor opens POS page, normally under LIFF when scanner is needed.
3. Vendor scans member QR code.
4. System resolves member name, role, and available discount.
5. Vendor enters original amount and optional note.
6. System calculates payable amount and discount from backend rules.
7. Record is saved to D1 and visible to vendor/admin/member history.

### LINE OA Operations

1. LINE webhook enters Cloudflare Worker.
2. Worker verifies LINE signature.
3. Worker forwards or preserves mother-site behavior.
4. Child site records messages, keyword hits, Rich Menu switch checks, and monitoring data.
5. Admin uses LINE OA monitor, keyword rules, Rich Menu editor, Flex templates, and segmented push tools.

### Activity Check-in

1. Admin creates events in calendar format.
2. System generates QR check-in entry.
3. Member checks in without point reward.
4. Admin can inspect attendance list and activity records.
5. Member portal shows consumption and activity records under separate tabs.

## Current Product Boundaries

- Employee verification belongs to mother site.

- After employee binding succeeds, Sakura-specific operations can run on child site using the synchronized binding result.
- Vendor registration, review, micro-site, POS redemption, Rich Menu, LIFF pages, D1, and R2 belong to child site.
- Telegram is for admin notification and review alerts, not primary data storage.
- AI is assistive. It must not approve sensitive vendor or employee-facing content without human review.


