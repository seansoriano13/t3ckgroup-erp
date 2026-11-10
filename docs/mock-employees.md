# Mock employees (staging and local)

Test accounts for manual and AI-driven testing. They do not exist in production.
Sign in with **email + password** on the login page (not Google).

## Staging

- Email: the person in the Login column, with `@staging`, for example `dani@staging`, `101@staging`, `ayla@staging`.
- Password: `staging`
- Every staging name ends in "(staging)", for example "Dani (staging)".
- Seed: `node scripts/seed-mock-employees.mjs` (needs `STAGING_DB_URL` in `.env.local`).

## Local stack

- Email: the person in the Login column, with `@local`, for example `dani@local`, `101@local`, `ayla@local`.
- Password: `local`
- Every local name ends in "(local)", for example "Dani (local)", so a local screen is never mistaken for the real one.
- Seed: `pnpm seed:mock:local` (same as `node scripts/seed-mock-employees.mjs --local`).

| Login | Mock role | Dept / Sub | Role | Flags |
|---|---|---|---|---|
| 101 | super-admin | SUPER ADMIN | SYSTEM ADMINISTRATOR | is_super_admin |
| maey | sales-head | SALES | SALES DIRECTOR | is_head, has_sales_flow |
| grace | sales-subhead | SALES / NGO | NGO TEAM LEAD | is_head, has_sales_flow |
| dani | sales-exec | SALES / NGO | SALES EXECUTIVE | has_sales_flow |
| aldrin | sales-exec-2 | SALES / GOV | SALES EXECUTIVE | has_sales_flow |
| geane | hr | ADMIN / HR | HR OFFICER | is_hr |
| ysabelle | leave-manager | ADMIN / HR | HR ASSISTANT | can_manage_leaves |
| jen | admin-head | ADMIN / ADMIN | ADMIN MANAGER | is_head, has_task_flow |
| jelai | finance | ADMIN / FINANCE | ACCOUNTING STAFF | has_task_flow, has_finance_flow |
| gracean | ops-head | OPERATIONS | OPERATIONS MANAGER | is_head, has_task_flow |
| ayla | purchaser | OPERATIONS / PURCHASING | PURCHASER | has_purchasing_flow, has_task_flow |
| alvin | logistics | OPERATIONS / LOGISTICS | LOGISTICS ASSISTANT | has_task_flow |
| oliver | technical | OPERATIONS / TECHNICAL | TECHNICIAN | has_task_flow |
| sean | flow-editor | OPERATIONS / IT | IT STAFF | can_edit_sales_flows |
| jade | plain | OPERATIONS / WAREHOUSE | WAREHOUSE STAFF | none |
| micko | purchaser-2 | OPERATIONS / PURCHASING | PURCHASER | has_purchasing_flow, has_task_flow |
| 201 | approver | ADMIN / ADMIN | GENERAL MANAGER | is_head, has_task_flow |

Re-create or reset (passwords, flags) any time with the seed commands above. The seed is safe to run again.
To add a role, add it to `MOCK` and `LOGINS` in that script and to this table.

**Local stack only (`--local`):** also puts the cast on the Transmittal staff lists (#251) — Warehouse: plain, Technical: technical, Logistics: logistics, Check by: ops-head (call sign 1001) + admin-head (call sign 102). It also fills the IPAS sign-off lists (1 and 3 Approved: admin-head; 7 Received: ops-head, Noted: sales-head, Checked and Approved: approver) and the Costing lists (Final Acquire: approver, Evaluation: ops-head). Super Admin is on no list, on purpose. Staging's lists are left alone. The purchasing browser stories (`docs/stories/purchasing/`) rely on this cast.
