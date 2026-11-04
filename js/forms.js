/*
 * Building parallel paper forms from the blueprint.
 *
 *  - Seeded random numbers, so a batch can be rebuilt from its seed.
 *  - Draws with minimal overlap: if a pool holds enough questions, forms share none;
 *    otherwise every question is used ⌊k⌋ or ⌈k⌉ times and pairwise overlap is kept low.
 *  - Prefers questions used least often, then least recently (usage history).
 *  - Shuffles question order and answer choices, keeping "All/None of the above" in place.
 *  - Sections: pools joined under one outcome share a draw count and points. The draw
 *    comes from the banks combined; every form gets the same mix of banks, in
 *    proportion to their sizes (what a plain draw from the merged set gives on average).
 */
(function () {
  'use strict';
  const PT = (globalThis.PT = globalThis.PT || {});

  /* ---------- seeded random numbers ---------- */
  function hashString(str) {
    let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return [h1 >>> 0, h2 >>> 0];
  }
  function rngFrom(seed) {
    let a = hashString(String(seed))[0];
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function newSeed() {
    const words = ['amber', 'birch', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'heron', 'iris', 'juniper', 'kestrel', 'lumen', 'maple', 'nova', 'onyx', 'pine', 'quartz', 'raven', 'sage', 'tide', 'umber', 'vale', 'willow', 'yarrow', 'zephyr'];
    const r = (n) => Math.floor(Math.random() * n);
    return words[r(words.length)] + '-' + words[r(words.length)] + '-' + (100 + r(900));
  }

  /** Stable identity for a question, from its content (survives re-importing the bank). */
  function questionKey(q) {
    const parts = [q.type, q.text, (q.options || []).map(o => o.text).join('\u0001'), (q.pairs || []).map(p => p.left + '\u0002' + p.right).join('\u0001')];
    const [a, b] = hashString(parts.join('\u0003'));
    return a.toString(36) + b.toString(36);
  }

  /* ---------- usage history ---------- */
  /** usage: [{ key, form, at }] → Map(key → { count, last }) */
  function usageStats(usage) {
    const m = new Map();
    (usage || []).forEach(u => {
      const s = m.get(u.key) || { count: 0, last: '' };
      s.count++;
      if (u.at > s.last) s.last = u.at;
      m.set(u.key, s);
    });
    return m;
  }

  /* ---------- answer-choice shuffling ---------- */
  const ANCHOR_RE = /^\s*(all|none|both|neither)\s+(of\s+)?(the\s+)?(above|these|preceding|answers|choices|options|of the above)\b|^\s*(all|none) of (the )?(above|these)\b/i;
  const LETTER_REF_RE = /^\s*(both\s+)?\(?[A-H]\)?(\s*(,|and|&|or)\s*\(?[A-H]\)?)+\s*\.?\s*$|\b(choices?|options?|answers?)\s+\(?[A-H]\)?\b|\b[A-H]\s+and\s+[A-H]\b/;
  const plain = (s) => BQ.rt.toPlain(s || '');

  /** Can this question's choices be shuffled? (A choice that names other letters can't.) */
  function choicesShuffleable(q) {
    return !(q.options || []).some(o => LETTER_REF_RE.test(plain(o.text)));
  }

  /** Shuffle choices but keep "All/None of the above" and the like where they are. */
  function shuffleChoices(options, rng) {
    const anchored = options.map(o => ANCHOR_RE.test(plain(o.text)));
    const movable = options.filter((o, i) => !anchored[i]);
    const mixed = shuffle(movable, rng);
    let k = 0;
    return options.map((o, i) => (anchored[i] ? o : mixed[k++]));
  }

  /**
   * A printable copy of a question: choices shuffled (when allowed), matching columns arranged.
   * Matching gets q.rightColumn: the right-hand items (matches and distractors) in print order.
   */
  function perturb(q, rng, settings) {
    const c = JSON.parse(JSON.stringify(q));
    const doShuffle = !settings || settings.shuffleOptions !== false;
    if ((c.type === 'MC' || c.type === 'MA') && doShuffle && choicesShuffleable(c)) c.options = shuffleChoices(c.options, rng);
    if (c.type === 'MAT') {
      if (doShuffle) c.pairs = shuffle(c.pairs, rng);
      const rights = c.pairs.map(p => p.right).concat(c.distractors || []);
      let col = shuffle(rights, rng);
      // never print the key in order (1-A, 2-B, …) when it can be avoided
      for (let t = 0; t < 6 && col.length > 2 && c.pairs.every((p, i) => col[i] === p.right); t++) col = shuffle(rights, rng);
      c.rightColumn = col;
    }
    return c;
  }

  /* ---------- drawing with minimal overlap ---------- */
  function priorityOrder(pool, stats, rng) {
    return pool.questions
      .map(q => ({ q, s: stats.get(q.key) || { count: 0, last: '' }, r: rng() }))
      .sort((a, b) => a.s.count - b.s.count || (a.s.last < b.s.last ? -1 : a.s.last > b.s.last ? 1 : 0) || a.r - b.r)
      .map(x => x.q);
  }

  function pairOverlap(sets) {
    const n = sets.length;
    const m = [];
    for (let i = 0; i < n; i++) {
      m.push([]);
      for (let j = 0; j < n; j++) {
        if (i === j) { m[i].push(sets[i].size); continue; }
        let c = 0;
        sets[i].forEach(k => { if (sets[j].has(k)) c++; });
        m[i].push(c);
      }
    }
    return m;
  }

  /** Spread `copies` (key → times) over X forms of size d, each question at most once per form. */
  function assignCopies(order, copies, X, d, rng, basePair) {
    let best = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const forms = Array.from({ length: X }, () => new Set());
      const pair = basePair.map(r => r.slice());
      const items = order.filter(q => copies.get(q.key) > 0)
        .map(q => ({ key: q.key, n: copies.get(q.key), r: rng() }))
        .sort((a, b) => b.n - a.n || a.r - b.r);
      let ok = true;
      for (const it of items) {
        for (let c = 0; c < it.n; c++) {
          let pick = -1, bestCost = Infinity;
          const holders = forms.map((f, i) => (f.has(it.key) ? i : -1)).filter(i => i >= 0);
          forms.forEach((f, i) => {
            if (f.size >= d || f.has(it.key)) return;
            const cost = holders.reduce((s, h) => s + (pair[i][h] + 1) * (pair[i][h] + 1), 0) * 10 - (d - f.size) + rng() * 0.5;
            if (cost < bestCost) { bestCost = cost; pick = i; }
          });
          if (pick < 0) { ok = false; break; }
          holders.forEach(h => { pair[pick][h]++; pair[h][pick]++; });
          forms[pick].add(it.key);
        }
        if (!ok) break;
      }
      if (!ok || forms.some(f => f.size !== d)) continue;
      let max = 0, sq = 0;
      for (let i = 0; i < X; i++) for (let j = i + 1; j < X; j++) { max = Math.max(max, pair[i][j]); sq += pair[i][j] * pair[i][j]; }
      if (!best || max < best.max || (max === best.max && sq < best.sq)) best = { forms, max, sq, pair };
      if (best.max === 0) break;
    }
    if (best) best.pair.forEach((r, i) => r.forEach((v, j) => { basePair[i][j] = v; }));
    return best ? best.forms : null;
  }

  /** Keys drawn from one pool for each of X forms. */
  function drawPool(pool, X, stats, rng, globalPair) {
    const n = pool.questions.length;
    const d = Math.min(pool.draw || 0, n);
    if (!d) return { perForm: Array.from({ length: X }, () => []), note: '' };
    const order = priorityOrder(pool, stats, rng);
    const total = X * d;
    if (total <= n) {
      const chosen = shuffle(order.slice(0, total), rng);
      return { perForm: Array.from({ length: X }, (_, i) => chosen.slice(i * d, (i + 1) * d).map(q => q.key)), note: 'distinct' };
    }
    const base = Math.floor(total / n);
    const extra = total - base * n;
    const copies = new Map(order.map((q, i) => [q.key, base + (i < extra ? 1 : 0)]));
    const sets = assignCopies(order, copies, X, d, rng, globalPair);
    if (!sets) {
      // fallback: independent draws (should not happen when d ≤ n)
      return { perForm: Array.from({ length: X }, () => shuffle(order, rng).slice(0, d).map(q => q.key)), note: 'random' };
    }
    return { perForm: sets.map(s => shuffle(Array.from(s), rng)), note: 'shared' };
  }

  /* ---------- sections (pools combined under one outcome) ---------- */
  /**
   * A pool with joinedTo = <lead pool id> belongs to the lead's section; the lead's
   * draw, points and label apply to the whole section. Members follow their lead.
   * Returns [{ id, lead, label, title, draw, points, pools, size }].
   */
  function sectionsOf(pools) {
    const out = [];
    const byId = new Map();
    (pools || []).forEach(p => {
      const sec = p.joinedTo && byId.get(p.joinedTo);
      if (sec) { sec.pools.push(p); return; }
      const s = { id: p.id, lead: p, label: p.label || '', title: p.title, draw: Number(p.draw) || 0, points: Number(p.points) || 0, pools: [p] };
      byId.set(p.id, s);
      out.push(s);
    });
    out.forEach(s => { s.size = s.pools.reduce((a, p) => a + p.questions.length, 0); });
    return out;
  }
  /** The name printed for a section: its label, else its bank titles. */
  function sectionName(sec) {
    if (!sec) return '';
    return sec.label || sec.pools.map(p => p.title).join(' + ');
  }
  /** The section a pool belongs to. */
  function sectionOfPool(pools, poolId) {
    return sectionsOf(pools).find(s => s.pools.some(p => p.id === poolId)) || null;
  }
  /**
   * Put every member right after its lead and drop links that no longer hold
   * (lead removed, or a lead that is itself joined). Changes the array in place.
   */
  function tidySections(pools) {
    const byId = new Map(pools.map(p => [p.id, p]));
    // follow chains (a joined to b joined to c) to the first pool; drop broken links and loops
    const root = new Map();
    pools.forEach(p => {
      let cur = p;
      const seen = new Set();
      while (cur.joinedTo && byId.has(cur.joinedTo) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.joinedTo); }
      root.set(p, seen.has(cur.id) ? p : cur);
    });
    pools.forEach(p => { const r = root.get(p); if (r === p) delete p.joinedTo; else p.joinedTo = r.id; });
    const leads = pools.filter(p => !p.joinedTo);
    const ordered = [];
    leads.forEach(l => { ordered.push(l); pools.forEach(p => { if (p.joinedTo === l.id) ordered.push(p); }); });
    pools.splice(0, pools.length, ...ordered);
    return pools;
  }
  /**
   * How many questions each bank of a section gives every form: largest remainder
   * on bank sizes, ties to the bigger bank, then the earlier one. Deterministic, so
   * the Generate step can preview it and every form gets the same mix.
   */
  function sectionMix(sec) {
    const N = sec.size;
    const d = Math.min(sec.draw || 0, N);
    if (!d) return sec.pools.map(() => 0);
    if (sec.pools.length === 1) return [d];
    const exact = sec.pools.map(p => d * p.questions.length / N);
    const k = exact.map(Math.floor);
    let left = d - k.reduce((a, b) => a + b, 0);
    exact.map((e, i) => ({ i, r: e - k[i], n: sec.pools[i].questions.length }))
      .sort((a, b) => b.r - a.r || b.n - a.n || a.i - b.i)
      .forEach(x => { if (left > 0 && k[x.i] < x.n) { k[x.i]++; left--; } });
    return k;
  }

  const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function formCode(i) { return i < 26 ? CODES[i] : CODES[Math.floor(i / 26) - 1] + CODES[i % 26]; }

  /** One printable item from a pool question; points come from its section. */
  function makeItem(pool, q, rng, settings, sec) {
    const pts = sec ? sec.points : pool.points;
    return { id: BQ.uid(), poolId: pool.id, sectionId: sec ? sec.id : pool.id, key: q.key, points: Number(pts) || 1, q: perturb(q, rng, settings), lines: null };
  }

  function orderItems(items, sections, rng, settings) {
    if (settings.mixSections) return shuffle(items, rng);
    const out = [];
    sections.forEach(sec => {
      const mine = items.filter(it => it.sectionId === sec.id);
      out.push(...(settings.shuffleQuestions === false ? mine : shuffle(mine, rng)));
    });
    return out;
  }

  /**
   * Generate X forms.
   * project: { pools: [{ id, title, questions:[{key,…}], draw, points, label, joinedTo? }], usage, settings }
   * Returns { forms, overlap, notes }.
   */
  function generate(project, X, seed, startIndex) {
    const settings = project.settings || {};
    const stats = usageStats(project.usage);
    const rng = rngFrom(seed + '|draw');
    const sections = sectionsOf(project.pools).filter(s => s.draw > 0 && s.size);
    const globalPair = Array.from({ length: X }, () => new Array(X).fill(0));
    const draws = [];
    sections.forEach(sec => {
      const mix = sectionMix(sec);
      sec.pools.forEach((p, j) => {
        if (!mix[j]) return;
        draws.push({ pool: p, sec, ...drawPool(Object.assign({}, p, { draw: mix[j] }), X, stats, rng, globalPair) });
      });
    });
    const forms = [];
    for (let i = 0; i < X; i++) {
      const code = formCode((startIndex || 0) + i);
      const frng = rngFrom(seed + '|form|' + code);
      const items = [];
      draws.forEach(dr => dr.perForm[i].forEach(key => {
        const q = dr.pool.questions.find(x => x.key === key);
        if (q) items.push(makeItem(dr.pool, q, frng, settings, dr.sec));
      }));
      forms.push({ id: BQ.uid(), code, seed, createdAt: new Date().toISOString(), items: orderItems(items, sections, frng, settings) });
    }
    return { forms, overlap: overlapMatrix(forms), notes: draws.map(d => ({ poolId: d.pool.id, note: d.note })) };
  }

  function overlapMatrix(forms) {
    return pairOverlap(forms.map(f => new Set(f.items.map(it => it.key))));
  }

  /** Swap one item of a form for another question from the same pool. */
  function swapItem(project, form, itemId, newKey) {
    const idx = form.items.findIndex(it => it.id === itemId);
    if (idx < 0) return null;
    const old = form.items[idx];
    const pool = project.pools.find(p => p.id === old.poolId);
    const q = pool && pool.questions.find(x => x.key === newKey);
    if (!q) return null;
    const rng = rngFrom(form.seed + '|swap|' + newKey + '|' + Date.now());
    const it = makeItem(pool, q, rng, project.settings || {});
    it.points = old.points;
    it.sectionId = old.sectionId || old.poolId;
    form.items[idx] = it;
    return it;
  }

  /* ---------- totals ---------- */
  function totalPoints(form) {
    return form.items.reduce((s, it) => s + (Number(it.points) || 0), 0);
  }
  function blueprintSummary(pools) {
    let n = 0, pts = 0;
    sectionsOf(pools).forEach(s => { const d = Math.min(s.draw || 0, s.size); n += d; pts += d * (Number(s.points) || 0); });
    return { questions: n, points: pts };
  }

  PT.forms = { sectionsOf, sectionName, sectionOfPool, tidySections, sectionMix, rngFrom, shuffle, newSeed, questionKey, usageStats, perturb, choicesShuffleable, shuffleChoices, generate, overlapMatrix, swapItem, formCode, totalPoints, blueprintSummary, ANCHOR_RE };
})();
