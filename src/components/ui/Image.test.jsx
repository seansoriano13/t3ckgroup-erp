import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import { Image } from "./Image"

describe("Image", () => {
  it("shows the picture at the given address, named by its alt text", () => {
    render(<Image src="/banner.jpg" alt="Company banner" />)
    const img = screen.getByRole("img", { name: "Company banner" })
    expect(img).toHaveAttribute("src", "/banner.jpg")
  })

  it("passes the address through untouched, with no rewriting", () => {
    const url = "https://res.cloudinary.com/x/image/upload/v1/a.jpg?w=10"
    render(<Image src={url} alt="Remote" />)
    expect(screen.getByRole("img", { name: "Remote" })).toHaveAttribute("src", url)
  })

  it("is hidden from assistive technology when decorative (empty alt)", () => {
    const { container } = render(<Image src="/leaf.jpg" alt="" />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(container.querySelector("img")).toHaveAttribute("alt", "")
  })

  it("forwards native props such as referrerPolicy and class names", () => {
    render(<Image src="/a.png" alt="A" referrerPolicy="no-referrer" className="size-8 object-cover" />)
    const img = screen.getByRole("img", { name: "A" })
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(img).toHaveClass("size-8", "object-cover")
  })
})
