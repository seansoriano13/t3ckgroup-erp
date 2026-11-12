/**
 * Pretend the window is a wide, tall desktop (1440px and up, over 700px tall),
 * so the Calendar's day panel sits beside the month instead of behind a button.
 * Every other query keeps its jsdom default of not matching.
 */
export function stubRoomyScreen() {
  window.matchMedia = (query) => ({
    matches: query.includes("min-width: 1440px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}
