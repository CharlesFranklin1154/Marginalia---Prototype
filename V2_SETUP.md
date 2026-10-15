# Marginalia V2 Foundation

This folder defines the first backend boundary for Marginalia. V1 remains a standalone localStorage prototype until the migration is deliberately enabled.

## Data flow

1. The browser saves a chapter or scene.
2. The browser sends the saved plain text and book context to `analyze-scene`.
3. The Edge Function verifies the signed-in user and book ownership.
4. The function returns structured suggestions. It never edits an entity directly.
5. The future review panel lets the writer approve or reject each suggestion.
6. Approved suggestions are written in a separate transaction and retained in the audit history.

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

## Local setup later

1. Create a Supabase project.
2. For a new database, apply `supabase/schema.sql` in the SQL editor. For the existing project, apply `supabase/migrations/004_lore_entity_kind.sql` after migrations 002 and 003.
3. Deploy `supabase/functions/analyze-scene/index.ts` together with its imported `mock-helpers.mjs` file.
4. Add the project URL and anon key through environment-specific configuration, never hardcoded secrets.
5. Verify authenticated sync for books, documents, characters, locations, items, Lore cards, and approved review suggestions.
