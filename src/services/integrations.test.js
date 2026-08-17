import { afterEach, describe, expect, it, vi } from "vitest"
import { PDFDocument } from "pdf-lib"
import { githubService } from "./githubService"
import { odooService } from "./odooService"
import { quotationService } from "./quotationService"
import { storageService } from "./storageService"
import { aiService } from "./aiService"
import { supabase } from "@/lib/supabase"
import {
  server,
  stubBrochure,
  stubCloudinaryUpload,
  stubEdgeFunction,
  stubGithubCommits,
} from "@/test/msw/server"

/**
 * The third-party boundaries: GitHub for the changelog, an Odoo lookup edge
 * function for quotation lines, Cloudinary for every uploaded file, and Gemini
 * for the release summary. Each is faked at the HTTP layer, so what is
 * exercised is the request the service really sends and how it handles the
 * answers — including the failures.
 */
describe("githubService", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const configure = () => {
    vi.stubEnv("VITE_GITHUB_PAT", "test-pat")
    vi.stubEnv("VITE_GITHUB_REPO", "t3ckgroup/task-monitoring")
  }

  it("refuses to run when the integration is not configured", async () => {
    vi.stubEnv("VITE_GITHUB_PAT", "")
    vi.stubEnv("VITE_GITHUB_REPO", "")

    await expect(githubService.getRecentCommits()).rejects.toThrow(
      /GitHub integration is not properly configured/,
    )
  })

  it("reduces each commit to the fields the changelog needs", async () => {
    configure()
    stubGithubCommits([
      {
        sha: "abcdef1234567890",
        html_url: "https://github.test/commit/abcdef1",
        commit: {
          message: "feat: add the pipeline board",
          author: { name: "Sean Soriano", date: "2026-03-05T01:30:00Z" },
        },
      },
    ])

    const commits = await githubService.getRecentCommits()

    expect(commits).toEqual([
      {
        sha: "abcdef1",
        message: "feat: add the pipeline board",
        author: "Sean Soriano",
        date: "2026-03-05T01:30:00Z",
        url: "https://github.test/commit/abcdef1",
      },
    ])
  })

  it("returns nothing for a repository with no commits", async () => {
    configure()
    stubGithubCommits([])

    expect(await githubService.getRecentCommits()).toEqual([])
  })
})

describe("odooService", () => {
  it("returns the product lines the lookup found", async () => {
    stubEdgeFunction("odoo-sor-lookup", {
      success: true,
      lines: [{ product_name: "Pumper", quantity: 2, unit_price: 1500 }],
    })

    const result = await odooService.fetchOrderLines("S01237")

    expect(result).toMatchObject({ success: true })
    expect(result.lines).toHaveLength(1)
  })

  it("passes a normal miss back to the caller instead of throwing", async () => {
    // A bad reference or an empty quotation is not an error — the form falls
    // back to manual entry.
    stubEdgeFunction("odoo-sor-lookup", { success: false, message: "No matching quotation." })

    await expect(odooService.fetchOrderLines("S09999")).resolves.toEqual({
      success: false,
      message: "No matching quotation.",
    })
  })

  it("sends the sales reference the caller asked about", async () => {
    const seen = []
    stubEdgeFunction("odoo-sor-lookup", (body) => {
      seen.push(body)
      return { success: true, lines: [] }
    })

    await odooService.fetchOrderLines("S01237")

    expect(seen).toEqual([{ salesReference: "S01237" }])
  })

  describe("the customer share link", () => {
    it("returns the portal URL for the quotation", async () => {
      stubEdgeFunction("odoo-quotation-link", {
        success: true,
        found: true,
        order: { id: 4718, name: "S04718", state: "sent" },
        url: "https://odoo.test/my/orders/4718?access_token=tok-1",
      })

      const result = await odooService.fetchShareLink("S04718")

      expect(result.url).toBe("https://odoo.test/my/orders/4718?access_token=tok-1")
      expect(result.order).toMatchObject({ name: "S04718" })
    })

    it("asks the link function about the reference it was given", async () => {
      const seen = []
      stubEdgeFunction("odoo-quotation-link", (body) => {
        seen.push(body)
        return { success: true, url: "https://odoo.test/my/orders/1?access_token=t" }
      })

      await odooService.fetchShareLink("S04718")

      expect(seen).toEqual([{ salesReference: "S04718" }])
    })

    it("passes a missing quotation back instead of throwing", async () => {
      stubEdgeFunction("odoo-quotation-link", {
        success: false,
        found: false,
        message: 'No Odoo quotation found matching "S09999".',
      })

      await expect(odooService.fetchShareLink("S09999")).resolves.toMatchObject({
        success: false,
        found: false,
      })
    })

    it("passes back the ask-a-human fallback when Odoo refused a new token", async () => {
      // access_token is generated lazily by Odoo and _portal_ensure_token is
      // private, so the function writes one itself and reads it back. A
      // rejected write has to reach the salesperson as an instruction, not a
      // crash.
      stubEdgeFunction("odoo-quotation-link", {
        success: false,
        found: true,
        message:
          "S04718 has no share token and Odoo would not accept a new one. " +
          "Open the quotation in Odoo and click Share once, then try again.",
      })

      const result = await odooService.fetchShareLink("S04718")

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/click Share once/)
    })
  })
})

describe("quotationService", () => {
  /**
   * Page size is the marker: each source PDF is built at a distinct width, so
   * the merged document's page widths spell out the order the pages were
   * assembled in. That is the whole point of the feature — Odoo puts the
   * brochures first and this has to put them last.
   */
  const pdfOf = async (width, pages) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pages; i++) doc.addPage([width, 500])
    return doc.save()
  }

  const binary = (bytes) =>
    new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })

  const widthsOf = async (blob) => {
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))
    return doc.getPages().map((p) => Math.round(p.getWidth()))
  }

  /** The quotation render is the only thing still coming through Supabase. */
  const stubQuotation = (bytes) =>
    stubEdgeFunction("odoo-quotation-file", () => binary(bytes))

  it("puts the quotation first and the brochures behind it", async () => {
    const quotation = await pdfOf(100, 2)
    const docA = { id: 11, name: "A.pdf", checksum: "a1", attached_on: "quotation" }
    const docB = { id: 22, name: "B.pdf", checksum: "b2", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 4718, name: "S04718" },
      documents: [docA, docB],
    })
    stubQuotation(quotation)
    stubBrochure(docA, await pdfOf(200, 1))
    stubBrochure(docB, await pdfOf(300, 2))

    const result = await quotationService.buildQuotationPdf("S04718")

    expect(await widthsOf(result.blob)).toEqual([100, 100, 200, 300, 300])
    expect(result.filename).toBe("Quotation S04718.pdf")
    expect(result.warnings).toEqual([])
    expect(result.documentCount).toBe(2)
  })

  it("refuses the whole download when a brochure is not mirrored", async () => {
    // Deliberately not a fallback to the Supabase proxy. A silent fallback would
    // mean a misconfigured mirror quietly bleeds egress until the bill arrives,
    // so the download stops and names what to fix.
    const docA = { id: 11, name: "Mirrored.pdf", checksum: "a1", attached_on: "quotation" }
    const docB = { id: 22, name: "Missing.pdf", checksum: "b2", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 5, name: "S00005" },
      documents: [docA, docB],
    })
    let quotationFetched = false
    stubEdgeFunction("odoo-quotation-file", () => {
      quotationFetched = true
      return binary(new Uint8Array([1, 2, 3]))
    })
    stubBrochure(docA, await pdfOf(200, 1))
    // docB is never stubbed — that is the un-mirrored document.

    await expect(quotationService.buildQuotationPdf("S00005")).rejects.toThrow(
      /Missing\.pdf.*id 22/,
    )

    // The refusal must land before Odoo is asked to render, because that render
    // is the slow, expensive half of the download.
    expect(quotationFetched).toBe(false)
  })

  it("names only the first few when a great many are unmirrored", async () => {
    const documents = Array.from({ length: 9 }, (_, i) => ({
      id: 100 + i,
      name: `Doc${i}.pdf`,
      checksum: `c${i}`,
      attached_on: "quotation",
    }))
    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 6, name: "S00006" },
      documents,
    })
    stubEdgeFunction("odoo-quotation-file", () => binary(new Uint8Array([1])))

    // A toast carrying nine filenames is unreadable; it summarises instead.
    await expect(quotationService.buildQuotationPdf("S00006")).rejects.toThrow(/and 6 more/)
  })

  it("skips a brochure it cannot parse rather than losing the whole download", async () => {
    // A mirrored but unreadable datasheet is a different thing from a missing
    // one: it is present, so the quotation still goes out and the skip is named.
    const quotation = await pdfOf(100, 1)
    const broken = { id: 11, name: "Broken.pdf", checksum: "x", attached_on: "quotation" }
    const good = { id: 22, name: "Good.pdf", checksum: "y", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 1, name: "S00001" },
      documents: [broken, good],
    })
    stubQuotation(quotation)
    stubBrochure(broken, new Uint8Array([1, 2, 3, 4]))
    stubBrochure(good, await pdfOf(200, 1))

    const result = await quotationService.buildQuotationPdf("S00001")

    expect(await widthsOf(result.blob)).toEqual([100, 200])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/^Broken\.pdf:/)
    expect(result.documentCount).toBe(1)
  })

  it("still produces a document when the quotation has no brochures", async () => {
    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 2, name: "S00002" },
      documents: [],
    })
    stubQuotation(await pdfOf(100, 3))

    const result = await quotationService.buildQuotationPdf("S00002")

    expect(await widthsOf(result.blob)).toEqual([100, 100, 100])
    expect(result.warnings).toEqual([])
  })

  it("reports each file as it lands", async () => {
    const doc = { id: 11, name: "Datasheet.pdf", checksum: "z", attached_on: "quotation" }
    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 3, name: "S00003" },
      documents: [doc],
    })
    stubQuotation(await pdfOf(100, 1))
    stubBrochure(doc, await pdfOf(100, 1))

    const labels = []
    await quotationService.buildQuotationPdf("S00003", {
      onProgress: ({ label }) => labels.push(label),
    })

    expect(labels).toContain("Datasheet.pdf")
  })

  /** Stands in for Odoo's render: the 'inside' brochures, then the quotation. */
  const odooRenderOf = async (quotation, ...merged) => {
    const doc = await PDFDocument.create()
    for (const bytes of [...merged, quotation]) {
      const source = await PDFDocument.load(bytes)
      const pages = await doc.copyPages(source, source.getPageIndices())
      pages.forEach((p) => doc.addPage(p))
    }
    return doc.save()
  }

  it("moves brochures Odoo merged at the front round to the back", async () => {
    // A document left on 'inside' is baked into Odoo's render ahead of the
    // quotation. Its pages are trimmed off the front and re-appended at the end,
    // so the customer reads the quotation first either way.
    const quotation = await pdfOf(100, 1)
    const stillInside = await pdfOf(200, 1)
    const inside = { id: 11, name: "StillInside.pdf", checksum: "m", attached_on: "inside" }
    const flipped = { id: 22, name: "Flipped.pdf", checksum: "f", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 9, name: "S00009" },
      documents: [inside, flipped],
    })
    stubQuotation(await odooRenderOf(quotation, stillInside))
    stubBrochure(inside, stillInside)
    stubBrochure(flipped, await pdfOf(300, 1))

    const result = await quotationService.buildQuotationPdf("S00009")

    expect(await widthsOf(result.blob)).toEqual([100, 200, 300])
    expect(result.documentCount).toBe(2)
    expect(result.warnings).toEqual([])
    expect(result.notices).toEqual([])
  })

  it("refuses the trim when the render does not start with the brochure pages", async () => {
    // The manifest says StillInside.pdf was merged in, but Odoo's render is
    // nothing but quotation. Trimming on the page count alone would delete a
    // real page of pricing — so the render is left whole and the brochure is
    // not appended a second time.
    const inside = { id: 11, name: "StillInside.pdf", checksum: "m", attached_on: "inside" }
    const flipped = { id: 22, name: "Flipped.pdf", checksum: "f", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 9, name: "S00009" },
      documents: [inside, flipped],
    })
    stubQuotation(await pdfOf(100, 2))
    stubBrochure(inside, await pdfOf(200, 1))
    stubBrochure(flipped, await pdfOf(300, 1))

    const result = await quotationService.buildQuotationPdf("S00009")

    expect(await widthsOf(result.blob)).toEqual([100, 100, 300])
    expect(result.documentCount).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.notices).toHaveLength(1)
    expect(result.notices[0]).toMatch(/stay in front of the quotation/)
  })

  it("refuses the trim when it would leave no quotation behind", async () => {
    // Brochure pages meet or exceed the whole render: the arithmetic cannot be
    // describing what we think it is.
    const inside = { id: 11, name: "StillInside.pdf", checksum: "m", attached_on: "inside" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 9, name: "S00009" },
      documents: [inside],
    })
    stubQuotation(await pdfOf(100, 1))
    stubBrochure(inside, await pdfOf(100, 2))

    const result = await quotationService.buildQuotationPdf("S00009")

    expect(await widthsOf(result.blob)).toEqual([100])
    expect(result.documentCount).toBe(0)
    expect(result.notices).toHaveLength(1)
  })

  it("leaves the Odoo render intact if an inside brochure cannot be measured", async () => {
    const bad = { id: 11, name: "Bad.pdf", checksum: "m", attached_on: "inside" }
    const good = { id: 22, name: "Good.pdf", checksum: "f", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 9, name: "S00009" },
      documents: [bad, good],
    })
    stubQuotation(await pdfOf(100, 1))
    stubBrochure(bad, new Uint8Array([1, 2, 3]))
    stubBrochure(good, await pdfOf(300, 1))

    const result = await quotationService.buildQuotationPdf("S00009")

    // Bad.pdf is not *missing* — Odoo merged it into the render — so it is a
    // notice about placement, not a warning about an absent brochure.
    expect(await widthsOf(result.blob)).toEqual([100, 300])
    expect(result.warnings).toEqual([])
    expect(result.notices).toHaveLength(1)
    expect(result.notices[0]).toMatch(/Bad\.pdf/)
    expect(result.documentCount).toBe(1)
  })

  it("fetches brochures a few at a time, in manifest order", async () => {
    const quotation = await pdfOf(100, 1)
    const documents = Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i,
      name: `Doc${i}.pdf`,
      checksum: `c${i}`,
      attached_on: "quotation",
    }))

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 7, name: "S07813" },
      documents,
    })

    stubQuotation(quotation)
    // Width encodes position, so the assembled order is checkable.
    for (const [i, doc] of documents.entries()) stubBrochure(doc, await pdfOf(200 + i, 1))

    let inFlight = 0
    let peak = 0
    const onStart = ({ request }) => {
      if (!request.url.includes("res.cloudinary.com")) return
      inFlight += 1
      peak = Math.max(peak, inFlight)
    }
    const onEnd = ({ request }) => {
      if (request.url.includes("res.cloudinary.com")) inFlight -= 1
    }
    server.events.on("request:start", onStart)
    server.events.on("request:end", onEnd)

    let result
    try {
      result = await quotationService.buildQuotationPdf("S07813")
    } finally {
      // resetHandlers() does not clear event listeners, so leaving these
      // attached would have them counting every later test's requests too.
      server.events.removeListener("request:start", onStart)
      server.events.removeListener("request:end", onEnd)
    }

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
    expect(await widthsOf(result.blob)).toEqual([100, ...documents.map((_, i) => 200 + i)])
    expect(result.documentCount).toBe(12)
  })

  it("never asks Supabase for a brochure", async () => {
    // The reason the whole change exists: brochure bytes must not touch a
    // metered proxy. A regression here would be invisible except on the bill.
    const doc = { id: 11, name: "A.pdf", checksum: "a", attached_on: "quotation" }
    const kinds = []

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 9, name: "S00009" },
      documents: [doc],
    })
    stubEdgeFunction("odoo-quotation-file", (body) => {
      kinds.push(body.kind)
      return binary(quotationBytes)
    })
    const quotationBytes = await pdfOf(100, 1)
    stubBrochure(doc, await pdfOf(200, 1))

    await quotationService.buildQuotationPdf("S00009")

    expect(kinds).toEqual(["quotation"])
  })

  it("gives the Odoo fetches their own deadline rather than the 20s default", async () => {
    // The default in src/lib/supabase.js aborts a merged quotation render and
    // then retries it, starting a second render on top of the first. Bringing
    // an AbortSignal is what tells the wrapper to stand aside, so pin it here —
    // dropping it would quietly make S07813 undownloadable again.
    const invocations = []
    const doc = { id: 11, name: "A.pdf", checksum: "a", attached_on: "quotation" }

    stubEdgeFunction("odoo-quotation-manifest", {
      success: true,
      order: { id: 9, name: "S00009" },
      documents: [doc],
    })
    stubQuotation(await pdfOf(100, 1))
    stubBrochure(doc, await pdfOf(200, 1))

    const prototype = Object.getPrototypeOf(supabase)
    const realGetter = Object.getOwnPropertyDescriptor(prototype, "functions").get
    const spy = vi.spyOn(prototype, "functions", "get").mockImplementation(function () {
      const client = realGetter.call(this)
      const invoke = client.invoke.bind(client)
      client.invoke = (name, options) => {
        invocations.push({ name, hasDeadline: !!options?.signal })
        return invoke(name, options)
      }
      return client
    })

    try {
      await quotationService.buildQuotationPdf("S00009")
    } finally {
      spy.mockRestore()
    }

    const fileFetches = invocations.filter((c) => c.name === "odoo-quotation-file")
    // One, not two: the brochure comes from Cloudinary now.
    expect(fileFetches).toHaveLength(1)
    expect(fileFetches.every((c) => c.hasDeadline)).toBe(true)
  })

  it("surfaces a failed lookup as a readable error", async () => {
    stubEdgeFunction("odoo-quotation-manifest", {
      success: false,
      message: 'No Odoo quotation found matching "S09999".',
    })

    await expect(quotationService.buildQuotationPdf("S09999")).rejects.toThrow(
      /No Odoo quotation found/,
    )
  })
})

describe("storageService", () => {
  const file = (name = "receipt.pdf", type = "application/pdf", size = 2048) =>
    new File(["x".repeat(size)], name, { type })

  it("returns the hosted URL for an uploaded document", async () => {
    stubCloudinaryUpload({ secure_url: "https://res.cloudinary.test/raw/receipt.pdf", bytes: 2048 })

    const descriptor = await storageService.uploadFileToCloudinary(file())

    expect(descriptor).toEqual({
      url: "https://res.cloudinary.test/raw/receipt.pdf",
      name: "receipt.pdf",
      type: "application/pdf",
      bytes: 2048,
    })
  })

  it("carries the original filename, which Cloudinary mangles for raw uploads", async () => {
    stubCloudinaryUpload({ secure_url: "https://res.cloudinary.test/raw/xk3j9f", bytes: 10 })

    const descriptor = await storageService.uploadFileToCloudinary(file("Site Report Q1.pdf"))

    expect(descriptor.name).toBe("Site Report Q1.pdf")
  })

  it("surfaces a Cloudinary rejection as a readable error", async () => {
    stubCloudinaryUpload({ __status: 400, message: "Upload preset not found" })

    await expect(storageService.uploadFileToCloudinary(file())).rejects.toThrow(
      "Upload preset not found",
    )
  })

  it("refuses to upload nothing", async () => {
    await expect(storageService.uploadFileToCloudinary(null)).rejects.toThrow("No file provided.")
    await expect(storageService.uploadToCloudinary(null)).rejects.toThrow("No file provided.")
  })

  it("requires a task and a user before accepting an attachment", async () => {
    await expect(storageService.uploadTaskAttachment(null, "task-1", file())).rejects.toThrow(
      "Missing required fields for upload.",
    )
  })

  it("only accepts avatar or banner as a profile image kind", async () => {
    await expect(
      storageService.uploadProfileImage("emp-1", "wallpaper", file()),
    ).rejects.toThrow("Invalid upload kind.")
  })

  describe("resolving stored paths", () => {
    it("passes a hosted URL straight through", async () => {
      const url = "https://res.cloudinary.test/image/photo.png"

      expect(await storageService.getSignedUrl(url)).toBe(url)
      expect(await storageService.getSignedUrls([url])).toEqual([{ path: url, signedUrl: url }])
    })

    it("substitutes a blank pixel for a legacy Supabase Storage path", async () => {
      // Those files are no longer served, and reaching for them would cost
      // egress on every render.
      const signed = await storageService.getSignedUrl("avatars/old-file.png")

      expect(signed.startsWith("data:image/gif;base64,")).toBe(true)
    })

    it("returns nothing for an empty path list", async () => {
      expect(await storageService.getSignedUrls([])).toEqual([])
      expect(await storageService.getSignedUrl(null)).toBeNull()
    })
  })
})

describe("aiService", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses to summarise commits without an API key", async () => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "")

    await expect(aiService.summarizeCommits([])).rejects.toThrow(/Missing VITE_GEMINI_API_KEY/)
  })

  describe("the motivational quote", () => {
    it("returns a seven-word quote", async () => {
      const quote = await aiService.getRandomMotivationalQuote("Ana")

      expect(quote.split(" ")).toHaveLength(7)
    })

    it("never actually substitutes the name into the quote", async () => {
      // The personalisation replaces a standalone "team", but the only quote
      // that comes close says "teams" — so the name argument is inert today.
      // Recorded rather than fixed: making it fire would read as
      // "Great Ana rise by lifting each other".
      const quotes = await Promise.all(
        Array.from({ length: 60 }, () => aiService.getRandomMotivationalQuote("Ana")),
      )

      expect(quotes.some((q) => q.includes("Ana"))).toBe(false)
    })

    it("draws from the fallback set, so repeated calls vary", async () => {
      const quotes = new Set(
        await Promise.all(
          Array.from({ length: 60 }, () => aiService.getRandomMotivationalQuote()),
        ),
      )

      expect(quotes.size).toBeGreaterThan(1)
    })

    it("falls back to a generic address when no name is given", async () => {
      const quote = await aiService.getRandomMotivationalQuote()

      expect(typeof quote).toBe("string")
      expect(quote.length).toBeGreaterThan(0)
    })

    it("keeps the old method name working for existing callers", async () => {
      await expect(aiService.generateMotivationalQuote("Ana")).resolves.toEqual(
        expect.any(String),
      )
    })
  })
})
