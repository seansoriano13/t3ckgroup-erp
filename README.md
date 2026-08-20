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
schema, so no database is needed.

The suite is a pyramid, and each tier runs on its own:

```bash
pnpm test:unit
```

```bash
pnpm test:integration
```

```bash
pnpm test:e2e
```

See [docs/testing.md](docs/testing.md) for which tier a new test belongs in, how
to add one, and what the fake does and does not cover.
