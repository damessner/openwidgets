// Groups item: drag item chips into the correct zone (drag & drop), with a
// <select> per chip as keyboard/screen-reader fallback. Items can be text,
// image or audio. Student payload has no zoneId on items (that is the key).
import { registerMessages, t } from '../lib/i18n.js';
import { h, clear } from '../lib/dom.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  notice,
  shuffled,
  createResultRegion,
  applyResult,
  solutionBlock,
  focusFirst,
  focusRoot,
} from './_shared.js';

export const type = 'groups';
export const label = { en: 'Group into zones (drag & drop)', de: 'In Zonen gruppieren (Drag & Drop)' };

registerMessages({
  de: {
    'item.groups.legend': 'Ziehe jedes Element in die passende Zone — oder wähle die Zone über das Auswahlfeld.',
    'item.groups.empty': 'Für diese Aufgabe sind keine Elemente hinterlegt.',
    'item.groups.zone': 'Zone {n}',
    'item.groups.unassigned': 'Nicht zugeordnete Elemente',
    'item.groups.choose_zone': 'Zone wählen …',
    'item.groups.item_label': 'Element: {label}',
    'item.groups.drop_here': 'Hierher ziehen',
    'item.groups.placed_in': 'Zugewiesen: {zone}',
    'item.groups.image': '[Bild]',
    'item.groups.audio': '[Audio]',
  },
  en: {
    'item.groups.legend': 'Drag each item into the correct zone — or pick the zone from the dropdown.',
    'item.groups.empty': 'No items are configured for this item.',
    'item.groups.zone': 'Zone {n}',
    'item.groups.unassigned': 'Unassigned items',
    'item.groups.choose_zone': 'Choose zone …',
    'item.groups.item_label': 'Item: {label}',
    'item.groups.drop_here': 'Drop here',
    'item.groups.placed_in': 'Assigned: {zone}',
    'item.groups.image': '[image]',
    'item.groups.audio': '[audio]',
  },
});

function asSide(raw) {
  if (typeof raw === 'string') return { kind: 'text', text: raw };
  if (!raw || typeof raw !== 'object') return { kind: 'text', text: '' };
  const kind = raw.kind === 'image' || raw.kind === 'audio' ? raw.kind : 'text';
  if (kind === 'text') return { kind, text: String(raw.text ?? '') };
  return { kind, assetId: raw.assetId, url: raw.url, alt: raw.alt };
}

function sideUrl(side) {
  if (typeof side.url === 'string' && side.url) return side.url;
  if (side.assetId) {
    const id = encodeURIComponent(String(side.assetId));
    return `/assets/${id}/${id}`;
  }
  return null;
}

function sideLabel(side, index) {
  if (!side) return '';
  if (side.kind === 'image') return side.alt || `${t('item.groups.image')} ${index + 1}`;
  if (side.kind === 'audio') return `${t('item.groups.audio')} ${index + 1}`;
  return side.text || '';
}

function sideNode(side, index) {
  if (!side) return h('span', { text: '' });
  if (side.kind === 'image') {
    const url = sideUrl(side);
    if (!url) return h('span', { text: t('item.groups.image') });
    return h('img.item-groups-img', { src: url, alt: String(side.alt || sideLabel(side, index)), loading: 'lazy' });
  }
  if (side.kind === 'audio') {
    const url = sideUrl(side);
    if (!url) return h('span', { text: t('item.groups.audio') });
    return h('audio.item-groups-audio', { controls: true, preload: 'metadata', src: url });
  }
  return h('span', { text: side.text || '' });
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const zones = Array.isArray(config.zones) ? config.zones.filter((z) => z && z.id != null) : [];
  let items = Array.isArray(config.items) ? config.items.filter((i) => i && i.id != null) : [];
  if (ctx.mode === 'student' && config.shuffle !== false) items = shuffled(items, ctx, 'groups-items');

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);

  if (zones.length === 0 || items.length === 0) {
    root.appendChild(notice(t('item.groups.empty'), 'warning'));
    container.replaceChildren(root);
    return {
      getResponse() { return { placement: {} }; },
      setResponse() {},
      setResult() {},
      focus() { focusRoot(root); },
      destroy() { container.replaceChildren(); },
    };
  }

  const legend = h('fieldset.item-fieldset');
  legend.appendChild(h('legend.item-legend.sr-only', { text: t('item.groups.legend') }));

  const placement = {}; // itemId -> zoneId
  const selects = []; // { itemId, select }
  const chips = new Map(); // itemId -> chip element

  const tray = h('div.item-groups-tray');
  tray.appendChild(h('div.item-groups-tray-title.small.muted', { text: t('item.groups.unassigned') }));
  const trayList = h('div.item-groups-chips');
  tray.appendChild(trayList);

  const zonesWrap = h('div.item-groups-zones');
  const zoneBodies = new Map();

  function placeChip(itemId, zoneId) {
    placement[itemId] = zoneId;
    const chip = chips.get(itemId);
    const select = selects.find((s) => s.itemId === itemId);
    if (select) select.select.value = zoneId;
    const body = zoneBodies.get(zoneId);
    if (chip && body) {
      body.appendChild(chip);
      chip.classList.add('is-placed');
    }
    const zone = zones.find((z) => z.id === zoneId);
    if (chip) chip.setAttribute('aria-label', `${t('item.groups.item_label', { label: sideLabel(asSide(items.find((i) => i.id === itemId).side), 0) })} — ${t('item.groups.placed_in', { zone: zone ? zone.label || zone.id : zoneId })}`);
  }

  items.forEach((entry, index) => {
    const side = asSide(entry.side);
    const chip = h('div.item-groups-chip', {
      draggable: readonly ? 'false' : 'true',
      dataset: { itemId: String(entry.id) },
      tabindex: readonly ? '-1' : '0',
      role: 'button',
      'aria-label': t('item.groups.item_label', { label: sideLabel(side, index) || `#${index + 1}` }),
    });
    chip.appendChild(sideNode(side, index));
    const select = h('select.select.select-sm.item-groups-select', { 'aria-label': t('item.groups.item_label', { label: sideLabel(side, index) || `#${index + 1}` }) });
    select.appendChild(h('option', { value: '' }, t('item.groups.choose_zone')));
    for (const zone of zones) {
      select.appendChild(h('option', { value: String(zone.id), text: zone.label || t('item.groups.zone', { n: zones.indexOf(zone) + 1 }) }));
    }
    if (readonly) select.disabled = true;
    select.addEventListener('change', () => {
      if (select.value) placeChip(entry.id, select.value);
      else {
        delete placement[entry.id];
        trayList.appendChild(chip);
        chip.classList.remove('is-placed');
      }
    });
    chip.appendChild(select);
    selects.push({ itemId: entry.id, select });
    chips.set(entry.id, chip);

    if (!readonly) {
      chip.addEventListener('dragstart', (event) => {
        if (event.dataTransfer) {
          event.dataTransfer.setData('text/plain', String(entry.id));
          event.dataTransfer.effectAllowed = 'move';
        }
        chip.classList.add('is-dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('is-dragging'));
      chip.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select.focus();
        }
      });
    }
    trayList.appendChild(chip);
  });

  zones.forEach((zone, index) => {
    const body = h('div.item-groups-zone-body');
    const zoneEl = h('div.item-groups-zone',
      h('div.item-groups-zone-title.strong', { text: zone.label || t('item.groups.zone', { n: index + 1 }) }),
      body,
    );
    zoneEl.dataset.zoneId = String(zone.id);
    if (!readonly) {
      zoneEl.addEventListener('dragover', (event) => {
        event.preventDefault();
        zoneEl.classList.add('is-over');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('is-over'));
      zoneEl.addEventListener('drop', (event) => {
        event.preventDefault();
        zoneEl.classList.remove('is-over');
        const itemId = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
        if (itemId && chips.has(itemId)) placeChip(itemId, zone.id);
      });
    }
    zoneBodies.set(zone.id, body);
    zonesWrap.appendChild(zoneEl);
  });

  legend.appendChild(h('div.item-groups-board', tray, zonesWrap));
  root.appendChild(legend);

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function setResponse(response) {
    const given = response && response.placement && typeof response.placement === 'object' ? response.placement : {};
    for (const key of Object.keys(placement)) delete placement[key];
    for (const [itemId, zoneId] of Object.entries(given)) {
      if (chips.has(itemId) && zoneBodies.has(zoneId)) placeChip(itemId, zoneId);
    }
    // unplaced chips go back to the tray
    for (const [itemId, chip] of chips) {
      if (!placement[itemId]) {
        trayList.appendChild(chip);
        chip.classList.remove('is-placed');
        const entry = items.find((i) => i.id === itemId);
        const sel = selects.find((s) => s.itemId === itemId);
        if (sel) sel.select.value = '';
        if (chip && entry) chip.setAttribute('aria-label', t('item.groups.item_label', { label: sideLabel(asSide(entry.side), 0) }));
      }
    }
  }

  setResponse(ctx.response);
  container.replaceChildren(root);

  return {
    getResponse() {
      return { placement: { ...placement } };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (!focusFirst(root, 'select:enabled')) focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
