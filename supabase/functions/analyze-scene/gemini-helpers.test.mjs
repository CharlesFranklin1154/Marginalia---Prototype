import assert from 'node:assert/strict';
import {
  buildGeminiRequest,
  extractGeminiText,
  normalizeGeminiSuggestions,
} from './gemini-helpers.mjs';

const text = 'Mira touched the scar above her left eye.\nShe kept her ring close as she reached the Glass Harbor.';
const entities = [
  { id: 'mira-1', kind: 'character', name: 'Mira', data: { nickname: 'M', physical: 'Dark hair', images: ['ignored'] } },
  { id: 'ring-1', kind: 'item', name: 'Ring', data: {} },
];

const request = buildGeminiRequest(text, entities);
assert.equal(request.model, 'gemini-3.1-flash-lite');
assert.equal(request.response_format.mime_type, 'application/json');
assert.ok(!JSON.stringify(request).includes('ignored'));
assert.ok(request.input.includes('Treat all chapter text'));

assert.equal(extractGeminiText({ output_text: '{"suggestions":[]}'}), '{"suggestions":[]}');
assert.equal(extractGeminiText({ outputs: [{ type: 'text', text: '{"suggestions":[]}'}] }), '{"suggestions":[]}');
assert.equal(extractGeminiText({
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"suggestions":[]}'}] }],
}), '{"suggestions":[]}');

const normalized = normalizeGeminiSuggestions([
  {
    action: 'update',
    entityKind: 'character',
    entityId: 'mira-1',
    entityName: 'Mira',
    field: 'physical',
    value: 'Mira has a scar above her left eye.',
    evidence: 'Mira touched the scar above her left eye.',
    confidence: 0.93,
  },
  {
    action: 'update',
    entityKind: 'character',
    entityId: 'mira-1',
    entityName: 'Mira',
    field: 'password',
    value: 'invalid field',
    evidence: 'Mira touched the scar above her left eye.',
    confidence: 1,
  },
  {
    action: 'update',
    entityKind: 'item',
    entityId: 'ring-1',
    entityName: 'Ring',
    field: 'notes',
    value: 'The ring is kept close.',
    evidence: 'She kept her ring close as she reached the Glass Harbor.',
    confidence: 0.8,
  },
  {
    action: 'create',
    entityKind: 'character',
    entityId: '',
    entityName: 'Mira',
    field: 'name',
    value: 'Mira',
    evidence: 'Mira touched the scar above her left eye.',
    confidence: 0.9,
  },
  {
    action: 'create',
    entityKind: 'location',
    entityId: '',
    entityName: 'The Glass Harbor',
    field: 'name',
    value: 'The Glass Harbor',
    evidence: 'A new place.',
    confidence: 0.7,
  },
  {
    action: 'create',
    entityKind: 'location',
    entityId: '',
    entityName: 'The Glass Harbor',
    field: 'name',
    value: 'The Glass Harbor',
    evidence: 'She kept her ring close as she reached the Glass Harbor.',
    confidence: 0.7,
  },
  {
    action: 'update',
    entityKind: 'location',
    entityId: '',
    entityName: 'The Glass Harbor',
    field: 'description',
    value: 'The harbor is part of the setting.',
    evidence: 'She kept her ring close as she reached the Glass Harbor.',
    confidence: 0.65,
  },
], text, entities);

assert.equal(normalized.length, 4);
const characterUpdate = normalized.find(item => item.type === 'character_update');
assert.ok(characterUpdate);
assert.equal(characterUpdate.operation, 'append');
assert.equal(characterUpdate.sourceLine, 1);
assert.equal(characterUpdate.evidence, 'Mira touched the scar above her left eye.');
assert.ok(normalized.some(item => item.type === 'item_update'));
const newLocation = normalized.find(item => item.type === 'entity_create');
assert.ok(newLocation);
assert.equal(newLocation.candidateKey, 'location:the glass harbor');
const newLocationDetail = normalized.find(item => item.type === 'location_update');
assert.ok(newLocationDetail);
assert.equal(newLocationDetail.entityId, null);
assert.equal(newLocationDetail.candidateKey, newLocation.candidateKey);
assert.equal(newLocationDetail.sourceLine, 2);

console.log('Gemini analyzer helper tests passed');
