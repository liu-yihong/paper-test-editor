/*
 * The three paper documents for a form — test booklet, answer sheet, answer key —
 * described once as a list of blocks, then drawn as print HTML (here) or as Word (docx.js).
 */
(function () {
  'use strict';
  const PT = (globalThis.PT = globalThis.PT || {});
  const esc = (s) => BQ.rt.escapeHtml(String(s == null ? '' : s));
  const L = (i) => BQ.letter(i);

  const DEFAULT_SETTINGS = {
    shuffleQuestions: true, mixSections: false, shuffleOptions: true,
    answerMode: 'sheet',        // 'sheet' (separate answer sheet) | 'booklet' (answer on the test)
    sheetStyle: 'bubbles',      // 'bubbles' | 'letters'
    showSections: true, showPoints: true, coverPage: false,
    essayLines: 10, largePrint: false, paper: 'letter'
  };

  /* ---------- rich text ---------- */
  /** Markup → HTML. mode 'screen' gives pictures as data URLs; 'docx' leaves picture names for the Word writer. */
  function rich(src, ctx) {
    const images = (ctx && ctx.images) || {};
    return BQ.rt.toHtml(src || '', {
      math: 'mathml',
      image: (name) => {
        if (!Object.prototype.hasOwnProperty.call(images, name)) return null;
        return ctx.mode === 'docx' ? 'pt-img:' + name : (images[name].url || 'data:' + images[name].type + ';base64,' + images[name].data);
      }
    });
  }

  /** Fill-in-multiple-blanks: [name] → a numbered blank line (outside code and math). */
  function numberBlanks(text, names) {
    const parts = String(text || '').split(/(`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/);
    return parts.map((p, i) => (i % 2 ? p : p.replace(/(^|[^\\])\[([A-Za-z][A-Za-z0-9_-]{0,39})\]/g, (m, pre, n) => {
      const k = names.indexOf(n);
      if (k < 0) return m;
      return pre + '<u>' + ' '.repeat(6) + '(' + (k + 1) + ')' + ' '.repeat(6) + '</u>';
    }))).join('');
  }

  const ptsLabel = (p) => { const n = Number(p) || 0; return n + (n === 1 ? ' pt' : ' pts'); };
  const minutes = (m) => { const n = Number(m) || 0; return n ? n + ' minutes' : ''; };

  /* ---------- answers, for the key ---------- */
  function answerText(it) {
    const q = it.q;
    switch (q.type) {
      case 'MC': { const k = q.options.findIndex(o => o.correct); return k < 0 ? '—' : L(k); }
      case 'MA': return q.options.map((o, i) => (o.correct ? L(i) : null)).filter(Boolean).join(', ') || '—';
      case 'TF': return q.tf === true ? 'True' : q.tf === false ? 'False' : '—';
      case 'MAT': return q.pairs.map((p, i) => (i + 1) + '–' + (q.rightColumn ? L(q.rightColumn.indexOf(p.right)) : L(i))).join(',  ');
      case 'FIB': return q.answers.filter(a => a.trim()).join('  /  ');
      case 'FIB_PLUS': {
        const names = BQ.blanksInText(q.text);
        return names.map((n, i) => '(' + (i + 1) + ') ' + ((q.blanks.find(b => b.name === n) || { answers: [] }).answers.filter(Boolean).join(' / ') || '—')).join(';  ');
      }
      case 'NUM': {
        const t = String(q.num.tolerance || '').trim();
        return q.num.answer + (t && parseFloat(t) > 0 ? '  (accept ± ' + t + ')' : '');
      }
      case 'ESS': return 'Graded by rubric';
    }
    return '';
  }

  /* ---------- documents as blocks ---------- */
  function sectionsOf(project, form) {
    const s = project.settings;
    if (!s.showSections || s.mixSections) return null;
    return PT.forms.sectionsOf(project.pools);
  }
  /** Which part an item prints under: its section (forms made before sections: its pool). */
  const partKey = (it) => it.sectionId || it.poolId;
  function findSection(secs, it) {
    return secs.find(x => x.id === partKey(it)) || secs.find(x => x.pools.some(p => p.id === it.poolId)) || null;
  }

  function header(project, form, docLabel, variant) {
    const e = project.exam;
    const info = [];
    if (e.timeLimit) info.push({ label: 'Time limit', value: minutes(e.timeLimit) });
    info.push({ label: 'Questions', value: String(form.items.length) });
    if (project.settings.showPoints) info.push({ label: 'Total points', value: String(PT.forms.totalPoints(form)) });
    return { k: 'header', variant: variant || 'compact', course: e.course || '', title: e.title || 'Exam', doc: docLabel, code: form.code, info };
  }

  /** The closing line printed after the last question (markup). undefined → the default for the answer mode. */
  function defaultEndText(settings) {
    return settings.answerMode === 'sheet'
      ? '<strong>End of test.</strong> Check that your name and form code are on the answer sheet.'
      : '<strong>End of test.</strong> Check that your name is on the first page.';
  }
  function endText(project) {
    const t = project.exam.endText;
    return t == null ? defaultEndText(project.settings) : t;
  }

  /** Parts of a form (sections in print order) with their points, for the cover's grading table. */
  function partsOf(project, form) {
    const out = [];
    const secs = PT.forms.sectionsOf(project.pools);
    form.items.forEach(it => {
      let p = out.find(x => x.key === partKey(it));
      if (!p) {
        const sec = findSection(secs, it);
        p = { key: partKey(it), label: sec ? PT.forms.sectionName(sec) : 'Part', pts: 0, n: 0 };
        out.push(p);
      }
      p.pts += Number(it.points) || 0;
      p.n++;
    });
    return out;
  }

  function booklet(project, form, ctx) {
    const s = project.settings;
    const e = project.exam;
    const onSheet = s.answerMode === 'sheet';
    const hasInstr = BQ.rt.toPlain(e.instructions || '').trim() !== '';
    const sheetNote = 'Mark all answers on the separate answer sheet. Answers written in this booklet are not graded.';
    const blocks = [];
    if (s.coverPage) {
      blocks.push(header(project, form, 'Test booklet', 'cover'));
      // answers in the booklet: a grading table sits beside the name fields
      let grade = null;
      if (!onSheet && s.showPoints && !s.mixSections) {
        const parts = partsOf(project, form);
        if (parts.length > 1) grade = { rows: parts.map((p, i) => ({ label: 'Part ' + (i + 1), pts: p.pts })), total: PT.forms.totalPoints(form) };
      }
      blocks.push({ k: 'fields', labels: ['Name', 'Student ID', 'Date'], stacked: true, grade });
      if (hasInstr) blocks.push({ k: 'instructions', html: rich(e.instructions, ctx), cover: true });
      if (onSheet) blocks.push({ k: 'note', text: sheetNote, cover: true });
      blocks.push({ k: 'callout', text: 'Do not turn this page until you are told to begin.' });
      blocks.push({ k: 'pagebreak' });
    } else {
      blocks.push(header(project, form, ''));
      blocks.push({ k: 'fields', labels: onSheet ? ['Name', 'Student ID'] : ['Name', 'Student ID', 'Date'] });
      if (hasInstr) blocks.push({ k: 'instructions', html: rich(e.instructions, ctx) });
      if (onSheet) blocks.push({ k: 'note', text: sheetNote });
    }
    const secs = sectionsOf(project, form);
    let lastPart = null, part = 0;
    form.items.forEach((it, i) => {
      if (secs && partKey(it) !== lastPart) {
        const sec = findSection(secs, it);
        const mine = form.items.filter(x => partKey(x) === partKey(it));
        const pts = mine.reduce((a, x) => a + (Number(x.points) || 0), 0);
        part++;
        blocks.push({ k: 'section', text: 'Part ' + part + (sec ? ' · ' + PT.forms.sectionName(sec) : ''), sub: mine.length + (mine.length === 1 ? ' question' : ' questions') + (s.showPoints ? ', ' + pts + ' points' : '') });
        lastPart = partKey(it);
      }
      blocks.push(questionBlock(it, i + 1, project, ctx));
    });
    const end = endText(project);
    if (BQ.rt.toPlain(end).trim()) blocks.push({ k: 'end', html: rich(end, ctx) });
    return doc('booklet', 'Test booklet', project, form, blocks);
  }

  function questionBlock(it, n, project, ctx) {
    const s = project.settings;
    const q = it.q;
    const onSheet = s.answerMode === 'sheet';
    const parts = [];
    let stemSrc = q.text;
    if (q.type === 'FIB_PLUS') stemSrc = numberBlanks(q.text, BQ.blanksInText(q.text));
    switch (q.type) {
      case 'MC':
      case 'MA':
        if (q.type === 'MA' && !/all that apply/i.test(BQ.rt.toPlain(q.text))) parts.push({ k: 'hint', text: 'Select all that apply.' });
        parts.push({ k: 'choices', items: q.options.map((o, i) => ({ label: L(i), html: rich(o.text, ctx) })), boxes: !onSheet });
        break;
      case 'TF':
        parts.push({ k: 'choices', items: [{ label: 'T', html: 'True' }, { label: 'F', html: 'False' }], inline: true, boxes: !onSheet });
        break;
      case 'MAT':
        parts.push({ k: 'hint', text: 'Write the letter of the matching item' + (onSheet ? ' on the answer sheet.' : ' in each blank.') + ((q.distractors || []).length ? ' Some letters are not used.' : '') });
        parts.push({
          k: 'match', blanks: !onSheet,
          left: q.pairs.map((p, i) => ({ label: String(i + 1), html: rich(p.left, ctx) })),
          right: (q.rightColumn || q.pairs.map(p => p.right)).map((r, i) => ({ label: L(i), html: rich(r, ctx) }))
        });
        break;
      case 'FIB':
      case 'NUM':
        if (!onSheet) parts.push({ k: 'answerLine', labels: ['Answer'] });
        break;
      case 'FIB_PLUS':
        if (!onSheet) parts.push({ k: 'answerLine', labels: BQ.blanksInText(q.text).map((nm, i) => '(' + (i + 1) + ')') });
        break;
      case 'ESS':
        if (!onSheet) parts.push({ k: 'lines', n: it.lines || s.essayLines });
        break;
    }
    return { k: 'q', n, pts: s.showPoints ? ptsLabel(it.points) : '', stem: rich(stemSrc, ctx), parts, itemId: it.id };
  }

  function answerSheet(project, form, ctx) {
    const s = project.settings;
    const blocks = [header(project, form, 'Answer sheet')];
    blocks.push({ k: 'fields', labels: ['Name', 'Student ID', 'Date'] });
    blocks.push({ k: 'note', text: 'Check that the form code on this sheet matches your test booklet: Form ' + form.code + '. ' + (s.sheetStyle === 'bubbles' ? 'Fill in the circle completely. ' : 'Write the capital letter of your answer in the box. ') + 'For questions marked “select all”, mark every correct choice.' });
    let grid = null;
    const flush = () => { if (grid) { blocks.push(grid); grid = null; } };
    form.items.forEach((it, i) => {
      const q = it.q;
      const n = i + 1;
      if (q.type === 'MC' || q.type === 'MA' || q.type === 'TF') {
        if (!grid) grid = { k: 'grid', style: s.sheetStyle, rows: [] };
        grid.rows.push({ n, letters: q.type === 'TF' ? ['T', 'F'] : q.options.map((o, j) => L(j)), multi: q.type === 'MA' });
        return;
      }
      flush();
      if (q.type === 'MAT') blocks.push({ k: 'sheetItem', n, boxes: q.pairs.map((p, j) => String(j + 1)), hint: 'letter' });
      else if (q.type === 'FIB' || q.type === 'NUM') blocks.push({ k: 'sheetItem', n, wide: ['Answer'] });
      else if (q.type === 'FIB_PLUS') blocks.push({ k: 'sheetItem', n, wide: BQ.blanksInText(q.text).map((nm, j) => '(' + (j + 1) + ')') });
      else if (q.type === 'ESS') blocks.push({ k: 'sheetItem', n, lines: it.lines || s.essayLines });
    });
    flush();
    blocks.push({ k: 'scorebox', total: PT.forms.totalPoints(form) });
    return doc('sheet', 'Answer sheet', project, form, blocks);
  }

  function answerKey(project, form, ctx) {
    const blocks = [header(project, form, 'Answer key')];
    const pools = project.pools;
    const secs = PT.forms.sectionsOf(pools);
    blocks.push({ k: 'note', text: 'Instructor copy. Generated ' + new Date(form.createdAt).toLocaleDateString() + ' from seed “' + form.seed + '”.' });
    blocks.push({
      k: 'keyTable', total: PT.forms.totalPoints(form),
      rows: form.items.map((it, i) => {
        const p = pools.find(x => x.id === it.poolId);
        const sec = findSection(secs, it);
        // a combined section also names the bank, so the instructor can find the question
        const source = sec ? PT.forms.sectionName(sec) + (sec.pools.length > 1 && p ? ' (' + p.title + ')' : '') : p ? (p.label || p.title) : '';
        return { n: i + 1, type: BQ.TYPE_LABEL[it.q.type] || it.q.type, answer: answerText(it), pts: Number(it.points) || 0, source };
      })
    });
    form.items.forEach((it, i) => {
      if (it.q.type !== 'ESS') return;
      blocks.push({ k: 'essayKey', n: i + 1, pts: ptsLabel(it.points), stem: rich(it.q.text, ctx), sample: rich(it.q.sample, ctx), lines: 5 });
    });
    return doc('key', 'Answer key', project, form, blocks);
  }

  function doc(kind, label, project, form, blocks) {
    const e = project.exam;
    const left = [e.course, e.title].filter(Boolean).join(' · ') || 'Exam';
    return { kind, label, code: form.code, footer: left + ' · ' + label + ' · Form ' + form.code, blocks, settings: project.settings };
  }

  function documents(project, form, ctx, kinds) {
    const out = [];
    (kinds || ['booklet', 'sheet', 'key']).forEach(k => {
      if (k === 'booklet') out.push(booklet(project, form, ctx));
      if (k === 'sheet' && project.settings.answerMode === 'sheet') out.push(answerSheet(project, form, ctx));
      if (k === 'key') out.push(answerKey(project, form, ctx));
    });
    return out;
  }

  /* ---------- blocks → HTML ---------- */
  function fieldsHtml(labels, stacked) {
    return '<div class="pp-fields' + (stacked ? ' pp-fields-stacked' : '') + '">' + labels.map(l => '<div class="pp-field"><span>' + esc(l) + '</span><i></i></div>').join('') + '</div>';
  }
  function gradeHtml(g) {
    return '<table class="pp-grade"><caption>For grading</caption><thead><tr><th>Part</th><th>Points</th><th>Score</th></tr></thead><tbody>' +
      g.rows.map(r => '<tr><td>' + esc(r.label) + '</td><td>' + esc(r.pts) + '</td><td></td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td>' + esc(g.total) + '</td><td></td></tr></tfoot></table>';
  }
  function linesHtml(n) { return '<div class="pp-lines">' + '<i></i>'.repeat(Math.max(1, n | 0)) + '</div>'; }

  function blockHtml(b, opts) {
    switch (b.k) {
      case 'header': {
        const info = '<div class="pp-info">' + b.info.map(x => '<div><small>' + esc(x.label) + '</small><b>' + esc(x.value) + '</b></div>').join('') + '</div>';
        const code = '<div class="pp-code"><small>Form</small><b>' + esc(b.code) + '</b></div>';
        if (b.variant === 'cover') {
          return '<header class="pp-cover">' + (b.course ? '<div class="pp-course">' + esc(b.course) + '</div>' : '') +
            '<h1>' + esc(b.title) + '</h1>' + (b.doc ? '<div class="pp-doc">' + esc(b.doc) + '</div>' : '') + code + info + '</header>';
        }
        return '<header class="pp-head"><div class="pp-top"><div class="pp-titles">' + (b.course ? '<div class="pp-course">' + esc(b.course) + '</div>' : '') +
          '<h1>' + esc(b.title) + '</h1>' + (b.doc ? '<div class="pp-doc">' + esc(b.doc) + '</div>' : '') + '</div>' + code + '</div>' + info + '</header>';
      }
      case 'fields':
        if (b.grade) return '<div class="pp-cover-row">' + fieldsHtml(b.labels, true) + gradeHtml(b.grade) + '</div>';
        return fieldsHtml(b.labels, b.stacked);
      case 'instructions': return '<div class="pp-instr' + (b.cover ? ' pp-instr-cover' : '') + '"><b>Instructions</b><div>' + b.html + '</div></div>';
      case 'note': return '<p class="pp-note' + (b.cover ? ' pp-note-cover' : '') + '">' + esc(b.text) + '</p>';
      case 'callout': return '<p class="pp-callout">' + esc(b.text) + '</p>';
      case 'pagebreak': return '<div class="pp-break"></div>';
      case 'section': return '<h2 class="pp-section">' + esc(b.text) + (b.sub ? ' <small>' + esc(b.sub) + '</small>' : '') + '</h2>';
      case 'end': return '<div class="pp-end">' + b.html + '</div>';
      case 'q': {
        const tools = opts && opts.tools ? '<span class="pp-tools" data-item="' + esc(b.itemId) + '"><button type="button" data-act="edit" aria-label="Edit question ' + b.n + '">Edit</button><button type="button" data-act="swap" aria-label="Swap question ' + b.n + '">Swap</button></span>' : '';
        return '<section class="pp-q" data-item="' + esc(b.itemId) + '">' + tools + '<div class="pp-stem' + picFirst(b.stem) + '"><span class="pp-n">' + b.n + '.</span><div class="pp-stem-text">' + b.stem +
          '</div>' + (b.pts ? '<span class="pp-pts">(' + esc(b.pts) + ')</span>' : '') + '</div>' + b.parts.map(partHtml).join('') + '</section>';
      }
      case 'grid':
        return '<div class="pp-grid pp-' + b.style + '">' + b.rows.map(r => '<div class="pp-row"><span class="pp-n">' + r.n + '.</span>' +
          (b.style === 'bubbles'
            ? r.letters.map(l => '<span class="pp-bubble' + (r.multi ? ' pp-sq' : '') + '">' + esc(l) + '</span>').join('')
            : '<span class="pp-box' + (r.multi ? ' pp-wide' : '') + '"></span><small>' + esc(r.letters[0] + '–' + r.letters[r.letters.length - 1]) + '</small>') +
          (r.multi ? '<em>all that apply</em>' : '') + '</div>').join('') + '</div>';
      case 'sheetItem': {
        let inner = '';
        if (b.boxes) inner = '<div class="pp-boxes">' + b.boxes.map(x => '<span><small>' + esc(x) + '</small><i class="pp-box"></i></span>').join('') + '</div>';
        if (b.wide) inner = '<div class="pp-wides">' + b.wide.map(x => '<span><small>' + esc(x) + '</small><i></i></span>').join('') + '</div>';
        if (b.lines) inner = linesHtml(b.lines);
        return '<div class="pp-sitem' + (b.lines ? ' pp-essay' : '') + '"><span class="pp-n">' + b.n + '.</span>' + inner + '</div>';
      }
      case 'scorebox':
        return '<div class="pp-score"><span>For grading</span><span>Score: ________ / ' + esc(b.total) + '</span><span>Grader: ________</span></div>';
      case 'keyTable':
        return '<table class="pp-key"><thead><tr><th>#</th><th>Answer</th><th>Pts</th><th>Type</th><th>Pool / outcome</th></tr></thead><tbody>' +
          b.rows.map(r => '<tr><td>' + r.n + '</td><td class="pp-ans">' + esc(r.answer) + '</td><td>' + r.pts + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.source) + '</td></tr>').join('') +
          '</tbody><tfoot><tr><td></td><td>Total</td><td>' + b.total + '</td><td colspan="2"></td></tr></tfoot></table>';
      case 'essayKey':
        return '<section class="pp-q pp-ekey"><div class="pp-stem' + picFirst(b.stem) + '"><span class="pp-n">' + b.n + '.</span><div class="pp-stem-text">' + b.stem + '</div><span class="pp-pts">(' + esc(b.pts) + ')</span></div>' +
          '<div class="pp-sample"><b>Sample answer</b>' + (b.sample ? '<div>' + b.sample + '</div>' : '<div class="pp-muted">None given.</div>') + '</div>' +
          '<div class="pp-rubric"><b>Rubric notes</b>' + linesHtml(b.lines) + '</div></section>';
    }
    return '';
  }

  /**
   * True when rich HTML opens with a picture (ignoring wrappers, spaces and line breaks).
   * Such rows align their number to the top of the picture instead of its baseline,
   * which for an inline picture is its bottom edge.
   */
  function startsWithPicture(html) {
    return /^(?:\s|&nbsp;|<br\s*\/?>|<(?:p|div|span|strong|b|em|i|u|a|figure|center)\b[^>]*>)*<img\b/i.test(String(html || ''));
  }
  const picFirst = (html) => startsWithPicture(html) ? ' pp-pic-first' : '';

  function partHtml(p) {
    switch (p.k) {
      case 'hint': return '<p class="pp-hint">' + esc(p.text) + '</p>';
      case 'choices':
        return '<ol class="pp-choices' + (p.inline ? ' pp-inline' : '') + '">' + p.items.map(c => '<li' + (picFirst(c.html) ? ' class="pp-pic-first"' : '') + '><span class="pp-lab' + (p.boxes ? ' pp-circle' : '') + '">' + esc(c.label) + (p.boxes ? '' : '.') + '</span><div>' + c.html + '</div></li>').join('') + '</ol>';
      case 'match':
        return '<div class="pp-match"><ol>' + p.left.map(x => '<li' + (picFirst(x.html) ? ' class="pp-pic-first"' : '') + '>' + (p.blanks ? '<i class="pp-blank"></i>' : '') + '<span class="pp-lab">' + esc(x.label) + '.</span><div>' + x.html + '</div></li>').join('') + '</ol>' +
          '<ol>' + p.right.map(x => '<li' + (picFirst(x.html) ? ' class="pp-pic-first"' : '') + '><span class="pp-lab">' + esc(x.label) + '.</span><div>' + x.html + '</div></li>').join('') + '</ol></div>';
      case 'answerLine': return '<div class="pp-wides">' + p.labels.map(x => '<span><small>' + esc(x) + '</small><i></i></span>').join('') + '</div>';
      case 'lines': return linesHtml(p.n);
    }
    return '';
  }

  function toHtml(d, opts) {
    const s = d.settings || {};
    return '<article class="paper pp-' + d.kind + (s.largePrint ? ' pp-large' : '') + (s.paper === 'a4' ? ' pp-a4' : '') + '" data-footer="' + esc(d.footer) + '">' +
      d.blocks.map(b => blockHtml(b, opts)).join('') + '</article>';
  }

  PT.paper = { startsWithPicture, DEFAULT_SETTINGS, documents, questionBlock, defaultEndText, endText, booklet, answerSheet, answerKey, toHtml, answerText, rich, numberBlanks };
})();
