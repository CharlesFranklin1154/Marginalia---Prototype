import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildGeminiRequest,
  extractGeminiText,
  normalizeGeminiSuggestions,
} from './gemini-helpers.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

type Entity = {
  id: string;
  kind: 'character' | 'location' | 'item' | 'lore';
  name: string;
  data?: Record<string, unknown>;
};

type AnalyzeRequest = {
  bookId: string;
  text: string;
  entities?: Entity[];
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'POST required' }, 405);

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return response({ error: 'Missing access token' }, 401);

  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  const allowedEmail = Deno.env.get('GEMINI_ALLOWED_EMAIL')?.trim().toLowerCase();
  if (!geminiApiKey || !allowedEmail) {
    return response({ error: 'Gemini is not configured. Ask the Marginalia administrator to finish setup.' }, 503);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return response({ error: 'Invalid access token' }, 401);
  if (!user.email || user.email.trim().toLowerCase() !== allowedEmail) {
    return response({ error: 'Gemini Memory Review is enabled only for its configured account.' }, 403);
  }

  let payload: AnalyzeRequest;
  try {
    payload = await request.json();
  } catch {
    return response({ error: 'Invalid JSON' }, 400);
  }
  if (!payload || typeof payload !== 'object' || typeof payload.bookId !== 'string' || typeof payload.text !== 'string') {
    return response({ error: 'bookId and text are required' }, 400);
  }
  if (!payload.bookId.trim()) return response({ error: 'bookId and text are required' }, 400);
  if (!payload.text.trim()) return response({ error: 'This passage is empty. Add some writing and try again.' }, 400);
  if (payload.text.length > 60000) {
    return response({ error: 'This passage is too long for one review. Split it into shorter chapters or scenes and try again.' }, 413);
  }

  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id')
    .eq('id', payload.bookId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (bookError || !book) return response({ error: 'Book not found' }, 404);

  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  if (entities.length > 200 || entities.some(entity =>
    !entity || typeof entity.id !== 'string' || typeof entity.name !== 'string'
    || !['character', 'location', 'item', 'lore'].includes(entity.kind)
  )) {
    return response({ error: 'The story-card context is invalid. Reload the book and try again.' }, 400);
  }

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify(buildGeminiRequest(payload.text, entities)),
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    console.error('Gemini request failed:', error);
    return response({ error: 'Gemini could not be reached. Check the connection and try again.' }, 502);
  }

  const responseText = await geminiResponse.text();
  if (!geminiResponse.ok) {
    const quotaError = geminiResponse.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(responseText);
    if (quotaError) {
      return response({ error: 'Gemini’s free-tier limit or rate limit has been reached. Check the project’s limits in Google AI Studio and try again later.' }, 429);
    }
    console.error(`Gemini API returned HTTP ${geminiResponse.status}.`);
    if (geminiResponse.status === 400 || geminiResponse.status === 403) {
      return response({ error: 'Gemini rejected the request. Check that the API key is valid and the Gemini API is enabled for its Google project.' }, 502);
    }
    return response({ error: 'Gemini could not complete this review. Try again later.' }, 502);
  }

  let result: { suggestions?: unknown };
  try {
    result = JSON.parse(extractGeminiText(JSON.parse(responseText)));
  } catch (error) {
    console.error('Gemini returned an invalid structured response:', error);
    return response({ error: 'Gemini returned an unreadable review. Nothing was saved; try again.' }, 502);
  }

  let suggestions;
  try {
    suggestions = normalizeGeminiSuggestions(result.suggestions, payload.text, entities);
  } catch (error) {
    console.error('Gemini suggestions failed validation:', error);
    return response({ error: 'Gemini returned suggestions that could not be validated. Nothing was saved; try again.' }, 502);
  }

  return response({
    suggestions,
    analysis: {
      mode: 'gemini',
      entitiesChecked: entities.length,
      newEntitiesFound: suggestions.filter(suggestion => suggestion.type === 'entity_create').length,
    },
  });
});
