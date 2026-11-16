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
  window: "Everything that changed in the ERP from 1 October to 13 November 2026.",
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
          { title: "The Contract Date fills itself in", text: "It is set on that Stage." },
          {
            title: "Blank? Type it",
            text: "While it is blank, type it on the Details tab. A deal won with no Contract Date still moves, and you are reminded.",
          },
          { title: "Then it stays", text: "Once set, only a Super Admin can change it." },
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
          { title: "You are the Deal Owner", text: "Unless you pick someone else. Sale Type is required." },
          { title: "Fetch from Odoo", text: "Fills the Company, Contact Person and Product List from the S0." },
          {
            title: "Straight to the new SOR",
            text: "The message names the new SOR number, and the SOR opens straight away.",
          },
          { title: "A Sales Reference already used", text: "You are asked to confirm." },
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
        points: [
          "Under Deal team, the SOR lists everyone it was shared with this way.",
        ],
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
      { text: "Saving one Stage Field shows saving on that field only, and Enter saves a one-line field." },
      {
        text: "Stage moves check required fields and uploads on the server too, so an SOR can no longer skip them.",
      },
      { text: "An optional item on a Stage says it is optional.", before: "It said “not yet satisfied”." },
      { text: "The Blocked count is the same everywhere on an SOR." },
      { text: "SOR dates read like Nov 5, 2026, the same as in the lists." },
      {
        text: "The register shows its Status column without scrolling sideways, and long statuses no longer spill past the table.",
      },
      { text: "Deleted SORs has a search box, like the register." },
      { text: "The SOR window shows its frame straight away while the deal loads." },
      {
        text: "Opening an SOR you can't see now says so, and names the Deal Owner to ask.",
        before: "It showed nothing.",
      },
      { text: "When the Board won't take a drop, it says why." },
      { text: "Registering an SOR starts the first Stage's tasks and actions straight away." },
      { text: "A Stage Action that fails says why, and Create lets you try it again." },
      { text: "Cancelling a task that a Stage Action made also ends the SOR access it gave." },
      {
        text: "The SOR header updates as soon as you save a Stage Field, and it is more compact, with the S0 number in its top line.",
      },
      { text: "Clear to move no longer shows by mistake while a Stage's conditions are still loading." },
      { text: "The SOR window shows the right Stage and status colours." },
      { text: "The register shows a page at a time, and you pick 10, 25 or 50 rows a page." },
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
          { title: "Convert to Group Task", text: "Heads, HR and Super Admins press it on an open task." },
          { title: "Everything comes along", text: "Its details, checklist, files and chat are kept." },
          { title: "Pick the members", text: "The task's owner becomes the first member, and you pick who else joins." },
          { title: "From then on", text: "Its notifications open the Group Task." },
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
          { title: "Heads, HR and Super Admins", text: "Create Group Tasks, and edit, cancel or delete them." },
          { title: "Everyone else", text: "Keeps working on the Group Tasks they are in." },
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
      { text: "The grade you pick keeps its colour when you hover it." },
      {
        text: "Teams show up when you pick Group Task members, and editing a Group Task no longer moves its Due Date back a day.",
      },
      {
        text: "A Group Task template that a Stage uses can't be deleted. The message names the flow and Stage that use it.",
      },
      { text: "A reaction on a Group Task chat message opens that chat." },
      { text: "Task categories match your department and sub-department." },
      { text: "Pasting a picture into a text box no longer also attaches it to the task." },
      { text: "Pictures open in front of the task or SOR window, and the task window keeps its buttons in view." },
      { text: "Pressing Send in a task chat no longer reloads the page." },
      { text: "On a phone, the task window hides the split-screen button and keeps the chat to a width that fits." },
      { text: "For HR, Tasks opens on your own tasks. The company view is one click away." },
      { text: "Group Tasks show a page at a time, with 10, 25 or 50 rows a page." },
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
        sample: "calendar",
      },
      {
        id: "meeting-requests",
        title: "Book a Venue with a Meeting Request",
        body: "Book a Venue from the Calendar and add a Facilitator, Participants and guests. A meeting is Onsite, Online or Hybrid, with a link and guest emails. HR approves it in Approvals, under Meeting Requests. You can edit, send again or cancel before it starts, and everyone invited gets a reminder 15 minutes before. A Venue that is already booked at that time is refused, and you are warned, without being stopped, when someone you invite is on approved time off or in another meeting.",
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
          { title: "Leave tab, then Without pay (LWOP)", text: "File leave that uses no SIL hours." },
          { title: "Approved like other leave", text: "And you can withdraw it." },
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
          { title: "A request waits on a head", text: "A leave or overtime request is still with a department head." },
          {
            title: "HR sees it and decides",
            text: "HR sees every one of these, and can decide it. Super Admins see them too.",
          },
          { title: "The employee is told", text: "The message says it was decided on the head's behalf." },
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
    ],
    alsoFixed: [
      {
        text: "Leave, overtime and offset dates follow Manila time, so a request near midnight lands on the right day.",
      },
      {
        text: "Opening a time off request shows all its dates, days and hours.",
        before: "It showed only the day you clicked.",
      },
      { text: "Declining a request opens it first, so you can add a reason." },
      { text: "A request your head declined no longer blocks those dates or counts against your hours." },
      { text: "An Offset request shows its attached pictures." },
      { text: "The printed TG-11, TG-12 and TG-13 forms are cleaner and show when HR validated the request." },
      { text: "Withdrawing a request uses the Manila date too." },
      {
        text: "HR's Time Off & Overtime opens on Pending when something is waiting, and on the Calendar when nothing is.",
      },
      { text: "Opening a leave form's verified record from its QR code works again." },
      { text: "On a phone, the Calendar shows an agenda list, and on a laptop more weeks fit." },
    ],
  },
  {
    key: "everywhere",
    label: "Everywhere",
    intro: "Changes you will notice on every screen.",
    items: [
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
          { title: "IT writes a note", text: "Such as “Fixed, can you check?”. The note tells you." },
          { title: "You reply", text: "Each note tells the other side." },
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
          { title: "Attach a file", text: "On an SOR Stage, or in an SOR or Purchase Request chat." },
          { title: "Open the Brochure library", text: "It is in the file picker." },
          { title: "Pick a brochure", text: "It links the original brochure instead of uploading a copy." },
        ],
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
          { title: "On smaller screens", text: "The side menu starts as icons." },
          {
            title: "On a phone",
            text: "A top bar opens the menu, lists show each row as a card, filters open in their own sheet, and tabs scroll sideways.",
          },
          {
            title: "Windows on a phone",
            text: "Windows and dialogs open full screen, with the main button pinned at the bottom.",
          },
          { title: "Best on a computer", text: "Admin pages that are best on a computer say so." },
        ],
      },
    ],
    alsoFixed: [
      {
        text: "Pictures load a small copy first, so lists, chats and tasks open faster. Clicking one still opens it in full.",
      },
      { text: "Approve, Decline and similar buttons can't be pressed twice by accident." },
      { text: "Messages are clearer, empty cells show a dash, and dates look the same everywhere." },
      { text: "Leaving Profile or the FAQ Editor with unsaved changes warns you first." },
      { text: "Picking a file you already uploaded links the original instead of adding a copy." },
      { text: "Pop-ups open in front of the window they came from, and dropdowns no longer lock the page." },
      { text: "Dialogs never grow past the screen: the content scrolls, and the title and buttons stay in view." },
      { text: "Buttons, tabs and dialog buttons are one size everywhere, and a page's main button is red." },
      { text: "Buttons, badges and labels have more contrast, and Approve buttons are readable in dark mode." },
      { text: "Every printed form uses one layout and one type size." },
      { text: "Each page shows its own name in the browser tab." },
      {
        text: "Long chats open on the newest 30 messages and load older ones as you scroll up, so they open faster.",
      },
      {
        text: "Notifications: the list stops at 50 while the page stays open, Load older notifications shows the rest, and the bell shows a plus when there are more.",
      },
      { text: "Notifications on a phone: the Close button always shows, and the bell count matches the list." },
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
      { text: "This month against last compares the same days of each month." },
      {
        text: "The marketplace fee no longer counts shipping, transaction, service, commission, voucher or delivery fees.",
      },
      { text: "On a phone, the date range is a drop-down and orders show as cards." },
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
          { title: "Export", text: "Save a flow to a file from the Flow Canvas toolbar." },
          { title: "Import", text: "Bring a saved flow back in." },
          { title: "Duplicate", text: "The copy keeps its Stage colours, positions and Won or Lost endings." },
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
          { title: "Publish a flow", text: "SORs on the older version become Outdated." },
          {
            title: "See what happens first",
            text: "Before you update, you see which Group Tasks will start and who will be told.",
          },
          { title: "Update", text: "In bulk or one at a time. A bulk update shows its progress." },
          { title: "Or take it back", text: "An update can be taken back." },
        ],
      },
      {
        id: "won-lost-endings",
        kind: "change",
        title: "End Stages say Won or Lost, and one Stage holds the contract",
        body: "Each Terminal Stage says whether deals end there Won or Lost. Stages named Closed Won were set to Won for you; set any other winning end Stage in the Flow Canvas. A Super Admin marks the Stage that holds the contract with Make it the contract, and the Contract Date comes from there.",
        who: ["Admins"],
        highlights: [
          { title: "Won or Lost", text: "Each Terminal Stage says whether deals end there Won or Lost." },
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
          { title: "Finance", text: "A Finance switch sits beside Purchasing." },
          { title: "Call Sign", text: "HR can give someone a Call Sign, the code they go by, such as 101." },
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
      { text: "Hover a Stage condition that is also checked at another Stage to see where." },
      { text: "A Group Task action can name who evaluates it." },
      { text: "Require confirmation can go to everyone in a department." },
      { text: "The canvas warns when a flow has no Lost end Stage." },
      { text: "The Flow Canvas opens on the Sale Type you picked last." },
      { text: "The condition Kind list scrolls when it is long." },
      {
        text: "Changing only which Stage holds the award or the contract now counts as a change, so the flow can be published.",
      },
      {
        text: "Outdated SORs: updating to a newer version starts the new Stage's actions, and anything that could not be planned is shown.",
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
          { title: "Name the project, if any", text: "It then shows on that SOR as a Direct request." },
          { title: "The products stay as they are", text: "It is not added to the project's products." },
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
          { title: "Hand the goods over", text: "A Transmittal (TG03) lists what is handed over." },
          { title: "Rate and sign", text: "The Warehouse and Technical rate each line GC or NA, and sign." },
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
          { title: "One row per SOR", text: "How far its buying has got, its one next step and who owes it." },
          { title: "Late orders at the top", text: "They are counted at the top of the page." },
          { title: "Order Monitoring is gone", text: "This page replaces it, and old Order Monitoring links open it." },
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
          { title: "Corrected if needed", text: "A Super Admin can correct a day's rate in Settings." },
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
          { title: "S0 Evaluation tab", text: "The markup presets, the rates and the evaluation list." },
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
          { title: "Buying opens here", text: "A Stage can be marked as the one where buying opens." },
        ],
      },
    ],
  },
]
