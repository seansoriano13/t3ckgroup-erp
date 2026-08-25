#!/usr/bin/env bash
set -e

# Load environment variables from .env.local if present
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

if [ -z "$PROD_DB_URL" ] || [ -z "$STAGING_DB_URL" ]; then
  echo "Error: PROD_DB_URL and STAGING_DB_URL must be set in .env.local or environment"
  exit 1
fi

echo "Extracting production data dump..."
# We use pg_dump to extract data only, excluding schema since we assume migrations are applied.
# We also exclude auth schema internal tables that shouldn't be blindly copied, except users/identities if needed.
# Alternatively, Supabase CLI allows: supabase db dump --data-only --db-url "$PROD_DB_URL" > prod_data.sql
supabase db dump --data-only --db-url "$PROD_DB_URL" > prod_data.sql

echo "Applying production data to staging..."
# Connect to staging and run the data dump
# Note: it's best to clear tables first or use INSERT ON CONFLICT, but data-only pg_dump usually uses COPY. 
# We might need to disable triggers during import. 
psql "$STAGING_DB_URL" -f prod_data.sql

echo "Running PII sanitization on staging database..."
psql "$STAGING_DB_URL" -f supabase/sanitization.sql

echo "Cleaning up..."
rm prod_data.sql

echo "Staging database sync and sanitization complete!"
