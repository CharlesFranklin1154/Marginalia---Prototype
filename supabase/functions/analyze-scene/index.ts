import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

type Entity = { id: string; kind: 'character' | 'location' | 'item'; name: string };

type AnalyzeRequest = {
  bookId: string;
  documentId?: string;
  text: string;
  entities?: Entity[];
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMockSuggestions(text: string, entities: Entity[]) {
  const suggestions = [];
  const scarEvidence = /\b(?:scar|scarring)\b/i.test(text);

  for (const entity of entities) {
    if (!scarEvidence || entity.kind !== 'character') continue;
    const mentioned = new RegExp(`\\b${escapeRegex(entity.name)}\\b`, 'i').test(text);
    if (!mentioned) continue;
    suggestions.push({
      id: `mock-${crypto.randomUUID()}`,
      type: 'character_update',
      entityId: entity.id,
      field: 'physical',
      operation: 'append',
      value: 'A scar is mentioned in this passage.',
      evidence: text.slice(0, 500),
      confidence: 0.91,
      status: 'pending',
    });
  }

  return suggestions;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'POST required' }, 405);

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return response({ error: 'Missing access token' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return response({ error: 'Invalid access token' }, 401);

  let payload: AnalyzeRequest;
  try { payload = await request.json(); } catch { return response({ error: 'Invalid JSON' }, 400); }
  if (!payload.bookId || typeof payload.text !== 'string') {
    return response({ error: 'bookId and text are required' }, 400);
  }

  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id')
    .eq('id', payload.bookId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (bookError || !book) return response({ error: 'Book not found' }, 404);

  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  return response({
    suggestions: buildMockSuggestions(payload.text, entities),
    analysis: { mode: 'mock', entitiesChecked: entities.length },
  });
});
