/**
 * Release Notes content: the one hand-written source for /release-notes
 * (ADR 0030 and its 2026-11 amendment). Replace it for the next release, and
 * delete the samples it no longer names; git keeps the old ones.
 *
 * Written for every employee, not for developers: plain words, what changed
 * on their screen, no ticket numbers. Each item says who uses it and, where
 * a picture says it better, names a sample (a key in sampleRegistry.js) —
 * the real screen, fed Sample Data.
 *
 * Order inside a tab: new things first, then fixes. The page groups them.
 * kind: "new" (default) · "fix" · "removed"
 * who:  the people who use it, shown as chips.
 * beta: the whole tab is still being built (shows the Beta tag).
 */

export const RELEASE = {
  title: "What's new: October–November",
  window: "Everything that changed in the ERP from 1 October to 10 November 2026.",
}

export const SECTIONS = [
  {
    key: "sors",
    label: "SORs",
    intro: "The SORS register, the Board and the SOR window.",
    items: [
      {
        id: "my-work",
        title: "My work: the SORs waiting on you",
        body: "SORS opens on My work. It lists every SOR you owe something on: your open tasks, your part of a Group Task and the Purchase Requests you buy for. Needs you comes first, then Watching, longest wait first, and Your move opens the task or request. My SORs is gone from the menu, and its old link opens My work.",
        who: ["Everyone"],
      },
      {
        id: "mark-lost",
        title: "Mark a deal as Lost, and bring it back",
        body: "Mark a deal as Lost from the SOR window, or drag it to the Lost column on the Board. You pick a reason first. A Lost deal can be reopened, and it goes back to the Stage it was lost from. Lost deals no longer fill the list: the Lost filter shows them, with their reason.",
        who: ["Sales"],
      },
      {
        id: "s0-card",
        title: "The S0 is set once, and checked in Odoo",
        body: "Set the S0 in the SOR's edit form, under Details. Saving it checks it in Odoo and brings in its products in one go. In the first Stage you can change it freely; after that it can be filled once, and then only a Super Admin can change it, with a reason. An S0 already on another SOR is refused, and every change is written in the deal's history.",
        who: ["Sales"],
      },
      {
        id: "contract-date",
        title: "Contract Date fills itself in",
        body: "The Contract Date is set when a deal reaches the Stage that holds the client's PO or contract (CA / PO on the Project flow), not when it is won. While it is blank you can type it on the Details tab; once set, only a Super Admin can change it. A deal won with no Contract Date still moves, and you are reminded to type it in.",
        who: ["Sales", "Management"],
      },
      {
        id: "award-dates",
        title: "Date of Award, PDI and Delivery",
        body: "An SOR now has a Date of Award, a Date of PDI and a Date of Delivery. Once the Date of Award is filled, the SOR shows an Awarded badge and the people buying for it are told.",
        who: ["Sales", "Purchasing"],
      },
      {
        id: "register-sor",
        title: "Registering an SOR is quicker",
        body: "The form is grouped into Deal Classification, Details and Assignment, and works with the keyboard. You are the Deal Owner unless you pick someone else, and Sale Type is required. The message after you register names the new SOR number, and the SOR opens straight away. A Sales Reference that is already used asks you to confirm.",
        who: ["Sales"],
      },
      {
        id: "needs-attention",
        title: "Needs attention shows decisions waiting on you",
        body: "A Stage Action waiting for you to Create or Skip it shows under Needs attention on the SOR summary, with a Go link to it. Once you decide, its notification is marked as read.",
        who: ["Sales", "Deal Team"],
      },
      {
        id: "change-notes",
        title: "Clearer change notes",
        body: "In Activity & Log Notes, a change to an SOR shows as a label with the old and new value. Products that were added, removed, changed or renamed are grouped, and each group opens to show the details.",
        who: ["Sales", "Deal Team"],
      },
      {
        id: "closed-won",
        kind: "fix",
        title: "Deals on a Closed Won Stage count as won",
        body: "A deal that ended on a Closed Won Stage was counted as lost. It now counts as Won (Realized), in the register and the totals.",
        who: ["Sales", "Management"],
      },
    ],
    alsoFixed: [
      "Saving one Stage Field shows saving on that field only, and Enter saves a one-line field.",
      "Stage moves check required fields and uploads on the server too, so an SOR can no longer skip them.",
      "An optional item on a Stage says it is optional, instead of \"not yet satisfied\".",
      "The Blocked count is the same everywhere on an SOR.",
      "SOR dates read like Nov 5, 2026, the same as in the lists.",
      "The register shows its Status column without scrolling sideways, and long statuses no longer spill past the table.",
      "Deleted SORs has a search box, like the register.",
      "The SOR window shows its frame straight away while the deal loads.",
    ],
  },
  {
    key: "tasks",
    label: "Tasks",
    intro: "All Tasks, Group Tasks and Task Approvals.",
    items: [
      {
        id: "group-task-evaluation",
        title: "Group Tasks wait for their Evaluator",
        body: "When every member is done, a Group Task shows Awaiting evaluation, and it is Completed only once it is rated. The To evaluate tab lists the ones waiting, longest first. The Evaluator gets a message, then reminders after 3, 6 and 9 days, and after that the creator and the Evaluator's heads are told. Pick the Evaluator when you create the task, or leave it empty to rate it yourself.",
        who: ["Everyone"],
      },
      {
        id: "group-task-dates",
        title: "Start and Due Dates, and checklist due dates",
        body: "A Group Task needs a Start Date and a Due Date, and shows how long is left. Checklist items can have their own due date and remarks, and a tick shows right away.",
        who: ["Everyone"],
      },
      {
        id: "group-task-teams",
        title: "Add a whole Team or Employee Group",
        body: "When you pick the members of a Group Task, you can pick a Team or an Employee Group instead of one person at a time. A role can come with its own checklist.",
        who: ["Everyone"],
      },
      {
        id: "task-approvals",
        title: "Task Approvals and HR Verifications are one page",
        body: "Task Approvals holds both steps of a task: the head's grade, then HR's check. A head sees the tasks waiting for a grade and HR sees graded tasks waiting to be verified; the Stage column says which. If you do both, the Step filter splits them. The 48-hour tabs are now called Active and Overdue on every approval page.",
        who: ["Department heads", "HR"],
      },
    ],
    alsoFixed: [
      "Phased checklists, such as Checking and Validation, no longer lock Submit for Review when every item is ticked.",
      "The grade you pick keeps its colour when you hover it.",
      "Teams show up when you pick Group Task members, and editing a Group Task no longer moves its Due Date back a day.",
      "A Group Task template that a Stage uses can't be deleted. The message names the flow and Stage that use it.",
    ],
  },
  {
    key: "time-off",
    label: "Time Off & Calendar",
    intro: "Filing time off and overtime, the new Calendar and booking a Venue.",
    items: [
      {
        id: "calendar",
        title: "A new Calendar, with a Gantt beside it",
        body: "Calendar in the menu shows time off, overtime, LWOP and meetings by month, week, day or person. Click a day to see who is out and each Venue's day, and click a free slot to book it. Switch to Gantt for two or four weeks across: Venues first, then people by department, with how many are out each day.",
        who: ["Everyone"],
      },
      {
        id: "meeting-requests",
        title: "Book a Venue with a Meeting Request",
        body: "Book a Venue from the Calendar and add a Facilitator, Participants and guests. A meeting is Onsite, Online or Hybrid, with a link and guest emails. HR approves it in Approvals, under Meeting Requests. You can edit, send again or cancel before it starts, and everyone invited gets a reminder.",
        who: ["Everyone", "HR"],
      },
      {
        id: "leave-range",
        title: "Leave over several days follows your work schedule",
        body: "A date range skips weekends and other days off, so a Friday-to-Monday leave is one request. Each day starts at your scheduled hours, such as 07:30 to 18:00, instead of a flat 8, and you can still change them. Remove a day, such as a holiday, and add it back if you need to.",
        who: ["Everyone"],
      },
      {
        id: "meal-break",
        title: "The lunch hour comes off by the clock",
        body: "Leave and overtime take off the Meal Break, 12 to 1 pm, only when your hours cover it. The old rule took an hour off any day of 5 hours or more.",
        who: ["Everyone", "HR"],
      },
      {
        id: "time-off-name",
        title: "Time Off & Overtime is the new name",
        body: "Leaves Manager and Leave Approvals are now called Time Off & Overtime. On My Requests, the button is File Time Off / Overtime. The Offset tab no longer asks for a category.",
        who: ["Everyone", "HR"],
      },
      {
        id: "lwop",
        title: "HR can record Leave Without Pay",
        body: "HR records LWOP as approved. It shows on the Calendar and can be checked from the QR code on its printed form.",
        who: ["HR"],
      },
    ],
    alsoFixed: [
      "Leave, overtime and offset dates follow Manila time, so a request near midnight lands on the right day.",
      "Opening a time off request shows all its dates, days and hours, not only the day you clicked.",
      "Declining a request opens it first, so you can add a reason.",
      "The printed TG-11, TG-12 and TG-13 forms are cleaner and show when HR validated the request.",
    ],
  },
  {
    key: "everywhere",
    label: "Everywhere",
    intro: "Changes you will notice on every screen.",
    items: [
      {
        id: "sign-out",
        title: "Sign out from the sidebar",
        body: "The menu at the top of the sidebar now has Sign out.",
        who: ["Everyone"],
      },
      {
        id: "links",
        title: "A link opens the exact window",
        body: "While an SOR, task or Group Task is open, the address in your browser points at it. Send that link and it opens the same window for the other person.",
        who: ["Everyone"],
      },
      {
        id: "grouped-notifications",
        title: "Messages from one chat come as one notification",
        body: "Several messages in the same chat now arrive as one row in your notifications, and the count badge is plain grey.",
        who: ["Everyone"],
      },
      {
        id: "bug-report-replies",
        title: "Talk back and forth on a bug report",
        body: "IT can write a note on your report, such as \"Fixed, can you check?\", and you can reply. Each note tells the other side. Press the bug button and choose My reports to see your reports, the notes on them and when each was resolved.",
        who: ["Everyone", "IT Team"],
      },
      {
        id: "keyboard",
        title: "Everything works with the keyboard",
        body: "Rows, cards, filter pills, dropdowns and switches can be reached with Tab and used with Enter or Space, and the focus outline is darker so you can see where you are.",
        who: ["Everyone"],
      },
      {
        id: "retry",
        title: "A list that fails to load says so",
        body: "If a list cannot load, you see a message with a Retry button instead of an empty page. When your filters hide everything, the page says so and offers Clear filters. An address that does not exist shows Page not found.",
        who: ["Everyone"],
      },
      {
        id: "phones",
        title: "Easier on phones and tablets",
        body: "On a tablet the sidebar folds to a thin strip. On a phone, tabs scroll sideways and tables switch to a layout that fits.",
        who: ["Everyone"],
      },
    ],
    alsoFixed: [
      "Pictures load a small copy first, so lists, chats and tasks open faster. Clicking one still opens it in full.",
      "Approve, Decline and similar buttons can't be pressed twice by accident.",
      "Messages are clearer, and dates look the same everywhere.",
      "Leaving Profile or the FAQ Editor with unsaved changes warns you first.",
      "Pop-ups open in front of the window they came from, and dropdowns no longer lock the page.",
    ],
  },
  {
    key: "retail",
    label: "Retail",
    intro: "Marketplace sales from Shopee and Lazada.",
    items: [
      {
        id: "retail-income",
        title: "Retail shows your real income, kept current",
        body: "Each order shows its Marketplace Order ID, the marketplace fee and the Order Income from its Income Note in Odoo. The Shopee and Lazada breakdown shows income, orders, average, fees and fee rate for each. Orders sync every 5 minutes, and a new one appears on an open Retail screen, highlighted.",
        who: ["Sales"],
      },
    ],
  },
  {
    key: "admins",
    label: "For admins",
    intro: "Setting up Sales Flows, access and the employee form.",
    items: [
      {
        id: "flow-files",
        title: "Export, import and duplicate a flow",
        body: "The Flow Canvas toolbar can save a flow to a file, bring one back in, or duplicate it. The copy keeps its Stage colours, positions and Won or Lost endings.",
        who: ["Admins"],
      },
      {
        id: "auto-advance",
        title: "A Stage can move on by itself",
        body: "Set a Stage to move the SOR on as soon as its last condition is met.",
        who: ["Admins"],
      },
      {
        id: "field-types",
        title: "Currency and Employee fields, and fields that show only when needed",
        body: "A Stage Field can be a Currency field, in pesos and numbers only, or an Employee field, where you pick a person. A field can also show only while another field has a given value, and only then is it required. On the Project flows, NOA Amount is now a Currency field, and Purchasing Involved, Logistics Representative and Representative are Employee fields.",
        who: ["Admins"],
      },
      {
        id: "won-lost-endings",
        title: "End Stages say Won or Lost, and one Stage holds the contract",
        body: "Each Terminal Stage says whether deals end there Won or Lost. Stages named Closed Won were set to Won for you; set any other winning end Stage in the Flow Canvas. A Super Admin marks the Stage that holds the contract with Make it the contract, and the Contract Date comes from there.",
        who: ["Admins"],
      },
      {
        id: "outdated-sors",
        title: "Update Outdated SORs, and see what happens first",
        body: "After a flow is published, SORs on the older version can be updated in bulk or one at a time, or taken back. Before you update, you see which Group Tasks will start and who will be told.",
        who: ["Admins"],
      },
      {
        id: "flow-access",
        title: "Every flow's access on one page",
        body: "A Super Admin page holds the access settings of every flow in one place.",
        who: ["Super Admin"],
      },
      {
        id: "employee-form",
        title: "Flow editor, Finance and Call Sign in the employee form",
        body: "A Super Admin turns the Flow editor on or off for each employee, and only Super Admins and Flow editors can change a flow. A Finance switch sits beside Purchasing. HR can give someone a Call Sign, the code they go by, such as 101.",
        who: ["Super Admin", "HR"],
      },
      {
        id: "legacy-closed",
        kind: "removed",
        title: "The Legacy Pipeline takes no new deals",
        body: "Sale Type is required when registering an SOR, and the Legacy Pipeline flow is view only. Existing legacy SORs keep working.",
        who: ["Admins", "Sales"],
      },
    ],
    alsoFixed: [
      "Hover a Stage condition that is also checked at another Stage to see where.",
    ],
  },
  {
    key: "purchasing",
    label: "Purchasing (Beta)",
    beta: true,
    intro: "Purchasing is still being built. The screens are open so you can look around, but keep using Group Tasks for purchasing for now.",
    items: [
      {
        id: "purchase-requests",
        title: "Purchase Requests",
        body: "An SOR has one Purchase Request, opened by a Stage or with New Purchase Request. The Deal Team adds products, and Purchasing sets each one's status as it is canvassed, ordered and received, and attaches the P0. Each request has its own chat. It replaces the old procurement requests and the Procurement Queue.",
        who: ["Sales", "Purchasing"],
      },
      {
        id: "s0-evaluation",
        title: "S0 Evaluation: cost, price and decide the bid",
        body: "The S0 Evaluation is one sheet per SOR: a row for each line of the S0, its cost from Odoo, the markup and the price, with a playground to try a markup before you save it. Technical marks each product Complies or Deviates. The Bid Decision takes Go, Revise or No-go; a Go locks the sheet, and a Go on a loss needs a decider. It prints on A4.",
        who: ["Sales", "Purchasing", "Management"],
      },
      {
        id: "technical",
        title: "The Technical page",
        body: "The Technical in-charge of an SOR finds its S0 Evaluation rows here and marks each product Complies or Deviates, many at once if needed. People on the Evaluation list approve from the same page. It shows no prices.",
        who: ["Technical"],
      },
      {
        id: "canvasses",
        title: "Canvasses: compare suppliers",
        body: "A Canvass holds up to three supplier offers, each with its price, lead time and brochure. Pick the winner and say why; on an S0 Evaluation line, the winner fills in the cost. Dollar and euro offers use the day's exchange rate. Finished Canvasses can become a Purchase Request.",
        who: ["Purchasing"],
      },
      {
        id: "ipas",
        title: "IPAS, the purchase approval sheet",
        body: "Attaching a P0 creates its IPAS. Purchasing and Finance record its payments, charges and documents, and Landed Cost is worked out for you. Each section is submitted, then approved in Approvals under IPAS Sign-offs, before the IPAS is filed. It prints like the paper form.",
        who: ["Purchasing", "Finance"],
      },
      {
        id: "transmittals",
        title: "Transmittals and Packing Lists",
        body: "A Transmittal (TG03) hands goods over: the Warehouse and Technical rate each line GC or NA and sign, and two Check by signatures close it. A Packing List records what is in each box packed for an SOR. Both print on their paper layouts.",
        who: ["Warehouse", "Logistics", "Technical"],
      },
      {
        id: "purchasing-dashboard",
        title: "The Purchasing Dashboard",
        body: "One page for where every project's buying stands. A row for each SOR shows how far its buying has got, its one next step and who owes it. Late orders are counted at the top.",
        who: ["Purchasing", "Finance", "Management"],
      },
      {
        id: "pms-tab",
        title: "The PMS tab on every SOR",
        body: "Every SOR has a PMS tab with its Purchase Request, IPAS, Transmittals and Packing Lists, and its S0 Evaluation for the people allowed to see it. Anyone who can read the SOR sees where its orders stand, without the money. Purchasing now has SORS in the menu too.",
        who: ["Sales", "Deal Team", "Purchasing"],
      },
    ],
  },
]
