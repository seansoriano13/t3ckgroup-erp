# ADR 0051 — The laptop band and a 15px root size

## Status

Accepted 2026-11-12, from the screen fit review (spec #975, ticket #976).

## Context

Staff run the ERP on medium-DPI laptops. Those show it at 1280 to 1536 CSS pixels
wide and only 600 to 730 tall (the tracker measured 1280x600, 1366x650 and
1536x730). The design was drawn for a roomier desktop, so a page lost a lot of its
height to padding, a double side gutter, a wide side menu and a floating bug button.

## Decision

- **The laptop band** is a viewport at least 1024px wide and either under 1536px
  wide or at most 820px tall: `@media (min-width: 1024px) and (max-width: 1535.98px),
  (min-width: 1024px) and (max-height: 820px)`. It is the Tailwind variant `laptop:`
  in `src/index.css`, and the root size rule uses the same query.
- **Root font size is 15px in the band**, 16px elsewhere. Everything sized in rem
  shrinks about 6%. Media queries keep the browser's 16px, so Tailwind's breakpoints
  do not move. Fixed-pixel text stays as it is. Phones and tablets stay at 16px so
  touch targets do not shrink.
- **One page gutter.** The app frame owns the side gutter (16px on phones, 24px from
  md). PageContainer no longer adds its own. Top padding is 24px on desktop and 16px
  in the band; PageShell's slot gap is 12px in the band.
- **Side menu in the band** is 216px wide with 32px nav rows. With no saved choice it
  opens as the icon rail below 1280px wide. A saved choice still wins.
- **Report a bug** moves into the side menu footer from md up. A 36px floating button
  stays on phones until the phone menu drawer ships.

## Consequences

- Later screen fit tickets use `laptop:` for their tighter sizes; they do not invent
  new breakpoints.
- Fixed-pixel sizes do not shrink in the band. A screen that needs it uses `laptop:`.
