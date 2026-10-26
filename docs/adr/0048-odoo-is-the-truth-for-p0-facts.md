# ADR 0048 — Odoo is the truth for P0 facts; the app reads them

## Status
Accepted (2026-11-04), spec #675, ticket #685.

## Context

Purchasing updated a line's status in two places, Odoo and the app (before that,
a Google Sheet). "Ordered" also read as "it's here". The app never writes to
Odoo, and Odoo already records the P0, what arrived, and when it is due.

## Decision

Whatever Odoo records about a P0, the app reads and never asks anyone to type.

- Every time a request opens, the `odoo-po-sync` edge function reads the P0s
  attached to its lines and calls `purchase_request_sync_po_facts` (service
  role only), which stores each line's status and delivery figures (`po_state`,
  `po_ordered`, `po_received`, `po_eta`). Lists and the Purchasing Dashboard read
  the stored values; they do not call Odoo.
- An RFQ keeps the line To purchase ("RFQ P0..." note). A confirmed P0 makes it
  Purchased, always with a delivery note ("Not received yet · ETA ...",
  "Not received yet · no ETA set", "x of y received"). A full receipt makes it
  Received.
- Purchased and Received are never chosen by a person; the database refuses them.
- When Odoo does not answer, nothing is written and the last stored values stay.
- Odoo's Expected Arrival is often only the order date, or empty; an empty one
  shows as "no ETA set".
- A P0 cancelled in Odoo changes nothing here: the line keeps its last values
  until Purchasing attaches another P0 or cancels the line.

## Consequences

- No double entry for Purchased and Received.
- A line is as fresh as the last time its request was opened.
