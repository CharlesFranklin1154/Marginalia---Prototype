(function () {
  'use strict';

  const config = {
    enabled: false,
    supabaseUrl: '',
    anonKey: '',
    accessToken: '',
  };

  let syncTimer = null;
  let pendingProject = null;

  function isConfigured() {
    return config.enabled && config.supabaseUrl && config.anonKey && config.accessToken;
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
    if (!response.ok) throw new Error(`V2 request failed: ${response.status}`);
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

  function documentPayload(project, bookId, kind, entry) {
    const contentHtml = entry.details || '';
    const contentText = contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      client_key: `${project.id}:${kind}:${entry._id}`,
      book_id: bookId,
      kind: kind === 'chapters' ? 'chapter' : 'scene',
      title: entry.name || 'Untitled',
      content_html: contentHtml,
      content_text: contentText,
      updated_at: new Date().toISOString(),
    };
  }

  async function syncProject(project) {
    if (!isConfigured() || !project) return;
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
        await request('entities?on_conflict=client_key', { method: 'POST', body: JSON.stringify(entities) });
      }
    }
    for (const kind of ['chapters', 'scenes']) {
      const documents = (project[kind] || []).map(entry => documentPayload(project, bookId, kind, entry));
      if (documents.length) {
        await request('documents?on_conflict=client_key', { method: 'POST', body: JSON.stringify(documents) });
      }
    }
  }

  function scheduleProjectSync(project) {
    if (!isConfigured()) return;
    pendingProject = project;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const nextProject = pendingProject;
      pendingProject = null;
      try { await syncProject(nextProject); } catch (error) { console.warn('Marginalia V2 sync deferred:', error); }
    }, 500);
  }

  async function analyzeScene(payload) {
    if (!isConfigured()) throw new Error('Marginalia V2 backend is not configured.');
    const response = await fetch(`${config.supabaseUrl}/functions/v1/analyze-scene`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Scene analysis failed: ${response.status}`);
    return response.json();
  }

  window.MarginaliaV2 = { config, scheduleProjectSync, syncProject, analyzeScene };
})();
