# 02: Roll Out Unified File Attachments to Chat Composers

**What to build:** All chat composers allow the attachment of any allowed file type (like PDFs, Word docs) up to the centralized limits, and render generic previews for them.

**Blocked by:** 01: Core Attachment Rules & Utils Update

**Status:** ready-for-agent

- [ ] The `OpportunityDetailsModal` chat composer adopts the updated hook and supports non-image file uploads.
- [ ] The `ProcurementPanel` chat composer adopts the updated hook and supports non-image file uploads.
- [ ] The `ApplyLeaveModal` chat composer adopts the updated hook and supports non-image file uploads.
- [ ] Thin integration tests per composer prove they can persist the resulting descriptors correctly.
