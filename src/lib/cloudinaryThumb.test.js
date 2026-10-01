import { describe, expect, it } from "vitest"
import { cloudinaryThumb } from "./cloudinaryThumb"

/**
 * Previews and avatars were loading the full upload (about 300 KB, up to
 * 1920px) to fill a box a few hundred pixels wide. Cloudinary resizes on the
 * fly when the delivery URL carries a transformation, so a preview asks for a
 * small copy and the full file is fetched only when someone opens it.
 */
describe("cloudinaryThumb", () => {
  const original = "https://res.cloudinary.com/dz83w2ck8/image/upload/v1712345678/task-attachments/abc.jpg"

  it("asks Cloudinary for a resized, auto-format copy of an uploaded image", () => {
    expect(cloudinaryThumb(original, { width: 400 })).toBe(
      "https://res.cloudinary.com/dz83w2ck8/image/upload/c_limit,w_400,q_auto,f_auto/v1712345678/task-attachments/abc.jpg",
    )
  })

  it("crops to a square when a height is given (avatars)", () => {
    expect(cloudinaryThumb(original, { width: 96, height: 96 })).toBe(
      "https://res.cloudinary.com/dz83w2ck8/image/upload/c_fill,w_96,h_96,q_auto,f_auto/v1712345678/task-attachments/abc.jpg",
    )
  })

  it.each([
    ["a Cloudinary video", "https://res.cloudinary.com/c/video/upload/v1/task-attachments/clip.mp4"],
    ["a Cloudinary raw file", "https://res.cloudinary.com/c/raw/upload/v1/task-attachments/report.pdf"],
    ["a Supabase signed URL", "https://x.supabase.co/storage/v1/object/sign/bug-reports/a.png?token=t"],
    ["a local preview", "blob:http://localhost/123"],
    ["a data URI", "data:image/gif;base64,R0lGOD"],
    ["a Google profile photo", "https://lh3.googleusercontent.com/a/abc=s96-c"],
  ])("leaves %s untouched", (_label, url) => {
    expect(cloudinaryThumb(url, { width: 400 })).toBe(url)
  })

  it("leaves a URL that already carries a transformation untouched", () => {
    const transformed = "https://res.cloudinary.com/c/image/upload/w_200/v1/a.jpg"
    expect(cloudinaryThumb(transformed, { width: 400 })).toBe(transformed)
  })

  it("passes empty values through", () => {
    expect(cloudinaryThumb(null, { width: 400 })).toBeNull()
    expect(cloudinaryThumb("", { width: 400 })).toBe("")
  })
})
