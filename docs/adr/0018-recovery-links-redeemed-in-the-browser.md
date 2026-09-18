# ADR 0018 — Recovery links are redeemed in the browser, not by GoTrue

## Status
Accepted

## Context

Password reset was effectively broken. The reset email used
`{{ .ConfirmationURL }}`, which points at GoTrue's `/auth/v1/verify` endpoint:
a **GET** that redeems the single-use recovery token on the first request it
receives, then 302s to the app.

Anything that fetches a URL makes that first request. Mail scanners follow every
link in a message before it reaches the inbox; browsers and mail clients prefetch
links they expect to be clicked. By the time the employee clicked, the token was
already spent, and the app showed a bare `AuthSessionMissingError` — which reads
as "the system is broken", not "your link was used".

Two further problems sat behind it. The page rendered the password form
immediately, before any recovery session was confirmed, so a dead link produced a
form that failed on Save rather than a notice. And a recovery session is written
to `localStorage`, which every open tab observes: a lingering `/login` tab saw
the cross-tab `SIGNED_IN`, tried to resolve an employee from it, found none, and
signed the session out from under the reset.

## Decision

**The email links straight at the SPA with `{{ .TokenHash }}`, and the token is
redeemed by `verifyOtp()` from the page — a POST.** Prefetchers and scanners
issue GETs, so the token survives until a real browser runs the reset screen.

Three consequences follow, and are the shape of the implementation:

1. **The form does not render until a recovery session exists.** The screen is a
   three-phase machine — `verifying` → `ready` | `invalid` — and tells the three
   landings apart: a token still being exchanged, a token GoTrue refused
   (`#error=access_denied&error_code=otp_expired…`), and arrival with no token at
   all. The last one is a notice pointing at the emailed link, *not* a form, even
   for a visitor who happens to be signed in — the way to change a password you
   already know is the profile screen.

2. **Redemption is cached per token.** React 18 StrictMode runs effects twice, a
   remount replays them, and this client's cross-tab lock is disabled. Without
   the cache the token is POSTed twice and the second call 403s as already-used.

3. **A cross-tab flag in `localStorage` holds the other tabs off** while a reset
   is in flight, and `AuthContext` skips only its session-bearing branch while it
   is set.

**Old links keep working.** They arrive already exchanged, as an implicit
`#access_token` fragment or a PKCE `?code`, which `detectSessionInUrl` handles.
This is what makes the deploy orderable: new code serves both formats, so the
code ships first and the dashboard template changes after.

## Consequences

- **The email template is not in this repo's deploy path.** `supabase/config.toml`
  drives only the local stack; staging and production each carry the body in
  their own dashboard, and no deploy updates them. The ordering is therefore
  load-bearing in one direction: code before template. A `token_hash` template
  pointed at an older deploy dead-ends every reset. `docs/pre-staging-checklist.md`
  §3 carries the routine.

- **The cross-tab flag is a hold that must always be released.** While it is set,
  `AuthContext`'s guard is on, and that guard sits on the only path that resolves
  the employee at boot — so a flag left behind makes every tab render signed-out
  until it expires. It is released on success, on a dead link, on unmount, and on
  `pagehide` (closing the tab is the likeliest abandonment, and React runs no
  cleanup for it), and it self-expires on a TTL as a backstop. Anything added to
  this flow inherits the obligation to release it.

- **What counts as a recovery landing is decided in one place**, `lib/recoveryLink.js`,
  because `lib/supabase.js` answers it at module load and the reset screen answers
  it again in an effect. When those were separate implementations they disagreed:
  a global boot snapshot let a Google OAuth `#access_token` fragment on `/login`
  be read as a recovery link after a client navigation, raising the hold with no
  reset in flight.

- **Custom SMTP is a prerequisite for testing this at all.** Supabase's built-in
  provider delivers only to members of the Supabase organisation and caps auth
  email at 2/hour, and the seed sanitiser keeps employee emails as-is — so an
  end-to-end reset cannot be exercised on a project without its own SMTP.

- Password-update failures are classified by GoTrue's error identity, not by
  matching words in the message. Keying on `invalid` swept in password-strength
  refusals and tore down a live recovery session for them.
