import assert from 'node:assert/strict';
import { buildMockSuggestions } from './mock-helpers.mjs';

const suggestions = buildMockSuggestions(
  'Mira wore a dark wool coat and kept her gloves in her pocket. She always twirls her ring when nervous. The old chapel sat beside the river where she met her brother Arlen.',
  [
    { id: 'char-1', kind: 'character', name: 'Mira' },
    { id: 'loc-1', kind: 'location', name: 'chapel' },
    { id: 'item-1', kind: 'item', name: 'ring' },
    { id: 'char-2', kind: 'character', name: 'Arlen' },
  ],
);

assert.ok(suggestions.some((item) => item.entityId === 'char-1' && item.field === 'physical'));
assert.ok(suggestions.some((item) => item.entityId === 'char-1' && item.field === 'habits'));
assert.ok(suggestions.some((item) => item.entityId === 'char-2' && item.field === 'relationships'));
assert.ok(suggestions.some((item) => item.entityId === 'loc-1' && item.field === 'description'));
assert.ok(suggestions.some((item) => item.entityId === 'item-1' && item.field === 'details'));

const pronounCheck = buildMockSuggestions(
  'Bob watched Mira across the room. Mira touched a scar above her left eye. She kept twirling her ring when nervous. The chapel sat beside the river. Mira wore a dark wool coat.',
  [
    { id: 'char-bob', kind: 'character', name: 'Bob' },
    { id: 'char-mira', kind: 'character', name: 'Mira' },
    { id: 'item-ring', kind: 'item', name: 'ring' },
    { id: 'loc-chapel', kind: 'location', name: 'chapel' },
  ],
);

assert.ok(pronounCheck.some((item) => item.entityId === 'char-mira' && item.field === 'physical'));
assert.ok(pronounCheck.some((item) => item.entityId === 'char-mira' && item.field === 'habits'));
assert.ok(!pronounCheck.some((item) => item.entityId === 'char-bob' && item.field === 'physical'));
assert.ok(!pronounCheck.some((item) => item.entityId === 'char-bob' && item.field === 'habits'));
assert.ok(pronounCheck.some((item) => item.entityId === 'loc-chapel' && item.field === 'description'));

console.log('mock suggestion expansion tests passed');
