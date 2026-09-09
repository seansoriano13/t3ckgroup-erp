// The FAQ editor's authorization was never a real capability — it names
// specific people. Extracted here so the check lives in exactly one place
// instead of being copy-pasted between the modal's Edit button and the
// editor route's own guard.
export function canEditFAQ(user) {
  return (
    user?.name?.toLowerCase() === "geane mateo" ||
    String(user?.id) === "101" ||
    String(user?.id) === "201"
  );
}
