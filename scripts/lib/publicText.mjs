// Pure helpers for scripts/public-text-hook.mjs: does a shell command post
// text to GitHub, which files feed that text, and what in it is private.

/** Text holding this marker is let through: every flagged item is made up, or Sean said it may be public. */
export const ALLOW_MARKER = "<!-- public-ok -->"

const GITHUB_WRITE = [
  /\bgh\s+(?:issue|pr)\s+(?:create|edit|comment|review|close|reopen|merge)\b/,
  /\bgh\s+(?:release|gist)\s+(?:create|edit)\b/,
  /\bgh\s+api\b[^\n]*\b(?:issues|pulls|comments|releases|gists)\b/,
]

/** True when the text runs a gh command that can put words on GitHub. */
export function postsToGithub(text) {
  return GITHUB_WRITE.some((re) => re.test(text))
}

const MONEY = [
  /[€₱£¥]\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?[KkMm]\b)?/g, // €1,600  ₱10.39M
  /\b(?:PHP|Php|EUR|USD)\s?\d(?:[\d,]*\d)?(?:\.\d+)?/g, // PHP 25,000
  /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, // $1,250 (not a shell's $1)
  /\$\d+\.\d{2}\b/g, // $12.50
  /\b\d{1,3}(?:,\d{3})+\.\d{2}\b/g, // 72,723.10 with no symbol
]

/** Lines of .claude/private-terms.txt: one name per line, # starts a comment. */
export function parseTerms(fileText) {
  return fileText
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
}

/** Money amounts and listed names found in the text, each once. */
export function findPrivate(text, terms = []) {
  const found = new Map()
  const amounts = new Set(MONEY.flatMap((re) => [...text.matchAll(re)].map((m) => m[0].trim())))
  for (const value of amounts) {
    // "72,723.10" inside "€72,723.10" is the same amount
    if (![...amounts].some((other) => other !== value && other.includes(value))) {
      found.set(`money:${value}`, { kind: "money amount", value })
    }
  }
  for (const term of terms) {
    const body = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    const m = text.match(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu"))
    if (m) found.set(`name:${term.toLowerCase()}`, { kind: "name", value: m[0] })
  }
  return [...found.values()]
}

/** Shell words, quotes removed. Good enough to find paths; not a full shell parser. */
export function shellWords(text) {
  const words = []
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|<>()"'`]+)/g)) {
    words.push(m[1] ?? m[2] ?? m[3])
  }
  return words
}

const FILE_FLAGS = new Set(["--body-file", "--notes-file", "--input", "-F"])
const TEXT_FILE = /\.(?:md|markdown|txt|out)$/i

/** Paths that may hold the posted text: --body-file and friends, field=@file, and any .md/.txt/.out word. */
export function fileRefs(text) {
  const refs = new Set()
  const words = shellWords(text)
  for (let i = 0; i < words.length; i++) {
    let word = words[i]
    if (word.endsWith("=") && FILE_FLAGS.has(word.slice(0, -1)) && words[i + 1]) {
      refs.add(words[++i]) // --body-file="x" splits into `--body-file=` and `x`
      continue
    }
    const eq = word.match(/^(--[a-z-]+)=(.+)$/)
    if (eq && FILE_FLAGS.has(eq[1])) {
      refs.add(eq[2])
      continue
    }
    if (FILE_FLAGS.has(word) && words[i + 1]) {
      const next = words[i + 1]
      const at = next.match(/^[\w.-]+=@(.+)$/)
      if (at) refs.add(at[1])
      else if (!next.includes("=")) refs.add(next)
      i++
      continue
    }
    const at = word.match(/^(?:[\w.-]+=)?@(.+)$/)
    if (at) word = at[1]
    if (TEXT_FILE.test(word)) refs.add(word)
  }
  return [...refs]
}

/** Folders the command moves into with cd. */
export function cdTargets(text) {
  const words = shellWords(text)
  return words.flatMap((word, i) => (word === "cd" && words[i + 1] ? [words[i + 1]] : []))
}

/** Shell scripts the command runs with bash or sh. */
export function scriptPaths(text) {
  const words = shellWords(text)
  return words.flatMap((word, i) =>
    (word === "bash" || word === "sh") && words[i + 1]?.endsWith(".sh") ? [words[i + 1]] : [],
  )
}
