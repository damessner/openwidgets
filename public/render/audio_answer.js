// Audio answer: the student records with the microphone (MediaRecorder), can
// listen back and re-record; on stop the blob is uploaded through
// ctx.uploadAudio(blob) (provided by the student player, POST
// /api/participant/assets) and the response references the asset id.
// Review mode (teacher grading) just shows an audio player for the response.
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  notice,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'audio_answer';
export const label = { en: 'Audio answer (record)', de: 'Audio-Antwort (Aufnahme)' };

registerMessages({
  de: {
    'item.audio.legend': 'Nimm deine Antwort mit dem Mikrofon auf.',
    'item.audio.record': 'Aufnehmen',
    'item.audio.stop': 'Stoppen',
    'item.audio.rerecord': 'Neu aufnehmen',
    'item.audio.discard': 'Verwerfen',
    'item.audio.playback': 'Deine Aufnahme anhören',
    'item.audio.uploading': 'Wird hochgeladen …',
    'item.audio.uploaded': 'Aufnahme gespeichert ({s}s).',
    'item.audio.recording': 'Aufnahme läuft … {s}s',
    'item.audio.max_reached': 'Maximale Länge erreicht — Aufnahme gestoppt.',
    'item.audio.mic_denied': 'Kein Mikrofonzugriff möglich. Bitte Berechtigung erteilen.',
    'item.audio.unsupported': 'Audio-Aufnahme wird von diesem Browser nicht unterstützt.',
    'item.audio.upload_failed': 'Upload fehlgeschlagen — bitte erneut versuchen.',
    'item.audio.empty': 'Es wurde noch nichts aufgenommen.',
    'item.audio.review': 'Aufnahme der Schülerin/des Schülers',
    'item.audio.max_label': 'Max. {s}s',
  },
  en: {
    'item.audio.legend': 'Record your answer with the microphone.',
    'item.audio.record': 'Record',
    'item.audio.stop': 'Stop',
    'item.audio.rerecord': 'Re-record',
    'item.audio.discard': 'Discard',
    'item.audio.playback': 'Listen to your recording',
    'item.audio.uploading': 'Uploading …',
    'item.audio.uploaded': 'Recording saved ({s}s).',
    'item.audio.recording': 'Recording … {s}s',
    'item.audio.max_reached': 'Maximum length reached — recording stopped.',
    'item.audio.mic_denied': 'Microphone access denied. Please allow access.',
    'item.audio.unsupported': 'Audio recording is not supported by this browser.',
    'item.audio.upload_failed': 'Upload failed — please try again.',
    'item.audio.empty': 'Nothing has been recorded yet.',
    'item.audio.review': 'Student recording',
    'item.audio.max_label': 'Max. {s}s',
  },
});

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch { /* ignore */ }
  }
  return '';
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const maxSec = Math.min(3600, Math.max(5, Number(config.maxDurationSec) || 120));
  const uploadAudio = typeof rawCtx.uploadAudio === 'function' ? rawCtx.uploadAudio : null;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);

  let response = { assetId: '', durationMs: 0, mime: '' };
  let recorder = null;
  let chunks = [];
  let stream = null;
  let startedAt = 0;
  let timerId = null;
  let blobUrl = null;
  let lastBlob = null;

  const fs = h('fieldset.item-fieldset');
  fs.appendChild(h('legend.item-legend.sr-only', { text: t('item.audio.legend') }));

  // Review mode: just play the submitted recording.
  if (ctx.mode === 'review') {
    const existing = ctx.response && typeof ctx.response === 'object' ? ctx.response : {};
    if (existing.assetId) {
      const id = encodeURIComponent(String(existing.assetId));
      fs.appendChild(h('div.field',
        h('label.label', { text: t('item.audio.review') }),
        h('audio.item-audio-player', { controls: true, preload: 'metadata', src: `/assets/${id}/${id}` }),
      ));
    } else {
      fs.appendChild(notice(t('item.audio.empty'), 'warning'));
    }
    root.appendChild(fs);
    const resultRegion = createResultRegion();
    root.appendChild(resultRegion);
    if (ctx.result) applyResult(root, resultRegion, ctx.result);
    const keyBlock = solutionBlock(item, ctx);
    if (keyBlock) root.appendChild(keyBlock);
    container.replaceChildren(root);
    return {
      getResponse() { return { ...response }; },
      setResponse(r) { response = r && typeof r === 'object' ? { ...r } : { assetId: '', durationMs: 0, mime: '' }; },
      setResult(result) { applyResult(root, resultRegion, result); },
      focus() { focusRoot(root); },
      destroy() { container.replaceChildren(); },
    };
  }

  const status = h('p.small.muted', { text: t('item.audio.max_label', { s: maxSec }) });
  const recordBtn = h('button.btn.btn-danger', { type: 'button' },
    h('span', { html: icon('mic', { size: 16 }) }), ' ', t('item.audio.record'));
  const stopBtn = h('button.btn.btn-secondary', { type: 'button', hidden: true }, t('item.audio.stop'));
  const playerWrap = h('div.item-audio-player-wrap', { hidden: true });
  const player = h('audio.item-audio-player', { controls: true, 'aria-label': t('item.audio.playback') });
  playerWrap.appendChild(player);
  const rerecordBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button', hidden: true }, t('item.audio.rerecord'));
  const discardBtn = h('button.btn.btn-ghost.btn-sm', { type: 'button', hidden: true }, t('item.audio.discard'));
  const errorBox = h('p.error-text', { role: 'alert', hidden: true });

  fs.appendChild(h('div.row.gap-2.wrap', recordBtn, stopBtn, rerecordBtn, discardBtn));
  fs.appendChild(status);
  fs.appendChild(playerWrap);
  fs.appendChild(errorBox);
  root.appendChild(fs);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function setRecording(on) {
    recordBtn.hidden = on;
    stopBtn.hidden = !on;
    if (readonly) {
      recordBtn.disabled = true;
      stopBtn.disabled = true;
    }
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function cleanupStream() {
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      stream = null;
    }
  }

  async function startRecording() {
    clearError();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setError(t('item.audio.unsupported'));
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t('item.audio.mic_denied'));
      return;
    }
    const mime = pickMime();
    chunks = [];
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      cleanupStream();
      setError(t('item.audio.unsupported'));
      return;
    }
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', onRecordingStopped);
    startedAt = Date.now();
    recorder.start(250);
    setRecording(true);
    status.textContent = t('item.audio.recording', { s: '0' });
    timerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      status.textContent = t('item.audio.recording', { s: String(Math.min(elapsed, maxSec)) });
      if (elapsed >= maxSec) {
        status.textContent = t('item.audio.max_reached');
        stopRecording();
      }
    }, 500);
  }

  function stopRecording() {
    stopTimer();
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    setRecording(false);
  }

  async function onRecordingStopped() {
    cleanupStream();
    const durationMs = Date.now() - startedAt;
    const mime = (recorder && recorder.mimeType) || pickMime() || 'audio/webm';
    lastBlob = new Blob(chunks, { type: mime.split(';')[0] });
    chunks = [];
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    blobUrl = URL.createObjectURL(lastBlob);
    player.src = blobUrl;
    playerWrap.hidden = false;
    rerecordBtn.hidden = readonly ? true : false;
    discardBtn.hidden = readonly ? true : false;
    status.textContent = t('item.audio.uploading');
    if (uploadAudio && !readonly) {
      try {
        const result = await uploadAudio(lastBlob, lastBlob.type || mime);
        if (result && result.asset) {
          response = { assetId: result.asset.id, durationMs, mime: result.asset.mime || mime.split(';')[0] };
          status.textContent = t('item.audio.uploaded', { s: String(Math.round(durationMs / 1000)) });
        } else {
          status.textContent = t('item.audio.upload_failed');
        }
      } catch {
        status.textContent = t('item.audio.upload_failed');
      }
    } else {
      status.textContent = t('item.audio.uploaded', { s: String(Math.round(durationMs / 1000)) });
    }
  }

  recordBtn.addEventListener('click', () => { void startRecording(); });
  stopBtn.addEventListener('click', () => stopRecording());
  rerecordBtn.addEventListener('click', () => {
    response = { assetId: '', durationMs: 0, mime: '' };
    playerWrap.hidden = true;
    rerecordBtn.hidden = true;
    discardBtn.hidden = true;
    status.textContent = t('item.audio.max_label', { s: maxSec });
    void startRecording();
  });
  discardBtn.addEventListener('click', () => {
    response = { assetId: '', durationMs: 0, mime: '' };
    playerWrap.hidden = true;
    discardBtn.hidden = true;
    rerecordBtn.hidden = true;
    status.textContent = t('item.audio.max_label', { s: maxSec });
  });

  if (readonly) {
    recordBtn.disabled = true;
    stopBtn.disabled = true;
  }

  function setResponse(r) {
    response = r && typeof r === 'object' ? { assetId: String(r.assetId || ''), durationMs: Number(r.durationMs) || 0, mime: String(r.mime || '') } : { assetId: '', durationMs: 0, mime: '' };
    if (response.assetId) {
      const id = encodeURIComponent(response.assetId);
      player.src = `/assets/${id}/${id}`;
      playerWrap.hidden = false;
      status.textContent = t('item.audio.uploaded', { s: String(Math.round(response.durationMs / 1000)) });
      rerecordBtn.hidden = true;
      discardBtn.hidden = true;
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { ...response };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'button:enabled')) focusRoot(root);
    },
    destroy() {
      stopTimer();
      cleanupStream();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      container.replaceChildren();
    },
  };
}
