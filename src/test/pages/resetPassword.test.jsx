import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setupUser } from "@/test/support";
import { MemoryRouter, Routes, Route } from "react-router";
import toast from "react-hot-toast";
import ResetPassword from "../../pages/reset-password/index";
import { __resetRecoveryRedemption } from "../../lib/recoveryToken";
import { isRecoveryActive, markRecoveryActive, clearRecoveryActive } from "../../lib/recoveryFlag";
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

/**
 * A legacy `/auth/v1/verify` landing: already exchanged, so the page asks
 * getSession() rather than redeeming anything. The cases that exercise the
 * form itself use this, because a URL with no recovery token at all is now
 * landing (c) and never reaches the form.
 */
const RECOVERY_HASH = "#access_token=x&refresh_token=y&type=recovery";

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
    clearRecoveryActive();
    stubLocation();
  });

  it("updates the password, clears the issued-password flag, and reloads into the app", async () => {
    const assign = stubLocation({ hash: RECOVERY_HASH });
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
    stubLocation({ hash: RECOVERY_HASH });
    stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });
    const updateSpy = vi.spyOn(supabase.auth, "updateUser");

    renderPage();
    await screen.findByLabelText(/new password/i);
    const user = setupUser();
    await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
    await user.type(screen.getByLabelText(/confirm password/i), "different-password");
    await user.click(screen.getByRole("button", { name: /save password/i }));

    const confirm = screen.getByLabelText(/confirm password/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveFocus();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("flags an empty password inline and focuses it", async () => {
    stubLocation({ hash: RECOVERY_HASH });
    stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });
    const updateSpy = vi.spyOn(supabase.auth, "updateUser");

    renderPage();
    await screen.findByLabelText(/new password/i);
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: /save password/i }));

    const field = screen.getByLabelText(/new password/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/enter a password/i);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("drops back to the notice when the provider refuses the update", async () => {
    stubLocation({ hash: RECOVERY_HASH });
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

  // Landing (c). A signed-in employee who wanders onto the route has a real
  // session, so consulting getSession() would hand them the form; the way to
  // change a password you know is the profile screen.
  it("tells a signed-in visitor with no reset link to use the emailed one", async () => {
    stubLocation({ hash: "", search: "" });
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
      data: { session: { user: { id: "auth-1", email: "ana@t3ckgroup.test" } } },
      error: null,
    });
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/open this page from the link/i)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    // ...and it does not claim the link expired, because there was no link.
    expect(screen.queryByText(/open only once/i)).not.toBeInTheDocument();
  });

  // The refusal is about the password, not the session, so the form has to
  // stay up. Classifying on the word "invalid" used to replace it with the
  // expired-link notice and lose a perfectly good recovery session.
  it("keeps the form up when the provider refuses the password itself", async () => {
    stubLocation({ hash: RECOVERY_HASH });
    stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });
    const toastSpy = vi.spyOn(toast, "error");
    vi.spyOn(supabase.auth, "updateUser").mockResolvedValue({
      error: Object.assign(new Error("Password is invalid: it is too weak."), {
        name: "AuthWeakPasswordError",
        code: "weak_password",
        status: 422,
      }),
    });

    renderPage();
    await user_type_and_save();

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    expect(screen.queryByText(/can.?t reset your password/i)).not.toBeInTheDocument();
  });

  // main.jsx mounts the app in StrictMode, which runs every effect twice. The
  // recovery token_hash is single-use, so a second POST 403s as already-used
  // and the racing session writes can leave the client with no session at all
  // — the whole reason lib/recoveryToken.js caches per token.
  it("redeems a token_hash exactly once under StrictMode's double effect", async () => {
    stubLocation({ search: "?token_hash=strict_abc&type=recovery" });
    const verifySpy = vi
      .spyOn(supabase.auth, "verifyOtp")
      .mockResolvedValue({ data: { session: { user: { id: "auth-1" } } }, error: null });
    vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/reset-password"]}>
          <Routes>
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  // The hold is a localStorage key every tab can see and every tab can clear.
  // Only the tab that raised it may release it, or opening this route by hand
  // during someone's real reset drops the hold that reset depends on.
  describe("the cross-tab hold", () => {
    it("is raised for a real link and released when the reset is abandoned", async () => {
      stubLocation({ hash: RECOVERY_HASH });
      stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });

      const { unmount } = renderPage();
      await screen.findByLabelText(/new password/i);
      expect(isRecoveryActive()).toBe(true);

      unmount();
      expect(isRecoveryActive()).toBe(false);
    });

    it("is released when the tab goes away, but not into the bfcache", async () => {
      stubLocation({ hash: RECOVERY_HASH });
      stubRecoverySession({ user: { id: "auth-1", email: "ana@t3ckgroup.test" } });

      renderPage();
      await screen.findByLabelText(/new password/i);

      window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
      expect(isRecoveryActive()).toBe(true);

      window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: false }));
      expect(isRecoveryActive()).toBe(false);
    });

    it("is left alone by a tab that never raised it", async () => {
      // Another tab has a genuine reset in flight.
      markRecoveryActive();
      stubLocation({ hash: "", search: "" });
      vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
        data: { session: { user: { id: "auth-1" } } },
        error: null,
      });
      vi.spyOn(supabase.auth, "onAuthStateChange").mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      });

      const { unmount } = renderPage();
      await screen.findByText(/open this page from the link/i);
      expect(isRecoveryActive()).toBe(true);

      unmount();
      expect(isRecoveryActive()).toBe(true);
    });
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
    stubLocation({ hash: RECOVERY_HASH });
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

    expect(screen.getByText(/loading your reset link/i)).toBeInTheDocument();
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
  const user = setupUser();
  await user.type(screen.getByLabelText(/new password/i), "a-strong-password");
  await user.type(screen.getByLabelText(/confirm password/i), "a-strong-password");
  await user.click(screen.getByRole("button", { name: /save password/i }));
}
