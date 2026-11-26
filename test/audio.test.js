// Audio normalisation (server/lib/audio.js): MP3 passthrough, transcode
// decision logic, filename rewriting, and graceful fallback when ffmpeg is
// missing or the input is not valid audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAudioMime,
  mp3Filename,
  needsTranscode,
  resetFfmpegAvailability,
  transcodeToMp3,
} from '../server/lib/audio.js';

test('audio: mime classification + transcode decision', () => {
  assert.equal(isAudioMime('audio/wav'), true);
  assert.equal(isAudioMime('audio/mpeg'), true);
  assert.equal(isAudioMime('image/png'), false);
  assert.equal(needsTranscode('audio/mpeg'), false, 'mp3 stays untouched');
  assert.equal(needsTranscode('audio/wav'), true);
  assert.equal(needsTranscode('audio/ogg'), true);
  assert.equal(needsTranscode('audio/mp4'), true);
  assert.equal(needsTranscode('audio/webm'), true);
  assert.equal(needsTranscode('image/png'), false);
});

test('audio: mp3Filename rewrites the extension', () => {
  assert.equal(mp3Filename('aufnahme.wav'), 'aufnahme.mp3');
  assert.equal(mp3Filename('Sprachmemo (1).m4a'), 'Sprachmemo (1).mp3');
  assert.equal(mp3Filename('noext'), 'noext.mp3');
  assert.equal(mp3Filename(''), 'audio.mp3');
});

test('audio: mp3 input is never transcoded (returns null immediately)', async () => {
  assert.equal(await transcodeToMp3(Buffer.from([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg'), null);
  assert.equal(await transcodeToMp3(Buffer.from(''), 'audio/wav'), null, 'empty buffer');
});

test('audio: invalid audio bytes fall back to null (original is stored)', async () => {
  resetFfmpegAvailability();
  const result = await transcodeToMp3(Buffer.from('this is definitely not audio data at all'), 'audio/wav');
  assert.equal(result, null, 'garbage input -> null, caller stores the original');
});
