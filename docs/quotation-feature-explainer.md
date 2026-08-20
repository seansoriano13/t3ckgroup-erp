# The Quotation Feature — Plain-English Walkthrough

*A review doc, not a spec. If someone asks you "how does this work" or "why does it work that way," this is the answer.*

---

## 1. The problem we started with

Sales quotations live in Odoo. When a salesperson prints one (gear icon → **PDF Quote**), Odoo attaches every product's brochure/datasheet to the PDF automatically — but it puts them **before** the quotation, not after. So a customer opens the file and sees 40 pages of spec sheets before they ever see the price. That's backwards.

We couldn't just "fix" that in Odoo. The company is on **Odoo Online (SaaS)**, and Odoo Online flatly does not allow custom code — no modules, no server-side changes, nothing. That's an Odoo policy, not a workaround we chose to skip. So whatever fixed this had to live entirely outside Odoo, touching it only through its API.

## 2. What we built instead

Two things, and they solve two different problems.

### A) A shareable link (the fast, low-effort option)

Every Odoo sales order already has a **customer portal page** — a URL like:

```
https://t3ckgrouponline.odoo.com/my/orders/4718?access_token=xxxx
```

That page shows the quotation cleanly, with each brochure listed as a **separate download** underneath — no merging, no ordering problem, because nothing gets stitched together. It already looked good; it was just sitting there unused.

The app can now generate this link on demand for any opportunity that has a Sales Reference, and there's a "Preview Quotation" button plus a copy-link button right in the opportunity's detail view. This became the recommended way to send a quotation — it needs zero PDF assembly, zero Odoo config changes, and it's what we tell sales to reach for first.

One catch worth remembering: that link shows **live data**. If someone edits the price in Odoo after sending the link, the customer sees the new number the next time they open it — there's no "frozen snapshot." We decided that's an acceptable tradeoff since sent quotes are rarely edited afterward.

### B) An assembled PDF (for when someone needs an actual attachment)

Some situations still need a real file to attach to an email — not everyone wants a link. So we built a second feature: "Download Full PDF." This is the harder one, and it went through a few iterations before landing where it is now.

## 3. How the PDF gets assembled (the technical story, simplified)

1. **We read the quotation's product list from Odoo** and figure out which brochures belong to it (via a `product.document` model in Odoo — basically "which PDF is attached to which product").
2. **We fetch the quotation PDF itself** through Odoo's customer portal (the same `/my/orders/...` link mentioned above, just fetched by our server instead of opened in a browser).
3. **We fetch every brochure** — but not from Odoo directly anymore (see the mirror section below).
4. **We stitch them together in the customer's browser**, quotation first, brochures after — using a PDF library called `pdf-lib`. This part turned out to be cheap: even a 100+ MB set of brochures merges in well under a second and barely touches memory. That was a real worry early on and it turned out to be a non-issue.

### The tricky part: Odoo still bakes brochures into its own render

Here's the twist that caused the most back-and-forth: even when we fetch the quotation through the portal link, Odoo still automatically prepends every brochure to it if that brochure is marked "Inside quote" in Odoo's product settings. We can't turn that behavior off from outside Odoo — it's baked into Odoo's own PDF-generation code, and (as covered above) we can't touch that code.

So for a while, the assembled PDF looked like:

```
[Odoo's brochures] → [Quotation] → [our brochures again]
```

Brochures showed up **twice** — once because Odoo glued them on, and once because we appended them too. Annoying, and it took a couple of rounds to properly diagnose (we initially thought a code fix alone would solve it — it didn't, because the fix has to happen in Odoo's data, not in our code).

**The real fix has two parts:**

- **In Odoo:** each product's brochure has a "Visible at" setting. We flip it from "Inside quote" to "Quotation." This stops Odoo from auto-merging it, while it still shows up fine as a separate download on the portal page. This is a one-time settings change per product, done through a purpose-built internal tool (not clicked by hand in Odoo's UI — see below).
- **In our code:** as a safety net, if we detect that Odoo's render still starts with pages matching the brochures we expected (i.e. the product wasn't flipped yet), we now trim those pages off the front before adding our own copies at the back. If we're not 100% sure it's safe to trim (e.g. we can't read one of the brochures to confirm it), we back off and just leave the duplicate rather than risk deleting real quotation pages by mistake. That's a deliberate "when unsure, do the safe thing" choice.

So the intended end state is: no duplication needed at all, because the Odoo-side data flip removes the root cause. The trimming logic is a fallback for anything not yet flipped.

## 4. The brochure mirror (this is important, and it's the newest big change)

Originally, fetching a brochure meant our server (a Supabase "edge function") pulling it live from Odoo every time someone hit download. That worked, but it was expensive — Supabase bills for egress and invocations, and one big quotation could mean tens of megabytes moving through a metered service, every single download, even for a brochure that never changes.

So we built `scripts/mirror-brochures.mjs`: it pulls every brochure straight from Odoo and pushes it to Cloudinary (a CDN), bypassing Supabase entirely. Now, downloading a quotation fetches brochures directly from Cloudinary — fast, and free of Supabase egress. Only the quotation PDF itself still goes through Odoo (because it has to be rendered fresh — pricing can change).

**This mirror has to be kept up to date.** It's idempotent — running it again only uploads what's missing, so it's cheap to re-run — but if a new product is added in Odoo with a brochure that's never been mirrored, downloads for quotations containing that product will refuse outright with a clear message naming the missing file and telling you to re-run the mirror. That's deliberate: silently shipping a quotation with a missing brochure would be worse than refusing loudly.

We initially expected this to be a manual "run it when you add products" thing. It bit us almost immediately — three new kayak products got added, their brochures were never mirrored, and downloads broke until someone manually ran the script. So we promoted it to a scheduled GitHub Actions job that runs automatically every night (2 AM Manila time), plus it can be triggered manually anytime from the repo's Actions tab. A no-op run (nothing new to mirror) finishes in seconds.

## 5. The other pieces, briefly

- **Store letterhead swap:** Some storefronts (CDO, Tagbilaran) sell under Odoo's one shared company record ("TG Enterprise") instead of having their own. Rather than restructure Odoo, we patch the printed company name directly in the PDF bytes, client-side, based on which store account requested the download (`store<city>opc@gmail.com`). If it can't safely find the text to patch, it just leaves Odoo's original name — never breaks the download over it.
- **The internal admin tool** (`odoo-document-admin`): lets us audit and flip product brochure visibility settings in bulk via the API, instead of clicking through hundreds of products in Odoo's UI by hand. It's locked behind an extra admin token — separate from the login most of the app uses — because it can write to live Odoo product data, which is a bigger risk than just reading a quotation.
- **We do not write anything back into Odoo for the PDF itself.** Quotation download is read-only. Sending it to the customer is still a manual step a salesperson does (attach and email, or paste the share link) — we never send email on their behalf.

## 6. A related, separate cleanup: the opportunity numbering bug

While testing this, we found that internal "Opportunity No." labels (like `S07233`, assigned when someone registers a lead in our own system) used the exact same format as Odoo's own quotation numbers (`S07189`). They were drawn from overlapping number ranges. That meant someone could see `S07233` on our internal opportunity screen, go look it up in Odoo expecting to find that deal — and pull up a completely unrelated order for a different customer that happened to share the number.

This wasn't part of the quotation-PDF feature originally, but it was directly caused by confusion the quotation work surfaced, so we fixed it in the same effort: we retired our internal `opportunity_no` generator entirely (staged, not a hard delete — old historical records keep their old numbers since audit notes already reference them), and made the Odoo Sales Reference the only `S0####`-style number shown anywhere in the app going forward.

## 7. If someone asks you about this, the short version is

> "Odoo used to jam all the product brochures in front of the actual quote when you printed it, and we couldn't fix that inside Odoo because we're on their SaaS plan, which blocks custom code. So we built two ways around it: a shareable link to Odoo's own customer page (which already displays everything cleanly), and a proper reassembled PDF for when someone needs an actual file — built by fetching the pieces separately and stitching them in the right order ourselves. Brochures are now mirrored to a CDN nightly so it's fast and doesn't cost us anything extra, and if a brochure is missing from that mirror, downloads refuse loudly instead of quietly shipping something incomplete."

## 8. Open things worth knowing about

- The trimming logic (removing Odoo's front-loaded brochures) is a fallback. The real fix is flipping each product's visibility setting in Odoo — that's an ongoing cleanup, not fully done across the whole catalogue yet.
- The share link shows live pricing with no snapshot — worth mentioning to anyone asking about audit trails or "what exactly did we send the customer."
- The nightly mirror job needs GitHub repo secrets configured (Odoo + Cloudinary credentials) to run — if it's ever silently not running, that's the first thing to check.
