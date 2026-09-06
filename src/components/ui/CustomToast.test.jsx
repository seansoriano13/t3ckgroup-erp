/**
 * Tests for `undoableSuccessToast` — the shared helper that replaced the dead
 * `toast.success({ action: ... })` pattern across the app (#96).
 *
 * react-hot-toast's `toast.success` ignores any `action` option, so the Undo
 * button never rendered. `undoableSuccessToast` uses `toast.custom` instead,
 * passing the action through the custom toast renderer so it actually appears.
 */

import { screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import toast from "react-hot-toast";
import { renderWithProviders } from "@/test/support";
import { CustomToast, undoableSuccessToast } from "./CustomToast";

describe("undoableSuccessToast", () => {
  let customSpy;

  beforeEach(() => {
    // Intercept toast.custom and render the JSX it receives so we can
    // assert on the Undo button without needing a real Toaster singleton.
    customSpy = vi.spyOn(toast, "custom").mockImplementation((renderFn) => {
      const fakeToastObj = { id: "test-id", visible: true };
      renderWithProviders(renderFn(fakeToastObj));
      return "test-id";
    });
  });

  it("renders the success message and the Undo button", async () => {
    act(() => {
      undoableSuccessToast("5 tasks verified successfully.", "Undo", vi.fn(), 6000);
    });

    expect(await screen.findByText("5 tasks verified successfully.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("calls the onUndo handler when the Undo button is clicked", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();

    act(() => {
      undoableSuccessToast("3 tasks approved.", "Undo", onUndo, 6000);
    });

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("uses toast.custom (not toast.success) so the action is not silently dropped", () => {
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "id");

    act(() => {
      undoableSuccessToast("2 tasks declined.", "Undo", vi.fn(), 6000);
    });

    expect(customSpy).toHaveBeenCalledTimes(1);
    expect(successSpy).not.toHaveBeenCalled();
  });

  it("passes the correct duration to toast.custom", () => {
    act(() => {
      undoableSuccessToast("msg", "Undo", vi.fn(), 8000);
    });

    expect(customSpy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ duration: 8000 }),
    );
  });
});
