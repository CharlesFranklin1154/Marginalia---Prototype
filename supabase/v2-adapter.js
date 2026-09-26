(function () {
  'use strict';

  const config = {
    enabled: true,
    supabaseUrl: '',
    anonKey: '',
    accessToken: '',
  };

  let syncTimer = null;
  let pendingProject = null;
  let statusListener = null;

  function reportStatus(state, message) {
    if (statusListener) statusListener(state, message);
  }

  function isConfigured() {
    return config.enabled && config.supabaseUrl && config.anonKey && config.accessToken;
  }

  function setAccessToken(accessToken) {
    config.accessToken = accessToken || '';
  }

  function headers() {
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    };
  }

  async function request(path, options) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: { ...headers(), ...(options && options.headers) },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`V2 request failed: ${response.status} ${detail.slice(0, 300)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  function projectPayload(project) {
    return {
      client_key: project.id,
      title: project.title || 'Untitled book',
      theme: project.theme || 'rainy',
      cover_url: project.cover || null,
      brain_dump: project.brainDump || '',
      updated_at: new Date(project.updated || Date.now()).toISOString(),
    };
  }

  function entityPayload(project, bookId, kind, entry) {
    return {
      client_key: `${project.id}:${kind}:${entry._id}`,
      book_id: bookId,
      kind: kind === 'characters' ? 'character' : kind === 'locations' ? 'location' : 'item',
      name: entry.name || 'Untitled',
      data: entry,
      updated_at: new Date().toISOString(),
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
    const contentHtml = entry.details || '';
    const contentText = htmlToPlainText(contentHtml);
    return {
      client_key: `${project.id}:${kind}:${entry._id}`,
      book_id: bookId,
      kind: kind === 'chapters' ? 'chapter' : kind === 'scenes' ? 'scene' : 'brain_dump',
      title: entry.name || 'Untitled',
      content_html: contentHtml,
      content_text: contentText,
      updated_at: new Date().toISOString(),
    };
  }

  function buildSuggestionAuditPayload({ bookId, documentId, entityId, suggestion }) {
    return {
      book_id: bookId,
      document_id: documentId || null,
      entity_id: entityId || null,
      type: suggestion && suggestion.type ? suggestion.type : 'memory_update',
      field: suggestion && suggestion.field ? suggestion.field : '',
      operation: suggestion && suggestion.operation ? suggestion.operation : 'append',
      value: suggestion && suggestion.value ? String(suggestion.value) : '',
      evidence: suggestion && (suggestion.evidence || suggestion.sourceText) ? String(suggestion.evidence || suggestion.sourceText) : '',
      source_line: Number(suggestion && suggestion.sourceLine ? suggestion.sourceLine : 1),
      confidence: Number(suggestion && suggestion.confidence != null ? suggestion.confidence : 0.5),
      status: suggestion && suggestion.status ? suggestion.status : 'pending',
    };
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

  async function deleteProjectEntity(project, kind, entryId) {
    if (!isConfigured() || !project || !entryId) return;
    const books = await request(`books?client_key=eq.${encodeURIComponent(project.id)}&select=id`);
    const bookId = books && books[0] && books[0].id;
    if (!bookId) return;
    const entityKind = kind === 'characters' ? 'character' : kind === 'locations' ? 'location' : 'item';
    const clientKey = `${project.id}:${kind}:${entryId}`;
    try {
      await request(`entities?book_id=eq.${encodeURIComponent(bookId)}&kind=eq.${encodeURIComponent(entityKind)}&client_key=eq.${encodeURIComponent(clientKey)}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Marginalia V2 entity delete deferred:', error);
    }
  }

  async function deleteProjectBook(projectId) {
    if (!isConfigured() || !projectId) return;
    const books = await request(`books?client_key=eq.${encodeURIComponent(projectId)}&select=id`);
    const bookId = books && books[0] && books[0].id;
    if (!bookId) return;
    try {
      await request(`ai_suggestions?book_id=eq.${encodeURIComponent(bookId)}`, { method: 'DELETE' });
      await request(`documents?book_id=eq.${encodeURIComponent(bookId)}`, { method: 'DELETE' });
      await request(`entities?book_id=eq.${encodeURIComponent(bookId)}`, { method: 'DELETE' });
      await request(`books?id=eq.${encodeURIComponent(bookId)}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Marginalia V2 project delete deferred:', error);
    }
  }

  async function syncProject(project) {
    if (!isConfigured() || !project) return;
    reportStatus('syncing', 'Syncing with Supabase...');
    const books = await request('books?on_conflict=client_key&select=id,client_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ ...projectPayload(project), user_id: undefined }),
    });
    const bookId = books && books[0] && books[0].id;
    if (!bookId) throw new Error('V2 book sync did not return an id.');
    for (const kind of ['characters', 'locations', 'items']) {
      const entities = (project[kind] || []).map(entry => entityPayload(project, bookId, kind, entry));
      if (entities.length) {
        try {
          await request('entities?on_conflict=client_key', { method: 'POST', body: JSON.stringify(entities) });
        } catch (error) {
          console.warn(`Marginalia V2 ${kind} sync deferred:`, error);
        }
      }
    }
    for (const kind of ['chapters', 'scenes', 'brainDumps']) {
      const documents = (project[kind] || []).map(entry => documentPayload(project, bookId, kind, entry));
      if (documents.length) {
        try {
          await request('documents?on_conflict=client_key', { method: 'POST', body: JSON.stringify(documents) });
        } catch (error) {
          console.warn(`Marginalia V2 ${kind} sync deferred:`, error);
        }
      }
    }
    reportStatus('synced', 'Saved locally and synced to Supabase');
  }

  function scheduleProjectSync(project) {
    if (!isConfigured()) return;
    pendingProject = project;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const nextProject = pendingProject;
      pendingProject = null;
      try {
        await syncProject(nextProject);
      } catch (error) {
        console.warn('Marginalia V2 sync deferred:', error);
        reportStatus('error', 'Saved locally; Supabase sync needs attention');
      }
    }, 500);
  }

  async function analyzeScene(payload) {
    if (!isConfigured()) throw new Error('Marginalia V2 backend is not configured.');
    if (window.marginaliaSupabaseClient) {
      const { data, error } = await window.marginaliaSupabaseClient.functions.invoke('analyze-scene', { body: payload });
      if (error) throw new Error(error.message || 'The analyze-scene function failed.');
      return data;
    }
    const response = await fetch(`${config.supabaseUrl}/functions/v1/analyze-scene`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Scene analysis failed: ${response.status}`);
    return response.json();
  }

  async function analyzeProjectEntry(project, entry) {
    if (!isConfigured()) throw new Error('Marginalia V2 backend is not configured.');
    await syncProject(project);
    const books = await request(`books?client_key=eq.${encodeURIComponent(project.id)}&select=id`);
    const bookId = books && books[0] && books[0].id;
    if (!bookId) throw new Error('This book has not synced to Supabase yet.');
    const entities = await request(`entities?book_id=eq.${encodeURIComponent(bookId)}&select=id,client_key,kind,name`);
    const entityById = new Map(entities.map(entity => [entity.id, entity]));
    const remoteDocumentClientKey = entry && entry.category && entry._id ? `${project.id}:${entry.category}:${entry._id}` : null;
    const documentMatch = remoteDocumentClientKey
      ? await request(`documents?book_id=eq.${encodeURIComponent(bookId)}&client_key=eq.${encodeURIComponent(remoteDocumentClientKey)}&select=id,client_key`)
      : [];
    const documentId = documentMatch && documentMatch[0] ? documentMatch[0].id : null;
    const result = await analyzeScene({
      bookId,
      text: htmlToPlainText(entry.details),
      entities: entities.map(entity => ({ id: entity.id, kind: entity.kind, name: entity.name })),
    });
    result.suggestions = dedupeSuggestions((result.suggestions || []).map(suggestion => ({
      ...suggestion,
      localEntityKey: entityById.get(suggestion.entityId)?.client_key || null,
      sourceDocumentKey: remoteDocumentClientKey,
      sourceLabel: entry.sourceLabel || entry.name || 'Untitled entry',
    })));
    const suggestionsForAudit = result.suggestions.map(suggestion => buildSuggestionAuditPayload({
      bookId,
      documentId,
      entityId: suggestion.entityId || null,
      suggestion,
    }));
    if (suggestionsForAudit.length) {
      try {
        await request('ai_suggestions', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(suggestionsForAudit),
        });
      } catch (error) {
        console.warn('Marginalia V2 suggestion audit deferred:', error);
      }
    }
    return result;
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MarginaliaV2 = {
    config,
    setAccessToken,
    setStatusListener(listener) { statusListener = listener; },
    scheduleProjectSync,
    syncProject,
    analyzeScene,
    analyzeProjectEntry,
    buildSuggestionAuditPayload,
    dedupeSuggestions,
    summarizeSuggestionStatuses,
    deleteProjectEntity,
    deleteProjectBook,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSuggestionAuditPayload, dedupeSuggestions, summarizeSuggestionStatuses, deleteProjectEntity, deleteProjectBook };
  }
})();
