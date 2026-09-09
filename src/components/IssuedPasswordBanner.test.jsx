import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IssuedPasswordBanner from "./IssuedPasswordBanner";
import * as AuthContext from "../context/AuthContext";

/**
 * Issue #162/#165, Seam E — shown while on an issued password, absent
 * afterwards, dismissible without blocking anything.
 */
describe("IssuedPasswordBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function mockUser(overrides) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({ user: overrides });
  }

  it("is shown while the employee is on an issued password", () => {
    mockUser({ isIssuedPassword: true });
    render(<IssuedPasswordBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("is absent once the flag has cleared", () => {
    mockUser({ isIssuedPassword: false });
    render(<IssuedPasswordBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is absent with no user at all", () => {
    mockUser(null);
    render(<IssuedPasswordBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recognizes the raw db-spelled flag too", () => {
    mockUser({ is_issued_password: true });
    render(<IssuedPasswordBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("can be dismissed, and stays dismissed across remounts, without blocking anything", async () => {
    const user = userEvent.setup();
    mockUser({ isIssuedPassword: true, email: "a@t3ckgroup.test" });
    const { unmount } = render(<IssuedPasswordBanner />);

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    unmount();
    render(<IssuedPasswordBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
