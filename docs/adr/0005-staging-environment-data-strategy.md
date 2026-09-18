# Staging Environment Data Strategy

> Superseded by [0010](0010-staging-is-a-working-environment.md): staging stopped being
> a refreshable mirror once people began working directly in it. The sync script and
> sanitization script this ADR describes are deleted.

We need a dedicated staging environment for pre-release testing. We decided to use an isolated Supabase project combined with a periodic, sanitized data dump from production, rather than generating synthetic dummy data.

Using real production data guarantees that complex edge cases, actual document relationships, and accurate data volume are represented during testing. However, to prevent accidentally emailing real clients or employees during testing, a sanitization script (`supabase/sanitization.sql`) is strictly required to run immediately after every dump. This script scrubs PII (like emails and phone numbers) and resets all user passwords to a known dummy value, ensuring developers and QA can freely log into any account for role-based testing.
