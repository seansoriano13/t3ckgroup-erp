# SORS, not CRM

**Status:** accepted (2026-09-18)

The sales module has been renamed three times: **SOR / CRM** → **CRM**
(issue #206) → **SORS**. This records why the last one is the last one, so the
fourth person to look at the sidebar and think "shouldn't that be CRM?" finds an
answer instead of opening a rename ticket.

The module is **SORS — the Sales Opportunity Registration System**. It lives at
`/sors`. A single record in it is an **SOR — a Sales Opportunity Registration**.

## Why

**SORS is the company's own name for this system, not a new one.** Policy
CCPR-2026-001, Annex C is titled "Sales Opportunity Registration System". The
first migration in this repo, `_archive/0001_sales_opportunities.sql`, opens by
citing it, and `src/constants/sor.js` still carries the same header. The name
predates the software. Renaming to "CRM" in #206 replaced a term the board had
written down with one imported from the industry, and imported it into a company
whose staff already said "SOR" in conversation.

**"CRM" and "SOR" were being asked to do the same job.** #206's glossary entry
defined CRM as "where the whole commercial process runs… the SOR is the entry
point; CRM is the process it enters" — reaching for a record-versus-process
distinction. The policy's vocabulary already had that distinction, and drew it
more precisely: an SOR is a registration, SORS is the system the registrations
live in. Keeping both terms meant maintaining an explanation of how they differ.
Keeping one pair of words that differ by one letter, from one source document,
does not need explaining.

**The expansion of SOR was wrong in the glossary and nowhere else.** CONTEXT.md
read "SOR (Sales Opportunity Record)". That came from `beead29`, the navigation
commit, not from the policy, which says Registration. The correction matters
because "Record" is what made SORS look like a second, competing acronym rather
than the system the records sit in. Fixed here.

## What this is not

**Not a rename of the code.** `sales_opportunities`, `opportunityService`,
`OpportunityBoard`, `crm_lead_sources` and `src/components/sor/` keep their
names. Renaming identifiers would be a several-hundred-file mechanical diff that
changes nothing anybody can see, and it would collide with the forty-odd open
purchasing and IPAS issues working in those same services. The rule is: every
word a **user** reads says SORS; the code is left alone.

**Not a removal of the old URLs.** `/crm` and `/opportunities` both still
resolve, permanently, and both point at `/sors` directly rather than chaining
through one another — a redirect that redirects becomes a loop the first time
somebody edits one of them. `notificationRouter` has been minting `/crm` deep
links into notifications that people still have unread; those have to keep
working long after anybody remembers why.

**Not a rewrite of history.** `src/data/changelog.json` and the earlier ADRs
still say CRM where they describe decisions taken while it was called CRM.
Editing them would falsify the record. The Release Notes deck is the exception
and was rewritten, because it is a live surface presented from in front of
people — a deck saying "CRM" while the sidebar says "SORS" is a question from
the audience, not a historical note. Its one bullet that announced the #206
rename itself was cut rather than restated, since that rename no longer stands.

## Consequences

Anyone reading `docs/crm-pipeline-redesign.md`, ADR 0001 or ADR 0004 will see
"CRM" and should read it as SORS. Those documents are history and were left
as-is deliberately.

The nav key changed from `sales.sorCrm` to `sales.sors`. This was free: no
employee row used any `hidden_nav_keys` value at the time, and the column does
not exist in production at all.
