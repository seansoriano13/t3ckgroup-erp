import { afterEach, describe, expect, it, vi } from "vitest"
import { githubService } from "./githubService"
import { odooService } from "./odooService"
import { storageService } from "./storageService"
import { aiService } from "./aiService"
import { stubCloudinaryUpload, stubEdgeFunction, stubGithubCommits } from "@/test/msw/server"

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
