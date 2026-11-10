# ADR 0040 — Every Purchasing record opens in one full-window record window

## Status
Accepted (2026-10-22), spec #631. Supersedes the 2026-10-21 decision to give
the IPAS its own page (made alongside the IPAS changes in ADR 0036).

## Context

Purchasing records opened five different ways. A Purchase Request opened in a
big window on a desktop and a side panel on a phone. A Canvass, a Transmittal
and a Packing List opened in a window. An IPAS opened as a full page at
`/purchasing/ipas/:id`, because it was too big for the 1100px window and
because its sections needed room.

A purchaser who moved from one tab to the next had to relearn how to open a
record, how to close it, and where its buttons were. The IPAS page also meant
that Close went somewhere different than it did everywhere else. The reason
for the page, room, no longer holds: the record window can be the full height
and up to 1400px wide, which is what the IPAS needed.

## Decision

Every Purchasing record (Purchase Request, Canvass, IPAS, Transmittal, Packing
List) opens in one full-height **record window** over its list, at every width.

- **One shell.** `ModalShell` gets a `record` size, equal to the RecordModal
  size: 16px inset, full height, up to 1400px wide, and the whole screen on a
  phone. A record window has no footer bar and no Expand. The X and Esc close
  it.
- **One link.** Where a record already has a route, the route renders the list
  with the window on top (`/purchasing/<tab>/:id`), and Close returns to the
  list. The IPAS route (`/purchasing/ipas/:id`) now does this too. Purchase
  Requests and Canvasses keep the query parameter that opens them today, so
  existing links and notifications still land on the record. No route or
  query parameter is renamed.
- **One anatomy inside.** The window starts with a shared Record header
  (reference and name, one state badge, one quiet line) and a row of Property
  pills. Facts sit in a Detail grid, children in a Liner list, and a record
  with sign-off steps shows the shared Your move card. The parts live in
  `src/components/record/`.
- **IPAS keeps its behaviour.** The money summary, the folded sections with
  Open all / Close all, `?open=` and the `?edit=` edit view move into the
  window unchanged. Its Paid status becomes a pill, so the record carries one
  badge. Its Submit lives only in Your move.
- **Slide-overs stay where the person is browsing, not opening.** The
  Purchasing Dashboard keeps its SOR side panel. A Purchase Request picked
  there opens in the record window.

## Consequences

- Purchase Request review is no longer a slide-over, and the phone
  slide-over path is gone. DESIGN.md's Container rule says so.
- The IPAS record page and its own layout are gone. The `RecordDrawer`
  component, which nothing imports any more, is deleted.
- One Purchasing anatomy test per kind (`purchasingAnatomy.test.jsx` for
  lists, `purchasingAnatomy.records.test.jsx` for records) is the place a new
  Purchasing screen gets checked.

## Considered Options

- **Keep the IPAS as a page and make the other four match it.** Rejected: the
  Transmittal, Packing List and Canvass already worked as windows, and a page
  takes the list away from someone who opens many records in a row.
- **A wider `wide` size for the IPAS only.** Rejected: it keeps two window
  sizes and two ways to close a record.
- **Keep the Purchase Request side panel on phones.** Rejected: it was broken
  there, and the window already fills a phone screen.
