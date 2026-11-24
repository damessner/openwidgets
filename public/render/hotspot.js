// Hotspot image (TipToi): the student taps a zone on the image; each zone can
// show a feedback popup (text / image / audio) and an optional link (another
// assignment = learning path, or external URL). An optional audio prompt plays
// the instruction ("tippe den Vogel an").
//
// Student payload (sanitized): zones WITHOUT the `correct` flag — geometry,
// label, feedback and link are visible; correctness is only scored server-side.
// Teacher preview/review sees the raw config including `correct`.
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  mediaUrl,
  notice,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'hotspot';
export const label = { en: 'Hotspot image (TipToi)', de: 'Hotspot-Bild (TipToi)' };

registerMessages({
  de: {
    'item.hotspot.legend': 'Tippe auf einen Bereich im Bild.',
    'item.hotspot.tap_hint': 'Tippe auf einen markierten Bereich.',
    'item.hotspot.no_image': 'Für diese Aufgabe ist kein Bild hinterlegt.',
    'item.hotspot.zone': 'Bereich {n}',
    'item.hotspot.feedback_title': 'Info',
    'item.hotspot.open_link_assignment': 'Zur Aufgabe springen',
    'item.hotspot.open_link_url': 'Link öffnen',
    'item.hotspot.play_prompt': 'Anweisung anhören',
    'item.hotspot.prompt_audio': 'Audio-Anweisung',
    'item.hotspot.tapped': '{n} Bereich(e) angetippt',
  },
  en: {
    'item.hotspot.legend': 'Tap a region on the image.',
    'item.hotspot.tap_hint': 'Tap a highlighted region.',
    'item.hotspot.no_image': 'No image is set for this item.',
    'item.hotspot.zone': 'Region {n}',
    'item.hotspot.feedback_title': 'Info',
    'item.hotspot.open_link_assignment': 'Go to assignment',
    'item.hotspot.open_link_url': 'Open link',
    'item.hotspot.play_prompt': 'Play instructions',
    'item.hotspot.prompt_audio': 'Audio instructions',
    'item.hotspot.tapped': '{n} region(s) tapped',
  },
});

function assetUrlOf(ref) {
  if (!ref) return null;
  if (typeof ref.url === 'string' && ref.url) return ref.url;
  if (typeof ref === 'string') return `/assets/${encodeURIComponent(ref)}/${encodeURIComponent(ref)}`;
  if (ref.assetId) {
    const id = encodeURIComponent(String(ref.assetId));
    return `/assets/${id}/${id}`;
  }
  return null;
}

function zonesOf(config) {
  return Array.isArray(config.zones) ? config.zones.filter((z) => z && typeof z === 'object' && z.id != null) : [];
}

function zoneStyle(zone) {
  const style = {};
  if (zone.shape === 'circle') {
    const r = Math.max(0.02, Number(zone.r) || 0.08);
    style.left = `${(Number(zone.x) - r) * 100}%`;
    style.top = `${(Number(zone.y) - r) * 100}%`;
    style.width = `${r * 2 * 100}%`;
    style.height = `${r * 2 * 100}%`;
    style.borderRadius = '50%';
  } else {
    style.left = `${(Number(zone.x) || 0) * 100}%`;
    style.top = `${(Number(zone.y) || 0) * 100}%`;
    style.width = `${Math.max(0.02, Number(zone.w) || 0.2) * 100}%`;
    style.height = `${Math.max(0.02, Number(zone.h) || 0.15) * 100}%`;
  }
  return style;
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const zones = zonesOf(config);
  const imageRef = config.image || {};
  const imageUrl = assetUrlOf(imageRef);
  const prompt = config.prompt && typeof config.prompt === 'object' ? config.prompt : {};
  const promptAudioUrl = prompt.audioAssetId ? assetUrlOf(prompt.audioAssetId) : null;
  const reviewZones = Array.isArray(ctx.reviewZones) ? ctx.reviewZones : null;
  const correctIds = new Set((reviewZones || zones.filter((z) => z.correct === true)).map((z) => z.id));

  const tapped = new Set();
  const zoneButtons = [];
  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);

  // Prompt (TipToi): text + optional audio instruction
  const promptText = String(prompt.text || '').trim();
  if (promptText || promptAudioUrl) {
    const promptBox = h('div.item-hotspot-prompt');
    if (promptText) promptBox.appendChild(h('p.item-hotspot-prompt-text', { text: promptText }));
    if (promptAudioUrl) {
      promptBox.appendChild(h('audio.item-hotspot-prompt-audio', { controls: true, preload: 'metadata', src: promptAudioUrl, 'aria-label': t('item.hotspot.prompt_audio') }));
    }
    root.appendChild(promptBox);
  }

  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!imageUrl) {
    root.appendChild(notice(t('item.hotspot.no_image'), 'warning'));
  } else {
    const img = h('img.item-hotspot-img', { src: imageUrl, alt: String(imageRef.alt || ''), draggable: false });
    const layer = h('div.item-hotspot-layer');
    zones.forEach((zone, index) => {
      const btn = h('button.item-hotspot-zone', {
        type: 'button',
        style: zoneStyle(zone),
        'aria-label': zone.label ? `${zone.label}` : t('item.hotspot.zone', { n: index + 1 }),
        title: zone.label || t('item.hotspot.zone', { n: index + 1 }),
        'aria-pressed': 'false',
      });
      if (ctx.mode === 'review' && ctx.showAnswers && correctIds.has(zone.id)) {
        btn.classList.add('is-solution');
      }
      if (!readonly) {
        btn.addEventListener('click', () => {
          if (tapped.has(zone.id)) {
            tapped.delete(zone.id);
            btn.setAttribute('aria-pressed', 'false');
            btn.classList.remove('is-tapped');
          } else {
            tapped.add(zone.id);
            btn.setAttribute('aria-pressed', 'true');
            btn.classList.add('is-tapped');
          }
          showFeedback(zone);
          live.textContent = t('item.hotspot.tapped', { n: tapped.size });
        });
      } else {
        btn.disabled = true;
        if (tapped.has(zone.id)) {
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('is-tapped');
        }
      }
      zoneButtons.push({ zone, btn });
      layer.appendChild(btn);
    });
    const canvas = h('div.item-hotspot-canvas', img, layer);
    root.appendChild(canvas);

    // feedback popup panel
    const feedbackPanel = h('div.item-hotspot-feedback', { hidden: true, role: 'status' });
    root.appendChild(feedbackPanel);

    function showFeedback(zone) {
      clear(feedbackPanel);
      const fb = zone.feedback && typeof zone.feedback === 'object' ? zone.feedback : {};
      const imgUrl = fb.imageAssetId ? assetUrlOf(fb.imageAssetId) : null;
      const audioUrl = fb.audioAssetId ? assetUrlOf(fb.audioAssetId) : null;
      const link = zone.link && typeof zone.link === 'object' ? zone.link : { type: 'none', value: '' };
      const hasContent = (fb.text && fb.text.trim()) || imgUrl || audioUrl || (link.type !== 'none' && link.value);
      if (!hasContent) {
        feedbackPanel.hidden = true;
        return;
      }
      feedbackPanel.hidden = false;
      feedbackPanel.appendChild(h('div.strong.mb-1', { text: zone.label || t('item.hotspot.feedback_title') }));
      if (fb.text && fb.text.trim()) feedbackPanel.appendChild(h('p.item-hotspot-feedback-text', { text: fb.text }));
      if (imgUrl) feedbackPanel.appendChild(h('img.item-hotspot-feedback-img', { src: imgUrl, alt: zone.label || '' }));
      if (audioUrl) feedbackPanel.appendChild(h('audio.item-hotspot-feedback-audio', { controls: true, preload: 'metadata', src: audioUrl }));
      if (link.type === 'assignment' && link.value) {
        feedbackPanel.appendChild(
          h('div.mt-1', h('a.btn.btn-primary.btn-sm', {
            href: `/a/${encodeURIComponent(String(link.value).trim().toUpperCase())}`,
            target: '_blank',
            rel: 'noopener',
          }, t('item.hotspot.open_link_assignment'))),
        );
      } else if (link.type === 'url' && link.value) {
        feedbackPanel.appendChild(
          h('div.mt-1', h('a.btn.btn-secondary.btn-sm', { href: String(link.value), target: '_blank', rel: 'noopener noreferrer' }, t('item.hotspot.open_link_url'))),
        );
      }
    }
  }

  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  root.appendChild(live);
  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    tapped.clear();
    const given = response && Array.isArray(response.tapped) ? response.tapped : [];
    for (const { zone, btn } of zoneButtons) {
      const on = given.includes(zone.id);
      if (on) tapped.add(zone.id);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-tapped', on);
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { tapped: [...tapped] };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, '.item-hotspot-zone:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
