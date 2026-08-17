import { describe, expect, it } from "vitest"
import { brochureExtension, brochurePublicId, brochureUrl, brochureVersion } from "./brochureUrl"

/**
 * This module is the agreement between two programs that never meet: the mirror
 * script that uploads a brochure to Cloudinary, and the browser that later
 * fetches it. There is no lookup table — the URL *is* the contract. If the two
 * ever derived it differently the download path would 404 on every brochure and
 * hard-refuse, so the rules are pinned here rather than trusted.
 */
describe("brochureUrl", () => {
  const CLOUD = { cloudName: "dz83w2ck8", folder: "task-attachments" }

  it("matches the object actually confirmed to exist on Cloudinary", () => {
    // Uploaded as public_id `brochures/_selftest-0000-abcdef`; Cloudinary
    // returned `task-attachments/brochures/_selftest-0000-abcdef.pdf` and that
    // URL was verified to serve a 200. This is the regression guard for the
    // whole naming scheme.
    const url = brochureUrl(
      { id: "_selftest", checksum: "0000-abcdef", name: "selftest.pdf" },
      CLOUD,
    )
    expect(url).toBe(
      "https://res.cloudinary.com/dz83w2ck8/raw/upload/task-attachments/brochures/_selftest-0000-abcdef.pdf",
    )
  })

  it("keys on the checksum, so a revised datasheet becomes a new name", () => {
    const before = brochurePublicId({ id: 334, checksum: "aaa", name: "a.pdf" })
    const after = brochurePublicId({ id: 334, checksum: "bbb", name: "a.pdf" })

    expect(before).toBe("brochures/334-aaa.pdf")
    expect(after).not.toBe(before)
  })

  it("puts the extension in the public id rather than leaving it to Cloudinary", () => {
    // Cloudinary only appends an extension when the uploaded *filename* has
    // one, so three real documents named without a dot were stored bare while
    // the app looked for `.pdf` — a 404 that hard-refuses the whole download.
    // Supplying it in the id is used verbatim and is not doubled.
    expect(brochurePublicId({ id: 1094, checksum: "abc", name: "GD-300 Power Platform pdf" })).toBe(
      "brochures/1094-abc.pdf",
    )
  })

  it("falls back to the mimetype when the name carries no extension", () => {
    // "DELTA Gasoline Inverter Generator" is genuinely a PNG in Odoo.
    expect(brochureExtension({ name: "DELTA Gasoline Inverter", mimetype: "image/png" })).toBe("png")
    expect(brochureExtension({ name: "scan", mimetype: "image/jpeg" })).toBe("jpg")
  })

  it("does not mistake a version number for an extension", () => {
    // "Spec v1.2" must not be read as having the extension "2".
    expect(brochureExtension({ name: "Spec v1.2" })).toBe("pdf")
  })

  it("falls back to write_date, with the characters a public id cannot carry removed", () => {
    // Odoo hands back "2024-01-01 10:00:00" — a space and colons, none of which
    // survive in a Cloudinary public id.
    expect(brochureVersion({ write_date: "2024-01-01 10:00:00" })).toBe("2024-01-01-10-00-00")
    expect(brochureVersion({})).toBe("unversioned")
  })

  it("prefers the checksum when Odoo supplies both", () => {
    expect(brochureVersion({ checksum: "abc", write_date: "2024-01-01 10:00:00" })).toBe("abc")
  })

  it("carries the real extension rather than assuming PDF", () => {
    // A non-PDF attachment has to resolve and be fetched so it can fail to
    // merge as an ordinary skipped-brochure warning. Guessing .pdf would 404
    // instead and block the entire download.
    expect(brochureExtension({ name: "datasheet.docx" })).toBe("docx")
    expect(brochureExtension({ name: "SHOUTING.PDF" })).toBe("pdf")
    expect(brochureExtension({})).toBe("pdf")
  })

  it("defaults to pdf for the real documents named without one", () => {
    // Odoo genuinely contains "GD-300 Power Platform pdf" — the word, no dot.
    // The mirror script has to synthesise the upload filename from this rather
    // than pass Odoo's name through, or Cloudinary stores the file with no
    // extension while this computes one, and every order containing it 404s.
    expect(brochureExtension({ name: "GD-300 Power Platform pdf" })).toBe("pdf")
    expect(brochureExtension({ name: "Zoll AED Plus list of Specs" })).toBe("pdf")
  })

  it("survives the punctuation real brochure names are full of", () => {
    const url = brochureUrl(
      { id: 334, checksum: "a1b2c3", name: "(C5-001) PROTEGER- HEAVY DUTY TOOL BOX.pdf" },
      CLOUD,
    )
    // Nothing from the name reaches the id — only its extension.
    expect(url).toContain("/brochures/334-a1b2c3.pdf")
    expect(url).not.toContain(" ")
  })

  it("handles a preset with no folder, and a folder written with stray slashes", () => {
    const doc = { id: 1, checksum: "z", name: "a.pdf" }

    expect(brochureUrl(doc, { cloudName: "c" })).toBe(
      "https://res.cloudinary.com/c/raw/upload/brochures/1-z.pdf",
    )
    expect(brochureUrl(doc, { cloudName: "c", folder: "/nested/dir/" })).toBe(
      "https://res.cloudinary.com/c/raw/upload/nested/dir/brochures/1-z.pdf",
    )
  })

  it("omits the version segment Cloudinary returns", () => {
    // Version-less delivery URLs resolve, and leaving the version out is what
    // lets the browser build the URL from the manifest alone — no upload
    // response to store, no mapping table, no migration.
    expect(brochureUrl({ id: 1, checksum: "z", name: "a.pdf" }, CLOUD)).not.toMatch(/\/v\d+\//)
  })
})
