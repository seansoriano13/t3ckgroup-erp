/**
 * Release Notes content: the one hand-written source for /release-notes
 * (ADR 0030 and its 2026-11 amendment). Replace it for the next release, and
 * delete the samples and scenes it no longer names; git keeps the old ones.
 *
 * Written for every employee, not for developers: plain words, what changed
 * on their screen, no ticket numbers. Each item says who uses it.
 *
 * How each kind is shown (the page groups them in this order):
 * kind "new"     a feature. `sample` names a demo to try (sampleRegistry.js
 *                SAMPLES): the real screen fed Sample Data where there is one.
 *                `flow` or `highlights` instead animate its steps or points.
 * kind "change"  how something works now. `scene` names an animation
 *                (sampleRegistry.js SCENES); `flow`, `highlights` or `renames`
 *                animate what is written here; a `sample` lets you try it.
 * kind "removed" something gone, shown like a change.
 * kind "fix"     a bug fixed. `before` and `after` say what it was like and
 *                what it is like now; `scene` names the Before and After pair.
 * points         optional detail lines under the text.
 * alsoFixed      small fixes, one line each; `before` adds what it used to do.
 * beta           the whole tab is still being built (shows the Beta tag).
 */

export const RELEASE = {
  title: "What's new: October–November",
  window: "Everything that changed in the ERP from 1 October to 16 November 2026.",
}

export const SECTIONS = [
  {
    key: "sors",
    label: "SORs",
    intro: "The SORS register, the Board, the SOR window and Commission.",
    items: [
      {
        id: "my-work",
        title: "My work: the SORs waiting on you",
        body: "SORS opens on My work. It lists every SOR you owe something on: your open tasks, your part of a Group Task and the Purchase Requests you buy for. Needs you comes first, then Watching, longest wait first, and Your move opens the task or request. The Why you're on it column says in words why each SOR is there, such as Task, a Mention, Deal Team or Purchase request, and the Stage it came at; hover it for every reason. SORS is now in everyone's menu: if you can't see the whole register, you see only My work. My SORs is gone from the menu, and its old link opens My work.",
        who: ["Everyone"],
        sample: "my-work",
      },
      {
        id: "mark-lost",
        title: "Mark a deal as Lost, and bring it back",
        body: "Mark a deal as Lost from the SOR window, or drag it to the Lost column on the Board. You pick a reason first. A Lost deal can be reopened, and it goes back to the Stage it was lost from. Lost deals no longer fill the list: the Lost filter shows them, with their reason.",
        who: ["Sales"],
        sample: "mark-lost",
      },
      {
        id: "s0-card",
        title: "The S0 is set once, and checked in Odoo",
        body: "Set the S0 in the SOR's edit form, under Details. Saving it checks it in Odoo and brings in its products in one go. In the first Stage you can change it freely; after that it can be filled once, and then only a Super Admin can change it, with a reason. An S0 already on another SOR is refused, and SORs that already share one show a red Duplicate badge. Before you change or clear an S0, you are told how many products will be marked Removed from S0. Each time the SOR opens, its S0 is checked in Odoo again, and the card shows Gone from Odoo if Odoo no longer has it. Every change is written in the deal's history.",
        who: ["Sales"],
        sample: "s0-card",
      },
      {
        id: "award-dates",
        title: "Date of Award, PDI and Delivery",
        body: "An SOR now has a Date of Award, a Date of PDI and a Date of Delivery. Once the Date of Award is filled, the SOR shows an Awarded badge and the people buying for it are told.",
        who: ["Sales", "Purchasing"],
        sample: "award-dates",
      },
      {
        id: "needs-attention",
        title: "Needs attention shows decisions waiting on you",
        body: "A Stage Action waiting for you to Create or Skip it shows under Needs attention on the SOR summary, with a Go link to it. Once you decide, its notification is marked as read.",
        who: ["Sales", "Deal Team"],
        sample: "needs-attention",
      },
      {
        id: "change-notes",
        title: "Clearer change notes",
        body: "In Activity & Log Notes, a change to an SOR shows as a label with the old and new value. Products that were added, removed, changed or renamed are grouped, and each group opens to show the details.",
        who: ["Sales", "Deal Team"],
        sample: "change-notes",
      },
      {
        id: "contract-date",
        kind: "change",
        title: "Contract Date fills itself in",
        body: "The Contract Date is set when a deal reaches the Stage that holds the client's PO or contract (CA / PO on the Project flow), not when it is won. While it is blank you can type it on the Details tab; once set, only a Super Admin can change it. A deal won with no Contract Date still moves, and you are reminded to type it in.",
        who: ["Sales", "Management"],
        flow: [
          {
            title: "The deal reaches the contract Stage",
            text: "The Stage that holds the client's PO or contract, such as CA / PO on the Project flow. Not when the deal is won.",
          },
          {
            title: "The Contract Date fills itself in",
            text: "It is set on that Stage.",
          },
          {
            title: "Blank? Type it",
            text: "While it is blank, type it on the Details tab. A deal won with no Contract Date still moves, and you are reminded.",
          },
          {
            title: "Then it stays",
            text: "Once set, only a Super Admin can change it.",
          },
        ],
      },
      {
        id: "register-sor",
        kind: "change",
        title: "Registering an SOR is quicker",
        body: "The form is grouped into Deal Classification, Details and Assignment, and works with the keyboard. You are the Deal Owner unless you pick someone else, and Sale Type is required. Fetch from Odoo fills the Company, Contact Person and Product List from the S0. The message after you register names the new SOR number, and the SOR opens straight away. A Sales Reference that is already used asks you to confirm.",
        who: ["Sales"],
        highlights: [
          {
            title: "Three groups",
            text: "The form is grouped into Deal Classification, Details and Assignment, and works with the keyboard.",
          },
          {
            title: "You are the Deal Owner",
            text: "Unless you pick someone else. Sale Type is required.",
          },
          {
            title: "Fetch from Odoo",
            text: "Fills the Company, Contact Person and Product List from the S0.",
          },
          {
            title: "Straight to the new SOR",
            text: "The message names the new SOR number, and the SOR opens straight away.",
          },
          {
            title: "A Sales Reference already used",
            text: "You are asked to confirm.",
          },
        ],
      },
      {
        id: "mentions",
        kind: "change",
        title: "A Mention lets someone into the SOR's current Stage",
        body: "Mention someone in an SOR's chat and they can open the Stage it is on, read its notes and add their own, until the SOR moves on. The message box tells you this before you send. They see a banner saying who mentioned them and when it ends, and the timeline marks each Stage they can't read and why. Under Deal team, the SOR lists everyone it was shared with this way.",
        who: ["Sales", "Deal Team", "Everyone"],
        flow: [
          {
            title: "Mention someone in the SOR's chat",
            text: "The message box tells you, before you send, what the Mention lets them do.",
          },
          {
            title: "They get into the current Stage",
            text: "They can open it, read its notes and add their own. A banner says who mentioned them and when it ends.",
          },
          {
            title: "The SOR moves on",
            text: "Their access ends with that Stage. The timeline marks each Stage they can't read, and why.",
          },
        ],
        points: ["Under Deal team, the SOR lists everyone it was shared with this way."],
      },
      {
        id: "quick-view-tasks",
        kind: "change",
        title: "Quick View lists the SOR's tasks",
        body: "Quick View now lists every task on the SOR that you can read, your own first.",
        who: ["Sales", "Deal Team"],
        scene: "quick-view-tasks",
      },
      {
        id: "real-stage",
        kind: "fix",
        title: "Overview and Commission show the SOR's real Stage",
        body: "The Overview's team radar and the Commission table read an old status, so an SOR on a Sales Flow stayed at Lead or Proposal Submitted while it moved on. They now read the Stage, as the List does. Won also means one thing everywhere: the flow's Won Stage and any Stage after it.",
        points: [
          "The Overview's win rate counts every won SOR, not only Closed Won. Someone with 4 Awarded and 1 PO Received out of 12 now shows 42%, not 0%.",
          "The Commission Dashboard keeps its own rule: an SOR counts once it has a Contract Date. Its Won SORs count is now called With a Contract Date, so Won has one meaning.",
        ],
        before: "SORs further along showed as Lead or Proposal Submitted, and the win rate read 0%.",
        after: "Each SOR shows the Stage it is really on, and the win rate counts every won SOR.",
        who: ["Sales", "Management"],
        scene: "real-stage",
      },
      {
        id: "sor-number-first",
        kind: "fix",
        title: "The SOR number leads every row",
        body: "My work, the Board cards and Deleted showed the Sales Reference first, so two SORs on the same S0 looked the same. The SOR number now comes first and the Sales Reference second. Commission rows show their own SOR number and project, not only the company.",
        points: [
          "The screens say SOR, not opportunity: Register SOR, Edit SOR, Delete SOR, “The SOR number is issued automatically”, and No SORs in an empty Board column.",
          "The money figure is called Expected value everywhere, on the record too.",
        ],
        before: "Two SORs on one S0 showed the same S0 number and company.",
        after: "Each row starts with its own SOR number.",
        who: ["Sales", "Management"],
        scene: "sor-number-first",
      },
      {
        id: "mark-lost-refused",
        kind: "fix",
        title: "Mark as Lost says no before you fill it in",
        body: "On a Sales Flow with no Lost Stage, such as Outright, you could fill in Mark as Lost, press it, and get a refusal that vanished in about three seconds. Now the menu item is off, and its hover says: This Sales Flow has no Lost Stage yet. Any other refusal shows inside the dialog and stays until you close it.",
        points: [
          "The delete confirm no longer offers Mark as Lost instead when that cannot be done.",
          "The reason list is labelled Reason and marked as required.",
        ],
        before: "You filled in the dialog, pressed Mark as Lost, and a message flashed and was gone. The dialog stayed, full.",
        after: "Mark as Lost is off, and the hover says why, before you type anything.",
        who: ["Sales"],
        scene: "mark-lost",
      },
      {
        id: "register-sor-missing",
        kind: "fix",
        title: "Register SOR names every missing field at once",
        body: "Pressing Register SOR with fields empty showed the browser's own bubble, one field at a time. Now every missing field gets a red line under it at once, and the form scrolls to the first one.",
        points: ["Each label is tied to its box, so screen readers read the field names."],
        before: "Try it: press Register SOR. The browser points at one field only. Fill it, press again, and it points at the next.",
        after: "Try it: press Register SOR. Every missing field is named at once.",
        who: ["Sales"],
        scene: "register-sor",
      },
      {
        id: "history-blocked",
        kind: "fix",
        title: "History says what is blocking the Stage",
        body: "An SOR's History tab could say Nothing outstanding while its header said Blocked: 1. The History line now counts the Stage's missing required fields too.",
        before: "History said Nothing outstanding beside a Blocked: 1 header.",
        after: "History says 1 required field missing, the same as the header.",
        who: ["Sales", "Deal Team"],
        scene: "history-blocked",
      },
      {
        id: "one-count",
        kind: "fix",
        title: "The List and the Board show the same count",
        body: "With no filter on, the List said 144 SORs and the Board said 145, because the Board counted a Lost SOR and the List did not. Both now use one count, and hovering it says how many Lost SORs it leaves out. The Board's count follows the Sales Flow you pick.",
        before: "144 on the List, 145 on the Board.",
        after: "One count on both, and its hover says what it leaves out.",
        who: ["Sales", "Management"],
        scene: "one-count",
      },
      {
        id: "closed-won",
        kind: "fix",
        title: "Deals on a Closed Won Stage count as won",
        body: "A deal that ended on a Closed Won Stage was counted as lost. It now counts as Won (Realized), in the register and the totals.",
        who: ["Sales", "Management"],
        scene: "closed-won",
        before: "A deal that ended on a Closed Won Stage was counted as lost, in the register and the totals.",
        after: "It counts as Won (Realized).",
      },
    ],
    alsoFixed: [
      {
        text: "The List's Sales Ref. and Div. headings are no longer cut on wide screens, and the Blocked on icon is not clipped.",
      },
      {
        text: "The Commission chart draws monthly amounts as bars.",
        before: "Two months read as a falling line.",
      },
      {
        text: "Every Stage not reached yet looks the same on the Stage ribbon.",
      },
      {
        text: "SOR history loads for Sales again. See Everywhere.",
      },
      {
        text: "Saving one Stage Field shows saving on that field only, and Enter saves a one-line field.",
      },
      {
        text: "Stage moves check required fields and uploads on the server too, so an SOR can no longer skip them.",
      },
      {
        text: "An optional item on a Stage says it is optional.",
        before: "It said “not yet satisfied”.",
      },
      {
        text: "The Blocked count is the same everywhere on an SOR.",
      },
      {
        text: "SOR dates read like Nov 5, 2026, the same as in the lists.",
      },
      {
        text: "The register shows its Status column without scrolling sideways, and long statuses no longer spill past the table.",
      },
      {
        text: "Deleted SORs has a search box, like the register.",
      },
      {
        text: "The SOR window shows its frame straight away while the deal loads.",
      },
      {
        text: "Opening an SOR you can't see now says so, and names the Deal Owner to ask.",
        before: "It showed nothing.",
      },
      {
        text: "When the Board won't take a drop, it says why.",
      },
      {
        text: "Registering an SOR starts the first Stage's tasks and actions straight away.",
      },
      {
        text: "A Stage Action that fails says why, and Create lets you try it again.",
      },
      {
        text: "Cancelling a task that a Stage Action made also ends the SOR access it gave.",
      },
      {
        text: "The SOR header updates as soon as you save a Stage Field, and it is more compact, with the S0 number in its top line.",
      },
      {
        text: "Clear to move no longer shows by mistake while a Stage's conditions are still loading.",
      },
      {
        text: "The SOR window shows the right Stage and status colours.",
      },
      {
        text: "The register shows a page at a time, and you pick 10, 25 or 50 rows a page.",
      },
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
        body: "When every member is done, a Group Task shows Awaiting evaluation, and it is Completed only once it is rated. The To evaluate tab lists the ones waiting, longest first. The Evaluator gets a message, then reminders after 3, 6 and 9 days, and after that the creator and the Evaluator's heads are told. When some members will never finish, the creator, the Evaluator, heads and Super Admins can press Send to evaluation. Pick the Evaluator when you create the task, or leave it empty to rate it yourself. A Group Task made by a Stage is rated by the SOR's Deal Owner. The creator, heads and Super Admins can change the Evaluator, and an Evaluator who isn't a member can still open the task and its SOR.",
        who: ["Everyone"],
        sample: "group-task-evaluation",
      },
      {
        id: "convert-to-group-task",
        title: "Turn a task into a Group Task",
        body: "Heads, HR and Super Admins can press Convert to Group Task on an open task. It keeps its details, checklist, files and chat; the task's owner becomes the first member, and you pick who else joins. Its notifications open the Group Task from then on.",
        who: ["Department heads", "HR"],
        flow: [
          {
            title: "Convert to Group Task",
            text: "Heads, HR and Super Admins press it on an open task.",
          },
          {
            title: "Everything comes along",
            text: "Its details, checklist, files and chat are kept.",
          },
          {
            title: "Pick the members",
            text: "The task's owner becomes the first member, and you pick who else joins.",
          },
          {
            title: "From then on",
            text: "Its notifications open the Group Task.",
          },
        ],
      },
      {
        id: "group-task-reopen",
        title: "Reopen a Group Task that is On hold",
        body: "A Group Task made by a Stage goes On hold when its SOR leaves that Stage. Its creator, a Super Admin or a head of the creator's department can now press Reopen. The task goes back to the status it had, and its Due Date moves out by the time it was on hold.",
        who: ["Department heads", "Everyone"],
        sample: "group-task-reopen",
      },
      {
        id: "group-task-dates",
        title: "Start and Due Dates, and checklist due dates",
        body: "A Group Task needs a Start Date and a Due Date, and shows how long is left. Checklist items can have their own due date and remarks, and a tick shows right away.",
        who: ["Everyone"],
        sample: "group-task-dates",
      },
      {
        id: "group-task-teams",
        title: "Add a whole Team or Employee Group",
        body: "When you pick the members of a Group Task, you can pick a Team or an Employee Group instead of one person at a time. A role can come with its own checklist.",
        who: ["Everyone"],
        sample: "group-task-teams",
      },
      {
        id: "task-approvals",
        title: "Task Approvals and HR Verifications are one page",
        body: "Task Approvals holds both steps of a task: the head's grade, then HR's check. A head sees the tasks waiting for a grade and HR sees graded tasks waiting to be verified; the Stage column says which. If you do both, the Step filter splits them. The 48-hour tabs are now called Active and Overdue on every approval page.",
        who: ["Department heads", "HR"],
        sample: "task-approvals",
      },
      {
        id: "group-task-managers",
        kind: "change",
        title: "Only heads, HR and Super Admins make Group Tasks",
        body: "Creating a Group Task, and editing, cancelling or deleting one, is now for heads, HR and Super Admins. Everyone else keeps working on the Group Tasks they are in.",
        who: ["Everyone"],
        highlights: [
          {
            title: "Heads, HR and Super Admins",
            text: "Create Group Tasks, and edit, cancel or delete them.",
          },
          {
            title: "Everyone else",
            text: "Keeps working on the Group Tasks they are in.",
          },
        ],
      },
      {
        id: "group-task-sor-chat",
        kind: "change",
        title: "A Group Task for an SOR shows the SOR's chat too",
        body: "A Group Task made for an SOR shows the SOR's chat beside its own, so you can follow both without switching windows.",
        who: ["Everyone"],
        scene: "group-task-sor-chat",
      },
      {
        id: "dashboard-all-tasks",
        kind: "fix",
        title: "The Dashboard counts every task",
        body: "The Dashboard stopped counting after the first 1,000 tasks, so its totals were too low. It now counts them all, and the Group Tasks part has its own row of figures.",
        who: ["Everyone"],
        scene: "dashboard-all-tasks",
        before: "The Dashboard stopped counting after the first 1,000 tasks, so its totals were too low.",
        after: "It counts every task, and Group Tasks have their own row of figures. The figures shown are made up.",
      },
    ],
    alsoFixed: [
      {
        text: "Phased checklists, such as Checking and Validation, no longer lock Submit for Review when every item is ticked.",
      },
      {
        text: "The grade you pick keeps its colour when you hover it.",
      },
      {
        text: "Teams show up when you pick Group Task members, and editing a Group Task no longer moves its Due Date back a day.",
      },
      {
        text: "A Group Task template that a Stage uses can't be deleted. The message names the flow and Stage that use it.",
      },
      {
        text: "A reaction on a Group Task chat message opens that chat.",
      },
      {
        text: "Task categories match your department and sub-department.",
      },
      {
        text: "Pasting a picture into a text box no longer also attaches it to the task.",
      },
      {
        text: "Pictures open in front of the task or SOR window, and the task window keeps its buttons in view.",
      },
      {
        text: "Pressing Send in a task chat no longer reloads the page.",
      },
      {
        text: "On a phone, the task window hides the split-screen button and keeps the chat to a width that fits.",
      },
      {
        text: "For HR, Tasks opens on your own tasks. The company view is one click away.",
      },
      {
        text: "Group Tasks show a page at a time, with 10, 25 or 50 rows a page.",
      },
    ],
  },
  {
    key: "time-off",
    label: "Time Off, HR & Calendar",
    intro: "Filing time off and overtime, approving it, My Requests, the Employee Directory, the new Calendar and booking a Venue.",
    items: [
      {
        id: "available-after",
        title: "Approvals show the balance before and after",
        body: "Leave and Offset requests in Approvals now show Available and After this: the hours the person has, and what is left once you approve. It is the same sum HR's list uses.",
        points: [
          "On a phone, the panel's arrows and Close sit on the top row, and the request's full title shows under them.",
          "On a phone, the list shows the requester's full name on its own line.",
          "Quick-reply chips wrap instead of being cut off.",
          "HR Verification says Waiting for HR: 183 days, not just Waiting 183 days, beside when it was submitted.",
        ],
        who: ["Department heads", "HR"],
        sample: "available-after",
      },
      {
        id: "still-pending",
        title: "My Requests keeps your pending requests in view",
        body: "A request still waiting for a decision now shows under Still pending at the top of My Requests, whatever month you pick. Before, a pending request filed in another month was hidden by the month picker. A month with nothing filed says so, and offers File Time Off / Overtime.",
        points: [
          "A notification about your request opens it in My Requests, even if it was filed in another month.",
        ],
        who: ["Everyone"],
        sample: "still-pending",
      },
      {
        id: "calendar",
        title: "A new Calendar, with a Gantt beside it",
        body: "Calendar in the menu shows time off, overtime, LWOP and meetings by month, week, day or person. Click a day to see who is out and each Venue's day, and click a free slot to book it. Switch to Gantt for two or four weeks across: Venues first, then people by department, with how many are out each day.",
        who: ["Everyone"],
        sample: "calendar",
      },
      {
        id: "activities",
        title: "Meeting Requests are now Activities, in four types",
        body: "What used to be a Meeting Request is now an Activity, and it comes in four types: Meeting, Admin Task, Operations Task and Event. On the Calendar each type has its own colour, and a filter beside the layers shows just the types you pick; clear it to see them all again. Time Off is not affected by the filter.",
        points: [
          "Meeting Request is now Activity, with four types: Meeting, Admin Task, Operations Task and Event.",
          "Anyone can lead an Activity. The Lead no longer has to be a department head.",
          "Only room Meetings wait for HR, and not when HR or a Super Admin files them. Events and the other Activities are on the Calendar as soon as you file them.",
          "Admin Tasks, Operations Tasks and Events can run over several days.",
          "Reception can be booked as a Venue.",
        ],
        who: ["Everyone", "HR"],
      },
      {
        id: "meeting-requests",
        title: "Book a Venue for an Activity",
        body: "Book a Venue from the Calendar and add a Lead, Participants and guests. A meeting is Onsite, Online or Hybrid, with a link and guest emails. HR approves it in Approvals, under Activities. You can edit, send again or cancel before it starts, and everyone invited gets a reminder 15 minutes before. A Venue that is already booked at that time is refused, and you are warned, without being stopped, when someone you invite is on approved time off or in another meeting.",
        who: ["Everyone", "HR"],
        sample: "meeting-requests",
      },
      {
        id: "leave-range",
        title: "Leave over several days follows your work schedule",
        body: "A date range skips weekends and other days off, so a Friday-to-Monday leave is one request. Each day starts at your scheduled hours, such as 07:30 to 18:00, instead of a flat 8, and you can still change them. Remove a day, such as a holiday, and add it back if you need to.",
        who: ["Everyone"],
        sample: "leave-range",
      },
      {
        id: "lwop",
        title: "File Leave Without Pay",
        body: "On the Leave tab, pick Without pay (LWOP) to file leave that uses no SIL hours. It is approved like other leave, and you can withdraw it. HR can also record an absence as LWOP, saved as already approved, and HR's balances list has an LWOP this month column. LWOP shows on the Calendar, prints on the TG-11 form and can be checked from its QR code.",
        who: ["Everyone", "HR"],
        flow: [
          {
            title: "Leave tab, then Without pay (LWOP)",
            text: "File leave that uses no SIL hours.",
          },
          {
            title: "Approved like other leave",
            text: "And you can withdraw it.",
          },
          {
            title: "HR can record it",
            text: "HR can record an absence as LWOP, saved as already approved. HR's balances list has an LWOP this month column.",
          },
          {
            title: "It shows where it should",
            text: "LWOP shows on the Calendar, prints on the TG-11 form and can be checked from its QR code.",
          },
        ],
      },
      {
        id: "venues",
        title: "HR keeps the list of Venues",
        body: "HR and Super Admins add, rename, reorder, hide or delete the Venues people can book, in Settings under Venues.",
        who: ["HR", "Super Admin"],
        sample: "venues",
      },
      {
        id: "time-off-page",
        kind: "change",
        title: "Time Off & Overtime is tidier",
        body: "HR's Time Off & Overtime page fits laptops and tablets better, and shows only what applies.",
        highlights: [
          {
            title: "One month control",
            text: "The Calendar tab uses the calendar's own month picker. The extra picker and the Today chip are gone, on My Requests too.",
          },
          {
            title: "Cut tabs fade at the edge",
            text: "When a row of tabs does not fit, its edge fades, so you can tell there is more.",
          },
          {
            title: "Filters fold on laptops",
            text: "Below 1440 pixels wide, Company and Date move into Filters, so the search box shows its full hint.",
          },
          {
            title: "Only the rows that apply",
            text: "An overtime request shows no Category, and a one-day request shows no From, To and Days.",
          },
          {
            title: "No sideways scroll on a tablet",
            text: "The header's buttons wrap under the title.",
          },
        ],
        who: ["HR"],
      },
      {
        id: "employee-directory",
        kind: "change",
        title: "The Employee Directory is easier to work in",
        body: "HR's employee table and its Add and Edit forms were reworked so every button is in reach.",
        highlights: [
          {
            title: "Click a row to open it",
            text: "The whole row opens the employee's Edit window.",
          },
          {
            title: "Actions stay in view",
            text: "The Actions column sticks to the right while the table scrolls. On smaller screens, Balances and Role Flags move into the Edit window.",
          },
          {
            title: "Proper fields",
            text: "The Add and Edit forms use full-height boxes, mark required fields, and label Department and Sub-department like the rest.",
          },
          {
            title: "IDs for Super Admins only",
            text: "Only Super Admins see an employee's ID, behind a Copy ID button.",
          },
        ],
        who: ["HR", "Super Admin"],
      },
      {
        id: "meal-break",
        kind: "change",
        title: "The lunch hour comes off by the clock",
        body: "Leave and overtime take off the Meal Break, 12 to 1 pm, only when your hours cover it. The old rule took an hour off any day of 5 hours or more. When no break was taken, HR can keep the hour in on review, with a reason. HR sets the Meal Break hours in Settings, under HR & Schedule.",
        who: ["Everyone", "HR"],
        sample: "meal-break",
      },
      {
        id: "hr-decides",
        kind: "change",
        title: "HR can decide a request still with a head",
        body: "HR now sees every leave and overtime request waiting on a department head, and can decide it. The employee is told it was decided on the head's behalf. Super Admins see these requests too.",
        who: ["HR", "Department heads"],
        flow: [
          {
            title: "A request waits on a head",
            text: "A leave or overtime request is still with a department head.",
          },
          {
            title: "HR sees it and decides",
            text: "HR sees every one of these, and can decide it. Super Admins see them too.",
          },
          {
            title: "The employee is told",
            text: "The message says it was decided on the head's behalf.",
          },
        ],
      },
      {
        id: "time-off-name",
        kind: "change",
        title: "Time Off & Overtime is the new name",
        body: "Leaves Manager and Leave Approvals are now called Time Off & Overtime. On My Requests, the button is File Time Off / Overtime. The Offset tab no longer asks for a category.",
        who: ["Everyone", "HR"],
        renames: [
          ["Leaves Manager", "Time Off & Overtime"],
          ["Leave Approvals", "Time Off & Overtime"],
        ],
        points: [
          "On My Requests, the button is File Time Off / Overtime.",
          "The Offset tab no longer asks for a category.",
        ],
      },
      {
        id: "activity-rules",
        kind: "change",
        title: "Who can file an Activity, and a roomier Calendar",
        body: "Only department heads can file Admin Tasks, Operations Tasks and Events. Everyone can still file Meetings. The Calendar has more room, and HR and Super Admins can change the Activity rules.",
        who: ["Everyone", "Department heads", "HR"],
        highlights: [
          {
            title: "Who can file",
            text: "Only department heads can file Admin Tasks, Operations Tasks and Events. Everyone can still file Meetings.",
          },
          {
            title: "Less waiting for HR",
            text: "Events no longer wait for HR, and neither do room Meetings filed by HR or Super Admins.",
          },
          {
            title: "You're on an Activity",
            text: "You get this note when you are put on an Activity, with the type, the date, the time and who scheduled it.",
          },
          {
            title: "More room on the Calendar",
            text: "One Filters button, a people filter, a Full screen button, one bar for an Activity over several days, and a month view on phones.",
          },
          {
            title: "Change the rules",
            text: "HR and Super Admins can change the Activity rules in Settings, under Activities.",
          },
        ],
      },
      {
        id: "file-time-off",
        kind: "fix",
        title: "The File Time Off form tells you what is missing",
        body: "Required fields carry a red asterisk on all four tabs. Pressing the button with fields empty names every missing one under its box at once. As soon as the hours are known on an Offset or SIL request, the form tells you when you do not have enough hours, and turns the button off.",
        points: [
          "The buttons say what they do: File overtime, File Offset, File leave and File undertime. All four look the same.",
          "The window uses the app's usual header and footer, so its button stays in view on a laptop and a phone.",
          "The same form serves File for Employee on Time Off & Overtime.",
          "The server still checks the balance too. The demo asks for hours to keep it short; the real form works them out from the times.",
        ],
        before: "Try it: press Submit. It points at one field at a time, and says nothing about your balance.",
        after: "Try it: press File Offset, then type 8 hours. Every missing field is named, and the balance line turns the button off.",
        who: ["Everyone", "HR"],
        scene: "file-time-off",
      },
      {
        id: "head-picker",
        kind: "fix",
        title: "The Department Head box explains a team with two heads",
        body: "When your team has two heads, the box stays empty on purpose, because the app does not guess. It now says so: Your team has 2 heads. Pick the one you report to. Your team's heads are listed first, and every head shows their department.",
        points: ["With one team head, the box still fills itself in."],
        before: "The box was empty, with no hint, and every head in the company was listed by name only.",
        after: "The real box, with made-up heads. Open it: your team comes first, each head with a department.",
        who: ["Everyone"],
        scene: "head-picker",
      },
      {
        id: "one-colour",
        kind: "fix",
        title: "Each request type has one colour and one name",
        body: "LWOP was orange on lists but pink on the Calendar, and Overtime was grey on HR's list but violet everywhere else. Each type now has the Calendar's colour on every screen. Paid leave is called SIL everywhere, and “SIL Leave” is gone. Overdue looks the same on HR's list and in Approvals.",
        points: [
          "The form's tab is still called Leave, because it holds SIL and LWOP. Its help line says Service Incentive Leave (SIL).",
        ],
        before: "The same type wore different colours and names on different screens.",
        after: "One colour and one name per type, on every screen.",
        who: ["Everyone", "HR"],
        scene: "one-colour",
      },
    ],
    alsoFixed: [
      {
        text: "My Profile hides Save settings until you change something.",
        before: "A faded red button sat there as soon as the page opened.",
      },
      {
        text: "Only Super Admins see the System ID on My Profile.",
      },
      {
        text: "File for Employee no longer has a double space in its name.",
      },
      {
        text: "The Document Center's empty preview text is centred, and its empty box is shorter.",
      },
      {
        text: "Leave, overtime and undertime notifications open the request. See Everywhere.",
      },
      {
        text: "Leave, overtime and offset dates follow Manila time, so a request near midnight lands on the right day.",
      },
      {
        text: "Opening a time off request shows all its dates, days and hours.",
        before: "It showed only the day you clicked.",
      },
      {
        text: "Declining a request opens it first, so you can add a reason.",
      },
      {
        text: "A request your head declined no longer blocks those dates or counts against your hours.",
      },
      {
        text: "An Offset request shows its attached pictures.",
      },
      {
        text: "The printed TG-11, TG-12 and TG-13 forms are cleaner and show when HR validated the request.",
      },
      {
        text: "Withdrawing a request uses the Manila date too.",
      },
      {
        text: "HR's Time Off & Overtime opens on Pending when something is waiting, and on the Calendar when nothing is.",
      },
      {
        text: "Opening a leave form's verified record from its QR code works again.",
      },
      {
        text: "On a phone, the Calendar shows an agenda list, and on a laptop more weeks fit.",
      },

    ],
  },
  {
    key: "everywhere",
    label: "Everywhere",
    intro: "Links, notifications and the menu: changes you will notice on every screen.",
    items: [
      {
        id: "window-links",
        title: "Every window has its own link",
        body: "When you open an SOR, a task, a Group Task, a Purchase Request, a chat or a Calendar entry, the address in your browser now names it, and the tab you are on. Refresh the page and the same window opens again. Send the address, or press Copy link in the window's header, and the other person lands on the same window and tab, if they may see it.",
        points: [
          "Back closes the window in one step, however many tabs you clicked.",
          "A row clicked on Group Tasks or My Tasks, the Commission deal window, the Group Task template editor and Help & FAQ keep their address too.",
          "The Dashboard cards and the Purchasing Dashboard keep their filters, and the SOR they open, in the address. They work in a new browser tab.",
          "Old links still work. They are rewritten to the new address when they open.",
        ],
        who: ["Everyone"],
        sample: "window-links",
      },
      {
        id: "bell-tabs",
        title: "The bell sorts notifications by area",
        body: "The bell's tabs are now All, Unread, Tasks, SORs, Purchasing and HR. You see an area's tab only if you can get notifications from it. Every kind of notification has its own icon, the same in the bell and in the pop-up.",
        points: [
          "Purchasing, HR and meeting notifications used to show under All only, and some SOR notifications were missing from the old Opportunities tab.",
          "Meetings sit under HR.",
        ],
        who: ["Everyone"],
        sample: "bell",
      },
      {
        id: "whats-new",
        title: "What's New pops up only when it is about your work",
        body: "Each update now says which areas it is about. The What's New pop-up opens only if you can open one of them. If you cannot, a dot on Release Notes in the menu tells you there is something new, until you open it.",
        who: ["Everyone"],
        sample: "whats-new",
      },
      {
        id: "links",
        title: "A link opens the exact window",
        body: "While an SOR, task or Group Task is open, the address in your browser points at it. Send that link and it opens the same window for the other person.",
        who: ["Everyone"],
        sample: "links",
      },
      {
        id: "chat-actions",
        title: "Chats: unsend, react, reply and copy",
        body: "You can unsend a message within 15 minutes of sending it. On a computer, hover a message for reactions, reply and copy, and select its text like any other. Enter sends in every chat.",
        who: ["Everyone"],
        sample: "chat-actions",
      },
      {
        id: "resize-columns",
        title: "Make a table column wider",
        body: "Drag the edge of a column heading in a register or queue to resize it. The app remembers your widths, and a double-click puts them back.",
        who: ["Everyone"],
        sample: "resize-columns",
      },
      {
        id: "bug-report-replies",
        title: "Talk back and forth on a bug report",
        body: "IT can write a note on your report, such as \"Fixed, can you check?\", and you can reply. Each note tells the other side. Report a bug now sits at the bottom of the side menu, instead of floating over your tables. Open it and choose My reports to see your reports, the notes on them and when each was resolved.",
        who: ["Everyone", "IT Team"],
        flow: [
          {
            title: "You report a bug",
            text: "Report a bug now sits at the bottom of the side menu, not floating over your tables.",
          },
          {
            title: "IT writes a note",
            text: "Such as “Fixed, can you check?”. The note tells you.",
          },
          {
            title: "You reply",
            text: "Each note tells the other side.",
          },
          {
            title: "My reports",
            text: "Open Report a bug and choose My reports to see your reports, the notes on them and when each was resolved.",
          },
        ],
      },
      {
        id: "keyboard",
        title: "Everything works with the keyboard",
        body: "Rows, cards, filter pills, dropdowns and switches can be reached with Tab and used with Enter or Space, and the focus outline is darker so you can see where you are.",
        who: ["Everyone"],
        sample: "keyboard",
      },
      {
        id: "retry",
        title: "A list that fails to load says so",
        body: "If a list cannot load, you see a message with a Retry button instead of an empty page. When your filters hide everything, the page says so and offers Clear filters. An address that does not exist shows Page not found.",
        who: ["Everyone"],
        sample: "retry",
      },
      {
        id: "pages",
        title: "Long lists come a page at a time",
        body: "The SOR register, Group Tasks, the approval queues, the Employee Directory, Bug Reports and the Purchasing lists show one page at a time, with the total. Pick 10, 25 or 50 rows a page.",
        who: ["Everyone"],
        sample: "pages",
      },
      {
        id: "brochure-library",
        title: "Pick a brochure from the library",
        body: "When you attach a file to an SOR Stage, or in an SOR or Purchase Request chat, the file picker has a Brochure library. Picking one links the original brochure instead of uploading a copy.",
        who: ["Sales", "Purchasing"],
        flow: [
          {
            title: "Attach a file",
            text: "On an SOR Stage, or in an SOR or Purchase Request chat.",
          },
          {
            title: "Open the Brochure library",
            text: "It is in the file picker.",
          },
          {
            title: "Pick a brochure",
            text: "It links the original brochure instead of uploading a copy.",
          },
        ],
      },
      {
        id: "menu",
        kind: "change",
        title: "The menu shows where you are",
        body: "The side menu always opens the group that holds the page you are on, without changing how you left the other groups. A name cut short, such as Time Off & Over…, shows in full when you hover it. On a phone, the top bar shows the page's own title.",
        who: ["Everyone"],
        scene: "menu",
      },
      {
        id: "sign-out",
        kind: "change",
        title: "Sign out from the sidebar",
        body: "The menu at the top of the sidebar now has Sign out.",
        who: ["Everyone"],
        scene: "sign-out",
      },
      {
        id: "grouped-notifications",
        kind: "change",
        title: "Messages from one chat come as one notification",
        body: "Several messages in the same chat now arrive as one row in your notifications, and the count badge is plain grey.",
        who: ["Everyone"],
        scene: "grouped-notifications",
      },
      {
        id: "phones",
        kind: "change",
        title: "Every screen fits a laptop, a tablet and a phone",
        body: "On a laptop, screens use less space, so more of each page shows without scrolling, and the side menu is slimmer. On smaller screens the side menu starts as icons. On a phone, a top bar opens the menu, lists show each row as a card, filters open in their own sheet, and tabs scroll sideways. Windows and dialogs open full screen on a phone, with the main button pinned at the bottom. Admin pages that are best on a computer say so.",
        who: ["Everyone"],
        highlights: [
          {
            title: "On a laptop",
            text: "Screens use less space, so more of each page shows without scrolling, and the side menu is slimmer.",
          },
          {
            title: "On smaller screens",
            text: "The side menu starts as icons.",
          },
          {
            title: "On a phone",
            text: "A top bar opens the menu, lists show each row as a card, filters open in their own sheet, and tabs scroll sideways.",
          },
          {
            title: "Windows on a phone",
            text: "Windows and dialogs open full screen, with the main button pinned at the bottom.",
          },
          {
            title: "Best on a computer",
            text: "Admin pages that are best on a computer say so.",
          },
        ],
      },
      {
        id: "notification-clicks",
        kind: "fix",
        title: "Clicking a notification opens what it is about",
        body: "43 of the 84 kinds of notification did nothing when you clicked them, among them every leave, overtime, undertime, meeting, Transmittal and Packing List notification. Every kind now opens its record, and the address names it.",
        points: [
          "A request waiting on you opens in Approvals. A decision on your own request opens it in My Requests, even when it was filed in another month.",
          "A meeting opens on the Calendar, on the meeting's date.",
          "Transmittal and Packing List notifications open the record's own page.",
          "A task notification opens the task even when your task list is empty. An SOR notification opens the SOR at your level of access, even if you are not on its deal team.",
          "A chat notification opens that chat over the page you are on, instead of jumping to another page first.",
          "A notification from the older portal, or one with nothing to open, says so in one line and closes the bell.",
        ],
        before: "Clicking a leave notification did nothing. The bell stayed open, and you went looking for the request yourself.",
        after: "The click closes the bell and opens the request. The address names it, so a refresh keeps it open.",
        who: ["Everyone"],
        scene: "notification-clicks",
      },
      {
        id: "dead-links",
        kind: "fix",
        title: "A link to something gone says so",
        body: "A link can point at a record that was deleted, one someone already handled, or one you may not open. The record screens now show one plain message: Not found, or not yours to see, with a way back.",
        points: [
          "It is the same on SOR, Purchase Request, IPAS, Transmittal, Packing List, S0 Evaluation and Technical.",
          "An approval link for a request someone else already decided says: This request is not waiting on you any more.",
          "A link to a task that is gone says so at once. It used to show nothing for 7 to 10 seconds.",
          "An address that is not a real record is not looked up at all, so there is no failed loading and no Retry.",
        ],
        before: "A bad link loaded, failed and offered Retry, or showed the list and said nothing. Six screens said it six different ways.",
        after: "One plain message on every record screen, with a button back. This is the real message from the app.",
        who: ["Everyone"],
        scene: "dead-links",
      },
      {
        id: "no-access",
        kind: "fix",
        title: "A page you cannot open tells you why",
        body: "Opening a page you have no access to used to send you to the Dashboard with no message. Now a No access screen says what access the page needs and who can give it, with a link to the Dashboard. Who may open what has not changed.",
        before: "You were sent to the Dashboard, and nothing said why.",
        after: "You stay where you were going, and the screen says what access it needs and who grants it. This is the real screen.",
        who: ["Everyone"],
        scene: "no-access",
      },
      {
        id: "speed",
        kind: "fix",
        title: "Chats, Group Tasks and SOR history load again",
        body: "For staff, three lists could take so long that the server gave up on them: your chat list, the Group Tasks in Approvals, and SOR history on My work and the List. They now load without timing out. The rules about who sees what are the same.",
        points: [
          "The checks on who may see each row now run once per list, not once per row.",
          "HR Verifications with more than 260 pending tasks no longer fails to load the “you replied” marks.",
        ],
        before: "After about 8 seconds the list gave up and stayed empty.",
        after: "The same lists load, for everyone who may see them.",
        who: ["Everyone"],
        scene: "speed",
      },
      {
        id: "group-task-chat",
        kind: "fix",
        title: "Group Task chats are private to the Group Task",
        body: "Any signed-in employee could read the messages of any Group Task chat, even one on a Restricted Stage. Now only the people who may open the Group Task, such as its creator, its Evaluator and its members, can read its chat.",
        before: "Anyone signed in could read every Group Task chat.",
        after: "Only the people who may open that Group Task read its chat.",
        who: ["Everyone"],
        scene: "group-task-chat",
      },
      {
        id: "whats-new-seen",
        kind: "fix",
        title: "What's New remembers you saw it, on any device",
        body: "The pop-up was remembered by the browser, so it came back on a new computer or phone. Your account now remembers that you saw it.",
        before: "Dismissed at the office, it popped up again on your phone.",
        after: "Dismiss it once, anywhere, and it stays dismissed.",
        who: ["Everyone"],
        scene: "whats-new-seen",
      },
      {
        id: "phone-menu",
        kind: "fix",
        title: "On a phone, the menu's Close button no longer covers your name",
        body: "The side menu's Close button sat on top of the profile row, so a tap near your name closed the menu. Close now sits in the same row as your profile.",
        before: "A tap near your name closed the menu instead of opening your profile.",
        after: "Close sits beside your name. Tap your name, and your profile menu opens.",
        who: ["Everyone"],
        scene: "phone-menu",
      },
    ],
    alsoFixed: [
      {
        text: "On a phone, the SOR window's tab strip scrolls the open tab into view.",
        before: "The last tab showed as “Co”.",
      },
      {
        text: "On a phone, the IPAS Your move bar wraps onto two lines.",
        before: "It was cut off, like “Waiting on Finance: Record”.",
      },
      {
        text: "The Purchase Request window lost the empty band above its summary.",
      },
      {
        text: "A link with a window kind the app does not know is cleared from the address.",
      },
      {
        text: "Pictures load a small copy first, so lists, chats and tasks open faster. Clicking one still opens it in full.",
      },
      {
        text: "Approve, Decline and similar buttons can't be pressed twice by accident.",
      },
      {
        text: "Messages are clearer, empty cells show a dash, and dates look the same everywhere.",
      },
      {
        text: "Leaving Profile or the FAQ Editor with unsaved changes warns you first.",
      },
      {
        text: "Picking a file you already uploaded links the original instead of adding a copy.",
      },
      {
        text: "Pop-ups open in front of the window they came from, and dropdowns no longer lock the page.",
      },
      {
        text: "Dialogs never grow past the screen: the content scrolls, and the title and buttons stay in view.",
      },
      {
        text: "Buttons, tabs and dialog buttons are one size everywhere, and a page's main button is red.",
      },
      {
        text: "Buttons, badges and labels have more contrast, and Approve buttons are readable in dark mode.",
      },
      {
        text: "Every printed form uses one layout and one type size.",
      },
      {
        text: "Each page shows its own name in the browser tab.",
      },
      {
        text: "Long chats open on the newest 30 messages and load older ones as you scroll up, so they open faster.",
      },
      {
        text: "Notifications: the list stops at 50 while the page stays open, Load older notifications shows the rest, and the bell shows a plus when there are more.",
      },
      {
        text: "Notifications on a phone: the Close button always shows, and the bell count matches the list.",
      },
      {
        text: "Signing in shows what is wrong next to the field, the sign-in page reads well in dark mode, and Tab goes from email straight to password.",
      },
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
        sample: "retail-income",
      },
    ],
    alsoFixed: [
      {
        text: "This month against last compares the same days of each month.",
      },
      {
        text: "The marketplace fee no longer counts shipping, transaction, service, commission, voucher or delivery fees.",
      },
      {
        text: "On a phone, the date range is a drop-down and orders show as cards.",
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
        flow: [
          {
            title: "Export",
            text: "Save a flow to a file from the Flow Canvas toolbar.",
          },
          {
            title: "Import",
            text: "Bring a saved flow back in.",
          },
          {
            title: "Duplicate",
            text: "The copy keeps its Stage colours, positions and Won or Lost endings.",
          },
        ],
      },
      {
        id: "auto-advance",
        title: "A Stage can move on by itself",
        body: "Set a Stage to move the SOR on as soon as its last condition is met.",
        who: ["Admins"],
        sample: "auto-advance",
      },
      {
        id: "field-types",
        title: "Currency and Employee fields, and fields that show only when needed",
        body: "A Stage Field can be a Currency field, in pesos and numbers only, or an Employee field, where you pick a person. A field can also show only while another field has a given value, and only then is it required. On the Project flows, NOA Amount is now a Currency field, and Purchasing Involved, Logistics Representative and Representative are Employee fields.",
        who: ["Admins"],
        sample: "field-types",
      },
      {
        id: "outdated-sors",
        title: "Update Outdated SORs, and see what happens first",
        body: "After a flow is published, SORs on the older version can be updated in bulk or one at a time, or taken back. Before you update, you see which Group Tasks will start and who will be told, and a bulk update shows its progress.",
        who: ["Admins"],
        flow: [
          {
            title: "Publish a flow",
            text: "SORs on the older version become Outdated.",
          },
          {
            title: "See what happens first",
            text: "Before you update, you see which Group Tasks will start and who will be told.",
          },
          {
            title: "Update",
            text: "In bulk or one at a time. A bulk update shows its progress.",
          },
          {
            title: "Or take it back",
            text: "An update can be taken back.",
          },
        ],
      },
      {
        id: "won-lost-endings",
        kind: "change",
        title: "End Stages say Won or Lost, and one Stage holds the contract",
        body: "Each Terminal Stage says whether deals end there Won or Lost. Stages named Closed Won were set to Won for you; set any other winning end Stage in the Flow Canvas. A Super Admin marks the Stage that holds the contract with Make it the contract, and the Contract Date comes from there.",
        who: ["Admins"],
        highlights: [
          {
            title: "Won or Lost",
            text: "Each Terminal Stage says whether deals end there Won or Lost.",
          },
          {
            title: "Set for you",
            text: "Stages named Closed Won were set to Won. Set any other winning end Stage in the Flow Canvas.",
          },
          {
            title: "Make it the contract",
            text: "A Super Admin marks the Stage that holds the contract, and the Contract Date comes from there.",
          },
        ],
      },
      {
        id: "flow-access",
        kind: "change",
        title: "Flow access opens from the canvas",
        body: "The Access button on the Flow Canvas toolbar opens Always sees, Always edits, History viewers and Restricted Stages for the Sale Type you picked. The separate Flow Access page is gone.",
        who: ["Super Admin"],
        renames: [
          ["The Flow Access page", "Access, on the Flow Canvas toolbar"],
        ],
      },
      {
        id: "employee-form",
        kind: "change",
        title: "Flow editor, Finance and Call Sign in the employee form",
        body: "A Super Admin turns the Flow editor on or off for each employee, and only Super Admins and Flow editors can change a flow. A Finance switch sits beside Purchasing. HR can give someone a Call Sign, the code they go by, such as 101.",
        who: ["Super Admin", "HR"],
        highlights: [
          {
            title: "Flow editor",
            text: "A Super Admin turns it on or off for each employee. Only Super Admins and Flow editors can change a flow.",
          },
          {
            title: "Finance",
            text: "A Finance switch sits beside Purchasing.",
          },
          {
            title: "Call Sign",
            text: "HR can give someone a Call Sign, the code they go by, such as 101.",
          },
        ],
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
      {
        text: "Hover a Stage condition that is also checked at another Stage to see where.",
      },
      {
        text: "A Group Task action can name who evaluates it.",
      },
      {
        text: "Require confirmation can go to everyone in a department.",
      },
      {
        text: "The canvas warns when a flow has no Lost end Stage.",
      },
      {
        text: "The Flow Canvas opens on the Sale Type you picked last.",
      },
      {
        text: "The condition Kind list scrolls when it is long.",
      },
      {
        text: "Changing only which Stage holds the award or the contract now counts as a change, so the flow can be published.",
      },
      {
        text: "Outdated SORs: updating to a newer version starts the new Stage's actions, and anything that could not be planned is shown.",
      },
    ],
  },
  {
    key: "s0-evaluation",
    label: "S0 Evaluation (Beta)",
    beta: true,
    intro: "The S0 Evaluation is still being built, like the rest of Purchasing. It now works the way the team's sheet does. The screens are open so you can look around.",
    items: [
      {
        id: "corridor",
        title: "The S0 Evaluation is a price corridor",
        body: "The evaluation serves one decision: Go or No-go on the bid. On top, the deal bar shows the corridor, from the Go floor (the lowest offer that still pays) up to the client's ABC, with your offer as the dot. Below it, the steps follow the work in order: Costs (Purchasing), Final Acquire (Management), Other costs (Purchasing), Offers (Sales) and Specs (Technical). On the right, the decision card says what a Go still needs. Try it: type a new Final Offer on a line, and watch the dot and Revenue move.",
        points: [
          "Every line has its own small corridor, from its share of the Go floor to its own ABC.",
          "Overview swaps in the whole sheet, with the waterfall from the offer down to Revenue, and what happened after buying: each line's IPAS and Landed Cost, Planned against Actual.",
          "Everyone gets only the steps and figures they may see. Someone sent no money gets a Lines step.",
          "The markup price stays Purchasing's guide on the Costs step. The old try-a-markup tool and the Full sheet step are gone.",
        ],
        who: ["Sales", "Purchasing", "Management", "Technical"],
        sample: "corridor",
      },
      {
        id: "one-total",
        title: "Type the ABC or the Final Offer as one total",
        body: "Clients often publish one budget for the whole project. On the Offers step, switch the Client ABC, or the Final Offer, from Per line to One total, and type just the total. Every check, the summary, the Bid Decision and the print then use that total. Try it below: press One total beside Client ABC, and type a total.",
        points: [
          "Per-line figures typed before the switch are kept, and come back when you switch back to Per line.",
          "With the ABC as one total, a line has no ceiling of its own and shows only its share of the Go floor.",
          "A Go locks the typed totals too.",
        ],
        who: ["Sales"],
        sample: "corridor",
      },
      {
        id: "final-acquire",
        title: "Final Acquire fills itself in by rule",
        body: "Final Acquire, the cost Management sets, is back on screen and works like the sheet. A Stockable part costs its Odoo SRP less 20%. A Source Out part costs its Acquire: the supplier's price, or the attached P0's price when there is one. Anyone on the decider list can type over a figure, and Back to the rule undoes it. Try it: the Antenna kit has no Status yet. Give it one.",
        points: [
          "The 20% is one discount for the whole evaluation, set on the Final Acquire step. A line can have its own.",
          "Each part shows its Status on this step. Sales sets it; everyone else reads it.",
          "An empty box says why: Needs a Status, Needs the Odoo SRP, or Needs the Acquire. The step counts what is in the way, for example 12 of 12 left · 12 need a Status.",
          "A discount of 100 or more is refused in plain words: Type a discount below 100, like 20.",
          "Final Acquire figures on older evaluations are kept, as typed figures.",
        ],
        who: ["Management", "Sales"],
        sample: "corridor-final-acquire",
      },
      {
        id: "percent-of-abc",
        title: "Other costs as a percent of the ABC",
        body: "The Other costs step is now the sheet's Project Cost Summary. Labor, Logistics & Transportation, Equipment & Tools, Permits/Insurance/Compliance and Overhead each show, even before they have a cost. Type a cost's amount, or its percent of the ABC, and the other is worked out. A percent follows the ABC when the ABC changes. Try it: Permits and Marketing are blank, so the Go floor says so far. Fill them in.",
        points: [
          "Typing a peso amount by hand clears the percent.",
          "While the ABC is unknown, a percent cost stays blank and says the ABC is missing. It is never counted as zero.",
          "Add another cost under a category, rename it or remove it. Marketing and the Total sit at the foot.",
        ],
        who: ["Purchasing", "Sales"],
        sample: "corridor-other-costs",
      },
      {
        id: "go-line",
        title: "Revenue is worked out like the sheet, with a 20% Go line",
        body: "The summary now follows the sheet the team decides on. Revenue is the offer without VAT, less OPEX and ITR. OPEX is worked out for you: retention, the planned Landed Cost, the project expenses and Marketing. A bid goes ahead when Revenue is 20% of the Final Offer or more. Under that, the decision card warns, but never blocks a Go. Try it: lower the offer and watch Revenue cross the line.",
        points: [
          "The 20% Go line is a setting in S0 Evaluation Settings.",
          "The typed OPEX box is gone. Old figures are kept, but no longer read.",
          "Planned and Actual Revenue use the same sum. Actual uses the IPAS Landed Cost of what was bought.",
          "A figure with a blank input stays blank and says why. A blank is never zero.",
        ],
        who: ["Sales", "Management"],
        sample: "go-line",
      },
      {
        id: "standalone",
        title: "Start an S0 Evaluation from just an S0",
        body: "On the S0 Evaluation page, New evaluation from an S0 takes an S0 number and pulls its lines and quantities from Odoo. No SOR is needed. Link it to an SOR later, the way an IPAS starts from a P0.",
        flow: [
          {
            title: "Type the S0 number",
            text: "The lines come from that sale order in Odoo. A wrong number, an S0 Odoo does not have, and Odoo being down each get their own message.",
          },
          {
            title: "Name the people",
            text: "Pick a Sales in-charge and a Purchasing in-charge. You can change them later.",
          },
          {
            title: "Work it out",
            text: "Costs, Final Acquire, Other costs, offers, specs, the Bid Decision and the print all work without an SOR.",
          },
          {
            title: "Link to a SOR",
            text: "When the SOR exists, link it. From then on the SOR's rules decide who sees what.",
          },
        ],
        points: [
          "One evaluation per S0. If the S0 already has one, the page opens it instead of making a second.",
          "Before it is linked: whoever started it and the Sales in-charge see the prices; the Purchasing in-charge and Purchasing see the costs; the decider list and Super Admins see everything.",
          "The list marks these No SOR, and can show only them.",
        ],
        who: ["Sales", "Purchasing"],
      },
      {
        id: "odoo-srp",
        kind: "change",
        title: "The Odoo column is Odoo's selling price",
        body: "The Odoo figure on a part is now the product's Sales Price in Odoo, the SRP, and it is called Odoo SRP. It is pulled in when the product is picked and on Refresh, shown per unit and as a total, and never used as a cost.",
        points: [
          "Old figures on lines with a product were Odoo's cost, so they were cleared. They come back as the SRP the next time the evaluation opens. Figures typed on lines with no product are kept.",
          "If Odoo cannot be reached, the box says so and keeps the last figure. It never shows zero.",
          "Filling Acquire from Odoo's cost still works as before.",
        ],
        who: ["Sales", "Purchasing", "Management"],
        scene: "odoo-srp",
      },
      {
        id: "ipas-column",
        kind: "change",
        title: "An IPAS column on the sheet",
        body: "Each part's row shows the IPAS that pays for it, with its state, as a link. P.O./RFQ No. and Availability are gone from the screen and the print. Their old figures are kept.",
        who: ["Purchasing", "Management"],
        scene: "ipas-column",
      },
      {
        id: "decision-card",
        kind: "change",
        title: "The decision card warns before a risky Go",
        body: "The Bid Decision card on the right of the S0 Evaluation says more, and says it louder.",
        highlights: [
          {
            title: "A Go over the ABC is loud",
            text: "It is still allowed, but the confirm box says in red how much the offer is over the ABC, and that the client cannot accept it.",
          },
          {
            title: "Lines over their own ABC are counted",
            text: "With the ABC per line, the card counts the lines over their own ABC, even when the totals are within it.",
          },
          {
            title: "Live figures until it is locked",
            text: "The card shows today's Offer and ABC. The figures a decision was taken at move into its line, like Revise at ₱410,000.00.",
          },
          {
            title: "Worth finishing first",
            text: "The checklist is advice, not a lock. When Revenue cannot be worked out yet, the confirm box names what is blank.",
          },
        ],
        who: ["Management", "Sales"],
      },
      {
        id: "decider",
        kind: "change",
        title: "Only the decider list or a Super Admin decides a bid",
        body: "Go, Revise and No-go are now only for the decider list (the Final Acquire list in Settings) and Super Admins. Everyone else who reads the figures sees the verdict, the reason and one line saying who decides. Someone who needs to decide is added to the list in Settings.",
        points: [
          "Bid Decisions in the menu shows only to people who can decide.",
          "The server refuses a decision from anyone else too.",
        ],
        who: ["Management", "Super Admin"],
        scene: "decider",
      },
      {
        id: "specs-technical",
        kind: "change",
        title: "The Specs step leads to the Technical page",
        body: "The Specs step said Judge every product, with no way to do it there. The Technical in-charge now gets a Judge the products button that opens the Technical page. Everyone else reads who judges the products, and where.",
        points: [
          "A bulk verdict asks first when some checked products are already judged: 3 are already judged (1 Deviates). Change them too? Pick Only the unjudged or All checked.",
          "A bulk Complies on a product marked Deviates clears its deviation note and alternative, so the print cannot say Complies beside a deviation.",
          "The note under a deviation now says: Write the deviation in Technical Evaluation Remarks below.",
        ],
        who: ["Technical"],
        scene: "specs-technical",
      },
      {
        id: "number-boxes",
        kind: "fix",
        title: "Number boxes ignore the mouse wheel",
        body: "With a number box selected, one turn of the mouse wheel changed the price by a centavo, and leaving the box saved it. Number boxes on the S0 Evaluation now ignore the wheel, accept commas, and show money as 13,199.89 when you are not editing it.",
        points: ["This covers every S0 Evaluation step, a line's side panel and S0 Evaluation Settings."],
        before: "Try it: click the box and turn the mouse wheel. The price changes, and leaving the box would save it.",
        after: "Try it: the real box from the app. The wheel scrolls the page, and the price stays put.",
        who: ["Sales", "Purchasing", "Management"],
        scene: "number-boxes",
      },
      {
        id: "go-floor",
        kind: "fix",
        title: "The Go floor says when costs are still missing",
        body: "The Go floor counted a blank Other cost or Marketing as zero, and dropped every Other cost when one percent cost could not be worked out. It looked lower than it was, so a losing offer could look safe. It now adds up every cost it knows. While any cost is blank it says Go floor so far, and how many costs are not counted yet.",
        points: [
          "When the Go floor is above the ABC, the deal bar says: No offer reaches the Go line under this ABC.",
          "Below the Go floor: the deal stops paying is said once, on the deal bar. A line says Under this line's share of the Go floor.",
          "The range flags on Other costs look only at costs with an amount, and treat 0 as below the range.",
        ],
        before: "Blank costs counted as nothing, so the floor sat too low and the offer looked safe.",
        after: "The floor counts what it knows, says it is a floor so far, and the same offer shows as too low.",
        who: ["Sales", "Management"],
        scene: "go-floor",
      },
      {
        id: "fits-screen",
        kind: "fix",
        title: "The S0 Evaluation fits a laptop and a phone",
        body: "On a laptop, the pinned deal bar covered the table headings as you scrolled, and rows showed above it. On a phone, the bar was cut at the right edge, hiding the Revenue percent. The bar now sits flush with the headings under it on a laptop, and stacks ABC, Offer and Revenue on a phone.",
        before: "Headings slid under the bar on a laptop, and on a phone the Revenue figure was cut off.",
        after: "Headings stick under the bar, and on a phone the figures stack and read in full.",
        who: ["Sales", "Purchasing", "Management"],
        scene: "fits-screen",
      },
    ],
    alsoFixed: [
      {
        text: "The S0 Evaluation list's totals show — when no row has a figure.",
        before: "They showed ₱0.00.",
      },
      {
        text: "One spelling everywhere: Sales in-charge, Purchasing in-charge, Technical in-charge.",
        before: "“incharge” and “PMS incharge”.",
      },
      {
        text: "The print's column reads Final Acquire, as on screen.",
        before: "It said Final cost.",
      },
      {
        text: "Cost-only rows such as Labor leave Landed Cost blank on the print.",
        before: "They printed AWAITING PURCHASE.",
      },
      {
        text: "With the ABC or the offer as one total, the print says “in the total” on each line, and works Achieved from the typed total.",
      },
      {
        text: "On the Costs step, the figure beside each Acquire box is labelled Markup price.",
      },
      {
        text: "When the evaluation cannot be read, the header hides SOR PMS tab and Print.",
      },
      {
        text: "The Other costs table keeps the Description readable on narrow screens, and scrolls sideways instead.",
      },
    ],
  },
  {
    key: "purchasing",
    label: "Purchasing (Beta)",
    beta: true,
    intro: "Purchasing is still being built. The screens are open so you can look around, but keep using Group Tasks for purchasing for now.",
    items: [
      {
        id: "canvass-grid",
        title: "One Canvass for the whole Purchase Request",
        body: "A Purchase Request now has one Canvass for all its lines, shown as one grid like the sheet: the lines go down and the suppliers go across. Add each supplier once, with its currency, rate, how long the quote holds and its lead time, then type its price on each line it quotes. A blank means it did not quote that line.",
        points: [
          "The cheapest quote on each line is marked, compared in pesos.",
          "The header strip says how many suppliers of three, how many lines have a winner, and any No other supplier note.",
          "One Canvass button on the request opens it. A line's note says where its Canvass stands, and opens the grid at that line.",
          "Someone who may not see money sees the grid without prices and rates. A foreign supplier they add shows No rate until someone who can see prices fills it in.",
        ],
        who: ["Purchasing", "Sales"],
        sample: "canvass-grid",
      },
      {
        id: "pms-page",
        title: "The PMS file opens on its own page",
        body: "One SOR's purchasing file now has a page of its own, with its S0 Evaluation, Purchase Request, IPAS, Transmittals and Packing Lists. The PMS tab in the SOR window has an Open on its own page link, and the page has Open SOR to go back.",
        points: [
          "Someone with Purchasing access but no access to the SOR sees the parts they may read.",
          "Each part keeps its own rule about who may read it.",
        ],
        who: ["Purchasing", "Finance"],
        sample: "pms-page",
      },
      {
        id: "purchase-requests",
        title: "Purchase Requests",
        body: "An SOR has one Purchase Request, opened by a Stage or with New Purchase Request. Requests are numbered, such as PR_0042. The Deal Team adds products, or uses Ask for a product for one that is not on the S0. Purchasing checks the stock and sets each product's status: Available, To purchase, Still canvassing, Purchased, Received, Cannot source or Cancelled. Tick several lines to change them in one go, and Undo a change for a few seconds after. Replace a product swaps it for another, with a reason. Each request has its own chat. It replaces the old procurement requests and the Procurement Queue.",
        who: ["Sales", "Purchasing"],
        sample: "purchase-requests",
      },
      {
        id: "direct-requests",
        title: "Anyone can open a Direct Purchase Request",
        body: "New Purchase Request in Quick Actions opens a Direct request that needs no SOR. You can name the project it is for; it then shows on that SOR as a Direct request, without being added to the project's products.",
        who: ["Everyone", "Purchasing"],
        flow: [
          {
            title: "New Purchase Request",
            text: "In Quick Actions. Anyone can open a Direct request, and it needs no SOR.",
          },
          {
            title: "Name the project, if any",
            text: "It then shows on that SOR as a Direct request.",
          },
          {
            title: "The products stay as they are",
            text: "It is not added to the project's products.",
          },
        ],
      },
      {
        id: "attach-p0",
        title: "Attach a P0 from Odoo, and let Odoo keep it current",
        body: "Attach P0 suggests the P0s in Odoo and lists their rows, and picks the item's lines by product. The same window offers to attach the P0 to the other items it covers. A P0 is attached once buying opens at its Stage; before that, Order early attaches one with a reason. Attaching a P0 creates its IPAS. From then on, Purchased and Received follow the P0 and its receipt in Odoo.",
        who: ["Purchasing"],
        flow: [
          {
            title: "Attach P0",
            text: "It suggests the P0s in Odoo, lists their rows and picks the item's lines by product.",
          },
          {
            title: "Cover the other items",
            text: "The same window offers to attach the P0 to the other items it covers.",
          },
          {
            title: "When buying opens",
            text: "A P0 is attached once buying opens at its Stage. Before that, Order early attaches one, with a reason.",
          },
          {
            title: "Odoo keeps it current",
            text: "Attaching a P0 creates its IPAS. Purchased and Received follow the P0 and its receipt in Odoo.",
          },
        ],
      },
      {
        id: "s0-evaluation",
        title: "S0 Evaluation: cost, price and decide the bid",
        body: "The S0 Evaluation is one sheet per SOR: a row for each line of the S0, its cost from Odoo, the markup and the price, with a playground to try a markup before you save it. Technical marks each product Complies or Deviates. The Bid Decision takes Go, Revise or No-go. It shows how the planned revenue is worked out and warns when the offer is below the ABC. A Go waits for the Evaluation of Specification to be approved, locks the sheet, and on a loss needs a decider. After a No-go, the Deal Owner can move the deal to Closed Lost. Once goods are bought, each line shows its Expected and Actual cost from the attached P0. It prints on A4. The Closed Book also has an S0 Evaluation page with every SOR's Planned and Actual Revenue side by side.",
        who: ["Sales", "Purchasing", "Management"],
        sample: "s0-evaluation",
      },
      {
        id: "technical",
        title: "The Technical page",
        body: "The Technical in-charge of an SOR finds its S0 Evaluation rows here and marks each product Complies or Deviates, many at once if needed. People on the Evaluation list approve from the same page. It shows no prices.",
        who: ["Technical"],
        sample: "technical",
      },
      {
        id: "canvasses",
        title: "Canvasses: compare suppliers",
        body: "A Canvass holds up to three supplier offers, each with its price, lead time and brochure. Pick the winner and say why; on an S0 Evaluation line, the winner fills in the cost. Dollar and euro offers use the day's exchange rate. Finished Canvasses can become a Purchase Request.",
        who: ["Purchasing"],
        sample: "canvasses",
      },
      {
        id: "ipas",
        title: "IPAS, the purchase approval sheet",
        body: "Attaching a P0 creates its IPAS. Purchasing and Finance record its payments, charges and documents, and Landed Cost is worked out for you. Each section is submitted, then approved in Approvals under IPAS Sign-offs, before the IPAS is filed. A payment can be a % of the order. The IPAS list has views such as Unpaid and On-Hold, a column picker, totals per currency and Excel export. It prints like the paper form.",
        who: ["Purchasing", "Finance"],
        sample: "ipas",
      },
      {
        id: "transmittals",
        title: "Transmittals and Packing Lists",
        body: "A Transmittal (TG03) hands goods over: the Warehouse and Technical rate each line GC or NA and sign, and two Check by signatures close it. A slip waiting for your Check by shows in Approvals under Transmittal Check by. A Packing List records what is in each box packed for an SOR. Both print on their paper layouts.",
        who: ["Warehouse", "Logistics", "Technical"],
        flow: [
          {
            title: "Hand the goods over",
            text: "A Transmittal (TG03) lists what is handed over.",
          },
          {
            title: "Rate and sign",
            text: "The Warehouse and Technical rate each line GC or NA, and sign.",
          },
          {
            title: "Check by",
            text: "Two Check by signatures close it. A slip waiting for yours shows in Approvals under Transmittal Check by.",
          },
        ],
        points: [
          "A Packing List records what is in each box packed for an SOR.",
          "Both print on their paper layouts.",
        ],
      },
      {
        id: "purchasing-dashboard",
        title: "The Purchasing Dashboard",
        body: "One page for where every project's buying stands. A row for each SOR shows how far its buying has got, its one next step and who owes it. Late orders are counted at the top. It replaces the Order Monitoring page, and old Order Monitoring links open it.",
        who: ["Purchasing", "Finance", "Management"],
        highlights: [
          {
            title: "One row per SOR",
            text: "How far its buying has got, its one next step and who owes it.",
          },
          {
            title: "Late orders at the top",
            text: "They are counted at the top of the page.",
          },
          {
            title: "Order Monitoring is gone",
            text: "This page replaces it, and old Order Monitoring links open it.",
          },
        ],
      },
      {
        id: "reference-rate",
        title: "A daily exchange rate",
        body: "The Reference Rate is what one US dollar or euro is worth in pesos, taken once a day from the European Central Bank, and it always shows the day it is for. Canvasses fill it in for dollar and euro offers, and an IPAS shows it beside the rate you paid. A Super Admin can correct a day's rate in Settings.",
        who: ["Purchasing", "Finance"],
        flow: [
          {
            title: "Once a day",
            text: "The Reference Rate, what one US dollar or euro is worth in pesos, comes from the European Central Bank, and always shows the day it is for.",
          },
          {
            title: "Canvasses and IPAS use it",
            text: "Canvasses fill it in for dollar and euro offers, and an IPAS shows it beside the rate you paid.",
          },
          {
            title: "Corrected if needed",
            text: "A Super Admin can correct a day's rate in Settings.",
          },
        ],
      },
      {
        id: "pms-tab",
        title: "The PMS tab on every SOR",
        body: "Every SOR has a PMS tab with its Purchase Request, IPAS, Transmittals and Packing Lists, and its S0 Evaluation for the people allowed to see it. Anyone who can read the SOR sees where its orders stand, without the money, and each Product List line shows its P0, linked to Odoo. Once Purchasing sets a product's status, the Products tab shows that instead of the Odoo stock badge.",
        who: ["Sales", "Deal Team", "Purchasing"],
        sample: "pms-tab",
      },
      {
        id: "canvass-rules",
        kind: "change",
        title: "The Canvass rules, line by line",
        body: "The rules were written for a Canvass of one line. They now work per line of the request, and the database keeps every one of them.",
        flow: [
          {
            title: "Three suppliers",
            text: "No winner can be picked until the Canvass has three suppliers, or a No other supplier note covers the missing ones.",
          },
          {
            title: "Prices",
            text: "A line moves to Still canvassing when its first price is saved.",
          },
          {
            title: "A winner per line",
            text: "Pick a winner on each line and say why. “wins every line” and one reason for all save clicks.",
          },
          {
            title: "Purchased locks the line",
            text: "Its prices, winner and reason can no longer change. Other lines stay open. A Super Admin can unlock a line, with a reason.",
          },
        ],
        points: [
          "The winner fills in the Acquire, Offer Specification and documents of its S0 Evaluation line, and suggests a Brand for Sales to accept.",
          "A line added later shows as a new row with no quotes. A cancelled line stays, marked Cancelled, and cannot get a winner.",
          "A line bought with no Canvass says so on the request and on the printed sheet.",
        ],
        who: ["Purchasing"],
      },
      {
        id: "canvass-from-s0",
        kind: "change",
        title: "From the S0 Evaluation to the request's Canvass",
        body: "A Canvass always belongs to a Purchase Request now, so an S0 Evaluation line opens the Canvass of the request that carries it.",
        flow: [
          {
            title: "Press Canvass on a line",
            text: "On an S0 Evaluation line, press Canvass.",
          },
          {
            title: "The request's Canvass opens",
            text: "It opens at that line, highlighted.",
          },
          {
            title: "No request yet?",
            text: "The button is off and says Raise the Purchase Request first, with the button to raise it if you may.",
          },
        ],
        points: ["A line on more than one request lists their Canvasses, so you can pick one."],
        who: ["Purchasing", "Sales"],
      },
      {
        id: "canvasses-page",
        kind: "change",
        title: "The Canvasses page lists one row per request",
        body: "Each row is one Purchase Request's Canvass: its number, the request, the project or Direct request, the Canvasser, how many suppliers, how many lines have a winner, and when it last changed. Each row has one status, Needs suppliers, Needs winners or Winners picked, and a lock when every line is locked.",
        points: [
          "A Canvass still starts from its request, not from this page. Search by number, request, supplier or product still works.",
        ],
        who: ["Purchasing"],
        scene: "canvasses-page",
      },
      {
        id: "canvass-print",
        kind: "change",
        title: "The printed Canvass is one sheet per request",
        body: "The print follows the sheet's Canvass Matrix: lines down the page, suppliers across, three to a page. A fourth supplier and beyond continue on the next page, with the lines repeated. Each line's winner is marked, and the reasons are listed under the grid.",
        points: [
          "Only Canvassed by signs.",
          "A line with no winner, or no quote, says so. Nothing prints as zero.",
          "Someone who may not see money gets the sheet without prices, rates and totals.",
        ],
        who: ["Purchasing"],
        scene: "canvass-print",
      },
      {
        id: "old-canvasses",
        kind: "removed",
        title: "Canvasses made line by line were removed",
        body: "The old Canvasses, one per line, were deleted rather than converted, because a Canvass now belongs to its Purchase Request. What an old winner filled in stays: the Acquire, the Offer Specification and the documents are kept as plain figures.",
        who: ["Purchasing"],
      },
      {
        id: "purchasing-settings",
        kind: "change",
        title: "Purchasing and S0 Evaluation settings",
        body: "Settings has a Purchasing tab: the IPAS option lists and sign-off lists, the next IPAS number, the files each IPAS needs, ageing rules for late orders, and the Reference Rates. The S0 Evaluation tab holds the markup presets, the rates and the evaluation list.",
        who: ["Purchasing", "Super Admin"],
        highlights: [
          {
            title: "Purchasing tab",
            text: "The IPAS option lists and sign-off lists, the next IPAS number, the files each IPAS needs, ageing rules for late orders, and the Reference Rates.",
          },
          {
            title: "S0 Evaluation tab",
            text: "The markup presets, the rates and the evaluation list.",
          },
        ],
      },
      {
        id: "purchasing-flow-steps",
        kind: "change",
        title: "Stage conditions and actions for buying",
        body: "The Flow Canvas has new Stage Actions: Open Purchase Request, Open S0 Evaluation, Evaluation of Specification and Request Packing List. It has new Stage conditions too: Purchasing settled, Costing priced, Costing settled, Evaluation of Specification approved, Goods checked and Orders filed. A Stage can be marked Buying opens here.",
        who: ["Admins"],
        highlights: [
          {
            title: "New Stage Actions",
            text: "Open Purchase Request, Open S0 Evaluation, Evaluation of Specification and Request Packing List.",
          },
          {
            title: "New Stage conditions",
            text: "Purchasing settled, Costing priced, Costing settled, Evaluation of Specification approved, Goods checked and Orders filed.",
          },
          {
            title: "Buying opens here",
            text: "A Stage can be marked as the one where buying opens.",
          },
        ],
      },
    ],
    alsoFixed: [
      {
        text: "Transmittal and Packing List notifications open the record. See Everywhere.",
      },
      {
        text: "The Purchase Request window keeps its address, including the Chat or Items tab you are on.",
      },
    ],
  },
]
