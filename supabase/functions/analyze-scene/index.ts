import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

type Suggestion = {
  id: string;
  type: string;
  entityId: string;
  field: string;
  operation: 'append' | 'replace' | 'remove';
  value: string;
  evidence: string;
  sourceText: string;
  sourceLine: number;
  confidence: number;
  status: 'pending';
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSourceSentence(text: string, name: string) {
  if (!name) return text.trim();
  const sentenceMatch = text.match(new RegExp(`[^.!?]*\\b${escapeRegex(name)}\\b[^.!?]*[.!?]?`, 'i'));
  return sentenceMatch ? sentenceMatch[0].trim() : text.trim();
}

function findSourceLine(text: string, sourceSentence: string) {
  const sourceIndex = text.indexOf(sourceSentence);
  return sourceIndex < 0 ? 1 : text.slice(0, sourceIndex).split(/\r?\n/).length;
}

function mentionsOtherNamedEntity(sentence: string, entityName: string, characterNames: string[]) {
  const name = String(entityName || '').trim();
  if (!name) return false;
  return (Array.isArray(characterNames) ? characterNames : []).some((candidate) => {
    const otherName = String(candidate || '').trim();
    if (!otherName || otherName.toLowerCase() === name.toLowerCase()) return false;
    return new RegExp(`\\b${escapeRegex(otherName)}\\b`, 'i').test(sentence);
  });
}

function sentenceMatchesEntity(entity: Entity, sentence: string, text: string, characterNames: string[]) {
  const name = String(entity && entity.name ? entity.name : '');
  if (!name) return false;
  if (new RegExp(`\\b${escapeRegex(name)}\\b`, 'i').test(sentence)) return true;
  if (mentionsOtherNamedEntity(sentence, name, characterNames)) return false;
  if (!/\b(?:she|he|they|her|him|their|his|hers)\b/i.test(sentence)) return false;

  const sentenceStart = text.indexOf(sentence);
  const latestRecentName = characterNames
    .map((candidate) => ({
      name: candidate,
      index: text.toLowerCase().lastIndexOf(String(candidate || '').toLowerCase(), sentenceStart),
    }))
    .filter((entry) => entry.index >= 0 && entry.index < sentenceStart)
    .sort((a, b) => b.index - a.index)[0];

  if (latestRecentName && latestRecentName.name.toLowerCase() !== name.toLowerCase()) return false;
  return text.toLowerCase().indexOf(name.toLowerCase()) < sentenceStart;
}

function suggestionKey(suggestion: Suggestion) {
  const token = [
    suggestion && suggestion.entityId ? String(suggestion.entityId) : 'anonymous',
    suggestion && suggestion.field ? String(suggestion.field) : '',
    suggestion && suggestion.value ? String(suggestion.value).trim() : '',
    suggestion && (suggestion.evidence || suggestion.sourceText) ? String(suggestion.evidence || suggestion.sourceText).trim() : '',
    suggestion && suggestion.sourceLine != null ? String(suggestion.sourceLine) : '1',
  ].join('|').toLowerCase();
  return token;
}

function lowercaseHabit(value: string) {
  const sentence = value.trim().replace(/[.!?]+$/, '');
  if (/always/i.test(sentence)) return 'always returns to the same habit';
  if (/twirls/i.test(sentence)) return 'twirls something when anxious';
  if (/chews/i.test(sentence)) return 'chews on something when thinking';
  if (/hums/i.test(sentence)) return 'hums under their breath when thinking';
  if (/fidgets|nervous/i.test(sentence)) return 'fidgets when anxious';
  if (/taps|rubs/i.test(sentence)) return 'keeps a nervous habit of tapping or rubbing objects';
  return 'has a recurring behavioral habit';
}

function makeSuggestion({ entityId, type, field, operation, value, evidence, sourceText, sourceLine, confidence }: {
  entityId: string;
  type: string;
  field: string;
  operation: 'append' | 'replace' | 'remove';
  value: string;
  evidence: string;
  sourceText: string;
  sourceLine: number;
  confidence: number;
}): Suggestion {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? `mock-${crypto.randomUUID()}` : `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    type,
    entityId,
    field,
    operation,
    value,
    evidence,
    sourceText,
    sourceLine,
    confidence,
    status: 'pending',
  };
}

function evaluateCharacterSuggestion(entity: Entity, text: string, allNames: string[] = []): Suggestion[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const results: Suggestion[] = [];

  for (const sentence of sentences) {
    if (!sentenceMatchesEntity(entity, sentence, text, allNames)) continue;
    const lower = sentence.toLowerCase();

    if (/\bscar(?:ring)?\b/i.test(lower)) {
      const scarMatch = sentence.match(/\bscar(?:ring)?\b([^.!?]*)/i);
      const detail = scarMatch ? ('a scar' + scarMatch[1]).trim().replace(/[.!?]+$/, '') : 'a scar';
      results.push(makeSuggestion({
        entityId: entity.id,
        type: 'character_update',
        field: 'physical',
        operation: 'append',
        value: `${entity.name} has ${detail}.`,
        evidence: sentence,
        sourceText: sentence,
        sourceLine: findSourceLine(text, sentence),
        confidence: 0.91,
      }));
    }

    if (/\b(?:wear(?:s|ing)?|dressed in|clad in|wrapped in|wore|coat|cloak|dress|boots|gloves|hat|scarf|sash|jacket|cape)\b/i.test(lower)) {
      const clothingMatch = sentence.match(/(?:wear(?:s|ing)?|dressed in|clad in|wrapped in|wore)\s+(?:a|an|the)?\s*([^.!?]+)/i);
      const clothing = clothingMatch ? clothingMatch[1].trim().replace(/[.!?]+$/, '') : 'distinctive clothing';
      results.push(makeSuggestion({
        entityId: entity.id,
        type: 'character_update',
        field: 'physical',
        operation: 'append',
        value: `${entity.name} is described in clothing that includes ${clothing}.`,
        evidence: sentence,
        sourceText: sentence,
        sourceLine: findSourceLine(text, sentence),
        confidence: 0.8,
      }));
    }

    if (/\b(?:always|often|habitually|tends to|keeps|fidgets|twirls|chews|hums|stares|nervously|nervous|rubs|licks|taps)\b/i.test(lower)) {
      const habit = lowercaseHabit(sentence);
      results.push(makeSuggestion({
        entityId: entity.id,
        type: 'character_update',
        field: 'habits',
        operation: 'append',
        value: `${entity.name} ${habit}.`,
        evidence: sentence,
        sourceText: sentence,
        sourceLine: findSourceLine(text, sentence),
        confidence: 0.75,
      }));
    }

    if (/\b(?:friend|sister|brother|mother|father|mentor|rival|enemy|ally|lover|wife|husband|daughter|son|guardian|captain|queen|king|lord|lady|apprentice)\b/i.test(lower)) {
      const relation = sentence.match(/\b(?:friend|sister|brother|mother|father|mentor|rival|enemy|ally|lover|wife|husband|daughter|son|guardian|captain|queen|king|lord|lady|apprentice)\b/i)?.[0] ?? 'relative';
      results.push(makeSuggestion({
        entityId: entity.id,
        type: 'character_update',
        field: 'relationships',
        operation: 'append',
        value: `${entity.name} is referenced in relation to a ${relation}.`,
        evidence: sentence,
        sourceText: sentence,
        sourceLine: findSourceLine(text, sentence),
        confidence: 0.72,
      }));
    }
  }

  return results;
}

function evaluateLocationSuggestion(entity: Entity, text: string): Suggestion | null {
  const sentence = findSourceSentence(text, entity.name);
  if (!sentence) return null;
  const lower = sentence.toLowerCase();
  if (!/(?:in|at|inside|outside|near|by|beside|beyond|through|under|across|along|past)/i.test(lower)) return null;
  return makeSuggestion({
    entityId: entity.id,
    type: 'location_update',
    field: 'description',
    operation: 'append',
    value: `${entity.name} is part of the setting described in this passage.`,
    evidence: sentence,
    sourceText: sentence,
    sourceLine: findSourceLine(text, sentence),
    confidence: 0.7,
  });
}

function evaluateItemSuggestion(entity: Entity, text: string): Suggestion | null {
  const sentence = findSourceSentence(text, entity.name);
  if (!sentence) return null;
  const lower = sentence.toLowerCase();
  if (!/(?:carried|held|used|dropped|picked up|kept in|gripped|wore|slung|packed|set down|tucked|brought|twirl(?:s|ed)?|fiddled with|played with)/i.test(lower)) return null;
  return makeSuggestion({
    entityId: entity.id,
    type: 'item_update',
    field: 'details',
    operation: 'append',
    value: `${entity.name} is actively relevant to the immediate scene and may matter later.`,
    evidence: sentence,
    sourceText: sentence,
    sourceLine: findSourceLine(text, sentence),
    confidence: 0.68,
  });
}

function buildMockSuggestions(text: string, entities: Entity[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const safeEntities = Array.isArray(entities) ? entities : [];
  const characterNames = safeEntities
    .filter((entity) => entity && entity.kind === 'character' && entity.name)
    .map((entity) => String(entity.name))
    .filter(Boolean);

  for (const entity of safeEntities) {
    if (!entity || !entity.name || !entity.id) continue;
    const sourceText = findSourceSentence(text, entity.name);
    if (!sourceText || !sourceText.trim()) continue;

    if (entity.kind === 'character') {
      suggestions.push(...evaluateCharacterSuggestion(entity, text, characterNames));
      continue;
    }

    if (entity.kind === 'location') {
      const suggestion = evaluateLocationSuggestion(entity, text);
      if (suggestion) suggestions.push(suggestion);
      continue;
    }

    if (entity.kind === 'item') {
      const suggestion = evaluateItemSuggestion(entity, text);
      if (suggestion) suggestions.push(suggestion);
    }
  }

  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestionKey(suggestion);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
