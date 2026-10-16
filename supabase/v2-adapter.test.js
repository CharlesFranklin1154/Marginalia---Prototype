const assert = require('node:assert/strict');
const {
  documentPayload,
  entityPayload,
  buildSuggestionAuditPayload,
  dedupeSuggestions,
  summarizeSuggestionStatuses,
  remoteProjectToLocal,
  mergeProjectLists,
  syncProjects,
  buildSuggestionAuditPayload: buildAuditPayload,
  stableSuggestionKey,
} = require('./v2-adapter.js');

const lorePayload = entityPayload({ id: 'project-123' }, 'book-123', 'lore', {
  _id: 'lore-456',
  name: 'The Ashen Order',
  loreType: 'faction',
  overview: 'An old group.',
});
assert.equal(lorePayload.kind, 'lore');
assert.equal(lorePayload.data.loreType, 'faction');
assert.equal(lorePayload.data.overview, 'An old group.');

const characterPayload = entityPayload({ id: 'project-123' }, 'book-123', 'characters', {
  _id: 'character-123',
  name: 'Calvin',
  nickname: 'Cal',
});
assert.equal(characterPayload.data.nickname, 'Cal');

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

const payload = buildAuditPayload({
  projectId: 'project-123',
  category: 'chapters',
  entry: { _id: 'chapter-456', name: 'First Chapter' },
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
assert.equal(payload.client_key, stableSuggestionKey('project-123', 'chapters', 'chapter-456', {
  type: 'character_update',
  entityId: 'entity-789',
  field: 'physical',
  value: 'Mira has a scar above her left eye.',
  evidence: 'Mira touched the scar above her left eye.',
  sourceLine: 7,
}));
assert.equal(payload.metadata.sourceLabel, 'First Chapter');

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

const restored = remoteProjectToLocal(
  {
    client_key: 'project-remote',
    title: 'Remote book',
    theme: 'noir',
    cover_url: 'cover-data',
    brain_dump: 'Loose note',
    updated_at: '2026-10-15T12:00:00.000Z',
  },
  [
    {
      id: 'doc-1',
      client_key: 'project-remote:chapters:chapter-1',
      kind: 'chapter',
      title: 'Chapter One',
      content_html: '<p>Opening</p>',
      word_goal: 1200,
    },
  ],
  [
    {
      id: 'entity-1',
      client_key: 'project-remote:lore:lore-1',
      kind: 'lore',
      name: 'The Ashen Order',
      data: { _id: 'lore-1', loreType: 'faction' },
    },
  ],
);
assert.equal(restored.id, 'project-remote');
assert.equal(restored.cover, 'cover-data');
assert.equal(restored.brainDump, 'Loose note');
assert.equal(restored.chapters[0]._id, 'chapter-1');
assert.equal(restored.chapters[0].wordGoal, 1200);
assert.equal(restored.lore[0].loreType, 'faction');

const merged = mergeProjectLists(
  [{
    id: 'same-project',
    title: 'Local edit',
    updated: 200,
    chapters: [{ _id: 'shared', name: 'Local chapter' }, { _id: 'local-only', name: 'Local only' }],
  }],
  [{
    id: 'same-project',
    title: 'Remote edit',
    updated: 300,
    chapters: [{ _id: 'shared', name: 'Remote chapter' }, { _id: 'remote-only', name: 'Remote only' }],
  }],
);
assert.equal(merged[0].title, 'Remote edit');
assert.equal(merged[0].chapters.find(entry => entry._id === 'shared').name, 'Remote chapter');
assert.deepEqual(merged[0].chapters.map(entry => entry._id), ['shared', 'remote-only', 'local-only']);

(async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const statuses = [];
  global.MarginaliaV2.setStatusListener(state => statuses.push(state));
  global.MarginaliaV2.config.supabaseUrl = 'https://example.supabase.co';
  global.MarginaliaV2.config.anonKey = 'public-test-key';
  global.MarginaliaV2.setAccessToken('test-access-token');
  global.MarginaliaV2.setCloudReady(true);
  const originalWindow = global.window;
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || 'GET';
    if (method === 'GET' && url.pathname.endsWith('/books')) {
      return Response.json([{
        id: 'book-loaded',
        client_key: 'project-loaded',
        title: 'Loaded book',
        theme: 'rainy',
        cover_url: null,
        brain_dump: '',
        updated_at: '2026-10-15T12:00:00.000Z',
      }]);
    }
    if (method === 'GET' && url.pathname.endsWith('/documents')) {
      return Response.json([{
        id: 'document-loaded',
        client_key: 'project-loaded:scenes:scene-1',
        kind: 'scene',
        title: 'Loaded scene',
        content_html: '<p>Remote writing</p>',
        word_goal: null,
      }]);
    }
    if (method === 'GET' && url.pathname.endsWith('/entities')) {
      return Response.json([{
        id: 'entity-loaded',
        client_key: 'project-loaded:characters:character-1',
        kind: 'character',
        name: 'Mira',
        data: { _id: 'character-1', nickname: 'Mi' },
      }]);
    }
    throw new Error(`Unexpected load request: ${method} ${url.pathname}`);
  };

  const cloudLibrary = await global.MarginaliaV2.loadProjects();
  assert.equal(cloudLibrary.length, 1);
  assert.equal(cloudLibrary[0].scenes[0].details, '<p>Remote writing</p>');
  assert.equal(cloudLibrary[0].characters[0].nickname, 'Mi');
  global.MarginaliaV2.setCloudReady(false);
  await assert.rejects(syncProjects([]), /backend is not configured/);
  global.MarginaliaV2.setCloudReady(true);

  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || 'GET';
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    requests.push({ method, pathname: url.pathname, query: url.searchParams, body: options.body ? JSON.parse(options.body) : null });

    if (method === 'POST' && url.pathname.endsWith('/books')) {
      return new Response(JSON.stringify([{ id: 'book-remote', client_key: 'project-sync' }]), { status: 201 });
    }
    if (method === 'POST') return new Response(null, { status: 204 });
    if (method === 'GET' && url.pathname.endsWith('/entities')) {
      return Response.json([{ id: 'entity-kept', client_key: 'project-sync:characters:character-1' }, { id: 'entity-stale', client_key: 'old-entity' }]);
    }
    if (method === 'GET' && url.pathname.endsWith('/documents')) {
      return Response.json([{ id: 'document-stale', client_key: 'old-document' }]);
    }
    if (method === 'GET' && url.pathname.endsWith('/books')) {
      return Response.json([{ id: 'book-remote', client_key: 'project-sync' }, { id: 'book-stale', client_key: 'removed-project' }]);
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
  };

  try {
    await syncProjects([{
      id: 'project-sync',
      title: 'Sync test',
      updated: Date.now(),
      characters: [{ _id: 'character-1', name: 'Mira' }],
      chapters: [{ _id: 'chapter-1', name: 'Opening', details: '<p>Start</p>' }],
    }]);
    assert.ok(requests.some(request => request.method === 'DELETE' && request.pathname.endsWith('/entities')));
    assert.ok(requests.some(request => request.method === 'DELETE' && request.pathname.endsWith('/documents')));
    assert.ok(requests.some(request => request.method === 'DELETE' && request.pathname.endsWith('/books')));
    assert.equal(statuses.at(-1), 'synced');

    statuses.length = 0;
    global.fetch = async (input, options = {}) => {
      const url = new URL(input);
      const method = options.method || 'GET';
      if (method === 'POST' && url.pathname.endsWith('/books')) {
        return Response.json([{ id: 'book-failure', client_key: 'project-failure' }], { status: 201 });
      }
      if (method === 'POST' && url.pathname.endsWith('/entities')) {
        return new Response('write rejected', { status: 403 });
      }
      throw new Error(`Unexpected failure-test request: ${method} ${url.pathname}`);
    };
    await assert.rejects(
      syncProjects([{
        id: 'project-failure',
        updated: Date.now(),
        characters: [{ _id: 'character-1', name: 'Mira' }],
      }]),
      /V2 request failed: 403/,
    );
    assert.ok(!statuses.includes('synced'));

    let completeBookUpsert;
    global.fetch = async (input, options = {}) => {
      assert.equal(options.headers.Authorization, 'Bearer test-access-token');
      return new Promise(resolve => {
      completeBookUpsert = () => resolve(Response.json([{ id: 'book-old-session', client_key: 'project-old-session' }], { status: 201 }));
      });
    };
    const accountSwitchSync = syncProjects([{
      id: 'project-old-session',
      updated: Date.now(),
      characters: [{ _id: 'character-1', name: 'Mira' }],
    }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(typeof completeBookUpsert, 'function');
    global.MarginaliaV2.setAccessToken('different-account-token');
    completeBookUpsert();
    await assert.rejects(accountSwitchSync, /signed-in account changed during sync/);

    global.MarginaliaV2.setAccessToken('test-access-token');
    const suggestionStore = new Map();
    global.window = {};
    let emptyAnalysisResponse = false;
    global.fetch = async (input, options = {}) => {
      const url = new URL(input);
      const method = options.method || 'GET';
      const path = url.pathname;
      if (method === 'POST' && path.endsWith('/functions/v1/analyze-scene')) {
        assert.equal(options.headers.Prefer, undefined);
        if (emptyAnalysisResponse) return new Response(null, { status: 200 });
        return Response.json({
          suggestions: [{
            id: 'mock-suggestion',
            type: 'character_update',
            entityId: 'entity-ai',
            field: 'physical',
            operation: 'append',
            value: 'A scar above the left eye.',
            evidence: 'Mira touched the scar above her left eye.',
            sourceText: 'Mira touched the scar above her left eye.',
            sourceLine: 2,
            confidence: 0.91,
            status: 'pending',
          }],
          analysis: { mode: 'mock', entitiesChecked: 1 },
        });
      }
      if (method === 'POST' && path.endsWith('/books')) {
        return Response.json([{ id: 'book-ai', client_key: 'project-ai' }], { status: 201 });
      }
      if (method === 'POST' && path.endsWith('/documents')) return new Response(null, { status: 204 });
      if (method === 'POST' && path.endsWith('/entities')) return new Response(null, { status: 204 });
      if (method === 'POST' && path.endsWith('/ai_suggestions')) {
        for (const row of JSON.parse(options.body)) {
          if (!suggestionStore.has(row.client_key)) suggestionStore.set(row.client_key, { ...row, id: 'audit-' + suggestionStore.size, reviewed_at: null });
        }
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH' && path.endsWith('/ai_suggestions')) {
        const match = url.searchParams.get('client_key') || '';
        const keys = Array.from(match.matchAll(/"([^"]+)"/g), result => result[1]);
        const patch = JSON.parse(options.body);
        const rows = keys.map(key => {
          const stored = suggestionStore.get(key);
          if (!stored) return null;
          Object.assign(stored, patch);
          return { id: stored.id, client_key: key, status: stored.status, reviewed_at: stored.reviewed_at };
        }).filter(Boolean);
        return Response.json(rows);
      }
      if (method === 'GET' && path.endsWith('/books')) {
        if (url.searchParams.has('client_key')) return Response.json([{ id: 'book-ai' }]);
        return Response.json([{ id: 'book-ai', client_key: 'project-ai' }]);
      }
      if (method === 'GET' && path.endsWith('/documents')) {
        if (url.searchParams.has('client_key')) return Response.json([{ id: 'document-ai', client_key: 'project-ai:chapters:chapter-ai' }]);
        return Response.json([{ id: 'document-ai', client_key: 'project-ai:chapters:chapter-ai' }]);
      }
      if (method === 'GET' && path.endsWith('/entities')) {
        return Response.json([{
          id: 'entity-ai',
          client_key: 'project-ai:characters:character-ai',
          kind: 'character',
          name: 'Mira',
          data: { _id: 'character-ai' },
        }]);
      }
      if (method === 'GET' && path.endsWith('/ai_suggestions')) return Response.json(Array.from(suggestionStore.values()));
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`Unexpected review test request: ${method} ${path}`);
    };

    const reviewProject = {
      id: 'project-ai',
      title: 'Review test',
      updated: Date.now(),
      characters: [{ _id: 'character-ai', name: 'Mira' }],
      chapters: [{ _id: 'chapter-ai', name: 'First Chapter', details: '<p>Mira touched a scar.</p>' }],
      scenes: [],
      brainDumps: [],
      locations: [],
      items: [],
      lore: [],
    };
    const reviewEntry = { ...reviewProject.chapters[0], category: 'chapters' };
    const firstReview = await global.MarginaliaV2.analyzeProjectEntry(reviewProject, reviewEntry);
    assert.equal(firstReview.suggestions[0].status, 'pending');
    assert.ok(firstReview.suggestions[0].client_key);
    await global.MarginaliaV2.persistSuggestionStatuses(reviewProject, reviewEntry, firstReview.suggestions, 'approved');
    const afterApproval = await global.MarginaliaV2.analyzeProjectEntry(reviewProject, reviewEntry);
    assert.equal(afterApproval.suggestions[0].status, 'approved');
    await global.MarginaliaV2.persistSuggestionStatuses(reviewProject, reviewEntry, afterApproval.suggestions, 'rejected');
    const afterRejection = await global.MarginaliaV2.analyzeProjectEntry(reviewProject, reviewEntry);
    assert.equal(afterRejection.suggestions[0].status, 'rejected');
    emptyAnalysisResponse = true;
    await assert.rejects(
      global.MarginaliaV2.analyzeProjectEntry(reviewProject, reviewEntry),
      /Scene analysis returned an empty response \(HTTP 200\)/,
    );
  } finally {
    global.fetch = originalFetch;
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    global.MarginaliaV2.setAccessToken('');
    global.MarginaliaV2.setCloudReady(false);
    global.MarginaliaV2.config.supabaseUrl = '';
    global.MarginaliaV2.config.anonKey = '';
    global.MarginaliaV2.setStatusListener(null);
  }

  console.log('v2-adapter restoration, merge, sync, and deletion tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
