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

**SOR (Sales Opportunity Registration)**:
One registered commercial deal — the record tracking a potential sale, its client requirements, quotations, and special procurement requests. Named by Policy CCPR-2026-001, Annex C. Earlier drafts of this glossary expanded it as "Sales Opportunity Record", which the policy does not say.
_Avoid_: Opportunity, Lead, Deal, Sales Opportunity Record

**SOR Register**:
The centralized index and management table of all registered SORs.
_Avoid_: Opportunities Page, Opportunity Registration

**SORS (Sales Opportunity Registration System)**:
Where the whole commercial process runs — the SOR Register, its board, and every SOR's journey through its Sales Flow. The SOR is the entry point; SORS is the process it enters. The company's own name for this system, from Policy CCPR-2026-001, Annex C, and the name the first migration was written under. It was briefly renamed "CRM" (issue #206) and renamed back; see ADR 0024 for why an imported industry word was the wrong one for a thing the board had already named.
_Avoid_: CRM, SOR / CRM, SOR system

**Retail Order**:
One Odoo sale order placed through a Marketplace Storefront. Not an SOR: it has no proposal, bidding, negotiation or award, so it runs no Sales Flow and stays out of the SOR Register, the pipeline and the commission engine. Seen only on the Retail screen.
_Avoid_: Retail SOR, Retail deal, Shopee deal, Online order

**Marketplace**:
The platform a Retail Order was placed on — Shopee or Lazada.
_Avoid_: Channel, Platform, Storefront

**Storefront**:
One shop on a Marketplace, held in Odoo as the order's customer (e.g. Shopee T3ck Outdoor). A Marketplace can have several.
_Avoid_: Marketplace, Shop, Partner

**Marketplace Order ID**:
The Marketplace's own number for a Retail Order (e.g. 2609020BTB5E8F) — the key the Marketplace's own income reports use.
_Avoid_: Order ID, Sales Reference, SO number

**Order Amount**:
A Retail Order's Odoo total — list price, sometimes typed lower. Never what the buyer paid on the Marketplace.
_Avoid_: SRP, Sales, Gross, Total sales

**Order Income**:
What the Marketplace pays out for a Retail Order after its fees, as typed by the salesperson from the Marketplace's own breakdown. The figure the Retail screen totals.
_Avoid_: Actual income, Net, Payout, Revenue

**Marketplace Fee**:
What the Marketplace deducts from a Retail Order, as typed beside its Order Income. Marketplace Fee plus Order Income routinely differs from Order Amount, because Order Amount is not what the buyer paid.
_Avoid_: Commission, Charges

**Fee rate**:
A Marketplace's cut of what its Retail Orders brought in: Marketplace Fee ÷ (Marketplace Fee + Order Income), over the orders that have both. Not a share of Order Amount, which is not what the buyer paid. Blank when no order has both.
_Avoid_: Commission rate, Take rate

**Income Note**:
The To-Do a salesperson logs on the Odoo order carrying its Marketplace Order ID, Marketplace Fee and Order Income. Usually left open, never marked done.
_Avoid_: Log note, Activity, Remarks

**Missing Income**:
A Retail Order whose Income Note gives no Order Income.
_Avoid_: Unverified, Incomplete

**Suspect Income**:
A Retail Order whose Order Income exceeds its Order Amount, or whose Marketplace Fee is at least its Order Amount — a sign the Income Note belongs to another order.
_Avoid_: Mismatch, Unreconciled

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

**Start Date** (of a Group Task):
The day a Group Task's work begins. Independent of when the task was created
and of its Due Date — neither is derived from the other.
_Avoid_: Start Time

**Lead Time** (of a Group Task):
A free-text note on how long a Group Task's work is given — "120 calendar
days", or "Extended" once the client grants more. Never computed: an extension
is recorded by moving the Due Date by hand. Not an Offer's lead time, which is
how fast a supplier delivers to us.
_Avoid_: Duration, Contract Duration

**Individual Task**:
A task with one owner, tracked on that person's own list rather than as
shared work. The other kind of task a Stage Action can create, alongside a
Group Task: same trigger, same fire-once rule, but no members and no roles —
it says what one person must do. Its kind of work is named by its Category,
not by a Tag. It has no title of its own: its Project / Campaign Title stands
in as one, and its Category when that is blank.
_Avoid_: Personal Task, My Task, Solo Task

**Tag**:
A label from one managed list, put on a Group Task by hand or by the Stage Action that created it, saying what kind of work it is. Individual tasks say that with their Category instead. Where a task came from — an SOR — is its source, not a Tag.
_Avoid_: Label, Category (when meaning a Group Task's kind)

**Employee Directory**:
The workforce register and profile repository for company personnel.
_Avoid_: HR Management, User List

**Call Sign**:
The short number each person goes by inside the company — 101 for Boss Lito, 1001 for Ma'am Raquel, 102 for Ma'am Grace — kept on their employee record. Paper forms name signers by it ("Check by … 1001"), so printed forms print it under a signature, and signer lists are seeded by it. An identifier people say aloud, not a login or payroll number.
_Avoid_: Employee code, Employee ID

### Commission

Terms introduced by the Commission Pool feature (issue #10 and its tickets #11–#17). Commission Department/Position/Split are a standalone vocabulary scoped to this feature — deliberately not linked to an employee's Department or Role fields, which stay freeform text used throughout the rest of the app.

**Commission Rate**:
One of three dated percentages — VAT, Withholding, or the Pool rate itself. Takes effect from a stated date; an Opportunity uses whichever Commission Rate was in force on its Contract Date, so a later change never moves an already-priced Opportunity's figures.
_Avoid_: Tax Rate

**Commissionable Revenue**:
A contract's value with VAT divided out, then Withholding applied to the VAT-exclusive amount. The base every commission figure is calculated from.
_Avoid_: Net Revenue, Taxable Amount

**Commission Pool**:
The Pool Rate applied to an Opportunity's Commissionable Revenue — everything the Commission Pool feature computes as available to split. A live, derived estimate; never stored as a payout.
_Avoid_: Payout, Bonus Pool

**Department Allocation**:
A Commission Department's fixed percentage of the Commission Pool (starting values: Sales 50, Operations 25, Administration 15, Human Resources 5, Finance & Accounting 5). Edited in place by a Super Admin on the Commission Dashboard's Formula tab (Commission Rates and position splits too; a Sales Director edits Commission Splits); the set must always sum to 100.
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

### SORS Flow

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
A flow's Stages live only on the Flow Canvas; no document lists them.
_Avoid_: Pipeline (when meaning a specific Sale Type's process), Workflow

**Stage** (within a Sales Flow):
A named point an SOR occupies. **Private to its Sales Flow** — two flows may
each contain a Stage named "Proposal Submitted" and they are unrelated objects.
Grouping SORs across Sale Types by Stage therefore requires an explicit
mapping; same-named Stages are genuinely two different things.
_Avoid_: Status, Step

**Terminal Stage**:
A Stage no SOR can leave — where a Sales Flow ends (Closed Won, Closed Lost).
Not the Won Stage, which usually sits mid-flow with PO, delivery and collection
still ahead of it. Each Terminal Stage says how deals end there, **Won** (Closed
Won) or **Lost** (Closed Lost, Cancelled), set on the Flow Canvas; one left
unset ends as Lost. SORs on a Terminal Stage sink to the bottom of the
register's default order.
_Avoid_: Last Stage, Final Stage, Closed

**Stage Visit**:
One stay of an SOR on a Stage — from the move that lands it there to the move
that takes it away. Because flows loop, one SOR can visit the same Stage more
than once, and each stay is its own Stage Visit. Access to a Stage's trail is
granted per Stage Visit, never per Stage.
_Avoid_: Stage Period, Stage Instance

**Deal Team**:
The people holding an SOR's own roles — registrar, Deal Owner, Closing
Salesperson, Support Sales 1 and 2, Sales Director. They see the SOR across its
Stage Visits, except on a Stage its Sales Flow closes to them. Anyone else sees
only what they were called into, unless the Sales Flow names them as always
seeing it.
_Avoid_: Participants, Members (when meaning these roles)

**Always sees**:
The people a Sales Flow names as reading every one of its SORs in full, as the
Deal Team does, without holding a role on any of them. It can name everyone.
They can read the SOR and move it between Stages, but not edit it; a Restricted
Stage still shuts them out. It is set per Sales Flow, so being open on one flow
never opens another.
_Avoid_: Viewers, Watchers, Read-all

**Always edits**:
The people a Sales Flow names as editing every one of its SORs, their details
and Product List, as the Deal Team can, without holding a role on any of them.
Set per Sales Flow beside Always sees and can name everyone. It widens editing
only; who can see or move an SOR is still Always sees.
_Avoid_: Editors, Write access

**Stage Participant**:
Someone outside the Deal Team called into an SOR — by a task a Stage Action
creates, by an Assignment condition, or as a purchasing member of a Purchase
Request opened there. Sees every Stage Visit inside their access window, which
opens when they are called and closes when the calling Stage is left, when a
chosen later Stage is entered or left, or at a Terminal Stage, as the Sales Flow
set it; a Terminal Stage always closes it. Each call-in opens its own window, so
one person named by two actions on the same Stage holds two at once and sees the
union of them. A window only ever reaches forward: someone called in at a Stage
never sees the visits before it. An Assignment on the entry Stage makes someone a
participant from the SOR's first day. Afterwards they get a locked view plus a
read-only look at the visits they worked on. A Mention never makes someone a
Stage Participant; it opens a Mention Window instead.
_Avoid_: Collaborator, Guest, Member, Lifeline (a window belongs to one call-in
on one SOR, not to a person)

**Restricted Stage**:
A Stage its Sales Flow closes to part of the Deal Team — by role, by an
excluded Employee Group, or both. Anyone shut out sees only that the SOR is
there and for how long; they cannot move it on, are not notified from it, and
stay shut out of that visit after the SOR leaves. Super Admins are never shut
out. The Stage's configuration stays readable on the Flow Canvas; only the
SOR's data on it is withheld.
_Avoid_: Hidden Stage, Private Stage

**History**:
One SOR's whole story as a single list — every Stage Visit, each carrying its
whole Stage Work: every condition and how it was met (the file given, who
ticked, who was assigned, the note), its custom Stage Field values, what each
of its Stage Actions did (the task it created, or that it was skipped, left
undecided, or failed), its Logged Follow-ups, and its Requested Items, with
their status and owner. The record of what happened, not a summary of it: a
past visit is read-only, but any task on it still opens. Work a Start fresh or
Revert closed off stays on its visit, marked closed off and saying why. Work a
Resume carried forward shows on the new visit only, and the earlier visit says
it was resumed. A
Restricted Stage appears as one line with no contents to anyone shut out of
it. Who may open an SOR's History is set by its Sales Flow. Named the Journey
until September 2026.
_Avoid_: Journey (its earlier name), Overview, Iceberg, Timeline, Version
history (a Sales Flow's Flow Snapshots, not an SOR's story)

**Stage Field**:
An input a Sales Flow defines on a Stage, filled in on the SOR under that
Stage. Either an **SOR field** — one of the SOR's own fields, written to the SOR
itself — or a **custom field** (text, number, date, or a choice) kept once per
Stage Visit. Not a Stage Condition, though a required one also blocks the way
out.
_Avoid_: Custom Condition, Field on record, Metadata

**Team**:
The unit an employee actually works in — Purchasing, Logistics, IT, and so on —
below the four broad Departments. What "a whole department" means wherever the
system picks people.
_Avoid_: Sub-department

**Employee Group**:
A named set of employees — hand-picked, or a whole Team — kept in one place and
pointed at by any "who" setting in a Sales Flow. Always means its current
members, so editing a group changes every flow that uses it.
_Avoid_: Distribution List, Roster

**Stage Action**:
Something that happens when an SOR *enters* a Stage — create a Group Task,
notify, stamp a date, start a countdown, raise a purchase request, or a note.
Fires once per (SOR, Stage): a Return creates nothing new unless it is a
Start fresh. A task it created goes **on hold** when the SOR leaves the
Stage — off everyone's list, and not workable by anyone, until a Return
decides it — unless the Sales Flow set that action to carry on past the Stage.
Reaching a Terminal Stage cancels every held task; a Resume revives them with
due dates pushed back by the time they spent on hold, and nothing else does. A
held, cancelled or closed-off task can still be opened and read, never worked
on. Distinct from a Stage Condition by
what it does — an Action *happens*, a Condition *blocks*.
_Avoid_: Trigger, Automation, Hook

**Stage Work**:
Everything done on an SOR during one Stage Visit — the tasks its Stage Actions
created, Optional Action decisions, ticked tickboxes, files given through
conditions, custom Stage Field values, and the Follow-up count. Not the SOR's
own fields, which belong to the SOR, and not notifications, which cannot be
taken back. Handled as one set, never item by item.

**Return**:
An SOR entering a Stage it already has an earlier Stage Visit on. Whoever makes
the move chooses **Resume** — the earlier Stage Work moves into the new visit,
its tasks reopened, and the earlier visit records that it was resumed — or **Start fresh** — the earlier Stage Work is
closed off, never deleted: its tasks cancelled, the rest left on the earlier
visit in the History, and the Stage's Actions fire again. Only a Return asks;
no other move does.
_Avoid_: Backward move, Re-entry, Revert (going back one step without an edge)

**Optional Action**:
A Stage Action that waits for its Decider — the Deal Owner unless the Sales
Flow names someone else — to create it or skip it after the SOR enters the
Stage. Never blocks leaving; leaving undecided counts as a skip, and a skip is
final for that Stage until a Start fresh.
_Avoid_: Manual Action, Conditional Action

**Stage Condition**:
Something that must be true before an SOR may *leave* a Stage. Verifiable kinds
— attachment, tickbox, assignment, deadline, purchasing settled (every
Requested Item closed), and costing settled (every Tender Line priced, no blank
cost, the evaluation approved, and the offer within ABC), goods checked (every
submitted Transmittal naming the SOR closed), orders filed (every uncancelled
IPAS naming the SOR filed) — plus Note Conditions. Something a
deal must fill in is a Stage Field, never a condition. An attachment condition
is met only by a file given through that condition, not by any matching file on
the SOR. A deadline never blocks; it warns on approach and marks the deal
overdue on breach. Conditions guard moving on, never going back: a Revert or a
Return is not blocked by them, nor by a required Stage Field.
_Avoid_: Gate, Requirement, Rule

**Goods checked**:
A Stage Condition, met when every submitted Transmittal with a line naming the
SOR is Closed (both Check by signatures) or Cancelled. It exists because a
Transmittal is per slip and cannot mount on a Stage. A Draft is ignored, as it
has not entered a check; an SOR no Transmittal names meets it; a slip carrying
lines for two SORs counts for both. A line rated NA does not hold it open: the
check happened, and the replacement rides a new slip that must itself close.
Placed by Operations, on Government at the exit of Project Delivery.
_Avoid_: Goods received, Delivery checked

**Orders filed**:
A Stage Condition, met when every IPAS naming the SOR that is not cancelled
has been filed — section 4 approved, so its Landed Cost is final. It exists
because an IPAS is per Odoo PO and cannot mount on a Stage. An SOR no IPAS
names meets it; an IPAS naming several SORs counts for each. Built with the
IPAS block but not placed on Government yet: Finance does not file in the ERP
yet, and a gate on closing would stall deals and commission. Operations can
place it later.
_Avoid_: Orders closed, Orders settled

**Note Condition**:
A condition written in plain words because the system cannot express it, kept
verbatim in the author's own wording. Operations chooses per note whether it
blocks; a blocking note behaves as a tickbox — a human certifies it and the
system verifies nothing. Notes are the record of what was asked for and not yet
built, and they export as the implementation list.
_Avoid_: Comment, TODO, Placeholder

**Follow-up Cadence**:
A Stage setting — neither a Condition nor an Action — that reminds chosen
people, the Deal Owner by default, every N days while an SOR sits on that
Stage. A **Logged Follow-up**, a note with proof attached, restarts the count,
so reminders chase silence rather than the calendar. Every reminder and every
Logged Follow-up lands on the SOR's timeline.
_Avoid_: Reminder (unqualified), Recurring Notification

**Won Stage**:
The one Stage per Sales Flow that means the deal has been won. Reaching it
stamps the Contract Date, which fixes that SOR's commission pricing forever.
Exactly one per flow; a Sales Flow cannot be published without one. Set by the
developer, never presented to Operations in commission vocabulary.
_Avoid_: Anchor, Anchor Stage, Award Stage

**Revert**:
Taking an SOR back to the Stage its latest move came from, whether that move
was a mistake or the deal really went back. Not a move: it needs no drawn edge
and can take an SOR off a Terminal Stage. If Stage Work was already done on the
Stage being left, whoever reverts chooses to **keep progress** — held, so a
later Return can Resume it — or **remove progress** — closed off, never
deleted; with no Stage Work there, nothing is asked and the stay is undone
outright, the earlier Stage Visit simply continuing. Otherwise the SOR starts a
new visit on the earlier Stage with that Stage's old work resumed. One step
only: a Revert cannot itself be reverted, and going further back takes a
move. Anything the reverted move stamped (a Contract Date included) is
cleared, and anyone it notified is told to disregard it. Reverting a Return
also undoes its Resume or Start fresh. Made only by whoever made the move, the
Deal Owner, or a Super Admin — a Restricted Stage does not stop them, but one
shut out of it is not asked and keeps progress. On screen: **Revert to last
stage**. Unrelated
to reverting a Sales Flow to an earlier Flow Snapshot on the Flow Canvas.
_Avoid_: Correction, Stage Correction, Rollback, Undo

**Won** (or **Realized**):
An SOR counts as booked money when its current Stage is its Sales Flow's designated Won Stage, any non-terminal post-won Stage downstream from it, or a Terminal Stage that ends as Won. For legacy SORs with no Sales Flow, it means occupying the Awarded stage or beyond. Labelled **Won** on screen.
_Avoid_: Booked, Closed (when meaning the money pool)

**Open Pipeline**:
The value of active SORs currently sitting on pre-won Stages (Stages preceding the Won Stage in the flow graph) that have not yet reached Won. Excludes terminal Stages; a lost SOR counts toward neither Open Pipeline nor Won.
_Avoid_: Closed Pipeline, Total Pipeline

**Registration Form**:
What a salesperson fills in to register an SOR, defined per Sale Type and
built on the Flow Canvas. Always the SOR's built-in default fields — which can
be renamed and reordered, and, where they are not required to register at all,
hidden — plus any **custom fields** that Sale Type adds. Choosing the Sale Type
at registration is what chooses the form. Frozen into the Flow Snapshot on
Publish, so an SOR was registered against the form its version defined, and
**Restore** means going back to the built-in default, not to a previous edit.
_Avoid_: Intake Form, SOR Form (when meaning the Details card), Form Template

**Flow Canvas**:
The module in which the developer and Operations build Sales Flows together,
on staging — a long-lived feature, not a one-time build: the business's SORS
process keeps changing after a Sales Flow is published, so the canvas keeps
being used to revise it, each revision landing as its own Flow Snapshot. One
editing surface, editing `sales_flows` directly; the Flow Snapshot history
opens from it.
_Avoid_: Builder, Planner, Designer, Flow Plan (a sandbox mode removed by #186 —
the canvas edits the live flow only)

**View as**:
A Flow Canvas preview of what one role, group or person can do at each Stage.
Off by default; while on, every Stage answers with one verdict for that
identity: no access (dimmed — shut out, or named nowhere on the flow), called
in, Deal Team, can view and edit (Always edits, which implies view), or can
view but not edit (Always sees). A Restricted Stage still shuts out Always sees
and Always edits; being called in wins over being shut out. A person shows no
access even if they hold a Deal Team role on some SOR, because the canvas has
no SOR. It changes what the canvas shows, never what anyone can actually do.

**Publish**:
The action that freezes the current draft into a new Flow Snapshot new SORs
of that Sale Type are registered against, and — for a Sales Flow that already
has one — makes it the one live deals can be moved onto. The database decides
the version it creates, `vX.Y` (issue #188, ADR 0020): a Stage removed or the
Won Stage changed starts a new major; anything else is a minor. The button
shows the number the click will create, taken from the same rule, before it is
pressed.
_Avoid_: Lock, Lock this flow, Freeze

**draft**:
A Sales Flow's editable state — the one the Flow Canvas draws and lets the
developer or Operations change. Every Sales Flow starts here; Publish moves it
to `locked`, and Edit draft moves it back. The database column keeps the
`draft`/`locked` values (and the `lock_sales_flow` function keeps its name);
"draft" and "published" are what the screen calls those two states.
_Avoid_: Unlocked, Editable

**Edit draft**:
Reopens a published Sales Flow for editing. The reopening itself is always
recorded, because repeated reopening is a pattern about how the process is
being agreed and has to stay visible (issue #36) — but it asks for no reason:
what changed is said on the Publish note instead, at the point where it is
actually known. Deals already pinned to an earlier Flow Snapshot are
unaffected — Edit draft only changes what the *next* Publish will produce.
_Avoid_: Unlock, Reopen (as a button label — used only in prose about what
Edit draft does)

**Scratch SOR**:
An SOR that exists only to be pushed through a Sales Flow so its behaviour can
be observed. An ordinary SOR carrying a scratch flag, running identical code to
a real one — which is what makes "it works" an observation rather than a claim.
Excluded from every register, dashboard, and commission total.
_Avoid_: Test Deal, Dummy, Fixture

**Legacy Pipeline**:
The Sale Type that holds every SOR registered before Sales Flows existed. It
gives those SORs a Sales Flow to belong to, not a new process. They keep their
Stages and behave as they always did, and they have no link to Government or
Outright. Its Always sees and Always edits are both Everyone, as before Sales
Flows existed; only the Government and Outright flows are private.
_Avoid_: Standard Pipeline (its old name), Default flow

**Flow Snapshot**:
The entire Sales Flow captured at the moment it was published. Answers "what
did we agree on the day of the meeting" by being opened. A snapshot is also
importable as a new flow's starting point, so the baseline template and the
version history are one thing. Its on-screen label is lower-case **version**
— the SOR's badge, the version page, the history dialog and per-deal history
notes all read `vX.Y` (issue #188, ADR 0020) rather than naming the entity;
"Flow Snapshot" is the vocabulary for talking about the record, not for what
appears on screen.
_Avoid_: Backup, Export

### Purchasing

Terms for purchasing's work against SORs (issue #38 and its tickets #39–#50). The go/no-go Project Evaluation that issue also introduced is retired: the business keeps that judgment in its own linked sheet.

**Purchasing**:
The Module carrying purchasing's own work — buying against Purchase Requests, and later the Purchasing Dashboard. Purchasing access is granted per employee by an access flag, alongside Sales and Task access; deliberately not inferred from the freeform `department` field, which a typo would silently break. Without it an employee still opens and follows their own Purchase Requests.
_Avoid_: Procurement, PMS (when meaning the Module)

**Purchase Request**:
Every request for Purchasing to buy something — whether it comes from a project or not. Holds Requested Items, its own members, and its own Chat, so each request's buying talk stays apart from every other's. A Buyer from Purchasing takes it and buys; nobody approves it first. Every Purchase Request, Project ones included, makes every Purchasing holder a member.
_Avoid_: Procurement Request, Requisition, PR Batch, Non-SOR Purchase Request

**Project** (a Purchase Request's kind):
A Purchase Request for one SOR — at most one per SOR, opened by a Stage Action, showing the SOR's reference. Opened as early as Sales' first "do we carry this?" and at the latest by award; the same request then carries the buying after award, so a product question and the order it becomes stay on one record. Its purchasing members also see the SOR's Stage Visit it was opened in; any other member sees only the request and the SOR's locked header.

**Direct** (a Purchase Request's kind):
A Purchase Request with no SOR, opened by any employee to buy something outside a project — stock, supplies, tools. Has a title instead of an SOR reference and new-product Requested Items only; any number may exist. The kind is never chosen or stored: a request is Project when it has an SOR and Direct when it has none.
_Avoid_: Internal, Standalone, Non-SOR

**Requester**:
Whoever opened a Purchase Request or added a Requested Item to it. Status changes and chat reach them. On a Direct request the one who opened it has the rights a Deal Team has on a Project request — add Requested Items, cancel them, chat — and nothing more; only Purchasing adds members. A Requester who also has Purchasing access may take and buy their own request.
_Avoid_: Sales side (when the person is not on a Deal Team), Owner

**Buyer**:
The one purchaser who owns a Purchase Request — named by the Stage Action that opens a Project request, or taken from the Purchase Requests list by anyone with Purchasing access. Once there is a Buyer, the request's status changes and chat notify only the Buyer and the Requesters.
_Avoid_: Assignee, Purchaser (when meaning this role)

**Requested Item**:
One product a Purchase Request asks for — copied from an SOR line or a Costing
Matrix Component at the moment it was picked, or described as a new product.
Later edits to the source never rewrite it. It keeps the link to the Component it
buys for, and once Ordered it records the Odoo purchase order line as well as its
number, which is how Landed Cost finds its way back. The server checks the PO
number against Odoo itself: a PO Odoo doesn't know is refused, and when Odoo
doesn't answer the PO is saved as "Not checked". Purchasing can Correct PO while
the item is Ordered, which is checked again. Carries its own status: Requested, then From stock, or To order → Canvassing → Ordered → Received; or out via Substituted, Cannot source, or Cancelled.
_Avoid_: Line Item, Procurement Request

**Requested Item Status**:
The stage of sourcing for a Requested Item, rendered as an interactive status pill consolidating the status indicator and action controls into one element, allowing permitted members to advance the item along its path or cancel it.
_Avoid_: Status dropdown, Outcome selector, Status button

**Purchase Requests** (the list):
Every Purchase Request the viewer may read, Project and Direct together, filterable by kind — all of them for Purchasing, one's own for everyone else. Where a new Direct request is opened.
_Avoid_: Procurement Queue, Sourcing List, Purchasing Dashboard (a different thing: the list shows requests, the Dashboard groups all buying by what is outstanding)

**Purchasing Dashboard**:
Where every project's buying is seen at once, grouped by what is outstanding
rather than by which record holds it — **To source**, **To price**, **To order**,
**On order**, **To check**. The groups are derived and never stored, and one SOR
sits in as many as apply, because purchasing is not a line: components are
canvassed while others are already ordered and others are on a truck. One page
with three tabs: **Projects** (those groups), then Order Monitoring's **What needs
doing** and **Register**; it opens on What needs doing. The tabs stay separate views
— Projects answers where everything is, Order Monitoring what to do today — and
the Purchase Requests list stays its own page.
_Avoid_: Purchasing Stages, Sourcing (the Inclusion field of that name), Pipeline

**Inclusion**:
One item that comes with a bundle Component in the Costing Matrix — the cabinet or beacon lights that come with a vehicle, the registration that comes with it. Carries no price of its own; it is listed so it can be checked as actually included. Exists because Odoo bundles a complex product into a single order line whose inclusions are free text in the description, making the item-by-item check impossible there. Anything bought or taken from stock on its own is a Component, not an Inclusion, however a sheet lists it.
_Avoid_: Line item, Product, BOM entry, Accessory

**Completeness**:
Whether an Inclusion is answered — Covered, Missing, Substituted, or Not required. Not required drops out of both sides of the fraction rather than counting as answered. An SOR with no Inclusions has no completeness figure at all, which is a different statement from 0%. A bid-time judgement about the offer: whether each inclusion physically arrived is asked again, separately, in the Technical inspection of the Transmittal that brings it.
_Avoid_: Status, Progress

**Sourcing**:
How an Inclusion would be obtained — In stock, Stocked but needs ordering, or Source out. Three values rather than a boolean: a stockable item with none on hand still needs ordering and is explicitly not source-out, and that middle case is most of purchasing's work. Null until somebody assesses it.
_Avoid_: Source out (as a boolean), Availability

**Stock Availability**:
Odoo's count of a product that is on hand and not reserved, per warehouse, as of the last fetch — always shown with the time it was fetched and never presented as live. A fact read from Odoo, where Sourcing is purchasing's own judgment.
_Avoid_: Inventory (unqualified), Live Stock

**Canvass**:
The three-or-more supplier comparison, recorded as structured Offers against exactly one Costing Matrix Component — or one Requested Item, where the purchase has no Costing Matrix row yet — never both. Buying outside a project is canvassed first, on the Canvasses page, against nothing yet; a Purchase Request is then created from that Canvass, and the Canvass points at the Requested Item it became. Gets its number when its first Offer is saved, not when it is opened. Never against an Inclusion: anything sourced on its own is a Component. Where research that began on a bare Requested Item later becomes part of a bid, the same Canvass re-points to the Component that appears, keeping its number, its Offers and its reason, and refusing the move if that Component already has one — one comparison per thing bought. Carries the reason its winner was chosen, written by the Canvasser and required before sign-off, because the cheapest offer often isn't the one taken. Replaces the ad-hoc sheet that could never be produced later as evidence for why a supplier was chosen or what a product actually costs. The three-offer minimum is a warning at sign-off, not a database constraint: research happens over days and a Canvass must be saveable half-finished. Nothing forces an item through one — but an item ordered without a Canvass says so on its Costing Matrix row and on the printed sheet, because an unexplained purchase is the loudest version of the problem a Canvass exists to solve.
_Avoid_: Comparison Sheet, RFQ, Sourcing Sheet

**Canvasses** (the page):
The Purchasing page listing every Canvass, project ones included, and where a Canvass for buying outside a project is started. Buying outside a project runs either way round: Purchasing canvasses first and creates the Purchase Request from it, or an employee opens a Direct request first and canvassing one of its Requested Items opens that item's Canvass here. Several Canvasses can be picked to create one Purchase Request, one Requested Item each. Creating one needs each Canvass to have a winner; a Canvass not yet signed off only warns.
_Avoid_: Canvass tool, Sourcing page

**Offer**:
One supplier's answer within a Canvass — the supplier, brand, description, source link, brochure, remarks, unit price in the currency quoted — with the rate used to compare it, which is never the rate actually paid — how long the quote holds, lead time, and a quality note, mirroring the stated policy of comparing on price, delivery speed and quality rather than price alone. At most one Offer per Canvass may be marked the winner; marking a new one clears whichever held it before. The winner can also be un-picked, leaving none: that clears the Canvass's sign-off and leaves what the winner filled in place until a new winner replaces it. Winning fills its Component's Acquire, Offer Specification and documents, and proposes its Brand for Sales to accept.
_Avoid_: Quote, Bid, Supplier Response

**Reference Rate**:
The PHP value of one unit of a foreign currency on a given day, fetched once a
day from one source and always shown with the day it is for. It pre-fills an
Offer's comparison rate, and nowhere else does it fill anything: on an IPAS
payment it is shown beside the typed rate as context and flags a wide
divergence, so a fat-fingered rate is caught without an estimate ever being
saved as the fact. The rate that reaches Landed Cost is always the one actually
paid. Never presented as live — a bid that revalued itself overnight could not
be signed — so it is a fact with a date on it, the way Stock Availability is,
and a failed fetch keeps the last good rate under its own stale date rather than
showing nothing.
_Avoid_: Exchange Rate (unqualified), Live Rate, Forex, Comparison Rate (the
Offer's own figure, which a Reference Rate only suggests)

**Offer Projection**:
What a Component's costing would become if a given Offer won, shown beside every
Offer in a Canvass so the choice can be judged before it is made. Split the way
the matrix itself is: the purchaser sees the projected Acquire in PHP and the
Markup Price that follows — enough to compare three suppliers — and the Closed
Book adds the projected margin and what the matrix summary would become.
Arithmetic over the live matrix, computed on the fly and never stored: there is
one Costing Matrix, and a Projection is a look at it, not a copy of it. Exists
only where the Canvass has a Component; a Canvass on a bare Requested Item has
no row to project.
_Avoid_: Draft Matrix, Scenario, What-if, Alternative Costing

**Canvasser**:
The purchaser who owns a Canvass — defaulting to the Purchasing Incharge of the
Component's row, else the Purchase Request's Buyer (a bid is canvassed before
any Purchase Request exists), changeable by Purchasing, and the name printed as
"Canvassed by". Ownership, not
access: every employee with Purchasing access reads every Canvass, and the
Canvasser is who answers for this one. Research runs over days and people go on
leave, so the paper names whoever holds it now rather than whoever opened it;
the creator stays in the audit trail. A Canvasser cannot sign off their own
Canvass.
_Avoid_: Assignee, Creator, Canvassed by (as the field name), Buyer (a Purchase
Request's role)

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

**Purchase Order**:
T3CK's order to a supplier, raised in Odoo and numbered there (P02552). What an
IPAS records, what a Requested Item is Ordered on, and what a Transmittal line
names. On screen it is the "Odoo PO", never the client's paper.
_Avoid_: PO (unqualified, where the Client PO could be meant), Order (unqualified)

**Client PO**:
The government client's own purchase order or contract to T3CK — the paper
attached at the CA / PO Stage. Revenue coming in, where a Purchase Order is cost
going out.
_Avoid_: PO (unqualified), Purchase Order (which is always T3CK's, to a supplier)

**IPAS (Integrated Purchasing and Shipping Form)**:
The company's record of one Odoo purchase order end to end — supplier and
payment details, sales operations, documentation, logistics, finance, and final
filing — so the purchase is recorded, monitored, and approved in one place.
Every split payment and shipment of that order sits inside its one IPAS, and an
order has at most one. Purchasing raises one when a purchase needs it, not for
every order, and never without an order, though the order may still be an
unconfirmed RFQ. A Project purchase names the SOR or SORs it buys for and
appears in each one's PMS; an Inventory, Supplies or Events purchase names none.
Numbered in one series across all four entities, carrying on from the sheet's.
Anyone who can read an SOR sees a summary of each Project IPAS naming it on
that SOR (number, PO, supplier, state, buyer track, costing and sign-off
progress) and never its payments, charges, bank details or Landed Cost; the full
IPAS opens only for its own readers.
Its fields are defined by the company's own IPAS sheet, not by this glossary.
_Avoid_: ILPAS, Import Form, Payment Request, Shipment Form

**Filing**:
The last sign-off on an IPAS — section 4's Approved, given once Finance has
received the IPAS and it has been noted and checked, and only after sections 1,
2 and 3 are approved and the Computation status is LC Odoo Done, since filing
freezes a Landed Cost that would otherwise still be provisional. Section 4 does
not open until sections 1, 2 and 3 are all approved; sign-offs already given on
an IPAS before the gate existed stay, and only the ones still to be given wait. A filed IPAS is frozen: its copy of the Odoo purchase order,
its payments and charges, its Purpose and its SORs no longer change. Earlier
approvals block nothing; filing is the one point that locks. Required documents
that nobody has ticked only warn. A Super Admin can reopen a filed IPAS with a
reason, which clears section 4 and leaves sections 1, 2 and 3 approved; a filed IPAS
can't be cancelled until it is reopened.
_Avoid_: Closing, Archiving, Final Approval (when meaning sections 1 or 2)

**Return** (an IPAS section):
A signer on the section's approval list sends the section back to its preparer
with a reason, to be redone: the section's Prepared and Approved sign-offs are
cleared and kept as history, the section's data is untouched. Offered while the
section is prepared and not yet approved; once approved the move is Undo
approval. Returning section 1 or 2 after section 4 has begun also clears section
4's open sign-offs, which the signer confirms first, naming who gave them.
_Avoid_: Send back, Reject, Reopen (that is a filed IPAS)

**Undo approval**:
A signer on the section's approval list takes back an Approved on section 1 or 2
with a reason. Only the Approved sign-off is cleared; the Prepared stays, so the
section waits for an approver again and the preparer redoes nothing. Same
section 4 consequence and confirmation as a Return.
_Avoid_: Unapprove, Revert

**Computation status**:
Where an IPAS's cost work stands, in order: Encoding, Encoded, LC GS Done, LC
Odoo Done. Only Purchasing moves it (one step either way); Landed Cost goes final
at LC Odoo Done, which is also when section 3 can be submitted. The old last step,
Checked by, is gone: section 3's sign-off is the check. Shown on the record, the
IPAS list (with a filter, plus "Section 3 approved") and the printed IPAS.
_Avoid_: Costs complete (the old name for LC Odoo Done), Costing status, Checked by (the old step)

**Section 3 sign-off**:
The sign-off on an IPAS's Computation status & Landed Cost part, with Submitted
and Approved like sections 1 and 2. Purchasing submits it once the Computation
status is LC Odoo Done; a member of the "Section 3 Approved" list approves it,
never the person who submitted it, and a Super Admin only if listed. The database
stores it as sign-off section 6 and shows it as section 3 (`ipasSectionNo` is the
one mapping). The list starts with everyone who has Finance access. "Checked" now
means only section 4's Checked step.
_Avoid_: Checked by, Costing approval

**Finance access**:
Who counts as Finance — granted per employee by its own access flag, the way
Purchasing access is, and never inferred from the freeform department or
sub-department text. Finance receives an IPAS for Filing, records its payments
and charges, and sees supplier bank details.
_Avoid_: Accounting (as a role), Finance department (when meaning who has access)

**Charge**:
An amount an IPAS pays to bring the goods in, apart from the goods themselves —
an importation charge such as brokerage, destination charges or duties, or the
bank's charge fee on a payment. Its kinds come from a list the business edits.
Every charge counts toward Landed Cost, spread over the purchase's lines; a
charge that covers several purchases is recorded as each one's share. Shipping
fees paid to the supplier are payments, not charges, but count the same way.
_Avoid_: Fee (unqualified), Expense, Importation (as a noun)

**Transmittal**:
The numbered slip goods travel on after they are bought — the company's
Transmittal Form, numbered TG03-525, TG03-526 and on — from where they came
(Purchasing, Logistics, the Warehouse) through the checks they need. Its Checking
boxes decide those: Warehouse checking, Warehouse releasing when the goods leave
for Technical (optional on a Warehouse-only slip, required when Technical
follows), and Technical inspection. At each check the in-charge rates every
line GC or NA, and the stage is signed by two people with its remarks and
pictures. Received in Odoo by and two Check by signatures close it. It stands on its own, each line
naming the purchase order line and the SOR (Project Name) it is for, because one
delivery is often split across slips and one slip often carries several orders. A
line rated NA still lets the slip close — the check happened — and a replacement
comes on a new Transmittal. It carries goods, not papers; documents for Finance
travel on the IPAS document list. Deliveries to the client are not transmittals;
they stay in Odoo.
_Avoid_: Transmittal Form (when meaning the record), Delivery Receipt, Gate Pass,
TSR or Technical Service Report (Technical's check is the Transmittal's Technical
inspection, not a record of its own), hand-off (when meaning the whole slip)

**GC / NA**:
The rating the Warehouse and Technical give each line of a Transmittal at their
check — GC, Good Condition, or NA, Need Attention, which always carries a remark.
Given once per check by that check's in-charge, so a line can be GC at the
Warehouse and NA at Technical. Not a pass/fail on the supplier: an NA says
someone has to act, and a later GC on a replacement settles it.
_Avoid_: Pass / Fail, Received / Short / Damaged, Condition (unqualified)

**Order Monitoring**:
The two Purchasing Dashboard tabs that show every open IPAS across every SOR with the one next
thing it is waiting on, who owes it and how long it has waited, and the SOR's
own IPAS section shows the same line. Opens on What needs doing; the Register
behind it lists every order, filed ones included. Order Monitoring reads the
IPAS and its Transmittals; it keeps no record of its own beyond the Ageing
rules.
_Avoid_: Tracker, Board, PMS (when meaning this page)

**Ageing rule**:
The number of days an order may wait at one step before it counts as late — one
rule per step of an order's life (the seven buyer-track steps, a delivery with no
Transmittal, an open Transmittal check, and costs ready to file). Purchasing sets
them in Settings > Purchasing. A step with no rule never goes late. A late order
says how many days past its rule it is.
_Avoid_: SLA, Deadline, Due date (the supplier's delivery deadline is a separate,
unbuilt setting)

**Needs chasing**:
The Order Monitoring group of orders that have waited past their step's Ageing
rule, whoever owes the next thing. The other groups are Waiting on us, Waiting on
someone else (the supplier, forwarder or port) and Filed.
_Avoid_: Overdue, Late list

**Owner (of an order's next thing)**:
Who has to act next on an open IPAS: Purchasing, Finance, the Warehouse,
Technical, the Check by signers, the section 4 signers, or someone else (the
supplier, forwarder or port). Only someone else puts an order in Waiting on
someone else; every other owner is "us". Where one order has Transmittals waiting
on different checks the owner is the Warehouse, the earlier check, and the line
reads "Warehouse or Technical".
_Avoid_: Assignee, Responsible

**Packing List**:
What is inside each box the Warehouse packs for an SOR — contents and
quantities, marks or seal numbers, and the weight where it is known — printed
and signed by whoever packed it. Made by Purchasing or the Warehouse. The one
warehouse step PMS keeps, because Odoo has never held a package, while its
receipts, reservations and deliveries are in daily use. It moves no stock and
writes nothing to Odoo; a delivery reference can be typed on it. Not the
"Packing List / Picking List" ticked on a Transmittal's Reference Checklist,
which is the paper that came with the goods.
_Avoid_: Packing Slip, Box List, Delivery Note

**Request Packing List**:
A **Stage Action** that asks the Warehouse to pack. When it runs it creates a
draft **Packing List** for the SOR, but only if the SOR has no open (unsigned,
still draft) Packing List; otherwise it creates nothing and tells nobody. When
it creates one it notifies the Warehouse staff list, or the people and groups
its config names instead. The draft is exactly a hand-made one: whoever signs
is "Packed by", signing closes it, there is no approver, and nothing is written
to Odoo. A Packing List can still be made by hand without the action. Replaces
the "Prepare the packing list each boxes" checklist line in the NTP "PMS" group
task.
_Avoid_: Packing task, Pack request

**Landed Cost**:
An item's true unit cost once everything is apportioned onto it —
`unit price + duties/item + freight/item + other charges/item` — worked out the
same way for Local and Import purchases. The unit price is the purchase order's,
before VAT and withholding, turned into PHP at the rate actually paid so far;
Charges and shipping fees are spread over the order's lines. Provisional until
the IPAS's Computation status reaches LC Odoo Done, final after. The basis every
markup and income figure is taken from.
_Avoid_: Cost, Unit Cost, Acquire Cost, Local Cost

**PMS (Purchasing Monitoring System)**:
One SOR's whole purchasing file — Sales asking Purchasing about products, the
Costing Matrix, the Purchase Request, each purchase's IPAS, the Transmittals
whose Warehouse and Technical checks follow the goods, and the Packing Lists they
leave in. What
people mean by "PMS" whether they are asking about a product, costing a bid, or
buying after award. Purchasing is the Module that works every SOR's PMS.
_Avoid_: Purchasing (when meaning one SOR's file), Sales Offer Matrix

**Costing Matrix**:
The part of PMS in which Sales, Purchasing and Management cost one SOR's offer
item by item — what the client asked for and its ABC, how each item is sourced
and what it costs, the markup, and the Final Offer — closing on a summary of
tax, retention, collected amount and revenue. The company's "PMS sheet". Every
column belongs to one side — Sales meaning the Deal Team, Purchasing,
Management, or Technical for the compliance verdict — and only that side writes
it. Its costs, offer and summary are
seen by whoever sees the whole SOR, and by Purchasing, Finance and Management on
every SOR; anyone else called into the SOR sees the matrix without money.
_Avoid_: PMS (when meaning only the grid), PMS sheet, Sales Offer Matrix, Project Evaluation, Costing Sheet

**Tender Line**:
One thing the client asked for in the Costing Matrix — its specification,
quantity, ABC and Final Offer. The offer price is quoted per tender line. Typed,
or picked from an SOR line whose name, quantity and unit it then keeps.
_Avoid_: Line item, Item, SOR line (a different thing)

**Component**:
One thing T3CK supplies toward a Tender Line, with its own brand, sourcing,
costs and markup. Cost is tracked per component, so a tender line's margin is
its Final Offer against its components. A component priced as a whole is a
bundle, and lists its Inclusions. What gets bought: a Requested Item names the
component it buys for, and the Landed Cost of the purchase arrives beside the
component's estimates without replacing any of them.
_Avoid_: Offer component, Part, Sub-item, Child row

**Final Acquire**:
The cost Management sets on a Component — the figure the Costing Matrix summary
reads as Operational Expenses and takes Revenue from. Written only by the people
on the list Super Admins keep for it, never by a whole role. Neither Acquire,
which is Purchasing's proposed cost and the one markup is taken from, nor Landed
Cost, which is what the item turned out to cost once bought.
_Avoid_: Final Cost, Approved Cost, Management Price

**Closed Book**:
The figures that reveal the spread between what T3CK pays and what it charges —
Final Acquire, the markup factor, the Costing Matrix summary, achieved markup,
the projected margin on an Offer, and the numbers a Bid Decision was taken
against — read only by Super Admins and the Final Acquire list. The rest of the
matrix stays open to the people who fill it, because the two sides never meet:
Purchasing proposes Acquire and never sees the Final Offer; Sales reads the peso
Markup Price, types the Final Offer, and sees neither the cost nor the factor
that produced it. Neither side can derive the margin alone, which is the whole
point, and the database serves each side its own column list rather than the
browser hiding what it was sent. Whoever a Sales Flow names as Always sees reads
what the Deal Team reads — the price side — since they already read the SOR's
quoted prices. Landed Cost and a supplier's Offer prices are cost, not price:
they reach the Closed Book and Purchasing, never the price side, and the database
refuses the price side, not just the screen. The ABC is in the public tender
papers, so Purchasing and the price side read it. The Final Acquire list and the
Evaluation list can each open any SOR that has a Costing Matrix, at any stage;
the Evaluation list reads it with no money at all. Distinct from the write bands, which say who may *change* a
column and grant no reading.
_Avoid_: Margin Tier, Confidential, Management View, Band (which is the write rule)

**Incharge**:
The salesperson and the purchaser who answer for a Costing Matrix row — set once
for the matrix, and overridable row by row. Names only: being Incharge grants no
access and sends no notifications. The Purchasing Incharge is the purchasing
assistant the Purchasing Manager assigns to a bid — the person a sheet or a
Stage Field once recorded as "Purchasing Involved" — named when the bid enters
sourcing, before any Canvass opens.
_Avoid_: Assignee, Owner, Buyer (a Purchase Request's role)

**Markup**:
A factor on a Component's Acquire cost that suggests its Markup Price. The
Costing Matrix has one default factor, typed or picked from presets the business
edits, which any component or cost-only row can override; cost-only rows start
at ×1.00. Set by the Final Acquire list and part of the Closed Book, because the
factor and the Markup Price together give away the Acquire behind them. Only ever
a suggestion: Sales reads the peso Markup Price, sets the Final Offer, and each
tender line's achieved markup is reported back to the Closed Book alone.
_Avoid_: Margin, Auto Pricing, Mark-up percentage (as the stored form)

**Evaluation of Specification**:
The item-by-item comparison of what the client's specification requires with
what is offered, deciding whether each offered item complies. Not a document of
its own: it is the Costing Matrix row read across, the Tender Line's ask against
its Components' offer, approved once for the whole matrix. Not the retired
Project Evaluation, which judged whether a deal was worth pursuing at all.
_Avoid_: Project Evaluation, Spec Check, Compliance Matrix

**Compliance**:
Whether a Component answers the Tender Line it sits under — Complies, Deviates,
or unjudged. A deviation is always written down, and may name the compliant
alternative recommended instead; it records the gap and blocks nothing. Judged
by Technical, meaning the people an SOR's evaluation group task calls in, who
see the Costing Matrix without its money. Distinct from Completeness, which asks
the same question of one Inclusion inside a bundle.
_Avoid_: Compliant (as a status name), Conformity, Spec match

**ITR**:
The income tax the Costing Matrix deducts from an offer — 8% of the Final Offer above
₱250,000, as the company's sheets compute it. A different figure from the
Commission Rate called Withholding, even though that rate is labelled
"Withholding (ITR)" on screen.
_Avoid_: Withholding, Income Tax (unqualified)

**Bid Decision**:
Whether the company bids the offer it has just priced — Go, No-go or Revise —
recorded on the Costing Matrix against the Final Offer total and the ABC it was
taken at, with the reason in the decider's own words. What the Costing Matrix
exists to produce: the judgement of whether this price can win this project.
Cleared by any later change to a Final Offer or a Final Acquire, so a Go always
refers to numbers that still stand. The decider may be the one who set the Final
Acquire: it is the boss's own judgement on the boss's own numbers, not a sign-off
on someone else's work, so the no-self-approval rule of the IPAS, Canvass and
Evaluation does not apply. Not the retired Project Evaluation, which
judged whether a deal was worth chasing before anything was costed; this judges
one priced offer.
_Avoid_: Approval, Go/No-go (as the record's name), Project Evaluation, Sign-off

### UI

**Primitive**:
Anything in the shared UI folder (`src/components/ui/`): one shared building block per job — Button, Dialog, Input, Select, Dropdown and so on. Raw HTML for a covered element (button, input, textarea, select, label, table, img, a, hand-rolled modal) is banned outside that folder, enforced by lint; feature code uses the Primitive. If none fits, ask the maintainer rather than hand-rolling. Catalogued in DESIGN.md.
_Avoid_: Component (already means a Costing Matrix row), Widget, Shared component

**Release Notes**:
The page every employee can open to see what changed in the ERP over a window of time, grouped by screen. Each change is shown with the real screen fed Sample Data, never live records.
_Avoid_: Presentation, Deck, Changelog, What's new

**What's new popup**:
The one-time popup showing only the latest changelog entry, the first time an employee signs in after a release. It points to Release Notes; it is not a list of every change.
_Avoid_: Release Notes, Changelog modal

**Sample Data**:
Made-up records used only to render a real screen on Release Notes. It never reaches or reflects the database, and nothing on it can be saved.
_Avoid_: Mock data, Demo data, Seed data

### Chat & Mentions

One vocabulary for a thing the code currently spells four ways. A Chat is the
same concept whether it hangs off a Task, a Group Task, an SOR, or a Purchase
Request, even though each stores its Messages in its own table.

**Chat**:
A single conversation bound to exactly one Task, Group Task, SOR, or Purchase
Request. There is
no standalone Chat and no Chat between people — a Chat always belongs to the
record it discusses, and is reached either from that record or from the chat
list, which is the set of Chats an employee is currently party to.
A Chat opens on its newest 30 Messages and loads 30 older ones each time you
reach the top, so a long Chat costs what is on screen.
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

**Mention Window**:
The access a Mention in an SOR's notes opens for someone who could not already
reach the Stage: everything in the Stage Visit the SOR is on when they are
mentioned — notes, tasks, Stage Fields, attachments — to read and reply to,
without Expected Value or commission. It opens even on a Restricted Stage, and
the person may mention others in. It closes when the SOR leaves that visit,
leaving a locked view plus a read-only look at that visit. Each Mention on a
later visit opens its own window. On an SOR with no Stage Visit it opens the
record header only, with no end.
_Avoid_: Mention grant, Shared access

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

### Bug Reports

**Bug Report**:
Something broken in the ERP, sent in by any employee from whichever page they
are on: a plain-text description plus optional attachments (image, video or any
file). Read by Super Admins and the IT Team (and anyone else given the same
access), and by its sender. It is for broken things, not feature requests or access
requests. Open or Resolved, nothing in between. Never deleted; its attachments
are, a year after it was sent.
_Avoid_: Ticket, Feedback, Issue

**Resolved** (of a Bug Report):
Dealt with, as judged by anyone who reads Bug Reports. Can go back to Open.
_Avoid_: Closed, Done, Fixed

**Note** (on a Bug Report):
A short message on a Bug Report's thread, written by a reader or by the sender
(e.g. "Fixed, can you check?" / "Yes, works now"). Each one notifies the other
side; not real time. The thread also shows when the report was ticked Resolved
or Reopened. The sender sees their own reports, and only those, under My Bug
Reports so they can reply.
_Avoid_: Comment, Chat, Message
