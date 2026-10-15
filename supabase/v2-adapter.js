(function () {
  'use strict';

  const config = {
    enabled: true,
    supabaseUrl: '',
    anonKey: '',
    accessToken: '',
    cloudReady: false,
  };

  let syncTimer = null;
  let pendingProjects = null;
  let syncQueue = Promise.resolve();
  let authGeneration = 0;
  let statusListener = null;

  function reportStatus(state, message) {
    if (statusListener) statusListener(state, message);
  }

  function hasCredentials() {
    return config.enabled && config.supabaseUrl && config.anonKey && config.accessToken;
  }

  function isConfigured() {
    return hasCredentials() && config.cloudReady;
  }

  function setAccessToken(accessToken) {
    const nextToken = accessToken || '';
    if (config.accessToken !== nextToken) authGeneration += 1;
    config.accessToken = nextToken;
  }

  function setCloudReady(ready) {
    const nextReady = Boolean(ready);
    if (config.cloudReady !== nextReady) authGeneration += 1;
    config.cloudReady = nextReady;
  }

  function captureAuthContext() {
    return { accessToken: config.accessToken, url: config.supabaseUrl, generation: authGeneration };
  }

  function assertAuthContext(context) {
    if (context.generation !== authGeneration) {
      throw new Error('The signed-in account changed during sync. Sign in again to retry.');
    }
  }

  function projectUpdatedAt(project) {
    const timestamp = Number(project && (project.syncUpdated || project.updated)) || Date.now();
    return new Date(timestamp).toISOString();
  }

  function projectSyncTimestamp(project) {
    return Number(project && (project.syncUpdated || project.updated)) || 0;
  }

  function headers() {
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    };
  }

  async function request(path, options, context = captureAuthContext()) {
    assertAuthContext(context);
    const requestHeaders = { ...headers(), ...(options && options.headers) };
    requestHeaders.Authorization = `Bearer ${context.accessToken}`;
    const response = await fetch(`${context.url}/rest/v1/${path}`, {
      ...options,
      headers: requestHeaders,
    });
    assertAuthContext(context);
    if (!response.ok) {
      const detail = await response.text();
      assertAuthContext(context);
      throw new Error(`V2 request failed: ${response.status} ${detail.slice(0, 300)}`);
    }
    if (response.status === 204) return null;
    const data = await response.json();
    assertAuthContext(context);
    return data;
  }

  function projectPayload(project) {
    return {
      client_key: project.id,
      title: project.title || 'Untitled book',
      theme: project.theme || 'rainy',
      cover_url: project.cover || null,
      brain_dump: project.brainDump || '',
      updated_at: projectUpdatedAt(project),
    };
  }

  function entityPayload(project, bookId, kind, entry) {
    if (!entry || !entry._id) throw new Error(`Cannot sync ${kind} entry without a local id.`);
    return {
      client_key: `${project.id}:${kind}:${entry._id}`,
      book_id: bookId,
      kind: ({ characters: 'character', locations: 'location', items: 'item', lore: 'lore' })[kind] || 'item',
      name: entry.name || 'Untitled',
      data: entry,
      updated_at: projectUpdatedAt(project),
    };
  }

  function htmlToPlainText(html) {
    return (html || '')
      .replace(/<\/?(?:p|div|h[1-6]|li|br)[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim();
  }

  function documentPayload(project, bookId, kind, entry) {
    if (!entry || !entry._id) throw new Error(`Cannot sync ${kind} entry without a local id.`);
    const contentHtml = entry.details || '';
    const contentText = htmlToPlainText(contentHtml);
    return {
      client_key: `${project.id}:${kind}:${entry._id}`,
      book_id: bookId,
      kind: kind === 'chapters' ? 'chapter' : kind === 'scenes' ? 'scene' : 'brain_dump',
      title: entry.name || 'Untitled',
      content_html: contentHtml,
      content_text: contentText,
      word_goal: entry.wordGoal == null ? null : Number(entry.wordGoal),
      updated_at: projectUpdatedAt(project),
    };
  }

  function remoteProjectToLocal(book, documents, entities) {
    const project = {
      id: book.client_key,
      title: book.title || 'Untitled book',
      theme: book.theme || 'rainy',
      cover: book.cover_url || null,
      brainDump: book.brain_dump || '',
      updated: Date.parse(book.updated_at) || Date.now(),
      syncUpdated: Date.parse(book.updated_at) || Date.now(),
      lastOpened: null,
    };
    for (const category of ['chapters', 'scenes', 'brainDumps', 'characters', 'locations', 'items', 'lore']) {
      project[category] = [];
    }

    const categoriesByKind = {
      character: 'characters',
      location: 'locations',
      item: 'items',
      lore: 'lore',
    };
    for (const entity of entities) {
      const category = categoriesByKind[entity.kind];
      if (!category) continue;
      const keyParts = String(entity.client_key || '').split(':');
      const entryId = keyParts.length > 2 ? keyParts.slice(2).join(':') : null;
      const data = entity.data && typeof entity.data === 'object' ? entity.data : {};
      project[category].push({
        ...data,
        _id: data._id || entryId || entity.id,
        name: entity.name || data.name || 'Untitled',
      });
    }

    const categoriesByDocumentKind = {
      chapter: 'chapters',
      scene: 'scenes',
      brain_dump: 'brainDumps',
    };
    for (const document of documents) {
      const category = categoriesByDocumentKind[document.kind];
      if (!category) continue;
      const keyParts = String(document.client_key || '').split(':');
      const entryId = keyParts.length > 2 ? keyParts.slice(2).join(':') : null;
      project[category].push({
        _id: entryId || document.id,
        name: document.title || 'Untitled',
        details: document.content_html || '',
        wordGoal: document.word_goal == null ? null : Number(document.word_goal),
      });
    }
    return project;
  }

  function mergeProjectLists(localProjects, remoteProjects) {
    const localById = new Map((Array.isArray(localProjects) ? localProjects : []).map(project => [project.id, project]));
    const remoteById = new Map((Array.isArray(remoteProjects) ? remoteProjects : []).map(project => [project.id, project]));
    const merged = [];
    const projectIds = new Set([...localById.keys(), ...remoteById.keys()]);

    for (const id of projectIds) {
      const local = localById.get(id);
      const remote = remoteById.get(id);
      if (!local) {
        merged.push(remote);
        continue;
      }
      if (!remote) {
        merged.push(local);
        continue;
      }

      const preferLocal = projectSyncTimestamp(local) >= projectSyncTimestamp(remote);
      const base = preferLocal ? local : remote;
      const other = preferLocal ? remote : local;
      const project = { ...other, ...base };
      for (const category of ['chapters', 'scenes', 'brainDumps', 'characters', 'locations', 'items', 'lore']) {
        const preferredEntries = Array.isArray(base[category]) ? base[category] : [];
        const otherEntries = Array.isArray(other[category]) ? other[category] : [];
        const entries = new Map(preferredEntries.map(entry => [entry._id, entry]));
        for (const entry of otherEntries) {
          if (!entries.has(entry._id)) entries.set(entry._id, entry);
        }
        project[category] = Array.from(entries.values());
      }
      merged.push(project);
    }
    return merged;
  }

  function dedupeSuggestions(suggestions) {
    const seen = new Set();
    return (Array.isArray(suggestions) ? suggestions : []).filter((suggestion) => {
      const token = [
        suggestion && suggestion.entityId != null ? suggestion.entityId : suggestion && suggestion.localEntityKey ? suggestion.localEntityKey : 'anonymous',
        suggestion && suggestion.field ? String(suggestion.field) : '',
        suggestion && (suggestion.evidence || suggestion.sourceText) ? String(suggestion.evidence || suggestion.sourceText).trim() : '',
        suggestion && suggestion.sourceLine != null ? String(suggestion.sourceLine) : '1',
        suggestion && suggestion.value ? String(suggestion.value).trim() : '',
      ].join('|');
      const key = token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function summarizeSuggestionStatuses(suggestions) {
    const list = Array.isArray(suggestions) ? suggestions : [];
    const summary = { total: list.length, pending: 0, approved: 0, rejected: 0 };
    for (const suggestion of list) {
      const status = suggestion && suggestion.status ? String(suggestion.status).toLowerCase() : 'pending';
      if (status === 'approved') summary.approved += 1;
      else if (status === 'rejected') summary.rejected += 1;
      else summary.pending += 1;
    }
    return summary;
  }

  function stableSuggestionKey(projectId, category, entryId, suggestion) {
    const identity = [
      suggestion && suggestion.entityId ? suggestion.entityId : suggestion && suggestion.candidateKey ? suggestion.candidateKey : 'anonymous',
      suggestion && suggestion.type ? suggestion.type : '',
      suggestion && suggestion.field ? suggestion.field : '',
      suggestion && (suggestion.evidence || suggestion.sourceText) ? String(suggestion.evidence || suggestion.sourceText).trim() : '',
      suggestion && suggestion.sourceLine != null ? String(suggestion.sourceLine) : '1',
      suggestion && suggestion.value ? String(suggestion.value).trim() : '',
    ].join('|').toLowerCase();
    let first = 2166136261;
    let second = 5381;
    for (let index = 0; index < identity.length; index += 1) {
      const code = identity.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second, 33) ^ code;
    }
    const hash = `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
    return `${projectId}:${category}:${entryId}:${hash}`;
  }

  function buildSuggestionAuditPayload({ projectId, category, entry, bookId, documentId, entityId, suggestion }) {
    const sourceText = String(suggestion && (suggestion.sourceText || suggestion.evidence) || '');
    return {
      client_key: stableSuggestionKey(projectId, category, entry && entry._id, {
        ...suggestion,
        entityId: entityId || suggestion && suggestion.entityId,
      }),
      book_id: bookId,
      document_id: documentId || null,
      entity_id: entityId || null,
      type: suggestion && suggestion.type ? suggestion.type : 'memory_update',
      field: suggestion && suggestion.field ? suggestion.field : '',
      operation: suggestion && suggestion.operation ? suggestion.operation : 'append',
      value: suggestion && suggestion.value ? String(suggestion.value) : '',
      evidence: String(suggestion && (suggestion.evidence || suggestion.sourceText) || ''),
      source_line: Number(suggestion && suggestion.sourceLine ? suggestion.sourceLine : 1),
      confidence: Number(suggestion && suggestion.confidence != null ? suggestion.confidence : 0.5),
      status: suggestion && suggestion.status ? suggestion.status : 'pending',
      metadata: {
        candidateKey: suggestion && suggestion.candidateKey || null,
        entityKind: suggestion && suggestion.entityKind || null,
        entityName: suggestion && suggestion.entityName || null,
        sourceText,
        sourceLabel: suggestion && suggestion.sourceLabel || entry && entry.sourceLabel || entry && entry.name || 'Untitled entry',
        sourceDocumentKey: suggestion && suggestion.sourceDocumentKey || null,
      },
    };
  }

  async function deleteStaleRows(table, bookId, keptKeys, context) {
    const rows = await request(`${table}?book_id=eq.${encodeURIComponent(bookId)}&select=id,client_key`, undefined, context);
    const kept = new Set(keptKeys);
    const staleIds = rows.filter(row => !kept.has(row.client_key)).map(row => row.id);
    if (staleIds.length) {
      await request(`${table}?id=in.${encodeURIComponent(`(${staleIds.join(',')})`)}`, { method: 'DELETE' }, context);
    }
  }

  async function syncProjectData(project, context) {
    const books = await request('books?on_conflict=client_key&select=id,client_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ ...projectPayload(project), user_id: undefined }),
    }, context);
    const bookId = books && books[0] && books[0].id;
    if (!bookId) throw new Error('V2 book sync did not return an id.');
    const entities = ['characters', 'locations', 'items', 'lore']
      .flatMap(kind => (project[kind] || []).map(entry => entityPayload(project, bookId, kind, entry)));
    if (entities.length) {
      await request('entities?on_conflict=client_key', { method: 'POST', body: JSON.stringify(entities) }, context);
    }
    const documents = ['chapters', 'scenes', 'brainDumps']
      .flatMap(kind => (project[kind] || []).map(entry => documentPayload(project, bookId, kind, entry)));
    if (documents.length) {
      await request('documents?on_conflict=client_key', { method: 'POST', body: JSON.stringify(documents) }, context);
    }
    await Promise.all([
      deleteStaleRows('entities', bookId, entities.map(entity => entity.client_key), context),
      deleteStaleRows('documents', bookId, documents.map(document => document.client_key), context),
    ]);
  }

  async function loadProjects() {
    if (!hasCredentials()) throw new Error('Marginalia V2 backend is not configured.');
    const context = captureAuthContext();
    const books = await request('books?select=id,client_key,title,theme,cover_url,brain_dump,updated_at&order=updated_at.asc', undefined, context);
    return Promise.all(books.map(async book => {
      const [documents, entities] = await Promise.all([
        request(`documents?book_id=eq.${encodeURIComponent(book.id)}&select=id,client_key,kind,title,content_html,word_goal&order=created_at.asc`, undefined, context),
        request(`entities?book_id=eq.${encodeURIComponent(book.id)}&select=id,client_key,kind,name,data&order=created_at.asc`, undefined, context),
      ]);
      return remoteProjectToLocal(book, documents, entities);
    }));
  }

  async function syncProject(project, context = captureAuthContext()) {
    if (!isConfigured() || !project) return;
    reportStatus('syncing', 'Syncing with Supabase...');
    const operation = syncQueue.then(async () => {
      await syncProjectData(project, context);
      reportStatus('synced', 'Saved locally and synced to Supabase');
    });
    syncQueue = operation.catch(() => {});
    return operation;
  }

  async function syncProjects(projects, context = captureAuthContext()) {
    if (!isConfigured()) throw new Error('Marginalia V2 backend is not configured.');
    const safeProjects = Array.isArray(projects) ? projects : [];
    reportStatus('syncing', 'Syncing your library with Supabase...');
    const operation = syncQueue.then(async () => {
      for (const project of safeProjects) await syncProjectData(project, context);

      const remoteBooks = await request('books?select=id,client_key', undefined, context);
      const keptKeys = new Set(safeProjects.map(project => project.id));
      const staleIds = remoteBooks.filter(book => !keptKeys.has(book.client_key)).map(book => book.id);
      if (staleIds.length) {
        await request(`books?id=in.${encodeURIComponent(`(${staleIds.join(',')})`)}`, { method: 'DELETE' }, context);
      }
      reportStatus('synced', 'Saved locally and synced to Supabase');
    });
    syncQueue = operation.catch(() => {});
    return operation;
  }

  function scheduleProjectsSync(projects) {
    if (!isConfigured()) return;
    pendingProjects = { projects: Array.isArray(projects) ? projects.slice() : [], context: captureAuthContext() };
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const pending = pendingProjects;
      pendingProjects = null;
      if (!pending) return;
      try {
        await syncProjects(pending.projects, pending.context);
      } catch (error) {
        console.warn('Marginalia V2 sync deferred:', error);
        reportStatus('error', `Saved locally; Supabase sync needs attention: ${error.message}`);
      }
    }, 500);
  }

  function scheduleProjectSync(project) {
    scheduleProjectsSync(project ? [project] : []);
  }

  function clearPendingSync() {
    clearTimeout(syncTimer);
    syncTimer = null;
    pendingProjects = null;
  }

  async function analyzeScene(payload, context = captureAuthContext()) {
    if (!isConfigured()) throw new Error('Marginalia V2 backend is not configured.');
    assertAuthContext(context);
    if (window.marginaliaSupabaseClient) {
      const { data, error } = await window.marginaliaSupabaseClient.functions.invoke('analyze-scene', { body: payload });
      assertAuthContext(context);
      if (error) throw new Error(error.message || 'The analyze-scene function failed.');
      return data;
    }
    const requestHeaders = headers();
    requestHeaders.Authorization = `Bearer ${context.accessToken}`;
    const response = await fetch(`${context.url}/functions/v1/analyze-scene`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Scene analysis failed: ${response.status}`);
    return response.json();
  }

  async function analyzeProjectEntry(project, entry) {
    if (!isConfigured()) throw new Error('Marginalia V2 backend is not configured.');
    const context = captureAuthContext();
    await syncProject(project, context);
    const books = await request(`books?client_key=eq.${encodeURIComponent(project.id)}&select=id`, undefined, context);
    const bookId = books && books[0] && books[0].id;
    if (!bookId) throw new Error('This book has not synced to Supabase yet.');
    const entities = await request(`entities?book_id=eq.${encodeURIComponent(bookId)}&select=id,client_key,kind,name,data`, undefined, context);
    const entityById = new Map(entities.map(entity => [entity.id, entity]));
    const remoteDocumentClientKey = entry && entry.category && entry._id ? `${project.id}:${entry.category}:${entry._id}` : null;
    const documentMatch = remoteDocumentClientKey
      ? await request(`documents?book_id=eq.${encodeURIComponent(bookId)}&client_key=eq.${encodeURIComponent(remoteDocumentClientKey)}&select=id,client_key`, undefined, context)
      : [];
    const documentId = documentMatch && documentMatch[0] ? documentMatch[0].id : null;
    if (!documentId) throw new Error('This passage has not synced to Supabase yet.');
    const result = await analyzeScene({
      bookId,
      text: htmlToPlainText(entry.details),
      entities: entities.map(entity => ({ id: entity.id, kind: entity.kind, name: entity.name, data: entity.data || {} })),
    }, context);
    result.suggestions = dedupeSuggestions((result.suggestions || []).map(suggestion => {
      const entity = entityById.get(suggestion.entityId);
      return {
        ...suggestion,
        sourceText: suggestion.sourceText || suggestion.evidence || '',
        localEntityKey: suggestion.candidateKey
          ? `candidate:${suggestion.candidateKey}`
          : entity && entity.client_key ? entity.client_key : null,
        entityName: suggestion.entityName || (entity && entity.name) || null,
        entityKind: suggestion.entityKind || (entity && entity.kind) || null,
        sourceDocumentKey: remoteDocumentClientKey,
        sourceLabel: entry.sourceLabel || entry.name || 'Untitled entry',
      };
    }));
    const suggestionsForAudit = result.suggestions.map(suggestion => buildSuggestionAuditPayload({
      projectId: project.id,
      category: entry.category,
      entry,
      bookId,
      documentId,
      entityId: suggestion.entityId || null,
      suggestion,
    }));
    if (suggestionsForAudit.length) {
      await request('ai_suggestions?on_conflict=client_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(suggestionsForAudit),
      }, context);
    }
    const savedSuggestions = await request(
      `ai_suggestions?document_id=eq.${encodeURIComponent(documentId)}&select=id,client_key,entity_id,type,field,operation,value,evidence,source_line,confidence,status,metadata,reviewed_at&order=created_at.asc`,
      undefined,
      context,
    );
    return {
      ...result,
      suggestions: savedSuggestions.map(saved => {
        const metadata = saved.metadata && typeof saved.metadata === 'object' ? saved.metadata : {};
        const entity = entityById.get(saved.entity_id);
        const candidateKey = metadata.candidateKey || null;
        const categoryByKind = { character: 'characters', location: 'locations', item: 'items', lore: 'lore' };
        const candidateCategory = categoryByKind[metadata.entityKind];
        const candidateEntity = candidateCategory && (project[candidateCategory] || []).find(item =>
          String(item.name || '').trim().toLowerCase() === String(metadata.entityName || '').trim().toLowerCase());
        return {
          id: saved.id,
          client_key: saved.client_key,
          entityId: saved.entity_id,
          type: saved.type,
          field: saved.field,
          operation: saved.operation,
          value: saved.value,
          evidence: saved.evidence,
          sourceText: metadata.sourceText || saved.evidence,
          sourceLine: Number(saved.source_line) || 1,
          confidence: Number(saved.confidence),
          status: saved.status,
          reviewed_at: saved.reviewed_at,
          candidateKey,
          entityName: metadata.entityName || entity && entity.name || null,
          entityKind: metadata.entityKind || entity && entity.kind || null,
          localEntityKey: candidateKey
            ? candidateEntity ? `${project.id}:${candidateCategory}:${candidateEntity._id}` : `candidate:${candidateKey}`
            : entity && entity.client_key || null,
          sourceDocumentKey: metadata.sourceDocumentKey || remoteDocumentClientKey,
          sourceLabel: metadata.sourceLabel || entry.sourceLabel || entry.name || 'Untitled entry',
        };
      }),
    };
  }

  async function persistSuggestionStatuses(project, entry, suggestions, status) {
    if (!isConfigured()) throw new Error('Supabase is not available for saving this review decision.');
    if (!['approved', 'rejected'].includes(status)) throw new Error('Unsupported Memory Review status.');
    if (!project || !project.id || !entry || !entry.category || !entry._id) {
      throw new Error('The source passage is no longer available. Reopen it and check memory again.');
    }
    const suggestionList = Array.isArray(suggestions) ? suggestions : [];
    const suggestionKeys = suggestionList.map(suggestion => suggestion && suggestion.client_key).filter(Boolean);
    if (!suggestionKeys.length || suggestionKeys.length !== suggestionList.length) {
      throw new Error('These suggestions have no saved review records. Check memory again while online.');
    }
    const expectedPrefix = `${project.id}:${entry.category}:${entry._id}:`;
    if (suggestionKeys.some(key => !key.startsWith(expectedPrefix))) {
      throw new Error('A suggestion does not belong to the current passage. Check memory again before reviewing.');
    }
    const context = captureAuthContext();
    const rows = await request(
      `ai_suggestions?client_key=in.${encodeURIComponent(`(${suggestionKeys.map(key => `"${key}"`).join(',')})`)}&select=id,client_key,status,reviewed_at`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status, reviewed_at: new Date().toISOString() }),
      },
      context,
    );
    if (!rows || rows.length !== suggestionKeys.length) {
      throw new Error('The review decision was not saved for every suggestion. Check that they still exist, then retry.');
    }
    return rows;
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MarginaliaV2 = {
    config,
    setAccessToken,
    setCloudReady,
    clearPendingSync,
    setStatusListener(listener) { statusListener = listener; },
    scheduleProjectSync,
    scheduleProjectsSync,
    syncProject,
    syncProjects,
    loadProjects,
    mergeProjectLists,
    analyzeScene,
    analyzeProjectEntry,
    persistSuggestionStatuses,
    documentPayload,
    entityPayload,
    buildSuggestionAuditPayload,
    stableSuggestionKey,
    dedupeSuggestions,
    summarizeSuggestionStatuses,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      documentPayload,
      entityPayload,
      buildSuggestionAuditPayload,
      stableSuggestionKey,
      dedupeSuggestions,
      summarizeSuggestionStatuses,
      remoteProjectToLocal,
      mergeProjectLists,
      loadProjects,
      syncProject,
      syncProjects,
      persistSuggestionStatuses,
      setCloudReady,
      clearPendingSync,
    };
  }
})();
