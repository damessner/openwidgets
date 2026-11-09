// Bridge to the shared renderer modules in /render/. The renderer bundle is
// owned by another builder; import it lazily and fall back to a plain static
// rendering (stem text + optional answer key) if it is not available yet.
import { h, clear, renderRichText } from '/lib/dom.js';
import { t } from '/lib/i18n.js';
import { describeCorrect } from './items.js';

let renderPromise = null;
let renderModule = null;

export function loadRenderModule() {
  if (!renderPromise) {
    renderPromise = import('/render/index.js')
      .then((mod) => {
        renderModule = mod || null;
        return renderModule;
      })
      .catch(() => {
        renderModule = null;
        return null;
      });
  }
  return renderPromise;
}

export function getRenderModule() {
  return renderModule;
}

function fallbackRender(container, ctx) {
  clear(container);
  const item = ctx.item || {};
  const wrap = h('div.fallback-render');
  if (item.stem) {
    const stem = h('div.fallback-stem.rt');
    renderRichText(stem, item.stem);
    wrap.appendChild(stem);
  }
  if (item.type === 'text' && item.config && item.config.text) {
    const body = h('div.rt');
    renderRichText(body, item.config.text);
    wrap.appendChild(body);
  } else if (ctx.mode === 'review') {
    wrap.appendChild(h('p.small.muted', t('teacher.renderer_missing_review')));
    if (ctx.response) {
      const pretty = typeof ctx.response === 'string' ? ctx.response : JSON.stringify(ctx.response);
      wrap.appendChild(h('pre.response-json', pretty));
    }
  } else {
    wrap.appendChild(h('p.small.muted', t('teacher.renderer_missing')));
  }
  const answers = describeCorrect(item);
  if (answers.length && (ctx.showAnswers || ctx.mode === 'review')) {
    wrap.appendChild(answerKeyBlock(item, answers));
  }
  container.appendChild(wrap);
  return {
    getResponse: () => (ctx.response ? { ...ctx.response } : null),
    setResponse: () => {},
    setResult: () => {},
    focus: () => {},
    destroy: () => clear(container),
  };
}

export function answerKeyBlock(item, lines) {
  const answers = lines || describeCorrect(item);
  return h(
    'div.answer-key',
    h('div.answer-key-title', t(answers.length === 1 ? 'teacher.answer' : 'teacher.answers')),
    h('ul.answer-key-list', answers.map((line) => h('li', line))),
  );
}

/**
 * Mount an item renderer safely.
 * ctx = { item, response?, result?, mode, locale, seed?, disabled?, showAnswers? }
 * Returns a renderer instance ({getResponse,setResponse,setResult,focus,destroy})
 * or a no-op instance when the shared renderer is unavailable.
 */
export async function mountItemSafe(container, ctx) {
  await loadRenderModule();
  const module = renderModule;
  if (module && typeof module.mountItem === 'function') {
    try {
      const instance = module.mountItem(container, ctx);
      if (instance && typeof instance === 'object') return instance;
    } catch (error) {
      // A single broken renderer must not take the whole page down.
      if (typeof console !== 'undefined') console.error('renderer failed', error);
    }
  }
  return fallbackRender(container, ctx);
}
