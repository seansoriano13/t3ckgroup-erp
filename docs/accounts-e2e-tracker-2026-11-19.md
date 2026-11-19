# Accounts E2E tracker (2026-11-19)

A Playwright pass over the **Accounts** module (Login, Forgot password, Reset password, My Profile, and the `/verify/<token>` page) on the hosted staging site (commit `205c3d8` on `staging`), driven with `playwright-cli` and a few `run-code` scripts.
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1114** and its sub-issues (see the Ticket column).

**How it was checked**

- 2 mock logins on staging, each in its own browser session: Jade (plain Warehouse Staff, no flags) and Jen (Admin head).
- Login form: empty fields, white-space email, wrong password, unknown email, Forgot password with no email, a good sign-in, and opening `/login` while signed in.
- Reset password: opening it with no link, with a made-up `token_hash`, and while signed in.
- My Profile: the page as an employee and as a head, a 300-character quote, a banner "URL" that is not a URL, and the page at phone width (390).
- `/verify/not-a-real-token`.
- API checks with Jade's own token: a direct `PATCH` on her own `employees` row for every column that gives access or names her (department, role, name, every `is_*`, `has_*` and `can_*` flag, email), a `PATCH` on Dani's row, a 5,000-character quote, a `javascript:` banner path, the `manage-employee-password` function for someone else, and `verify_form_token` with a bad token.
- Scripts and raw results: `scratch/accounts-e2e-2026-11-19/` (not committed).
- Cleanup: every value Jade's row was changed to was put back straight after; a final read of the whole row matched the first read (no column differs). Nothing was saved through the Profile form. Dani's row was never changed (the write hit 0 rows).

**Not covered:** Google sign-in; a real reset email from start to end (no inbox for the mock people); uploading an avatar or banner (Cloudinary); signature capture; the HR and Super Admin profile views; `/verify` with a real token; dark mode; tablet size.

**Environment notes (not app bugs):**

- Staging mock people all use the password `staging`, so "issued password" state was not tested.
- The bad `token_hash` makes one `403` on `/auth/v1/verify` and a console error. That is the provider refusing the link, and the page shows the right notice.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Own employee record (API) | 1 | 1 | 1 |
| B. Reset password | 0 | 0 | 1 |
| **Total (4)** | **1** | **1** | **2** |

One P1, and it is serious: any signed-in person can change their own department, role, name and most access flags straight through the API, including the flag that lets them act as other people. The screens themselves held up well.

---

## A. Own employee record (API)

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P1 | A plain employee can rewrite most of their own `employees` row through the API. Jade changed, and the server kept: `department` (OPERATIONS to ADMIN), `sub_department`, `role`, `name`, `is_deleted`, `has_sales_flow`, `has_task_flow`, `is_role_simulator`, `has_retail_access`, `has_bug_report_access`, `is_issued_password`. `is_role_simulator` lets a person view the app as someone else; `department` decides which head approves them and what they can read. | `PATCH /rest/v1/employees?id=eq.<jade>` returned `200` and the row read back with each new value (script `cols.js`, every value put back after). Code: `prevent_role_escalation()` in `supabase/migrations/20261013100000_finance_access_flag.sql` only guards a list of named columns, so every column added later is open. | Turn the guard around: when the caller is not a Super Admin (or HR, for the HR-owned fields), a self-update may change only `avatar_path`, `dashboard_banner_path`, `dashboard_quote`, `signature_path` and `updated_at`; any other change is refused with an error, not silently kept. Add a pgTAP test that walks every column. | #1115 |
| A2 | P2 | The quote has no limit on the server. The form stops at 100 characters, but the API stored a 5,009-character quote. | `PATCH` with `dashboard_quote` of 5,009 characters returned `200`; the read back held the full text. In the form, typing 309 characters left the counter at `100/100` (the box has `maxlength=100`). | Add a check: `dashboard_quote` at most 100 characters, trimmed, empty means null. | #1115 |
| A3 | P3 | The banner field accepts any text. The form keeps Save on for "not a url", and the API stored `javascript:alert(1)` as the banner path. It is only used as an image address, so it does no harm today, but it shows a broken banner. | In the form, typing "not a url" left **Save settings** enabled. `PATCH` with `dashboard_banner_path: "javascript:alert(1)"` returned `200` and was stored (then put back). | In the form, show "Enter a web address that starts with https://" and keep Save off. On the server, allow only `https://` addresses or a storage path. | #1116 |

## B. Reset password

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P3 | A signed-in person who opens `/reset-password` is told "Open this page from the link in your password-reset email" and given **Back to login**, which just sends them to the dashboard. They most likely want to change their password. | As Jen (signed in), the page read "Can't reset your password / Open this page from the link in your password-reset email. / Back to login". | When someone is signed in, say "To change your password, use Change Password on My Profile." and link to `/profile` instead of the login page. | #1117 |

---

## What held up

- **Role flags are guarded.** Jade could not give herself `is_super_admin`, `is_hr`, `is_head`, `has_purchasing_flow`, `has_finance_flow`: the write returned `200` but the read back kept the old value. `can_manage_leaves`, `can_edit_sales_flows` and `email` were refused with `403`.
- **Other people's rows are closed.** A `PATCH` on Dani's row returned `200` with `[]`; nothing changed.
- **Passwords:** `manage-employee-password` with `reissue` for Dani returned `403` "Only a Super Admin can reissue a password."
- **Login form:** empty fields show "Enter your email address." and "Enter your password."; white space counts as empty; Forgot password with no email shows "Enter your email address first." and puts the cursor in the box; a wrong password and an unknown email give the same message, so the form does not tell anyone which emails exist; opening `/login` while signed in goes to the dashboard.
- **Redirect after login** only goes to paths on this site (code: `src/utils/authRedirect.js`; not tested in the browser).
- **Reset password** with no link, or with a made-up link, shows "Can't reset your password" and never shows the form.
- **Verify:** a bad token shows "Record Not Found"; `verify_form_token` returned `null`.
- **Phone width (390):** My Profile has no sideways scroll (`scrollWidth - innerWidth = 0`).
- **Profile stats** show the right labels per role: "Total Tasks Logged" for Jade, "Awaiting Your Approval" for Jen.

## Watch list

- `prevent_role_escalation()` has been rewritten in at least four migrations, each time adding one more column. A1's fix should end that pattern; any new access flag must be safe by default.
- The profile save quietly returns a made-up row when the update returns nothing (`employeeService.updateSelfPreferences`). If A1's fix refuses a write, check the form shows the error instead.

## Decisions made for this spec

- D1. Self-update is an allowlist, not a denylist: a person may change only how their own dashboard looks and their signature. Everything else is HR or Super Admin work in Workforce.
- D2. A refused column is an error, not a silent keep, so a bug in the app shows up at once.
- D3. The quote limit is 100 characters, the same as the form.
