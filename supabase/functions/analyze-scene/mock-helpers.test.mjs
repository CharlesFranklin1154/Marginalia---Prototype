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

console.log('mock suggestion expansion tests passed');
