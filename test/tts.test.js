// Mistral Voxtral TTS (server/llm/tts.js): request shape, voice resolution,
// VORLESETEXT stripping, error mapping. fetch is mocked — no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway DB before importing server modules (DATA_DIR must be set first).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwidgets-tts-'));
process.env.DATA_DIR = dataDir;

const { synthesizeSpeech, MAX_TTS_CHARS } = await import('../server/llm/tts.js');
const { saveLlmConfig, resolveLlmConfig, isTtsAvailable } = await import('../server/llm/core.js');
const { initDb } = await import('../server/db.js');
initDb();

// Force a Mistral config for these tests (settings table is per-test-process DB).
saveLlmConfig({
  provider: 'mistral',
  apiKey: 'test-key-123456',
  model: 'mistral-small-latest',
  baseUrl: 'https://api.mistral.ai',
  enabled: true,
  ttsModel: 'voxtral-mini-tts-3-0',
  voice: '',
});

const MP3_BYTES = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(500, 7)]);

function fakeFetchOk() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/audio/voices')) {
      return {
        ok: true,
        json: async () => ({ items: [
          { name: 'James', slug: 'voice_en_1', languages: ['en_us'], gender: 'male' },
          { name: 'Greta', slug: 'voice_de_1', languages: ['de_de'], gender: 'female' },
        ] }),
      };
    }
    if (String(url).endsWith('/v1/audio/speech')) {
      return { ok: true, arrayBuffer: async () => MP3_BYTES.buffer.slice(MP3_BYTES.byteOffset, MP3_BYTES.byteOffset + MP3_BYTES.length) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

test('tts: synthesizeSpeech posts to /v1/audio/speech with model+input+voice_id+mp3', async () => {
  const { fetchImpl, calls } = fakeFetchOk();
  const result = await synthesizeSpeech({ text: 'Hello, I am Leo. I am ten years old.', fetchImpl });
  assert.equal(result.mime, 'audio/mpeg');
  assert.equal(result.bytes.length, MP3_BYTES.length);
  assert.equal(result.model, 'voxtral-mini-tts-3-0');
  assert.equal(result.voice, 'voice_en_1', 'falls back to first English preset voice');
  const speechCall = calls.find((c) => c.url.endsWith('/v1/audio/speech'));
  assert.ok(speechCall, 'speech endpoint called');
  assert.equal(speechCall.init.method, 'POST');
  assert.equal(speechCall.init.headers.Authorization, 'Bearer test-key-123456');
  const body = JSON.parse(speechCall.init.body);
  assert.equal(body.model, 'voxtral-mini-tts-3-0');
  assert.equal(body.input, 'Hello, I am Leo. I am ten years old.');
  assert.equal(body.voice, 'voice_en_1');
  assert.equal(body.response_format, 'mp3');
});

test('tts: VORLESETEXT marker line is stripped before speaking', async () => {
  const { fetchImpl, calls } = fakeFetchOk();
  await synthesizeSpeech({
    text: 'VORLESETEXT (die Lehrkraft liest vor):\n\nHello! My name is Leo.',
    voice: 'voice_592',
    fetchImpl,
  });
  const speechCall = calls.find((c) => c.url.endsWith('/v1/audio/speech'));
  const body = JSON.parse(speechCall.init.body);
  assert.equal(body.input, 'Hello! My name is Leo.');
  assert.equal(body.voice, 'voice_592', 'explicit voice wins');
});

test('tts: JSON envelope with base64 audio_data is decoded to mp3 bytes', async () => {
  const b64 = MP3_BYTES.toString('base64');
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/v1/audio/voices')) {
      return { ok: true, json: async () => ({ items: [{ name: 'James', slug: 'voice_en_1', languages: ['en_us'] }] }) };
    }
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ audio_data: b64 }),
    };
  };
  const result = await synthesizeSpeech({ text: 'Hello there!', fetchImpl });
  assert.equal(result.bytes.length, MP3_BYTES.length);
  assert.deepEqual(result.bytes.subarray(0, 4), MP3_BYTES.subarray(0, 4));
  assert.equal(result.mime, 'audio/mpeg');
});

test('tts: JSON envelope without audio data -> clear error', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/v1/audio/voices')) {
      return { ok: true, json: async () => ({ items: [{ slug: 'voice_en_1', languages: ['en'] }] }) };
    }
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) };
  };
  await assert.rejects(() => synthesizeSpeech({ text: 'Hello there!', fetchImpl }), /without audio data/);
});

test('tts: validation + provider errors', async () => {
  const { fetchImpl } = fakeFetchOk();
  await assert.rejects(() => synthesizeSpeech({ text: '', fetchImpl }), /No text/);
  await assert.rejects(() => synthesizeSpeech({ text: 'x'.repeat(MAX_TTS_CHARS + 1), fetchImpl }), /too long/);
  const failFetch = async () => ({ ok: false, status: 401, text: async () => '{"message":"bad key"}' });
  await assert.rejects(() => synthesizeSpeech({ text: 'Hello there', fetchImpl: failFetch }), /401/);
});

test('tts: isTtsAvailable only with mistral provider + key', () => {
  assert.equal(resolveLlmConfig().provider, 'mistral');
  assert.equal(isTtsAvailable(), true);
  saveLlmConfig({ provider: 'gemini', apiKey: 'gkey', model: 'gemini-2.0-flash', baseUrl: '', enabled: true, ttsModel: '', voice: '' });
  assert.equal(resolveLlmConfig().ttsModel, '', 'gemini has no tts default');
  assert.equal(isTtsAvailable(), false, 'gemini cannot do TTS');
});
