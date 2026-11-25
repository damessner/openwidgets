// Standalone full-page worksheet preview (opened in a new tab from the
// editor). Mounts every item with the real student renderers and can score
// the answers locally. Teacher session required (activity API).
import { registerMessages, initLocale, applyI18n, t } from '/lib/i18n.js';
import { h, clear, toast } from '/lib/dom.js';
import { get, errorMessage } from '/lib/api.js';
import { icon } from '/lib/icons.js';

registerMessages({
  de: {
    'preview.title': 'Vorschau',
    'preview.evaluate': 'Antworten auswerten',
    'preview.score': '{score} / {max} Punkte (lokale Vorschau)',
    'preview.empty': 'Noch keine Aufgaben im Arbeitsblatt.',
    'preview.load_failed': 'Das Arbeitsblatt konnte nicht geladen werden.',
    'preview.login_hint': 'Bitte zuerst als Lehrkraft anmelden.',
    'preview.items': '{count} Aufgaben',
  },
  en: {
    'preview.title': 'Preview',
    'preview.evaluate': 'Evaluate answers',
    'preview.score': '{score} / {max} points (local preview)',
    'preview.empty': 'No tasks in this worksheet yet.',
    'preview.load_failed': 'The worksheet could not be loaded.',
    'preview.login_hint': 'Please sign in as a teacher first.',
    'preview.items': '{count} tasks',
  },
});
initLocale();

const view = document.getElementById('view');
const actions = document.getElementById('preview-actions');

function assetUrlFor(assetId) {
  if (!assetId) return '';
  return `/assets/${encodeURIComponent(String(assetId))}/${encodeURIComponent(String(assetId))}`;
}

/** Fill in url for media-ish spots that only carry an assetId (teacher payload). */
function enrichAssets(item) {
  const config = item.config || {};
  if (item.media && item.media.assetId && !item.media.url) item.media.url = assetUrlFor(item.media.assetId);
  if (config.image && config.image.assetId && !config.image.url) config.image.url = assetUrlFor(config.image.assetId);
  if (Array.isArray(config.pairs)) {
    for (const pair of config.pairs) {
      for (const side of [pair.left, pair.right]) {
        if (side && typeof side === 'object' && (side.kind === 'image' || side.kind === 'audio') && side.assetId && !side.url) {
          side.url = assetUrlFor(side.assetId);
        }
      }
    }
  }
  if (Array.isArray(config.lefts)) {
    for (const entry of config.lefts) {
      if (entry && (entry.kind === 'image' || entry.kind === 'audio') && entry.assetId && !entry.url) entry.url = assetUrlFor(entry.assetId);
    }
  }
  if (Array.isArray(config.rights)) {
    for (const entry of config.rights) {
      if (entry && (entry.kind === 'image' || entry.kind === 'audio') && entry.assetId && !entry.url) entry.url = assetUrlFor(entry.assetId);
    }
  }
  return item;
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const activityId = params.get('activity') || params.get('id') || '';
  if (!activityId) {
    clear(view);
    view.appendChild(h('div.card.error-card', h('p', t('preview.load_failed'))));
    return;
  }

  let data;
  try {
    data = await get(`/api/activities/${encodeURIComponent(activityId)}`);
  } catch (error) {
    clear(view);
    view.appendChild(
      h('div.card.error-card',
        h('p', t('preview.load_failed')),
        h('p.small.muted', errorMessage(error)),
        error && error.status === 401 ? h('p', h('a.btn.btn-primary', { href: '/login' }, t('preview.login_hint'))) : null,
      ),
    );
    return;
  }

  const activity = data.activity || {};
  const definition = activity.definition || {};
  document.title = `${t('preview.title')}: ${definition.title || activity.title || ''}`;

  const items = (definition.items || []).map(enrichAssets);
  const instances = [];

  clear(view);
  const head = h('div.row.between.wrap.gap-2.mb-3',
    h('div',
      h('h1.page-title', `${t('preview.title')}: ${definition.title || ''}`),
      h('p.muted.mb-0', t('preview.items', { count: items.length })),
    ),
  );
  view.appendChild(head);

  const evaluateButton = h('button.btn.btn-primary.btn-sm', { type: 'button' },
    h('span', { html: icon('check', { size: 16 }) }), ' ', t('preview.evaluate'));
  const scoreOut = h('span.small.muted.ml-2');
  head.appendChild(h('div.row.gap-2', evaluateButton, scoreOut));

  if (!items.length) {
    view.appendChild(h('div.card', h('p.help', t('preview.empty'))));
    return;
  }

  const renderModule = await import('/render/index.js');
  const { scoreItem } = await import('/shared/items/index.js');

  for (const item of items) {
    const card = h('div.card.preview-item');
    const mountEl = h('div');
    card.appendChild(mountEl);
    view.appendChild(card);
    const instance = renderModule.mountItem(mountEl, {
      item: JSON.parse(JSON.stringify(item)),
      mode: 'preview',
      locale: definition.locale || 'de',
      seed: 1234,
      showAnswers: true,
      response: {},
    });
    instances.push({ item, instance });
  }

  evaluateButton.addEventListener('click', () => {
    let score = 0;
    let max = 0;
    for (const { item, instance } of instances) {
      let response = {};
      try {
        response = instance && typeof instance.getResponse === 'function' ? instance.getResponse() : {};
      } catch { response = {}; }
      const result = scoreItem(item, response || {});
      if (instance && typeof instance.setResult === 'function') instance.setResult(result);
      score += Number(result.autoScore) || 0;
      max += Number(result.maxScore) || 0;
    }
    scoreOut.textContent = t('preview.score', { score, max });
    toast(t('preview.score', { score, max }), 'success');
  });

  applyI18n();
}

main();
