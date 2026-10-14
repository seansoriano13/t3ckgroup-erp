import { describe, expect, it } from "vitest"
import { buildIpasDocument, buildIpasPagesHtml } from "./ipasDocument"
import { buildIpasViewModel } from "./ipasViewModel"
import { BAUTISTA, RAMOS, makePrintableIpas, signoffRow } from "@/test/ipasPrint"

/**
 * The printed IPAS's HTML (#250): two A4 portrait pages in the module's own
 * section order, every string escaped, and the marks the ticket names on the
 * paper itself.
 */

const doc = (ipasOptions, printOptions, tweak) => {
  const vm = buildIpasViewModel(makePrintableIpas(ipasOptions), printOptions)
  if (tweak) tweak(vm)
  return buildIpasDocument(vm)
}

const FILED = { state: "filed", filed_at: "2026-09-16T02:00:00.000Z" }

const IMAGE = "data:image/png;base64,iVBORw0KGgo="

describe("Sales & Operation's ticks", () => {
  it("prints Googlesheet and Gantt Chart as boxes, ticked or empty", () => {
    const html = buildIpasDocument(buildIpasViewModel(makePrintableIpas({ row: { google_sheet: true } })))

    expect(html).toContain('<span class="k">Googlesheet</span><span class="v"><span class="chk done"')
    expect(html).toContain('<span class="k">Gantt Chart</span><span class="v"><span class="chk" aria-label="not ticked"')
  })
})

describe("the two A4 pages", () => {
  it("is two portrait A4 sheets, the first breaking before the second", () => {
    const html = doc()

    expect(html).toMatch(/@page\s*{\s*size:\s*A4 portrait;\s*margin:\s*0/)
    expect(html.match(/<div class="sheet/g)).toHaveLength(2)
    expect(html.match(/<div class="sheet first">/g)).toHaveLength(1)
    expect(html).toMatch(/\.sheet\.first\s*{[^}]*break-after:\s*page/)
    expect(html).toContain("page 1 of 2")
    expect(html).toContain("page 2 of 2")
  })

  it("puts the voucher on page 1 and the seven numbered sections on page 2, in the module's own order", () => {
    const html = doc()
    const page2 = html.indexOf("page 2 of 2")
    const voucher = ["How the Landed Cost is built", "Date created", "Created by", "Outcome", "Sign-offs"].map((label) => html.indexOf(label))
    const sections = [
      "<h3><span>1 · Purchasing",
      "<h3><span>2 · Purchasing &amp; Finance",
      "<h3><span>3 · Computation status &amp; Landed Cost",
      "<h3><span>4 · Filing",
      "<h3><span>5 · Sales &amp; Operation",
      "<h3><span>6 · Logistics",
      "<h3><span>7 · Status",
    ].map((label) => html.indexOf(label))

    expect(voucher.every((at) => at > -1 && at < page2)).toBe(true)
    expect(sections.every((at) => at > page2)).toBe(true)
    expect(sections).toEqual([...sections].sort((a, b) => a - b))
  })

  it("numbers the sections 1 to 7 with none skipped or repeated, and says what each page holds", () => {
    const html = doc()
    const numbers = [...html.matchAll(/<h3><span>(\d) · /g)].map((match) => Number(match[1]))

    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(html).toContain("Summary and sign-offs")
    expect(html).toContain("Sections 1 · Purchasing to 7 · Status")
  })

  it("builds the Landed Cost on page 1 from the same totals the calculation adds", () => {
    const html = doc()
    const page1 = html.slice(0, html.indexOf("page 2 of 2"))

    for (const text of ["Goods", "Shipping fees", "Bank charge fees", "Brokerage Fee", "Duties &amp; Taxes", "PHP 93,573.68"]) {
      expect(page1).toContain(text)
    }
    expect(page1).toContain("PHP 46,786.84 per unit")
  })

  it("has no Transmittals list", () => {
    const html = doc()

    expect(html).not.toMatch(/transmittal/i)
  })

  it("prints every field the ticket lists for the header and section 1", () => {
    const html = doc()

    for (const text of ["Priority", "Source", "Purpose", "Date created", "Created by", "Redleaf Medical Supplies", "P02445", "PI-RL-2026-118", "Ambulance Folding Stretcher", "PHP debited", "Charge fee", "Proof"]) {
      expect(html).toContain(text)
    }
  })

  it("marks the filing copy on both pages and in the window title", () => {
    const ordinary = doc()
    const filing = doc({ row: FILED }, { filingCopy: true })

    expect(ordinary).not.toContain("Filing copy")
    expect(filing.match(/copy-mark">Filing copy/g)).toHaveLength(2)
    expect(filing).toContain("<title>TGIPAS_050 · P02445 · filing copy</title>")
  })
})

describe("signatures", () => {
  it("draws a stored signature as the image, a name-only signer as the name, and a waiting box as 'Signature required'", () => {
    const html = doc(
      {
        signoffs: [
          signoffRow(1, "prepared", BAUTISTA),
          signoffRow(1, "approved", RAMOS, { signature_version: null }),
        ],
      },
      {},
      (vm) => {
        vm.section1.signoffs[0].signatureBase64 = IMAGE
      },
    )

    // Stored: the image on the plate and the e-signed stamp.
    expect(html).toContain(`<img src="${IMAGE}" />`)
    expect(html).toMatch(/e-signed Sep 12, 2026 14:05/)
    // Name only: printed in the plate in the printed-name style, no image.
    expect(html).toContain('<div class="printed-name">M. Ramos</div>')
    expect(html).toMatch(/name only, no signature on file/)
    // Waiting: section 3's two boxes and Filing's four, each printed once, on page 1.
    expect(html.match(/<div class="pending">Signature required<\/div>/g)).toHaveLength(6)
    expect(html.match(/<div class="sig awaiting">/g)).toHaveLength(6)
  })

  it("prints a declined signature as the name only, never the image", () => {
    const html = doc(
      { signoffs: [signoffRow(1, "prepared", BAUTISTA, { signature_declined: true, signature_version: null })] },
      {},
      (vm) => {
        // Even a stray image can't appear: the box has no path to load.
        expect(vm.section1.signoffs[0].signaturePath).toBeNull()
      },
    )

    expect(html).not.toContain("<img")
    expect(html).toContain('<div class="printed-name">J. Bautista</div>')
    expect(html).toMatch(/signature not applied/)
  })

  it("leaves a name that carries markup inert", () => {
    const html = doc({
      signoffs: [signoffRow(1, "prepared", { id: "emp-x", name: '<img src=x onerror="alert(1)">' })],
    })

    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
  })
})

describe("marks and the legend", () => {
  it("carries the Odoo mark on stamped statuses, the legend '● stamped from Odoo' and the read time in the footer", () => {
    const html = doc()

    expect(html).toContain("● stamped from Odoo")
    expect(html.match(/class="odoo" title="stamped from Odoo">●/g)).toHaveLength(3)
    expect(html.match(/Odoo copy read Sep 15, 2026 09:12/g)).toHaveLength(2)
  })

  it("prints Landed Cost provisional before Costs complete and final after", () => {
    const provisional = doc({ row: { computation_status: "encoded" } })
    const final = doc({ row: { computation_status: "lc_odoo_done" } })
    const filed = doc({ row: { state: "filed", filed_at: "2026-09-20T02:00:00.000Z", computation_status: "encoding" } })

    expect(provisional).toContain('<span class="prov ">Provisional</span>')
    expect(provisional).toContain("Landed Cost provisional")
    expect(final).toContain('<span class="prov final">Final</span>')
    expect(filed).toContain('<span class="prov final">Final</span>')
    expect(filed).toContain("Filed Sep 20, 2026")
    expect(filed).toContain("frozen at filing")
  })

  it("prints Landed Cost per unit and in total", () => {
    const html = doc()

    expect(html).toContain("Landed cost per unit")
    expect(html).toContain("PHP 46,786.84")
    expect(html).toContain("PHP 93,573.68")
  })

  it("says Landed Cost isn't available when there's nothing to take a rate from", () => {
    const html = doc({ extras: { payments: [] } })

    expect(html).toContain('<span class="prov na">Not available</span>')
    expect(html).not.toContain("Landed cost per unit")
  })
})

describe("account numbers and bank details", () => {
  it("prints the masked number on an ordinary print and the whole number only on the filing copy", () => {
    const ordinary = doc()
    const filing = doc({ row: FILED }, { filingCopy: true })

    expect(ordinary).toContain("•••• 4417")
    expect(ordinary).not.toContain("0012 3456 7890 4417")
    expect(filing).toContain("0012 3456 7890 4417")
    expect(filing).not.toContain("•••• 4417")
  })

  it("prints no bank block at all for someone who can't read bank details, filing copy included", () => {
    for (const filingCopy of [false, true]) {
      const html = doc({ canReadBankDetails: false, row: FILED }, { filingCopy })

      expect(html).not.toContain("Account #")
      expect(html).not.toContain("BDO Unibank")
      expect(html).not.toContain("4417")
    }
  })

  it("says plainly that none were typed, for a reader with nothing on file", () => {
    expect(doc({ bank: null })).toContain("No bank details typed.")
  })
})

describe("escaping", () => {
  const hostile = '<script>alert("x")</script> & "quoted"'

  it("escapes text from Odoo and from people everywhere it prints", () => {
    const base = makePrintableIpas()
    const ipas = {
      ...base,
      supplier: hostile,
      contact: hostile,
      piNumber: hostile,
      creator: { id: "x", name: hostile },
      itemLocation: { label: hostile },
      lines: base.lines.map((line) => ({ ...line, name: hostile, brand: hostile })),
      sors: [{ id: "o", salesReference: "S1", projectTitle: hostile, stageName: hostile }],
      overrides: {
        ...base.overrides,
        entity: { ...base.overrides.entity, value: hostile, overridden: true, odoo: hostile },
      },
      bankDetails: { ...base.bankDetails, bankName: hostile, accountName: hostile },
    }
    const html = buildIpasDocument(buildIpasViewModel(ipas, { printedBy: hostile, printedAt: "2026-09-15T02:30:00.000Z" }))

    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quoted&quot;")
  })

  it("escapes document and charge labels and the checklist", () => {
    const base = makePrintableIpas()
    const ipas = {
      ...base,
      documents: base.documents.map((doc) => ({ ...doc, label: "<b>x</b>" })),
      charges: base.charges.map((charge) => ({ ...charge, kindLabel: "<i>y</i>" })),
    }
    const pages = buildIpasPagesHtml(buildIpasViewModel(ipas))

    expect(pages).not.toContain("<b>x</b>")
    expect(pages).not.toContain("<i>y</i>")
    expect(pages).toContain("&lt;b&gt;x&lt;/b&gt;")
  })
})
