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
