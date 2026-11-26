// Server-side audio normalisation: any uploaded audio that is not already MP3
// is transcoded to MP3 (much smaller than WAV, universally playable) via ffmpeg.
// If ffmpeg is missing or the conversion fails, the original file is stored
// unchanged — browsers play wav/ogg/m4a/webm natively, so this is a safe
// fallback. Pure Node (child_process + temp files), no npm dependencies.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

const MP3_MIME = 'audio/mpeg';

let availabilityChecked = false;
let ffmpegAvailable = false;

function ffmpegPath() {
  return config.ffmpegPath || 'ffmpeg';
}

/** Probe once whether the ffmpeg binary exists. */
export function isFfmpegAvailable() {
  if (availabilityChecked) return ffmpegAvailable;
  availabilityChecked = true;
  try {
    const result = spawnSync(ffmpegPath(), ['-version'], { stdio: 'ignore', timeout: 10000 });
    ffmpegAvailable = !result.error && result.status === 0;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/** Test hook: reset the cached availability probe. */
export function resetFfmpegAvailability() {
  availabilityChecked = false;
  ffmpegAvailable = false;
}

export function isAudioMime(mime) {
  return typeof mime === 'string' && mime.startsWith('audio/');
}

export function needsTranscode(mime) {
  return isAudioMime(mime) && mime !== MP3_MIME;
}

function extForMime(mime) {
  switch (mime) {
    case 'audio/wav': return 'wav';
    case 'audio/ogg': return 'ogg';
    case 'audio/webm': return 'webm';
    case 'audio/mp4': return 'm4a';
    case 'audio/mpeg': return 'mp3';
    default: return 'audio';
  }
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error });
      return;
    }
    let stderr = '';
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 8000) child.kill('SIGKILL');
      });
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ ok: false, error: new Error('ffmpeg timed out') });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve(status === 0 ? { ok: true } : { ok: false, error: new Error(`ffmpeg exited with ${status}: ${stderr.slice(-300)}`) });
    });
  });
}

/**
 * Transcode an audio buffer to MP3 (libmp3lame, 96 kbit/s — good for speech,
 * a fraction of WAV size). Returns { bytes, mime: 'audio/mpeg' } or null when
 * transcoding is not possible (no ffmpeg / unsupported input) — callers then
 * store the original bytes.
 */
export async function transcodeToMp3(bytes, mime, { timeoutMs = 60000 } = {}) {
  if (!needsTranscode(mime) || !bytes || bytes.length === 0) return null;
  if (!isFfmpegAvailable()) return null;
  const tmpIn = path.join(os.tmpdir(), `ow-in-${crypto.randomBytes(6).toString('hex')}.${extForMime(mime)}`);
  const tmpOut = path.join(os.tmpdir(), `ow-out-${crypto.randomBytes(6).toString('hex')}.mp3`);
  try {
    await fs.promises.writeFile(tmpIn, bytes);
    const result = await runFfmpeg(
      ['-y', '-i', tmpIn, '-vn', '-codec:a', 'libmp3lame', '-b:a', '96k', tmpOut],
      timeoutMs,
    );
    if (!result.ok) return null;
    const out = await fs.promises.readFile(tmpOut);
    if (!out || out.length === 0) return null;
    // Sanity: only accept when the output is meaningfully smaller or at least
    // valid-looking MP3 (ID3 header or frame sync 0xFF 0xFB/0xF3/0xF2).
    const looksMp3 = (out[0] === 0x49 && out[1] === 0x44 && out[2] === 0x33) || (out[0] === 0xff && (out[1] & 0xe0) === 0xe0);
    if (!looksMp3) return null;
    return { bytes: out, mime: MP3_MIME };
  } catch {
    return null;
  } finally {
    try { await fs.promises.unlink(tmpIn); } catch { /* ignore */ }
    try { await fs.promises.unlink(tmpOut); } catch { /* ignore */ }
  }
}

/** Replace the extension of a filename with .mp3. */
export function mp3Filename(filename) {
  const cleaned = String(filename || 'audio');
  const base = cleaned.replace(/\.[^.]*$/, '');
  return `${base || 'audio'}.mp3`;
}

async function withTempFiles(files, fn) {
  const paths = [];
  try {
    for (const [name, bytes] of files) {
      const p = path.join(os.tmpdir(), `ow-${name}-${crypto.randomBytes(6).toString('hex')}.mp3`);
      await fs.promises.writeFile(p, bytes);
      paths.push(p);
    }
    return await fn(paths);
  } finally {
    for (const p of paths) {
      try { await fs.promises.unlink(p); } catch { /* ignore */ }
    }
  }
}

/**
 * Concatenate MP3 buffers into one MP3 with a short pause between parts
 * (dialogue turns). Uses ffmpeg (re-encode, 96 kbit/s speech) when available;
 * falls back to a plain buffer concatenation (MP3 frames are self-contained,
 * players cope fine) so TTS dialogues still work without ffmpeg.
 */
export async function concatMp3Buffers(parts, { pauseSec = 0.45, timeoutMs = 120000 } = {}) {
  const buffers = (parts || []).filter((b) => b && b.length);
  if (buffers.length === 0) return null;
  if (buffers.length === 1) return buffers[0];
  if (!isFfmpegAvailable()) return Buffer.concat(buffers);
  return withTempFiles(buffers.map((b, i) => [`seg${i}`, b]), async (paths) => {
    const silence = path.join(os.tmpdir(), `ow-sil-${crypto.randomBytes(6).toString('hex')}.mp3`);
    const listFile = path.join(os.tmpdir(), `ow-list-${crypto.randomBytes(6).toString('hex')}.txt`);
    const out = path.join(os.tmpdir(), `ow-cat-${crypto.randomBytes(6).toString('hex')}.mp3`);
    try {
      const sil = await runFfmpeg(
        ['-y', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono:d=${pauseSec}`, '-codec:a', 'libmp3lame', '-b:a', '96k', silence],
        30000,
      );
      if (!sil.ok) return Buffer.concat(buffers);
      const entries = [];
      for (let i = 0; i < paths.length; i++) {
        entries.push(paths[i]);
        if (i < paths.length - 1) entries.push(silence);
      }
      await fs.promises.writeFile(listFile, entries.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
      const result = await runFfmpeg(
        ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vn', '-codec:a', 'libmp3lame', '-b:a', '96k', out],
        timeoutMs,
      );
      if (!result.ok) return Buffer.concat(buffers);
      const bytes = await fs.promises.readFile(out);
      const looksMp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
      return looksMp3 && bytes.length > 100 ? bytes : Buffer.concat(buffers);
    } catch {
      return Buffer.concat(buffers);
    } finally {
      try { await fs.promises.unlink(silence); } catch { /* ignore */ }
      try { await fs.promises.unlink(listFile); } catch { /* ignore */ }
      try { await fs.promises.unlink(out); } catch { /* ignore */ }
    }
  });
}

/**
 * Change playback tempo of an MP3 (factor 0.5–2.0; <1 = slower, e.g. 0.72 for
 * a "slow" listening version). Returns the original bytes when ffmpeg is
 * unavailable or the filter fails.
 */
export async function changeTempoMp3(bytes, factor = 0.75, { timeoutMs = 120000 } = {}) {
  if (!bytes || !bytes.length || !isFfmpegAvailable()) return bytes;
  const clamped = Math.min(2, Math.max(0.5, Number(factor) || 0.75));
  return withTempFiles([['in', bytes]], async ([tmpIn]) => {
    const tmpOut = path.join(os.tmpdir(), `ow-tempo-${crypto.randomBytes(6).toString('hex')}.mp3`);
    try {
      const result = await runFfmpeg(
        ['-y', '-i', tmpIn, '-vn', '-filter:a', `atempo=${clamped}`, '-codec:a', 'libmp3lame', '-b:a', '96k', tmpOut],
        timeoutMs,
      );
      if (!result.ok) return bytes;
      const out = await fs.promises.readFile(tmpOut);
      const looksMp3 = (out[0] === 0x49 && out[1] === 0x44 && out[2] === 0x33) || (out[0] === 0xff && (out[1] & 0xe0) === 0xe0);
      return looksMp3 && out.length > 100 ? out : bytes;
    } catch {
      return bytes;
    } finally {
      try { await fs.promises.unlink(tmpOut); } catch { /* ignore */ }
    }
  });
}
