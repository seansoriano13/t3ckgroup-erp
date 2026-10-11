// Dev-only login prefill. The DEV ternary must stay inline around each
// VITE_ read so a production build folds it away and the values never
// reach the bundle.
export function getDevLoginPrefill() {
  const email = import.meta.env.DEV
    ? import.meta.env.VITE_MAGIC_LOGIN_EMAIL || ""
    : "";
  const password = import.meta.env.DEV
    ? import.meta.env.VITE_MAGIC_LOGIN_PASSWORD || ""
    : "";
  if (import.meta.env.MODE === "test") return { email: "", password: "" };
  return { email, password };
}
