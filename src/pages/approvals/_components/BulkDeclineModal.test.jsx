import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import BulkDeclineModal from "./BulkDeclineModal";

function setup(isSubmitting) {
  const onConfirm = vi.fn();
  render(
    <BulkDeclineModal isOpen onClose={() => {}} selectedCount={2} onConfirm={onConfirm} isSubmitting={isSubmitting} />,
  );
  return onConfirm;
}

describe("BulkDeclineModal", () => {
  it("confirms once on Ctrl+Enter when idle", async () => {
    const user = setupUser();
    const onConfirm = setup(false);
    await user.type(screen.getByPlaceholderText(/please revise/i), "redo");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Ctrl+Enter and form Enter while submitting", async () => {
    const user = setupUser();
    const onConfirm = setup(true);
    await user.type(screen.getByPlaceholderText(/please revise/i), "redo{Enter}");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
