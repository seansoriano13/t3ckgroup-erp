# Getting brochures off Supabase egress

> **Status: done — all four steps shipped.** Kept for the measurements and the
> reasoning, which are still the argument for why the path looks like this.
> Read it as a record, not a to-do: the work below in future tense is built.
>
> | Step | Where it lives now |
> | --- | --- |
> | A — mirror script | `scripts/mirror-brochures.mjs`, plus nightly `.github/workflows/mirror-brochures.yml` |
> | B — Cloudinary reads | `src/services/quotationService.js`; the URL formula is `src/lib/brochureUrl.js`, imported by both the script and the browser |
> | C — `kind: "document"` deleted | `supabase/functions/odoo-quotation-file/index.ts` now answers it `410` so a stale bundle fails loudly |
> | D — the 46-document flip | rollback response kept at `scripts/flip-rollback-quotation-46.json` |
>
> One deviation from decision 3: the URL gained an **extension** segment, because
> Odoo holds brochures named with no extension at all (and at least one PNG). See
> the comments in `src/lib/brochureUrl.js`.
>
> For the current-tense version of this feature, read
> [quotation-feature-explainer.md](./quotation-feature-explainer.md).

## Why

Supabase is metered and the grace period is over. One cold download of S07813
costs **~125 MB of Supabase egress**. The Aug 14 spike — 121 edge function
invocations, ~250 MB — was about two of them.

The cost is not where it looks. The brochures cross Supabase **twice** per
download, and one crossing is invisible:

| Trip | What | Size |
|---|---|---|
| 1 (hidden) | Odoo bakes all 46 `'inside'` brochures into the quotation render | ~63 MB |
| 2 (visible) | the browser fetches those same brochures to reorder them | ~63 MB |

Trip 1 doesn't look like brochure traffic — it looks like "fetching a
quotation." It is 99% brochures wearing a quotation's name tag.

### Measured, from the live Odoo audit

**S07813** — 141 products, 107 documents (223.7 MB) across those products:

| `attached_on` | Docs | Size |
|---|---|---|
| `'inside'` (merged into the quotation) | **46** | **62.7 MB** |
| `(not set)` (never merged, invisible today) | 61 | 161.1 MB |

**Catalogue-wide:** `'inside'` **998**, `'quotation'` 5, `(not set)` 611.

Note the 161 MB at `(not set)`: one setting away from tripling this order's
download. The lever exists and is pointed at your foot.

### Target

| | Trip 1 | Trip 2 | Supabase total |
|---|---|---|---|
| Today | ~63 MB | ~63 MB | **~125 MB** |
| Mirror only | ~63 MB | 0 | ~63 MB |
| Flip only | ~0.5 MB | ~63 MB | ~63 MB |
| **Both** | ~0.5 MB | 0 | **~0.5 MB** |

Neither half works alone. **Mirroring removes the copy you can see; the flip
removes the copy you can't.**

## Decisions

| # | Decision |
|---|---|
| 1 | The download must produce a real local file. The Odoo portal link is not a substitute — salespeople attach the PDF to mail by hand |
| 2 | Brochures move off Supabase to Cloudinary, following the `storageService` precedent |
| 3 | Deterministic naming. **No mapping table, no migration, no schema change** |
| 4 | Dedicated Cloudinary upload preset, so a future chatbox tweak can't break brochures |
| 5 | Population by a **local script**, Odoo → Cloudinary direct. **Zero Supabase bytes** |
| 6 | **No silent fallback.** A missing brochure hard-refuses the download and names the documents |
| 7 | Mirror scope: whole catalogue (~1003 docs, ~1.4 GB) |
| 8 | Flip scope: S07813's **46** documents now; the other 998 after a clean month |
| 9 | Odoo API key in a git-ignored local file |
| 10 | Recurrence: **manual + idempotent**. Promote to GitHub Actions only if it bites twice |

### Verified against live Cloudinary before committing to any of it

- `public_id` survives, transformed **deterministically**: preset folder prefix
  plus `.pdf`. **No random suffix.**
- PDF delivery works — 200, `application/pdf`, byte-exact round trip.
- **Version-less URLs resolve**, so the client needs no version tracking.
- Re-uploading the same id is **idempotent** — the two-devices-at-once race is
  harmless.
- A miss is a clean **404 with 0 bytes**, which makes hard-refuse nearly free.

Giving the URL formula:

```
https://res.cloudinary.com/<cloud>/raw/upload/<presetFolder>/brochures/<docId>-<checksum>.pdf
```

`docId` and `checksum` both already ship in the manifest, so nothing new needs
storing. The checksum makes it self-invalidating: a revised datasheet is simply
a different name.

## Work

### A. `scripts/mirror-brochures.mjs` — new, runs locally, never deployed

Reads Odoo over JSON-RPC directly (Node has no CORS restriction, which is the
*only* reason the edge function proxy exists) and pushes to Cloudinary.
**Supabase is not in this path.**

```
list product.document where attached_on in ('inside','quotation')
  → for each: HEAD https://res.cloudinary.com/.../<docId>-<checksum>.pdf
      200 → skip
      404 → read `datas` from Odoo, POST to Cloudinary with that public_id
  → report: mirrored / skipped / failed, with totals
```

Idempotent by construction, so first run is ~1003 uploads and every run after is
a seconds-long no-op. That is what makes decision 10 safe.

Credentials from a git-ignored `.env.mirror`: `ODOO_URL`, `ODOO_DB`,
`ODOO_USERNAME`, `ODOO_API_KEY` (copy from the Supabase function secrets, where
they currently live only), plus the Cloudinary cloud name and the new preset.
**Add `.env.mirror` to `.gitignore` in the same commit that adds the script.**

Reuse the existing RPC shapes from
[supabase/functions/_shared/odoo.ts](../supabase/functions/_shared/odoo.ts) —
`authenticate`, `executeKw` — rather than reinventing them.

### B. `quotationService` reads brochures from Cloudinary

Replace `fetchDocumentBytes`'s proxy call with a Cloudinary GET built from the
formula above. On 404: **do not fall back to Supabase.** Collect the document
into a refusal list.

If any brochure is missing, `buildQuotationPdf` **throws** rather than returning
a partial PDF, naming the documents and their ids so re-running the mirror is
copy-paste. A quotation silently missing datasheets could reach a customer;
blocking is recoverable, that isn't.

Keep the existing Cache API layer. It now protects the *Cloudinary* meter
instead of the Supabase one, which is still worth having.

The quotation render itself keeps its current path and its `AbortSignal`
deadline — that request is unavoidable, and after the flip it's small.

### C. Delete `kind: "document"` from `odoo-quotation-file`

Once brochures come from Cloudinary that path is dead code, and leaving it alive
means one future refactor can quietly reintroduce the whole problem. Deleting it
makes the guarantee **structural rather than a matter of discipline**. Requires
redeploying that one function.

### D. Flip S07813's 46 documents

`setVisibility` on `odoo-document-admin`, `'inside'` → `'quotation'`.
`ODOO_ADMIN_TOKEN` is confirmed configured. No Odoo UI involved.

**Keep the response.** It carries each document's previous value and is the only
exact rollback.

## Order

1. **A** — mirror the catalogue. Nothing else changes; nothing can break.
2. **Verify** — spot-check ~10 URLs resolve, including the largest brochure.
3. **B + C** — ship. Brochures now come from Cloudinary. This is the step that
   hard-refuses, so it must not precede a complete mirror.
4. **D** — flip. The render collapses and downloads drop to ~0.5 MB.

Steps 3 and 4 are independently safe in either order; only step 1 is a hard
prerequisite. There is no window in which downloads are broken.

## Rollback

| Step | How |
|---|---|
| A | Nothing to undo — unreferenced Cloudinary objects |
| B, C | `git revert`; the proxy path returns |
| D | Replay the `rollback` array from the `setVisibility` response |

## Backlog

- **A guarded Supabase fallback.** Deliberately omitted: a silent fallback would
  mean a misconfigured Cloudinary quietly bleeds egress and you'd find out from
  the billing page. Revisit only with loud reporting attached.
- ~~**Scheduled mirror** (GitHub Actions) if manual runs start biting.~~ Done —
  they bit. Three new kayak products shipped unmirrored and broke every
  quotation containing one. `.github/workflows/mirror-brochures.yml` runs
  nightly at 02:00 Manila and on demand; a no-op when nothing changed.
- **The duplicate Dinglee catalogue** — two `product.document` records hold the
  same 4.5 MB file under different names, so every download of S07813 ships it
  twice and the customer receives it twice. The dedupe in the manifest only
  catches identical ids. Fixable via `setVisibility` with `attachedOn: false` —
  non-destructive, same rollback. Deferred by choice.
- **The 611 `(not set)` documents.** Harmless today; flipping any to
  `'inside'`/`'quotation'` would add them to downloads.

## Verification

After step 1, per-brochure spot check; after step 3, download S07813 and confirm
in the Network panel that **no `odoo-quotation-file` document calls occur at
all** — brochure traffic should be entirely `res.cloudinary.com`.

After step 4, the remaining `odoo-quotation-file` quotation call should return
roughly half a megabyte instead of 63, and return in seconds rather than
minutes: Odoo no longer merges 46 PDFs on every request. The abort/retry fix
already shipped becomes a safety net rather than load-bearing.

End state: **~125 MB → ~0.5 MB per cold download**, and the Supabase egress
graph should go flat.
