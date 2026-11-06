# Supabase V2 Setup and Status

This guide describes Marginalia's current Supabase persistence and Memory Review setup. For the project overview and ordered follow-up work, see [`README.md`](./README.md).

## Current status

As of November 6, 2026, library saves are reaching Supabase and the user confirmed a successful live Gemini Memory Review after the Interactions API response parser was corrected. The existing-project `source_line` issue is resolved by migration 006. The Story Timeline and Relationships views are implemented in the frontend with no new migrations, but are awaiting the user's hands-on review.

GitHub Pages publishes the browser app. Supabase database migrations and the `analyze-scene` Edge Function are separate deployments. Do not rerun migrations already applied or run `schema.sql` against the existing database.

The current Timeline is a searchable card index plus approved, source-linked details; planned product work is to evolve this into a high-level AI book summary and a vertical, alternating-side event timeline. Any generated overview should be explicit/on-demand, source-aware, and designed around spoiler/progress expectations. Relationships currently use explicit character-card connections and a simple filterable map; portrait placement, long-name wrapping, and the visual design need user review and refinement.

## Data flow

1. On sign-in, the browser loads the account's local library and the books, documents, and entities allowed by Supabase row-level security.
2. Local and remote projects are merged. Project-level timestamps determine conflicts; entries present on only one side are retained.
3. The merged library is saved under a user-specific localStorage key and synced. Full-library sync reconciles removals; local deletion markers protect offline or failed syncs.
4. The browser sends a saved chapter or scene, book context, and entity context to `analyze-scene`.
5. The Edge Function verifies the signed-in user and book ownership and returns structured suggestions; it does not edit entities.
6. Memory Review stores suggestions and review decisions in Supabase. The browser applies approved suggestions locally only after the decision is saved.

The old unscoped `marginalia-projects-v3` library is assigned to the first account that signs in after this change and moved to that account's key. Back up valuable writing before testing account changes. If Supabase is unavailable, the local copy remains available and the app reports the sync problem. Conflicting changes to the same project still use project-level last-sync-wins rather than per-document conflict resolution.

## Analyzer behavior

Memory Review uses Gemini 3.1 Flash-Lite through the `analyze-scene` Edge Function. This model is optimized for low-latency, structured data extraction. The endpoint verifies the Supabase session, restricts calls to the configured `GEMINI_ALLOWED_EMAIL`, and confirms the book belongs to the caller before sending the passage and selected story-card context to Google. The Gemini API key stays in an Edge Function secret.

Gemini returns structured suggestions only. The function validates the target card and field, requires evidence quoted exactly from the submitted passage, computes the source line itself, and limits updates to append operations. It can propose new cards and evidence-based details for those cards; both remain pending in Memory Review. The model never writes directly to the database.

Approved Memory Review details retain their value, evidence quotation, chapter or scene, and source line in each entity's saved provenance. The Story Timeline uses that existing provenance plus the current character, location, item, and Lore cards to provide a searchable book index and a chapter-list-then-scene-list history. Card source lists and Timeline entries link back to the cited passage. Manually entered details remain in the card index; only approved, source-linked details appear as timeline developments. This feature does not add a database migration or make another model call.

Character cards also store optional structured connections to other character-card IDs, including relationship type and context. The Relationships view visualizes these saved links and can focus on one character or filter by relationship type. Links are synced inside existing entity data and require no database migration.

Free-tier quotas vary by project and model. A provider quota or rate-limit response is shown to the user; the function does not retry quota errors or apply partial suggestions. Transient Gemini 503 service-unavailable responses receive up to two short retries. Each upstream attempt has a 35-second timeout, keeping all three attempts and retry delays within Supabase's 150-second Edge Function execution limit; timed-out reviews return a clear error without changing the passage or saving suggestions. Google states that content submitted under unpaid Gemini API services may be used to improve its products and may be reviewed by humans. Do not send confidential or sensitive writing on the unpaid tier; use invented text while testing and consult the current [Gemini API terms](https://ai.google.dev/gemini-api/terms), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

### Usage and billing guardrails

The Edge Function currently limits a passage to 60,000 characters and restricts Gemini to the configured account, but it does not track a daily request/token allowance or enforce a hard spend ceiling. Gemini's quota responses communicate provider limits; they are not an application spending cap. For free personal testing, verify the Google project is on the intended free tier and keep paid billing disabled. Before paid use, implement and validate server-side usage accounting and concurrency-safe limits, and verify any provider-side spending controls separately. Do not assume Google Cloud budget alerts stop charges.

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

The deployed endpoint is `POST /functions/v1/analyze-scene`. Its source is [`supabase/functions/analyze-scene/index.ts`](./supabase/functions/analyze-scene/index.ts), which imports [`gemini-helpers.mjs`](./supabase/functions/analyze-scene/gemini-helpers.mjs).

Set these Edge Function secrets in **Supabase Dashboard → Edge Functions → Secrets**:

- `GEMINI_API_KEY`: the key created in Google AI Studio. Never put this value in frontend code, Git, or chat.
- `GEMINI_ALLOWED_EMAIL`: the exact email address of the one Marginalia account allowed to use Gemini. The function fails closed if either secret is missing.

Deploy `analyze-scene` separately from GitHub Pages. Its `gemini-helpers.mjs` file is bundled through the local import. With the Supabase CLI linked to the correct project, run `supabase functions deploy analyze-scene`. No redeploy is needed for frontend-only changes; deploy again when the Edge Function source changes.

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
