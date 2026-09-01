# 01: Core Attachment Rules & Utils Update

**What to build:** Update the underlying utilities and hook so that non-image files can be processed. Centralize file limits (size and count) and the type allowlist in the hook, and ensure non-image files generate a generic null preview.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `useFileAttachments` enforces a count cap for attachments.
- [ ] `useFileAttachments` enforces a size cap and throws a clear error.
- [ ] `useFileAttachments` restricts file selection to a safe allowlist.
- [ ] `utils/attachments` gracefully handles generic file properties (non-images) and generates null previews.
- [ ] Core attachment rules are covered by unit tests (`useFileAttachments.test.jsx`).
