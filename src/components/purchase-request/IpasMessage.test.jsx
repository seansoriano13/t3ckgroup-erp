import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import IpasMessage from "./IpasMessage";

describe("IpasMessage (#855)", () => {
  it("links the IPAS number to its page in the app", () => {
    render(<MemoryRouter><IpasMessage message="IPAS-0007 was raised for P01234." ipasId="abc" ipasNumber="IPAS-0007" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "IPAS-0007" }).getAttribute("href")).toBe("/purchasing/ipas/abc");
  });
  it("stays plain text with no id", () => {
    render(<IpasMessage message="IPAS-0007 was raised." ipasNumber="IPAS-0007" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
