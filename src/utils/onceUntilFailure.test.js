import { describe, expect, it, vi } from "vitest";
import { onceUntilFailure } from "../../supabase/functions/_shared/onceUntilFailure.ts";

describe("onceUntilFailure", () => {
  it("runs the work once and hands every later caller the same answer", async () => {
    const work = vi.fn(async () => 42);
    const get = onceUntilFailure(work);

    expect(await get()).toBe(42);
    expect(await get()).toBe(42);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("shares one run between callers that ask at the same time", async () => {
    let finish;
    const work = vi.fn(() => new Promise((r) => (finish = r)));
    const get = onceUntilFailure(work);

    const a = get();
    const b = get();
    finish(7);

    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure, so the next caller tries again", async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(new Error("Odoo authentication failed"))
      .mockResolvedValueOnce(5);
    const get = onceUntilFailure(work);

    await expect(get()).rejects.toThrow("Odoo authentication failed");
    expect(await get()).toBe(5);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
