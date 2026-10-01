import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { AttachmentList } from "./Attachments"
import { AttachmentEvidence } from "./AttachmentEvidence"
import Avatar from "../Avatar"

/**
 * Small boxes show a small Cloudinary copy; opening the file still fetches
 * the original. See lib/cloudinaryThumb.
 */
const photo = "https://res.cloudinary.com/c/image/upload/v1/task-attachments/photo.jpg"

describe("Cloudinary thumbnails", () => {
  it("an attachment list shows a resized preview but links to the original", () => {
    render(<AttachmentList attachments={[{ url: photo, name: "photo.jpg", type: "image/jpeg" }]} />)

    const img = screen.getByAltText("photo.jpg")
    expect(img).toHaveAttribute("src", "https://res.cloudinary.com/c/image/upload/c_limit,w_320,q_auto,f_auto/v1/task-attachments/photo.jpg")
    expect(img.closest("a")).toHaveAttribute("href", photo)
  })

  it("procurement reference photos use a small square thumbnail", () => {
    render(<AttachmentEvidence attachments={[{ url: photo, name: "ref.jpg", type: "image/jpeg" }]} />)

    expect(screen.getByAltText("ref.jpg")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/c/image/upload/c_fill,w_96,h_96,q_auto,f_auto/v1/task-attachments/photo.jpg",
    )
  })

  it("an avatar asks for a 96px square instead of the full upload", () => {
    render(<Avatar name="Ana Reyes" src={photo} />)

    expect(screen.getByAltText("Ana Reyes")).toHaveAttribute(
      "src",
      "https://res.cloudinary.com/c/image/upload/c_fill,w_96,h_96,q_auto,f_auto/v1/task-attachments/photo.jpg",
    )
  })

  it("an avatar from anywhere else is left alone", () => {
    const google = "https://lh3.googleusercontent.com/a/abc=s96-c"
    render(<Avatar name="Ana Reyes" src={google} />)

    expect(screen.getByAltText("Ana Reyes")).toHaveAttribute("src", google)
  })
})
