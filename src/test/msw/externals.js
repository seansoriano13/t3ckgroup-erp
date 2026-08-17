/**
 * Handlers for every non-PostgREST network boundary the app touches: Supabase
 * Auth, Supabase Edge Functions, Cloudinary uploads, the GitHub commits feed
 * and the Gemini generation endpoint.
 *
 * Each has a sane default so an unrelated test never has to think about it, and
 * a `stub*` helper for tests that do care. Nothing here reaches the network —
 * `onUnhandledRequest: "error"` in server.js makes sure of that.
 */

import { http, HttpResponse } from "msw"
import { brochurePublicId } from "@/lib/brochureUrl"
import { stubs } from "./postgrest"

const BASE_URL = import.meta.env.VITE_SUPABASE_URL

const defaults = {
  cloudinary: (resource) => ({
    secure_url: `https://res.cloudinary.com/test-cloud/${resource}/upload/v1/fake-upload`,
    bytes: 1024,
  }),
  githubCommits: [],
  gemini: "Fake Gemini summary.",
}

export const externalStubs = {
  cloudinary: null,
  brochures: new Map(),
  githubCommits: null,
  gemini: null,
  authUsers: new Map(),
}

export function resetExternalStubs() {
  externalStubs.cloudinary = null
  externalStubs.brochures.clear()
  externalStubs.githubCommits = null
  externalStubs.gemini = null
  externalStubs.authUsers.clear()
}

/** Replaces the Cloudinary upload response. Pass an object or a function. */
export function stubCloudinaryUpload(response) {
  externalStubs.cloudinary = typeof response === "function" ? response : () => response
}

/**
 * Publishes a brochure at the Cloudinary address the app derives for `doc`.
 *
 * Deliberately keyed through brochurePublicId rather than a hand-written path:
 * the whole design rests on the app and the mirror script agreeing on that name,
 * so a test that hard-coded the URL could pass while the real thing 404s.
 * Leaving a document unstubbed is how you test the refusal path.
 */
export function stubBrochure(doc, bytes) {
  externalStubs.brochures.set(brochurePublicId(doc), bytes)
}

export function stubGithubCommits(commits) {
  externalStubs.githubCommits = commits
}

export function stubGeminiResponse(text) {
  externalStubs.gemini = text
}

/** Registers a password-login-capable user for the fake auth endpoint. */
export function stubAuthUser({ email, password, id = "auth-user-1", metadata = {} }) {
  externalStubs.authUsers.set(email, { id, email, password, metadata })
}

function session(user) {
  return {
    access_token: `fake-access-token-for-${user.id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.UTC(2026, 0, 1) / 1000) + 3600,
    refresh_token: `fake-refresh-token-for-${user.id}`,
    user: {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      app_metadata: { provider: "email" },
      user_metadata: user.metadata,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  }
}

export const externalHandlers = [
  // ── Supabase Auth ────────────────────────────────────────────────────────
  http.post(`${BASE_URL}/auth/v1/token`, async ({ request }) => {
    const url = new URL(request.url)
    const grant = url.searchParams.get("grant_type")
    const body = await request.json().catch(() => ({}))

    if (grant === "password") {
      const user = externalStubs.authUsers.get(body.email)
      if (!user || user.password !== body.password) {
        return HttpResponse.json(
          { error: "invalid_grant", error_description: "Invalid login credentials" },
          { status: 400 },
        )
      }
      return HttpResponse.json(session(user))
    }

    if (grant === "id_token") {
      const user = externalStubs.authUsers.values().next().value
      if (!user) {
        return HttpResponse.json(
          { error: "invalid_grant", error_description: "No stubbed identity" },
          { status: 400 },
        )
      }
      return HttpResponse.json(session(user))
    }

    return HttpResponse.json(
      { error: "unsupported_grant_type", error_description: `grant_type=${grant}` },
      { status: 400 },
    )
  }),

  http.get(`${BASE_URL}/auth/v1/user`, () => {
    const user = externalStubs.authUsers.values().next().value
    if (!user) return HttpResponse.json({ message: "invalid claim" }, { status: 401 })
    return HttpResponse.json(session(user).user)
  }),

  http.post(`${BASE_URL}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })),

  // ── Supabase Edge Functions ──────────────────────────────────────────────
  http.post(`${BASE_URL}/functions/v1/:name`, async ({ request, params }) => {
    const stub = stubs.edgeFunctions.get(params.name)
    if (!stub) {
      return HttpResponse.json(
        { error: `No edge-function stub registered for "${params.name}" — call stubEdgeFunction().` },
        { status: 404 },
      )
    }
    const body = await request.json().catch(() => ({}))
    const result = await stub(body)
    // Some functions answer with bytes rather than JSON — odoo-quotation-file
    // streams PDFs. A stub returning a Response passes straight through so it
    // can set its own status and Content-Type.
    return result instanceof Response ? result : HttpResponse.json(result)
  }),

  // ── Cloudinary ───────────────────────────────────────────────────────────
  http.post("https://api.cloudinary.com/v1_1/:cloud/:resource/upload", async ({ params }) => {
    const build = externalStubs.cloudinary ?? (() => defaults.cloudinary(params.resource))
    const result = await build(params.resource)
    if (result?.__status && result.__status >= 400) {
      return HttpResponse.json({ error: { message: result.message } }, { status: result.__status })
    }
    return HttpResponse.json(result)
  }),

  // Cloudinary delivery — where brochures are read from now that they no longer
  // come through the Supabase proxy. Anything not registered by stubBrochure()
  // is a 404, which is not an oversight: an un-mirrored brochure is exactly what
  // makes quotationService refuse a download, so the default IS the test case.
  http.all("https://res.cloudinary.com/:cloud/raw/upload/*", ({ request }) => {
    const key = new URL(request.url).pathname.replace(/^\/[^/]+\/raw\/upload\//, "")
    const bytes = externalStubs.brochures.get(key)
    if (!bytes) return new HttpResponse(null, { status: 404 })

    // HEAD is how existence is proved before the expensive quotation render, so
    // it has to answer with the headers and none of the body.
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
    }
    if (request.method === "HEAD") return new HttpResponse(null, { headers })
    return new HttpResponse(bytes, { headers })
  }),

  // ── GitHub ───────────────────────────────────────────────────────────────
  http.get("https://api.github.com/repos/:owner/:repo/commits", () =>
    HttpResponse.json(externalStubs.githubCommits ?? defaults.githubCommits),
  ),

  // ── Gemini ───────────────────────────────────────────────────────────────
  http.post(
    "https://generativelanguage.googleapis.com/*",
    () =>
      HttpResponse.json({
        candidates: [
          {
            content: { parts: [{ text: externalStubs.gemini ?? defaults.gemini }], role: "model" },
            finishReason: "STOP",
          },
        ],
      }),
  ),
]
