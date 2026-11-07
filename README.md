# Marginalia

Marginalia is a browser-based writing workbench for books, chapters, scenes, characters, locations, items, Lore, and Brain Dumps. Its Memory Review feature proposes context-based updates while keeping the writer in control of what gets saved.

## Project status

As of November 6, 2026, the published app has been confirmed to save data to Supabase and Gemini Memory Review has successfully returned suggestions after its response parser was updated for the Interactions API. Manuscript import now supports TXT, Markdown, DOCX, and EPUB, with an editable chapter preview and optional sequential Memory Review; PDF import is not supported yet. The Timeline and Relationships features are implemented in the repository and have passed local syntax, regression, and browser-load checks; the user has not yet completed hands-on testing of those two features.

The current Timeline is a searchable story-card index with approved, source-linked developments. This is a useful first pass, not the intended final experience: the user wants it to become more of an AI-generated book overview paired with a vertically scrolling, alternating-side event timeline. The Relationships view and card editor are also first passes awaiting user review.

## What is implemented

- Supabase sign-in, account-specific local libraries, cloud restore, and sync.
- Account deletion with password re-verification and permanent cloud-data removal.
- Local-first saves, sync status, and deletion reconciliation.
- Writing workspaces for chapters and scenes, plus entity cards and Brain Dumps.
- Word goals, rich-text styles, line counts, and entity mention context.
- Gemini-powered Memory Review suggestions for story discoveries and supported card-field updates.
- Persistent suggestion history; approvals and rejections are saved before local changes are applied.
- Browseable source lists on character, location, item, and Lore cards.
- A book-level Story Timeline with a searchable card index and chapter/scene-ordered, evidence-linked approved developments.
- Structured character-to-character links on character cards and a standalone, filterable relationship map.
- Character, location, item, and Lore collection cards preview multiple populated details instead of showing an empty-state message when only the first field is blank.
- Memory Review shows an indeterminate activity bar and rotating category labels while its single Gemini request is running; these are activity cues, not separate analysis passes or measured progress.
- Browser-local manuscript import for TXT, Markdown, DOCX, and EPUB, with detected chapters and editable titles/text before import.
- Optional sequential Memory Review for imported chapters, with pause/cancel controls and writer approval still required.

To start with a manuscript, choose **Start a new book** in the library, enter its title, then choose **Create & import**. For an existing book, open its Chapters view and choose **Import manuscript**.

Import files are parsed in the browser, then chapters are saved and synced like other Marginalia content. PDF import is not supported; export searchable PDFs to DOCX or TXT. Large manuscripts may exceed browser local-storage capacity, so validate with a copy and consider importing a few chapters at a time.

Memory Review calls Gemini 3.1 Flash-Lite through the authenticated Supabase Edge Function. Suggestions are validated against the current passage and supported card fields, then require writer review and approval. The Google API key is never sent to the browser. The function also requires an explicit allowed account email.

The Gemini Developer API has a free tier with changing model-specific quotas. When the provider quota or rate limit is reached, Memory Review reports the limit and does not retry or apply changes. Google's terms for unpaid API use allow submitted content to be used to improve its products and may permit human review; do not send confidential or sensitive writing on the free tier. See [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

### AI spending safety status

Memory Review currently checks the configured account, rejects passages above 60,000 characters, and reports Gemini quota/rate-limit errors. It does **not** yet enforce an application-level daily request budget or provide a hard cost ceiling. A provider quota response is not a spending-control mechanism if the Google project is moved to paid billing. To keep testing free, verify the Google AI Studio project's billing/tier and do not enable paid billing for it. Budget alerts are useful notifications but should not be treated as hard spending caps.

Before any paid or broader release, add server-enforced usage controls (including a per-account request/token budget and safe concurrency handling), explain provider limits and privacy terms in the UI, and test that calls are blocked when the allowance is exhausted. Do not promise zero spend while paid billing is enabled until an enforceable provider-side or application-side cap has been verified.

## Backend setup

For a **new** Supabase database, run [`supabase/schema.sql`](./supabase/schema.sql).

For the **existing** project, migrations `002` through `006` have been used. Migration 006 adds the `source_line` column required by Memory Review. The user confirmed that the app worked after this schema mismatch was corrected. Do not run the full schema on top of the existing database.

The `analyze-scene` and `delete-account` Edge Functions are deployed separately from the website. `analyze-scene` needs `GEMINI_API_KEY` and `GEMINI_ALLOWED_EMAIL` Edge Function secrets; never put the Gemini key in the browser. Account deletion uses the Supabase service-role key only inside its Edge Function. Deploy the function before publishing the UI that calls it. See [`V2_SETUP.md`](./V2_SETUP.md#edge-function).

See [`V2_SETUP.md`](./V2_SETUP.md) for the data flow, migration list, and deployment boundaries.

## Run focused tests

Run from the project folder with Node.js:

```sh
node supabase/v2-adapter.test.js
node book-import.test.js
node supabase/functions/analyze-scene/mock-helpers.test.mjs
node supabase/functions/analyze-scene/gemini-helpers.test.mjs
```

The tests use mocked HTTP responses. They do not replace a live Supabase check.

## Next steps

1. **Verify the Google project is still on the intended free tier before more Gemini testing.** Keep paid billing disabled for personal testing. The app currently has no daily usage ledger or hard spend cap. Before enabling billing or broader access, design and implement server-side request/token budgets, concurrency-safe enforcement, clear quota messaging, and tests that prove requests stop at the limit. Check current provider terms, quotas, model availability, and privacy conditions.
2. **User-test the Timeline** with a real book: check that approved facts appear in chapter/scene order, source links open and highlight the right passage, filters work, and the card index is useful. Then redesign it toward the desired concept: an AI-generated high-level book overview and a downward-scrolling vertical timeline with events alternating left and right. Keep each event tied to its source; make the summary an explicit, on-demand action, show its scope/source material, and define spoiler/progress behavior before generating it.
3. **User-test Relationships** by adding, editing, removing, syncing, and reloading character connections. Review the family-tree/connection-map layout, relationship labels and viewpoint, mobile usability, and behavior when a linked character is deleted. Add character portraits above names and fix long character names so they wrap or otherwise fit without clipping.
4. **User-test manuscript import and Memory Review** with files exported from Word/Google Docs, Scrivener, and plain-text editors. Check chapter detection/editing, encoding, paragraph preservation, local-storage capacity, sequential review progress, pause/cancel behavior, and pending-suggestion persistence. PDF import remains future work; export searchable PDFs to DOCX or TXT for now.
5. **Tune Memory Review** with invented passages and realistic card sets. Investigate missed named characters and other key details, review append behavior, duplicates, exact evidence, approvals/rejections, source links, longer-passage response times, and persistence across re-analysis. Keep writer approval as the gate for changes.
6. Continue the existing operational QA: long Memory Review panel interactions and decision history; sync/restore/deletion and account isolation; password recovery/email confirmation URLs; RLS review; disposable-account deletion; and mobile QA for the writer, cards, and navigation.
7. **Improve entity collection cards** with an on-demand AI-generated, lore-aware summary that synthesizes all saved card fields and approved context, while keeping the existing editable detail card. Explore a featured image treatment and define when/how summaries refresh so they remain grounded in current approved information.
8. **Defer first-time-user onboarding** until the core writing, memory, Timeline, Relationships, and safety workflows are stable. Then create an intuitive, contextual how-to that introduces each feature when it becomes relevant.

## Publishing

- Push frontend changes to the GitHub repository to publish the website through GitHub Pages.
- Apply SQL migrations in the Supabase SQL Editor; a GitHub Pages deployment does not change the database.
- Deploy `analyze-scene` and `delete-account` separately in Supabase when their sources change.

For signup email confirmation, set Supabase **Authentication → URL Configuration → Site URL** to the published site and add the published URL to **Redirect URLs**. Signup returns to the URL where the user created the account. See [`V2_SETUP.md`](./V2_SETUP.md#authentication-urls).

Never commit service-role keys, database passwords, or user access tokens.
