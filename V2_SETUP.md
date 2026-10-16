# Supabase V2 Setup and Status

This guide describes Marginalia's current Supabase persistence and Memory Review setup. For the project overview and ordered follow-up work, see [`README.md`](./README.md).

## Current status

As of October 15, 2026, the user confirmed that library saves are reaching Supabase and Memory Review is working. The recent empty-response, CORS header, and missing `source_line` issues were addressed. Migration 006 supplies the column that was missing from the existing database.

GitHub Pages publishes the browser app. Supabase database migrations and the `analyze-scene` Edge Function are separate deployments. Do not rerun migrations already applied or run `schema.sql` against the existing database.

## Data flow

1. On sign-in, the browser loads the account's local library and the books, documents, and entities allowed by Supabase row-level security.
2. Local and remote projects are merged. Project-level timestamps determine conflicts; entries present on only one side are retained.
3. The merged library is saved under a user-specific localStorage key and synced. Full-library sync reconciles removals; local deletion markers protect offline or failed syncs.
4. The browser sends a saved chapter or scene, book context, and entity context to `analyze-scene`.
5. The Edge Function verifies the signed-in user and book ownership and returns structured suggestions; it does not edit entities.
6. Memory Review stores suggestions and review decisions in Supabase. The browser applies approved suggestions locally only after the decision is saved.

The old unscoped `marginalia-projects-v3` library is assigned to the first account that signs in after this change and moved to that account's key. Back up valuable writing before testing account changes. If Supabase is unavailable, the local copy remains available and the app reports the sync problem. Conflicting changes to the same project still use project-level last-sync-wins rather than per-document conflict resolution.

## Analyzer behavior

The analyzer currently uses deterministic mock logic, not a language model or paid AI provider. It recognizes supported character nicknames and contextual patterns for new character, location, item, and Lore cards. Lore types include factions, creatures, systems, and concepts. All proposals stay pending until reviewed; ambiguous prose may be missed or misclassified.

## Database

For a new database, run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor.

For the existing database, the migration sequence is:

1. [`002_client_keys.sql`](./supabase/migrations/002_client_keys.sql)
2. [`003_document_word_goal.sql`](./supabase/migrations/003_document_word_goal.sql)
3. [`004_lore_entity_kind.sql`](./supabase/migrations/004_lore_entity_kind.sql)
4. [`005_persist_memory_review.sql`](./supabase/migrations/005_persist_memory_review.sql)
5. [`006_memory_review_source_line.sql`](./supabase/migrations/006_memory_review_source_line.sql)

The user reported applying migrations 002 through 005 and then resolved the missing `source_line` column with migration 006. The working Memory Review flow confirms the app can now read and write the required suggestion data. If recreating a database, apply all migrations in order rather than relying on this existing-project history.

Migration 006 is idempotent and asks PostgREST to reload its schema cache. It adds `source_line integer not null default 1` to `public.ai_suggestions`.

## Edge Function

The deployed endpoint is `POST /functions/v1/analyze-scene`. Its source is [`supabase/functions/analyze-scene/index.ts`](./supabase/functions/analyze-scene/index.ts), which imports [`mock-helpers.mjs`](./supabase/functions/analyze-scene/mock-helpers.mjs).

Deploy the function separately from GitHub Pages, and include both files. No redeploy is needed for frontend-only changes; redeploy when either function source file changes.

The function requires an authenticated bearer token and checks that the requested book belongs to that user. The browser's analysis request must not send the `Prefer` header; that header is not included in the Edge Function's CORS allowlist.

## Authentication URLs

In Supabase Dashboard, open **Authentication → URL Configuration**. Set **Site URL** to the published Marginalia URL and add that exact URL to **Redirect URLs**. Add a localhost URL only if you intentionally test the app locally. Signup asks Supabase to return to the page where signup started, so the published URL must be allowed.

Email confirmation links are single-use and expire. If a link returns `otp_expired`, request a fresh confirmation email after checking these URL settings, then open the newest link once.

## Account deletion

The app's **Delete account** action requires the account password again and the exact confirmation text `DELETE`. It calls the `delete-account` Edge Function, which validates the caller's bearer token and deletes only that authenticated user's Supabase Auth account. The database schema cascades that deletion to the user's books and their documents, entities, and Memory Review suggestions. The browser clears that account's local library on the current device only after Supabase confirms deletion; local copies on other devices cannot be remotely erased.

Deploy [`supabase/functions/delete-account/index.ts`](./supabase/functions/delete-account/index.ts) to the same Supabase project before publishing the updated frontend. The hosted Edge Function must have its standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment variables available. The service-role key must remain server-side and must never be added to frontend code or repository configuration.

Test with a disposable account that contains only disposable data. Confirm the UI reports success and that the account can no longer log in. Do not test deletion against an account containing writing you need to keep.

## Local tests

Run from the project folder:

```sh
node supabase/v2-adapter.test.js
node supabase/functions/analyze-scene/mock-helpers.test.mjs
```

These are focused local tests with mocked HTTP responses. They do not verify the live Supabase project, RLS policies, deployed function, GitHub Pages cache, or browser layout.

## Deployment responsibilities

- **Frontend:** push the intended `index.html` and adapter changes to the repository; GitHub Pages publishes the site.
- **Database:** run a required SQL migration once in the Supabase SQL Editor.
- **Edge Functions:** deploy `analyze-scene` and `delete-account` separately in Supabase when their sources change.

Never place service-role keys, database passwords, or user access tokens in the repository.
