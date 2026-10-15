export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findSourceSentence(text, name) {
  if (!name) return text.trim();
  const sentenceMatch = text.match(new RegExp(`[^.!?]*\\b${escapeRegex(name)}\\b[^.!?]*[.!?]?`, 'i'));
  return sentenceMatch ? sentenceMatch[0].trim() : text.trim();
}

export function findSourceLine(text, sourceSentence) {
  const sourceIndex = text.indexOf(sourceSentence);
  return sourceIndex < 0 ? 1 : text.slice(0, sourceIndex).split(/\r?\n/).length;
}

function entityAliases(entity) {
  const data = entity && entity.data && typeof entity.data === 'object' ? entity.data : {};
  return [...new Set([entity && entity.nickname, data.nickname, ...(Array.isArray(entity && entity.aliases) ? entity.aliases : []), ...(Array.isArray(data.aliases) ? data.aliases : [])]
    .flatMap((alias) => Array.isArray(alias) ? alias : String(alias || '').split(/[;,]/))
    .map((alias) => String(alias || '').trim())
    .filter(Boolean))];
}

function findEntityMentionSentence(text, entity) {
  return [entity && entity.name, ...entityAliases(entity)].filter(Boolean).map((name) => {
    const sentence = findSourceSentence(text, name);
    return new RegExp(`\\b${escapeRegex(name)}\\b`, 'i').test(sentence) ? sentence : '';
  }).find(Boolean) || '';
}

function mentionsOtherNamedEntity(sentence, entityName, characterNames) {
  const name = String(entityName || '').trim();
  if (!name) return false;
  return (Array.isArray(characterNames) ? characterNames : []).some((candidate) => {
    const otherName = String(candidate || '').trim();
    if (!otherName || otherName.toLowerCase() === name.toLowerCase()) return false;
    return new RegExp(`\\b${escapeRegex(otherName)}\\b`, 'i').test(sentence);
  });
}

function sentenceMatchesEntity(entity, sentence, text, characterNames) {
  const name = String(entity && entity.name ? entity.name : '');
  if (!name) return false;
  const names = [name, ...entityAliases(entity)];
  if (names.some((candidate) => new RegExp(`\\b${escapeRegex(candidate)}\\b`, 'i').test(sentence))) return true;
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

  if (latestRecentName && !names.some((candidate) => candidate.toLowerCase() === latestRecentName.name.toLowerCase())) return false;
  return text.toLowerCase().indexOf(name.toLowerCase()) < sentenceStart;
}

function suggestionKey(suggestion) {
  const token = [
    suggestion && suggestion.candidateKey ? String(suggestion.candidateKey) : suggestion && suggestion.entityId ? String(suggestion.entityId) : 'anonymous',
    suggestion && suggestion.field ? String(suggestion.field) : '',
    suggestion && suggestion.value ? String(suggestion.value).trim() : '',
    suggestion && (suggestion.evidence || suggestion.sourceText) ? String(suggestion.evidence || suggestion.sourceText).trim() : '',
    suggestion && suggestion.sourceLine != null ? String(suggestion.sourceLine) : '1',
  ].join('|').toLowerCase();
  return token;
}

const candidateNamePattern = '[A-Z][a-z]+(?:\\s+(?:(?:of|the|and)\\s+)?[A-Z][a-z]+){0,3}';
const personActionWords = '(?:did|does|said|asked|replied|answered|called|told|walked|ran|turned|looked|stared|glared|smiled|laughed|groaned|resumed|entered|left|returned|came|went|stood|sat|took|carried|held|drew|raised|picked|wore|knelt|bowed|fought|arrived|followed|opened|closed|[a-z]+ed)';
const sentenceStarterNames = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'he', 'her', 'his', 'i', 'if', 'it', 'she', 'several', 'that', 'the', 'they', 'this', 'those', 'we', 'when', 'while', 'who', 'you']);

function normalizedEntityName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function titleCaseName(name) {
  return String(name || '').trim().split(/\s+/).map((word, index) => {
    if (index > 0 && /^(?:of|the|and)$/i.test(word)) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function findNewEntityCandidates(text, existingEntities) {
  const candidates = new Map();
  const existingNames = new Set((Array.isArray(existingEntities) ? existingEntities : [])
    .flatMap((entity) => [entity && entity.name, ...entityAliases(entity)])
    .map(normalizedEntityName)
    .filter(Boolean));
  const itemActions = 'picked up|pick up|carried|carry|held|hold|used|use|drew|draw|raised|lifted|grabbed|gripped|wore|wear|found|dropped|handed|tucked|packed|slung';
  const itemNouns = 'key|sword|ring|map|book|letter|knife|dagger|crown|amulet|necklace|bracelet|staff|wand|shield|locket|coin|scroll|potion|lantern|compass|weapon';
  const locationNouns = 'river|woods|forest|city|town|village|kingdom|country|fortress|castle|crossing|sea|ocean|valley|lake|island|road|mountain|harbor|harbour|temple|chapel|inn|tavern|village|palace|keep|cavern|cave';
  const locationPrepositions = 'at|in|to|from|near|through|across|into|within|outside|toward|towards|beyond|beside|past|under|over|beneath|around';

  function addCandidate(kind, rawName, sentence, loreType = null) {
    const name = String(rawName || '').trim().replace(/^(?:the|a|an)\s+/i, '');
    const normalizedName = normalizedEntityName(name);
    if (!normalizedName || existingNames.has(normalizedName)) return;
    const candidateKey = `${kind}:${normalizedName}`;
    if (candidates.has(candidateKey)) return;
    candidates.set(candidateKey, {
      kind,
      name: /^[A-Z]/.test(name) ? name : titleCaseName(name),
      candidateKey,
      loreType,
      evidence: sentence,
      sourceLine: findSourceLine(text, sentence),
      confidence: kind === 'character' ? 0.66 : 0.7,
    });
  }

  const sentences = String(text || '').match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    const namedItemPattern = new RegExp(`\\b(?:${itemActions})\\s+(?:(?:the|a|an)\\s+)?(${candidateNamePattern})`, 'g');
    for (const match of sentence.matchAll(namedItemPattern)) addCandidate('item', match[1], sentence);

    const genericItemPattern = new RegExp(`\\b(?:${itemActions})\\s+(?:the|a|an)\\s+((?:[a-z]+\\s+){0,2}(?:${itemNouns}))\\b`, 'gi');
    for (const match of sentence.matchAll(genericItemPattern)) addCandidate('item', match[1], sentence);

    const landmarkPattern = new RegExp(`\\b(?:${locationNouns})\\s+(?:of\\s+)?(?:the\\s+)?(${candidateNamePattern})`, 'g');
    for (const match of sentence.matchAll(landmarkPattern)) addCandidate('location', match[1], sentence);

    const namedLocationPattern = new RegExp(`\\b(?:${locationPrepositions})\\s+(?:the\\s+)?(${candidateNamePattern})`, 'g');
    for (const match of sentence.matchAll(namedLocationPattern)) addCandidate('location', match[1], sentence);

    const genericLocationPattern = new RegExp(`\\b(?:${locationPrepositions})\\s+(?:the\\s+)?((?:[a-z]+\\s+){0,2}(?:${locationNouns}))\\b`, 'gi');
    for (const match of sentence.matchAll(genericLocationPattern)) addCandidate('location', match[1], sentence);

    const titledPersonPattern = new RegExp(`\\b(?:Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?|Sir|Lady|Lord|Captain|Queen|King|Prince|Princess|Squire)\\s+(${candidateNamePattern})`, 'g');
    for (const match of sentence.matchAll(titledPersonPattern)) addCandidate('character', match[1], sentence);

    const factionTerms = 'Army|Armies|Order|Guild|Faction|Party|Republic|Empire|Legion|House|Council|Brotherhood|Tribe|Clan|Alliance|Federation|Covenant|Coalition';
    const factionPattern = new RegExp(`\\b(?:the\\s+)?((?:${candidateNamePattern}\\s+)?(?:${factionTerms})(?:\\s+of\\s+${candidateNamePattern})?)\\b`, 'g');
    for (const match of sentence.matchAll(factionPattern)) addCandidate('lore', match[1], sentence, 'faction');

    const lowercaseFactionPattern = /\b(?:[Tt]he\s+)?(armies|army|order|guild|faction|party|republic|empire|legion|house|council|brotherhood|tribe|clan|alliance|federation|covenant|coalition)\s+of\s+([A-Z][a-z]+(?:\s+(?:of|the|and)\s+[A-Z][a-z]+){0,2})\b/g;
    for (const match of sentence.matchAll(lowercaseFactionPattern)) addCandidate('lore', `${match[1]} of ${match[2]}`, sentence, 'faction');

    const systemPattern = /\bthe\s+((?:Force|Light Side|Dark Side|Old Religion|Deep Magic))\b/gi;
    for (const match of sentence.matchAll(systemPattern)) addCandidate('lore', match[1], sentence, 'system');

    const conceptTerms = 'Prophecy|Doctrine|Code|Faith|Religion|Ritual|Rite|Curse|Oath|Law|Pact|Treaty|Principle|Philosophy|Tradition|Theory|Practice|Method|Art';
    const conceptPattern = new RegExp(`\\b(?:the\\s+)?((?:${candidateNamePattern}\\s+)?(?:${conceptTerms})(?:\\s+of\\s+${candidateNamePattern})?)\\b`, 'g');
    for (const match of sentence.matchAll(conceptPattern)) addCandidate('lore', match[1], sentence, 'concept');

    const creaturePattern = new RegExp(`\\b(?:(?:a|an|the|several|many)\\s+)?((?:${candidateNamePattern}\\s+)?(?:Warg|Balrog|Beast|Dragon|Griffin|Wyvern|Basilisk|Chimera|Phoenix|Troll|Giant|Creature|Species))\\b`, 'g');
    for (const match of sentence.matchAll(creaturePattern)) addCandidate('lore', match[1], sentence, 'creature');

    const personSubjectMatch = sentence.match(new RegExp(`^\\s*(${candidateNamePattern})\\s+${personActionWords}\\b`, 'i'));
    if (personSubjectMatch && !sentenceStarterNames.has(personSubjectMatch[1].split(/\s+/)[0].toLowerCase())) {
      addCandidate('character', personSubjectMatch[1], sentence);
    }

    const namedPersonPattern = new RegExp(`\\b(?:met|told|asked|said to|replied to|warned|greeted|joined|followed)\\s+(${candidateNamePattern})`, 'g');
    for (const match of sentence.matchAll(namedPersonPattern)) addCandidate('character', match[1], sentence);
  }

  return [...candidates.values()].sort((left, right) => text.indexOf(left.evidence) - text.indexOf(right.evidence));
}

function makeSuggestion({ entityId, type, field, operation, value, evidence, sourceText, sourceLine, confidence }) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? `mock-${crypto.randomUUID()}` : `mock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function evaluateCharacterSuggestion(entity, text, allNames = []) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const results = [];

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

    if (/\b(?:glared|groaned|sighed|laughed|shouted|whispered|bowed|frowned|trembled|flinched|winced|nodded|pointed)\b/i.test(lower)) {
      results.push(makeSuggestion({
        entityId: entity.id,
        type: 'character_update',
        field: 'notes',
        operation: 'append',
        value: `Observed in the passage: ${sentence}`,
        evidence: sentence,
        sourceText: sentence,
        sourceLine: findSourceLine(text, sentence),
        confidence: 0.66,
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

function lowercaseHabit(value) {
  const sentence = value.trim().replace(/[.!?]+$/, '');
  if (/always/i.test(sentence)) return 'always returns to the same habit';
  if (/twirls/i.test(sentence)) return 'twirls something when anxious';
  if (/chews/i.test(sentence)) return 'chews on something when thinking';
  if (/hums/i.test(sentence)) return 'hums under their breath when thinking';
  if (/fidgets|nervous/i.test(sentence)) return 'fidgets when anxious';
  if (/taps|rubs/i.test(sentence)) return 'keeps a nervous habit of tapping or rubbing objects';
  return 'has a recurring behavioral habit';
}

function evaluateLocationSuggestion(entity, text) {
  const sourceText = findSourceSentence(text, entity.name);
  if (!sourceText) return null;
  const lower = sourceText.toLowerCase();
  if (!/(?:in|at|inside|outside|near|by|beside|beyond|through|under|across|along|past)/i.test(lower)) return null;
  return makeSuggestion({
    entityId: entity.id,
    type: 'location_update',
    field: 'description',
    operation: 'append',
    value: `${entity.name} is part of the setting described in this passage.`,
    evidence: sourceText,
    sourceText,
    sourceLine: findSourceLine(text, sourceText),
    confidence: 0.7,
  });
}

function evaluateItemSuggestion(entity, text) {
  const sourceText = findSourceSentence(text, entity.name);
  if (!sourceText) return null;
  const lower = sourceText.toLowerCase();
  if (!/(?:carried|held|used|dropped|picked up|kept in|gripped|wore|slung|packed|set down|tucked|brought|twirl(?:s|ed)?|fiddled with|played with)/i.test(lower)) return null;
  return makeSuggestion({
    entityId: entity.id,
    type: 'item_update',
    field: 'notes',
    operation: 'append',
    value: `Mentioned in the passage: ${sourceText}`,
    evidence: sourceText,
    sourceText,
    sourceLine: findSourceLine(text, sourceText),
    confidence: 0.68,
  });
}

function evaluateLoreSuggestion(entity, text) {
  const sourceText = findEntityMentionSentence(text, entity);
  if (!sourceText) return null;
  return makeSuggestion({
    entityId: entity.id,
    type: 'lore_update',
    field: 'overview',
    operation: 'append',
    value: `From the passage: ${sourceText}`,
    evidence: sourceText,
    sourceText,
    sourceLine: findSourceLine(text, sourceText),
    confidence: 0.68,
  });
}

export function buildMockSuggestions(text, entities) {
  const safeEntities = Array.isArray(entities) ? entities : [];
  const candidates = findNewEntityCandidates(text, safeEntities);
  const characterEntities = safeEntities
    .filter((entity) => entity && entity.kind === 'character' && entity.name)
  const characterNames = characterEntities.flatMap((entity) => [String(entity.name), ...entityAliases(entity)]).filter(Boolean);
  const candidateCharacters = candidates.filter((candidate) => candidate.kind === 'character');
  const allCharacterNames = characterNames.concat(candidateCharacters.map((candidate) => candidate.name));
  const existingSuggestions = [];

  for (const entity of safeEntities) {
    if (!entity || !entity.name || !entity.id) continue;
    const sourceText = findEntityMentionSentence(text, entity);
    if (!sourceText || !sourceText.trim()) continue;

    if (entity.kind === 'character') {
      existingSuggestions.push(...evaluateCharacterSuggestion(entity, text, allCharacterNames));
      continue;
    }

    if (entity.kind === 'location') {
      const suggestion = evaluateLocationSuggestion(entity, text);
      if (suggestion) existingSuggestions.push(suggestion);
      continue;
    }

    if (entity.kind === 'item') {
      const suggestion = evaluateItemSuggestion(entity, text);
      if (suggestion) existingSuggestions.push(suggestion);
      continue;
    }

    if (entity.kind === 'lore') {
      const suggestion = evaluateLoreSuggestion(entity, text);
      if (suggestion) existingSuggestions.push(suggestion);
    }
  }

  const createSuggestions = candidates.map((candidate) => ({
    ...makeSuggestion({
      entityId: null,
      type: 'entity_create',
      field: 'name',
      operation: 'append',
      value: candidate.name,
      evidence: candidate.evidence,
      sourceText: candidate.evidence,
      sourceLine: candidate.sourceLine,
      confidence: candidate.confidence,
    }),
    entityKind: candidate.kind,
    entityName: candidate.name,
    loreType: candidate.loreType,
    candidateKey: candidate.candidateKey,
  }));

  const candidateDetails = [];
  for (const candidate of candidates) {
    const candidateEntity = { id: `candidate:${candidate.candidateKey}`, kind: candidate.kind, name: candidate.name, loreType: candidate.loreType };
    let details = [];
    if (candidate.kind === 'character') {
      details = evaluateCharacterSuggestion(candidateEntity, text, allCharacterNames);
    } else if (candidate.kind === 'location') {
      const detail = evaluateLocationSuggestion(candidateEntity, text);
      if (detail) details.push(detail);
    } else if (candidate.kind === 'item') {
      const detail = evaluateItemSuggestion(candidateEntity, text);
      if (detail) details.push(detail);
    } else if (candidate.kind === 'lore') {
      const detail = evaluateLoreSuggestion(candidateEntity, text);
      if (detail) details.push(detail);
    }
    candidateDetails.push(...details.map((suggestion) => ({
      ...suggestion,
      entityId: null,
      entityKind: candidate.kind,
      entityName: candidate.name,
      candidateKey: candidate.candidateKey,
    })));
  }

  const seen = new Set();
  return [...createSuggestions, ...existingSuggestions, ...candidateDetails].filter((suggestion) => {
    const key = suggestionKey(suggestion);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
