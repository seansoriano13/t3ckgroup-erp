import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Image } from "./image";
import { ExternalLink } from "./external-link";

describe("Image", () => {
  it("passes src, alt and className through untouched", () => {
    render(<Image src="/a.png" alt="Logo" className="h-4" />);
    const img = screen.getByAltText("Logo");
    expect(img).toHaveAttribute("src", "/a.png");
    expect(img).toHaveClass("h-4");
  });
});

describe("ExternalLink", () => {
  it("opens in a new tab with no opener leakage", () => {
    render(<ExternalLink href="https://x.test">Go</ExternalLink>);
    const a = screen.getByText("Go");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toMatch(/noopener/);
    expect(a.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("keeps safe rel even if caller passes rel", () => {
    render(<ExternalLink href="https://x.test" rel="nofollow">Go</ExternalLink>);
    expect(screen.getByText("Go").getAttribute("rel")).toMatch(/noopener.*nofollow|nofollow.*noopener/);
  });
});
