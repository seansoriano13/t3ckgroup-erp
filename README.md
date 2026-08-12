# T3CK Group — Task Monitoring System

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env` and fill in the Supabase, Google OAuth and
Cloudinary values before starting.

## Testing

```bash
pnpm test
```

Tests run against an in-memory fake of Supabase built from this repo's own SQL
schema, so no database is needed. See [docs/testing.md](docs/testing.md) for how
to add tests for a new module and what the fake does and does not cover.
