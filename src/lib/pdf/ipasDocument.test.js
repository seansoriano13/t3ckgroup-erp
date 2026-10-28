import { describe, expect, it } from "vitest"
import { buildIpasDocument, buildIpasPagesHtml } from "./ipasDocument"
import { buildIpasViewModel } from "./ipasViewModel"
import { BAUTISTA, RAMOS, ipasRow, makePrintableIpas, signoffRow } from "@/test/ipasPrint"

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

describe("the one A4 page of flow rows", () => {
  it("is a portrait A4 sheet set at 7.2pt body and 6.6pt tables, with rows that never split", () => {
    const html = doc()

    expect(html).toMatch(/@page\s*{\s*size:\s*A4 portrait;\s*margin:\s*0/)
    expect(html.match(/<div class="sheet/g)).toHaveLength(1)
    expect(html).toMatch(/\.sheet \{[^}]*font-size: 7\.2pt/)
    expect(html).toMatch(/th, td \{[^}]*font-size: 6\.6pt/)
    expect(html).toMatch(/\.frow \{[^}]*break-inside: avoid/)
    expect(html).not.toContain("Outcome")
    expect(html).not.toContain('class="band"')
  })

  it("runs the parts in flow order: 1, 2, 3, Logistics 6, Filing 4, Status 7", () => {
    const html = doc()
    const numbers = [...html.matchAll(/<h3><span>(\d) · /g)].map((match) => Number(match[1]))

    expect(numbers).toEqual([1, 2, 3, 6, 4, 7, 5])
  })

  it("prints each part's sign-offs beside that part, Logistics included", () => {
    const html = doc()
    const rows = html.split('<div class="frow">').slice(1)
    const signs = (row) => (row.match(/<div class="sig[ "]/g) ?? []).length

    expect(rows.map(signs)).toEqual([2, 2, 2, 1, 4, 0, 0])
    expect(rows[3]).toContain("6 · Logistics")
    expect(rows[3]).toContain("Signed by")
  })

  it("prints the name with the call sign in a signed box", () => {
    const html = doc({ signoffs: [signoffRow(1, "prepared", BAUTISTA, { signer: { id: "emp-bautista", name: "J. Bautista", avatar_path: null, call_sign: "JB" } })] })

    expect(html).toContain('<div class="who">JB · J. Bautista</div>')
  })

  it("builds the Landed Cost from the same totals the calculation adds", () => {
    const html = doc()

    for (const text of ["Goods", "Shipping fees", "Bank charge fees", "Brokerage Fee", "Duties &amp; Taxes", "PHP 93,573.68"]) {
      expect(html).toContain(text)
    }
    expect(html).toContain("PHP 46,786.84")
  })

  it("prints the header the old page 1 held: supplier, source, purpose, priority, creator, entity", () => {
    const html = doc()

    for (const text of ["Redleaf Medical Supplies", "P02445", "PI-RL-2026-118", "Ambulance Folding Stretcher", "priority", "Entity", "Pesos taken from the bank", "Charge fee", "Proof"]) {
      expect(html).toContain(text)
    }
  })

  it("marks the filing copy in the rail and the window title", () => {
    const ordinary = doc()
    const filing = doc({ row: FILED }, { filingCopy: true })

    expect(ordinary).not.toContain("Filing copy")
    expect(filing.match(/copy-mark">Filing copy/g)).toHaveLength(1)
    expect(filing).toContain("<title>TGIPAS_050 · P02445 · filing copy</title>")
  })

  it("has no Transmittals list", () => {
    const html = doc()

    expect(html).not.toMatch(/transmittal/i)
  })
})


describe("sign-off column", () => {
  it("leaves room for the typed name so it cannot run over its label", () => {
    const html = doc()
    expect(html).toMatch(/\.sig \.plate \{[^}]*min-height: 5mm/)
    expect(html).toMatch(/\.sig \.printed-name \{[^}]*white-space: nowrap/)
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
    // Waiting: section 2's two, section 3's two, Logistics' one and Filing's four, each printed once.
    expect(html.match(/<div class="pending">Signature required<\/div>/g)).toHaveLength(9)
    expect(html.match(/<div class="sig awaiting">/g)).toHaveLength(9)
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
    expect(html.match(/Odoo copy read Sep 15, 2026 09:12/g)).toHaveLength(1)
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

    expect(html).toContain("Landed / unit")
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

describe("the buyer track's reasons on paper", () => {
  it("prints the reason beside each unticked Odoo line", () => {
    const copy = ipasRow().odoo_copy
    const html = buildIpasDocument(
      buildIpasViewModel(
        makePrintableIpas({
          row: { odoo_copy: { ...copy, po: { ...copy.po, state: "draft" }, receipts: { status: "pending", done: 0, total: 2 }, bills: { count: 0, draft: 0 } } },
        }),
      ),
    )

    expect(html).toContain("Not confirmed in Odoo yet (RFQ)")
    expect(html).toContain("0 of 2 receipts done")
    expect(html).toContain("No bill yet")
  })
})
