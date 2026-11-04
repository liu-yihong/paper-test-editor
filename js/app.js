/*
 * Paper Test Editor — the interface.
 * Steps: Import → Blueprint → Generate → Review & edit → Export.
 */
(function () {
  'use strict';
  const STORE_DB = 'paper-test-editor';
  const STORE_KEY = 'project';
  const STEPS = ['import', 'blueprint', 'generate', 'review', 'export'];

  /* ---------- tiny DOM helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return iso; } };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'exam';

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }

  function openModal(title, body, actions) {
    $('#modal-title').textContent = title;
    $('#modal-body').replaceChildren(...[].concat(body).filter(Boolean));
    $('#modal-actions').replaceChildren(...(actions || []).map(a => h('button', { type: 'button', class: a.primary ? 'primary' : a.danger ? 'danger' : '', onclick: a.onclick }, a.label)));
    $('#modal').hidden = false;
    const f = $('#modal-body .wy-area, #modal-body input:not([type=radio]):not([type=checkbox]), #modal-body textarea, #modal-actions button.primary');
    if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { $('#modal').hidden = true; $('#modal-body').replaceChildren(); $('#modal .modal-box').classList.remove('wide'); }
  function confirmBox(title, text, okLabel, onOk, danger) {
    openModal(title, h('p', null, text), [{ label: 'Cancel', onclick: closeModal }, { label: okLabel, primary: !danger, danger, onclick: () => { closeModal(); onOk(); } }]);
  }

  /* ---------- project ---------- */
  function emptyProject() {
    return {
      app: 'paper-test-editor', version: 1,
      exam: { course: '', title: '', timeLimit: '', instructions: '' },
      pools: [], images: {}, forms: [], usage: [],
      settings: Object.assign({}, PT.paper.DEFAULT_SETTINGS, { recordUsage: true }),
      gen: { count: 2, seed: PT.forms.newSeed(), start: 'A' },
      rev: 0
    };
  }
  function normalizeProject(p) {
    const base = emptyProject();
    p = p || {};
    const out = Object.assign(base, p);
    out.exam = Object.assign(base.exam, p.exam || {});
    out.settings = Object.assign({}, PT.paper.DEFAULT_SETTINGS, { recordUsage: true }, p.settings || {});
    out.gen = Object.assign({ count: 2, seed: PT.forms.newSeed(), start: 'A' }, p.gen || {});
    out.pools = (p.pools || []).map(pl => Object.assign({ id: BQ.uid(), title: 'Pool', draw: 0, points: 1, label: '' }, pl, {
      questions: (pl.questions || []).map(q => Object.assign(BQ.normalizeQuestion(q), { key: q.key || PT.forms.questionKey(q), excluded: !!q.excluded, distractors: q.distractors || [] }))
    }));
    PT.forms.tidySections(out.pools);
    out.forms = Array.isArray(p.forms) ? p.forms : [];
    out.usage = Array.isArray(p.usage) ? p.usage : [];
    out.images = p.images || {};
    return out;
  }

  let project = emptyProject();
  const wy = {};
  const ui = { step: 'import', form: 0, doc: 'booklet', browse: {} };

  /* ---------- autosave (IndexedDB, falls back to localStorage) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      if (!globalThis.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open(STORE_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function storeGet() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(STORE_KEY); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
    } catch (e) {
      try { return JSON.parse(localStorage.getItem('pte:' + STORE_KEY) || 'null'); } catch (e2) { return null; }
    }
  }
  async function storeSet(v) {
    try {
      const db = await idb();
      await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, STORE_KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch (e) {
      try { localStorage.setItem('pte:' + STORE_KEY, JSON.stringify(v)); } catch (e2) { /* storage full or blocked */ }
    }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storeSet(JSON.parse(JSON.stringify(project))), 400);
    $('#project-name').textContent = project.exam.title || 'Untitled exam';
  }

  /* ---------- downloads ---------- */
  /** In a claude.ai preview frame, downloads go through the platform's save prompt. */
  const inPreviewFrame = () => !!(globalThis.claude && typeof globalThis.claude.use === 'function');
  async function download(name, data, type) {
    if (inPreviewFrame()) {
      try {
        const dl = await globalThis.claude.use('downloads');
        if (dl) {
          await dl.save({ filename: name, data: data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' }) });
          return;
        }
      } catch (err) {
        if (err && err.code === 'declined') return;
      }
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ---------- steps ---------- */
  function go(step, opts) {
    ui.step = STEPS.includes(step) ? step : 'import';
    $$('.step').forEach(s => s.classList.toggle('active', s.dataset.panel === ui.step));
    renderStepper();
    ({ import: renderImport, blueprint: renderBlueprint, generate: renderGenerate, review: renderReview, export: renderExport })[ui.step]();
    // Not on the first render: the page is already at the top, and scrolling right after the DOM
    // changes forces an extra layout while the page is loading.
    if (!(opts && opts.initial)) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderStepper() {
    const done = {
      import: project.pools.length > 0,
      blueprint: PT.forms.sectionsOf(project.pools).some(s => s.draw > 0),
      generate: project.forms.length > 0,
      review: project.forms.length > 0,
      export: project.forms.some(f => f.recordedAt)
    };
    $$('#stepper button').forEach(b => {
      b.classList.toggle('active', b.dataset.step === ui.step);
      b.classList.toggle('done', !!done[b.dataset.step] && b.dataset.step !== ui.step);
      const isDone = b.classList.contains('done'), isActive = b.classList.contains('active');
      const label = b.textContent.replace(/^\d+/, '').trim(), n = b.querySelector('span').textContent;
      b.setAttribute('aria-label', `Step ${n}: ${label}${isDone ? ' (done)' : ''}`);
      b.title = `${label}${isDone ? ' — done' : isActive ? ' — current step' : ''}`;
      if (isActive) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }

  /* =================================================================
     1. Import
     ================================================================= */
  const TYPE_SHORT = { MC: 'MC', MA: 'MA', TF: 'T/F', ESS: 'Essay', MAT: 'Match', FIB: 'Blank', FIB_PLUS: 'Blanks', NUM: 'Numeric' };
  function typeChips(questions) {
    const counts = {};
    questions.forEach(q => { counts[q.type] = (counts[q.type] || 0) + 1; });
    return BQ.TYPES.filter(t => counts[t.code]).map(t => h('span', { class: 'chip', title: t.label, text: TYPE_SHORT[t.code] + ' ' + counts[t.code] }));
  }
  const invalidCount = (pool) => pool.questions.filter(q => BQ.validate(q, { images: project.images }).errors.length).length;

  function renderImport() {
    const list = $('#pool-list');
    list.replaceChildren(...project.pools.map(p => {
      const bad = invalidCount(p);
      const skipped = Object.entries(p.skipped || {});
      return h('div', { class: 'pool-card' },
        h('header', null, h('div', null, h('b', null, p.title), h('div', { class: 'muted', text: plural(p.questions.length, 'question') + (p.source ? ' · from ' + p.source : '') })),
          h('button', { type: 'button', class: 'small danger', title: 'Remove this pool', onclick: () => removePool(p) }, 'Remove')),
        h('div', { class: 'chips' }, typeChips(p.questions)),
        bad ? h('div', { class: 'chips' }, h('span', { class: 'chip bad', text: plural(bad, 'question') + ' with problems (left out of draws)' })) : null,
        skipped.length ? h('div', { class: 'chips' }, skipped.map(([t, n]) => h('span', { class: 'chip warn', text: n + ' × ' + t + ' skipped (no paper version)' }))) : null
      );
    }));
  }

  function removePool(p) {
    confirmBox('Remove “' + p.title + '”?', 'Its questions leave the blueprint. Forms already generated keep their own copies.', 'Remove', () => {
      // a section's first pool carries its settings: hand them to the next pool in it
      const members = project.pools.filter(x => x.joinedTo === p.id);
      if (members.length) {
        const heir = members[0];
        delete heir.joinedTo;
        Object.assign(heir, { draw: p.draw, points: p.points, label: p.label });
        members.slice(1).forEach(m => { m.joinedTo = heir.id; });
      }
      project.pools = project.pools.filter(x => x !== p);
      PT.forms.tidySections(project.pools);
      project.rev++;
      save(); renderImport(); renderStepper();
    }, true);
  }

  function addPools(res, source) {
    let added = 0;
    res.pools.forEach(pl => {
      const questions = pl.questions.map(q => Object.assign(q, { key: PT.forms.questionKey(q), excluded: false, distractors: q.distractors || [] }));
      const keys = questions.map(q => q.key).sort().join();
      if (project.pools.some(x => x.questions.map(q => q.key).sort().join() === keys)) { toast('“' + pl.title + '” is already imported.'); return; }
      questions.forEach(q => { if (BQ.validate(q, { images: project.images }).errors.length) q.excluded = true; });
      const pts = questions.map(q => q.bbPoints).filter(Boolean);
      project.pools.push({
        id: BQ.uid(), title: pl.title, source, questions, skipped: pl.skipped,
        draw: 0, points: pts.length ? pts[0] : 1, label: ''
      });
      added++;
    });
    if (added) { project.rev++; save(); }
    return added;
  }

  async function importFiles(files) {
    let added = 0;
    for (const file of files) {
      try {
        if (/\.zip$/i.test(file.name)) {
          const res = await PT.importer.readPoolZip(await file.arrayBuffer(), file.name, project.images);
          added += addPools(res, file.name);
        } else if (/\.json$/i.test(file.name)) {
          const text = await file.text();
          const data = JSON.parse(text);
          if (data && data.app === 'paper-test-editor') { offerOpenProject(data, file.name); continue; }
          const res = PT.importer.readBbqJson(text, file.name);
          mergeImages(res);
          added += addPools(res, file.name);
        } else {
          toast(file.name + ' is not a .zip bank or a .json project.');
        }
      } catch (err) {
        openModal('Couldn’t read ' + file.name, h('p', null, err.message || String(err)), [{ label: 'OK', primary: true, onclick: closeModal }]);
      }
    }
    if (added) toast('Imported ' + plural(added, 'pool') + '.');
    renderImport(); renderStepper();
  }

  /** Pictures from an editor project: rename any that clash with pictures already here. */
  function mergeImages(res) {
    Object.keys(res.images).forEach(name => {
      let target = name;
      if (project.images[name] && project.images[name].data !== res.images[name].data) {
        const dot = name.lastIndexOf('.');
        let k = 2;
        while (project.images[target]) target = name.slice(0, dot) + '-' + k++ + name.slice(dot);
        const re = new RegExp('(<img\\b[^>]*\\bsrc\\s*=\\s*["\']?)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        res.pools.forEach(p => p.questions.forEach(q => {
          ['text', 'sample'].forEach(f => { q[f] = String(q[f] || '').replace(re, '$1' + target); });
          q.options.forEach(o => { o.text = o.text.replace(re, '$1' + target); });
          q.pairs.forEach(pr => { pr.left = pr.left.replace(re, '$1' + target); pr.right = pr.right.replace(re, '$1' + target); });
        }));
      }
      project.images[target] = res.images[name];
    });
  }

  /* The sample banks (js/samples.js, about 35 KB) are fetched only when someone asks for them,
     so they stay off the first page load. A same-origin script is allowed by the page's CSP. */
  let samplesLoading = null;
  function ensureSamples() {
    if (PT.SAMPLES) return Promise.resolve();
    if (!samplesLoading) {
      samplesLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'js/samples.js';
        s.onload = () => res();
        s.onerror = () => { samplesLoading = null; s.remove(); rej(new Error('The sample banks did not load.')); };
        document.head.append(s);
      });
    }
    return samplesLoading;
  }

  async function loadSamples() {
    const names = ['sample-bank-sql-basics.zip', 'sample-bank-joins.zip', 'sample-bank-is-databases.zip', 'sample-bank-processes-bpmn.zip', 'sample-bank-systems-development.zip', 'sample-bank-mis-short-answer.zip'];
    try {
      await ensureSamples();
      const files = names.map(n => {
        if (!PT.SAMPLES || !PT.SAMPLES[n]) throw new Error('The sample banks did not load.');
        return new File([PT.zip.b64ToBytes(PT.SAMPLES[n])], n);
      });
      await importFiles(files);
      const e = project.exam;
      if (!e.title && !e.course) {
        Object.assign(e, { course: 'MGMT 2080 · Introduction to Information Systems', title: 'Midterm Exam (Make-up)', timeLimit: 75, instructions: 'Answer **every** question. You may use one cheat sheet (letter size, one or both sides) and a calculator.' });
        // SQL basics and Joins are combined into one section: 8 questions from both banks
        const plan = [
          [8, 2, 'Outcome 1: Write and combine SQL queries'], null,
          [6, 2, 'Outcome 2: Explain information systems and databases'], [5, 2, 'Outcome 3: Model business processes'],
          [6, 2, 'Outcome 4: Plan systems development projects'], [2, 5, 'Outcome 5: Apply MIS concepts']
        ];
        const mine = project.pools.slice(-plan.length);
        mine.forEach((p, i) => {
          if (plan[i]) { p.draw = plan[i][0]; p.points = plan[i][1]; p.label = plan[i][2]; } else { p.joinedTo = mine[i - 1].id; p.draw = 0; p.points = 2; p.label = ''; }
        });
        PT.forms.tidySections(project.pools);
        save();
      }
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  /* =================================================================
     2. Blueprint
     ================================================================= */
  function bindExam() {
    const e = project.exam;
    const bind = (sel, key, num) => {
      const el = $(sel);
      el.value = e[key] == null ? '' : e[key];
      el.oninput = () => { e[key] = num ? (el.value === '' ? '' : Number(el.value)) : el.value; save(); };
    };
    bind('#exam-course', 'course');
    bind('#exam-title', 'title');
    bind('#exam-time', 'timeLimit', true);
    // rich fields: created once, refreshed when the project changes underneath them
    if (!wy.instructions) {
      wy.instructions = PT.wysiwyg({ images: () => project.images, notify: toast, label: 'Instructions', placeholder: 'For example: Answer every question. You may use one handwritten note sheet and a calculator.', onInput: (v) => { project.exam.instructions = v; save(); } });
      $('#exam-instructions').replaceWith(wy.instructions.el);
      wy.instructions.area.setAttribute('aria-labelledby', 'lbl-instructions');
      wy.endText = PT.wysiwyg({ compact: true, label: 'Closing line', placeholder: 'No closing line will be printed.', onInput: (v) => { project.exam.endText = v; save(); syncEndReset(); } });
      $('#exam-endtext').replaceWith(wy.endText.el);
      wy.endText.area.setAttribute('aria-labelledby', 'lbl-endtext');
      $('#btn-endtext-reset').onclick = () => { delete project.exam.endText; wy.endText.value = PT.paper.endText(project); save(); syncEndReset(); };
    }
    if (wy.instructions.value !== (e.instructions || '')) wy.instructions.value = e.instructions || '';
    const end = PT.paper.endText(project);
    if (wy.endText.value !== end) wy.endText.value = end;
    syncEndReset();
  }
  function syncEndReset() { $('#btn-endtext-reset').hidden = project.exam.endText == null; }

  const usableCount = (p) => p.questions.filter(q => !q.excluded).length;
  /** Sections of the blueprint, counting only questions that can be drawn. */
  function blueprintSections() { return PT.forms.sectionsOf(drawablePools()); }

  /** Join pool p (and any pools joined to it) to the section just above it. */
  function combineWithAbove(p) {
    const secs = PT.forms.sectionsOf(project.pools);
    const i = secs.findIndex(s => s.lead === p);
    if (i < 1) return;
    const above = secs[i - 1], mine = secs[i];
    const lead = above.lead;
    mine.pools.forEach(x => { x.joinedTo = lead.id; });
    lead.draw = (Number(lead.draw) || 0) + (Number(p.draw) || 0);
    const pointsDiffer = Number(p.points) !== Number(lead.points) && p.draw > 0;
    project.rev++;
    save(); renderBlueprint(); renderStepper();
    toast('Combined into “' + PT.forms.sectionName(PT.forms.sectionOfPool(project.pools, lead.id)) + '”. One draw now comes from ' + plural(above.pools.length + mine.pools.length, 'bank') + ' together' + (pointsDiffer ? ', at ' + lead.points + ' points each.' : '.'));
  }
  /** Take pool p out of its section; it becomes a section of its own, right after. */
  function separate(p) {
    const sec = PT.forms.sectionOfPool(project.pools, p.id);
    if (!sec || sec.lead === p) return;
    // p takes back its share of the section's draw, so the exam keeps its length
    const dsec = PT.forms.sectionOfPool(drawablePools(), p.id);
    const share = dsec ? PT.forms.sectionMix(dsec)[dsec.pools.findIndex(x => x.id === p.id)] || 0 : 0;
    delete p.joinedTo;
    p.draw = share; p.points = sec.points; p.label = '';
    sec.lead.draw = Math.max(0, (Number(sec.lead.draw) || 0) - share);
    // keep the section's members together: move p after the section's last pool
    project.pools = project.pools.filter(x => x !== p);
    const last = sec.pools.filter(x => x !== p).pop();
    project.pools.splice(project.pools.indexOf(last) + 1, 0, p);
    const left = PT.forms.sectionOfPool(drawablePools(), sec.id);
    if (left) sec.lead.draw = Math.min(Number(sec.lead.draw) || 0, left.size);
    project.rev++;
    save(); renderBlueprint(); renderStepper();
    toast('“' + p.title + '” is its own section again, drawing ' + plural(share, 'question') + ' (its share of the section).');
  }
  function moveSection(i, d) {
    const secs = PT.forms.sectionsOf(project.pools);
    const j = i + d;
    if (j < 0 || j >= secs.length) return;
    [secs[i], secs[j]] = [secs[j], secs[i]];
    project.pools = secs.flatMap(s => s.pools);
    project.rev++; save(); renderBlueprint();
  }

  function renderBlueprint() {
    bindExam();
    const t = $('#slots');
    const head = h('thead', null, h('tr', null, ['Order', 'Pool', 'Section / outcome label', 'Draw', 'Points each', 'Subtotal', ''].map(x => h('th', null, x))));
    const body = h('tbody');
    const secs = blueprintSections();
    const browse = [];
    secs.forEach((sec, si) => {
      const multi = sec.pools.length > 1;
      sec.pools.forEach((dp, pi) => {
        const p = project.pools.find(x => x.id === dp.id);
        const n = usableCount(p);
        const isLead = pi === 0;
        const last = pi === sec.pools.length - 1;
        const cls = ['slot-row', multi ? 'in-section' : '', multi && isLead ? 'sec-first' : '', multi && !isLead ? 'sec-member' : '', multi && last ? 'sec-last' : ''].filter(Boolean).join(' ');
        const nameCell = h('td', { class: 'pool-name' }, h('b', null, p.title),
          h('div', { class: 'sub' }, n + ' available' + (n < p.questions.length ? ' (' + (p.questions.length - n) + ' left out)' : '')),
          h('div', { class: 'chips' }, typeChips(p.questions.filter(q => !q.excluded))));
        const browseBtn = h('button', { type: 'button', class: 'small', onclick: () => { ui.browse[p.id] = !ui.browse[p.id]; renderBlueprint(); } }, ui.browse[p.id] ? 'Hide questions' : 'Questions');
        let row;
        if (isLead) {
          const N = sec.size;
          const drawIn = h('input', { class: 'num', type: 'number', min: 0, max: N, value: p.draw, 'aria-label': 'Questions to draw from ' + (multi ? 'the section ' + PT.forms.sectionName(sec) : p.title) });
          const ptsIn = h('input', { class: 'num', type: 'number', min: 0, step: 0.5, value: p.points, 'aria-label': 'Points per question for ' + (multi ? 'the section ' + PT.forms.sectionName(sec) : p.title) });
          const labelIn = h('input', { value: p.label || '', placeholder: multi ? sec.pools.map(x => x.title).join(' + ') : p.title, 'aria-label': 'Label for ' + (multi ? 'the section starting with ' : '') + p.title });
          const sub = h('td', { class: 'subtotal', text: String((Math.min(p.draw, N) || 0) * (Number(p.points) || 0)) });
          const change = () => {
            p.draw = Math.max(0, Math.min(N, parseInt(drawIn.value, 10) || 0));
            p.points = Math.max(0, Number(ptsIn.value) || 0);
            p.label = labelIn.value;
            sub.textContent = String(p.draw * p.points);
            project.rev++;
            save(); renderTotals(); renderStepper();
            if (multi && mixNote) mixNote.textContent = mixText(PT.forms.sectionOfPool(drawablePools(), p.id));
          };
          drawIn.onchange = change; ptsIn.onchange = change; labelIn.oninput = change;
          const mixNote = multi ? h('div', { class: 'sub mix-note', text: mixText(sec) }) : null;
          const span = multi ? { rowspan: sec.pools.length } : {};
          row = h('tr', { class: cls },
            h('td', Object.assign({ class: 'order' }, span), h('button', { type: 'button', title: multi ? 'Move this section up' : 'Move up', 'aria-label': 'Move up', onclick: () => moveSection(si, -1), disabled: si === 0 }, '↑'), ' ', h('button', { type: 'button', title: multi ? 'Move this section down' : 'Move down', 'aria-label': 'Move down', onclick: () => moveSection(si, 1), disabled: si === secs.length - 1 }, '↓')),
            nameCell,
            h('td', Object.assign({ class: 'sec-label' }, span), labelIn, multi ? h('div', { class: 'sub sec-tag', text: 'Section · ' + plural(sec.pools.length, 'bank') + ' combined' }) : null),
            h('td', Object.assign({ class: 'sec-draw' }, span), h('span', { class: 'draw-cell' }, drawIn, h('span', { class: 'sub' }, 'of ' + N)), mixNote),
            h('td', span, ptsIn), Object.assign(sub, span.rowspan ? { rowSpan: span.rowspan } : {}),
            h('td', { class: 'row-actions' }, browseBtn, si > 0 ? h('button', { type: 'button', class: 'small', title: 'Draw from this bank and the section above it together, under one label, draw count and points', onclick: () => combineWithAbove(p) }, 'Combine with above') : null));
        } else {
          row = h('tr', { class: cls }, nameCell,
            h('td', { class: 'row-actions' }, browseBtn, h('button', { type: 'button', class: 'small', title: 'Take this bank out of the section; it gets its own draw count again', onclick: () => separate(p) }, 'Separate')));
        }
        body.append(row);
        // question lists go after the whole section, so the shared cells still span its rows
        if (ui.browse[p.id]) browse.push(h('tr', { class: 'browse-row' }, h('td', { colspan: 7 }, multi ? h('div', { class: 'sub browse-title', text: p.title }) : null, browseList(p))));
      });
      body.append(...browse.splice(0));
    });
    const foot = h('tfoot', null, h('tr', null, h('td'), h('td', { text: 'Total' }), h('td'), h('td', { id: 'tot-q' }), h('td'), h('td', { id: 'tot-p' }), h('td')));
    t.replaceChildren(head, body, foot);
    if (!project.pools.length) t.replaceChildren(h('tbody', null, h('tr', null, h('td', { class: 'muted', text: 'Import at least one question bank first.' }))));
    renderTotals();
  }

  /** "Every form: 4 from SQL basics, 4 from Joins" */
  function mixText(sec) {
    if (!sec) return '';
    const mix = PT.forms.sectionMix(sec);
    if (!mix.some(Boolean)) return 'Drawn from the banks together.';
    return 'Every form: ' + sec.pools.map((p, i) => mix[i] + ' from ' + p.title).join(', ') + '.';
  }

  function renderTotals() {
    const s = PT.forms.blueprintSummary(drawablePools());
    if ($('#tot-q')) $('#tot-q').textContent = s.questions;
    if ($('#tot-p')) $('#tot-p').textContent = s.points;
    const w = $('#blueprint-warnings');
    const notes = [];
    if (project.pools.length && !s.questions) notes.push(h('div', { class: 'notice warn', text: 'Set how many questions to draw from each pool. In Blackboard this is the “questions to display” number for each pool in the test. To draw from several banks together, use Combine with above.' }));
    project.pools.forEach(p => {
      const bad = p.questions.filter(q => q.excluded && BQ.validate(q, { images: project.images }).errors.length).length;
      if (bad) notes.push(h('div', { class: 'notice bad', text: '“' + p.title + '”: ' + plural(bad, 'question has', 'questions have') + ' a problem (for example no correct answer marked) and will not be drawn. Open Questions to fix them.' }));
    });
    if (s.questions) notes.push(h('div', { class: 'notice ok', text: 'Each form will have ' + plural(s.questions, 'question') + ' worth ' + s.points + ' points' + (project.exam.timeLimit ? ', with ' + project.exam.timeLimit + ' minutes.' : '.') }));
    w.replaceChildren(...notes);
  }

  function usageMap() { return PT.forms.usageStats(project.usage); }

  function browseList(p) {
    const stats = usageMap();
    return h('div', { class: 'qbrowse' }, p.questions.map((q, i) => {
      const v = BQ.validate(q, { images: project.images });
      const st = stats.get(q.key);
      const cb = h('input', { type: 'checkbox', checked: !q.excluded, title: 'Include in draws', 'aria-label': 'Include question ' + (i + 1) + ' in draws', onchange: (e) => { q.excluded = !e.target.checked; project.rev++; save(); renderBlueprint(); } });
      return h('div', null, cb, h('span', { class: 'chip', text: TYPE_SHORT[q.type] }),
        h('span', { class: 't', title: BQ.rt.toPlain(q.text) }, BQ.rt.summary(q.text, 140)),
        v.errors.length ? h('span', { class: 'chip bad', title: v.errors.join(' '), text: 'needs fixing' }) : null,
        st ? h('span', { class: 'chip', title: 'Last used ' + fmtDate(st.last), text: 'used ' + st.count + '×' }) : null,
        h('button', { type: 'button', class: 'small', onclick: () => openEditor({ pool: p, q }) }, 'Edit'));
    }));
  }

  /* =================================================================
     3. Generate
     ================================================================= */
  function bindSettingChecks(ids) {
    ids.forEach(id => {
      const el = $('#set-' + id);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = !!project.settings[id];
        el.onchange = () => { project.settings[id] = el.checked; save(); if (ui.step === 'review') renderReview(); };
      } else {
        el.value = project.settings[id];
        el.onchange = () => { project.settings[id] = el.type === 'number' ? Math.max(1, parseInt(el.value, 10) || 1) : el.value; save(); if (ui.step === 'review') renderReview(); };
      }
    });
  }

  function drawablePools() {
    return project.pools.map(p => Object.assign({}, p, { questions: p.questions.filter(q => !q.excluded) }));
  }

  function renderGenerate() {
    const g = project.gen;
    $('#gen-count').value = g.count;
    $('#gen-start').value = g.start || 'A';
    $('#gen-seed').value = g.seed;
    $('#gen-count').onchange = (e) => { g.count = Math.max(1, Math.min(26, parseInt(e.target.value, 10) || 1)); e.target.value = g.count; save(); renderPlanNote(); };
    $('#gen-start').onchange = (e) => { g.start = (e.target.value || 'A').toUpperCase().replace(/[^A-Z]/g, '') || 'A'; e.target.value = g.start; save(); };
    $('#gen-seed').onchange = (e) => { g.seed = e.target.value.trim() || PT.forms.newSeed(); save(); };
    $('#btn-reseed').onclick = () => { g.seed = PT.forms.newSeed(); $('#gen-seed').value = g.seed; save(); };
    bindSettingChecks(['shuffleQuestions', 'mixSections', 'shuffleOptions']);
    $('#btn-generate').onclick = () => {
      if (!PT.forms.sectionsOf(project.pools).some(s => s.draw > 0)) { toast('Set draw counts in the Blueprint first.'); return; }
      const printed = project.forms.filter(f => f.recordedAt).length;
      if (project.forms.length) {
        confirmBox('Replace the current forms?', 'The ' + plural(project.forms.length, 'form') + ' you have now will be replaced, including any edits.' + (printed ? ' Forms already exported stay in the usage history.' : ''), 'Replace', doGenerate);
      } else doGenerate();
    };
    renderPlanNote();
    renderGenResult();
    renderHistory();
  }

  function startIndex(code) {
    code = (code || 'A').toUpperCase();
    return code.length === 1 ? code.charCodeAt(0) - 65 : (code.charCodeAt(0) - 64) * 26 + code.charCodeAt(1) - 65;
  }

  function doGenerate() {
    const g = project.gen;
    const res = PT.forms.generate({ pools: drawablePools(), usage: project.usage, settings: project.settings }, g.count, g.seed, startIndex(g.start));
    res.forms.forEach(f => { f.rev = project.rev; });
    project.forms = res.forms;
    ui.form = 0;
    save();
    $('#gen-status').textContent = 'Generated ' + plural(res.forms.length, 'form') + ' from seed “' + g.seed + '”.';
    renderGenResult();
    renderStepper();
  }

  function renderPlanNote() {
    const X = project.gen.count;
    const line = (n, d, name, lead) => {
      const need = X * d;
      if (need <= n) return h('div', null, '✓ ', lead ? h('b', null, name) : name, ': ' + X + ' × ' + d + ' = ' + need + ' of ' + n + ' questions, so forms share none.');
      const lo = Math.floor(need / n), hi = Math.ceil(need / n);
      return h('div', null, '• ', lead ? h('b', null, name) : name, ': needs ' + need + ' draws from ' + n + ' questions, so each is used ' + (lo === hi ? lo : lo + '–' + hi) + ' times and forms will share some.');
    };
    const notes = blueprintSections().filter(s => s.draw > 0).map(sec => {
      if (sec.pools.length === 1) return line(sec.size, Math.min(sec.draw, sec.size), PT.forms.sectionName(sec), true);
      const mix = PT.forms.sectionMix(sec);
      return h('div', null, h('div', null, '▸ ', h('b', null, PT.forms.sectionName(sec)), ': ' + Math.min(sec.draw, sec.size) + ' per form from ' + plural(sec.pools.length, 'bank') + ' combined, the same mix on every form.'),
        h('div', { class: 'sec-lines' }, sec.pools.map((p, i) => mix[i] ? line(p.questions.length, mix[i], p.title, false) : h('div', null, '– ' + p.title + ': none on this draw (too small a share).'))));
    });
    $('#gen-status').replaceChildren(...(notes.length ? [h('div', { class: 'pool-notes' }, notes)] : []));
  }

  function overlapTable(forms) {
    const m = PT.forms.overlapMatrix(forms);
    return h('table', { class: 'overlap' },
      h('thead', null, h('tr', null, h('th', { text: '' }), forms.map(f => h('th', { text: f.code })))),
      h('tbody', null, forms.map((f, i) => h('tr', null, h('th', { text: f.code }), forms.map((g, j) => {
        const v = m[i][j];
        return h('td', { class: i === j ? 'self' : v ? 'some' : 'zero', title: i === j ? 'Questions on form ' + f.code : 'Questions shared by ' + f.code + ' and ' + g.code, text: String(v) });
      })))));
  }

  function renderGenResult() {
    const r = $('#gen-result');
    if (!project.forms.length) { r.replaceChildren(); return; }
    const stale = project.forms.some(f => f.rev !== project.rev);
    r.replaceChildren(h('div', { class: 'card' },
      h('h3', null, 'Overlap between forms'),
      h('p', { class: 'muted', text: 'Each cell counts the questions two forms share; the diagonal is the form’s length.' }),
      overlapTable(project.forms),
      stale ? h('div', { class: 'notice warn', text: 'The blueprint changed after these forms were generated. Generate again to apply it, or keep these forms as they are.' }) : null,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'primary', onclick: () => go('review') }, 'Review forms →'))));
  }

  function renderHistory() {
    const groups = new Map();
    project.usage.forEach(u => {
      const k = u.formId || u.form + u.at;
      if (!groups.has(k)) groups.set(k, { form: u.form, at: u.at, seed: u.seed, n: 0 });
      groups.get(k).n++;
    });
    $('#history-count').textContent = groups.size ? plural(groups.size, 'form') + ' recorded' : 'nothing recorded yet';
    const rows = Array.from(groups.values()).sort((a, b) => (a.at < b.at ? 1 : -1)).map(g =>
      h('div', { class: 'hist-row' }, h('b', null, 'Form ' + g.form), h('span', null, fmtDate(g.at)), h('span', { class: 'muted' }, plural(g.n, 'question') + (g.seed ? ' · seed ' + g.seed : ''))));
    const reset = h('button', { type: 'button', class: 'small danger', disabled: !groups.size, onclick: () => confirmBox('Clear the usage history?', 'New forms will no longer avoid questions that were already used.', 'Clear history', () => {
      project.usage = []; project.forms.forEach(f => { delete f.recordedAt; }); save(); renderHistory(); renderStepper();
    }, true) }, 'Clear history');
    $('#history-list').replaceChildren(...rows, h('div', { class: 'btn-row' }, reset));
  }

  /* =================================================================
     4. Review & edit
     ================================================================= */
  const screenCtx = () => ({ images: project.images, mode: 'screen' });
  const currentForm = () => project.forms[Math.min(ui.form, project.forms.length - 1)];

  function renderReview() {
    const has = project.forms.length > 0;
    $('#review-empty').hidden = has;
    $('#paper-stage').hidden = !has;
    $('#form-tabs').replaceChildren(...project.forms.map((f, i) => h('button', { type: 'button', class: i === ui.form ? 'active' : '', title: 'Form ' + f.code, onclick: () => { ui.form = i; renderReview(); } }, f.code)));
    const s = project.settings;
    $$('input[name=answerMode]').forEach(r => { r.checked = r.value === s.answerMode; r.onchange = () => { s.answerMode = r.value; if (s.answerMode === 'booklet' && ui.doc === 'sheet') ui.doc = 'booklet'; save(); renderReview(); }; });
    $$('input[name=sheetStyle]').forEach(r => { r.checked = r.value === s.sheetStyle; r.onchange = () => { s.sheetStyle = r.value; save(); renderReview(); }; });
    $('#sheet-style-wrap').hidden = s.answerMode !== 'sheet';
    bindSettingChecks(['showSections', 'showPoints', 'coverPage', 'largePrint', 'essayLines', 'paper']);
    if (s.answerMode !== 'sheet' && ui.doc === 'sheet') ui.doc = 'booklet';
    $$('#doc-tabs button').forEach(b => {
      b.hidden = b.dataset.doc === 'sheet' && s.answerMode !== 'sheet';
      b.classList.toggle('active', b.dataset.doc === ui.doc);
      b.onclick = () => { ui.doc = b.dataset.doc; renderReview(); };
    });
    if (!has) { $('#overlap-mini').replaceChildren(); return; }
    const form = currentForm();
    const d = PT.paper.documents(project, form, screenCtx(), [ui.doc])[0];
    const stage = $('#paper-stage');
    stage.innerHTML = PT.paper.toHtml(d, { tools: ui.doc === 'booklet' });
    stage.onclick = (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const item = form.items.find(it => it.id === b.parentNode.dataset.item);
      if (!item) return;
      if (b.dataset.act === 'edit') openEditor({ form, item });
      if (b.dataset.act === 'swap') openSwap(form, item);
    };
    // overlap with the other forms
    const keys = new Set(form.items.map(it => it.key));
    const others = project.forms.filter(f => f !== form).map(f => ({ code: f.code, n: f.items.filter(it => keys.has(it.key)).length }));
    $('#overlap-mini').replaceChildren(h('h4', null, 'Form ' + form.code),
      h('div', null, plural(form.items.length, 'question') + ' · ' + PT.forms.totalPoints(form) + ' points'),
      ...others.map(o => h('div', { class: o.n ? '' : 'muted' }, (o.n ? '• Shares ' + plural(o.n, 'question') : '✓ Shares nothing') + ' with ' + o.code)),
      ...(ui.doc === 'booklet' ? [h('p', { class: 'field-note', text: 'Hover a question to edit it or swap it for another from its pool.' })] : []));
  }

  /* ---------- question editor ---------- */
  function rebuildRightColumn(q) {
    if (q.type !== 'MAT') return;
    const want = q.pairs.map(p => p.right).concat(q.distractors || []);
    const col = (q.rightColumn || []).filter(r => want.includes(r));
    want.forEach(r => { if (!col.includes(r)) col.push(r); });
    q.rightColumn = col;
  }

  /**
   * ctx: { form, item }  edits the copy printed on one form (optionally also the pool question)
   *      { pool, q }     edits the pool question (future forms)
   */
  function openEditor(ctx) {
    const onForm = !!ctx.form;
    const src = onForm ? ctx.item.q : ctx.q;
    const draft = JSON.parse(JSON.stringify(src));
    let points = onForm ? ctx.item.points : null;
    let lines = onForm ? (ctx.item.lines || '') : null;
    const pool = onForm ? project.pools.find(p => p.id === ctx.item.poolId) : ctx.pool;
    const poolQ = onForm && pool ? pool.questions.find(q => q.key === ctx.item.key) : null;
    const alsoPool = h('input', { type: 'checkbox' });
    const preview = h('div', { class: 'preview' });
    const errBox = h('div');
    const fields = h('div');

    const ta = (value, rows, oninput, cls) => { const t = h('textarea', { rows: rows || 2, class: cls || '' }); t.value = value || ''; t.oninput = () => { oninput(t.value); refresh(); }; return t; };
    const inp = (value, oninput, attrs) => { const t = h('input', Object.assign({ type: 'text' }, attrs || {})); t.value = value == null ? '' : value; t.oninput = () => { oninput(t.value); refresh(); }; return t; };
    /** WYSIWYG field for formatted text (question, choices, matches, sample answer). */
    const rich = (value, oninput, o) => PT.wysiwyg(Object.assign({ value, images: () => project.images, notify: toast, onInput: (v) => { oninput(v); refresh(); } }, o || {})).el;
    /** A match was edited: keep its place in the printed right-hand column. */
    const renameRight = (oldV, newV) => {
      if (!draft.rightColumn) return;
      const k = draft.rightColumn.indexOf(oldV);
      if (k >= 0) draft.rightColumn[k] = newV;
    };
    let stemField = null;

    function refresh() {
      if (draft.type === 'FIB_PLUS') BQ.syncBlanks(draft);
      rebuildRightColumn(draft);
      const secPts = pool ? (PT.forms.sectionOfPool(project.pools, pool.id) || { points: pool.points }).points : 1;
      const fakeItem = { id: 'preview', q: draft, points: points == null ? secPts : points, lines: lines ? Number(lines) : null };
      const b = PT.paper.questionBlock(fakeItem, onForm ? ctx.form.items.indexOf(ctx.item) + 1 : 1, project, screenCtx());
      preview.innerHTML = PT.paper.toHtml({ kind: 'booklet', blocks: [b], settings: Object.assign({}, project.settings, { largePrint: false }) });
      const v = BQ.validate(draft, { images: project.images });
      errBox.replaceChildren(...v.errors.map(e => h('div', { class: 'notice bad', text: e })), ...v.warnings.map(e => h('div', { class: 'notice warn', text: e })));
    }

    /* layout helpers: a titled section, a list row, an "add" row, a remove button */
    const section = (title, hint, ...kids) => h('section', { class: 'ed-sec' },
      h('div', { class: 'ed-head' }, h('span', { class: 'ed-title' }, title), hint ? h('span', { class: 'ed-hint' }, hint) : null), ...kids);
    const addRow = (label, onclick, cls) => h('div', { class: 'ed-row ed-addrow ' + (cls || '') }, h('span'), h('span'),
      h('button', { type: 'button', class: 'ed-add', onclick }, h('span', { class: 'ed-plus', 'aria-hidden': 'true' }, '+'), label), h('span'));
    const removeBtn = (label, onclick) => h('button', { type: 'button', class: 'ed-x', title: label, 'aria-label': label, onclick }, '×');

    function build() {
      const parts = [];
      let blankDraw = null;
      stemField = PT.wysiwyg({
        value: draft.text, images: () => project.images, notify: toast, blanks: draft.type === 'FIB_PLUS', label: 'Question',
        onInput: (v) => {
          draft.text = v;
          if (draft.type === 'FIB_PLUS') {
            const before = draft.blanks.map(b => b.name).join();
            BQ.syncBlanks(draft);
            if (blankDraw && draft.blanks.map(b => b.name).join() !== before) blankDraw();
          }
          refresh();
        }
      });
      stemField.el.classList.add('wy-q');
      parts.push(section('Question', null, stemField.el));

      if (draft.type === 'MC' || draft.type === 'MA') {
        const list = h('div', { class: 'ed-list ed-choices' });
        const draw = () => list.replaceChildren(
          ...draft.options.map((o, i) => h('div', { class: 'ed-row' },
            h('label', { class: 'ed-mark', title: draft.type === 'MC' ? 'Correct answer' : 'A correct answer' },
              h('input', { type: draft.type === 'MC' ? 'radio' : 'checkbox', name: 'ed-correct', checked: o.correct, 'aria-label': 'Choice ' + BQ.letter(i) + ' is correct', onchange: (e) => { if (draft.type === 'MC') draft.options.forEach(x => { x.correct = false; }); o.correct = e.target.checked; draw(); refresh(); } })),
            h('span', { class: 'ed-lab' + (o.correct ? ' ok' : '') }, BQ.letter(i)),
            rich(o.text, v => { o.text = v; }, { compact: true, mini: true, label: 'Choice ' + BQ.letter(i) }),
            removeBtn('Remove choice ' + BQ.letter(i), () => { draft.options.splice(i, 1); draw(); refresh(); }))),
          addRow('Add choice', () => { draft.options.push({ text: '', correct: false }); draw(); refresh(); focusLast(list); }));
        draw();
        parts.push(section('Answer choices', (draft.type === 'MC' ? 'Select the correct one' : 'Tick every correct one') + (onForm ? ' · in this form’s printed order' : ''), list));
      }
      if (draft.type === 'TF') {
        const seg = h('div', { class: 'ed-seg', role: 'radiogroup', 'aria-label': 'Correct answer' });
        const draw = () => seg.replaceChildren(...[true, false].map(v => h('button', { type: 'button', role: 'radio', 'aria-checked': String(draft.tf === v), class: draft.tf === v ? 'on' : '', onclick: () => { draft.tf = v; draw(); refresh(); } }, v ? 'True' : 'False')));
        draw();
        parts.push(section('Correct answer', null, seg));
      }
      if (draft.type === 'MAT') {
        const pairs = h('div', { class: 'ed-list ed-pairs' });
        const extras = h('div', { class: 'ed-list ed-extras' });
        const drawPairs = () => pairs.replaceChildren(
          h('div', { class: 'ed-row ed-colhead' }, h('span'), h('span', null, 'Prompt'), h('span', null, 'Match'), h('span')),
          ...draft.pairs.map((p, i) => h('div', { class: 'ed-row' },
            h('span', { class: 'ed-lab' }, String(i + 1)),
            rich(p.left, v => { p.left = v; }, { compact: true, mini: true, label: 'Prompt ' + (i + 1) }),
            rich(p.right, v => { renameRight(p.right, v); p.right = v; }, { compact: true, mini: true, label: 'Match ' + (i + 1) }),
            removeBtn('Remove pair ' + (i + 1), () => { draft.pairs.splice(i, 1); drawPairs(); refresh(); }))),
          h('div', { class: 'ed-row ed-addrow' }, h('span'),
            h('button', { type: 'button', class: 'ed-add ed-span2', onclick: () => { draft.pairs.push({ left: '', right: '' }); drawPairs(); refresh(); focusLast(pairs); } }, h('span', { class: 'ed-plus', 'aria-hidden': 'true' }, '+'), 'Add pair'), h('span')));
        const drawExtras = () => extras.replaceChildren(
          ...(draft.distractors || []).map((d, i) => h('div', { class: 'ed-row' },
            h('span', { class: 'ed-lab ed-muted' }, '+'),
            rich(d, v => { renameRight(draft.distractors[i], v); draft.distractors[i] = v; }, { compact: true, mini: true, label: 'Extra match ' + (i + 1) }),
            removeBtn('Remove extra match ' + (i + 1), () => { draft.distractors.splice(i, 1); drawExtras(); refresh(); }))),
          h('div', { class: 'ed-row ed-addrow' }, h('span'),
            h('button', { type: 'button', class: 'ed-add', onclick: () => { draft.distractors = (draft.distractors || []).concat(['']); drawExtras(); refresh(); focusLast(extras); } }, h('span', { class: 'ed-plus', 'aria-hidden': 'true' }, '+'), 'Add extra match'), h('span')));
        drawPairs();
        drawExtras();
        parts.push(section('Pairs', 'Each prompt and its match', pairs));
        parts.push(section('Extra matches', 'Optional · fit no prompt, so guessing is harder', extras));
      }
      if (draft.type === 'FIB') {
        parts.push(section('Accepted answers', 'One per line', ta(draft.answers.join('\n'), 3, v => { draft.answers = v.split('\n').map(x => x.trim()).filter(Boolean); })));
      }
      if (draft.type === 'FIB_PLUS') {
        BQ.syncBlanks(draft);
        const list = h('div', { class: 'ed-list ed-blanks' });
        const draw = () => list.replaceChildren(...(draft.blanks.length ? draft.blanks.map((b, i) => h('div', { class: 'ed-row' },
          h('span', { class: 'ed-lab ed-blankname', title: 'Blank [' + b.name + ']' }, String(i + 1)),
          h('span', { class: 'ed-bname' }, b.name),
          inp(b.answers.join(' / '), v => { b.answers = v.split('/').map(x => x.trim()).filter(Boolean); }, { 'aria-label': 'Accepted answers for blank ' + b.name, placeholder: 'e.g. AVG / average' }),
          h('span'))) : [h('p', { class: 'ed-empty' }, 'No blanks yet. Put the caret in the question and use the [ _ ] button.')]));
        draw();
        blankDraw = draw;
        parts.push(section('Accepted answers per blank', 'Separate alternatives with “/”', list));
      }
      if (draft.type === 'NUM') {
        parts.push(section('Correct answer', null, h('div', { class: 'ed-inline' },
          h('label', null, 'Answer', inp(draft.num.answer, v => { draft.num.answer = v; }, { inputmode: 'decimal' })),
          h('label', null, 'Accept ±', inp(draft.num.tolerance, v => { draft.num.tolerance = v; }, { inputmode: 'decimal', placeholder: 'exact' })))));
      }
      if (draft.type === 'ESS') {
        parts.push(section('Sample answer / grading notes', 'Printed on the answer key', rich(draft.sample, v => { draft.sample = v; }, { label: 'Sample answer' })));
      }
      if (onForm) {
        parts.push(h('div', { class: 'ed-meta' },
          h('label', null, 'Points on this form', inp(points, v => { points = Number(v) || 0; }, { type: 'number', min: 0, step: 0.5 })),
          draft.type === 'ESS' ? h('label', null, 'Answer lines', inp(lines, v => { lines = v.replace(/\D/g, ''); }, { type: 'number', min: 2, max: 60, placeholder: String(project.settings.essayLines) })) : null));
      }
      fields.replaceChildren(...parts);
    }
    function focusLast(list) {
      const areas = list.querySelectorAll('.wy-area');
      if (areas.length) areas[areas.length - 1].focus();
    }

    build();
    refresh();
    const body = [
      h('div', { class: 'edit-grid' }, h('div', { class: 'ed-fields' }, fields), h('div', { class: 'ed-side' }, h('div', { class: 'ed-title' }, 'Printed preview'), preview, errBox)),
      onForm && poolQ ? h('label', { class: 'check', style: 'margin-top:.8rem' }, alsoPool, ' Also save the wording and answers to the pool question, for future forms') : null,
      !onForm ? h('p', { class: 'field-note', text: 'Changes apply to forms you generate from now on. Forms already generated keep their own copy.' }) : null
    ];
    $('#modal .modal-box').classList.add('wide');
    setTimeout(() => stemField && stemField.focus(), 60);
    openModal((onForm ? 'Edit question ' + (ctx.form.items.indexOf(ctx.item) + 1) + ' on Form ' + ctx.form.code : 'Edit pool question') + ' · ' + BQ.TYPE_LABEL[draft.type], body, [
      { label: 'Cancel', onclick: closeModal },
      { label: 'Save', primary: true, onclick: () => {
        if (draft.type === 'FIB_PLUS') BQ.syncBlanks(draft);
        if (draft.distractors) draft.distractors = draft.distractors.filter(d => BQ.rt.toPlain(d).trim() || BQ.rt.imagesIn(d).length);
        rebuildRightColumn(draft);
        if (onForm) {
          ctx.item.q = draft;
          ctx.item.points = points;
          ctx.item.lines = lines ? Number(lines) : null;
          ctx.item.edited = true;
          if (alsoPool.checked && poolQ) applyToPool(poolQ, draft, src);
        } else {
          const key = ctx.q.key, excluded = ctx.q.excluded;
          Object.assign(ctx.q, draft, { key, excluded: excluded && BQ.validate(draft, { images: project.images }).errors.length > 0 });
          delete ctx.q.rightColumn;
        }
        save();
        closeModal();
        if (ui.step === 'review') {
          renderReview();
          const el = $('.pp-q[data-item="' + (onForm ? ctx.item.id : '') + '"]');
          if (el) el.classList.add('flash');
        } else renderBlueprint();
        toast('Saved.');
      } }
    ]);
  }

  /**
   * Copy a form edit back to the pool question, keeping the pool's own choice order.
   * printed: the form's copy before the edit (its choices are a permutation of the pool's).
   */
  function applyToPool(poolQ, draft, printed) {
    poolQ.text = draft.text;
    poolQ.sample = draft.sample;
    poolQ.tf = draft.tf;
    poolQ.answers = draft.answers.slice();
    poolQ.blanks = JSON.parse(JSON.stringify(draft.blanks));
    poolQ.num = Object.assign({}, draft.num);
    poolQ.pairs = JSON.parse(JSON.stringify(draft.pairs));
    poolQ.distractors = (draft.distractors || []).slice();
    if (draft.type === 'MC' || draft.type === 'MA') {
      const before = poolQ.options;
      if (before.length === draft.options.length && printed.options.length === draft.options.length) {
        const used = new Set();
        const next = before.map(o => Object.assign({}, o));
        printed.options.forEach((po, i) => {
          const j = before.findIndex((b, k) => !used.has(k) && b.text === po.text);
          if (j >= 0) { used.add(j); next[j] = { text: draft.options[i].text, correct: draft.options[i].correct }; }
        });
        poolQ.options = used.size === before.length ? next : JSON.parse(JSON.stringify(draft.options));
      } else {
        poolQ.options = JSON.parse(JSON.stringify(draft.options));
      }
    }
    project.rev++;
  }

  /* ---------- swap ---------- */
  function openSwap(form, item) {
    const pool = project.pools.find(p => p.id === item.poolId);
    if (!pool) { toast('The pool for this question was removed.'); return; }
    const stats = usageMap();
    const onForms = new Map();
    project.forms.forEach(f => f.items.forEach(it => { if (!onForms.has(it.key)) onForms.set(it.key, []); onForms.get(it.key).push(f.code); }));
    const thisForm = new Set(form.items.map(it => it.key));
    const candidates = pool.questions.filter(q => !q.excluded)
      .map(q => ({ q, others: (onForms.get(q.key) || []).filter(c => c !== form.code), st: stats.get(q.key) }))
      .sort((a, b) => (a.q.key === item.key ? -1 : b.q.key === item.key ? 1 : 0) || a.others.length - b.others.length || ((a.st ? a.st.count : 0) - (b.st ? b.st.count : 0)));
    const list = h('div', { class: 'swap-list' }, candidates.map(c => {
      const current = c.q.key === item.key;
      const dup = !current && thisForm.has(c.q.key);
      return h('div', { class: 'swap-item' + (current ? ' current' : '') },
        h('div', null, h('div', { class: 't' }, BQ.rt.summary(c.q.text, 180)),
          h('div', { class: 'chips' }, h('span', { class: 'chip', text: TYPE_SHORT[c.q.type] }),
            current ? h('span', { class: 'chip ok', text: 'on this form now' }) : null,
            dup ? h('span', { class: 'chip bad', text: 'already on this form' }) : null,
            c.others.length ? h('span', { class: 'chip warn', text: 'on form ' + c.others.join(', ') }) : (!current ? h('span', { class: 'chip ok', text: 'on no other form' }) : null),
            c.st ? h('span', { class: 'chip', text: 'used ' + c.st.count + '× · last ' + fmtDate(c.st.last) }) : h('span', { class: 'chip', text: 'never used' }))),
        current || dup ? h('span') : h('button', { type: 'button', class: 'small primary', onclick: () => {
          const it = PT.forms.swapItem({ pools: drawablePools(), settings: project.settings }, form, item.id, c.q.key);
          save(); closeModal(); renderReview();
          const el = it && $('.pp-q[data-item="' + it.id + '"]');
          if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
          toast('Swapped. ' + (c.others.length ? 'This question is also on form ' + c.others.join(', ') + '.' : 'No other form has this question.'));
        } }, 'Use this'));
    }));
    const sec = PT.forms.sectionOfPool(project.pools, pool.id);
    const combined = sec && sec.pools.length > 1;
    openModal('Swap question ' + (form.items.indexOf(item) + 1) + ' on Form ' + form.code + ' · ' + (combined ? PT.forms.sectionName(sec) + ' · ' + pool.title : (pool.label || pool.title)), [h('p', { class: 'muted', text: combined
      ? 'Questions from the same bank, “' + pool.title + '”, so every form keeps the same mix of banks in this section. Those on no other form, and used least, are listed first.'
      : 'Questions from the same pool. Those on no other form, and used least, are listed first.' }), list], [{ label: 'Close', onclick: closeModal }]);
  }

  /* =================================================================
     5. Export
     ================================================================= */
  function docName(form, kind, ext) {
    const label = { booklet: 'booklet', sheet: 'answer-sheet', key: 'answer-key' }[kind];
    return slug(project.exam.title || 'exam') + '-form-' + form.code + '-' + label + '.' + ext;
  }

  function recordUsage(form) {
    if (!project.settings.recordUsage || form.recordedAt) return;
    const at = new Date().toISOString();
    form.items.forEach(it => project.usage.push({ key: it.key, form: form.code, formId: form.id, seed: form.seed, at }));
    form.recordedAt = at;
    save();
  }

  /** Rasterize pictures Word can't show (SVG, WebP) and measure all pictures. */
  async function prepareImages() {
    const tasks = Object.keys(project.images).map(async name => {
      const im = project.images[name];
      if (im.w && (im.pngData || /png|jpeg|gif/.test(im.type))) return;
      await new Promise(res => {
        const img = new Image();
        img.onload = () => {
          im.w = img.naturalWidth || 400; im.h = img.naturalHeight || 300;
          if (!/png|jpeg|gif/.test(im.type)) {
            const c = document.createElement('canvas');
            c.width = im.w; c.height = im.h;
            c.getContext('2d').drawImage(img, 0, 0);
            im.pngData = c.toDataURL('image/png').split(',')[1];
          }
          res();
        };
        img.onerror = res;
        img.src = 'data:' + im.type + ';base64,' + im.data;
      });
    });
    await Promise.all(tasks);
  }

  async function wordFile(form, kind) {
    await prepareImages();
    const d = PT.paper.documents(project, form, { images: project.images, mode: 'docx' }, [kind])[0];
    return PT.docx.build(d, { images: project.images });
  }

  const cssString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
  function printDocs(list) {
    if (!list.length) return;
    if (inPreviewFrame()) {
      openModal('Printing is blocked in this preview', h('p', null, 'This preview window does not allow the print dialog. Use the Word buttons here, or open the Paper Test Editor from its own site (for example GitHub Pages), where PDF export works.'), [{ label: 'OK', primary: true, onclick: closeModal }]);
      return false;
    }
    const s = project.settings;
    const size = s.paper === 'a4' ? 'A4' : 'letter';
    const root = $('#print-root');
    const many = list.length > 1;
    root.innerHTML = list.map((d, i) => PT.paper.toHtml(d).replace('<article ', '<article style="page: p' + i + '" ')).join('');
    const box = 'font: 8pt Calibri, Carlito, "PTE Paper Sans", sans-serif; color: #555;';
    $('#page-style').textContent = list.map((d, i) => '@page p' + i + ' { size: ' + size + '; margin: 0.75in 0.75in 0.85in; ' +
      '@bottom-left { content: ' + cssString(d.footer) + '; ' + box + ' } ' +
      '@bottom-right { content: "Page " counter(page)' + (many ? '' : ' " of " counter(pages)') + '; ' + box + ' } }').join('\n') +
      '\n@page { size: ' + size + '; margin: 0.75in 0.75in 0.85in; }';
    const prevTitle = document.title;
    document.title = list.length === 1 ? docName({ code: list[0].code }, list[0].kind, '').replace(/\.$/, '') : slug(project.exam.title) + '-all-forms';
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); document.title = prevTitle; root.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('printing') && !matchMedia('print').matches) done(); }, 1500); }, 60);
    return true;
  }

  function renderExport() {
    const s = project.settings;
    const kinds = s.answerMode === 'sheet' ? ['booklet', 'sheet', 'key'] : ['booklet', 'key'];
    const labels = { booklet: 'Test booklet', sheet: 'Answer sheet', key: 'Answer key' };
    const list = $('#export-list');
    if (!project.forms.length) { list.replaceChildren(h('div', { class: 'empty', text: 'Generate forms first (step 3).' })); }
    else list.replaceChildren(...project.forms.map(form => h('div', { class: 'card export-form' },
      h('div', { class: 'code', title: 'Form ' + form.code }, form.code),
      h('div', null,
        h('div', { class: 'export-docs' }, kinds.map(k => h('div', null, h('b', null, labels[k]), h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'small', onclick: () => { if (printDocs(PT.paper.documents(project, form, screenCtx(), [k])) && k === 'booklet') recordUsage(form); renderExportMeta(); } }, 'PDF'),
          h('button', { type: 'button', class: 'small', onclick: async () => { if (k === 'booklet') recordUsage(form); download(docName(form, k, 'docx'), await wordFile(form, k), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); renderExportMeta(); } }, 'Word'))))),
        h('div', { class: 'export-meta', 'data-form': form.id })))));
    $('#batch-sheet').closest('label').hidden = s.answerMode !== 'sheet';
    bindSettingChecks(['recordUsage']);
    $('#btn-batch-docx').onclick = async () => {
      if (!project.forms.length) return;
      const files = [];
      for (const form of project.forms) {
        for (const k of selectedBatchKinds()) {
          files.push({ name: 'form-' + form.code + '/' + docName(form, k, 'docx'), bytes: await wordFile(form, k) });
          if (k === 'booklet') recordUsage(form);
        }
      }
      download(slug(project.exam.title) + '-forms-' + project.forms.map(f => f.code).join('') + '.zip', PT.zip.zip(files), 'application/zip');
      renderExportMeta();
    };
    $('#btn-batch-print').onclick = () => {
      const docs = [];
      project.forms.forEach(form => docs.push(...PT.paper.documents(project, form, screenCtx(), selectedBatchKinds())));
      if (printDocs(docs) && selectedBatchKinds().includes('booklet')) project.forms.forEach(recordUsage);
      renderExportMeta();
    };
    renderExportMeta();
  }
  function selectedBatchKinds() {
    return ['booklet', 'sheet', 'key'].filter(k => $('#batch-' + k).checked && (k !== 'sheet' || project.settings.answerMode === 'sheet'));
  }
  function renderExportMeta() {
    project.forms.forEach(f => {
      const el = $('.export-meta[data-form="' + f.id + '"]');
      if (el) el.textContent = plural(f.items.length, 'question') + ' · ' + PT.forms.totalPoints(f) + ' points · seed “' + f.seed + '”' + (f.recordedAt ? ' · recorded in usage history ' + fmtDate(f.recordedAt) : '');
    });
    renderStepper();
  }

  /* =================================================================
     Project files
     ================================================================= */
  function offerOpenProject(data, name) {
    confirmBox('Open ' + name + '?', 'This replaces the exam you are working on now. Save it first if you want to keep it.', 'Open project', () => {
      project = normalizeProject(data.project || data);
      save();
      go(project.forms.length ? 'review' : 'blueprint');
      toast('Opened ' + name + '.');
    });
  }
  function saveProjectFile() {
    const data = JSON.stringify({ app: 'paper-test-editor', version: 1, savedAt: new Date().toISOString(), project }, null, 1);
    download(slug(project.exam.title || 'exam') + '.ptest.json', data, 'application/json');
  }

  /* =================================================================
     Start
     ================================================================= */
  function wire() {
    $$('#stepper button').forEach(b => { b.onclick = () => go(b.dataset.step); });
    $$('[data-goto]').forEach(b => { b.onclick = () => go(b.dataset.goto); });
    const drop = $('#drop');
    $('#file-banks').onchange = (e) => { importFiles(Array.from(e.target.files)); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); if (ui.step === 'import') drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === drop) drop.classList.remove('over'); }));
    document.addEventListener('drop', (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      if (ui.step !== 'import') go('import');
      importFiles(files);
    });
    $('#btn-samples').onclick = loadSamples;
    $('#btn-new').onclick = () => confirmBox('Start a new project?', 'Pools, forms and the usage history in this browser are cleared. Save the project first if you want to keep it.', 'Start a new project', () => {
      project = emptyProject(); ui.form = 0; save(); go('import');
    }, true);
    $('#btn-save').onclick = saveProjectFile;
    $('#btn-open').onclick = () => $('#file-project').click();
    $('#file-project').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data && data.app === 'paper-test-editor') offerOpenProject(data, f.name);
        else importFiles([f]);
      } catch (err) { toast('That file is not a Paper Test Editor project.'); }
    };
    $('#btn-credits').onclick = creditsModal;
    $('#btn-credits-foot').onclick = creditsModal;
    $('#skin').onchange = (e) => setSkin(e.target.value, true);
    $$('[data-theme-choice]').forEach(b => { b.onclick = () => setTheme(b.dataset.themeChoice, true); });
    setSkin(document.documentElement.getAttribute('data-skin'), false);
    $('#modal-x').onclick = closeModal;
    $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  }

  /* ---------- appearance: Style and Day / Night / Auto (js/theme.js applies them before paint) ---------- */
  const THEME_KEY = 'pte:theme';
  const SKIN_KEY = 'pte:skin';
  const SKINS = ['paper', 'system', 'win98', 'xp', 'win7', 'pico', 'mvp', 'new', 'sakura'];
  const LIGHT_ONLY = new Set(['system', 'win98', 'xp', 'win7']);
  const pref = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  let themeChoice = pref.get(THEME_KEY) || 'auto';
  let skin = 'paper';
  function setTheme(choice, save) {
    if (choice !== 'light' && choice !== 'dark') choice = 'auto';
    themeChoice = choice;
    const lightOnly = LIGHT_ONLY.has(skin);
    const effective = lightOnly ? 'light' : choice;
    if (effective === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', effective);
    $$('[data-theme-choice]').forEach(b => {
      b.setAttribute('aria-pressed', String(!lightOnly && b.dataset.themeChoice === choice));
      b.disabled = lightOnly;
    });
    const sw = $('.theme-switch');
    if (sw) sw.title = lightOnly ? 'This style has a light look only. Day and Night work with Paper and the clean styles.' : '';
    if (save) pref.set(THEME_KEY, choice);
  }
  function setSkin(name, save) {
    skin = SKINS.includes(name) ? name : 'paper';
    document.documentElement.setAttribute('data-skin', skin);
    $('#skin').value = skin;
    setTheme(themeChoice, false);
    if (save) pref.set(SKIN_KEY, skin);
  }

  /* ---------- credits ---------- */
  function creditsModal() {
    const item = (name, url, what) => h('li', null,
      h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, name),
      h('span', { class: 'what' }, what));
    const group = (title, items) => [h('h3', null, title), h('ul', { class: 'credits-list' }, items)];
    const body = h('div', { class: 'credits' },
      h('p', null, 'This editor stands on the shoulders of an earlier tool, published standards, open-source projects and their documentation writers. Thank you.'),
      group('The companion editor', [
        item('Blackboard Question Editor', 'https://github.com/liu-yihong/blackboard-question-editor',
          'The question model, the rich-text markup, math rendering, the picture and table tools, the zip writer and the .bbq.json project format all come from this sister project, so a question looks and behaves the same in both tools. MIT licence.')
      ]),
      group('Blackboard question banks', [
        item('Anthology: Question Banks (Ultra)', 'https://help.anthology.com/blackboard/instructor/en/assessments/questions/reuse-questions/question-banks.html',
          'How question banks are exported and imported, and which question types they carry.'),
        item('Moodle: Blackboard import test fixtures', 'https://github.com/moodle/moodle/tree/main/public/question/format/blackboard_six/tests/fixtures',
          'Real Blackboard pool exports, used through the Question Editor as the reference for how each question type is laid out in a pool .zip. GPL v3; no code copied.'),
        item('senkyoshi by Atomic Jolt', 'https://github.com/atomicjolt/senkyoshi',
          'A Blackboard-to-Canvas converter whose pool fixture was a second real export to check the layouts against. AGPL v3; no code copied.'),
        item('R/exams: exams2blackboard', 'http://www.r-exams.org/tutorials/exams2blackboard/',
          'An open-source writer of Blackboard pool packages; a reference for the package manifest. GPL; no code copied.')
      ]),
      group('Standards behind the exports', [
        item('ECMA-376 Office Open XML', 'https://ecma-international.org/publications-and-standards/standards/ecma-376/',
          'The Word (.docx) file format, including Office Math (OMML), which the Word export writes so equations stay editable.'),
        item('W3C MathML Core', 'https://www.w3.org/TR/mathml-core/', 'The math markup that KaTeX produces and the Word export converts to Word equations.'),
        item('W3C CSS Paged Media', 'https://www.w3.org/TR/css-page-3/', 'Page sizes and the page-margin boxes that print “Page X of Y” and the form code on every PDF page.'),
        item('PKWARE .ZIP File Format Specification (APPNOTE)', 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT', 'The zip layout read on import and written for Word files and batch exports.'),
        item('WHATWG Compression Streams', 'https://compression.spec.whatwg.org/', 'The browser’s built-in DecompressionStream, which unpacks deflated entries in Blackboard exports without any library.')
      ]),
      group('Form generation', [
        item('PRNGs and hashes collected by bryc', 'https://github.com/bryc/code/blob/master/jshash/PRNGs.md',
          'The cyrb53 string hash (by bryc) and the Mulberry32 generator (by Tommy Ettinger) that turn a seed into the same forms every time. Public domain.'),
        item('Fisher–Yates shuffle', 'https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle', 'The unbiased shuffle used for question order and answer choices.')
      ]),
      group('Open-source software and fonts', [
        item('KaTeX', 'https://katex.org/', 'Renders LaTeX math on screen, in print and for the Word export. MIT licence.'),
        item('Carlito by Łukasz Dziedzic (tyPoland)', 'https://fonts.google.com/specimen/Carlito',
          'Metric-compatible with Calibri, so the PDF breaks lines like the Word file. A Latin subset ships here, renamed “PTE Paper Sans”, for devices that have neither font. SIL Open Font License.'),
        item('IBM Plex', 'https://github.com/IBM/plex', 'Fallback interface typeface, served from this site only when a device has none of the usual system fonts. SIL Open Font License.'),
        item('Inter by Rasmus Andersson', 'https://rsms.me/inter/', 'Typeface of the new.css style, served from this site and downloaded only when that style is on. SIL Open Font License.'),
        item('Noto Emoji by Google', 'https://fonts.google.com/noto/specimen/Noto+Emoji', 'The logo and favicon: its monochrome writing hand (✍), bold weight, converted to vector paths so no emoji font is loaded. SIL Open Font License.'),
        item('Fontsource', 'https://fontsource.org/', 'Packaging of the IBM Plex, Inter and Noto Emoji font files.')
      ]),
      group('Styles', [
        item('System.css by sakofchit', 'https://github.com/sakofchit/system.css', 'Inspired the System (classic Mac) style.'),
        item('98.css by Jordan Scales', 'https://github.com/jdan/98.css', 'Inspired the Windows 98 style.'),
        item('XP.css by botoxparty', 'https://github.com/botoxparty/XP.css', 'Inspired the Windows XP style.'),
        item('7.css by khang-nd', 'https://github.com/khang-nd/7.css', 'Inspired the Windows 7 style.'),
        item('Pico CSS', 'https://picocss.com/', 'Inspired the Pico style.'),
        item('MVP.css by Andy Brewer', 'https://andybrewer.github.io/mvp/', 'Inspired the MVP style.'),
        item('new.css', 'https://newcss.net/', 'Inspired the new.css style.'),
        item('Sakura by oxalorg', 'https://github.com/oxalorg/sakura', 'Inspired the Sakura style.')
      ]),
      h('p', { class: 'fineprint' }, 'Each style is re-created in this page’s own CSS rather than loading those frameworks, so the editor works the same way in every look, and the printed papers never change. All of them are MIT-licensed projects.'),
      group('Built with', [
        item('Claude by Anthropic', 'https://www.anthropic.com/claude', 'AI assistant that wrote the code of this editor with the project owner.'),
        item('GitHub Pages', 'https://pages.github.com/', 'Free static hosting.')
      ]),
      h('p', { class: 'fineprint' }, 'Blackboard is a trademark of Anthology Inc. Microsoft Word and Calibri are trademarks of Microsoft Corporation. This is an independent project, not affiliated with or endorsed by either company.')
    );
    openModal('Credits', body, [{ label: 'Close', primary: true, onclick: closeModal }]);
  }

  wire();
  storeGet().then(saved => {
    if (saved && saved.app === 'paper-test-editor') project = normalizeProject(saved);
    $('#project-name').textContent = project.exam.title || 'Untitled exam';
    go(project.forms.length ? 'review' : project.pools.length ? 'blueprint' : 'import', { initial: true });
  });
})();
