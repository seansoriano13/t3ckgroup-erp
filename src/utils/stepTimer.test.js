import { describe, expect, it } from "vitest";
import { createStepTimer } from "../../supabase/functions/_shared/stepTimer.ts";

// A clock the test moves by hand.
function fakeClock() {
  let t = 1000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("createStepTimer", () => {
  it("records how long each step took, in whole milliseconds", async () => {
    const clock = fakeClock();
    const timer = createStepTimer(clock.now);
    const answer = await timer.time("authenticate", async () => {
      clock.advance(812.4);
      return 7;
    });
    await timer.time("round1", async () => clock.advance(300.6));

    expect(answer).toBe(7);
    expect(timer.summary()).toEqual({ totalMs: 1113, steps: { authenticate: 812, round1: 301 } });
  });

  it("times steps that run side by side on their own", async () => {
    const clock = fakeClock();
    const timer = createStepTimer(clock.now);
    let release;
    const gate = new Promise((r) => (release = r));
    const slow = timer.time("slow", async () => {
      await gate;
      clock.advance(500);
    });
    const fast = timer.time("fast", async () => clock.advance(100));
    await fast;
    release();
    await slow;

    expect(timer.summary().steps).toEqual({ fast: 100, slow: 600 });
  });

  it("still records a step that failed, and passes the error on", async () => {
    const clock = fakeClock();
    const timer = createStepTimer(clock.now);
    await expect(
      timer.time("round3", async () => {
        clock.advance(2000);
        throw new Error("Odoo did not answer");
      }),
    ).rejects.toThrow("Odoo did not answer");

    expect(timer.summary().steps).toEqual({ round3: 2000 });
  });

  it("adds up a step that runs more than once", async () => {
    const clock = fakeClock();
    const timer = createStepTimer(clock.now);
    await timer.time("chunk", async () => clock.advance(40));
    await timer.time("chunk", async () => clock.advance(60));

    expect(timer.summary().steps).toEqual({ chunk: 100 });
  });
});
