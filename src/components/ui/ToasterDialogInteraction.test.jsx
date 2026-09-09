/**
 * Regression coverage for #175 — toasts raised while a modal `<Dialog>` is
 * open must stay reachable. The app renders exactly one `<Toaster/>`, mounted
 * once at boot (src/main.jsx), wrapped in an `aria-live` region so that a
 * dialog opening later does not mark it aria-hidden for the rest of its
 * lifetime — a toast raised afterwards would otherwise inherit that from an
 * ancestor that was already inert before the toast (or its own aria-live)
 * ever existed. This test reproduces that exact shape: a real `<Dialog>` from
 * `@/components/ui/dialog` (the primitive `OpportunityDetailsModal` uses)
 * mounted alongside a real `<Toaster/>`, wrapped the same way `main.jsx` does.
 */

import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import toast, { Toaster, resolveValue } from "react-hot-toast";
import { renderWithProviders } from "@/test/support";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CustomToast, confirmDeleteToast } from "./CustomToast";

// react-hot-toast reads matchMedia (prefers-reduced-motion) once a toast
// actually renders; jsdom has no implementation of its own.
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

function AppShell({ children }) {
  return (
    <div aria-live="polite" aria-atomic="false" className="contents">
      <Toaster position="top-center">
        {(t) =>
          t.type === "custom" ? resolveValue(t.message, t) : <CustomToast t={t} />
        }
      </Toaster>
      {children}
    </div>
  );
}

function ModalWithToastTrigger({ onRaiseToast }) {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogTitle>A modal</DialogTitle>
        <button onClick={onRaiseToast}>Raise toast</button>
      </DialogContent>
    </Dialog>
  );
}

describe("toasts raised while a modal Dialog is open (#175)", () => {
  it("mounts exactly one toast container", () => {
    renderWithProviders(
      <AppShell>
        <ModalWithToastTrigger onRaiseToast={() => {}} />
      </AppShell>,
    );

    expect(document.querySelectorAll("[data-rht-toaster]")).toHaveLength(1);
  });

  it("can be dismissed while the modal is open", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <ModalWithToastTrigger onRaiseToast={() => toast.success("Saved.")} />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Raise toast" }));
    const message = await screen.findByText("Saved.");

    const toastRegion = document.querySelector("[data-rht-toaster]");
    const dismissButton = within(toastRegion).getAllByRole("button")[0];
    await user.click(dismissButton);

    // react-hot-toast keeps a dismissed toast mounted for its exit animation
    // (removed from the DOM only after a delay), so the reachable assertion
    // is that the click actually registered — the toast's own card flips
    // into its dismissed/invisible state — not that it vanished outright.
    const toastCard = message.closest(".pointer-events-auto");
    await waitFor(() => {
      expect(toastCard.className).toMatch(/animate-out/);
    });
  });

  it("lets a delete confirmation raised inside the modal be confirmed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <AppShell>
        <ModalWithToastTrigger
          onRaiseToast={() => confirmDeleteToast("Delete this?", "This cannot be undone.", onConfirm)}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Raise toast" }));
    const message = await screen.findByText("Delete this?");
    const confirmButton = await screen.findByRole("button", { name: "Confirm Deletion" });
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const toastCard = message.closest(".pointer-events-auto");
    await waitFor(() => {
      expect(toastCard.className).toMatch(/animate-out/);
    });
  });

  it("lets a delete confirmation raised inside the modal be cancelled", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(
      <AppShell>
        <ModalWithToastTrigger
          onRaiseToast={() => confirmDeleteToast("Delete this?", "This cannot be undone.", onConfirm)}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Raise toast" }));
    const message = await screen.findByText("Delete this?");
    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    await user.click(cancelButton);

    expect(onConfirm).not.toHaveBeenCalled();
    const toastCard = message.closest(".pointer-events-auto");
    await waitFor(() => {
      expect(toastCard.className).toMatch(/animate-out/);
    });
  });

  it("positions a delete confirmation the same as every other toast", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <ModalWithToastTrigger
          onRaiseToast={() => confirmDeleteToast("Delete this?", "This cannot be undone.", () => {})}
        />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Raise toast" }));
    await screen.findByText("Delete this?");

    // react-hot-toast positions each toast wrapper by inline style, keyed off
    // `toast.position || defaultPosition`. Top positions render
    // `justifyContent: flex-start`; bottom positions (what this toast used to
    // hard-code) render `flex-end`. Confirming there's no `flex-end` wrapper
    // proves this toast picked up the toaster's default position instead of
    // overriding it.
    const wrappers = document.querySelectorAll("[data-rht-toaster] > div > div");
    for (const wrapper of wrappers) {
      expect(wrapper.style.justifyContent).not.toBe("flex-end");
    }
  });
});
