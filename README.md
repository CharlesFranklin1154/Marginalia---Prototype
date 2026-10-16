# Marginalia

Marginalia is a browser-based writing workbench for books, chapters, scenes, characters, locations, items, Lore, and Brain Dumps. Its Memory Review feature proposes context-based updates while keeping the writer in control of what gets saved.

## Project status

As of October 15, 2026, the user has confirmed that the published app saves data to Supabase and that Memory Review is working. The application is hosted on GitHub Pages; authentication, library sync, and suggestion review use Supabase.

The latest Memory Review UX changes add a scrollable review panel and animate approved or rejected suggestions out of the pending list. Confirm these changes in the published site during the next browser QA pass.

## What is implemented

- Supabase sign-in, account-specific local libraries, cloud restore, and sync.
- Local-first saves, sync status, and deletion reconciliation.
- Writing workspaces for chapters and scenes, plus entity cards and Brain Dumps.
- Word goals, rich-text styles, line counts, and entity mention context.
- Deterministic Memory Review suggestions for supported character, location, item, and Lore patterns.
- Persistent suggestion history; approvals and rejections are saved before local changes are applied.
- Provenance for approved details, with source links for supported character-card updates.

The analyzer uses deterministic heuristics, not a language model. It can miss or misinterpret ambiguous prose; suggestions require review and approval.

## Backend setup

For a **new** Supabase database, run [`supabase/schema.sql`](./supabase/schema.sql).

For the **existing** project, migrations `002` through `006` have been used. Migration 006 adds the `source_line` column required by Memory Review. The user confirmed that the app worked after this schema mismatch was corrected. Do not run the full schema on top of the existing database.

The `analyze-scene` Edge Function is deployed separately from the website. Its entry point is [`supabase/functions/analyze-scene/index.ts`](./supabase/functions/analyze-scene/index.ts); it imports [`mock-helpers.mjs`](./supabase/functions/analyze-scene/mock-helpers.mjs). Redeploy the function only when one of those function files changes.

See [`V2_SETUP.md`](./V2_SETUP.md) for the data flow, migration list, and deployment boundaries.

## Run focused tests

Run from the project folder with Node.js:

```sh
node supabase/v2-adapter.test.js
node supabase/functions/analyze-scene/mock-helpers.test.mjs
```

The tests use mocked HTTP responses. They do not replace a live Supabase check.

## Next steps

1. Browser-check the latest published Memory Review panel: scroll through a long list, approve and reject suggestions, confirm cards collapse smoothly, and confirm resolved suggestions remain in Approved/Rejected history.
2. Re-run Memory Review on the same passage and confirm saved decisions persist.
3. Smoke-test sync, restore, deletion, and account isolation with care; back up valuable writing before changing accounts.
4. Verify password recovery and its allowed redirect URL in Supabase Auth.
5. Before public use, review row-level security and remove or clearly isolate the temporary admin testing bypass.
6. Treat a real AI provider as future work; decide on limits, privacy behavior, and cost controls before enabling paid calls.

## Publishing

- Push frontend changes to the GitHub repository to publish the website through GitHub Pages.
- Apply SQL migrations in the Supabase SQL Editor; a GitHub Pages deployment does not change the database.
- Deploy the Edge Function separately in Supabase when its source changes.

Never commit service-role keys, database passwords, or user access tokens.
