# T3CK Group ERP

The operational system and enterprise resource planning portal for T3CK Group, consolidating task workflows, workforce management, sales opportunities, and procurement.

## Language

### Navigation & Workspaces

**Workspace**:
The personal domain for an authenticated employee containing their own daily execution items, personal schedule, and self-service requests.
_Avoid_: Main, Home

**Self-Service**:
Actions and records where the acting user is the subject (e.g., logging individual tasks, applying for personal leaves or offset hours).
_Avoid_: Management, Admin

**Module**:
A cohesive business capability domain (e.g., Operations, Sales, Human Resources, Procurement, Administration) containing operational registers and administrative views.
_Avoid_: Category, Tab, Page Group

**Approval Center**:
A centralized cross-cutting hub where supervisors, department heads, and HR officers review and act on pending submission queues across domains.
_Avoid_: Approvals Tab, Verification Page

### Domain Modules & Entities

**SOR (Sales Opportunity Record)**:
A commercial deal registration tracking potential sales, client requirements, quotations, and special procurement requests.
_Avoid_: Opportunity, Lead, Deal

**SOR Register**:
The centralized index and management table of all registered Sales Opportunity Records.
_Avoid_: Opportunities Page, Opportunity Registration

**Offset**:
Compensatory time off or overtime adjustment claimed by an employee for hours worked outside standard shifts.
_Avoid_: Leave credit, OT slip

**Group Task**:
A collaborative project or shared task assignment involving multiple team members with defined roles and templates.
_Avoid_: Project, Shared Task

**Employee Directory**:
The workforce register and profile repository for company personnel.
_Avoid_: HR Management, User List

### Commission

Terms introduced by the Commission Pool feature (issue #10 and its tickets #11–#17). Commission Department/Position/Split are a standalone vocabulary scoped to this feature — deliberately not linked to an employee's Department or Role fields, which stay freeform text used throughout the rest of the app.

**Commission Rate**:
One of three dated percentages — VAT, Withholding (ITR), or the Pool rate itself. Takes effect from a stated date; an Opportunity uses whichever Commission Rate was in force on its Contract Date, so a later change never moves an already-priced Opportunity's figures.
_Avoid_: Tax Rate

**Commissionable Revenue**:
A contract's value with VAT divided out, then Withholding applied to the VAT-exclusive amount. The base every commission figure is calculated from.
_Avoid_: Net Revenue, Taxable Amount

**Commission Pool**:
The Pool Rate applied to an Opportunity's Commissionable Revenue — everything the Commission Pool feature computes as available to split. A live, derived estimate; never stored as a payout.
_Avoid_: Payout, Bonus Pool

**Department Allocation**:
A Commission Department's fixed percentage of the Commission Pool (starting values: Sales 50, Operations 25, Administration 15, Human Resources 5, Finance & Accounting 5). Editable via the Commission Pool admin screen; the set must always sum to 100.
_Avoid_: Department Share

**Commission Department** / **Commission Position**:
Standalone tables holding the names and allocation percentages the Commission Pool splits across. Not the same thing as an employee's Department or Role — those are freeform fields used throughout the rest of the app; these exist only to drive commission math.
_Avoid_: Department, Position, Role (when meaning the employee-record fields)

**Commission Split**:
The percentage of the Sales Department's share attributed to each Sales role for a given Project Type:
- **SSP (Single Salesperson Project)**: 80% Deal Owner, 20% Sales Director.
- **CP (Collaborative Project)**: 60% Deal Owner, 20% Supporting Sales Team (combined), 20% Sales Director.
- **Strategic Project**: 40% Deal Owner / Originator, 20% Closing Salesperson, 20% Supporting Sales Team (combined), 20% Sales Director.
Supporting Sales Team is one combined percentage for up to 2 support-salesperson slots on an Opportunity, split evenly between however many are actually filled. Unassigned roles on any project leave their percentage share explicitly unattributed rather than redistributed.
_Avoid_: Role Split

**Contract Date**:
Set automatically the first time an Opportunity reaches the Awarded pipeline stage; not manually editable. Anchors which dated Commission Rate applies to that Opportunity going forward. Before an Opportunity has a Contract Date, its Commission Pool figure is a moving estimate priced off whatever rate is effective today.
_Avoid_: Award Date, Sign Date

**Commission Share**:
What one employee is attributed from one Opportunity — their role's (or position's) percentage of their Department's Allocation. Calculated live, never entered or stored.
_Avoid_: Payout, Earnings

**Commission Dashboard**:
The centralized analytics interface and register aggregating live Commission Pool and Commissionable Revenue across SORs, providing date range filtering, stage scopes, sales rep attribution, department distribution, and role-based privacy masking.
_Avoid_: Commission Page, Money Tab

**Realized Commission Pool**:
The accumulated Commission Pool derived strictly from deals that have reached the Awarded stage or beyond (Awarded, PO Received, Project Delivery, Collection, Closed Won) where each deal is priced using the Commission Rate effective on its Contract Date.
_Avoid_: Paid Commission, Settled Pool

**Projected Commission Pool**:
The estimated future Commission Pool derived from pipeline opportunities before the Awarded stage (Lead through Negotiation), priced off current effective Commission Rates as a moving forecast.
_Avoid_: Forecasted Bonus, Unearned Pool

**Privacy Masking**:
Role-based UI presentation masking where standard employees view only their own attributed monetary values (₱) and relative percentage splits, while peer earnings and full company monetary totals are displayed only to Super Admin, Management, and Finance & Accounting. (Note: Client-side UI masking per ADR 0002).

Not implemented, and out of scope for the current feature: any actual payout/disbursement mechanism, eligibility computation, or a release/holdback stage. The Commission Pool is always a live estimate, never a payout.

### Philippine Government Procurement

Terms the system models. The full acronym list from the bidding documents is
reference material in [docs/procurement-glossary.md](docs/procurement-glossary.md).

**ABC (Approved Budget for the Contract)**:
The ceiling a government client publishes for a project. A bid above it is
disqualified, so it is a constraint on the offer, never merely a column.
_Avoid_: Budget, Client Budget

**Notice of Award**:
Written notice that a bid was accepted. Starts a statutory ten-day clock inside
which the performance security must be posted and the contract signed. Receipt
must be confirmed in writing within two days.
_Avoid_: Award Letter, NOA (in UI copy — spell it out)

**Performance Security**:
Posted by the winner before the contract is signed, as a percentage of the
total contract price — 5% in cash or manager's check, 30% for a bank guarantee
or surety bond. Called a Performance Bond in conversation.
_Avoid_: Bond, Guarantee (unqualified)

**Post-Qualification**:
A non-discretionary pass/fail examination of the lowest bidder's documents,
completed within twelve calendar days. Failing it disqualifies the bidder and
passes the process to the next-ranked one.
_Avoid_: Verification, Vetting

**Retention Money**:
Between 1% and 5% withheld from **every progress payment** as warranty cover,
released only after the warranty period lapses. Distinct from the **Retention
stage**, which is the deal waiting out that period.
_Avoid_: Retention (unqualified — it is ambiguous between the money and the stage)

**Liquidated Damages**:
A per-day deduction for late delivery, needing no proof of actual loss. At 10%
of the total contract price the client may rescind the contract.
_Avoid_: Penalty, Late Fee

**ILPAS (Importation, Local Purchase And Shipping information form)**:
Purchasing's per-shipment record for an imported or externally sourced item —
supplier, currency, payment terms and forex, freight, duties, the shipping
document checklist, and the shipping status run of Ordered → Boarded → Arrived
→ Delivered. What the Sales Offer Matrix's `IPAS` column marks as Applicable or
Not Applicable is **whether an item needs one**; house-brand stock does not.
_Avoid_: IPAS (a transcription of the same word), Import Form

**Landed Cost**:
An imported item's true unit cost once everything is apportioned onto it —
`unit price + duties/item + freight/item + other charges/item`, computed on the
ILPAS sheet. The basis every markup and income figure is taken from.
_Avoid_: Cost, Unit Cost, Acquire Cost

### Task Logging & Dictation

**DTAR (Daily Task Accomplishment Report)**:
The organizational name for an employee's logged task record — the same artifact the codebase calls a task and surfaces through the Log Task flow. Used in conversation and policy; the code and schema say `task`.
_Avoid_: Accomplishment, Daily Report, Timesheet Entry

**Dictation**:
The transient act of an employee speaking a task description aloud instead of typing it. Bounded by a single start and stop; produces exactly one Transcript and leaves no durable artifact of its own.
_Avoid_: Recording, Voice Note, Voice Memo

**Transcript**:
The verbatim text a Dictation produces, appended to the task description as ordinary editable text. Indistinguishable from typed text once it lands — a task description carries no record of how it was entered.
_Avoid_: Transcription, Speech Result, Voice Text

No audio is retained. A Dictation's audio exists only for the duration of the Dictation itself; there is no stored recording to play back, attach, review, or delete, and consequently no audio retention policy.
