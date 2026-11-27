// Runs `work` once and hands every later caller the same answer, including
// callers that ask while the first run is still going. A failed run is
// forgotten, so the next caller tries again (#1266: remember the Odoo login
// while an edge function stays warm, instead of signing in on every read).

export function onceUntilFailure<T>(work: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = work().catch((e) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
}
