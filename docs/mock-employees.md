# Mock employees (STAGING only)

Test accounts for manual and AI-driven testing on the staging app. They do not exist in production.
Sign in with **email + password** on the login page (not Google).

**Password (all):** `MockStaging#2026`

| Email | Name | Dept / Sub | Role | Flags |
|---|---|---|---|---|
| super-admin@mock.t3ck.test | Mock Super Admin | SUPER ADMIN | SYSTEM ADMINISTRATOR | is_super_admin |
| sales-head@mock.t3ck.test | Mock Sales Head | SALES | SALES DIRECTOR | is_head, has_sales_flow |
| sales-subhead@mock.t3ck.test | Mock Sales Sub Head | SALES / NGO | NGO TEAM LEAD | is_head, has_sales_flow |
| sales-exec@mock.t3ck.test | Mock Sales Executive | SALES / NGO | SALES EXECUTIVE | has_sales_flow |
| sales-exec-2@mock.t3ck.test | Mock Sales Executive Two | SALES / GOV | SALES EXECUTIVE | has_sales_flow |
| hr@mock.t3ck.test | Mock HR Officer | ADMIN / HR | HR OFFICER | is_hr |
| leave-manager@mock.t3ck.test | Mock Leave Manager | ADMIN / HR | HR ASSISTANT | can_manage_leaves |
| admin-head@mock.t3ck.test | Mock Admin Head | ADMIN / ADMIN | ADMIN MANAGER | is_head, has_task_flow |
| finance@mock.t3ck.test | Mock Finance Staff | ADMIN / FINANCE | ACCOUNTING STAFF | has_task_flow, has_finance_flow |
| ops-head@mock.t3ck.test | Mock Operations Head | OPERATIONS | OPERATIONS MANAGER | is_head, has_task_flow |
| purchaser@mock.t3ck.test | Mock Purchaser | OPERATIONS / PURCHASING | PURCHASER | has_purchasing_flow, has_task_flow |
| logistics@mock.t3ck.test | Mock Logistics Staff | OPERATIONS / LOGISTICS | LOGISTICS ASSISTANT | has_task_flow |
| technical@mock.t3ck.test | Mock Technical Staff | OPERATIONS / TECHNICAL | TECHNICIAN | has_task_flow |
| flow-editor@mock.t3ck.test | Mock Flow Editor | OPERATIONS / IT | IT STAFF | can_edit_sales_flows |
| plain@mock.t3ck.test | Mock Plain Employee | OPERATIONS / WAREHOUSE | WAREHOUSE STAFF | none |
| purchaser-2@mock.t3ck.test | Mock Purchaser Two | OPERATIONS / PURCHASING | PURCHASER | has_purchasing_flow, has_task_flow |
| approver@mock.t3ck.test | Mock Approver | ADMIN / ADMIN | GENERAL MANAGER | is_head, has_task_flow |

Re-create or reset (passwords, flags) any time: `node scripts/seed-mock-employees.mjs` (needs `STAGING_DB_URL` in `.env.local`). Local stack: add `--local`.
To add a role, add it to `MOCK` in that script and to this table.

**Local stack only (`--local`):** also puts the cast on the Transmittal staff lists (#251) — Warehouse: plain, Technical: technical, Logistics: logistics, Check by: ops-head (call sign 1001) + admin-head (call sign 102). It also fills the IPAS sign-off lists (1 and 3 Approved: admin-head; 7 Received: ops-head, Noted: sales-head, Checked and Approved: approver) and the Costing lists (Final Acquire: approver, Evaluation: ops-head). Super Admin is on no list, on purpose. Staging's lists are left alone. The purchasing browser stories (`docs/stories/purchasing/`) rely on this cast.
