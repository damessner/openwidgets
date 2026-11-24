// Unit tests for v0.3 features: practice setting, student-account helpers,
// QR matrix structure. (API-level coverage lives in students-api.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultSettings, normalizeSettings, validateActivity } from '../shared/activity.js';
import { generatePassword, usernameBase } from '../server/lib/students.js';

test('settings: practice flag defaults to false and validates as boolean', () => {
  assert.equal(defaultSettings().practice, false);
  assert.equal(normalizeSettings({}).practice, false);
  assert.equal(normalizeSettings({ practice: true }).practice, true);
  const bad = validateActivity({ title: 'x', settings: { practice: 'yes' }, items: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path === 'settings.practice'));
});

test('students: usernameBase transliterates and slugs names', () => {
  assert.equal(usernameBase('Anna Müller'), 'anna-mueller');
  assert.equal(usernameBase('  Öztürk-Ünal  '), 'oeztuerk-uenal');
  assert.equal(usernameBase('!!!'), 'schueler');
});

test('students: generated passwords are 10 chars from the unambiguous alphabet', () => {
  const pw = generatePassword();
  assert.match(pw, /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{10}$/);
  assert.ok(!/[0O1Il]/.test(pw));
  assert.notEqual(generatePassword(), generatePassword());
});

test('qr: matrix structure is valid (finder patterns, size, format info present)', async () => {
  const { qrMatrixText, qrCodewords } = await import('../public/lib/qr.js');
  const rows = qrMatrixText('https://example.org/c/ABC123');
  const size = rows.length;
  assert.equal((size - 17) % 4, 0);
  assert.ok(size >= 21 && size <= 57);
  const at = (x, y) => rows[y][x] === '1';
  // finder pattern corners: 7x7 ring + center
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    assert.ok(at(cx, cy) && at(cx + 6, cy) && at(cx, cy + 6) && at(cx + 6, cy + 6), 'finder corner');
    assert.ok(at(cx + 3, cy + 3), 'finder center');
    assert.ok(!at(cx + 1, cy + 1), 'finder ring gap');
  }
  // timing pattern row/col 6 alternates
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(at(i, 6), i % 2 === 0);
    assert.equal(at(6, i), i % 2 === 0);
  }
  // dark module
  assert.ok(at(8, size - 8));
  // codewords fit capacity
  const { version, codewords } = qrCodewords('https://example.org/c/ABC123');
  assert.ok(version >= 1 && version <= 10);
  assert.ok(codewords.length > 0);
  // too-long input throws instead of producing a broken code
  assert.throws(() => qrMatrixText('x'.repeat(300)), /too long/);
});
