import { screen, waitFor } from "@testing-library/react";

/**
 * The record pages (IPAS, Transmittal, Packing List) are a modal over their list, so the
 * record is itself a dialog. These two ask about the dialogs opened over it (a drawer, a
 * confirmation, a form) and leave the record out: a wide ModalShell carries
 * `data-modal-shell="wide"`.
 */
const others = () => screen.queryAllByRole("dialog").filter((dialog) => dialog.dataset.modalShell !== "wide");

/** The first dialog open over the record, or null. */
export const queryOtherDialog = () => others()[0] ?? null;

/** Waits for a dialog to open over the record, and returns the first one. */
export const findOtherDialog = () =>
  waitFor(() => {
    const [dialog] = others();
    if (!dialog) throw new Error("No dialog is open over the record.");
    return dialog;
  });
