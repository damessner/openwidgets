// CSV/TSV parsing for vocabulary list imports. Shared between server and
// tests so it stays pure and dependency-free.
//
// Format: one entry per line — `term;translation;example;note`
// (";" or tab as separator). A header row (term/begriff/wort/word/vokabel) is
// skipped. Empty lines and lines without a term are ignored.

export const MAX_VOCAB_CSV_ROWS = 500;

export function parseVocabCsv(text) {
  const lines = String(text || '').split(/\r?\n/);
  const entries = [];
  lines.forEach((line, lineIndex) => {
    if (entries.length >= MAX_VOCAB_CSV_ROWS) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    const cells = trimmed.includes(';') ? trimmed.split(';') : trimmed.split('\t');
    const term = (cells[0] || '').trim().slice(0, 200);
    if (!term) return;
    if (lineIndex === 0 && /^(term|begriff|wort|word|vokabel)$/i.test(term)) return; // header row
    entries.push({
      term,
      translation: (cells[1] || '').trim().slice(0, 200),
      alternatives: [],
      example: (cells[2] || '').trim().slice(0, 1000),
      imageAssetId: '',
      audioAssetId: '',
      notes: (cells[3] || '').trim().slice(0, 500),
    });
  });
  return entries;
}
