/**
 * The build fingerprint shown in Settings — a short commit SHA plus the
 * build date, so a support conversation can pin down exactly which deploy
 * an employee is running. Separate from the release number
 * (`__APP_SEMVER__`, sourced from src/data/changelog.json): two deploys can
 * share a version if no changelog entry was added, but never share a SHA.
 *
 * `__APP_VERSION__` doubles as this SHA in production (Vercel sets it to
 * VERCEL_GIT_COMMIT_SHA), but falls back to `Date.now()` for any build that
 * isn't running on Vercel — including `pnpm dev` — so it must not be shown
 * as if it were a SHA in that case.
 */
export function formatBuildFingerprint(rawVersion, buildTimeIso) {
  // Exactly 40 hex chars, matching a full git SHA — not a range, because a
  // range also matches the Date.now() fallback (digits are valid hex too),
  // which is what this check exists to tell apart from a real build.
  const isGitSha = typeof rawVersion === "string" && /^[0-9a-f]{40}$/i.test(rawVersion);

  if (!isGitSha) return "dev";

  const shortSha = rawVersion.slice(0, 7);
  const date = new Date(buildTimeIso);
  if (isNaN(date)) return shortSha;

  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${shortSha} · ${formattedDate}`;
}
