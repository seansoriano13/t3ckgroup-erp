/**
 * Builds the single file the Release Notes deck reads.
 *
 * Everything the surface renders is baked here at build time — no Supabase
 * call, no GitHub call at runtime (ADR 0022). The inputs are the published
 * changelog, a hand-authored supplement covering what the changelog never
 * recorded, and a snapshot of the still-open issues.
 */

// CONTEXT.md defines the SOR and lists "Deal" under _Avoid_. Two glossary
// terms legitimately contain the word, so they are alternatives in the same
// pattern and are matched first — a protected phrase wins over the bare noun,
// and the replacer hands it back untouched. Matching in one pass avoids
// substituting sentinels into the text and having to substitute them out.
//
// The article alternative carries a lookahead because it starts matching one
// character earlier than the protected phrases do: at "a Deal Team" the
// engine reaches the article rule while still left of "Deal Team", and
// without the guard rewrites the whole thing to "an SOR Team" — destroying
// the term the earlier alternatives exist to protect.
const PROTECTED_TAIL = String.raw`(?!\s+(?:team|owner)\b)`
const VOCABULARY = new RegExp(
  String.raw`\bDeal Team\b|\bdeal owner\b|\b(a|A)\s+deal\b${PROTECTED_TAIL}|\bdeals\b|\bdeal\b`,
  "gi",
)

/**
 * Rewrites "deal" to "SOR" in copy we render but do not own.
 *
 * Published changelog entries are left alone on disk — employees have already
 * read them — so the correction happens on the way out.
 */
export function enforceSorVocabulary(text) {
  if (typeof text !== "string") return text

  return text.replace(VOCABULARY, (match, article) => {
    const lower = match.toLowerCase()
    if (lower === "deal team") return "Deal Team"
    if (lower === "deal owner") return "Deal Owner"
    // "a deal" becomes "an SOR", so the article moves with the noun.
    if (article) return article === "A" ? "An SOR" : "an SOR"
    if (lower === "deals") return "SORs"
    return "SOR"
  })
}

/** Changelog entries dated on or after `since`, newest first as stored. */
export function entriesSince(changelog, since) {
  return changelog.filter((entry) => entry.date >= since)
}

/**
 * Turns a flat list of still-open issues into phases of epics.
 *
 * An epic's fraction is derived, never stored: `done` is its ticket count
 * minus the tickets still outstanding. A ticket closed since the last
 * generation simply stops appearing in the snapshot and the fraction moves.
 */
export function buildRoadmap(openIssues, epics) {
  const openNumbers = new Set(openIssues.map((issue) => issue.number))
  const titles = new Map(openIssues.map((issue) => [issue.number, issue.title]))

  const known = new Set()
  const phaseOrder = []
  const byPhase = new Map()

  for (const epic of epics) {
    known.add(epic.number)
    epic.tickets.forEach((number) => known.add(number))

    // Work can ship without its issue closing — a commit that references the
    // parent epic rather than the ticket leaves the ticket open. `shipped`
    // names those, so the fraction reports what was built rather than what
    // GitHub happens to know.
    const shipped = new Set(epic.shipped ?? [])
    const outstanding = epic.tickets.filter(
      (number) => openNumbers.has(number) && !shipped.has(number),
    )

    const built = {
      number: epic.number,
      title: enforceSorVocabulary(epic.title),
      unlocks: enforceSorVocabulary(epic.unlocks),
      total: epic.tickets.length,
      done: epic.tickets.length - outstanding.length,
      open: outstanding,
      tickets: epic.tickets.map((number) => ({
        number,
        // GitHub's own issue titles are copy we render but do not own, so
        // they go through the same correction as everything else.
        title: enforceSorVocabulary(titles.get(number) ?? null),
        open: openNumbers.has(number),
        shipped: shipped.has(number) && openNumbers.has(number),
      })),
    }

    if (!byPhase.has(epic.phase)) {
      phaseOrder.push(epic.phase)
      byPhase.set(epic.phase, [])
    }
    byPhase.get(epic.phase).push(built)
  }

  const phases = phaseOrder.map((name) => ({ name, epics: byPhase.get(name) }))

  return {
    phases,
    epicCount: epics.length,
    ticketCount: epics.reduce((sum, epic) => sum + epic.tickets.length, 0),
    // Only issues the roadmap actually accounts for, so an unrelated open
    // ticket cannot quietly inflate the figure on the screen. This includes
    // the epic parents; `openTicketCount` is the tickets alone, which is what
    // a "N tickets open" figure must use or it exceeds `ticketCount`.
    openCount: openIssues.filter((issue) => known.has(issue.number)).length,
    openTicketCount: phases.reduce(
      (sum, phase) => sum + phase.epics.reduce((n, epic) => n + epic.open.length, 0),
      0,
    ),
    unassigned: openIssues
      .filter((issue) => !known.has(issue.number))
      .map((issue) => issue.number),
  }
}

function resolveChanges(row, windowed) {
  if (row.version) {
    const entry = windowed.find((e) => e.version === row.version)
    if (!entry) {
      throw new Error(
        `Headline row "${row.id}" names version ${row.version}, which is not in the changelog window`,
      )
    }
    return entry.changes
  }

  if (Array.isArray(row.changes) && row.changes.length > 0) return row.changes

  throw new Error(
    `Headline row "${row.id}" has neither a changelog version nor its own changes`,
  )
}

export function buildPresentation({ changelog, supplement, issues, generatedAt }) {
  const since = supplement.since
  const windowed = entriesSince(changelog, since)

  const headline = supplement.headline.map((row) => {
    // Every row shows the real component it is about (or the modal that opens
    // from a button). A row without one is a row that only claims a change.
    if (!row.sample) {
      throw new Error(`Headline row "${row.id}" names no sample component`)
    }
    return row
  }).map((row) => ({
    id: row.id,
    block: row.block,
    title: enforceSorVocabulary(row.title),
    impact: enforceSorVocabulary(row.impact),
    changes: resolveChanges(row, windowed).map(enforceSorVocabulary),
    issues: row.issues ?? [],
    sample: row.sample,
    source: row.version ? "changelog" : "supplement",
  }))

  const underTheHood = {
    summary: enforceSorVocabulary(supplement.underTheHood.summary),
    items: supplement.underTheHood.items.map((item) => {
      // A fix gets a slide of its own, and a slide shows what changed.
      if (!item.sample) throw new Error(`Under-the-hood fix "${item.title}" names no sample component`)
      return {
        title: enforceSorVocabulary(item.title),
        issues: item.issues ?? [],
        sample: item.sample,
      }
    }),
  }

  return {
    generatedAt,
    since,
    // The builder returns a complete object: the title used to be assigned by
    // the caller after the fact, which made `--check`'s comparison depend on
    // that assignment happening first.
    title: enforceSorVocabulary(supplement.title ?? "What shipped"),
    headline,
    underTheHood,
    roadmap: buildRoadmap(issues, supplement.epics),
    prototypes: (supplement.prototypes ?? []).map((p) => ({
      ...p,
      title: enforceSorVocabulary(p.title),
      note: enforceSorVocabulary(p.note),
    })),
  }
}
