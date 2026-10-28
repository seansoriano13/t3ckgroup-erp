// Error tracking (Bugsink, via the Sentry SDK).
//
// Two rules shape everything in this file:
//   1. An error report may say WHO (user id, role, department) and WHERE, never
//      the content: no names, salaries, prices or other money amounts, no
//      emails, no request bodies, no URL query strings or hashes (the hash can
//      hold an auth token). Everything is scrubbed in beforeSend /
//      beforeBreadcrumb, so a careless console.error(employee) at a call site
//      cannot leak.
//   2. It is off unless a DSN is baked into the build, and never runs in
//      `pnpm dev`, so local work does not fill the inbox.
//
// Session replay and performance tracing are deliberately not enabled.
import * as Sentry from "@sentry/react"
import { isLocal } from "@/lib/appEnv"

const dsn = import.meta.env.VITE_SENTRY_DSN
const enabled = Boolean(dsn) && !import.meta.env.DEV && !isLocal
// Same signal as isProductionSupabase in lib/supabase.js (ADR 0005: the Supabase
// project is what separates staging from production). Not imported from there:
// supabase.js imports this file.
const isProduction = Boolean(import.meta.env.VITE_SUPABASE_URL?.includes("epqmberwewztzbrkhhss"))

// Keys whose values are never sent, wherever they sit in an object.
const SENSITIVE_KEY =
    /salary|wage|pay(?:roll|rate)?$|price|amount|cost|total|rate$|markup|margin|budget|balance|fee$|tax|name|email|phone|address|password|token|secret|authorization|cookie|apikey|api_key|birth|tin$|sss|philhealth|pagibig/i

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g
// ₱1,234.50  PHP 1234  Php1,234  $5.00  USD 12  1,234.50 pesos
const MONEY = /(?:₱|\bPHP\b|\bPhp\b|\bUSD\b|\$)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:pesos|php)\b/gi

export function scrubString(value) {
    if (typeof value !== "string") return value
    return value.replace(JWT, "[token]").replace(EMAIL, "[email]").replace(MONEY, "[amount]")
}

// Drops the query string and hash from a URL (or a path), keeps origin + path.
export function stripUrl(url) {
    if (typeof url !== "string") return url
    return url.split("#")[0].split("?")[0]
}

function scrubValue(value, depth = 0) {
    if (typeof value === "string") return scrubString(value)
    if (value === null || typeof value !== "object") return value
    if (depth > 4) return "[deep]"
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, depth + 1))
    const out = {}
    for (const [key, v] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : scrubValue(v, depth + 1)
    }
    return out
}

// console.error(...) arguments land in extra.arguments. Strings and Errors are
// kept (scrubbed); any object (an employee row, a price, a form) is replaced by
// a marker, since an object is exactly where the sensitive fields live.
function scrubConsoleArguments(args) {
    if (!Array.isArray(args)) return args
    return args.slice(0, 10).map((arg) => {
        if (typeof arg === "string") return scrubString(arg)
        if (arg instanceof Error) return scrubString(arg.message)
        if (arg && typeof arg === "object" && typeof arg.message === "string" && typeof arg.code === "string") {
            // A Supabase/PostgREST error: the code and message are safe, `details` is not.
            return { code: arg.code, message: scrubString(arg.message) }
        }
        return arg === null || arg === undefined || typeof arg !== "object" ? arg : "[object]"
    })
}

export function scrubEvent(event) {
    if (!event) return event

    // Identity: id, role, department only (set through setErrorTrackingUser).
    if (event.user) event.user = { id: event.user.id }
    if (event.request) {
        event.request = { url: stripUrl(event.request.url), method: event.request.method }
    }
    if (event.message) event.message = scrubString(event.message)
    for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubString(ex.value)
    }
    if (event.extra) {
        const { arguments: args, ...rest } = event.extra
        event.extra = scrubValue(rest)
        if (args) event.extra.arguments = scrubConsoleArguments(args)
    }
    if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter(Boolean)
    }
    return event
}

export function scrubBreadcrumb(crumb) {
    if (!crumb) return null
    // Console breadcrumbs carry whatever was logged; the error event itself
    // already has the scrubbed message, so the trail adds only risk.
    if (crumb.category === "console") return null
    const out = { ...crumb }
    if (out.message) out.message = scrubString(out.message)
    if (out.data) {
        const data = { ...out.data }
        for (const key of ["url", "from", "to"]) if (data[key]) data[key] = stripUrl(data[key])
        // Fetch/xhr breadcrumbs: keep method + status + path, drop the rest.
        out.data = out.category === "fetch" || out.category === "xhr"
            ? { method: data.method, status_code: data.status_code, url: data.url }
            : scrubValue(data)
    }
    return out
}

export function initErrorTracking() {
    if (!enabled) return
    Sentry.init({
        dsn,
        environment: isProduction ? "production" : "staging",
        // The cache-buster the update toast uses: the Vercel commit SHA on a
        // deploy, which is also the release the source maps are uploaded under.
        release: __APP_VERSION__,
        sendDefaultPii: false,
        // Errors only: no tracing, no profiling, no session replay.
        tracesSampleRate: 0,
        integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
        ignoreErrors: [
            "ResizeObserver loop limit exceeded",
            "ResizeObserver loop completed with undelivered notifications",
            // The app already reloads itself on a stale chunk (main.jsx).
            "Failed to fetch dynamically imported module",
            "Importing a module script failed",
        ],
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
    })
}

// Called by AuthProvider whenever the signed-in employee changes.
export function setErrorTrackingUser(user) {
    if (!enabled) return
    if (!user?.id) {
        Sentry.setUser(null)
        Sentry.setTags({ role: undefined, department: undefined, sub_department: undefined })
        return
    }
    Sentry.setUser({ id: String(user.id) })
    Sentry.setTags({
        role: user.role ?? "unknown",
        department: user.department ?? "unknown",
        sub_department: user.subDepartment ?? undefined,
    })
}

// The app's root error boundary calls this.
export function reportRenderError(error, info) {
    if (!enabled) return
    Sentry.captureReactException(error, info)
}

// A failed Supabase HTTP call. Only the method, status, the first path segments
// (the table / rpc / function name) and PostgREST's error `code` are sent —
// never the query string, the request body or the error `details`, which can
// quote row values.
export async function reportSupabaseFailure({ url, method, response }) {
    if (!enabled) return
    // 401 is an expired session the client refreshes on its own.
    if (response.status === 401) return
    let path = ""
    try {
        path = new URL(url).pathname
    } catch {
        path = stripUrl(String(url))
    }
    const target = path.replace(/^\/(rest|auth|functions|storage)\/v1\//, "$1/").split("/").slice(0, 2).join("/")
    let code
    let message
    try {
        const body = await response.clone().json()
        code = typeof body?.code === "string" ? body.code : undefined
        message = typeof body?.message === "string" ? scrubString(body.message).slice(0, 200) : undefined
    } catch {
        // Not JSON (a gateway page, for example): nothing more to add.
    }
    const verb = (method || "GET").toUpperCase()
    const error = new Error(`Supabase ${verb} ${target} failed (${response.status}${code ? ` ${code}` : ""})`)
    error.name = "SupabaseRequestError"
    Sentry.withScope((scope) => {
        scope.setTags({ supabase_status: String(response.status), supabase_target: target, supabase_method: verb })
        if (code) scope.setTag("supabase_code", code)
        if (message) scope.setExtra("supabase_message", message)
        // One issue per endpoint + status, however many rows or filters differ.
        scope.setFingerprint(["supabase", verb, target, String(response.status), code ?? ""])
        Sentry.captureException(error)
    })
}
