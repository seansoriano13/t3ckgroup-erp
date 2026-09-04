/**
 * jsdom, but with Node's AbortController/AbortSignal/Blob/File/FormData left
 * in place.
 *
 * jsdom installs its own versions of all of these. Node's fetch (undici)
 * brand-checks `init.signal` against its internal AbortSignal, so the
 * controller that `customFetch` in src/lib/supabase.js creates gets rejected
 * with "Expected signal to be an instance of AbortSignal" — every request
 * fails before it reaches MSW. The same brand-checking bites a multipart
 * upload: undici only recognises a body as FormData against its OWN
 * FormData class, so a jsdom FormData built from a jsdom File serializes to
 * a plain string instead — a receiving handler that calls
 * `request.formData()` sees "Content-Type was not multipart/form-data"
 * rather than the file. Nothing is wrong with the application code: in a
 * real browser every one of these classes comes from the same realm.
 *
 * This module is imported before jsdom is installed, so the globals captured
 * here are Node's originals; they are put back after jsdom populates the
 * global object.
 */

import { builtinEnvironments } from "vitest/environments"

const NodeAbortController = globalThis.AbortController
const NodeAbortSignal = globalThis.AbortSignal
const NodeBlob = globalThis.Blob
const NodeFile = globalThis.File
const NodeFormData = globalThis.FormData

/** The Web Storage API, backed by a Map. */
function createMemoryStorage() {
    const entries = new Map()
    return {
        get length() {
            return entries.size
        },
        key: (index) => [...entries.keys()][index] ?? null,
        getItem: (key) => (entries.has(String(key)) ? entries.get(String(key)) : null),
        setItem: (key, value) => entries.set(String(key), String(value)),
        removeItem: (key) => entries.delete(String(key)),
        clear: () => entries.clear(),
    }
}

export default {
    name: "jsdom-node-fetch",
    transformMode: "web",
    async setup(global, options) {
        const { teardown } = await builtinEnvironments.jsdom.setup(global, options)

        const jsdomAbortController = global.AbortController
        const jsdomAbortSignal = global.AbortSignal
        const jsdomBlob = global.Blob
        const jsdomFile = global.File
        const jsdomFormData = global.FormData
        global.AbortController = NodeAbortController
        global.AbortSignal = NodeAbortSignal
        global.Blob = NodeBlob
        global.File = NodeFile
        global.FormData = NodeFormData

        // Neither jsdom nor Node supplies a usable Storage here: Node 26's
        // `localStorage` global is a disabled accessor, and jsdom leaves
        // window.localStorage undefined without a storage-backed origin. Code
        // that reads it — the theme hook, the Supabase session store — would
        // see undefined. An in-memory Storage keeps that code on its normal
        // path, and per-test isolation comes from the worker being fresh.
        for (const key of ["localStorage", "sessionStorage"]) {
            const storage = global.window?.[key] ?? createMemoryStorage()
            for (const target of [global, global.window]) {
                if (!target) continue
                Object.defineProperty(target, key, {
                    value: storage,
                    configurable: true,
                    writable: true,
                })
            }
        }

        return {
            teardown(g) {
                g.AbortController = jsdomAbortController
                g.AbortSignal = jsdomAbortSignal
                g.Blob = jsdomBlob
                g.File = jsdomFile
                g.FormData = jsdomFormData
                return teardown(g)
            },
        }
    },
}
