# Accounts E2E tracker (2026-11-20)

A Playwright pass over the **Accounts** module (Login, Forgot password, the reset-password page, My Profile, and the public Verify page for printed forms) on the hosted staging site (commit `a22f306f`, What's New shows v1.11.5), driven with `playwright-cli`, a few `run-code` scripts, and API calls with each person's own token.
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1133** and its sub-issues (see the Ticket column).

**Three findings are tracked privately until they are fixed** (IDs A1 to A3). Their details will be added to this file once the fix is on production.

**How it was checked**

- 6 mock logins on staging, each in its own browser session: Dani (Sales Executive, no special rights), Jen (head), Geane (HR), 101 (Super Admin), Jade (no flows), plus a signed-out browser.
- Login: empty fields, email only, wrong password, unknown email, capitals, spaces around the email, a badly typed email, "Forgot password?" with an empty, unknown and badly typed email, the return to the page asked for before sign-in, a signed-in visit to `/login`, sign out and the Back button.
- Reset page: no link, a made-up `token_hash`, an expired-link fragment, a link carrying its own message, a trailing slash, and the same landings while signed in.
- My Profile: quote (over 100 characters, spaces only, save, shown on the Dashboard, Reset), banner (text that is not a link), photo (a real picture end to end, and a file that is not a picture), signature (draw and save), leaving with unsaved changes, "Change Password", each role's numbers, phone width (390).
- Verify page: a real approved record and a pending one, signed out and as HR, a made-up code, the 20-per-minute limit and a faked address header.
- API with each person's own token: what a person may change about themselves, signature storage (another person's folder, another person's file, a non-PNG file).
- Scripts, screenshots and raw results: `scratch/accounts-e2e-2026-11-20/` (not committed).
- Cleanup: every change was put back and read back, and Dani's and Jade's records match their values from before the test. Dani's test signature file was deleted. One tiny test picture stays in the company Cloudinary account (the app cannot delete from there). All browsers closed.

**Not covered:** the real reset email and the "Set a new password" form (staging mock addresses cannot receive mail, and reset secrets were not read from the database); Google sign-in (the test browser has no Google account); the sign-in rate limit (testing it would lock the office address out of staging); a deleted or unregistered person signing in (code only, see B5); multi-day leave dates on the Verify page (no multi-day record with a code on staging); dark mode; tablet size.

**Environment notes (not app bugs):**

- The two console errors on the login page ("Provider's accounts list is empty", "FedCM get() rejects") come from Google's button in a browser with no Google account.
- Mock addresses end in `@staging`, so any reset email to them fails to send. That is why "Change Password" fails on staging (see B2 for what the person sees).
- The Verify limit (C2) blocked the office address for about a minute during the test.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. My Profile data | 0 | 0 | 1 |
| B. Sign-in and password reset | 0 | 1 | 4 |
| C. Verify page | 0 | 2 | 2 |
| D. My Profile screen | 0 | 0 | 6 |
| **Total (16)** | **0** | **3** | **13** |

Plus the three findings tracked privately (A1 to A3).

The screens mostly held up. Login gives nothing away about which addresses exist, the reset page never shows a form without a real link, and signatures are locked to their owner. The worst public findings: **the reset page shows any message put in the link** (B1), and the Verify page can **call a genuine form "not found"** (C2) or **show a green "matches our system" over a failed signature check** (C1).

---

## A. My Profile data

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A4 | P3 | The quote box stops at 100 characters, but the server takes any length. A 5,000-character quote was saved through the API, and the Dashboard shows the quote in its header bar. | `PATCH dashboard_quote` with 5,000 characters as Dani: `200`, saved length 5,000 (then put back). The box has `maxLength=100`; the save trims to 100 in the page only. | Add a 100-character limit in the database (check existing rows first). | #1136 |

## B. Sign-in and password reset

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P2 | The reset page shows whatever message is in the link. A link ending `#error=access_denied&error_description=Your account is locked. Call IT on 0917-… and give them your password` shows that text as the page's own message, on the company site, with "Back to login" under it. A phishing email could use this. | `scratch/.../shot-reset-spoofed-message.png`. `reset-password/index.jsx:137` shows `params.errorDescription`; `recoveryLink.js:43` reads it straight from the link. | Show only our own words. Use `error_code` to choose between "expired or already used" and a general "this link does not work". Never show `error_description`. | #1135 |
| B2 | P3 | Two raw provider messages reach people. "Forgot password?" with a badly typed address shows "Unable to validate email address: invalid format". "Change Password" on My Profile, when the email cannot be sent, shows "Error sending recovery email" with no next step. | Toast text read from the page; `POST /auth/v1/recover` returned `400 validation_failed` and `500 unexpected_failure`. `login/index.jsx:96`, `profile/index.jsx` `handleChangePassword`. | Check the address format before sending ("Enter a full email address, like name@t3ckgroup.com."). For a send failure: "We could not send the email just now. Try again in a few minutes, or ask IT." | #1135 |
| B3 | P3 | On a phone the login page downloads the 783 KB intro video, although the video panel is hidden at that width. | At 390 px: `intro-tg-white.mp4`, 784 KB transferred, video `readyState 4`, its panel `display: none`. `login/index.jsx:248`. | Only add the video (or set `preload="none"` and start it) when the panel is shown, from the large-screen width up. | #1135 |
| B4 | P3 | The "Forgot password?" link is 18 px tall: hard to hit with a finger. | Measured 107 × 18 px at 390 px width. | Give it at least a 24 px tall tap area (padding, not a bigger font). | #1135 |
| B5 | P3 | Code only. When a signed-in account has no live employee row (for example a deactivated employee, or a Google account that is not on the list), the person sees "Unauthorized: Your email is not registered." and then "Logged out successfully." The second message reads as if they had chosen to sign out. | `AuthContext.jsx:175` shows the first toast; `resolveEmployee` then calls `logout()` (`AuthContext.jsx:71`), which shows `AuthContext.jsx:192`. Not run: no such account on staging. | Sign out quietly in that path and keep one message: "This account is not active in the portal. Ask HR if this is wrong." | #1135 |

## C. Verify page

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| C1 | P2 | A record whose signature check failed still opens with a green tick, "Verified Record" and "This printed form matches our system". The red "Signature Validation Failed … modified after it was signed" box sits just below. The person checking a paper form reads the headline. | Signed-out view of a pending Offset (code `7f9f86…`): `scratch/.../shot-verify-public-pending-tampered.png`. `VerifiedRecordPreview.jsx:289-290` always shows the green header. | Let the header follow the checks: green "Verified Record" only when every check passed; otherwise a red "Does not match" header with the reason. | #1134 |
| C2 | P2 | After 20 checks a minute from one address, a genuine, approved form shows "Record Not Found. The verification token is invalid, rotated, or does not exist." An office shares one address, so HR checking a stack of forms (or using Preview record on the Offsets page) can be told a real form is fake. | 23 calls in a row: the last ones returned `400 P0001 Rate limit exceeded` (earlier page views counted too). Then the approved Leave code `256e35…` in the browser: "Record Not Found". `VerifiedRecordPreview.jsx:56` turns every error into "not found". | Show "Too many checks from this network. Wait a minute and try again." when the error is the limit. Raise the limit for signed-in HR, or skip it for them. | #1134 |
| C3 | P3 | The limit trusts the first `X-Forwarded-For` value, which the caller can set. Three calls with made-up values went through while the real address was blocked. The codes are 32 random hex characters, so guessing is still out of reach; the limit simply does not limit. | `X-Forwarded-For: 10.0.0.1/2/3` → `200` while plain calls → `400`. `verify_form_token` reads `split_part(x-forwarded-for, ',', 1)`. | Key the limit on an address the caller cannot set (check which header Supabase's proxy adds), or drop the limit and rely on the code length. | #1134 |
| C4 | P3 | One hour reads "1 hrs". | Same record: "Total Hours 1 hrs". `VerifiedRecordPreview.jsx:240` and the public card. | "1 hr" for one, "hrs" otherwise. | #1134 |

## D. My Profile screen

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| D1 | P3 | The banner box takes any text. "not a url" was saved without a word, and the Dashboard then showed a plain black bar instead of the default picture. | Saved `dashboard_banner_path = "not a url"`; Dashboard banner image became the 1-pixel placeholder. `scratch/.../shot-dashboard-bad-banner.png`. `profile/index.jsx:254`. | Only accept an `https://` link, say why under the box, and keep Save off until it is fixed. | #1136 |
| D2 | P3 | Choosing a file that is not a picture opens "Crop Profile Photo" with a spinner that never stops. "Apply" stays greyed out and nothing says why. | Spinner still there after 13 s, Apply disabled. `scratch/.../shot-avatar-not-image.png`. `ImageCropModal.jsx:79` has no `onerror`. | Handle the load error: close the dialog and say "That file is not a picture. Choose a JPG or PNG." | #1136 |
| D3 | P3 | HR's numbers on My Profile do not match the Approval Center. Geane's profile says 270 pending and 1,366 verified; the Approval Center, at the same moment, says 260 pending and 1,325 recently verified. | Both read from the page within a minute. The profile counts every `COMPLETE` task with `hr_verified = false` (`profile/index.jsx:154-162`); the queue applies its own filters. | Use the Approval Center's own count for both numbers, or link the number to the queue so the two cannot drift. | #1136 |
| D4 | P3 | Wording. The employee's second number is labelled "Activities Completed", but it counts finished tasks; an Activity is a Calendar item (CONTEXT.md). The quote placeholder says "Write your 7-word motivational quote (all users)…", but the limit is 100 characters and the quote is only for you. | `profile/index.jsx:208`, `profile/index.jsx:762`. | "Tasks completed". Placeholder: "A short line for your Dashboard (up to 100 characters)". | #1136 |
| D5 | P3 | Code only. If the save changes no row (for example the row's email differs in capitals from the sign-in email), the page still says "Dashboard preferences saved." and shows the new values, though nothing was stored. | `employeeService.updateSelfPreferences` returns a made-up row when the update returns nothing (`employeeService.js:577`). Not seen on staging. | Treat "no row changed" as an error: "Could not save. Reload the page and try again." | #1136 |
| D6 | P3 | The "Change Password" link is 18 px tall. | Measured 107 × 18 px at 390 px width. | Same as B4: a 24 px tall tap area. | #1136 |

## What held up

- Login gives nothing away: a wrong password and an unknown address both get "Incorrect email or password…", and "Forgot password?" says "Check your email…" for an unknown address too. Empty fields show a message under each box and put the cursor in the first empty one. Spaces around the address and capitals still sign in.
- Sign-in returns you to the page you asked for (`/profile` → login → `/profile`). A signed-in visit to `/login` goes to the Dashboard. Sign out goes to `/login` and clears both the session and the cached profile; Back then only reaches a page with no private data.
- The reset page never shows the form without a live link: no link, a made-up link, an expired link, a trailing slash and a signed-in visitor all get a notice. A bad link does not sign a signed-in person out, and the cross-tab hold (`t3ck-recovery-active`) is released every time.
- Signatures: "Save Signature" stays off until something is drawn; a drawn signature saves and shows. Uploading into someone else's folder is refused, someone else's signature cannot be opened ("Object not found"), and only PNG is accepted.
- My Profile: the quote box stops at 100 characters, spaces only do not count as a change, Save and Reset work, a real photo uploads, crops and saves. Leaving with unsaved changes asks "You have unsaved changes. Leave this page and discard them?" (in the app) and the browser asks on reload. At 390 px there is no sideways scroll and Save sticks to the bottom once something changes. No console errors and no failed requests on the page.
- Verify page: a made-up code shows "Record Not Found"; codes are 32 random hex characters; HR gets the fuller "Internal Verified View".

## Watch list (not ticketed)

- Twice, right after sign-in, Jade's screen moved from My Profile to a Transmittal on its own. A watcher on the address for three minutes, and a fresh sign-in, did not repeat it. It may be the test tool; note it if anyone reports pages jumping.
- A record that fails its signature check but is approved shows "Record Validated (HR Approved)" on purpose (code comment: "User requested"). Not seen on staging. Worth confirming it is still wanted once C1 changes the header.
- Profile photos go to the Cloudinary folder `task-attachments` through an upload preset that sits in the page code, so anyone with the page can upload there.
- The reset page offers "Back to login" to a signed-in visitor. "Change Password" on My Profile would be the useful pointer.
- The What's New popup on the first page after sign-in (also in the HR and Activity trackers).

## Decisions made for this spec

None of these changes who can do what.

1. The reset page shows only our own words, never text from the link (B1).
2. The Verify page headline follows the signature checks: green only when every check passed (C1).
3. Hitting the Verify limit says so. It never says "Record Not Found" (C2).
4. The quote is at most 100 characters, in the page and in the database (A4).
