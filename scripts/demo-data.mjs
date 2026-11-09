// Demo activity fixtures for local demos, seed scripts and browser verification.
// Uses the real shared item modules so the generated data always matches the
// current schema. Pure Node/browser-safe except for the PNG helper (node:zlib).
import zlib from 'node:zlib';
import { createDefinition } from '../shared/activity.js';
import { createItem } from '../shared/items/index.js';

export const DEMO_ZONES = [
  { id: 'z1', label: 'Divergente Grenze', x: 0.2, y: 0.32, r: 0.09 },
  { id: 'z2', label: 'Konvergente Grenze', x: 0.53, y: 0.66, r: 0.09 },
  { id: 'z3', label: 'Transform-Grenze', x: 0.83, y: 0.3, r: 0.09 },
];

function buildItem(type, config, { points, stem, help = '', media } = {}) {
  const item = createItem(type, { points });
  item.stem = stem || '';
  item.help = help;
  item.config = { ...item.config, ...config };
  if (media) item.media = media;
  return item;
}

/** A 10-item German worksheet covering every v0.1 item type. */
export function demoWorksheet({ imageAsset } = {}) {
  const definition = createDefinition({
    template: 'worksheet',
    locale: 'de',
    title: 'Plattentektonik — Demo-Arbeitsblatt',
  });
  definition.description =
    'Demonstrations-Arbeitsblatt für OpenWidgets: gemischte Aufgabentypen, automatische Bewertung, ein Freitext zur manuellen Bewertung.';
  definition.settings = {
    ...definition.settings,
    instantFeedback: true,
    showResults: true,
    allowReview: true,
    showAnswers: false,
    warnUnanswered: true,
    timeLimitMinutes: null,
    requireName: true,
  };

  const items = [];

  items.push(
    buildItem('text', { text: '**Lies den folgenden Text aufmerksam.** Die Erdkruste besteht aus mehreren großen Platten, die auf dem zähflüssigen Erdmantel langsam wandern. An ihren Rändern entstehen Gebirge, Vulkane und Erdbeben.' }, {
      stem: '',
      points: 0,
    }),
  );
  items.push(
    buildItem(
      'multiple_choice',
      {
        multi: false,
        choices: [
          { id: 'c1', text: 'Lithosphäre', correct: true },
          { id: 'c2', text: 'Asthenosphäre', correct: false },
          { id: 'c3', text: 'Erdkern', correct: false },
          { id: 'c4', text: 'Atmosphäre', correct: false },
        ],
        shuffle: true,
      },
      { stem: 'Welche Schicht der Erde bewegt sich bei der Plattentektonik als Platte?', points: 2 },
    ),
  );
  items.push(
    buildItem(
      'multiple_choice',
      {
        multi: true,
        choices: [
          { id: 'c1', text: 'Passende Küstenformen auf verschiedenen Kontinenten', correct: true },
          { id: 'c2', text: 'Gleiche Fossilienfunde auf getrennten Kontinenten', correct: true },
          { id: 'c3', text: 'Magnetische Streifenmuster am Meeresboden', correct: true },
          { id: 'c4', text: 'Tägliche Wetteraufzeichnungen', correct: false },
        ],
        shuffle: true,
        partialCredit: true,
      },
      { stem: 'Welche Beobachtungen sprechen für die Plattentektonik? (Mehrfachauswahl)', points: 3 },
    ),
  );
  items.push(
    buildItem(
      'short_answer',
      {
        accepted: ['plattentektonik', 'tektonik der platten', 'plattentektonik-theorie'],
        caseSensitive: false,
        trim: true,
        collapseSpaces: true,
        ignorePunctuation: true,
      },
      { stem: 'Wie heißt die Theorie, die die Bewegung der Kontinente erklärt?', points: 2 },
    ),
  );
  items.push(
    buildItem(
      'numeric',
      { answer: 2.5, tolerance: 0.8, toleranceType: 'absolute' },
      { stem: 'Mit welcher durchschnittlichen Geschwindigkeit bewegen sich Erdplatten? (Angabe in cm pro Jahr)', points: 2, help: 'Tipp: Es sind wenige Zentimeter pro Jahr.' },
    ),
  );
  items.push(
    buildItem(
      'fill_blanks',
      {
        text: 'An {{1}} Plattenrändern bewegen sich die Platten auseinander, an {{2}} Rändern tauchen sie ineinander. Am {{3}} gleiten sie aneinander vorbei.',
        blanks: {
          1: { accepted: ['divergenten', 'divergent', 'konstruktiven'] },
          2: { accepted: ['konvergenten', 'konvergent', 'destruktiven'] },
          3: { accepted: ['transformrand', 'transform-rand', 'transform'] },
        },
        caseSensitive: false,
      },
      { stem: 'Ergänze die fehlenden Begriffe.', points: 3 },
    ),
  );
  items.push(
    buildItem(
      'match',
      {
        shuffle: true,
        pairs: [
          { id: 'p1', left: 'Divergenz', right: 'Platten bewegen sich auseinander' },
          { id: 'p2', left: 'Konvergenz', right: 'Eine Platte taucht unter die andere' },
          { id: 'p3', left: 'Transform-Störung', right: 'Platten gleiten aneinander vorbei' },
        ],
      },
      { stem: 'Ordne die Begriffe den richtigen Beschreibungen zu.', points: 3 },
    ),
  );
  items.push(
    buildItem(
      'ordering',
      {
        mode: 'positions',
        items: [
          { id: 'i1', text: 'Spannungen bauen sich in der Erdkruste auf' },
          { id: 'i2', text: 'Die Gesteinsschichten brechen' },
          { id: 'i3', text: 'Die Bruchstellen gleiten ruckartig ab' },
          { id: 'i4', text: 'Erschütterungen breiten sich als Erdbebenwellen aus' },
        ],
      },
      { stem: 'Bringe die Entstehung eines Erdbebens in die richtige Reihenfolge.', points: 3 },
    ),
  );
  if (imageAsset) {
    items.push(
      buildItem(
        'pins',
        {
          image: { assetId: imageAsset.id, url: imageAsset.url, alt: 'Vereinfachte Karte mit drei Plattengrenzen' },
          zones: DEMO_ZONES,
        },
        { stem: 'Setze für jede Plattengrenze einen Marker auf die passende Stelle im Bild.', points: 3 },
      ),
    );
  }
  items.push(
    buildItem(
      'long_answer',
      {
        hints: [
          { text: 'subduktion', alternatives: ['untertauchen', 'abtauchen'], points: 2 },
          { text: 'konvergen', alternatives: ['konvergenz'], points: 1 },
          { text: 'magma', alternatives: ['magmen'], points: 1 },
        ],
        rubric: [
          {
            criterion: 'Fachliche Richtigkeit',
            levels: [
              { label: 'Nicht ausreichend', points: 0 },
              { label: 'Grundlegend', points: 2 },
              { label: 'Vollständig', points: 4 },
            ],
          },
        ],
        minWords: 30,
        maxWords: 3000,
      },
      {
        stem: 'Erkläre in eigenen Worten, warum am Pazifischen Feuerring viele Vulkane entstehen.',
        points: 5,
      },
    ),
  );

  definition.items = items;
  return definition;
}

/** A short quiz (one item per screen) for demoing the quiz template. */
export function demoQuiz({ imageAsset } = {}) {
  const definition = createDefinition({ template: 'quiz', locale: 'de', title: 'Plattentektonik — Demo-Quiz' });
  definition.description = 'Kurzes Quiz zur Demonstration des Ein-Frage-pro-Seite-Modus.';
  definition.settings = {
    ...definition.settings,
    instantFeedback: true,
    showResults: true,
    allowReview: true,
    showAnswers: false,
    timeLimitMinutes: null,
  };
  const items = [];
  items.push(
    buildItem(
      'multiple_choice',
      {
        multi: false,
        choices: [
          { id: 'c1', text: 'Der Pazifische Feuerring', correct: true },
          { id: 'c2', text: 'Die Alpen', correct: false },
          { id: 'c3', text: 'Der Ätna', correct: false },
        ],
        shuffle: true,
      },
      { stem: 'Wo gibt es die meisten aktiven Vulkane?', points: 1 },
    ),
  );
  items.push(
    buildItem(
      'short_answer',
      { accepted: ['erdbeben'], caseSensitive: false, trim: true, collapseSpaces: true, ignorePunctuation: true },
      { stem: 'Wie nennt man die Erschütterungen, die entstehen, wenn Gestein bricht?', points: 1 },
    ),
  );
  if (imageAsset) {
    items.push(
      buildItem(
        'pins',
        {
          image: { assetId: imageAsset.id, url: imageAsset.url, alt: 'Karte der Plattengrenzen' },
          zones: DEMO_ZONES,
        },
        { stem: 'Markiere die divergente Plattengrenze.', points: 2 },
      ),
    );
  }
  definition.items = items;
  return definition;
}

// ---------------------------------------------------------------------------
// Minimal PNG generator (truecolor, no alpha) — avoids any image dependency.
// ---------------------------------------------------------------------------

function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/** Render a simple diagram of three plate boundaries: returns a PNG buffer. */
export function makeDiagramPng({ width = 800, height = 500, zones = DEMO_ZONES } = {}) {
  const pixels = Buffer.alloc(width * height * 3, 240);
  const setPixel = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
  };
  const fillCircle = (cx, cy, radius, r, g, b) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) setPixel(x, y, r, g, b);
      }
    }
  };

  // Ocean-ish background bands.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = y / height;
      setPixel(x, y, Math.round(214 + 20 * t), Math.round(229 + 16 * t), Math.round(240 + 8 * t));
    }
  }
  // Landmass blobs.
  const blobs = [
    [0.26, 0.32, 150, 156, 202, 136],
    [0.6, 0.62, 170, 210, 186, 130],
    [0.78, 0.28, 120, 176, 206, 150],
  ];
  for (const [nx, ny, radius, r, g, b] of blobs) fillCircle(nx * width, ny * height, radius, r, g, b);

  // Boundary lines.
  const drawLine = (x0, y0, x1, y1, r, g, b, thickness = 4) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i += 1) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      fillCircle(x, y, thickness, r, g, b);
    }
  };
  drawLine(width * 0.08, height * 0.15, width * 0.3, height * 0.85, 90, 90, 110, 3);
  drawLine(width * 0.45, height * 0.1, width * 0.62, height * 0.9, 90, 90, 110, 3);
  drawLine(width * 0.72, height * 0.12, width * 0.95, height * 0.8, 90, 90, 110, 3);

  // Target markers (visual hints for the demo zones).
  for (const zone of zones) {
    const cx = zone.x * width;
    const cy = zone.y * height;
    fillCircle(cx, cy, 16, 226, 88, 60);
    fillCircle(cx, cy, 9, 255, 255, 255);
  }

  // Assemble PNG.
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter type: none
    pixels.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
