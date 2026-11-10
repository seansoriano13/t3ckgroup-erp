// Build a redirect target that keeps the incoming query and hash. `forced`
// override incoming params of the same name.
export function redirectTarget(to, location, forced = {}) {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(forced)) params.set(k, v);
  const qs = params.toString();
  return `${to}${qs ? `?${qs}` : ""}${location.hash || ""}`;
}
