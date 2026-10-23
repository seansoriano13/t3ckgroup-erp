# Purchasing browser stories

Stories for an AI to run in a browser against the **local** app. Each one checks a rule from [docs/purchasing-lifecycle.md](../../purchasing-lifecycle.md) (the "Guide" line names the section).

Run them locally only. The AI types test passwords, and it may only do that on `localhost`. Never run them on staging or the live site.

## 1. Setup (once per run)

1. Docker Desktop is running and the local database is up (`npx supabase start`).
2. Load the test people and lists: `node scripts/seed-mock-employees.mjs --local`.
3. Load the three test SORs and sample records: `node scripts/seed-mock-purchasing.mjs`. It stops by itself if they are already there.
4. Start the Odoo functions with the secrets file: `npx supabase functions serve --env-file supabase/functions/.env`. Leave it running.
5. Start the app: `pnpm dev`. Open `http://localhost:5173` (or the port it prints).
6. A local database needs a **published Sales Flow** (the seed does not publish one), and the **`currency-rates-fetch` function run once** so Reference Rates exist (SET-06 and the foreign-currency stories need them). Without a published Flow, FLOW-00 cannot register an SOR.

Check before starting: log in as `purchaser@mock.t3ck.test`, open IPAS list, start a new IPAS with PO `P02401`. If it shows the supplier "Dee Hwa Liong", Odoo works. Close the form without saving.

## 2. The cast

Password for all: `MockStaging#2026`. Email is `<key>@mock.t3ck.test`.

| Key | Used as |
|---|---|
| super-admin | Super Admin. On **no** sign-off list, on purpose. |
| purchaser | Purchasing access. The usual Buyer and preparer. |
| purchaser-2 | Purchasing access. A second purchaser who is not on the request. |
| finance | Finance access. |
| sales-exec | Deal Owner and Deal Team on the test SORs. |
| sales-exec-2 | Sales, not on the Deal Team. |
| admin-head | IPAS section 1 and 2 Approved. Transmittal Check by. |
| ops-head | IPAS section 4 Received. Transmittal Check by. Costing Evaluation list. |
| sales-head | IPAS section 4 Noted. |
| approver | IPAS section 4 Checked and Approved. Costing Final Acquire list. |

| plain | Transmittal Warehouse list. No flags. |
| technical | Transmittal Technical list. |
| logistics | Transmittal Logistics list. |

IPAS sections are numbered as the screen shows them: 1, 2 and 4 (section 3 on the screen is Computation status and has no sign-off).

### Log in as another person

The login form pre-fills the magic login (`VITE_MAGIC_LOGIN_*`) and the browser's autofill, so a typed email can land on top of a saved one. For each person:

1. Clear the site's localStorage, then open `/login`.
2. Triple-click the email box and type the email. Triple-click the password box and type the password.
3. Press Sign in, then wait about 5 seconds.
4. Close the "What's New" dialog if it shows.

Check the name in the app header before you start the story.

## 3. Test data

**Start from a fresh SOR.** Run FLOW-00 first: `sales-exec` registers a new SOR through the published Sales Flow, so it is owned by the Deal Owner and gets a Costing Matrix and Purchase Request from the Stage Actions. Use that SOR wherever a story says "the SOR" or names S990001 and S990002. Do not run the stories on the seed SORs: they are owned by the Super Admin and have no Costing Matrix, so the Final Acquire list and the Evaluation list cannot open them and the matrix stories block.

The mock seed still makes `S990001` Alpha laptops, `S990002` Beta water pumps and `S990003` Gamma solar lamps. They are fine for reading lists and for stories that only need a bare SOR. If a story needs another fresh SOR, register one as `sales-exec` with client "Mock Client Story <story id>".

**Real Odoo POs** (read only, picked 2026-10-19). Nobody writes to Odoo. Use each PO for at most one live IPAS at a time; cancel the IPAS at the end of a story that raises one, unless the story says to keep it.

| PO | What it is | Use for |
|---|---|---|
| P02401 | Confirmed, PHP, ₱6,825.50, Dee Hwa Liong | Happy path, local |
| P02396 | Confirmed, PHP, ₱624,375, All Certified Equipment | Second local PO, multi-SOR |
| P02395 | Confirmed, PHP, ₱277,400.85, Chase Integrated Systems | Supplier account checks (first) |
| P02369 | Confirmed, PHP, ₱250,741.07, Chase Integrated Systems | Supplier account checks (second, same supplier) |
| P02343 | Confirmed, **USD** 48, Henan Winall | Spare foreign PO |
| P02390 | Confirmed, PHP, KJK Metal Fabrication | Spare |
| P02400 | Confirmed, **USD** 22,676, Beijing LSJ | Foreign PO, import |
| P02393 | Confirmed, **USD** 72, Henan Winall | Second foreign PO |
| P02698 | RFQ (draft), PHP, PETZL | RFQ is accepted |
| P9999999 | Does not exist | "Not found" |
| P9900001 to P9900005 | Mock IPAS from the seed, not in Odoo | Never refresh these and expect Odoo data |

## 3a. How the screens look (spec #631)

Stories name controls by these shared parts, so read them once.

- **Lists** (Purchase Requests, Canvasses, IPAS, Transmittals, Packing Lists, Dashboard): state pills with counts, one filter bar (search, up to three dropdowns, Filters, Export at the end), a table with sortable headings, a first column of reference over name, a right-aligned State badge, and a pager. Ages read "3d" and dates read "Oct 22".
- **Records** open in one full-height window over their list, at every width. The title is the reference and name, with one state badge and one quiet line. Headline facts are pills under it, and a pill you may change opens a picker. There is no footer bar and no Expand. The X and Esc close it and return you to the list.
- **Your move** is the card on the right (under the record on a phone). Its main button (Sign, Submit, Approve) is green and sits inside the open step. Take is an outline button.
- **More** holds Print and Cancel, and shows only when it has something in it.
- **Dialogs** with fields use the Purchasing frame; plain yes/no questions use the plain confirm. Nothing is asked in a toast. Only New Canvass, New Transmittal and Print preview have Expand.

## 4. Story format

Every story has:
- **Guide**: the section of the lifecycle guide it checks.
- **Log in as**: one or more cast keys. "Then as X" means log out and log in as X.
- **Needs**: what must exist first, often another story's result.
- **Steps**: numbered. Do them in order.
- **You should see**: every check. A story passes only if every line is true.

Name every record you create with the story id, for example remarks "STORY IPAS-04", so it can be found later.

## 5. Results

Write one file per run: `results/YYYY-MM-DD-run.md`, copied from [results/TEMPLATE.md](results/TEMPLATE.md). Screenshots go in `results/YYYY-MM-DD-shots/` (git ignores them). Git ignores the shots, so write what you saw for every failure in the run file itself, in words: a later agent cannot open your screenshots.

Each story gets one line: **PASS**, **FAIL** or **BLOCKED**.
- **FAIL**: the app did something the story says it must not. Add what you saw and a screenshot.
- **BLOCKED**: you could not do a step (no such button, setup missing, earlier story failed). Say which step and why. Blocked is not a pass.

On a failure, note it and carry on with the next story. Never stop the run for one failure.

Never "fix" anything during a run: no database edits, no code edits. Only use the app as the person you are logged in as.

## 6. Files

| File | Area | Guide |
|---|---|---|
| [ACC.md](ACC.md) | Access and who sees what | §2, §16 |
| [PR.md](PR.md) | Purchase Requests and Requested Items | §6 |
| [CM.md](CM.md) | Costing Matrix, sign-offs, Bid Decision | §7 |
| [CNV.md](CNV.md) | Canvass and Offers | §8 |
| [IPAS.md](IPAS.md) | IPAS | §9 |
| [TRN.md](TRN.md) | Transmittals | §10 |
| [PKL.md](PKL.md) | Packing Lists | §11 |
| [OM.md](OM.md) | Order Monitoring | §12 |
| [DASH.md](DASH.md) | Purchasing Dashboard | §13 |
| [SET.md](SET.md) | Settings | §14 |
| [FLOW.md](FLOW.md) | Stage Actions, Stage Conditions, the SOR side | §5 |
| [E2E.md](E2E.md) | One purchase start to finish | §4 |

Suggested order: SET, ACC, PR, CM, CNV, IPAS, TRN, PKL, OM, DASH, FLOW, E2E.
