# ADR 0017 — Mention deep-links resolve client-side

## Status
Accepted

## Context

Being mentioned raises a notification that opens the Chat it was written in.
Opening it landed the recipient wherever the Chat happened to sit — for a long
Chat, nowhere near the Message that named them, leaving them to scroll a year
of history hunting for their own name. The fix is to take them to the Message
itself and mark it.

Nothing in the notification says which Message that is. All three mention
notifications carry `reference_id` set to the *record* — `TASK_MENTION` and
`GROUP_TASK_MENTION` carry a task id, `OPPORTUNITY_MENTION` an opportunity id.
The Mention itself lives on the Message row, in `metadata.mentions`, and the
row's id is never copied anywhere the notification can reach.

Two ways to close that gap. Carry the Message id on the notification, which
means changing the payload the `send-push` edge function writes, threading a
third value through the desktop-push click path that today passes only
`?pushType=&pushReferenceId=`, and accepting that every notification already
sent stays untargetable forever. Or work it out on open, from data the Chat has
already fetched.

## Decision

**The Mention Target is resolved when the notification is opened, by scanning
the loaded Messages for the most recent one whose `metadata.mentions` names the
current user.** The notification is not changed, the edge function is not
redeployed, and notifications sent before this shipped deep-link correctly the
moment the recipient clicks one.

The cost is that a Mention Target is *the latest mention of you in this Chat*
rather than *the mention this notification was raised for*. Three notifications
from three separate Messages all land on the newest of the three. This is
recorded in the glossary as what a Mention Target means, rather than treated as
a defect to be fixed later: it is the behaviour, and it is the right one often
enough — someone catching up wants the most recent thing said to them.

Resolution is one exported helper used by all three surfaces, alongside a
single mention renderer in `src/utils/mentions.js`. Task and Group Task Chats
previously rendered mentions through `renderContent` inside
`ComprehensiveChatModal` and SOR Chats through `NoteText` in
`MentionTextarea` — two implementations of one thing, which is how they would
have drifted apart under this change.

**The two surfaces keep their existing open mechanisms.** The chat modal is
told to highlight through the `OPEN_CHAT_MODAL` window event it already
listens for; `OpportunityDetailsModal` through router state, which
`pages/opportunities/index.jsx` already reads and clears. Converting the
opportunity modal to the event would force it to hold its own open state
beside the `selectedId` that already governs it.

## Consequences

- **This depends on the Chat being wholly in the DOM.** Neither
  `getActivityForTask` nor `getNotes` limits or paginates, and neither message
  list is virtualised, so the Mention Target is always present to scroll to.
  Adding pagination or virtualisation to fix that unbounded fetch — which is
  worth doing — silently breaks mention deep-links, with no compile error and
  no failing test, because the Message simply will not be there. Whoever takes
  that on must resolve the Mention Target on the server, or fetch around it,
  in the same change. This is the coupling to know about before touching either
  query.
- Mentions are matched by name against the text, which is what both renderers
  already did. Two employees sharing a display name will therefore both see a
  mention of either one styled as their own. Fixing that means recording
  offsets in `metadata.mentions` when a Message is written, which does nothing
  for Messages already stored, so it is left as its own problem rather than
  folded in here.
- A Mention Target that cannot be found — no Message in the Chat names the
  reader — opens the right Chat at its newest Message and says so, rather than
  failing silently or refusing to open.
- `MessageBubble` gains `React.memo` and stable handler identities, and
  `useEmployeeAvatarMap` moves out of it to the list. That is a performance fix
  in its own right, but it is a prerequisite here: an unmemoised list
  re-rendered every keystroke cannot animate one Message smoothly.
