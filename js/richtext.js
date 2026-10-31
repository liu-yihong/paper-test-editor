/*
 * Rich-text markup used inside every question field.
 *
 *   **bold**   _italic_   ^superscript^   ~subscript~   `code`
 *   $inline math$   $$display math$$   (LaTeX)
 *   a small, sanitized set of HTML tags (<u>, <br>, <a href>, tables, MathML …)
 *   a backslash escapes a marker:  \*  \_  \$  \^  \~  \`  \[  \]  \;
 *
 * The same markup is what you type in Text mode, so Form and Text mode share
 * one representation and stay in sync without lossy conversions.
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  const ALLOWED_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'code', 'br', 'p', 'span', 'div', 'a',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'blockquote', 'hr', 'img'
  ]);
  const MATH_TAGS = new Set([
    'math', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mrow', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt',
    'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mspace', 'mstyle', 'mpadded',
    'mphantom', 'semantics', 'annotation', 'menclose', 'mfenced'
  ]);
  const SAFE_ATTRS = {
    a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan']
  };
  const MATH_ATTRS = new Set([
    'display', 'xmlns', 'mathvariant', 'stretchy', 'fence', 'separator', 'accent', 'accentunder',
    'lspace', 'rspace', 'encoding', 'linethickness', 'columnalign', 'rowspacing', 'columnspacing',
    'scriptlevel', 'displaystyle', 'width', 'height', 'depth', 'minsize', 'maxsize',
    'movablelimits', 'symmetric', 'largeop', 'form', 'notation'
  ]);
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?)\s*>/g;
  const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  const ESCAPABLE = '\\*_$^~`[]=;|<&#';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* Minimal escaping: only what could be mistaken for a tag. Keeps plain text byte-identical. */
  function escapeMinimal(s) {
    return String(s).replace(/<(?=[a-zA-Z\/!?])/g, '&lt;');
  }
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', times: '×', divide: '÷', plusmn: '±', le: '≤', ge: '≥', ne: '≠', pi: 'π', micro: 'µ', copy: '©', reg: '®', middot: '·' };
  function decodeEntities(s) {
    return String(s).replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
    });
  }

  /* Block-level tags: line breaks typed next to them are layout, not <br>. */
  const BLOCK_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'p', 'div', 'blockquote', 'pre', 'hr']);

  /* A picture stored in the project is referenced by its file name: <img src="graph.png">. */
  const LOCAL_IMG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|gif|webp|svg)$/i;
  const isLocalImage = (src) => LOCAL_IMG_RE.test(String(src || '').trim());

  /** Attributes of a tag as a lower-cased map. */
  function readAttrs(attrStr) {
    const out = {};
    (attrStr || '').replace(ATTR_RE, (a, k, v) => { out[k.toLowerCase()] = v == null ? '' : v.replace(/^["']|["']$/g, ''); return ''; });
    return out;
  }
  /** Names of project pictures used in a piece of markup. */
  function imagesIn(src) {
    const names = [];
    String(src || '').replace(TAG_RE, (m, close, name, attrs) => {
      if (!close && name.toLowerCase() === 'img') {
        const s = (readAttrs(attrs).src || '').trim();
        if (isLocalImage(s) && !names.includes(s)) names.push(s);
      }
      return m;
    });
    return names;
  }

  /**
   * opts.image(name) resolves a project picture's file name to the address to write
   * (a blob URL for previews, Blackboard's embedded-file reference for the .zip).
   * Returning null leaves the picture out and writes its description instead.
   */
  function sanitizeTag(close, name, attrStr, opts) {
    const n = name.toLowerCase();
    const isMath = MATH_TAGS.has(n);
    if (!ALLOWED_TAGS.has(n) && !isMath) return null;
    if (close) return '</' + n + '>';
    const attrs = readAttrs(attrStr);
    if (n === 'img' && isLocalImage(attrs.src) && opts && typeof opts.image === 'function') {
      const url = opts.image(attrs.src.trim());
      if (url == null) return escapeHtml(pictureLabel(attrs.alt));
      attrs.src = url;
      attrs.__trusted = true;
    }
    let out = '<' + n;
    const allowed = isMath ? MATH_ATTRS : new Set(SAFE_ATTRS[n] || []);
    for (const k in attrs) {
      if (!allowed.has(k)) continue;
      const val = attrs[k];
      if (k === 'href' && !/^(https?:|mailto:)/i.test(val.trim())) continue;
      if (k === 'src' && !attrs.__trusted && !/^https?:/i.test(val.trim()) && !isLocalImage(val)) continue;
      if (k === 'width' && !/^\d{1,4}$/.test(val.trim())) continue;
      out += ' ' + k + '="' + val.replace(/"/g, '&quot;') + '"';
    }
    // align="left|center|right" on a picture: its own line, aligned (written as inline style for Blackboard)
    if (n === 'img' && IMG_ALIGN[attrs.align]) out += ' style="' + IMG_ALIGN[attrs.align] + '"';
    return out + '>';
  }
  const IMG_ALIGN = {
    left: 'display:block;margin:6px auto 6px 0;max-width:100%;height:auto',
    center: 'display:block;margin:6px auto;max-width:100%;height:auto',
    right: 'display:block;margin:6px 0 6px auto;max-width:100%;height:auto'
  };
  const pictureLabel = (alt) => '[Picture' + (alt && alt.trim() ? ': ' + alt.trim() : '') + ']';

  /* ---------- simple tables:  | a | b |  ---------- */
  const TABLE_LINE = /^\s*\|.*\|\s*$/;
  const TABLE_RULE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;
  /* Optional line just above a table:  {table align=center}  (left is the default). */
  const TABLE_ALIGN_LINE = /^\s*\{table\s+align\s*=\s*(left|center|right)\s*\}\s*$/i;
  const TABLE_MARGIN = { left: '', center: ';margin-left:auto;margin-right:auto', right: ';margin-left:auto;margin-right:0' };
  function tableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  }
  /** Replace runs of |-delimited lines with table markup (tags are emitted as tokens). */
  function pipeTables(s, put, html) {
    const lines = s.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!TABLE_LINE.test(lines[i]) || !(i + 1 < lines.length && TABLE_LINE.test(lines[i + 1]))) { out.push(lines[i]); continue; }
      let j = i;
      while (j < lines.length && TABLE_LINE.test(lines[j])) j++;
      const rows = lines.slice(i, j);
      const hasHead = rows.length > 1 && TABLE_RULE.test(rows[1]);
      const body = rows.filter((r, k) => !(hasHead && k === 1)).map(tableCells);
      let align = 'left';
      const am = out.length ? TABLE_ALIGN_LINE.exec(out[out.length - 1]) : null;
      if (am) { align = am[1].toLowerCase(); out.pop(); }
      if (!html) {
        out.push(body.map(r => r.join(' | ')).join('\n'));
      } else {
        const cell = (tag, c) => put('<' + tag + ' style="border:1px solid #999;padding:4px 8px;text-align:left">') + (c.trim() ? c : put('&nbsp;')) + put('</' + tag + '>');
        out.push(put('<table border="1" cellpadding="4" style="border-collapse:collapse' + TABLE_MARGIN[align] + '">') +
          body.map((r, k) => put('<tr>') + r.map(c => cell(hasHead && k === 0 ? 'th' : 'td', c)).join('') + put('</tr>')).join('') +
          put('</table>'));
      }
      i = j - 1;
    }
    return out.join('\n');
  }

  /* ---------- LaTeX → Unicode text (used for "Unicode" math export and as a preview fallback) ---------- */
  const SYM = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    varpi: 'ϖ', rho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
    chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥',
    geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
    ll: '≪', gg: '≫', lt: '<', gt: '>', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', gets: '←',
    Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔',
    uparrow: '↑', downarrow: '↓', mapsto: '↦', rightleftharpoons: '⇌', longrightarrow: '⟶',
    partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', in: '∈', notin: '∉',
    ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
    emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
    land: '∧', wedge: '∧', lor: '∨', vee: '∨', oplus: '⊕', otimes: '⊗', angle: '∠', degree: '°',
    circ: '∘', bullet: '•', perp: '⊥', parallel: '∥', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮',
    prime: '′', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', mid: '∣', langle: '⟨', rangle: '⟩',
    lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', triangle: '△', square: '□', therefore: '∴',
    because: '∵', checkmark: '✓', top: '⊤', bot: '⊥', vert: '|', Vert: '‖', backslash: '\\',
    quad: '  ', qquad: '    ', ',': ' ', ':': ' ', ';': ' ', ' ': ' ', '!': '', '\\': ' ', '{': '{',
    '}': '}', '%': '%', '$': '$', '&': '&', '#': '#', '_': '_', '|': '‖'
  };
  const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'deg', 'dim', 'ker', 'arg', 'Pr', 'mod', 'bmod']);
  const ACCENT = { vec: '⃗', hat: '̂', bar: '̄', overline: '̅', dot: '̇', ddot: '̈', tilde: '̃', widehat: '̂', widetilde: '̃' };
  const TEXTLIKE = new Set(['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal', 'mathbb', 'textbf', 'textit', 'textrm', 'operatorname', 'boldsymbol', 'mbox', 'displaystyle', 'textstyle', 'mathnormal']);
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', T: 'ᵀ', '′': '′', '°': '°', '*': '*' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };

  function scriptText(arg, sup) {
    const map = sup ? SUP : SUB;
    const chars = Array.from(arg);
    if (chars.length && chars.every(c => map[c] !== undefined)) return chars.map(c => map[c]).join('');
    if (chars.length === 1) return (sup ? '^' : '_') + arg;
    return (sup ? '^(' : '_(') + arg + ')';
  }
  function wrapParen(x) {
    const t = x.trim();
    if (Array.from(t).length <= 1 || /^[A-Za-z0-9.Ͱ-Ͽ′²³¹⁰-⁹]+$/.test(t)) return t;
    if (/^\(.*\)$/.test(t) && balanced(t.slice(1, -1))) return t;
    return '(' + t + ')';
  }
  function balanced(t) {
    let d = 0;
    for (const c of t) { if (c === '(') d++; else if (c === ')' && --d < 0) return false; }
    return d === 0;
  }

  function texToUnicode(tex) {
    const s = String(tex);
    let i = 0;
    const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function atom() {
      skip();
      if (s[i] === '{') { i++; const r = seq('}'); i++; return r; }
      if (s[i] === '\\') return command();
      return i < s.length ? s[i++] : '';
    }
    function seq(stop) {
      let out = '';
      while (i < s.length && s[i] !== stop) {
        const c = s[i];
        if (c === '{') { i++; out += seq('}'); i++; }
        else if (c === '^' || c === '_') { i++; out += scriptText(atom(), c === '^'); }
        else if (c === '\\') out += command();
        else if (c === '}') i++;
        else if (c === '~') { out += ' '; i++; }
        else if (c === '&') { out += ' '; i++; }
        else { out += c === '-' ? '−' : c === '*' ? '∗' : c === "'" ? '′' : c; i++; }
      }
      return out;
    }
    function command() {
      i++;
      if (i >= s.length) return '';
      let name;
      if (/[a-zA-Z]/.test(s[i])) { name = /^[a-zA-Z]+/.exec(s.slice(i))[0]; i += name.length; }
      else name = s[i++];
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const a = atom(), b = atom();
        return wrapParen(a) + '/' + wrapParen(b);
      }
      if (name === 'sqrt') {
        skip();
        let n = '';
        if (s[i] === '[') { const j = s.indexOf(']', i); n = s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; }
        const a = atom();
        const rad = n === '3' ? '∛' : n === '4' ? '∜' : (n ? scriptText(n, true) : '') + '√';
        return rad + wrapParen(a);
      }
      if (TEXTLIKE.has(name)) return name === 'displaystyle' || name === 'textstyle' ? '' : atom();
      if (ACCENT[name]) { const a = atom(); return a + ACCENT[name]; }
      if (/^(left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr)$/.test(name)) {
        skip();
        if (s[i] === '\\') return command();
        if (s[i] === '.') { i++; return ''; }
        return i < s.length ? s[i++] : '';
      }
      if (name === 'binom') { const a = atom(), b = atom(); return 'C(' + a + ', ' + b + ')'; }
      if (name === 'begin' || name === 'end') { atom(); return ' '; }
      if (Object.prototype.hasOwnProperty.call(SYM, name)) return SYM[name];
      if (FUNCS.has(name)) return name;
      return name;
    }
    return seq(undefined).replace(/[ \t]{2,}/g, ' ').trim();
  }

  /* ---------- math rendering ---------- */
  function katexMathML(tex, display) {
    const k = globalThis.katex;
    if (!k || typeof k.renderToString !== 'function') return null;
    try {
      const html = k.renderToString(tex, { output: 'mathml', displayMode: !!display, throwOnError: false, strict: 'ignore' });
      const m = /<math[\s\S]*<\/math>/.exec(html);
      return m ? m[0] : null;
    } catch (e) {
      return null;
    }
  }
  function renderMath(tex, display, mode, html) {
    if (!html) {
      if (mode === 'latex') return display ? '\\[' + tex + '\\]' : '\\(' + tex + '\\)';
      return texToUnicode(tex);
    }
    if (mode === 'latex') return escapeMinimal(display ? '\\[' + tex + '\\]' : '\\(' + tex + '\\)');
    if (mode === 'mathml' || mode === 'preview') {
      const mml = katexMathML(tex, display);
      if (mml) return mode === 'preview' ? '<span class="math' + (display ? ' math-block' : '') + '">' + mml + '</span>' : mml;
      if (mode === 'preview') return '<span class="math math-fallback">' + escapeHtml(texToUnicode(tex)) + '</span>';
    }
    return escapeMinimal(texToUnicode(tex));
  }

  /* Pull $...$ and $$...$$ out of a string, honouring backslash escapes. */
  function extractMath(s, put, fn) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { out += s.substr(i, 2); i += 2; continue; }
      if (c === '$') {
        const display = s[i + 1] === '$';
        const open = display ? 2 : 1;
        let j = i + open, found = -1;
        while (j < s.length) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '$') {
            if (!display || s[j + 1] === '$') { found = j; break; }
          }
          j++;
        }
        if (found > i + open) {
          const tex = s.slice(i + open, found);
          const ok = display || (!/^\s/.test(tex) && !/\s$/.test(tex) && !/^\d/.test(s[found + 1] || ''));
          if (ok) { out += put(fn(tex, display)); i = found + open; continue; }
        }
      }
      out += c;
      i++;
    }
    return out;
  }

  /**
   * Convert markup to HTML or to plain text.
   * opts.target: 'html' | 'plain';  opts.math: 'preview' | 'mathml' | 'latex' | 'unicode'
   */
  function render(src, opts) {
    opts = opts || {};
    const html = opts.target !== 'plain';
    const mathMode = opts.math || 'unicode';
    const toks = [];
    const blocks = new Set();
    const put = (x) => '' + (toks.push(x) - 1) + '';
    const putBlock = (x) => { const t = put(x); blocks.add(toks.length - 1); return t; };
    let s = String(src == null ? '' : src).replace(/[]/g, '').replace(/\r\n?/g, '\n');

    // 1. code spans: content is literal
    s = s.replace(/(^|[^\\])`([^`\n]+?)`/g, (m, pre, c) => pre + put(html ? '<code>' + escapeHtml(c) + '</code>' : c));
    // 2. math
    s = extractMath(s, put, (tex, display) => renderMath(tex, display, mathMode, html));
    // 3. backslash escapes
    s = s.replace(/\\([\\*_$^~`\[\]=;|<&#])/g, (m, c) => put(html ? (c === '<' ? '&lt;' : c === '&' ? '&amp;' : c) : c));
    // 4. simple | tables |, then HTML tags
    s = pipeTables(s, (x) => (/^<\/?(table|tr|td|th)\b/.test(x) ? putBlock(x) : put(x)), html);
    s = s.replace(TAG_RE, (m, close, name, attrs) => {
      const n = name.toLowerCase();
      if (html) {
        const t = sanitizeTag(close, name, attrs, opts);
        return t === null ? m : BLOCK_TAGS.has(n) ? putBlock(t) : put(t);
      }
      if (!ALLOWED_TAGS.has(n) && !MATH_TAGS.has(n)) return m;
      if (n === 'img' && !close) return put(pictureLabel(readAttrs(attrs).alt));
      return /^(br|p|div|li|tr|hr|td|th)$/.test(n) ? put(' ') : '';
    });
    if (html) s = escapeMinimal(s);
    else s = decodeEntities(s);
    // 5. inline markers
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, (m, x) => (html ? '<strong>' + x + '</strong>' : x));
    s = s.replace(/(^|[\s(\[{"'‘“>\/-])_(?=[^\s_])([^\n]*?[^\s_\\])_(?=$|[\s.,;:!?)\]}"'’”<\/-])/g,
      (m, pre, x) => pre + (html ? '<em>' + x + '</em>' : x));
    s = s.replace(/(^|[^\\\w])_(?=[^\s_])([^\s_])_(?=$|\W)/g, (m, pre, x) => pre + (html ? '<em>' + x + '</em>' : x));
    s = s.replace(/\^(?=\S)([^\s^]+?)\^/g, (m, x) => (html ? '<sup>' + x + '</sup>' : scriptText(x, true)));
    s = s.replace(/~(?=\S)([^\s~]+?)~/g, (m, x) => (html ? '<sub>' + x + '</sub>' : scriptText(x, false)));
    // 6. line breaks (none next to block tags such as tables and lists)
    if (html && blocks.size) {
      s = s.replace(/[ \t]*\n[ \t]*(?=(\d+))/g, (m, n) => (blocks.has(+n) ? '' : m));
      s = s.replace(/(\d+)[ \t]*\n/g, (m, n) => (blocks.has(+n) ? m.slice(0, m.indexOf('') + 1) : m));
    }
    s = html ? s.replace(/\n/g, '<br>') : s.replace(/\s*\n\s*/g, ' ');
    // 7. restore tokens (they may nest)
    for (let guard = 0; guard < 5 && //.test(s); guard++) {
      s = s.replace(/(\d+)/g, (m, n) => toks[+n]);
    }
    return s;
  }

  function toHtml(src, opts) { return render(src, Object.assign({}, opts, { target: 'html' })); }
  function toPlain(src, opts) {
    return render(src, Object.assign({}, opts, { target: 'plain', math: (opts && opts.math === 'latex') ? 'latex' : 'unicode' })).replace(/ /g, ' ').trim();
  }

  /* ---------- HTML (from imported Blackboard files) → markup ---------- */
  function htmlToMarkup(h) {
    let s = String(h == null ? '' : h);
    if (!/[<&]/.test(s)) return s;
    s = s.replace(/<math\b([^>]*)>[\s\S]*?<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>[\s\S]*?<\/math>/gi,
      (m, attrs, tex) => {
        const d = /display=["']block/i.test(attrs) ? '$$' : '$';
        return d + decodeEntities(tex).trim() + d;
      });
    for (let k = 0; k < 2; k++) s = s.replace(/<span class=["']katex(?:-display)?["'][^>]*>\s*(\$[\s\S]*?\$)\s*<\/span>/gi, '$1');
    s = s.replace(/<(strong|b)>([^<]*?\S)<\/\1>/gi, (m, t, x) => (/^\s/.test(x) ? m : '**' + x + '**'));
    s = s.replace(/<(em|i)>([^<]+?)<\/\1>/gi, (m, t, x, off, all) => {
      const before = all[off - 1] || ' ', after = all[off + m.length] || ' ';
      if (/\w/.test(before) || /\w/.test(after) || /^\s|\s$/.test(x)) return m;
      return '_' + x + '_';
    });
    s = s.replace(/<sup>([^<\s^]+)<\/sup>/gi, '^$1^');
    s = s.replace(/<sub>([^<\s~]+)<\/sub>/gi, '~$1~');
    s = s.replace(/<code>([^<`]*)<\/code>/gi, (m, c) => '`' + decodeEntities(c) + '`');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p>\s*<p>/gi, '\n\n').replace(/^\s*<p>/i, '').replace(/<\/p>\s*$/i, '');
    // decode entities, but keep &lt; / &gt; so literal angle brackets don't become tags
    s = s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
      if (e === 'lt' || e === 'gt' || e === '#60' || e === '#62') return m;
      const d = decodeEntities(m);
      return d === '<' || d === '>' ? m : d;
    });
    return s;
  }

  /* Plain one-line summary of markup, for collapsed cards and lists. */
  function summary(src, max) {
    const t = toPlain(src || '', { math: 'unicode' });
    max = max || 90;
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  BQ.rt = { toHtml, toPlain, htmlToMarkup, texToUnicode, summary, escapeHtml, decodeEntities, imagesIn, isLocalImage, ESCAPABLE };
})();
