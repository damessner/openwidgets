// Item type: audio_answer — the student records an oral answer with the
// microphone (MediaRecorder in the student renderer) and the recording is
// uploaded as an asset (POST /api/participant/assets). The response references
// the asset id. Scoring is always manual (needsManual) — like long_answer, a
// teacher listens and decides; the teacher grading view mounts this renderer
// in review mode and shows an audio player.
import {
  asFiniteNumber,
  asString,
  makeResult,
  normalizeBaseItem,
  sanitizeBaseItem,
  validateBaseItem,
} from './common.js';

export const type = 'audio_answer';
export const meta = {
  label: { en: 'Audio answer (record)', de: 'Audio-Antwort (Aufnahme)' },
  scoreable: true,
  category: 'assessment',
};

export const ALLOWED_RESPONSE_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

export function defaultConfig() {
  return { maxDurationSec: 120 };
}

export function defaultPoints() {
  return 3;
}

function normalizeConfig(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  let maxDurationSec = Math.round(asFiniteNumber(src.maxDurationSec, 120));
  if (!Number.isFinite(maxDurationSec) || maxDurationSec <= 0) maxDurationSec = 120;
  maxDurationSec = Math.min(3600, Math.max(5, maxDurationSec));
  return { maxDurationSec };
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
  if (!Number.isInteger(config.maxDurationSec) || config.maxDurationSec < 5 || config.maxDurationSec > 3600) {
    errors.push('config.maxDurationSec: must be an integer between 5 and 3600');
  }
  return errors;
}

export function normalizeResponse(item, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const assetId = asString(source.assetId).trim();
  if (source.assetId !== undefined && !assetId) throw new Error('audio_answer response needs { assetId: string }');
  const durationMs = asFiniteNumber(source.durationMs, 0);
  const mime = asString(source.mime).slice(0, 60);
  return {
    assetId: assetId.slice(0, 64),
    durationMs: durationMs >= 0 ? Math.round(durationMs) : 0,
    mime: ALLOWED_RESPONSE_MIME.includes(mime) ? mime : '',
  };
}

export function score(item, response) {
  const normalized = normalizeItem(item);
  const hasAudio = !!(response && response.assetId);
  return makeResult({
    autoScore: 0,
    maxScore: normalized.points,
    correct: false,
    // audio answers are always graded by ear — a teacher decides
    needsManual: true,
    correctParts: 0,
    totalParts: 1,
    detail: { hasAudio, durationMs: Math.round(Number(response && response.durationMs) || 0) },
  });
}

export function sanitizeItem(item) {
  const normalized = normalizeItem(item);
  return {
    ...sanitizeBaseItem(normalized),
    config: { maxDurationSec: normalized.config.maxDurationSec },
  };
}

export function summarizeResponse(item, response) {
  const durationMs = Math.round(Number(response && response.durationMs) || 0);
  const seconds = Math.round(durationMs / 1000);
  return response && response.assetId ? `🎙 ${seconds}s` : '–';
}

export function answerKey() {
  return null; // no automatic key — listen and grade
}

export function answerText() {
  return [];
}

export function editSchema() {
  return [
    {
      key: 'maxDurationSec',
      kind: 'number',
      label: { en: 'Max. recording length (seconds)', de: 'Max. Aufnahmelänge (Sekunden)' },
      help: {
        en: 'The student can record at most this long; graded manually by the teacher.',
        de: 'So lange darf die Schülerin/der Schüler aufnehmen; die Bewertung erfolgt manuell durch die Lehrkraft.',
      },
      min: 5,
      max: 3600,
    },
  ];
}
