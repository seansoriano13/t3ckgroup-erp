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

**Company**:
The organization an SOR is being sold to — the account, not a human. Verified against Odoo's commercial partner whenever the SOR carries a Sales Reference.
_Avoid_: Client, Client Name, Customer, Account

**Contact Person**:
The individual at the Company that the salesperson actually deals with. Free text by design — it routinely carries a mobile number or a working nickname that Odoo does not hold.
_Avoid_: Client, Contact Name

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

### CRM Flow

Terms introduced by the Flow Canvas (issue #36). These supersede the Deal Type
vocabulary in ADR 0004 and deprecate `docs/crm-pipeline-redesign.md` as an
authority — that document is retained as history only.

**Sale Type**:
What kind of sale an SOR is. The set is configured by Operations, never fixed
in code, and starts empty — the system proposes no values. Each Sale Type owns
exactly one Sales Flow. Chosen when an SOR is registered; changeable only while
the SOR still sits at its flow's first Stage, and locked from its first move
onward. Orthogonal to Commission Split (SSP / CP / Strategic), which selects
how money is divided and has nothing to do with which flow a deal follows.
_Avoid_: Deal Type, Project Type, Type

**Sales Flow**:
The whole process one Sale Type follows — its Stages and the moves permitted
between them. A directed graph, not an ordered list: a flow may loop back, skip
ahead, or branch, because deals are re-opened and fast-tracked in reality.
_Avoid_: Pipeline (when meaning a specific Sale Type's process), Workflow

**Stage** (within a Sales Flow):
A named point an SOR occupies. **Private to its Sales Flow** — two flows may
each contain a Stage named "Proposal Submitted" and they are unrelated objects.
Grouping SORs across Sale Types by Stage therefore requires an explicit
mapping; same-named Stages are genuinely two different things.
_Avoid_: Status, Step

**Stage Action**:
Something that happens when an SOR *enters* a Stage — create a Group Task,
notify, stamp a date, start a countdown, raise a purchase request, or a note.
Fires once per (SOR, Stage), permanently: re-entering a Stage creates nothing
new. Distinct from a Stage Condition by what it does — an Action *happens*, a
Condition *blocks*.
_Avoid_: Trigger, Automation, Hook

**Stage Condition**:
Something that must be true before an SOR may *leave* a Stage. Five verifiable
kinds — attachment, field, tickbox, assignment, deadline — plus Note
Conditions. A deadline never blocks; it warns on approach and marks the deal
overdue on breach.
_Avoid_: Gate, Requirement, Rule

**Note Condition**:
A condition written in plain words because the system cannot express it, kept
verbatim in the author's own wording. Operations chooses per note whether it
blocks; a blocking note behaves as a tickbox — a human certifies it and the
system verifies nothing. Notes are the record of what was asked for and not yet
built, and they export as the implementation list.
_Avoid_: Comment, TODO, Placeholder

**Won Stage**:
The one Stage per Sales Flow that means the deal has been won. Reaching it
stamps the Contract Date, which fixes that SOR's commission pricing forever.
Exactly one per flow; a flow cannot be locked without one. Set by the
developer, never presented to Operations in commission vocabulary.
_Avoid_: Anchor, Anchor Stage, Award Stage

**Realized** (redefined):
An SOR counts as booked money once it **has a Contract Date** — no longer a
comparison of its position against an anchor's. Position ceased to mean
anything when a Sales Flow became a graph, and the positional rule already
misfired when a deal moved backwards.
_Avoid_: Booked, Closed (when meaning the money pool)

**Flow Canvas**:
The module in which the developer and Operations build Sales Flows together,
on staging — a long-lived feature, not a one-time build: the business's CRM
process keeps changing after a flow is locked, so the canvas keeps being used
to revise it, each revision landing as its own Flow Snapshot. It carries two
modes on one screen: **Live** (editing `sales_flows` directly, Super-Admin
gated) and **Sandbox** (a shared draft that touches no live record, open to
anyone — formerly the standalone "Flow Plan").
_Avoid_: Builder, Planner, Designer, Flow Plan (folded into Sandbox mode)

**Scratch SOR**:
An SOR that exists only to be pushed through a Sales Flow so its behaviour can
be observed. An ordinary SOR carrying a scratch flag, running identical code to
a real one — which is what makes "it works" an observation rather than a claim.
Excluded from every register, dashboard, and commission total.
_Avoid_: Test Deal, Dummy, Fixture

**Flow Snapshot**:
The entire Sales Flow captured at the moment it was locked. Answers "what did
we agree on the day of the meeting" by being opened. A snapshot is also
importable as a new flow's starting point, so the baseline template and the
version history are one thing.
_Avoid_: Version, Backup, Export

### Project Evaluation

Terms introduced by the Project Evaluation feature (issue #38 and its tickets #39–#50). The feature exists because four jobs are currently done in a Google Sheet that the rest of the business cannot see: checking a bundled Odoo order against the client's spec, totalling the many purchase orders one project spawns, evidencing the three-supplier comparison, and deciding go/no-go on the resulting margin.

**Purchasing**:
The Module carrying purchasing's own work — the Procurement Queue, and the Canvasses raised from it. Granted per employee by an access flag, alongside Sales and Task access; deliberately not inferred from the freeform `department` field, which a typo would silently break.
_Avoid_: Procurement (when meaning the Module), PMS

**Procurement Queue**:
The cross-SOR list of every Procurement Request still awaiting an answer. Open means unresolved in the domain's sense — a request purchasing has started canvassing is still on the queue.
_Avoid_: Purchasing Dashboard, Sourcing List

**Inclusion**:
One item on the client's specification, entered against an SOR. Exists because Odoo bundles a complex product into a single order line whose inclusions are free text in the description, making the item-by-item check impossible there. Deliberately not a sale opportunity line item — those are destroyed and re-created on every SOR save, so nothing durable can hang off one.
_Avoid_: Line item, Product, BOM entry

**Completeness**:
Whether an Inclusion is answered — Covered, Missing, Substituted, or Not required. Not required drops out of both sides of the fraction rather than counting as answered. An SOR with no Inclusions has no completeness figure at all, which is a different statement from 0%.
_Avoid_: Status, Progress

**Sourcing**:
How an Inclusion would be obtained — In stock, Stocked but needs ordering, or Source out. Three values rather than a boolean: a stockable item with none on hand still needs ordering and is explicitly not source-out, and that middle case is most of purchasing's work. Null until somebody assesses it.
_Avoid_: Source out (as a boolean), Availability

**Canvass**:
The three-or-more supplier comparison, recorded as structured Offers against exactly one Procurement Request or Inclusion — never both, never neither. Replaces the ad-hoc sheet that could never be produced later as evidence for why a supplier was chosen or what a product actually costs. The three-offer minimum is a warning at sign-off, not a database constraint: research happens over days and a Canvass must be saveable half-finished.
_Avoid_: Comparison Sheet, RFQ, Sourcing Sheet

**Offer**:
One supplier's answer within a Canvass — brand, description, source link, brochure, remarks, unit price, lead time, and a quality note, mirroring the stated policy of comparing on price, delivery speed and quality rather than price alone. At most one Offer per Canvass may be marked the winner; marking a new one clears whichever held it before.
_Avoid_: Quote, Bid, Supplier Response

**Project Evaluation**:
The go/no-go: one record per SOR holding a candidate sales price, an estimated operating expense figure, and a government-client toggle, weighed against the base cost rolled up live from the SOR's Inclusions. May exist before the SOR has a Sales Reference — an evaluation with none is visibly marked an estimate. Markup and final pricing stay in Odoo; this record never writes a price back, and where its candidate price differs from Odoo's own order price, both are shown with the delta.
_Avoid_: Quotation, Pricing Sheet, Deal Sizing

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

### Chat & Mentions

One vocabulary for a thing the code currently spells four ways. A Chat is the
same concept whether it hangs off a Task, a Group Task, or an SOR, even though
each stores its Messages in its own table.

**Chat**:
A single conversation bound to exactly one Task, Group Task, or SOR. There is
no standalone Chat and no Chat between people — a Chat always belongs to the
record it discusses, and is reached either from that record or from the chat
list, which is the set of Chats an employee is currently party to.
_Avoid_: Thread, Conversation, Discussion, Comments

**Message**:
One entry in a Chat, whichever table it lives in. The code says `task_activity`,
`committee_task_activity`, and `sales_opportunity_logs`; those are three
storage locations for one concept, not three concepts. Not editable and not
deletable by design — a Chat is an append-only record of what was said.
_Avoid_: Note, Comment, Log, Activity, Post

**Mention**:
A deliberate address of one employee inside a Message, captured when it is
written rather than inferred from the text afterwards. Carries who was meant,
not merely the name that was typed — so a Mention survives the mentioned
employee later being renamed. Mentioning someone notifies them and suppresses
the ordinary new-message notification they would otherwise receive, so a Mention
replaces that notice rather than adding a second one.
_Avoid_: Tag, @, Callout

**Mention Target**:
The one Message a mention notification takes the recipient to — the most recent
Message in that Chat that mentions them. Resolved when the notification is
opened, not recorded when it is sent, so a Mention Target is always the latest
thing said to that employee in that Chat rather than the specific Message that
raised the notification. Where an employee has been mentioned several times in
one Chat, every one of those notifications leads to the same Mention Target.
_Avoid_: Anchor, Deep link, Jump target

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
