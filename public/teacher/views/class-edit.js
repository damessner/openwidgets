// Teacher view: edit one class — settings (name/order mode/unlock threshold),
// ordered assignment items, publish (join code + link).
import { get, post, put, del, errorMessage } from '/lib/api.js';
import { h, qs, clear, toast, copyText } from '/lib/dom.js';
import { t } from '/lib/i18n.js';
import { icon } from '/lib/icons.js';
import { navigate, statusBadge, templateLabel } from '../lib/core.js';
import { openCredentialsDialog, printRosterSheet } from '../lib/dialogs.js';
import { qrSvg } from '/lib/qr.js';

function classUrl(code) {
  return `${window.location.origin}/c/${encodeURIComponent(String(code || '').toUpperCase())}`;
}

export async function mount(root, ctx) {
  let disposed = false;
  const classId = ctx.params.get('id');
  if (!classId) {
    navigate('/teacher/classes', { replace: true });
    return;
  }

  const wrapper = h('div.class-edit-view');
  clear(root);
  root.appendChild(wrapper);
  const host = h('div');
  wrapper.appendChild(host);

  let cls = null;
  let assignments = [];
  let roster = [];
  // Local working copy of ordered items with their course (persisted via PUT items).
  let itemEntries = []; // [{ assignmentId, courseId }]
  let courses = []; // [{ id, title, description, position, itemCount }]

  ctx.onLocaleChange(() => { if (!disposed) renderAll(); });

  async function load() {
    const [classData, assignmentsData, rosterData] = await Promise.all([
      get(`/api/classes/${encodeURIComponent(classId)}`, { signal: ctx.signal }),
      get('/api/assignments', { signal: ctx.signal }),
      get(`/api/classes/${encodeURIComponent(classId)}/students`, { signal: ctx.signal }).catch(() => ({ students: [] })),
    ]);
    if (disposed) return;
    cls = classData.class;
    assignments = Array.isArray(assignmentsData.assignments) ? assignmentsData.assignments : [];
    roster = Array.isArray(rosterData.students) ? rosterData.students : [];
    itemEntries = (cls.items || []).map((item) => ({ assignmentId: item.assignmentId, courseId: item.courseId || null, bonus: !!item.bonus }));
    courses = Array.isArray(cls.courses) ? cls.courses : [];
    statsCache = null; // item list may have changed — refetch stats on next render
    ctx.setTitle(cls.name || t('teacher.edit_class'));
    renderAll();
  }

  async function saveSettings() {
    const name = qs('#class-name', host)?.value.trim();
    const description = qs('#class-description', host)?.value.trim() ?? '';
    const percent = Number(qs('#class-percent', host)?.value) || 0;
    const orderMode = host.querySelector('.segmented button.is-active')?.dataset.mode || 'free';
    try {
      const data = await put(`/api/classes/${encodeURIComponent(classId)}`, { name, description, orderMode, unlockMinPercent: percent });
      cls = data.class;
      itemEntries = (cls.items || []).map((item) => ({ assignmentId: item.assignmentId, courseId: item.courseId || null, bonus: !!item.bonus }));
      courses = Array.isArray(cls.courses) ? cls.courses : [];
      toast(t('teacher.class_saved'), 'success');
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function saveItems() {
    try {
      const data = await put(`/api/classes/${encodeURIComponent(classId)}/items`, {
        items: itemEntries.map((entry) => ({ assignmentId: entry.assignmentId, courseId: entry.courseId, bonus: entry.bonus === true })),
      });
      cls = data.class;
      itemEntries = (cls.items || []).map((item) => ({ assignmentId: item.assignmentId, courseId: item.courseId || null, bonus: !!item.bonus }));
      courses = Array.isArray(cls.courses) ? cls.courses : [];
      statsCache = null; // item list changed — refetch stats on next render
      toast(t('teacher.items_saved'), 'success');
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function move(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= itemEntries.length) return;
    const copy = [...itemEntries];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    itemEntries = copy;
    saveItems();
  }

  async function publish() {
    try {
      await post(`/api/classes/${encodeURIComponent(classId)}/publish`);
      toast(t('teacher.class_published'), 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function unpublish() {
    try {
      await post(`/api/classes/${encodeURIComponent(classId)}/unpublish`);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function removeItem(assignmentId) {
    itemEntries = itemEntries.filter((entry) => entry.assignmentId !== assignmentId);
    await saveItems();
  }

  // -------------------------------------------------------------------------
  // Courses within the class
  // -------------------------------------------------------------------------

  async function reloadClass() {
    const data = await get(`/api/classes/${encodeURIComponent(classId)}`, { signal: ctx.signal });
    if (disposed) return;
    cls = data.class;
    itemEntries = (cls.items || []).map((item) => ({ assignmentId: item.assignmentId, courseId: item.courseId || null, bonus: !!item.bonus }));
    courses = Array.isArray(cls.courses) ? cls.courses : [];
    statsCache = null;
  }

  async function addCourse(title) {
    try {
      await post(`/api/classes/${encodeURIComponent(classId)}/courses`, { title });
      await reloadClass();
      toast(t('teacher.course_added'), 'success');
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function renameCourse(course, title) {
    try {
      await put(`/api/classes/${encodeURIComponent(classId)}/courses/${encodeURIComponent(course.id)}`, { title });
      await reloadClass();
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function deleteCourse(course) {
    try {
      await del(`/api/classes/${encodeURIComponent(classId)}/courses/${encodeURIComponent(course.id)}`);
      await reloadClass();
      toast(t('teacher.course_deleted'), 'success');
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function moveCourse(course, delta) {
    const index = courses.findIndex((c) => c.id === course.id);
    const next = index + delta;
    if (next < 0 || next >= courses.length) return;
    try {
      await put(`/api/classes/${encodeURIComponent(classId)}/courses/${encodeURIComponent(course.id)}`, { position: next + 1 });
      await reloadClass();
      renderAll();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function setItemCourse(assignmentId, courseId) {
    itemEntries = itemEntries.map((entry) =>
      entry.assignmentId === assignmentId ? { ...entry, courseId: courseId || null } : entry,
    );
    saveItems();
  }

  function setItemBonus(assignmentId, bonus) {
    itemEntries = itemEntries.map((entry) =>
      entry.assignmentId === assignmentId ? { ...entry, bonus } : entry,
    );
    saveItems();
  }

  function renderAll() {
    if (!cls) return;
    clear(host);
    host.appendChild(
      h('div.row.gap-2.mb-4',
        h('a.btn.btn-ghost.btn-sm', { href: '/teacher/classes' }, h('span', { html: icon('arrow-left', { size: 16 }) }), ' ', t('teacher.back_to_classes')),
        h('h1.page-title.grow', { text: cls.name }),
        statusBadge(cls.status, t(cls.status === 'published' ? 'teacher.class_status_published' : 'teacher.class_status_draft')),
        cls.status === 'published'
          ? h('button.btn.btn-sm.btn-ghost', { type: 'button', on: { click: unpublish } }, t('teacher.unpublish_class'))
          : h('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: publish } }, t('teacher.publish_class')),
      ),
    );

    if (cls.status === 'published' && cls.code) {
      const url = classUrl(cls.code);
      host.appendChild(
        h('div.card.compact.mb-4',
          h('div.row.between.wrap.gap-3',
            h('div',
              h('div.strong', t('teacher.class_join_link')),
              h('div.row.gap-2.mt-1',
                h('span.code-chip', h('span.mono', { text: cls.code })),
                h('a.mono.small', { href: url, target: '_blank', rel: 'noopener', text: url }),
              ),
            ),
            h('div.qr-wrap', qrSvg(url, { size: 116, title: url })),
            h('button.btn.btn-secondary.btn-sm', { type: 'button', on: { click: async () => {
              const ok = await copyText(url);
              toast(ok ? t('common.copied') : t('teacher.copy_manual'), ok ? 'success' : 'warning');
            } } }, h('span', { html: icon('copy', { size: 15 }) }), ' ', t('teacher.copy_link')),
          ),
        ),
      );
    }

    // --- settings card ------------------------------------------------------
    let orderMode = cls.orderMode || 'free';
    const segmented = h('div.segmented', { role: 'group', 'aria-label': t('teacher.class_order_mode') });
    const freeBtn = h('button', { type: 'button', 'data-mode': 'free' }, t('teacher.order_free'));
    const seqBtn = h('button', { type: 'button', 'data-mode': 'sequence' }, t('teacher.order_sequence'));
    const help = h('p.help', { text: t(orderMode === 'sequence' ? 'teacher.order_sequence_help' : 'teacher.order_free_help') });
    const syncSegmented = () => {
      freeBtn.classList.toggle('is-active', orderMode === 'free');
      seqBtn.classList.toggle('is-active', orderMode === 'sequence');
      help.textContent = t(orderMode === 'sequence' ? 'teacher.order_sequence_help' : 'teacher.order_free_help');
    };
    freeBtn.addEventListener('click', () => { orderMode = 'free'; syncSegmented(); });
    seqBtn.addEventListener('click', () => { orderMode = 'sequence'; syncSegmented(); });
    segmented.append(freeBtn, seqBtn);
    syncSegmented();

    const settingsCard = h('div.card.mb-4',
      h('h2.card-title', t('teacher.edit_class')),
      h('div.grid.grid-2',
        h('div.field', h('label.label', { for: 'class-name' }, t('teacher.class_name')), h('input.input#class-name', { type: 'text', maxlength: 120, value: cls.name })),
        h('div.field', h('label.label', { for: 'class-percent' }, t('teacher.unlock_min_percent')), h('input.input#class-percent', { type: 'number', min: '0', max: '100', step: '5', value: String(cls.unlockMinPercent || 0), style: 'max-width:120px' })),
      ),
      h('div.field', h('label.label', { for: 'class-description' }, t('teacher.class_description')), h('textarea.textarea#class-description', { maxlength: 2000, rows: 3 }, cls.description || '')),
      h('div.field', h('label.label', { for: 'class-mode' }, t('teacher.class_order_mode')), segmented, help),
      h('div.row.end', h('button.btn.btn-primary', { type: 'button', on: { click: saveSettings } }, t('common.save'))),
    );
    host.appendChild(settingsCard);

    // --- items card (grouped into courses) ----------------------------------
    host.appendChild(renderItemsCard());

    // --- roster card (student accounts) --------------------------------------
    host.appendChild(renderRosterCard());

    // --- statistics card ------------------------------------------------------
    host.appendChild(renderStatsCard());
  }

  // --- items card with course sections ---------------------------------------
  function renderItemRow(assignmentId, index, courseId, bonus) {
    const byId = new Map(assignments.map((a) => [a.id, a]));
    const a = byId.get(assignmentId);
    const courseSelect = h('select.select.select-sm.item-course-select', {
      'aria-label': t('teacher.item_course_label'),
      title: t('teacher.item_course_label'),
      on: { change: (event) => setItemCourse(assignmentId, event.target.value || null) },
    });
    courseSelect.appendChild(h('option', { value: '', selected: !courseId }, t('teacher.course_none')));
    for (const course of courses) {
      courseSelect.appendChild(h('option', { value: course.id, selected: course.id === courseId }, course.title));
    }
    const bonusBtn = h('button.btn.btn-icon.btn-sm.item-bonus-toggle', {
      type: 'button',
      class: bonus ? 'is-active' : '',
      title: t('teacher.item_bonus_label'),
      'aria-label': t('teacher.item_bonus_label'),
      'aria-pressed': bonus ? 'true' : 'false',
      on: { click: () => setItemBonus(assignmentId, !bonus) },
    }, h('span', { html: '⭐' }));
    return h('li.item-order-row.class-item-row',
      h('span.item-order-number', { text: String(index + 1) }),
      h('div.grow.min-w-0',
        h('div.strong.truncate', { text: a ? a.title : assignmentId }),
        h('div.small.muted.row.gap-2',
          a ? h('span.badge', { text: templateLabel(a.template) }) : null,
          bonus ? h('span.badge.badge-warning', { text: '⭐ ' + t('teacher.item_bonus_label') }) : null,
          a ? statusBadge(a.status, t(a.status === 'open' ? 'teacher.status_open' : 'teacher.status_closed')) : null,
          a ? h('span', { text: t('teacher.class_participants', { n: a.participantCount || 0 }) }) : null,
        ),
      ),
      bonusBtn,
      courseSelect,
      h('div.item-order-controls',
        h('button.btn.btn-ghost.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.move_up'), 'aria-label': t('teacher.move_up'), disabled: index === 0, on: { click: () => move(index, -1) } }, h('span', { html: icon('chevron-up', { size: 16 }) })),
        h('button.btn.btn-ghost.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.move_down'), 'aria-label': t('teacher.move_down'), disabled: index === itemEntries.length - 1, on: { click: () => move(index, 1) } }, h('span', { html: icon('chevron-down', { size: 16 }) })),
        h('button.btn.btn-soft-danger.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.remove_item'), 'aria-label': t('teacher.remove_item'), on: { click: () => removeItem(assignmentId) } }, h('span', { html: icon('trash', { size: 15 }) })),
      ),
    );
  }

  function renderCourseSection(course) {
    const section = h('div.course-section.mb-3', { dataset: { courseId: course.id } });
    const titleInput = h('input.input.input-sm.course-title-input', {
      type: 'text',
      maxlength: 120,
      value: course.title,
      'aria-label': t('teacher.course_title'),
      on: {
        change: (event) => {
          const title = event.target.value.trim();
          if (title && title !== course.title) renameCourse(course, title);
          else event.target.value = course.title;
        },
      },
    });
    const courseIndex = courses.findIndex((c) => c.id === course.id);
    section.appendChild(
      h('div.row.gap-2.align-center.course-header',
        h('span', { html: icon('book', { size: 16 }) }),
        titleInput,
        h('span.badge.badge-info', t('teacher.course_item_count', { n: course.itemCount })),
        h('div.row.gap-1.ml-auto',
          h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', title: t('teacher.move_up'), 'aria-label': t('teacher.move_up'), disabled: courseIndex === 0, on: { click: () => moveCourse(course, -1) } }, h('span', { html: icon('chevron-up', { size: 14 }) })),
          h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', title: t('teacher.move_down'), 'aria-label': t('teacher.move_down'), disabled: courseIndex === courses.length - 1, on: { click: () => moveCourse(course, 1) } }, h('span', { html: icon('chevron-down', { size: 14 }) })),
          h('button.btn.btn-soft-danger.btn-icon.btn-sm', { type: 'button', title: t('teacher.course_delete'), 'aria-label': t('teacher.course_delete'), on: { click: () => deleteCourse(course) } }, h('span', { html: icon('trash', { size: 14 }) })),
        ),
      ),
    );
    const list = h('ul.item-order-list.class-item-list');
    itemEntries.forEach((entry, index) => {
      if (entry.courseId === course.id) list.appendChild(renderItemRow(entry.assignmentId, index, entry.courseId, entry.bonus));
    });
    if (!list.children.length) list.appendChild(h('li.empty-inline.small.muted', { text: t('teacher.course_empty') }));
    section.appendChild(list);
    return section;
  }

  function renderItemsCard() {
    const itemsCard = h('div.card');
    itemsCard.appendChild(h('h2.card-title', t('teacher.class_items')));
    itemsCard.appendChild(h('p.card-subtitle', t('teacher.class_items_hint')));

    // add-course inline form
    const courseInput = h('input.input.input-sm#new-course-title', {
      type: 'text', maxlength: 120, placeholder: t('teacher.course_new_ph'),
      'aria-label': t('teacher.course_new_ph'),
    });
    itemsCard.appendChild(h('div.row.gap-2.mb-3.wrap',
      courseInput,
      h('button.btn.btn-secondary.btn-sm', {
        type: 'button',
        on: {
          click: () => {
            const title = courseInput.value.trim();
            if (title) addCourse(title);
          },
        },
      }, h('span', { html: icon('plus', { size: 15 }) }), ' ', t('teacher.course_add')),
    ));

    for (const course of courses) itemsCard.appendChild(renderCourseSection(course));

    // unassigned items
    const unassigned = itemEntries.filter((entry) => !entry.courseId);
    if (unassigned.length > 0) {
      const section = h('div.course-section.mb-3.course-section-unassigned');
      section.appendChild(h('div.row.gap-2.align-center.course-header',
        h('span', { html: icon('clipboard', { size: 16 }) }),
        h('span.strong', t('teacher.course_none')),
      ));
      const list = h('ul.item-order-list.class-item-list');
      itemEntries.forEach((entry, index) => {
        if (!entry.courseId) list.appendChild(renderItemRow(entry.assignmentId, index, null, entry.bonus));
      });
      section.appendChild(list);
      itemsCard.appendChild(section);
    }

    if (itemEntries.length === 0 && courses.length === 0) {
      const emptyList = h('ul.item-order-list.class-item-list');
      emptyList.appendChild(h('li.empty-inline.small.muted', { text: t('teacher.classes_empty_hint') }));
      itemsCard.appendChild(emptyList);
    }

    const available = assignments.filter((a) => !itemEntries.some((entry) => entry.assignmentId === a.id));
    const select = h('select.select#add-item-select', { style: 'min-width:220px' },
      ...available.map((a) => h('option', { value: a.id }, `${a.title} (${a.code})`)),
    );
    const coursePick = h('select.select.select-sm#add-item-course',
      h('option', { value: '' }, t('teacher.course_none')),
      ...courses.map((course) => h('option', { value: course.id }, course.title)),
    );
    itemsCard.appendChild(
      h('div.row.gap-2.mt-3.wrap',
        available.length > 0
          ? h('div.row.gap-2.wrap', select, coursePick, h('button.btn.btn-secondary', { type: 'button', on: { click: () => { if (select.value) { itemEntries = [...itemEntries, { assignmentId: select.value, courseId: coursePick.value || null }]; saveItems(); } } } }, h('span', { html: icon('plus', { size: 15 }) }), ' ', t('teacher.add_assignment')))
          : h('div.row.gap-2.wrap',
              h('span.small.muted', t('teacher.no_assignments_available')),
              h('a.btn.btn-secondary.btn-sm', { href: '/teacher/' }, t('teacher.go_publish_assignment')),
            ),
      ),
    );
    return itemsCard;
  }

  async function addStudents(namesText) {
    const names = namesText.split('\n').map((line) => line.trim()).filter(Boolean);
    if (names.length === 0) return;
    try {
      const data = await post(`/api/classes/${encodeURIComponent(classId)}/students`, { names });
      if (Array.isArray(data.credentials) && data.credentials.length > 0) openCredentialsDialog(data.credentials, { className: cls.name });
      else toast(t('teacher.roster_added_existing'), 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetPassword(student) {
    try {
      const data = await post(`/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(student.id)}/reset`);
      openCredentialsDialog([{ name: student.name, username: data.username, password: data.password }], { className: cls.name });
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function removeStudent(student) {
    try {
      await del(`/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(student.id)}`);
      toast(t('teacher.roster_removed'), 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function renderRosterCard() {
    const card = h('div.card.mt-4');
    card.appendChild(h('div.row.between.wrap.gap-2',
      h('h2.card-title', t('teacher.roster_title')),
      h('button.btn.btn-secondary.btn-sm', {
        type: 'button',
        disabled: roster.length === 0,
        on: { click: () => printRosterSheet(cls.name, roster) },
      }, h('span', { html: icon('printer', { size: 15 }) }), ' ', t('teacher.roster_print')),
    ));
    card.appendChild(h('p.card-subtitle', t('teacher.roster_hint')));

    const list = h('ul.item-order-list.roster-list');
    for (const student of roster) {
      const row = h('li.item-order-row',
        h('div.grow.min-w-0',
          h('div.strong.truncate', { text: student.name }),
          h('div.small.muted.row.gap-2',
            student.username ? h('span.mono', { text: student.username }) : h('span', { text: t('teacher.roster_no_account') }),
            student.lastLoginAt ? h('span', { text: t('teacher.roster_last_login', { date: new Date(student.lastLoginAt).toLocaleString() }) }) : null,
          ),
        ),
        h('div.item-order-controls',
          student.hasAccount
            ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: t('teacher.roster_reset_pw'), on: { click: () => resetPassword(student) } }, t('teacher.roster_reset_pw'))
            : null,
          h('button.btn.btn-soft-danger.btn-icon.btn-sm.item-order-btn', { type: 'button', title: t('teacher.roster_remove'), 'aria-label': t('teacher.roster_remove'), on: { click: () => removeStudent(student) } }, h('span', { html: icon('trash', { size: 15 }) })),
        ),
      );
      list.appendChild(row);
    }
    if (roster.length === 0) list.appendChild(h('li.empty-inline.small.muted', { text: t('teacher.roster_empty') }));
    card.appendChild(list);

    const namesInput = h('textarea.textarea#roster-names', { rows: 4, placeholder: t('teacher.roster_names_placeholder') });
    const addBtn = h('button.btn.btn-secondary', { type: 'button', on: { click: () => addStudents(namesInput.value) } },
      h('span', { html: icon('plus', { size: 15 }) }), ' ', t('teacher.roster_add_button'));
    card.appendChild(h('div.field.mt-3',
      h('label.label', { for: 'roster-names' }, t('teacher.roster_add_names')),
      namesInput,
    ));
    card.appendChild(h('div.row.gap-2.mt-2', addBtn));
    return card;
  }

  // --- class statistics (students x assignments matrix) ----------------------
  let statsCache = null;
  let statsBody = null;
  let statsLoading = false;

  function statCellClass(percent, state) {
    if (state === 'locked') return 'stat-locked';
    if (state !== 'done' || percent === null || percent === undefined) return 'stat-open';
    if (percent >= 75) return 'stat-good';
    if (percent >= 40) return 'stat-mid';
    return 'stat-low';
  }

  function renderStats() {
    if (!statsBody || !statsCache) return;
    clear(statsBody);
    const items = Array.isArray(statsCache.items) ? statsCache.items : [];
    const students = Array.isArray(statsCache.students) ? statsCache.students : [];
    if (items.length === 0) {
      statsBody.appendChild(h('p.small.muted', t('teacher.stats_no_items')));
      return;
    }
    if (students.length === 0) {
      statsBody.appendChild(h('p.small.muted', t('teacher.stats_no_students')));
      return;
    }
    const courseTitles = new Map((Array.isArray(statsCache.courses) ? statsCache.courses : []).map((course) => [course.id, course.title]));
    statsBody.appendChild(h('div.table-scroll',
      h('table.class-stats-table',
        h('thead', h('tr',
          h('th', t('teacher.stats_student')),
          ...items.map((item) => h('th',
            h('div.strong.stats-item-title', { text: `${item.position}. ${item.title}` }),
            item.courseId && courseTitles.get(item.courseId)
              ? h('div.small.muted', { text: courseTitles.get(item.courseId) })
              : null,
            h('div.small.muted.mono', { text: item.code || '' }),
          )),
          h('th', t('teacher.stats_total')),
        )),
        h('tbody', ...students.map((s) => h('tr',
          h('th.stats-student-cell',
            h('div.strong', { text: s.name }),
            s.username ? h('div.small.muted.mono', { text: s.username }) : null,
          ),
          ...items.map((item) => {
            const cell = (s.cells || {})[item.assignmentId] || null;
            const clsName = statCellClass(cell && cell.percent, cell && cell.state);
            const label = !cell
              ? '–'
              : cell.state === 'locked'
                ? t('teacher.stats_locked')
                : cell.state === 'done' && cell.percent !== null && cell.percent !== undefined
                  ? `${String(cell.percent).replace('.', ',')}%`
                  : cell.state === 'done'
                    ? '✓'
                    : '–';
            return h(`td.${clsName}`, {
              text: label,
              title: cell && cell.submittedAt ? new Date(cell.submittedAt).toLocaleString() : '',
            });
          }),
          h(`td.${statCellClass(s.total && s.total.percent, s.total && s.total.maxScore > 0 ? 'done' : 'open')}.strong`, {
            text: s.total && s.total.percent !== null && s.total.percent !== undefined ? `${String(s.total.percent).replace('.', ',')}%` : '–',
          }),
        ))),
      ),
    ));
  }

  async function loadStats(force = false) {
    if (statsLoading) return;
    if (statsCache && !force) {
      renderStats();
      return;
    }
    statsLoading = true;
    if (statsBody) {
      clear(statsBody);
      statsBody.appendChild(h('p.small.muted', t('common.loading')));
    }
    try {
      statsCache = await get(`/api/classes/${encodeURIComponent(classId)}/stats`, { signal: ctx.signal });
      if (disposed) return;
      renderStats();
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (statsBody) {
        clear(statsBody);
        statsBody.appendChild(h('p.error-text', errorMessage(error)));
      }
    } finally {
      statsLoading = false;
    }
  }

  function renderStatsCard() {
    const card = h('div.card.mt-4');
    card.appendChild(h('div.row.between.wrap.gap-2',
      h('h2.card-title', t('teacher.stats_title')),
      h('button.btn.btn-secondary.btn-sm', { type: 'button', on: { click: () => loadStats(true) } },
        h('span', { html: icon('refresh', { size: 15 }) }), ' ', t('teacher.stats_refresh')),
    ));
    card.appendChild(h('p.card-subtitle', t('teacher.stats_hint')));
    statsBody = h('div.mt-2');
    card.appendChild(statsBody);
    loadStats();
    return card;
  }

  try {
    await load();
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    clear(host);
    host.appendChild(h('div.card.error-card', h('h2', t('common.error')), h('p.muted', errorMessage(error))));
  }
  return () => { disposed = true; };
}
