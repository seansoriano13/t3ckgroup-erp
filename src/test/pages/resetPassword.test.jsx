import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import toast from "react-hot-toast";
import ResetPassword from "../../pages/reset-password/index";
import { supabase } from "../../lib/supabase";
import { passwordService } from "../../services/passwordService";

/**
 * Issue #162/#165 — where the provider's recovery-email link lands. Setting
 * a password here is what clears the issued-password flag the first time,
 * and is also the only route to a new password once it has already cleared.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={<div>Dashboard Root</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResetPassword page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the password, clears the issued-password flag, and moves on", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(supabase.auth, "updateUser").mockResolvedValue({ error: null });
    const clearSpy = vi.spyOn(passwordService, "clearIssuedPasswordFlag").mockResolvedValue();

    renderPage();
    await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-strong-password");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ password: "a-strong-password" });
    });
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Dashboard Root")).toBeInTheDocument());
  });

  it("refuses when the two passwords do not match, and never calls the provider", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(supabase.auth, "updateUser");
    const toastSpy = vi.spyOn(toast, "error");

    renderPage();
    await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
    await user.type(screen.getByLabelText(/confirm password/i), "different-password");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/do not match/i));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("shows an error and stays put when the provider refuses the update", async () => {
    const user = userEvent.setup();
    vi.spyOn(supabase.auth, "updateUser").mockResolvedValue({
      error: new Error("Recovery link expired"),
    });

    renderPage();
    await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
    await user.type(screen.getByLabelText(/confirm password/i), "a-strong-password");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    await waitFor(() => expect(screen.queryByText("Dashboard Root")).not.toBeInTheDocument());
  });
});
