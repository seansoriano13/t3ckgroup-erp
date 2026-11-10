/**
 * Fake Supabase Storage. No such handler existed before the signature
 * feature — everything else in this app uploads through Cloudinary, which
 * `externals.js` already covers. This mirrors the three real endpoints
 * `supabase-js`'s storage client actually calls (upload, sign, plain
 * download), keyed on the same `${bucket}/${path}` shape the real service
 * uses, so a path collision or a bucket-constraint violation fails here the
 * way it fails in production.
 */

import { http, HttpResponse } from "msw"

const BASE_URL = import.meta.env.VITE_SUPABASE_URL

/** Constraints of the buckets this app actually uses in Supabase Storage. */
const BUCKETS = {
  signatures: { maxBytes: 204800, allowedMimeTypes: ["image/png"] },
  // Bug Reports: any type (`allowedMimeTypes: null`, as in the real bucket).
  "bug-reports": { maxBytes: 52428800, allowedMimeTypes: null },
  // Transmittal stage pictures and videos (#253): any image or video, 50 MB.
  "pms-evidence": { maxBytes: 52428800, allowedMimeTypes: null },
}

export const storageObjects = new Map() // `${bucket}/${path}` -> { bytes: ArrayBuffer, contentType }

export function resetStorageStubs() {
  storageObjects.clear()
}

/** Seeds an object directly, for tests reading a signature they didn't upload themselves. */
export function seedStorageObject(bucket, path, { bytes, contentType = "image/png" }) {
  storageObjects.set(`${bucket}/${path}`, { bytes, contentType })
}

function pathAfter(request, prefix) {
  return new URL(request.url).pathname.slice(prefix.length)
}

function storageError(message, status) {
  return HttpResponse.json({ message, error: message, statusCode: String(status) }, { status })
}

export const storageHandlers = [
  // Batch signed URLs (`createSignedUrls`): one call, a list of paths.
  http.post(`${BASE_URL}/storage/v1/object/sign/:bucket`, async ({ request, params }) => {
    const { bucket } = params
    const { paths = [] } = await request.json()
    return HttpResponse.json(
      paths.map((path) =>
        storageObjects.has(`${bucket}/${path}`)
          ? { path, error: null, signedURL: `/object/sign/${bucket}/${path}?token=fake-token-${Date.now()}` }
          : { path, error: "Object not found", signedURL: null },
      ),
    )
  }),

  // Remove (`remove([paths])`): answers with the objects actually deleted.
  http.delete(`${BASE_URL}/storage/v1/object/:bucket`, async ({ request, params }) => {
    const { bucket } = params
    const { prefixes = [] } = await request.json()
    const removed = prefixes.filter((path) => storageObjects.delete(`${bucket}/${path}`))
    return HttpResponse.json(removed.map((name) => ({ name, bucket_id: bucket })))
  }),

  // The `/sign/...` routes are registered FIRST and must stay that way: MSW
  // matches in registration order, and the generic `:bucket/*` upload/download
  // routes below would otherwise swallow "sign" as the bucket name.

  // Signed URL — the response is a relative path; supabase-js prefixes it
  // with the storage base URL itself, so the fake returns it the same way.
  http.post(`${BASE_URL}/storage/v1/object/sign/:bucket/*`, async ({ request, params }) => {
    const { bucket } = params
    const path = pathAfter(request, `/storage/v1/object/sign/${bucket}/`)
    const key = `${bucket}/${path}`

    if (!storageObjects.has(key)) return storageError("Object not found", 404)

    return HttpResponse.json({
      signedURL: `/object/sign/${bucket}/${path}?token=fake-token-${Date.now()}`,
    })
  }),

  // The signed URL itself — what a browser fetches directly (an <img src>,
  // for instance), separate from the authenticated call above that mints it.
  http.get(`${BASE_URL}/storage/v1/object/sign/:bucket/*`, ({ request, params }) => {
    const { bucket } = params
    const path = pathAfter(request, `/storage/v1/object/sign/${bucket}/`).split("?")[0]
    const object = storageObjects.get(`${bucket}/${path}`)

    if (!object) return new HttpResponse(null, { status: 404 })
    return new HttpResponse(object.bytes, { headers: { "Content-Type": object.contentType } })
  }),

  // Upload — supabase-js posts the file as multipart FormData under an
  // empty-string field name; see @supabase/storage-js's uploadOrUpdate().
  http.post(`${BASE_URL}/storage/v1/object/:bucket/*`, async ({ request, params }) => {
    const { bucket } = params
    const path = pathAfter(request, `/storage/v1/object/${bucket}/`)
    const key = `${bucket}/${path}`
    const config = BUCKETS[bucket]

    if (!config) return storageError(`Bucket "${bucket}" not found`, 404)

    const upsert = request.headers.get("x-upsert") === "true"
    if (storageObjects.has(key) && !upsert) {
      return storageError(`The resource already exists`, 409)
    }

    const formData = await request.formData()
    const file = formData.get("")
    if (!file) return storageError("No file in upload request", 400)

    const bytes = await file.arrayBuffer()
    const contentType = file.type || "application/octet-stream"

    if (bytes.byteLength > config.maxBytes) {
      return storageError(
        `The object exceeds the maximum allowed size (${config.maxBytes} bytes)`,
        413,
      )
    }
    if (config.allowedMimeTypes && !config.allowedMimeTypes.includes(contentType)) {
      return storageError(`mime type ${contentType} is not supported`, 415)
    }

    storageObjects.set(key, { bytes, contentType })

    return HttpResponse.json({ Id: crypto.randomUUID(), Key: key })
  }),

  // Plain authenticated download — the counterpart of upload, for a caller
  // that wants the bytes directly rather than a link to hand to an <img>.
  http.get(`${BASE_URL}/storage/v1/object/:bucket/*`, ({ request, params }) => {
    const { bucket } = params
    const path = pathAfter(request, `/storage/v1/object/${bucket}/`)
    const object = storageObjects.get(`${bucket}/${path}`)

    if (!object) return new HttpResponse(null, { status: 404 })
    return new HttpResponse(object.bytes, { headers: { "Content-Type": object.contentType } })
  }),
]
