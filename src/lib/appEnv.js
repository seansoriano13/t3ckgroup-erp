// Which environment this build is for, decided at build time only (ADR 0028):
// no runtime hostname sniffing. Mirrors the check in vite.config.js.
export const isStaging = import.meta.env.MODE === "staging" || import.meta.env.VITE_APP_ENV === "staging"
export const isLocal = import.meta.env.VITE_APP_ENV === "local"
