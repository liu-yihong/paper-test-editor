/*
 * Question model and validation for the eight question types that
 * Blackboard Ultra accepts in "Upload questions from file".
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  const TYPES = [
    { code: 'MC', label: 'Multiple choice' },
    { code: 'MA', label: 'Multiple answer' },
    { code: 'TF', label: 'True / False' },
    { code: 'ESS', label: 'Essay' },
    { code: 'MAT', label: 'Matching' },
    { code: 'FIB', label: 'Fill in the blank' },
    { code: 'FIB_PLUS', label: 'Fill in multiple blanks' },
    { code: 'NUM', label: 'Numeric' }
  ];
  const LABEL = Object.fromEntries(TYPES.map(t => [t.code, t.label]));
  const CODES = new Set(TYPES.map(t => t.code));
  const MAX_ANSWERS = 100;
  const MAX_BLANKS = 10;
  const BLANK_RE = /(^|[^\\])\[([A-Za-z][A-Za-z0-9_-]{0,39})\]/g;

  let counter = 0;
  function uid() {
    counter = (counter + 1) % 1e6;
    return 'q' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function emptyQuestion(type) {
    return {
      id: uid(), type: CODES.has(type) ? type : 'MC', text: '',
      options: [], tf: null, sample: '', pairs: [], answers: [], blanks: [],
      num: { answer: '', tolerance: '' },
      feedback: { correct: '', incorrect: '' }
    };
  }

  /** A new question with sensible empty slots for the form editor. */
  function newQuestion(type) {
    const q = emptyQuestion(type);
    if (q.type === 'MC' || q.type === 'MA') q.options = [0, 1, 2, 3].map(() => ({ text: '', correct: false }));
    if (q.type === 'MAT') q.pairs = [0, 1, 2].map(() => ({ left: '', right: '' }));
    if (q.type === 'FIB') q.answers = [''];
    return q;
  }

  /** Coerce anything (e.g. from a saved project file) into a well-formed question. */
  function normalize(raw) {
    const q = emptyQuestion(raw && raw.type);
    if (!raw || typeof raw !== 'object') return q;
    const str = (v) => (v == null ? '' : String(v));
    q.text = str(raw.text);
    q.options = Array.isArray(raw.options) ? raw.options.map(o => ({ text: str(o && o.text), correct: !!(o && o.correct) })) : [];
    q.tf = raw.tf === true ? true : raw.tf === false ? false : null;
    q.sample = str(raw.sample);
    q.pairs = Array.isArray(raw.pairs) ? raw.pairs.map(p => ({ left: str(p && p.left), right: str(p && p.right) })) : [];
    q.answers = Array.isArray(raw.answers) ? raw.answers.map(str) : [];
    q.blanks = Array.isArray(raw.blanks) ? raw.blanks.map(b => ({ name: str(b && b.name), answers: Array.isArray(b && b.answers) ? b.answers.map(str) : [] })) : [];
    q.num = { answer: str(raw.num && raw.num.answer), tolerance: str(raw.num && raw.num.tolerance) };
    q.feedback = { correct: str(raw.feedback && raw.feedback.correct), incorrect: str(raw.feedback && raw.feedback.incorrect) };
    return q;
  }

  function clone(q) {
    const c = normalize(JSON.parse(JSON.stringify(q)));
    c.id = uid();
    return c;
  }

  /** Blank names written as [name] in the question text (math and code ignored). */
  function blanksInText(text) {
    const s = String(text || '')
      .replace(/`[^`\n]*`/g, '')
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      .replace(/(^|[^\\])\$[^$\n]*?\$/g, '$1');
    const names = [];
    let m;
    BLANK_RE.lastIndex = 0;
    while ((m = BLANK_RE.exec(s))) {
      if (!names.includes(m[2])) names.push(m[2]);
      BLANK_RE.lastIndex = m.index + m[0].length - 1;
    }
    return names;
  }

  /** Keep q.blanks in step with the [names] in q.text, carrying answers across a rename. */
  function syncBlanks(q) {
    const names = blanksInText(q.text);
    const byName = new Map(q.blanks.map(b => [b.name, b]));
    const orphans = q.blanks.filter(b => !names.includes(b.name));
    const fresh = names.filter(n => !byName.has(n));
    q.blanks = names.map(n => {
      if (byName.has(n)) return byName.get(n);
      if (orphans.length === 1 && fresh.length === 1) return { name: n, answers: orphans[0].answers };
      return { name: n, answers: [] };
    });
    return q;
  }

  function isNumber(v) {
    return /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/.test(String(v == null ? '' : v));
  }
  const filled = (s) => BQ.rt.toPlain(s || '').trim() !== '';
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

  /** Every field of a question that can hold formatted text (and so pictures). */
  function richFields(q) {
    const out = [q.text];
    if (q.type === 'MC' || q.type === 'MA') q.options.forEach(o => out.push(o.text));
    if (q.type === 'MAT') q.pairs.forEach(p => out.push(p.left, p.right));
    if (q.type === 'ESS') out.push(q.sample);
    if (hasFeedback(q)) out.push(q.feedback.correct, q.feedback.incorrect);
    return out;
  }
  /** Essays are graded by hand, so Blackboard shows them no correct/incorrect feedback. */
  const takesFeedback = (q) => q.type !== 'ESS';
  const hasFeedback = (q) => takesFeedback(q) && !!(q.feedback && (filled(q.feedback.correct) || filled(q.feedback.incorrect)));
  /** Project pictures used anywhere in a question. */
  function imagesInQuestion(q) {
    const names = [];
    richFields(q).forEach(f => BQ.rt.imagesIn(f).forEach(n => { if (!names.includes(n)) names.push(n); }));
    return names;
  }

  /**
   * Returns { errors: [...], warnings: [...] } in plain language.
   * ctx.images (optional): the project's picture store, to catch pictures that are missing.
   */
  function validate(q, ctx) {
    const errors = [];
    const warnings = [];
    if (!filled(q.text) && !imagesInQuestion(q).length) errors.push('Write the question text.');
    if (ctx && ctx.images) {
      imagesInQuestion(q).forEach(n => {
        if (!Object.prototype.hasOwnProperty.call(ctx.images, n)) warnings.push('The picture “' + n + '” is not in this project. Insert it again with the Picture button, or it will show as text.');
      });
    }

    switch (q.type) {
      case 'MC':
      case 'MA': {
        const opts = q.options;
        if (opts.length < 2) errors.push('Add at least two answer choices.');
        if (opts.length > MAX_ANSWERS) errors.push('Blackboard allows at most 100 answer choices.');
        opts.forEach((o, i) => { if (!filled(o.text)) errors.push('Choice ' + letter(i) + ' is empty. Fill it in or remove it.'); });
        const n = opts.filter(o => o.correct).length;
        if (q.type === 'MC') {
          if (n === 0) errors.push('Mark the correct answer by selecting its letter.');
          if (n > 1) errors.push('Multiple choice takes one correct answer. Unmark the extras, or change the type to Multiple answer.');
        } else if (n === 0) {
          errors.push('Mark at least one correct answer by selecting its letter.');
        }
        break;
      }
      case 'TF':
        if (q.tf === null) errors.push('Choose whether the statement is True or False.');
        break;
      case 'ESS':
        break;
      case 'MAT': {
        if (q.pairs.length < 2) errors.push('Add at least two matching pairs.');
        if (q.pairs.length > MAX_ANSWERS) errors.push('Blackboard allows at most 100 pairs.');
        q.pairs.forEach((p, i) => {
          if (!filled(p.left)) errors.push('Pair ' + (i + 1) + ' needs a prompt on the left.');
          if (!filled(p.right)) errors.push('Pair ' + (i + 1) + ' needs a match on the right.');
        });
        const rights = q.pairs.map(p => BQ.rt.toPlain(p.right).trim().toLowerCase()).filter(Boolean);
        if (new Set(rights).size !== rights.length) warnings.push('Two pairs share the same match. Blackboard may mark one of them wrong; make each match unique.');
        break;
      }
      case 'FIB': {
        const a = q.answers.map(s => s.trim()).filter(Boolean);
        if (!a.length) errors.push('Add at least one accepted answer.');
        if (a.length > MAX_ANSWERS) errors.push('Blackboard allows at most 100 accepted answers.');
        break;
      }
      case 'FIB_PLUS': {
        const names = blanksInText(q.text);
        if (!names.length) errors.push('Mark each blank in the question as [name], for example "In SQL, [w] filters rows and [h] filters groups."');
        if (names.length > MAX_BLANKS) errors.push('Blackboard allows at most 10 blanks in one question.');
        names.forEach(n => {
          const b = q.blanks.find(x => x.name === n);
          if (!b || !b.answers.some(a => a.trim())) errors.push('Blank [' + n + '] has no accepted answers.');
        });
        break;
      }
      case 'NUM':
        if (!isNumber(q.num.answer)) errors.push('Enter the correct answer as a number, for example 3.14.');
        if (String(q.num.tolerance).trim() && (!isNumber(q.num.tolerance) || parseFloat(q.num.tolerance) < 0)) {
          errors.push('Tolerance must be zero or a positive number. Leave it blank for an exact answer.');
        }
        break;
    }
    return { errors, warnings };
  }

  /** Change a question's type, keeping whatever content still applies. */
  function changeType(q, type) {
    if (!CODES.has(type) || q.type === type) return q;
    const from = q.type;
    q.type = type;
    if ((type === 'MC' || type === 'MA') && !q.options.length) {
      if (from === 'MAT' && q.pairs.length) q.options = q.pairs.map(p => ({ text: p.right || p.left, correct: false }));
      else if (from === 'FIB' && q.answers.some(Boolean)) q.options = q.answers.filter(Boolean).map((a, i) => ({ text: a, correct: i === 0 })).concat([{ text: '', correct: false }]);
      else q.options = [0, 1, 2, 3].map(() => ({ text: '', correct: false }));
    }
    if (type === 'MAT' && !q.pairs.length) q.pairs = [0, 1, 2].map(() => ({ left: '', right: '' }));
    if (type === 'FIB' && !q.answers.length) {
      const right = q.options.filter(o => o.correct).map(o => BQ.rt.toPlain(o.text));
      q.answers = right.length ? right : [''];
    }
    if (type === 'NUM' && !q.num.answer && q.answers.length && isNumber(q.answers[0])) q.num.answer = q.answers[0].trim();
    if (type === 'FIB_PLUS') syncBlanks(q);
    return q;
  }

  BQ.TYPES = TYPES;
  BQ.TYPE_LABEL = LABEL;
  BQ.TYPE_CODES = CODES;
  BQ.uid = uid;
  BQ.newQuestion = newQuestion;
  BQ.emptyQuestion = emptyQuestion;
  BQ.normalizeQuestion = normalize;
  BQ.cloneQuestion = clone;
  BQ.blanksInText = blanksInText;
  BQ.syncBlanks = syncBlanks;
  BQ.isNumber = isNumber;
  BQ.validate = validate;
  BQ.takesFeedback = takesFeedback;
  BQ.hasFeedback = hasFeedback;
  BQ.imagesInQuestion = imagesInQuestion;
  BQ.changeType = changeType;
  BQ.letter = letter;
})();
