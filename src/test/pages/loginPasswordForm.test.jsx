import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setupUser } from "@/test/support";
import { MemoryRouter, Routes, Route } from "react-router";
import toast from "react-hot-toast";
import Login from "../../pages/login/index";
import * as AuthContext from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { passwordService } from "../../services/passwordService";

// Issue #162/#163 — the password form used to be a disabled test fixture,
// gated behind VITE_ALLOW_TEST_LOGIN. It is now a real, ordinary route: no
// env flag, no pre-filled credentials, no disabled styling.
vi.mock("@react-oauth/google", () => ({
  GoogleLogin: () => <button type="button">Sign in with Google</button>,
}));

function renderLoggedOut() {
  vi.spyOn(AuthContext, "useAuth").mockReturnValue({
    user: null,
    isAuthLoading: false,
    handleLogin: vi.fn().mockResolvedValue(true),
  });

  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div>Dashboard Root</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Login password form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders enabled, empty email and password fields", () => {
    renderLoggedOut();
    const email = screen.getByPlaceholderText("name@t3ckgroup.com");
    const password = screen.getByPlaceholderText("••••••••");

    expect(email).not.toBeDisabled();
    expect(password).not.toBeDisabled();
    expect(email).toHaveValue("");
    expect(password).toHaveValue("");
    expect(screen.queryByText("(Disabled)")).not.toBeInTheDocument();
  });

  it("flags empty fields inline, sets aria-invalid and focuses the first bad one", async () => {
    const signIn = vi.spyOn(supabase.auth, "signInWithPassword");
    renderLoggedOut();
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const email = screen.getByPlaceholderText("name@t3ckgroup.com");
    const password = screen.getByPlaceholderText("••••••••");
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(signIn).not.toHaveBeenCalled();

    await user.type(email, "ana@t3ckgroup.test");
    expect(email).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(password).toHaveFocus();
  });

  it("submits with signInWithPassword and proceeds on success", async () => {
    const user = setupUser();
    vi.spyOn(supabase.auth, "signInWithPassword").mockResolvedValue({
      data: { user: { email: "a@t3ckgroup.test" } },
      error: null,
    });

    renderLoggedOut();
    await user.type(screen.getByPlaceholderText("name@t3ckgroup.com"), "a@t3ckgroup.test");
    await user.type(screen.getByPlaceholderText("••••••••"), "issued-pass-1");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "a@t3ckgroup.test",
        password: "issued-pass-1",
      });
    });
    await waitFor(() => expect(screen.getByText("Dashboard Root")).toBeInTheDocument());
  });

  it("shows a useful error and does not navigate when sign-in fails", async () => {
    const user = setupUser();
    const toastSpy = vi.spyOn(toast, "error");
    vi.spyOn(supabase.auth, "signInWithPassword").mockResolvedValue({
      data: null,
      error: new Error("Invalid login credentials"),
    });

    renderLoggedOut();
    await user.type(screen.getByPlaceholderText("name@t3ckgroup.com"), "a@t3ckgroup.test");
    await user.type(screen.getByPlaceholderText("••••••••"), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/incorrect email or password/i));
    });
    expect(screen.queryByText("Dashboard Root")).not.toBeInTheDocument();
  });

  it("sends a reset email through Forgot password? without submitting the form", async () => {
    const user = setupUser();
    const resetSpy = vi.spyOn(passwordService, "requestPasswordReset").mockResolvedValue();
    const signInSpy = vi.spyOn(supabase.auth, "signInWithPassword");

    renderLoggedOut();
    await user.type(screen.getByPlaceholderText("name@t3ckgroup.com"), "a@t3ckgroup.test");
    await user.click(screen.getByRole("button", { name: /forgot password/i }));

    await waitFor(() => expect(resetSpy).toHaveBeenCalledWith("a@t3ckgroup.test"));
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it("sends one sign-in request on repeated Enter and disables the button in flight", async () => {
    const user = setupUser();
    let resolve;
    const signInSpy = vi.spyOn(supabase.auth, "signInWithPassword").mockReturnValue(
      new Promise((r) => { resolve = r; }),
    );

    renderLoggedOut();
    await user.type(screen.getByPlaceholderText("name@t3ckgroup.com"), "a@t3ckgroup.test");
    await user.type(screen.getByPlaceholderText("••••••••"), "pw{Enter}{Enter}{Enter}");

    expect(signInSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
    resolve({ data: null, error: new Error("x") });
    await waitFor(() => expect(screen.getByRole("button", { name: /^sign in$/i })).not.toBeDisabled());
  });

  it("sends one reset email on repeated Forgot password? clicks", async () => {
    const user = setupUser();
    let resolve;
    const resetSpy = vi.spyOn(passwordService, "requestPasswordReset").mockReturnValue(
      new Promise((r) => { resolve = r; }),
    );

    renderLoggedOut();
    await user.type(screen.getByPlaceholderText("name@t3ckgroup.com"), "a@t3ckgroup.test");
    const btn = screen.getByRole("button", { name: /forgot password/i });
    await user.click(btn);
    await user.click(btn);

    expect(resetSpy).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
