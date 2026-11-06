# Marginalia

Marginalia is a browser-based writing workbench for books, chapters, scenes, characters, locations, items, Lore, and Brain Dumps. Its Memory Review feature proposes context-based updates while keeping the writer in control of what gets saved.

## Project status

As of October 15, 2026, the user has confirmed that the published app saves data to Supabase and that Memory Review is working. The application is hosted on GitHub Pages; authentication, library sync, and suggestion review use Supabase.

The latest Memory Review UX changes add a scrollable review panel and animate approved or rejected suggestions out of the pending list. Confirm these changes in the published site during the next browser QA pass.

## What is implemented

- Supabase sign-in, account-specific local libraries, cloud restore, and sync.
- Account deletion with password re-verification and permanent cloud-data removal.
- Local-first saves, sync status, and deletion reconciliation.
- Writing workspaces for chapters and scenes, plus entity cards and Brain Dumps.
- Word goals, rich-text styles, line counts, and entity mention context.
- Gemini-powered Memory Review suggestions for story discoveries and supported card-field updates.
- Persistent suggestion history; approvals and rejections are saved before local changes are applied.
- Provenance for approved details, with source links for supported character-card updates.

Memory Review calls Gemini 3.1 Flash-Lite through the authenticated Supabase Edge Function. Suggestions are validated against the current passage and supported card fields, then require writer review and approval. The Google API key is never sent to the browser. The function also requires an explicit allowed account email.

The Gemini Developer API has a free tier with changing model-specific quotas. When the provider quota or rate limit is reached, Memory Review reports the limit and does not retry or apply changes. Google's terms for unpaid API use allow submitted content to be used to improve its products and may permit human review; do not send confidential or sensitive writing on the free tier. See [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## Backend setup

For a **new** Supabase database, run [`supabase/schema.sql`](./supabase/schema.sql).

For the **existing** project, migrations `002` through `006` have been used. Migration 006 adds the `source_line` column required by Memory Review. The user confirmed that the app worked after this schema mismatch was corrected. Do not run the full schema on top of the existing database.

The `analyze-scene` and `delete-account` Edge Functions are deployed separately from the website. `analyze-scene` needs `GEMINI_API_KEY` and `GEMINI_ALLOWED_EMAIL` Edge Function secrets; never put the Gemini key in the browser. Account deletion uses the Supabase service-role key only inside its Edge Function. Deploy the function before publishing the UI that calls it. See [`V2_SETUP.md`](./V2_SETUP.md#edge-function).

See [`V2_SETUP.md`](./V2_SETUP.md) for the data flow, migration list, and deployment boundaries.

## Run focused tests

Run from the project folder with Node.js:

```sh
node supabase/v2-adapter.test.js
node supabase/functions/analyze-scene/mock-helpers.test.mjs
node supabase/functions/analyze-scene/gemini-helpers.test.mjs
```

The tests use mocked HTTP responses. They do not replace a live Supabase check.

## Next steps

1. Browser-check the latest published Memory Review panel: scroll through a long list, approve and reject suggestions, confirm cards collapse smoothly, and confirm resolved suggestions remain in Approved/Rejected history.
2. Re-run Memory Review on the same passage and confirm saved decisions persist.
3. Smoke-test sync, restore, deletion, and account isolation with care; back up valuable writing before changing accounts. Isolation means a separate test account should not see the first account's library: create a uniquely named test book under the test account, then sign back into the original account and confirm that test book is absent.
4. Verify password recovery and email confirmation redirects in Supabase Auth; the published site URL must be configured and allowed.
5. Before public use, review row-level security policies.
6. Verify account deletion on a disposable account after deploying both the frontend and `delete-account` function.
7. Test Gemini Memory Review with invented sample writing and verify the live Edge Function quota/error flow. Before sending real unpublished work, review Google's free-tier data terms and decide whether its content-use and human-review terms are acceptable.
8. Revisit the provider, privacy terms, per-user usage limits, and cost controls before moving beyond the personal free-tier test.
9. Continue mobile QA on real phones, especially the writer drawer, editor actions, and entity-card flows; mobile layouts now use one column and avoid page-level horizontal scrolling.

## Publishing

- Push frontend changes to the GitHub repository to publish the website through GitHub Pages.
- Apply SQL migrations in the Supabase SQL Editor; a GitHub Pages deployment does not change the database.
- Deploy `analyze-scene` and `delete-account` separately in Supabase when their sources change.

For signup email confirmation, set Supabase **Authentication → URL Configuration → Site URL** to the published site and add the published URL to **Redirect URLs**. Signup returns to the URL where the user created the account. See [`V2_SETUP.md`](./V2_SETUP.md#authentication-urls).

Never commit service-role keys, database passwords, or user access tokens.
