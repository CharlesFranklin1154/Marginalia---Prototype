# Marginalia V2 Foundation

This folder defines the first authenticated persistence boundary for Marginalia. The browser still keeps a localStorage copy, but signed-in sessions now load the account's Supabase library, merge it with that account's local copy, and sync the merged library back.

## Data flow

1. On sign-in, the browser loads the user's local library and the books, documents, and entities allowed by Supabase row-level security.
2. The browser merges local and remote projects. Projects use the latest content-sync timestamp for conflicts; entries present on only one side are retained.
3. The merged library is saved under a user-specific localStorage key and uploaded. Later saves sync the full library, including removals; local deletion markers survive offline or failed syncs so deleted entries are not restored during the next merge.
4. The browser can send a saved chapter or scene and book context to `analyze-scene`.
5. The Edge Function verifies the signed-in user and book ownership.
6. The function returns structured suggestions. It never edits an entity directly.
7. The Memory Review panel loads the passage's saved suggestion history and writes approval/rejection decisions to Supabase before applying them locally.

The previous unscoped `marginalia-projects-v3` local library is assigned to the first account that signs in after this update. It is then stored under that account's key and removed from the unscoped key, so later accounts on the same browser do not inherit it. Keep a backup before testing account changes if the browser contains valuable writing.

The local copy remains useful as a cache. If Supabase cannot be reached at sign-in, the app opens that account's local copy and explicitly reports that it is offline; changes remain local until the user signs in again while online. If initial sync fails after loading, the app likewise opens and reports the sync issue in the save status. Conflicting edits to the same entry currently use project-level last-content-sync-wins; this is not yet per-document conflict resolution.

## Initial endpoint

`POST /functions/v1/analyze-scene`

Request:

```json
{
  "bookId": "book-uuid",
  "documentId": "scene-uuid",
  "text": "Mira touched the scar above her left eye.",
  "entities": [
    { "id": "character-uuid", "kind": "character", "name": "Mira" }
  ]
}
```

The request requires `Authorization: Bearer <supabase-access-token>`.

Response:

```json
{
  "suggestions": [
    {
      "id": "mock-...",
      "type": "character_update",
      "entityId": "character-uuid",
      "field": "physical",
      "operation": "append",
      "value": "A scar above the left eye.",
      "evidence": "Mira touched the scar above her left eye.",
      "confidence": 0.91,
      "status": "pending"
    }
  ],
  "analysis": { "mode": "mock", "entitiesChecked": 1 }
}
```

The analyzer uses deterministic mock logic, not a language model. It recognizes saved character nicknames as aliases and can propose new character, location, item, and Lore cards from supported context patterns. Lore cards can represent factions, creatures, systems, or general concepts. New cards and their linked detail suggestions remain pending until approved in Memory Review. These patterns can miss or misclassify ambiguous prose and do not require an AI API key.

## Local setup

1. Create a Supabase project.
2. For a new database, apply `supabase/schema.sql` in the SQL editor. For the existing project, apply migrations 002 through 006 in order; if migrations 002 through 005 are already applied, apply `supabase/migrations/006_memory_review_source_line.sql`.
3. Deploy `supabase/functions/analyze-scene/index.ts` together with its imported `mock-helpers.mjs` file.
4. Add the project URL and anon key through environment-specific configuration, never hardcoded secrets.
5. Verify authenticated sync and row-level-security behavior with separate user accounts before using real writing data.

## Focused local tests

Run from the project folder:

```sh
node supabase/v2-adapter.test.js
node supabase/functions/analyze-scene/mock-helpers.test.mjs
```

The adapter tests cover cloud-to-local restoration, merge behavior, upserts, and propagation of deleted rows. They use mocked HTTP responses; they do not replace an end-to-end test against the configured Supabase project.
