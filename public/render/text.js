// Text block item ("Textblock"): non-scoreable content, no response.
import { registerMessages } from '../lib/i18n.js';
import { h, renderRichText } from '../lib/dom.js';
import {
  normalizeCtx,
  itemRoot,
  stemBlock,
  helpBlock,
  mediaBlock,
  notice,
  focusRoot,
} from './_shared.js';

export const type = 'text';
export const label = { en: 'Text block', de: 'Textblock' };

registerMessages({
  de: {
    'item.text.empty': 'Dieser Textblock ist leer.',
  },
  en: {
    'item.text.empty': 'This text block is empty.',
  },
});

export function mount(container, rawCtx) {
  const ctx = normalizeCtx(rawCtx);
  const item = ctx.item;
  const config = item.config && typeof item.config === 'object' ? item.config : {};
  const root = itemRoot(type, ctx);

  const stem = stemBlock(item);
  if (stem) root.appendChild(stem);

  const bodyText = String(config.text || '');
  if (bodyText.trim()) {
    const body = h('div.item-text-content');
    renderRichText(body, bodyText);
    root.appendChild(body);
  }

  const help = helpBlock(item);
  if (help) root.appendChild(help);

  const media = mediaBlock(item.media);
  if (media) root.appendChild(media);

  if (!root.childNodes.length) root.appendChild(notice(t('item.text.empty'), 'info'));

  container.replaceChildren(root);

  return {
    getResponse() {
      return {};
    },
    setResponse() {
      /* text blocks have no response */
    },
    setResult() {
      /* not scoreable */
    },
    focus() {
      focusRoot(root);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
