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
assert.ok(suggestions.some((item) => item.entityId === 'item-1' && item.field === 'notes'));

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

const discoveryText = 'Bob wore a bronze mask. He picked up the Silver Key near Aveline.';
const discovered = buildMockSuggestions(discoveryText, []);
const newEntities = discovered.filter((item) => item.type === 'entity_create');
assert.ok(newEntities.some((item) => item.entityKind === 'character' && item.entityName === 'Bob'));
assert.ok(newEntities.some((item) => item.entityKind === 'item' && item.entityName === 'Silver Key'));
assert.ok(newEntities.some((item) => item.entityKind === 'location' && item.entityName === 'Aveline'));
assert.ok(discovered.some((item) => item.candidateKey === 'character:bob' && item.field === 'physical'));
assert.ok(discovered.some((item) => item.candidateKey === 'item:silver key' && item.field === 'notes'));
assert.ok(discovered.some((item) => item.candidateKey === 'location:aveline' && item.field === 'description'));

const observedAction = buildMockSuggestions('Ulfric glared at each man in turn.', [
  { id: 'character-ulfric', kind: 'character', name: 'Ulfric' },
]);
assert.ok(observedAction.some((item) => item.entityId === 'character-ulfric' && item.field === 'notes'));

const knownEntityDiscovery = buildMockSuggestions(discoveryText, [
  { id: 'char-bob', kind: 'character', name: 'Bob' },
]);
assert.ok(!knownEntityDiscovery.some((item) => item.type === 'entity_create' && item.entityName === 'Bob'));

const newCharacter = buildMockSuggestions('Bob did something.', []);
assert.ok(newCharacter.some((item) => item.type === 'entity_create' && item.entityKind === 'character' && item.entityName === 'Bob'));

const loreCandidates = buildMockSuggestions(
  'The squire resumed his reading. Ulfric glared at the others. The Crossing of the river Versalia led toward the feared woods of Sorbekestan.',
  [],
);
assert.ok(loreCandidates.some((item) => item.type === 'entity_create' && item.entityKind === 'character' && item.entityName === 'Ulfric'));
assert.ok(loreCandidates.some((item) => item.type === 'entity_create' && item.entityKind === 'location' && item.entityName === 'Versalia'));
assert.ok(loreCandidates.some((item) => item.type === 'entity_create' && item.entityKind === 'location' && item.entityName === 'Sorbekestan'));

const nicknameMatch = buildMockSuggestions('Cal raised the banner.', [
  { id: 'character-calvin', kind: 'character', name: 'Calvin', data: { nickname: 'Cal' } },
]);
assert.ok(!nicknameMatch.some((item) => item.type === 'entity_create' && item.entityName === 'Cal'));
const nicknameUpdate = buildMockSuggestions('Cal glared at the sentry.', [
  { id: 'character-calvin', kind: 'character', name: 'Calvin', data: { nickname: 'Cal' } },
]);
assert.ok(nicknameUpdate.some((item) => item.entityId === 'character-calvin' && item.field === 'notes'));

const loreText = 'The armies of Sauron marched east. The Jedi Order guarded the archives. The Force binds all living things. A Warg stalked the ridge. The Crimson Prophecy divided the houses.';
const loreSuggestions = buildMockSuggestions(loreText, []);
const loreCards = loreSuggestions.filter((item) => item.type === 'entity_create' && item.entityKind === 'lore');
assert.ok(loreCards.some((item) => item.entityName === 'Armies of Sauron' && item.loreType === 'faction'));
assert.ok(loreCards.some((item) => item.entityName === 'Jedi Order' && item.loreType === 'faction'));
assert.ok(loreCards.some((item) => item.entityName === 'Force' && item.loreType === 'system'));
assert.ok(loreCards.some((item) => item.entityName === 'Warg' && item.loreType === 'creature'));
assert.ok(loreCards.some((item) => item.entityName === 'Crimson Prophecy' && item.loreType === 'concept'));
assert.ok(loreSuggestions.some((item) => item.candidateKey === 'lore:warg' && item.field === 'overview'));

const savedLoreUpdate = buildMockSuggestions('The Force binds all living things.', [
  { id: 'lore-force', kind: 'lore', name: 'Force', data: { loreType: 'system' } },
]);
assert.ok(savedLoreUpdate.some((item) => item.entityId === 'lore-force' && item.type === 'lore_update' && item.field === 'overview'));

console.log('mock suggestion expansion tests passed');
