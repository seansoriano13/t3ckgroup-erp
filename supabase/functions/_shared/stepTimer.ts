// Times the parts of one edge function call, so the function logs can say which
// part is slow (#1266: one OPEX read still takes about 3 seconds).
//
// Steps may run side by side; each is timed on its own. A step that fails is
// still timed, and its error is passed on. A label used twice adds up.

export function createStepTimer(now: () => number = () => performance.now()) {
  const start = now();
  const steps = new Map<string, number>();

  async function time<T>(label: string, work: () => Promise<T>): Promise<T> {
    const t0 = now();
    try {
      return await work();
    } finally {
      steps.set(label, (steps.get(label) ?? 0) + (now() - t0));
    }
  }

  function summary() {
    const out: Record<string, number> = {};
    for (const [label, ms] of steps) out[label] = Math.round(ms);
    return { totalMs: Math.round(now() - start), steps: out };
  }

  return { time, summary };
}

export type StepTimer = ReturnType<typeof createStepTimer>;
