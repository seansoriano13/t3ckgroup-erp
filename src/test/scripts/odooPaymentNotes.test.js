import { describe, it, expect } from "vitest"
import {
  isPaymentNote,
  salesReferenceFrom,
  extractProofImages,
  PROOF_LOG_MARKER,
  pickExactSor,
} from "../../../supabase/functions/odoo-sor-sync/payment.ts"

// The Odoo sync attaches proof of payment to the SOR named by the order
// number, exactly. These rules are what keep it from ever closing or touching
// the wrong deal (issue #324).

describe("isPaymentNote", () => {
  it("recognises a note with a mode of payment and an amount", () => {
    expect(isPaymentNote("MODE OF PAYMENT: GCash\nAMOUNT: 12,500.00")).toBe(true)
    expect(isPaymentNote("mode of payment: bank\namount 900")).toBe(true) // case and the colon do not matter
    expect(isPaymentNote("Mode of payment: bank\nAmount: 900")).toBe(true)
  })

  it("ignores notes missing either part", () => {
    expect(isPaymentNote("MODE OF PAYMENT: GCash")).toBe(false)
    expect(isPaymentNote("AMOUNT: 500")).toBe(false)
    expect(isPaymentNote("Called the customer about delivery")).toBe(false)
  })
})

describe("salesReferenceFrom", () => {
  it("accepts a plain sales reference and trims it", () => {
    expect(salesReferenceFrom("S00123")).toBe("S00123")
    expect(salesReferenceFrom("  S00123 ")).toBe("S00123")
  })

  it("refuses anything that is not exactly S plus digits, so no fuzzy match can start", () => {
    for (const bad of ["", "  ", "S", "S12A", "s123", "Trading Corp", "S123 extra", "%S123%", null, undefined, 42]) {
      expect(salesReferenceFrom(bad)).toBeNull()
    }
  })
})

describe("extractProofImages", () => {
  const ODOO = "https://example.odoo.com"

  it("turns each image in the note into a proof attachment", () => {
    const html = '<p>Paid</p><img src="https://cdn.example.com/a.png"><img class="x" src=\'https://cdn.example.com/b.png\' alt="">'
    const found = extractProofImages(html, ODOO)
    expect(found.map((f) => f.url)).toEqual(["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"])
    expect(found[0]).toMatchObject({ name: "Proof_of_Payment.png", type: "image/png" })
  })

  it("resolves Odoo's site-relative image paths against the Odoo address", () => {
    expect(extractProofImages('<img src="/web/image/123">', ODOO + "/")[0].url).toBe("https://example.odoo.com/web/image/123")
  })

  it("drops anything that is not an http(s) address", () => {
    const html = '<img src="javascript:alert(1)"><img src="data:image/png;base64,AAAA"><img src="ftp://x/y.png">'
    expect(extractProofImages(html, ODOO)).toEqual([])
  })

  it("returns nothing for a note with no images", () => {
    expect(extractProofImages("<p>MODE OF PAYMENT: cash</p>", ODOO)).toEqual([])
  })
})

describe("the log marker", () => {
  it("is the wording of the log entry people see", () => {
    expect(PROOF_LOG_MARKER).toBe("Proof of Payment imported")
  })
})

describe("pickExactSor", () => {
  it("takes the one live SOR carrying the reference", () => {
    expect(pickExactSor([{ id: "a", is_deleted: false }])).toBe("a")
  })

  it("ignores a deleted SOR", () => {
    expect(pickExactSor([{ id: "a", is_deleted: true }, { id: "b", is_deleted: false }])).toBe("b")
    expect(pickExactSor([{ id: "a", is_deleted: true }])).toBeNull()
  })

  it("picks nobody when two live SORs share the reference", () => {
    expect(pickExactSor([{ id: "a", is_deleted: false }, { id: "b", is_deleted: false }])).toBeNull()
  })

  it("picks nobody when nothing matched", () => {
    expect(pickExactSor([])).toBeNull()
    expect(pickExactSor(null)).toBeNull()
  })
})
