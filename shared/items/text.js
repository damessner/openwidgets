// Item type: text — a rich content block. It supports markdown-lite
// (**bold**, *italic*, "- " lists), inline images ![alt](/assets/...) and
// simple tables ("| a | b |" lines), plus inline answer gaps written as
// <<answer|alternative>>. A text block WITHOUT gaps is non-scoreable content;
// with at least one <<gap>> it becomes a scoreable fill-in-the-blank item
// (points are split evenly across the gaps).
import { eqScore, normalizeText } from '../util.js';
import { asArray, asBool, asString, makeResult, normalizeBaseItem, roundScore, sanitizeBaseItem, validateBaseItem } from './common.js';

export const type = 'text';

export const meta = {
  label: { en: 'Text block', de: 'Textblock' },
  scoreable: false, // becomes scoreable at runtime when the text has <<gaps>>
  category: 'content',
};

export const GAP_RE = /<<([^<>]*)>>/g;
export const MAX_GAPS = 50;

/**
 * Teacher read-aloud marker ("VORLESETEXT …") at the start of a text block.
 * Students never see the marker line: without audio the text shows normally,
 * with audio attached it becomes a collapsible "read along" hint.
 */
export const VORLESETEXT_RE = /^\s*VORLESETEXT[^\n]*(\n|$)/i;

/** Split off a leading VORLESETEXT marker line. Returns { marker, text }. */
export function splitVorlesetext(text) {
  const source = String(text ?? '');
  const match = source.match(VORLESETEXT_RE);
  if (!match) return { marker: '', text: source };
  return { marker: match[0], text: source.slice(match[0].length) };
}

/**
 * Dialogue speaker line: `Tom: "Hi Mia!"` — a name followed by a colon and a
 * QUOTED sentence. Unquoted `Word: text` (e.g. "Tickets: adults …") stays
 * narrator text. Continuation lines (still inside an open quote) are appended
 * to the previous segment.
 */
export const SPEAKER_LINE_RE = /^\s*([A-Za-z][A-Za-z .'’\-]{0,30}):\s*(".*)$/;

/**
 * Split a (VORLESETEXT) script into spoken segments:
 * [{ speaker: 'Tom' | '' (narrator), text }] with surrounding quotes removed.
 * Used by TTS so each speaker can get their own voice and the speaker name is
 * never read aloud.
 */
export function parseDialogue(text) {
  const { text: body } = splitVorlesetext(text);
  const segments = [];
  const quoteCount = (s) => (String(s).match(/"/g) || []).length;
  for (const rawLine of String(body).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(SPEAKER_LINE_RE);
    if (m) {
      const speaker = m[1].trim();
      const last = segments[segments.length - 1];
      if (last && last.speaker === speaker) last.text += ' ' + m[2];
      else segments.push({ speaker, text: m[2] });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && quoteCount(last.text) % 2 === 1) {
      // continuation of an open quote from the previous line
      last.text += ' ' + line;
    } else if (last && last.speaker === '') {
      last.text += ' ' + line;
    } else {
      segments.push({ speaker: '', text: line });
    }
  }
  return segments
    .map((s) => {
      let text = s.text.trim();
      if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
      return { speaker: s.speaker, text };
    })
    .filter((s) => s.text);
}

/** Parse <<answer|alt>> gaps in order. Returns [{ index, accepted, raw }]. */
export function parseGaps(text) {
  const gaps = [];
  const re = new RegExp(GAP_RE.source, 'g');
  let match;
  while ((match = re.exec(String(text ?? ''))) !== null) {
    const accepted = String(match[1])
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    gaps.push({ index: gaps.length + 1, raw: match[1], accepted });
  }
  return gaps;
}

/** Student-safe text: gap answers are masked, everything else is safe markup. */
export function maskGaps(text) {
  return String(text ?? '').replace(new RegExp(GAP_RE.source, 'g'), '<<>>');
}

export function defaultConfig() {
  return {
    text: '',
    caseSensitive: false,
    trim: true,
    collapseSpaces: true,
    ignorePunctuation: true,
  };
}

export function defaultPoints() {
  return 0;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  return {
    text: asString(src.text),
    caseSensitive: asBool(src.caseSensitive, false),
    trim: asBool(src.trim, true),
    collapseSpaces: asBool(src.collapseSpaces, true),
    ignorePunctuation: asBool(src.ignorePunctuation, true),
  };
}

export function normalizeItem(item) {
  const src = item && typeof item === 'object' ? item : {};
  return normalizeBaseItem(src, type, normalizeConfig(src.config), defaultPoints());
}

export function createItem({ id, points } = {}) {
  return normalizeItem({ id, type, points, config: defaultConfig() });
}

export function validateItem(item) {
  const errors = validateBaseItem(item);
  if (!item || typeof item !== 'object') return errors;
  const config = item.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return errors;
  if (typeof config.text !== 'string') errors.push('config.text: must be a string');
  else if (config.text.length > 20000) errors.push('config.text: must be at most 20000 characters');
  const gaps = parseGaps(config.text || '');
  if (gaps.length > MAX_GAPS) errors.push(`config.text: at most ${MAX_GAPS} <<gaps>> are allowed`);
  for (const gap of gaps) {
    if (gap.accepted.length === 0) errors.push(`config.text: gap #${gap.index} (<<>>) needs at least one accepted word, e.g. <<Haus>>`);
  }
  if (Number(item.points) > 0 && gaps.length === 0) {
    errors.push('points: a text block only carries points when it contains at least one <<gap>>');
  }
  for (const key of ['caseSensitive', 'trim', 'collapseSpaces', 'ignorePunctuation']) {
    if (typeof config[key] !== 'boolean') errors.push(`config.${key}: must be a boolean`);
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const normalized = normalizeItem(item);
  const gaps = parseGaps(normalized.config.text);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawGaps = source.gaps;
  if (rawGaps !== undefined && (typeof rawGaps !== 'object' || Array.isArray(rawGaps))) {
    throw new Error('text response needs { gaps: { g1: word, ... } }');
  }
  const given = rawGaps && typeof rawGaps === 'object' ? rawGaps : {};
  const out = {};
  for (const gap of gaps) {
    const value = given[`g${gap.index}`];
    if (typeof value === 'string') out[`g${gap.index}`] = value.slice(0, 500);
  }
  return { gaps: out };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const gaps = parseGaps(normalized.config.text);
  if (gaps.length === 0) return makeResult({ autoScore: 0, maxScore: 0, correct: false });
  const options = {
    caseSensitive: normalized.config.caseSensitive,
    trim: normalized.config.trim,
    collapseSpaces: normalized.config.collapseSpaces,
    ignorePunctuation: normalized.config.ignorePunctuation,
  };
  const maxScore = normalized.points;
  const given = response && response.gaps && typeof response.gaps === 'object' ? response.gaps : {};
  const hit = [];
  const miss = [];
  const detail = {};
  for (const gap of gaps) {
    const key = `g${gap.index}`;
    const raw = typeof given[key] === 'string' ? given[key] : '';
    const normalizedGiven = normalizeText(raw, options);
    const accepted = gap.accepted.map((value) => normalizeText(value, options)).filter((value) => value !== '');
    const ok = normalizedGiven !== '' && accepted.includes(normalizedGiven);
    if (ok) hit.push(key);
    else miss.push(key);
    detail[key] = { given: raw, correct: ok };
  }
  const total = gaps.length;
  const autoScore = total > 0 ? roundScore((maxScore * hit.length) / total) : 0;
  return makeResult({
    autoScore,
    maxScore,
    correct: total > 0 && hit.length === total && eqScore(autoScore, maxScore),
    needsManual: false,
    correctParts: hit.length,
    totalParts: total,
    detail: { hit, miss, gaps: detail },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: {
      // Mask gap answers: students see <<>> placeholders, never the key.
      text: maskGaps(normalized.config.text),
      caseSensitive: normalized.config.caseSensitive,
      trim: normalized.config.trim,
      collapseSpaces: normalized.config.collapseSpaces,
      ignorePunctuation: normalized.config.ignorePunctuation,
    },
  };
}

export function summarizeResponse(item, response) {
  const normalized = normalizeItem(item);
  const gaps = parseGaps(normalized.config.text);
  if (!gaps.length) return '';
  const given = response && response.gaps && typeof response.gaps === 'object' ? response.gaps : {};
  const filled = gaps.filter((gap) => typeof given[`g${gap.index}`] === 'string' && given[`g${gap.index}`].trim() !== '').length;
  return `${filled}/${gaps.length}`;
}

export function answerKey(item) {
  const normalized = normalizeItem(item);
  const gaps = parseGaps(normalized.config.text);
  const out = {};
  for (const gap of gaps) out[`g${gap.index}`] = gap.accepted[0] || '';
  return { gaps: out };
}

export function answerText(item) {
  const normalized = normalizeItem(item);
  return parseGaps(normalized.config.text).map((gap) => `Lücke ${gap.index}: ${gap.accepted.join(' / ') || '—'}`);
}

export function editSchema() {
  return [
    {
      key: 'text',
      kind: 'textarea',
      label: { en: 'Text', de: 'Text' },
      help: {
        en: 'Rich text: **bold**, *italic*, "- " lists, tables with | a | b | lines, images with ![alt](url) (paste with Ctrl+V), and gaps with <<answer|alternative>> — a text with at least one gap becomes a scoreable fill-in-the-blank.',
        de: 'Formatierter Text: **fett**, *kursiv*, "- "-Listen, Tabellen mit | a | b |-Zeilen, Bilder mit ![alt](url) (Einfügen mit Strg+V) und Lücken mit <<Antwort|Alternative>> — ein Text mit mindestens einer Lücke wird zur bewertbaren Lückentext-Aufgabe.',
      },
    },
  ];
}
