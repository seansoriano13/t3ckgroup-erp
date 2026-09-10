import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import toast from "react-hot-toast";
import ResetPassword from "../../pages/reset-password/index";
import { __resetRecoveryRedemption } from "../../lib/recoveryToken";
import { supabase } from "../../lib/supabase";
import { passwordService } from "../../services/passwordService";

/**
 * Issue #162/#165 — where the provider's recovery-email link lands. Setting
 * a password here is what clears the issued-password flag the first time,
 * and is also the only route to a new password once it has already cleared.
 *
 * The page will not show the form until it has confirmed a live recovery
 * session, and a spent or timed-out link (URL carries `#error=…`, or no
 * session ever arrives) shows an expired-link notice instead.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<div>Login Screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A recovery session is (or isn't) in place, and no auth event follows. */
function stubRecoverySession(session) {
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
    data: { session },
    error: null,
  });
  vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
}

/**
 * jsdom's Location methods cannot be spied on, so the object is swapped for a
 * stand-in. A finished reset leaves via window.location.assign("/").
 */
function stubLocation({ hash = "", search = "" } = {}) {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: "/reset-password", hash, search, assign },
  });
  return assign;
}

describe("ResetPassword page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetRecoveryRedemption();
    stubLocation();
  });

  it("updates the password, clears the issued-password flag, and reloads into the app", async () => {
    const assign = stubLocation();
    stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });
    const updateSpy = vi.spyOn(supabase.auth, "updateUser").mockResolvedValue({ error: null });
    const clearSpy = vi.spyOn(passwordService, "clearIssuedPasswordFlag").mockResolvedValue();

    renderPage();
    await user_type_and_save();

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ password: "a-strong-password" });
    });
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("refuses when the two passwords do not match, and never calls the provider", async () => {
    stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });
    const updateSpy = vi.spyOn(supabase.auth, "updateUser");
    const toastSpy = vi.spyOn(toast, "error");

    renderPage();
    await screen.findByLabelText(/new password/i);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
    await user.type(screen.getByLabelText(/confirm password/i), "different-password");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/do not match/i));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("drops back to the notice when the provider refuses the update", async () => {
    stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });
    vi.spyOn(supabase.auth, "updateUser").mockResolvedValue({
      error: new Error("Auth session missing!"),
    });

    renderPage();
    await user_type_and_save();

    await waitFor(() =>
      expect(screen.getByText(/can.?t reset your password/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /back to login/i })).toBeInTheDocument();
  });

  it("shows the notice, with GoTrue's reason, when the URL comes back with an error", async () => {
    stubLocation({
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    });
    stubRecoverySession(null);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/can.?t reset your password/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Email link is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("treats a missing recovery session as a spent link once verification settles", async () => {
    stubLocation({ hash: "#access_token=x&refresh_token=y&type=recovery" });
    stubRecoverySession(null);

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/expired, or it has already been opened/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("shows the verifying state until the session resolves", async () => {
    let resolveSession;
    vi.spyOn(supabase.auth, "getSession").mockReturnValue(
      new Promise((r) => {
        resolveSession = r;
      }),
    );
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    renderPage();

    expect(screen.getByText(/verifying your reset link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();

    resolveSession({ data: { session: { user: { id: "auth-1" } } }, error: null });
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
  });

  it("redeems a token_hash link through verifyOtp, then shows the form", async () => {
    stubLocation({ search: "?token_hash=pkce_abc123&type=recovery" });
    const verifySpy = vi
      .spyOn(supabase.auth, "verifyOtp")
      .mockResolvedValue({ data: { session: { user: { id: "auth-1" } } }, error: null });
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
    expect(verifySpy).toHaveBeenCalledWith({ token_hash: "pkce_abc123", type: "recovery" });
  });

  it("shows the notice when verifyOtp rejects the token_hash", async () => {
    stubLocation({ search: "?token_hash=spent&type=recovery" });
    vi.spyOn(supabase.auth, "verifyOtp").mockResolvedValue({
      data: { session: null },
      error: new Error("Token has expired or is invalid"),
    });
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Token has expired or is invalid/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});

/** Fills a matching password pair and submits, once the form is on screen. */
async function user_type_and_save() {
  await screen.findByLabelText(/new password/i);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
  await user.type(screen.getByLabelText(/confirm password/i), "a-strong-password");
  await user.click(screen.getByRole("button", { name: /save password/i }));
}
