# The Retail sync re-reads Missing orders every run and touched notes nightly, not every note

A Retail Order's Income Note is added after the order, often weeks later, and Odoo does not move the order's change date when a To-Do is added or edited. So the rolling "changed in the last 30 days" window alone never sees a late or corrected note. Every 5-minute run therefore also re-reads the notes of each stored order that is Missing or Suspect, which is how a late note fills in within about 5 minutes. The nightly run (`?mode=full`) is not a full re-read of every order: it re-reads the Missing/Suspect orders plus every order whose To-Do or chatter Odoo reports written in the last 48 hours, which is how an edit to an old note is caught.

## Considered Options

- **Re-read every order's notes in the nightly run.** Rejected, on staging evidence. Salespeople paste screenshots into the Income Note, so a To-Do can weigh megabytes: ten orders' To-Dos measured 42 MB, and a run that read them 25 at a time was killed by the Edge runtime (`WORKER_RESOURCE_LIMIT`, reason `Memory`, ~150 MB heap). A full read of about 1,500 orders is hundreds of megabytes through one function invocation, every night.
- **Ask Odoo which notes changed, and read only those.** Chosen for the nightly run. Odoo's ORM stamps `write_date` on every write to a To-Do or a message, and the query returns ids only, so it costs the same however large the notes are. Edits to any old note are caught, which is what a full read was for. A note edited more than two days before two consecutive failed nights is missed until it is edited again; a dated `?since=` run reads any range by hand.
- **Re-read only Missing/Suspect orders, in the nightly run too.** Rejected: an edit to a note on an OK order (a corrected figure) would never be re-read.
- **Store a per-order "notes last read" stamp and read only on change.** Deferred. It would also remove the cost of re-reading the Missing orders every 5 minutes, but it adds a column or table, and Missing orders' notes are small (a Missing order has no usable Income Note to carry a screenshot), so the 5-minute re-read measured about 30 seconds for 530 orders.

## Consequences

- The sync writes only rows that differ from what is stored. A run that finds nothing new writes nothing, so `updated_at` means "last changed" and the Retail screen is told about real changes only.
- Notes are read ten orders at a time and each batch is written before the next is read, so a failure part-way keeps what was already read.
- The Missing/Suspect rule exists twice: `incomeStatus` (the screen) and `needsNoteReread` (the sync, which cannot import the screen's module). A test holds the two together.
