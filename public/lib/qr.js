// Minimal QR Code generator (byte mode, ECC level M, versions 1-10) rendering
// crisp SVG — no external dependency, works offline on the school server.
// Supports up to ~213 bytes (v10-M), plenty for https://host/c/ABC123 links.

// --- GF(256) arithmetic (primitive polynomial 0x11D) ------------------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree) {
  // product of (x + alpha^i), coefficients highest-degree-first, leading 1
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const factor = [1, GF_EXP[i]]; // (x + alpha^i), highest-degree-first
    const next = new Array(poly.length + 1).fill(0);
    for (let a = 0; a < poly.length; a += 1) {
      for (let b = 0; b < 2; b += 1) {
        next[a + b] ^= gfMul(poly[a], factor[b]);
      }
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, degree) {
  const gen = rsGenerator(degree);
  const res = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < degree; i += 1) res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

// --- Version tables (ECC level M), versions 1..10 -----------------------------
// [ecCodewordsPerBlock, [numBlocks, dataCodewordsPerBlock], ...]
const VERSIONS = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];
const ALIGNMENT = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v += 1) {
    const [, ...groups] = VERSIONS[v];
    const dataCodewords = groups.reduce((sum, [n, d]) => sum + n * d, 0);
    const capacity = dataCodewords - 2; // mode(4) + count(8 or 16) + terminator headroom
    if (byteLen <= capacity) return v;
  }
  throw new Error('qr: text too long (max ~213 bytes)');
}

function encodeData(text, version) {
  const bytes = new TextEncoder().encode(text);
  const [, ...groups] = VERSIONS[version];
  const dataCodewords = groups.reduce((sum, [n, d]) => sum + n * d, 0);
  const bits = [];
  const pushBits = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) pushBits(byte, 8);
  // terminator
  const remaining = dataCodewords * 8 - bits.length;
  pushBits(0, Math.min(4, remaining));
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  const pads = [0xec, 0x11];
  let i = 0;
  while (out.length < dataCodewords) out.push(pads[i++ % 2]);
  return out;
}

function buildCodewords(text) {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length);
  const [ecPerBlock, ...groups] = VERSIONS[version];
  const data = encodeData(text, version);
  // split into blocks
  const blocks = [];
  let offset = 0;
  for (const [num, size] of groups) {
    for (let i = 0; i < num; i += 1) {
      blocks.push(data.slice(offset, offset + size));
      offset += size;
    }
  }
  const eccBlocks = blocks.map((block) => rsEncode(block, ecPerBlock));
  // interleave
  const result = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) for (const block of blocks) if (i < block.length) result.push(block[i]);
  for (let i = 0; i < ecPerBlock; i += 1) for (const ecc of eccBlocks) result.push(ecc[i]);
  return { version, codewords: result };
}

// --- Matrix -------------------------------------------------------------------
function buildMatrix(version, codewords, forceMask = null) {
  const size = 17 + version * 4;
  const modules = new Array(size * size).fill(null); // null = unset
  const set = (x, y, value) => {
    modules[y * size + x] = value;
  };
  const get = (x, y) => modules[y * size + x];

  // finder patterns + separators
  const finder = (cx, cy) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inRing = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark =
          inRing && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(x, y, dark);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  // alignment patterns
  const positions = ALIGNMENT[version];
  for (const cx of positions) {
    for (const cy of positions) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    if (get(i, 6) === null) set(i, 6, i % 2 === 0);
    if (get(6, i) === null) set(6, i, i % 2 === 0);
  }

  // dark module
  set(8, size - 8, true);

  // version information (versions 7+, 18 bits with BCH) — reserved here,
  // drawn after masking (like format info, it is not masked)
  if (version >= 7) {
    let vi = version << 12;
    const viPoly = 0b1111100100101;
    for (let i = 17; i >= 12; i -= 1) {
      if ((vi >> i) & 1) vi ^= viPoly << (i - 12);
    }
    const versionBits = (version << 12) | (vi & 0xfff);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((versionBits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit); // top-right strip
      set(b, a, bit); // bottom-left strip
    }
  }

  // reserve format info areas (drawn later)
  const reserveFormat = () => {
    for (let i = 0; i <= 8; i += 1) {
      if (get(i, 8) === null) set(i, 8, false);
      if (get(8, i) === null) set(8, i, false);
    }
    for (let i = 0; i < 8; i += 1) {
      if (get(size - 1 - i, 8) === null) set(size - 1 - i, 8, false);
      if (get(8, size - 1 - i) === null) set(8, size - 1 - i, false);
    }
  };
  reserveFormat();

  // data placement (zig-zag from bottom-right)
  const dataBits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i -= 1) dataBits.push((byte >> i) & 1);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip timing column
    for (let i = 0; i < size; i += 1) {
      const y = upward ? size - 1 - i : i;
      for (const x of [right, right - 1]) {
        if (get(x, y) === null) {
          set(x, y, bitIndex < dataBits.length ? dataBits[bitIndex++] === 1 : false);
        }
      }
    }
    upward = !upward;
  }

  // masks
  const maskFns = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  // Build a function-pattern map once
  const isFunction = new Array(size * size).fill(false);
  {
    const mark = (x, y) => {
      if (x >= 0 && y >= 0 && x < size && y < size) isFunction[y * size + x] = true;
    };
    const markFinder = (cx, cy) => {
      for (let dy = -1; dy <= 7; dy += 1) for (let dx = -1; dx <= 7; dx += 1) mark(cx + dx, cy + dy);
    };
    markFinder(0, 0);
    markFinder(size - 7, 0);
    markFinder(0, size - 7);
    for (const cx of positions) for (const cy of positions) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(cx + dx, cy + dy);
    }
    for (let i = 0; i < size; i += 1) {
      mark(i, 6);
      mark(6, i);
    }
    // format info occupies only the edges of row/col 8 — the middle is data
    for (let i = 0; i <= 8; i += 1) {
      mark(i, 8);
      mark(8, i);
    }
    for (let i = 0; i <= 7; i += 1) {
      mark(size - 1 - i, 8);
      mark(8, size - 1 - i);
    }
    mark(8, size - 8); // dark module
    if (version >= 7) {
      for (let i = 0; i < 18; i += 1) {
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        mark(a, b);
        mark(b, a);
      }
    }
  }

  const penalty = (matrix) => {
    let score = 0;
    // N1: runs of 5+ same color in rows/cols
    for (let y = 0; y < size; y += 1) {
      let run = 1;
      for (let x = 1; x < size; x += 1) {
        if (matrix[y * size + x] === matrix[y * size + x - 1]) run += 1;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (let x = 0; x < size; x += 1) {
      let run = 1;
      for (let y = 1; y < size; y += 1) {
        if (matrix[y * size + x] === matrix[(y - 1) * size + x]) run += 1;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    // N2: 2x2 blocks
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const c = matrix[y * size + x];
        if (c === matrix[y * size + x + 1] && c === matrix[(y + 1) * size + x] && c === matrix[(y + 1) * size + x + 1]) score += 3;
      }
    }
    // N3: finder-like patterns
    const pattern = [true, false, true, true, true, false, true];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x <= size - 7; x += 1) {
        let match = true;
        for (let i = 0; i < 7; i += 1) if (matrix[y * size + x + i] !== pattern[i]) { match = false; break; }
        if (match) score += 40;
        let matchV = true;
        for (let i = 0; i < 7; i += 1) if (matrix[(y + i) * size + x] !== pattern[i]) { matchV = false; break; }
        if (matchV) score += 40;
      }
    }
    // N4: dark ratio
    let dark = 0;
    for (const m of matrix) if (m) dark += 1;
    const ratio = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  };

  let bestMatrix = null;
  let bestScore = Infinity;
  let bestMask = 0;
  const maskRange = forceMask === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of maskRange) {
    const fn = maskFns[mask];
    const candidate = modules.map((value, index) => {
      if (value === null) return false;
      if (isFunction[index]) return value;
      const x = index % size;
      const y = Math.floor(index / size);
      return fn(x, y) ? !value : value;
    });
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }
  const matrix = bestMatrix;

  // format info (ECC M = 00), 15 bits with BCH, XOR 0x5412
  const formatData = (0b00 << 3) | bestMask;
  let formatBits = formatData << 10;
  const formatPoly = 0b10100110111;
  for (let i = 14; i >= 10; i -= 1) {
    if ((formatBits >> i) & 1) formatBits ^= formatPoly << (i - 10);
  }
  const format15 = ((formatData << 10) | (formatBits & 0x3ff)) ^ 0x5412;

  const drawFormat = (x, y, bitIndex) => {
    matrix[y * size + x] = ((format15 >> bitIndex) & 1) === 1;
  };
  for (let i = 0; i <= 5; i += 1) drawFormat(8, i, i);
  drawFormat(8, 7, 6);
  drawFormat(8, 8, 7);
  drawFormat(7, 8, 8);
  for (let i = 9; i <= 14; i += 1) drawFormat(14 - i, 8, i);
  for (let i = 0; i <= 7; i += 1) drawFormat(size - 1 - i, 8, i);
  for (let i = 8; i <= 14; i += 1) drawFormat(8, size - 15 + i, i);

  return { size, matrix };
}

/**
 * Render a QR code for `text` as an SVG element.
 * options: { size = 160 (px), margin = 4 (modules), title }
 */
export function qrSvg(text, options = {}) {
  const { version, codewords } = buildCodewords(String(text));
  const { size, matrix } = buildMatrix(version, codewords);
  const margin = options.margin === undefined ? 4 : options.margin;
  const px = options.size || 160;
  const total = size + margin * 2;
  const scale = px / total;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('role', 'img');
  svg.classList.add('qr-code');
  if (options.title) {
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = options.title;
    svg.appendChild(title);
  }
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('width', String(total));
  bg.setAttribute('height', String(total));
  bg.setAttribute('fill', '#ffffff');
  svg.appendChild(bg);
  const path = document.createElementNS(svgNS, 'path');
  let d = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y * size + x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', '#141b2d');
  svg.appendChild(path);
  return svg;
}

/** Codewords (data+ecc, interleaved) for tests. */
export function qrCodewords(text) {
  const { version, codewords } = buildCodewords(String(text));
  return { version, codewords };
}



/** Escape hatch for tests/non-DOM use: returns the module matrix as strings of 0/1. */
export function qrMatrixText(text, forceMask = null) {
  const { version, codewords } = buildCodewords(String(text));
  const { size, matrix } = buildMatrix(version, codewords, forceMask);
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    let row = '';
    for (let x = 0; x < size; x += 1) row += matrix[y * size + x] ? '1' : '0';
    rows.push(row);
  }
  return rows;
}
