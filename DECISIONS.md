# DECISIONS - Sakura Welfare Platform

## Active Decisions

### D001 - Mother Site Owns Employee Verification

Employee verification is performed by the mother site. The child site must not become the authority for employee number and birthday validation.

Reason: mother site already owns roster and member identity.

### D002 - Mother Site Owns Point Records

Point insert, deduction, and query are performed through mother-site APIs. The child site may record redemption and operation logs, but it must not create an independent point authority.

Reason: avoids split balances and inconsistent member records.

### D003 - Child Site Owns Vendor Workflows

Vendor registration, documents, review status, micro-site, partner store listing, POS redemption, and welfare-specific content are owned by the Sakura child site.

Reason: vendor workflows are Sakura-specific and should not pollute the mother-site shared structure.

### D004 - Vendor Login Uses Account/Password First, LINE Login Optional

Vendor backend login uses vendor account/password as the primary method. LINE Login is retained as an optional binding and quick-login path for vendors or users who are willing to bind their LINE identity.

Rules:

- Vendor registration must not require LINE Login.
- System operators may create vendor records and accounts for large vendors that will not self-register from a personal phone.
- Vendors who do not want to use their own phone can operate through account/password.
- Vendors who agree to bind LINE can later use LINE Login for faster access and LIFF-only capabilities.
- LINE/LIFF is still required when a feature needs LINE identity, share target picker, or scanner capability.

Reason: large vendors may be created by system operators and may not personally apply through LINE. Some users are unwilling to use their own mobile LINE account for registration or daily operation, so account/password must remain a complete operational path.

### D005 - LIFF Is Used for Identity and Scanner Capabilities

LIFF should be used for pages that require LINE identity, share target picker, or camera scanner. It should not be forced into every backend page.

Reason: reduces redirect loops and makes vendor account login more stable.

### D006 - Vendor Micro-site Is Public Presentation, Not Full E-commerce

First phase vendor micro-site provides store presentation, business notes, address, phone, LINE link, website/social links, offers, and POS entry. Full menu/DM AI generation is deferred.

Reason: current priority is registration, approval, visibility, and redemption.

### D007 - AI OCR/Menu-DM Is Deferred

AI menu/DM upload and generated showcase are hidden or treated as next-phase work until extraction quality, progress UI, and review flow are stable.

Reason: incomplete extraction can create poor vendor content and review burden.

### D008 - Rich Menu Projects Are Stored in D1

Rich Menu projects, alias IDs, deployed richMenuIds, and switch diagnostics should be stored in D1.

Reason: avoids three-layer drift between local editor state, LINE alias, and admin rules.

### D009 - Replacing Rich Menu Image Must Preserve Hot Areas

When editing an existing Rich Menu project, uploading a new image must preserve current hot-area bounds and actions. Only the background image changes.

Reason: changing visual assets should not force redoing coordinate mapping.

### D010 - Admin UID Whitelist Controls Backend Access

Admin backend access should be controlled through UID whitelist and roles. Account/password can be added where required, but role source must be explicit.

Reason: LINE OA admin and welfare committee workflows need traceable operators.

### D011 - POS Discount Rules Must Come from Backend

Vendor POS should calculate payable amount from backend discount rules. Vendor enters original amount and optional note, not arbitrary final discount.

Reason: prevents inconsistent accounting and manual abuse.

### D012 - Member-Facing Record Pages Must Hide Internal IDs

Member record pages should show store, time, original amount, payable amount, and discount. UID, internal source labels, and empty notes should not be shown.

Reason: member UI should be clean and non-technical.

### D013 - Activity Check-in Has No Point Reward in Current Scope

Activity QR check-in records attendance only. It does not grant points.

Reason: requested event flow is attendance statistics, not reward mechanics.

### D014 - Medical Providers Are an Independent Public Category

Medical partners appear in category filters and also have an independent medical provider entry.

Reason: medical benefits are high-interest and should not be buried inside generic vendor categories.
### D015 - Post-Binding Operations Run on Child Site

After the mother site completes employee verification and LINE binding, Sakura-specific operations may run on the child site.

The mother site remains the authority for employee verification, roster identity, and point records. The child site may store a synchronized binding result and use it for:

- Rich Menu identity assignment.
- Employee-only page access.
- Language-specific welfare entry.
- Vendor discount eligibility.
- Activity check-in visibility.
- Member consumption and activity records.

Reason: verification authority stays centralized, while Sakura welfare operations remain fast and controllable in the child-site D1/LIFF workflow.

### D016 - Identity and Transaction Gates Before New State-Changing Features

New routes or features that depend on Sakura identity must first map the actor to a normalized role: visitor, employee, foreign_employee, vendor_pending, vendor_approved, admin, or manager.

New state-changing features must define actor, permission, scope, idempotency, stored result, audit, and correction path before production use.

Reference documents:

- `docs/identity-and-permission-model.md`
- `docs/transaction-safety-checklist.md`

Reason: the platform now has enough LINE, LIFF, vendor, employee, admin, POS, and activity flows that ad hoc checks can create inconsistent access and duplicate records.

### D017 - Vendor Micro-site Is Public, Vendor Workbench Requires Auth

Vendor micro-sites may remain public because they are presentation pages for employees, visitors, and LINE list browsing.

Vendor workbench, POS redemption, QR check, and any vendor-only operation must require one of the explicit vendor auth paths:

- Valid vendor portal token issued by vendor account/password login.
- Valid LINE identity signature that matches the approved vendor.

Public vendor pages must not expose a direct workbench entry unless the backend confirms canEdit.

Reason: a public store page can be shared, but redemption and editing are state-changing vendor operations. They must not be reachable by guessing a vendor_id.
### D018 - Child Site May Pull Mother Roster Only for Reconciliation

The child site may call the mother-site employee roster API only as a reconciliation tool for existing child CRM rows that already contain both LINE User ID and employee number.

This pull-sync does not replace mother-site employee verification, does not validate birthday, and must not create a new employee authority inside the child site.

Reason: the mother site remains the authority for employee verification, but the child site needs an operational recovery path when callback sync is delayed or historical CRM rows are incomplete.

### D019 - Approved Vendor LINE Binding Uses Vendor Master as Authority

After a vendor is approved, the Sakura child site must keep vendor approval state synchronized across admin review, LINE OA `廠商專區`, vendor portal, POS, and public store/listing routes.

Rules:

- `welfare_vendors` is the authority for vendor approval status and valid vendor LINE UID fields.
- `welfare_vendor_line_sessions` is only a conversational session cache and must not override a valid approved vendor master binding.
- When an approved vendor record contains a valid LINE UID, the child site should refresh or repair the matching `welfare_vendor_line_sessions` row.
- Values that do not look like LINE User IDs, such as phone numbers accidentally stored in LINE fields, must not be treated as a completed LINE binding.
- If a session row points a LINE UID to a vendor that is already bound to another LINE UID, the direct vendor master match wins.

Reason: admin approval, vendor LINE keyword access, and storefront/POS routes must not drift. A stale LINE session cache previously caused an already-approved vendor to see the "not approved or not bound" message in LINE.

#

### D020.1 - Visitor Homepage Is Explicitly Selected From Rich Menu Project Library

- A Rich Menu alias identifies the page itself and is used for switching or identity binding.
- The visitor default homepage is not inferred from alias text.
- The selected visitor homepage is stored as one D1 system setting: `rich_menu_default_home_project_id`.
- The Rich Menu file library must show a selectable `訪客預設首頁` checkbox so operators can choose exactly one default project.
- Employee, vendor, and admin menus remain controlled by `Rich Menu 身分綁定`, not by the visitor default checkbox.

## D020 - Rich Menu Global Default Is Visitor-Only

Rich Menu deployment must not change the LINE global default menu unless the operator explicitly requests it for the visitor homepage menu.

Rules:

- The only allowed global default alias is `guest_zh`.
- Employee menus (`twmem-menu`, `indo-menu`, `taimem-menu`) are applied through employee binding and language rules.
- Vendor menus (`vendor_pending`, `vendor_approved`) are applied through vendor application/review state.
- Admin menus are applied through UID whitelist and role rules.
- Deploying or updating a Rich Menu project should update D1 project metadata and LINE alias, but should not reset all users to that menu.

Reason: LINE global default affects every user who does not have an individual linked Rich Menu. Treating every deploy as default caused page refresh or redeploy flows to behave like the wrong homepage.
## Decision Update Rule

New major product or architecture decisions must be added here before implementation, especially if they affect identity, points, review authority, deployment, LIFF behavior, or data ownership.






### D021 - Mother Check-in Keyword Does Not Bind on Child by Time Guessing

`櫻花報到` 是母站關鍵字，不是子站 webhook 關鍵字。子站不可用子站訊息文字、顯示名稱或報到時間推測員工綁定。

子站員工綁定只接受兩種可靠來源：

- 母站 callback / sync payload 明確提供有效 LINE UID，例如 `line_user_id` 或 `line_id`，且格式為 `U...`。
- 母站 `employee_code` 對上子站既有 CRM 員工列，且該列已經有有效 `line_user_id`。

母站 `user_id` / `User ID` 與 `line_checkin_datetime` 只作稽核欄位，不作自動綁定依據。

Reason: 避免跨系統用時間或姓名猜測造成錯綁，Rich Menu 身分選單必須只依可靠 LINE UID 套用。

### D022 - Mother User ID May Resolve Through Explicit Point Ledger Mapping

母站 `櫻花報到` 若只在員工表提供 WordPress `User ID`，子站仍不可用姓名或報到時間猜測 LINE UID。

唯一允許的補救路徑是：使用母站點數列表 API 的明確資料列，將 `user_id` 對應到同列的 `LINE_user_id`，再寫回子站 CRM 與員工綁定。

Rules:

- `user_id -> LINE_user_id` 必須來自母站點數帳本同一筆資料列。
- 找不到點數帳本對應時，不自動綁定。
- 不使用顯示名稱、報到時間、訊息時間或相似文字做推測。
- 此路徑只用於補同步與 Rich Menu 套用，不改變母站仍為員工驗證權威的決策。

Reason: 母站畫面可看到內部 User ID，但子站需要 LINE UID 才能套用 Rich Menu；點數帳本若已有明確對應，可作為安全反查來源。

### D023 - GitHub Verification Is Automatic, Production Deployment Is Manual

- Pull Request 與 main push 只執行 Sakura Worker 語法、綁定與差異檢查。
- 正式 Cloudflare Worker 部署只能從 GitHub Actions 手動執行，並固定使用 wrangler.sakura-welfare.toml。
- GitHub workflow 不執行 D1 migration，也不寫入 Remote D1。
- Cloudflare API token 與 account ID 僅存放於 GitHub Actions secrets，不得提交至 repository。

Reason: GitHub 應保存可部署原始碼與驗證紀錄，但一般程式提交不應自動改動正式福利平台或資料庫。
