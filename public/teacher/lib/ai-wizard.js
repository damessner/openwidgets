// AI worksheet wizard: teacher describes topic + length + type mix, the
// server calls the configured LLM and creates a draft activity that opens
// in the editor for review.
import { h, modal, toast } from '/lib/dom.js';
import { post, errorMessage } from '/lib/api.js';
import { t } from '/lib/i18n.js';
import { navigate } from './core.js';

function radioGroup(name, options, defaultValue) {
  const wrap = h('div.row.wrap.gap-2');
  for (const opt of options) {
    const input = h('input', { type: 'radio', name, value: opt.value, id: `${name}-${opt.value}` });
    if (opt.value === defaultValue) input.checked = true;
    wrap.appendChild(h('label.radio-pill', { for: `${name}-${opt.value}` }, input, h('span', { text: opt.label })));
  }
  return wrap;
}

/**
 * Open the AI wizard modal. Resolves with the created activity or null.
 * @param {{onCreated?: (activity: object) => void}} options
 */
export function openAiWizard({ onCreated } = {}) {
  return new Promise((resolve) => {
    const topicInput = h('textarea.input', { rows: 3, maxlength: 300, placeholder: t('teacher.ai_topic_placeholder') });
    const subjectInput = h('input.input', { type: 'text', maxlength: 120 });
    const gradeInput = h('input.input', { type: 'text', maxlength: 120 });
    const titleInput = h('input.input', { type: 'text', maxlength: 200 });
    const templateSelect = h(
      'select.select',
      h('option', { value: 'worksheet', selected: true }, t('teacher.template_worksheet')),
      h('option', { value: 'quiz' }, t('teacher.template_quiz')),
    );
    const localeSelect = h(
      'select.select',
      h('option', { value: 'de', selected: true }, 'Deutsch'),
      h('option', { value: 'en' }, 'English'),
    );
    const lengthGroup = radioGroup('ai-length', [
      { value: 'short', label: t('teacher.ai_length_short') },
      { value: 'medium', label: t('teacher.ai_length_medium') },
      { value: 'long', label: t('teacher.ai_length_long') },
    ], 'medium');
    const mixGroup = radioGroup('ai-mix', [
      { value: 'simple', label: t('teacher.ai_mix_simple') },
      { value: 'normal', label: t('teacher.ai_mix_normal') },
      { value: 'diverse', label: t('teacher.ai_mix_diverse') },
    ], 'normal');

    const errorBox = h('p.error-text', { role: 'alert', hidden: true });
    const cancelButton = h('button.btn.btn-secondary', { type: 'button' }, t('common.cancel'));
    const generateButton = h('button.btn.btn-primary', { type: 'submit' }, t('teacher.ai_generate'));

    const form = h(
      'form.ai-wizard',
      h('div.field', h('label.label', { for: 'ai-topic' }, t('teacher.ai_topic')), topicInput, h('p.help', t('teacher.ai_topic_help'))),
      h('div.row.gap-2.wrap',
        h('div.field', h('label.label', { for: 'ai-subject' }, t('teacher.ai_subject')), subjectInput),
        h('div.field', h('label.label', { for: 'ai-grade' }, t('teacher.ai_grade')), gradeInput),
      ),
      h('div.field', h('label.label', { for: 'ai-title' }, t('common.title_optional')), titleInput),
      h('div.row.gap-2.wrap',
        h('div.field', h('label.label', { for: 'ai-template' }, t('teacher.template')), templateSelect),
        h('div.field', h('label.label', { for: 'ai-locale' }, t('teacher.ai_locale')), localeSelect),
      ),
      h('div.field', h('label.label', t('teacher.ai_length')), lengthGroup, h('p.help', t('teacher.ai_length_help'))),
      h('div.field', h('label.label', t('teacher.ai_mix')), mixGroup, h('p.help', t('teacher.ai_mix_help'))),
      errorBox,
      h('div.row.end.gap-2', cancelButton, generateButton),
    );
    topicInput.id = 'ai-topic';
    subjectInput.id = 'ai-subject';
    gradeInput.id = 'ai-grade';
    titleInput.id = 'ai-title';

    const dialog = modal({ title: t('teacher.ai_wizard_title'), body: form, actions: [] });
    const close = (result) => {
      dialog.close();
      resolve(result || null);
    };
    cancelButton.addEventListener('click', () => close(null));
    dialog.dialog.addEventListener('close', () => resolve(null));

    const chosen = (name) => {
      const el = form.querySelector(`input[name="${name}"]:checked`);
      return el ? el.value : null;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const topic = topicInput.value.trim();
      if (topic.length < 3) {
        errorBox.textContent = t('teacher.ai_topic_required');
        errorBox.hidden = false;
        topicInput.focus();
        return;
      }
      generateButton.disabled = true;
      generateButton.textContent = t('teacher.ai_generating');
      errorBox.hidden = true;
      try {
        const data = await post('/api/llm/generate-worksheet', {
          topic,
          subject: subjectInput.value.trim(),
          grade: gradeInput.value.trim(),
          title: titleInput.value.trim(),
          template: templateSelect.value,
          locale: localeSelect.value,
          length: chosen('ai-length') || 'medium',
          mix: chosen('ai-mix') || 'normal',
        });
        const activity = data && data.activity;
        if (activity && activity.id) {
          toast(t('teacher.ai_created', { count: activity.itemCount || 0 }), 'success');
          if (typeof onCreated === 'function') onCreated(activity);
          close(activity);
          navigate(`/teacher/edit?id=${encodeURIComponent(activity.id)}`);
        } else {
          close(null);
        }
      } catch (error) {
        errorBox.textContent = errorMessage(error);
        errorBox.hidden = false;
        generateButton.disabled = false;
        generateButton.textContent = t('teacher.ai_generate');
      }
    });

    topicInput.focus();
  });
}
