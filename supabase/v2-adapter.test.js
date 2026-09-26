const assert = require('node:assert/strict');
const { documentPayload, buildSuggestionAuditPayload, dedupeSuggestions, summarizeSuggestionStatuses } = require('./v2-adapter.js');

const document = documentPayload({ id: 'project-123' }, 'book-123', 'chapters', {
  _id: 'chapter-456',
  name: 'First Chapter',
  details: '<p>Once upon a time.</p>',
  wordGoal: 1800,
});
assert.equal(document.client_key, 'project-123:chapters:chapter-456');
assert.equal(document.word_goal, 1800);

const documentWithoutGoal = documentPayload({ id: 'project-123' }, 'book-123', 'chapters', {
  _id: 'chapter-789',
  name: 'Second Chapter',
  details: '',
});
assert.equal(documentWithoutGoal.word_goal, null);

const payload = buildSuggestionAuditPayload({
  bookId: 'book-123',
  documentId: 'doc-456',
  entityId: 'entity-789',
  suggestion: {
    type: 'character_update',
    field: 'physical',
    operation: 'append',
    value: 'Mira has a scar above her left eye.',
    evidence: 'Mira touched the scar above her left eye.',
    sourceLine: 7,
    confidence: 0.91,
    status: 'pending',
  },
});

assert.equal(payload.book_id, 'book-123');
assert.equal(payload.document_id, 'doc-456');
assert.equal(payload.entity_id, 'entity-789');
assert.equal(payload.type, 'character_update');
assert.equal(payload.field, 'physical');
assert.equal(payload.operation, 'append');
assert.equal(payload.value, 'Mira has a scar above her left eye.');
assert.equal(payload.evidence, 'Mira touched the scar above her left eye.');
assert.equal(payload.source_line, 7);
assert.equal(payload.confidence, 0.91);
assert.equal(payload.status, 'pending');

const suggestions = [
  {
    entityId: 'entity-789',
    field: 'physical',
    value: 'Mira has a scar above her left eye.',
    evidence: 'Mira touched the scar above her left eye.',
    sourceLine: 7,
    status: 'pending',
  },
  {
    entityId: 'entity-789',
    field: 'physical',
    value: 'Mira has a scar above her left eye.',
    evidence: 'Mira touched the scar above her left eye.',
    sourceLine: 7,
    status: 'approved',
  },
  {
    entityId: 'entity-999',
    field: 'physical',
    value: 'Mira has a scar above her left eye.',
    evidence: 'Mira touched the scar above her left eye.',
    sourceLine: 7,
    status: 'pending',
  },
  {
    entityId: 'entity-789',
    field: 'physical',
    value: 'Mira has a different scar note.',
    evidence: 'Mira touched the scar above her left eye.',
    sourceLine: 7,
    status: 'pending',
  },
];

const deduped = dedupeSuggestions(suggestions);
assert.equal(deduped.length, 3);
assert.equal(deduped[0].status, 'pending');
assert.equal(deduped[1].entityId, 'entity-999');
assert.equal(deduped[2].entityId, 'entity-789');

const summary = summarizeSuggestionStatuses([
  { status: 'pending' },
  { status: 'approved' },
  { status: 'rejected' },
  { status: 'pending' },
  { status: 'approved' },
]);
assert.deepEqual(summary, { total: 5, pending: 2, approved: 2, rejected: 1 });

console.log('v2-adapter audit payload, deduplication, and review-history tests passed');
