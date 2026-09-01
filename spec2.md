## Problem Statement

Currently, chat messaging only allows certain file types (e.g., images) to be attached. Users need the ability to send any file type (like PDFs, documents, archives) in chat so they can collaborate fully without switching to external tools.

## Solution

Update the file attachment handling to accept any file type, subject to an explicit allowlist, a size cap, and a count cap. We will centralize these rules in the `useFileAttachments` hook. Non-image files will render with a generic null preview instead of a thumbnail. All three chat composers will use this unified hook to enforce the rules.

## User Stories

1. As a user, I want to attach non-image files (like PDFs or Word docs) to chat messages, so that I can share context and collaborate directly in the chat.
2. As a user, I want to see a clear error if I try to attach a file larger than the size cap, so that I know why it failed immediately.
3. As a user, I want to see a clear error if I try to attach more files than the count cap, so that I understand the system limits.
4. As a user, I want to see a placeholder or icon preview for non-image files I attach, so that I can see my file is queued up to send.
5. As an admin, I want file types to be restricted to a safe allowlist, so that dangerous executable files cannot be shared.
6. As a developer, I want all three chat composers to use the same attachment rules, so that validation logic isn't duplicated.

## Implementation Decisions

- **Rule Centralization:** The type allowlist, size cap, count cap, and null preview generation will go entirely inside the `useFileAttachments` hook. 
- **Utilities:** Update `utils/attachments` (`toDescriptor`, `isImageAttachment`) to handle the generic file properties. Non-image files will fallback gracefully for previews.
- No new testing seams are needed; the type allowlist and the caps go in the hook, which all three composers already have to adopt.

## Testing Decisions

- **Unit tier — `useFileAttachments`:** Assert the type allowlist, size cap, count cap, and generation of null previews. Tested against `useFileAttachments.test.jsx`.
- **Unit tier — `utils/attachments`:** Assert `toDescriptor` mapping and `isImageAttachment` logic.
- **Integration tier — The three composers:** Thin tests per composer proving they persist the resulting descriptors correctly (the round-trip of sending a file). 

## Out of Scope

- Virus scanning or deep content inspection of uploaded files.
- In-browser preview rendering for documents like PDF or Excel.

## Further Notes

By placing the rules in the hook, they get tested once at the highest point and the composers only need to prove they persist descriptors.
