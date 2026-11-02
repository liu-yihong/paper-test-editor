/*
 * Reading question banks:
 *  - Blackboard question pool / test packages (.zip, QTI 1.2 dialect), as written by
 *    Blackboard Learn and by the Blackboard Question Editor;
 *  - Blackboard Question Editor projects (.bbq.json).
 * Questions come out in the editor's own model (BQ.normalizeQuestion), with rich text
 * as the editor's markup, so both tools share one representation.
 */
(function () {
  'use strict';
  const PT = (globalThis.PT = globalThis.PT || {});

  const TYPE_MAP = {
    'multiple choice': 'MC', 'either/or': 'MC', 'multiple answer': 'MA', 'true/false': 'TF',
    'essay': 'ESS', 'short response': 'ESS', 'matching': 'MAT', 'fill in the blank': 'FIB',
    'fill in the blank plus': 'FIB_PLUS', 'numeric': 'NUM'
  };

  /* ---------- small DOM helpers (work with DOMParser and xmldom) ---------- */
  const kids = (el) => Array.from(el ? el.childNodes : []).filter(n => n.nodeType === 1);
  const tag = (el) => (el.localName || el.nodeName || '').toLowerCase();
  const all = (el, name) => (el ? Array.from(el.getElementsByTagName(name)) : []);
  const first = (el, name) => all(el, name)[0] || null;
  const text = (el) => (el ? el.textContent || '' : '');
  function child(el, name, cls) {
    return kids(el).find(c => tag(c) === name && (!cls || c.getAttribute('class') === cls)) || null;
  }
  function descend(el, pred) {
    const out = [];
    (function walk(e) { kids(e).forEach(c => { if (pred(c)) out.push(c); walk(c); }); })(el);
    return out;
  }
  const flowByClass = (el, cls) => descend(el, c => tag(c) === 'flow' && c.getAttribute('class') === cls)[0] || null;

  /** The HTML (or plain text) held by a material block, without descending into response labels. */
  function materialHtml(el) {
    if (!el) return '';
    const ft = first(el, 'mat_formattedtext');
    if (ft) return text(ft);
    const mt = all(el, 'mattext');
    if (mt.length) return mt.map(m => {
      const t = text(m);
      return /html/i.test(m.getAttribute('texttype') || '') ? t : escapeText(t);
    }).join(' ');
    return '';
  }
  const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- HTML cleanup → editor markup ---------- */
  function cleanHtml(html, pics) {
    let s = String(html || '');
    s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
    // pictures: Blackboard embedded files → project picture names
    s = s.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
      const src = (/\bsrc\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || '';
      const alt = (/\balt\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || '';
      const w = (/\bwidth\s*=\s*["']?(\d{1,4})/i.exec(attrs) || [])[1] || '';
      const name = pics ? pics.resolve(src) : null;
      if (!name) return alt ? '[Picture: ' + alt + ']' : '[Picture]';
      return '<img src="' + name + '"' + (alt ? ' alt="' + alt.replace(/"/g, '') + '"' : '') + (w ? ' width="' + w + '"' : '') + '>';
    });
    // drop attributes from formatting tags (style, class, dir …), unwrap span/font
    s = s.replace(/<(\/?)(p|div|strong|b|em|i|u|sub|sup|ul|ol|li|table|thead|tbody|tr|blockquote|pre|code)\b[^>]*>/gi, (m, c, n) => '<' + c + n.toLowerCase() + '>');
    s = s.replace(/<(td|th)\b([^>]*)>/gi, (m, n, a) => {
      const cs = (/colspan\s*=\s*["']?(\d+)/i.exec(a) || [])[1];
      const rs = (/rowspan\s*=\s*["']?(\d+)/i.exec(a) || [])[1];
      return '<' + n.toLowerCase() + (cs ? ' colspan="' + cs + '"' : '') + (rs ? ' rowspan="' + rs + '"' : '') + '>';
    });
    s = s.replace(/<\/?(span|font|o:p|label)\b[^>]*>/gi, '');
    s = s.replace(/<p>\s*(&nbsp;| )?\s*<\/p>/gi, '');
    s = s.replace(/&nbsp;| /g, ' ');
    s = s.replace(/<div>([\s\S]*?)<\/div>/gi, '<p>$1</p>');
    let mk = BQ.rt.htmlToMarkup(s.trim());
    mk = mk.replace(/<\/?p>/gi, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return mk;
  }

  /* ---------- pictures inside a package ---------- */
  const EXT_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  function pictureStore(files, images) {
    const byXid = new Map();
    const byPath = new Map();
    files.forEach((bytes, path) => {
      const m = /\.(png|jpe?g|gif|webp|svg)$/i.exec(path);
      if (!m) return;
      const xid = /xid-\d+_\d+/.exec(path);
      if (xid) byXid.set(xid[0], path);
      byPath.set(path.toLowerCase(), path);
      byPath.set(path.split('/').pop().toLowerCase(), path);
    });
    const named = new Map(); // path → project name
    function nameFor(path) {
      if (named.has(path)) return named.get(path);
      const file = path.split('/').pop();
      const ext = (/\.([a-z0-9]+)$/i.exec(file) || [, 'png'])[1].toLowerCase();
      let base = file.replace(/\.[^.]+$/, '').replace(/__xid-\d+_\d+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'picture';
      if (!/^[A-Za-z0-9]/.test(base)) base = 'p' + base;
      let name = base + '.' + ext, k = 2;
      while (Object.prototype.hasOwnProperty.call(images, name)) {
        if (images[name].source === path) break;
        name = base + '-' + k++ + '.' + ext;
      }
      images[name] = { type: EXT_TYPE[ext] || 'image/png', data: PT.zip.bytesToB64(files.get(path)), source: path };
      named.set(path, name);
      return name;
    }
    return {
      resolve(src) {
        src = decodeURIComponent(String(src || '').replace(/&amp;/g, '&'));
        const xid = /xid-\d+_\d+/.exec(src);
        if (xid && byXid.has(xid[0])) return nameFor(byXid.get(xid[0]));
        const tail = src.split(/[\\/]/).pop().toLowerCase();
        if (byPath.has(src.toLowerCase())) return nameFor(byPath.get(src.toLowerCase()));
        if (tail && byPath.has(tail)) return nameFor(byPath.get(tail));
        const data = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(src);
        if (data) {
          const ext = (data[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
          let name = 'inline-1.' + ext, k = 1;
          while (Object.prototype.hasOwnProperty.call(images, name)) name = 'inline-' + ++k + '.' + ext;
          images[name] = { type: data[1], data: data[2] };
          return name;
        }
        return null;
      }
    };
  }

  /* ---------- one <item> → one question ---------- */
  function correctConditions(item) {
    const conds = all(item, 'respcondition');
    const scoring = conds.filter(c => {
      const title = (c.getAttribute('title') || '').toLowerCase();
      if (title === 'incorrect') return false;
      if (title === 'correct') return true;
      const sv = first(c, 'setvar');
      if (!sv) return !first(c, 'other');
      const v = text(sv).trim();
      return v === 'SCORE.max' || parseFloat(v) > 0;
    });
    return scoring;
  }

  /**
   * Blackboard Ultra: when choices are edited after a question is made, the choices get new ids
   * ("new_…" or bare GUIDs) but the answer key keeps the old ids, in the same order as the choices.
   * Read the old ids in order from the key and mark the choices by position.
   */
  function flagsByPosition(item, correct, n, right) {
    const lists = [];
    correct.forEach(c => {
      const and = first(c, 'and');
      if (and) lists.push(kids(and).map(e => tag(e) === 'not' ? first(e, 'varequal') : e)
        .filter(e => e && tag(e) === 'varequal').map(v => text(v).trim()));
    });
    // per-choice rows: <respcondition><varequal respident="OLD_ID"/></respcondition>
    lists.push(all(item, 'respcondition').filter(c => !c.getAttribute('title'))
      .map(c => first(c, 'varequal')).filter(v => v && !text(v).trim() && v.getAttribute('respident') !== 'response')
      .map(v => v.getAttribute('respident')));
    const ids = lists.find(l => l.length === n && new Set(l).size === n && l.some(id => right.has(id)));
    return ids ? ids.map(id => right.has(id)) : null;
  }

  /** Either/Or choices are stored as keys such as "true_false.true" or "yes_no.no". */
  const EITHER_OR = { true: 'True', false: 'False', yes: 'Yes', no: 'No', agree: 'Agree', disagree: 'Disagree', right: 'Right', wrong: 'Wrong' };
  function optionText(label, bbType, rich) {
    const ident = label.getAttribute('ident') || '';
    const t = rich(materialHtml(label));
    if (bbType !== 'either/or') return t;
    const key = /^[a-z]+_[a-z]+\.([a-z]+)$/.exec((t || ident).trim()) || /^[a-z]+_[a-z]+\.([a-z]+)$/.exec(ident);
    if (key && EITHER_OR[key[1]] && (!t || t.trim() === ident || /^[a-z]+_[a-z]+\.[a-z]+$/.test(t.trim()))) return EITHER_OR[key[1]];
    return t || ident;
  }

  function parseItem(item, pics) {
    const meta = first(item, 'itemmetadata');
    const bbType = text(first(meta, 'bbmd_questiontype')).trim().toLowerCase();
    const type = TYPE_MAP[bbType];
    if (!type) return { skip: bbType || 'unknown' };
    const q = BQ.newQuestion(type);
    q.options = []; q.pairs = []; q.answers = []; q.blanks = [];
    const rich = (html) => cleanHtml(html, pics);
    const pres = first(item, 'presentation');
    const qb = flowByClass(pres, 'QUESTION_BLOCK');
    q.text = rich(materialHtml(qb || pres));
    const pts = parseFloat(text(first(meta, 'qmd_absolutescore_max')));
    if (pts > 0) q.bbPoints = pts;
    const correct = correctConditions(item);
    const feedback = (id) => {
      const fb = all(item, 'itemfeedback').find(f => f.getAttribute('ident') === id);
      return fb ? rich(materialHtml(fb)) : '';
    };
    q.feedback = { correct: feedback('correct'), incorrect: feedback('incorrect') };

    switch (type) {
      case 'MC':
      case 'MA': {
        const labels = all(pres, 'response_label');
        const right = new Set();
        correct.forEach(c => all(c, 'varequal').forEach(v => {
          const notParent = v.parentNode && tag(v.parentNode) === 'not';
          if (!notParent) right.add(text(v).trim());
        }));
        let flags = labels.map(l => right.has(l.getAttribute('ident')));
        if (!flags.some(Boolean) && right.size) flags = flagsByPosition(item, correct, labels.length, right) || flags;
        q.options = labels.map((l, i) => ({ text: optionText(l, bbType, rich), correct: flags[i] }));
        // Blackboard Ultra exports single-answer multiple choice as "Multiple Answer", flagged
        // single_correct_answer. Keep it multiple choice, as students see it in Blackboard.
        const single = all(item, 'setvar').some(s => s.getAttribute('variablename') === 'single_correct_answer' && text(s).trim() === 'true');
        if (q.type === 'MA' && single && flags.filter(Boolean).length === 1) q.type = 'MC';
        break;
      }
      case 'TF': {
        const v = correct.map(c => text(first(c, 'varequal')).trim().toLowerCase()).find(Boolean);
        q.tf = v === 'true' ? true : v === 'false' ? false : null;
        break;
      }
      case 'ESS': {
        const sol = first(item, 'solutionmaterial');
        q.sample = sol ? rich(materialHtml(sol)) : '';
        break;
      }
      case 'MAT': {
        const rb = flowByClass(pres, 'RESPONSE_BLOCK');
        const rightBlock = flowByClass(pres, 'RIGHT_MATCH_BLOCK');
        const rights = rightBlock ? kids(rightBlock).map(f => rich(materialHtml(f))) : [];
        const lefts = rb ? kids(rb).filter(f => tag(f) === 'flow') : [];
        const answerFor = new Map();
        const answers = [];
        all(item, 'respcondition').forEach(c => {
          if ((c.getAttribute('title') || '').toLowerCase() === 'incorrect') return;
          all(c, 'varequal').forEach(v => {
            const a = text(v).trim();
            if (!a) return;
            answers.push(a);
            if (!answerFor.has(v.getAttribute('respident'))) answerFor.set(v.getAttribute('respident'), a);
          });
        });
        const usedRight = new Set();
        lefts.forEach(f => {
          const lid = first(f, 'response_lid');
          const ident = lid ? lid.getAttribute('ident') : '';
          const labs = all(lid, 'response_label').map(l => l.getAttribute('ident'));
          let idx = labs.indexOf(answerFor.get(ident));
          // Blackboard Ultra can export prompt ids in the answer key that differ from the prompts'
          // own ids. The answer itself is still one of this prompt's label ids, which are unique.
          if (idx < 0) idx = labs.findIndex(id => answers.includes(id));
          const leftText = rich(materialHtml(child(f, 'flow') || f));
          q.pairs.push({ left: leftText, right: idx >= 0 && rights[idx] != null ? rights[idx] : '' });
          if (idx >= 0) usedRight.add(idx);
        });
        q.distractors = rights.filter((r, i) => !usedRight.has(i));
        break;
      }
      case 'FIB': {
        correct.forEach(c => all(c, 'varequal').forEach(v => { const a = text(v).trim(); if (a && !q.answers.includes(a)) q.answers.push(a); }));
        break;
      }
      case 'FIB_PLUS': {
        const names = all(pres, 'response_str').map(r => r.getAttribute('ident'));
        const map = new Map(names.map(n => [n, []]));
        correct.forEach(c => all(c, 'varequal').forEach(v => {
          const n = v.getAttribute('respident');
          const a = text(v).trim();
          if (!map.has(n)) map.set(n, []);
          if (a && !map.get(n).includes(a)) map.get(n).push(a);
        }));
        q.blanks = Array.from(map, ([name, answers]) => ({ name, answers }));
        break;
      }
      case 'NUM': {
        const c = correct[0];
        const eq = parseFloat(text(first(c, 'varequal')));
        const lo = parseFloat(text(first(c, 'vargte')));
        const hi = parseFloat(text(first(c, 'varlte')));
        const ans = !isNaN(eq) ? eq : (!isNaN(lo) && !isNaN(hi) ? (lo + hi) / 2 : NaN);
        q.num.answer = isNaN(ans) ? '' : String(Number(ans.toPrecision(12)));
        q.num.tolerance = (!isNaN(lo) && !isNaN(hi) && hi > lo) ? String(Number(((hi - lo) / 2).toPrecision(12))) : '';
        break;
      }
    }
    return { question: q };
  }

  /* ---------- package ---------- */
  async function readPoolZip(buffer, fileName, existingImages) {
    const files = await PT.zip.unzip(buffer);
    const dec = new TextDecoder();
    const parse = (bytes) => new DOMParser().parseFromString(dec.decode(bytes).replace(/^﻿/, ''), 'text/xml');
    const resources = [];
    if (files.has('imsmanifest.xml')) {
      const man = parse(files.get('imsmanifest.xml'));
      all(man, 'resource').forEach(r => {
        const t = r.getAttribute('type') || '';
        if (!/assessment\/x-bb-qti-(pool|test|survey)/.test(t)) return;
        const file = r.getAttribute('bb:file') || r.getAttribute('file') || (r.getAttribute('identifier') + '.dat');
        resources.push({ file, title: r.getAttribute('bb:title') || '', kind: t.split('-').pop() });
      });
    }
    if (!resources.length) files.forEach((v, k) => { if (/\.(dat|xml)$/i.test(k) && k !== 'imsmanifest.xml') resources.push({ file: k, title: '' }); });
    const pools = [];
    const images = existingImages || {};
    const pics = pictureStore(files, images);
    for (const res of resources) {
      if (!files.has(res.file)) continue;
      const doc = parse(files.get(res.file));
      const asmt = first(doc, 'assessment');
      if (!asmt) continue;
      const title = asmt.getAttribute('title') || res.title || (fileName || 'Question bank').replace(/\.zip$/i, '');
      const questions = [];
      const skipped = {};
      all(asmt, 'item').forEach(item => {
        try {
          const r = parseItem(item, pics);
          if (r.question) questions.push(r.question);
          else skipped[r.skip] = (skipped[r.skip] || 0) + 1;
        } catch (e) {
          skipped['unreadable'] = (skipped['unreadable'] || 0) + 1;
        }
      });
      pools.push({ title, questions, skipped, kind: res.kind || 'pool' });
    }
    if (!pools.length) throw new Error('No question bank was found inside this .zip. Export the bank from Blackboard (or download it from the Blackboard Question Editor) and try again.');
    return { pools, images };
  }

  /** A .bbq.json project from the Blackboard Question Editor. */
  function readBbqJson(textContent, fileName) {
    const data = JSON.parse(textContent);
    const project = data && (data.project || data);
    if (!project || !Array.isArray(project.questions)) throw new Error('This file is not a Blackboard Question Editor project.');
    const images = {};
    Object.keys(project.images || {}).forEach(k => {
      const im = project.images[k];
      if (im && im.data) images[k] = { type: im.type || 'image/png', data: im.data };
    });
    const questions = project.questions.map(q => {
      const n = BQ.normalizeQuestion(q);
      return n;
    });
    return { pools: [{ title: project.title || (fileName || 'Question bank').replace(/\.bbq\.json$|\.json$/i, ''), questions, skipped: {} }], images };
  }

  PT.importer = { readPoolZip, readBbqJson, cleanHtml };
})();
