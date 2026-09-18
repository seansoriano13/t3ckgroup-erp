/**
 * Keyboard model for the Release Notes deck.
 *
 * The deck is driven from a keyboard while someone talks over it, so the
 * rules are deliberately dull: left and right walk the whole deck end to end,
 * up and down jump between sections, and nothing wraps around. Wrapping would
 * put you back at slide one mid-sentence with no way to tell.
 */

export const SECTIONS = [
  { key: "headline", label: "What shipped" },
  { key: "underTheHood", label: "Under the hood" },
  { key: "roadmap", label: "What's left" },
  { key: "prototypes", label: "Coming next" },
]

/** First section at or beyond `from` (walking in `dir`) that renders anything. */
function nextNonEmpty(sizes, from, dir) {
  for (let s = from; s >= 0 && s < sizes.length; s += dir) {
    if (sizes[s] > 0) return s
  }
  return -1
}

export function navigate(pos, key, sizes) {
  const { section, item } = pos

  if (key === "ArrowRight") {
    if (item + 1 < sizes[section]) return { section, item: item + 1 }
    const s = nextNonEmpty(sizes, section + 1, 1)
    return s === -1 ? pos : { section: s, item: 0 }
  }

  if (key === "ArrowLeft") {
    if (item - 1 >= 0) return { section, item: item - 1 }
    const s = nextNonEmpty(sizes, section - 1, -1)
    // Backwards into a section means its end, so the deck reads continuously.
    return s === -1 ? pos : { section: s, item: sizes[s] - 1 }
  }

  if (key === "ArrowDown") {
    const s = nextNonEmpty(sizes, section + 1, 1)
    return s === -1 ? pos : { section: s, item: 0 }
  }

  if (key === "ArrowUp") {
    const s = nextNonEmpty(sizes, section - 1, -1)
    return s === -1 ? pos : { section: s, item: 0 }
  }

  return pos
}

export function sectionSizes(data) {
  return [
    data.headline?.length ?? 0,
    // Under the hood is one card however many fixes it lists — it is counted,
    // not walked through. No card at all if nothing was generated for it.
    data.underTheHood?.items?.length ? 1 : 0,
    data.roadmap?.phases?.length ?? 0,
    data.prototypes?.length ?? 0,
  ]
}

export function positionLabel(pos, sizes) {
  return `${pos.item + 1} / ${sizes[pos.section]} · ${SECTIONS[pos.section].label}`
}
