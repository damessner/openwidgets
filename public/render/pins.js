// Pins item: place one marker per zone on an image.
//
// Interaction model (keyboard-first, pointer optional):
//  - click/tap the image places the currently selected zone marker,
//  - zone buttons select a zone; "Place" puts a marker at the center,
//  - arrow keys nudge the focused marker (Shift = 5 %, default 1 %),
//  - Delete/Backspace removes a marker.
// Canonical response: { points: { <zoneId>: {x, y} } } in normalized 0..1
// coordinates. Correct zone geometry is only known for raw teacher items; the
// student payload never contains it.
import { registerMessages, t } from '../lib/i18n.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { clamp } from '../../shared/util.js';
import {
  normalizeCtx,
  isReadOnly,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  fieldset,
  mediaUrl,
  roundCoord,
  createResultRegion,
  applyResult,
  solutionBlock,
  liveRegion,
  announce,
  focusRoot,
} from './_shared.js';

export const type = 'pins';
export const label = { en: 'Mark on image', de: 'Bild markieren' };

registerMessages({
  de: {
    'item.pins.legend': 'Markieren Sie die genannten Stellen im Bild.',
    'item.pins.zones_label': 'Markierungen:',
    'item.pins.instructions':
      'Klicken oder tippen Sie auf das Bild, um die ausgewählte Markierung zu setzen. Pfeiltasten verschieben eine Markierung (mit Umschalt 5 %), Entf entfernt sie.',
    'item.pins.default_zone': 'Markierung',
    'item.pins.image_alt': 'Bild für die Markierungsaufgabe',
    'item.pins.no_image': 'Für diese Aufgabe ist kein Bild hinterlegt.',
    'item.pins.place': 'Markierung für {zone} in der Mitte setzen',
    'item.pins.place_short': 'Setzen',
    'item.pins.remove': 'Markierung für {zone} entfernen',
    'item.pins.remove_short': 'Entfernen',
    'item.pins.state_unset': 'nicht gesetzt',
    'item.pins.state_set': 'gesetzt ({x} %, {y} %)',
    'item.pins.selected': '{zone} ausgewählt.',
    'item.pins.placed': '{zone} gesetzt bei {x} %, {y} %.',
    'item.pins.moved': '{zone} verschoben auf {x} %, {y} %.',
    'item.pins.removed': 'Markierung für {zone} entfernt.',
    'item.pins.pin_label': 'Markierung {zone} bei {x} % waagerecht, {y} % senkrecht',
    'item.pins.pin_hint': 'Pfeiltasten verschieben die Markierung, Entf entfernt sie.',
    'item.pins.canvas_label': 'Bild zum Markieren',
    'item.pins.empty': 'Für diese Aufgabe sind keine Markierungsbereiche hinterlegt.',
  },
  en: {
    'item.pins.legend': 'Mark the requested spots on the image.',
    'item.pins.zones_label': 'Markers:',
    'item.pins.instructions':
      'Click or tap the image to place the selected marker. Arrow keys move a marker (hold Shift for 5%), Delete removes it.',
    'item.pins.default_zone': 'Marker',
    'item.pins.image_alt': 'Image for the marking task',
    'item.pins.no_image': 'No image is configured for this item.',
    'item.pins.place': 'Place the marker for {zone} in the center',
    'item.pins.place_short': 'Place',
    'item.pins.remove': 'Remove the marker for {zone}',
    'item.pins.remove_short': 'Remove',
    'item.pins.state_unset': 'not placed',
    'item.pins.state_set': 'placed ({x}%, {y}%)',
    'item.pins.selected': '{zone} selected.',
    'item.pins.placed': '{zone} placed at {x}%, {y}%.',
    'item.pins.moved': '{zone} moved to {x}%, {y}%.',
    'item.pins.removed': 'Marker for {zone} removed.',
    'item.pins.pin_label': 'Marker {zone} at {x}% horizontal, {y}% vertical',
    'item.pins.pin_hint': 'Arrow keys move the marker, Delete removes it.',
    'item.pins.canvas_label': 'Image for marking',
    'item.pins.empty': 'No marking zones are configured for this item.',
  },
});

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const readonly = isReadOnly(ctx);
  const image = config.image && typeof config.image === 'object' ? config.image : {};
  const rawZones = Array.isArray(config.zones) ? config.zones : [];

  const zones = rawZones
    .filter((zone) => zone && typeof zone === 'object' && zone.id !== undefined && zone.id !== null)
    .map((zone, index) => ({
      key: String(zone.id),
      id: zone.id,
      label: String(zone.label || `${index + 1}`),
      rawX: numberOrNull(zone.x),
      rawY: numberOrNull(zone.y),
      rawR: numberOrNull(zone.r),
    }));
  if (!zones.length) {
    zones.push({ key: 'z1', id: 'z1', label: t('item.pins.default_zone'), rawX: null, rawY: null, rawR: null });
  }

  /** @type {Record<string, {x: number, y: number}>} */
  const points = {};
  let selectedZoneKey = zones[0].key;

  const root = itemRoot(type, ctx);
  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);
  const help = helpBlock(item);
  if (help) root.appendChild(help);
  const extraMedia = mediaBlock(item.media);
  if (extraMedia) root.appendChild(extraMedia);

  const field = fieldset(t('item.pins.legend'));
  if (!readonly) field.appendChild(h('p.item-hint', { text: t('item.pins.instructions') }));

  // --- zone selection / placement controls ---------------------------------
  const zoneList = h('div.item-pin-zones', { 'aria-label': t('item.pins.zones_label') });
  zoneList.appendChild(h('p.item-pin-zones-title', { text: t('item.pins.zones_label') }));
  /** @type {Map<string, {selectButton: HTMLElement, stateText: HTMLElement, placeButton: HTMLElement|null, removeButton: HTMLElement|null}>} */
  const zoneRows = new Map();

  for (const zone of zones) {
    const row = h('div.item-pin-zone-row');
    const stateText = h('span.item-pin-zone-state');
    const selectButton = h(readonly ? 'span.item-pin-zone' : 'button.item-pin-zone', {});
    if (!readonly) {
      selectButton.type = 'button';
      selectButton.setAttribute('aria-pressed', 'false');
      selectButton.addEventListener('click', () => selectZone(zone.key));
    }
    selectButton.appendChild(h('span.item-pin-zone-name', { text: zone.label }));
    selectButton.appendChild(stateText);
    row.appendChild(selectButton);

    let placeButton = null;
    let removeButton = null;
    if (!readonly) {
      const actions = h('div.item-pin-zone-actions');
      placeButton = h(
        'button.btn.btn-sm.btn-secondary.item-pin-place',
        {
          type: 'button',
          'aria-label': t('item.pins.place', { zone: zone.label }),
          'data-zone': zone.key,
        },
        h('span', { html: icon('plus', { size: 16 }) }),
        h('span', { text: t('item.pins.place_short') }),
      );
      removeButton = h(
        'button.btn.btn-sm.btn-ghost.item-pin-remove',
        {
          type: 'button',
          'aria-label': t('item.pins.remove', { zone: zone.label }),
          'data-zone': zone.key,
        },
        h('span', { html: icon('trash', { size: 16 }) }),
        h('span', { text: t('item.pins.remove_short') }),
      );
      placeButton.addEventListener('click', () => {
        const existing = points[zone.key];
        placePoint(zone.key, existing || { x: 0.5, y: 0.5 }, { focus: true });
      });
      removeButton.addEventListener('click', () => removePoint(zone.key));
      actions.appendChild(placeButton);
      actions.appendChild(removeButton);
      row.appendChild(actions);
    }

    zoneRows.set(zone.key, { selectButton, stateText, placeButton, removeButton });
    zoneList.appendChild(row);
  }
  field.appendChild(zoneList);

  // --- image canvas with pins ----------------------------------------------
  const canvas = h('div.item-pins-canvas', { 'aria-label': t('item.pins.canvas_label') });
  const placeholder = h(
    'div.item-pins-placeholder',
    h('span.item-pins-placeholder-icon', { html: icon('image', { size: 28 }) }),
    h('span', { text: image.alt || t('item.pins.no_image') }),
  );
  canvas.appendChild(placeholder);
  let img = null;
  const src = mediaUrl(image);
  if (src) {
    img = h('img.item-pins-img', {
      src,
      alt: image.alt || t('item.pins.image_alt'),
      loading: 'lazy',
      decoding: 'async',
    });
    img.addEventListener(
      'error',
      () => {
        img.hidden = true;
        canvas.classList.add('is-empty');
        placeholder.hidden = false;
      },
      { once: true },
    );
    canvas.appendChild(img);
  } else {
    canvas.classList.add('is-empty');
  }

  const live = liveRegion('item-pin-live');
  /** @type {Map<string, HTMLElement>} */
  const pinEls = new Map();

  function zoneByKey(key) {
    return zones.find((zone) => zone.key === key);
  }

  function mediaRect() {
    if (img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0) {
      return img.getBoundingClientRect();
    }
    return canvas.getBoundingClientRect();
  }

  function createPin(zone) {
    const position = zones.findIndex((entry) => entry.key === zone.key) + 1;
    const pin = document.createElement(readonly ? 'span' : 'button');
    pin.className = 'item-pin';
    pin.dataset.zone = zone.key;
    if (readonly) {
      pin.setAttribute('role', 'img');
    } else {
      pin.type = 'button';
    }
    pin.appendChild(h('span.item-pin-dot', { text: String(position) }));
    if (!readonly) {
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        selectZone(zone.key, { focusPin: true });
      });
      pin.addEventListener('keydown', (event) => onPinKeyDown(event, zone, pin));
    }
    return pin;
  }

  function positionPin(pin, zone) {
    const point = points[zone.key];
    if (!point) return;
    pin.style.left = `${(point.x * 100).toFixed(2)}%`;
    pin.style.top = `${(point.y * 100).toFixed(2)}%`;
    const label = t('item.pins.pin_label', {
      zone: zone.label,
      x: Math.round(point.x * 100),
      y: Math.round(point.y * 100),
    });
    if (!readonly) pin.setAttribute('aria-label', `${label}. ${t('item.pins.pin_hint')}`);
    else pin.setAttribute('aria-label', label);
  }

  function syncPins() {
    for (const zone of zones) {
      const point = points[zone.key];
      let pin = pinEls.get(zone.key);
      if (!point) {
        if (pin) {
          pin.remove();
          pinEls.delete(zone.key);
        }
        continue;
      }
      if (!pin) {
        pin = createPin(zone);
        pinEls.set(zone.key, pin);
        canvas.appendChild(pin);
      }
      pin.classList.toggle('is-selected', zone.key === selectedZoneKey);
      positionPin(pin, zone);
    }
  }

  function syncZoneState() {
    for (const zone of zones) {
      const row = zoneRows.get(zone.key);
      if (!row) continue;
      const point = points[zone.key];
      row.stateText.textContent = point
        ? t('item.pins.state_set', { x: Math.round(point.x * 100), y: Math.round(point.y * 100) })
        : t('item.pins.state_unset');
      row.selectButton.classList.toggle('is-active', zone.key === selectedZoneKey);
      row.selectButton.classList.toggle('has-point', Boolean(point));
      if (row.selectButton.setAttribute) {
        row.selectButton.setAttribute('aria-pressed', String(zone.key === selectedZoneKey));
      }
      if (row.placeButton) row.placeButton.hidden = Boolean(point);
      if (row.removeButton) row.removeButton.hidden = !point;
    }
  }

  function selectZone(key, { focusPin = false, silent = false } = {}) {
    selectedZoneKey = key;
    syncZoneState();
    syncPins();
    const zone = zoneByKey(key);
    if (zone && !silent) announce(live, t('item.pins.selected', { zone: zone.label }));
    if (focusPin) {
      const pin = pinEls.get(key);
      if (pin && !readonly) pin.focus();
    }
  }

  function placePoint(key, point, { focus = true } = {}) {
    if (readonly) return;
    points[key] = { x: roundCoord(point.x), y: roundCoord(point.y) };
    selectedZoneKey = key;
    syncPins();
    syncZoneState();
    const zone = zoneByKey(key);
    if (zone) {
      announce(
        live,
        t('item.pins.placed', {
          zone: zone.label,
          x: Math.round(points[key].x * 100),
          y: Math.round(points[key].y * 100),
        }),
      );
    }
    if (focus) {
      const pin = pinEls.get(key);
      if (pin) pin.focus();
    }
  }

  function removePoint(key) {
    if (readonly) return;
    delete points[key];
    const pin = pinEls.get(key);
    if (pin) {
      pin.remove();
      pinEls.delete(key);
    }
    syncZoneState();
    const zone = zoneByKey(key);
    if (zone) {
      announce(live, t('item.pins.removed', { zone: zone.label }));
      const row = zoneRows.get(key);
      if (row && row.placeButton) row.placeButton.focus();
    }
  }

  function onPinKeyDown(event, zone, pin) {
    if (readonly) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        removePoint(zone.key);
        return;
      default:
        return;
    }
    event.preventDefault();
    const current = points[zone.key] || { x: 0.5, y: 0.5 };
    points[zone.key] = {
      x: roundCoord(current.x + dx),
      y: roundCoord(current.y + dy),
    };
    selectedZoneKey = zone.key;
    positionPin(pin, zone);
    syncZoneState();
    announce(
      live,
      t('item.pins.moved', {
        zone: zone.label,
        x: Math.round(points[zone.key].x * 100),
        y: Math.round(points[zone.key].y * 100),
      }),
    );
  }

  canvas.addEventListener('click', (event) => {
    if (readonly) return;
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('.item-pin')) return;
    const rect = mediaRect();
    if (!rect.width || !rect.height) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    placePoint(selectedZoneKey, { x, y }, { focus: false });
  });

  field.appendChild(canvas);
  field.appendChild(live);
  root.appendChild(field);

  // Answer overlay. Geometry NEVER exists in the student payload: preview uses
  // the raw item, while review gets optional solution zones from the result
  // payload (`ctx.reviewZones`, shape of shared items' `answerZones`).
  const rawTargets = zones
    .filter((zone) => zone.rawX !== null && zone.rawY !== null)
    .map((zone) => ({
      id: zone.id,
      label: zone.label,
      x: zone.rawX,
      y: zone.rawY,
      r: zone.rawR,
    }));
  let overlayZones = [];
  if (ctx.mode === 'review') {
    overlayZones =
      Array.isArray(ctx.reviewZones) && ctx.reviewZones.length
        ? ctx.reviewZones
        : ctx.showAnswers
          ? rawTargets
          : [];
  } else if (ctx.mode === 'preview' && ctx.showAnswers) {
    overlayZones = rawTargets;
  }
  for (const target of overlayZones) {
    const x = Number(target && target.x);
    const y = Number(target && target.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const radius =
      Number.isFinite(Number(target.r)) && Number(target.r) > 0 ? Number(target.r) : 0.05;
    canvas.appendChild(
      h('span.item-pin-target', {
        'aria-hidden': 'true',
        dataset: { zone: String(target.id === undefined ? '' : target.id) },
        style: {
          left: `${(x - radius) * 100}%`,
          top: `${(y - radius) * 100}%`,
          width: `${2 * radius * 100}%`,
          height: `${2 * radius * 100}%`,
        },
      }),
    );
  }

  const resultRegion = createResultRegion();
  root.appendChild(resultRegion);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);

  const keyBlock = solutionBlock(item, ctx);
  if (keyBlock) root.appendChild(keyBlock);

  function normalizePoint(point) {
    if (!point || typeof point !== 'object') return null;
    const x = numberOrNull(point.x);
    const y = numberOrNull(point.y);
    if (x === null || y === null) return null;
    return { x: roundCoord(x), y: roundCoord(y) };
  }

  function setResponse(response) {
    for (const key of Object.keys(points)) delete points[key];
    const raw =
      response && response.points && typeof response.points === 'object' ? response.points : {};
    for (const zone of zones) {
      const point = normalizePoint(raw[zone.key]);
      if (point) points[zone.key] = point;
    }
    syncPins();
    syncZoneState();
  }

  // initial state
  setResponse(ctx.response);
  if (ctx.result) applyResult(root, resultRegion, ctx.result);
  container.replaceChildren(root);

  return {
    getResponse() {
      const out = {};
      for (const zone of zones) {
        const point = points[zone.key];
        if (point) out[zone.key] = { x: roundCoord(point.x), y: roundCoord(point.y) };
      }
      return { points: out };
    },
    setResponse,
    setResult(result) {
      applyResult(root, resultRegion, result);
    },
    focus() {
      if (readonly) {
        focusRoot(root);
        return;
      }
      const firstZone = root.querySelector('.item-pin-zone');
      if (firstZone) firstZone.focus();
      else focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
