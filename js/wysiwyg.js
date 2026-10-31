/*
 * A small WYSIWYG field: what you type is what prints.
 *
 * The value is stored as the Question Editor's markup, so it renders the same way
 * everywhere (print view, Word, and back in the Question Editor):
 *   formatting  → a few safe HTML tags (<strong>, <em>, <u>, <sup>, <sub>, lists)
 *   code        → `code`
 *   math        → $LaTeX$  (or $$LaTeX$$ for display math)
 *   tables      → | a | b | rows, with {table align=center} above when aligned
 *   pictures    → <img src="name.png" alt="…" width="…" align="…">, stored in the project
 *   blanks      → [name]   (fill in multiple blanks, with opts.blanks)
 *
 *   const f = PT.wysiwyg({ value, onInput(markup), placeholder, label,
 *                          compact,   // one line: no lists or tables, Enter does nothing
 *                          mini,      // toolbar shows only while the field has focus
 *                          blanks,    // [name] blanks as chips, with a Blank button
 *                          images,    // project picture store { name: { type, data } }; enables pictures
 *                          notify });  // notify(message) for problems such as an unreadable picture
 *   f.el      the element to insert
 *   f.value   current markup (get / set)
 *
 * Picture and table tools follow the Blackboard Question Editor's: a size picker for
 * new tables, row/column buttons while the caret is in a table, and picture settings for
 * description, size and alignment. Big photos are shrunk to 1600 px on the long side.
 */
(function () {
  'use strict';
  const PT = (globalThis.PT = globalThis.PT || {});
  const BLANK_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
  const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
  const MAX_SIDE = 1600;
  /* the same inline styles the markup renderer writes for aligned pictures and tables */
  const IMG_ALIGN = {
    left: 'display:block;margin:6px auto 6px 0;max-width:100%;height:auto',
    center: 'display:block;margin:6px auto;max-width:100%;height:auto',
    right: 'display:block;margin:6px 0 6px auto;max-width:100%;height:auto'
  };
  const TABLE_ALIGN = { left: '', center: 'margin-left:auto;margin-right:auto', right: 'margin-left:auto;margin-right:0' };

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }

  /* ---------- chips: math and blanks ---------- */
  function mathHtml(tex, display) {
    const k = globalThis.katex;
    if (k && typeof k.renderToString === 'function') {
      try {
        const html = k.renderToString(tex, { output: 'mathml', displayMode: !!display, throwOnError: false, strict: 'ignore' });
        const m = /<math[\s\S]*<\/math>/.exec(html);
        if (m) return m[0];
      } catch (e) { /* fall through */ }
    }
    return BQ.rt.escapeHtml(BQ.rt.texToUnicode(tex));
  }
  function mathChip(tex, display) {
    return el('span', { class: 'wy-math' + (display ? ' wy-display' : ''), contenteditable: 'false', 'data-tex': tex, 'data-display': display ? '1' : null, title: 'Math: ' + tex + ' (click to edit)', html: mathHtml(tex, display) });
  }
  function blankChip(name) {
    return el('span', { class: 'wy-blank', contenteditable: 'false', 'data-name': name, title: 'Blank [' + name + '] (click to rename)', text: name });
  }

  /* ---------- pictures ---------- */
  const imageUrl = (images, name) => {
    const im = images && images[name];
    return im ? (im.url || 'data:' + im.type + ';base64,' + im.data) : null;
  };
  function applyPicture(img, p) {
    img.setAttribute('data-name', p.name);
    img.setAttribute('alt', p.alt || '');
    if (p.width) img.setAttribute('width', String(p.width)); else img.removeAttribute('width');
    img.setAttribute('data-align', p.align || 'inline');
    img.setAttribute('style', IMG_ALIGN[p.align] || '');
    img.setAttribute('contenteditable', 'false');
    img.title = 'Click for picture settings';
  }
  function pictureEl(images, p) {
    const img = el('img', { src: imageUrl(images, p.name) || '', class: 'wy-pic' });
    applyPicture(img, p);
    return img;
  }
  const readAsDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  /** Shrink big photos and screenshots so projects stay small enough to autosave. */
  async function shrinkIfLarge(file) {
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { return file; }
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 700 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    let out = await new Promise(r => c.toBlob(r, type, 0.85));
    if (out && type === 'image/png' && out.size > 700 * 1024) out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!out || (scale === 1 && out.size >= file.size)) return file;
    return new File([out], file.name.replace(/\.[^.]*$/, '') + (out.type === 'image/jpeg' ? '.jpg' : '.png'), { type: out.type });
  }
  function uniqueImageName(images, file, data) {
    const ext = IMG_TYPES[file.type] || 'png';
    let base = String(file.name || '').replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (!base || /^image$/i.test(base)) base = 'picture';
    if (!/^[A-Za-z0-9]/.test(base)) base = 'p' + base;
    for (let n = 1; ; n++) {
      const name = (n === 1 && base !== 'picture' ? base : base + '-' + n) + '.' + ext;
      const cur = images[name];
      if (!cur || cur.data === data) return name;
    }
  }
  /** Store a picture file in the project. Returns { name, width } or null. */
  async function storePicture(images, file, notify) {
    if (!IMG_TYPES[file.type]) { notify('Use a PNG, JPEG, GIF, WebP or SVG picture.'); return null; }
    try {
      const f = await shrinkIfLarge(file);
      const data = String(await readAsDataUrl(f)).replace(/^data:[^,]*,/, '');
      if (data.length > 2.8e6) { notify('That picture is over 2 MB. Make it smaller and try again.'); return null; }
      const name = uniqueImageName(images, f, data);
      images[name] = { type: f.type, data };
      let width = null;
      try { const bmp = await createImageBitmap(f); width = bmp.width; } catch (e) { /* SVG or unreadable size */ }
      return { name, width };
    } catch (e) {
      notify('Could not read that picture.');
      return null;
    }
  }

  /* ---------- markup → editable HTML ---------- */
  function toEditable(markup, opts) {
    opts = opts || {};
    const images = opts.images || {};
    const urls = new Map();
    const html = BQ.rt.toHtml(markup || '', {
      math: 'mathml',
      image: (name) => {
        const url = imageUrl(images, name);
        if (!url) return null;
        urls.set(url, name);
        return url;
      }
    });
    const box = document.createElement('div');
    box.innerHTML = html;
    box.querySelectorAll('math').forEach(m => {
      const ann = m.querySelector('annotation');
      const tex = ann ? ann.textContent.trim() : m.textContent.trim();
      m.replaceWith(mathChip(tex, m.getAttribute('display') === 'block'));
    });
    box.querySelectorAll('img').forEach(img => {
      const name = urls.get(img.getAttribute('src'));
      if (!name) { img.remove(); return; }
      const st = (img.getAttribute('style') || '').replace(/\s+/g, '');
      const align = /margin:6pxauto6px0/.test(st) ? 'left' : /margin:6pxauto;|margin:6pxauto$/.test(st) ? 'center' : /margin:6px06pxauto/.test(st) ? 'right' : 'inline';
      img.className = 'wy-pic';
      applyPicture(img, { name, alt: img.getAttribute('alt') || '', width: parseInt(img.getAttribute('width'), 10) || null, align });
    });
    box.querySelectorAll('table').forEach(t => {
      const st = (t.getAttribute('style') || '').replace(/\s+/g, '');
      const align = /margin-left:auto;margin-right:auto/.test(st) ? 'center' : /margin-left:auto;margin-right:0/.test(st) ? 'right' : 'left';
      setTableAlign(t, align);
      t.removeAttribute('border'); t.removeAttribute('cellpadding');
      t.querySelectorAll('td, th').forEach(c => { c.removeAttribute('style'); if (c.textContent.replace(/ /g, '').trim() === '' && !c.querySelector('img, .wy-math')) c.innerHTML = '<br>'; });
    });
    // a caret stop after code (or a table) that ends a line, so typing there isn't stuck inside it
    box.querySelectorAll('code').forEach(c => { if (!c.nextSibling || (c.nextSibling.nodeType === 1 && c.nextSibling.localName === 'br')) c.after(document.createTextNode('​')); });
    if (opts.blanks) {
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) if (!walker.currentNode.parentNode.closest('code, .wy-math')) texts.push(walker.currentNode);
      texts.forEach(t => {
        const parts = t.nodeValue.split(/\[([A-Za-z][A-Za-z0-9_-]{0,39})\]/);
        if (parts.length < 2) return;
        const frag = document.createDocumentFragment();
        parts.forEach((p, i) => frag.append(i % 2 ? blankChip(p) : document.createTextNode(p)));
        t.replaceWith(frag);
      });
    }
    return box.innerHTML;
  }
  function setTableAlign(t, align) {
    t.setAttribute('data-align', align);
    t.setAttribute('style', TABLE_ALIGN[align] || '');
  }

  /* ---------- editable DOM → markup ---------- */
  const ESC_RE = /[\\*_$^~`\[\]<|&]/g;
  const INLINE = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', sup: 'sup', sub: 'sub', s: 's', strike: 's' };
  const BLOCK = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  const clean = (s) => s.replace(/​/g, '').replace(/ /g, ' ');

  function serialize(root) {
    let out = '';
    const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
    const sub = (node) => { const keep = out; out = ''; node.childNodes.forEach(walk); const r = out; out = keep; return r; };
    function walk(n) {
      if (n.nodeType === 3) { out += clean(n.nodeValue).replace(ESC_RE, '\\$&'); return; }
      if (n.nodeType !== 1) return;
      const t = n.localName;
      const cls = n.classList;
      if (cls && cls.contains('wy-math')) { const d = n.getAttribute('data-display') ? '$$' : '$'; out += d + n.getAttribute('data-tex') + d; return; }
      if (cls && cls.contains('wy-blank')) { out += '[' + n.getAttribute('data-name') + ']'; return; }
      if (t === 'br') { out += '\n'; return; }
      if (t === 'math') { const a = n.querySelector('annotation'); out += '$' + (a ? a.textContent : n.textContent).trim() + '$'; return; }
      if (t === 'img') {
        const name = n.getAttribute('data-name');
        if (!name) return;
        const alt = n.getAttribute('alt');
        const w = n.getAttribute('width');
        const a = n.getAttribute('data-align');
        out += '<img src="' + name + '"' + (alt ? ' alt="' + alt.replace(/"/g, '') + '"' : '') + (w ? ' width="' + w + '"' : '') + (a && a !== 'inline' ? ' align="' + a + '"' : '') + '>';
        return;
      }
      if (t === 'code') {
        const txt = clean(n.textContent);
        if (!txt) return;
        if (n.querySelector('*')) { out += '<code>' + sub(n) + '</code>'; return; }
        out += /[`\n]/.test(txt) ? '<code>' + txt.replace(ESC_RE, '\\$&') + '</code>' : '`' + txt + '`';
        return;
      }
      if (t === 'table') {
        nl();
        const align = n.getAttribute('data-align');
        if (align === 'center' || align === 'right') out += '{table align=' + align + '}\n';
        const rows = Array.from(n.querySelectorAll('tr'));
        rows.forEach((r, i) => {
          const cells = Array.from(r.children).filter(c => /^t[dh]$/.test(c.localName));
          out += '| ' + cells.map(c => sub(c).replace(/\n+/g, ' ').trim() || ' ').join(' | ') + ' |\n';
          if (i === 0 && cells.some(c => c.localName === 'th')) out += '|' + cells.map(() => '---').join('|') + '|\n';
        });
        return;
      }
      let tag = INLINE[t];
      // pasted or browser-made styling on spans
      if (!tag && t === 'span' && n.style) {
        if (/bold|[6-9]00/.test(n.style.fontWeight)) tag = 'strong';
        else if (n.style.fontStyle === 'italic') tag = 'em';
        else if (/underline/.test(n.style.textDecoration)) tag = 'u';
      }
      if (tag) {
        const inner = sub(n);
        if (inner.trim()) {
          const lead = /^\s*/.exec(inner)[0], trail = /\s*$/.exec(inner)[0];
          out += lead + '<' + tag + '>' + inner.trim() + '</' + tag + '>' + trail;
        } else out += inner;
        return;
      }
      if (t === 'ul' || t === 'ol') {
        nl();
        out += '<' + t + '>';
        n.childNodes.forEach(c => {
          if (c.nodeType === 1 && c.localName === 'li') out += '<li>' + sub(c).replace(/\n+$/, '').replace(/\n/g, '<br>') + '</li>';
        });
        out += '</' + t + '>\n';
        return;
      }
      if (BLOCK.has(t) || t === 'li' || t === 'pre') {
        nl();
        n.childNodes.forEach(walk);
        nl();
        return;
      }
      n.childNodes.forEach(walk);
    }
    root.childNodes.forEach(walk);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }

  /* ---------- the field ---------- */
  function wysiwyg(opts) {
    opts = opts || {};
    /** The project's picture store (opts.images may be a function, so a newly opened project is picked up). */
    const imgStore = () => (typeof opts.images === 'function' ? opts.images() : opts.images) || null;
    const notify = opts.notify || ((m) => { try { console.warn(m); } catch (e) { /* ignore */ } });
    const area = el('div', { class: 'wy-area' + (opts.compact ? ' wy-compact' : ''), contenteditable: 'true', role: 'textbox', 'aria-multiline': opts.compact ? 'false' : 'true', 'aria-label': opts.label || 'Text', 'data-placeholder': opts.placeholder || '' });
    let last = '';
    let saved = null;
    const isEmpty = () => !area.textContent.replace(/​/g, '').trim() && !area.querySelector('.wy-math, .wy-blank, img, table');

    const changed = () => {
      const v = serialize(area);
      area.classList.toggle('wy-empty', isEmpty());
      if (v !== last) { last = v; if (opts.onInput) opts.onInput(v); }
      syncButtons();
    };
    const inArea = (node) => node && area.contains(node.nodeType === 1 ? node : node.parentNode);
    const save = () => {
      const s = getSelection();
      if (s.rangeCount && inArea(s.getRangeAt(0).commonAncestorContainer)) saved = s.getRangeAt(0).cloneRange();
    };
    const restore = () => {
      if (!saved) return;
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(saved);
    };
    const exec = (cmd, arg) => { area.focus(); restore(); document.execCommand(cmd, false, arg); changed(); };
    const caretAfter = (node) => {
      const s = getSelection();
      const r = document.createRange();
      r.setStartAfter(node); r.collapse(true);
      s.removeAllRanges(); s.addRange(r);
      saved = r.cloneRange();
    };

    /** Put a node at the caret (or replace the selection) and move the caret after it. */
    function insertAtCaret(node, block) {
      area.focus();
      restore();
      const s = getSelection();
      let r = s.rangeCount && inArea(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null;
      if (!r) { r = document.createRange(); r.selectNodeContents(area); r.collapse(false); }
      r.deleteContents();
      if (block) {
        // a table goes between lines: split at the caret's line
        r.insertNode(node);
        if (!node.nextSibling || node.nextSibling.nodeType !== 1 || node.nextSibling.localName !== 'div') node.after(el('div', null, el('br')));
        const next = node.nextSibling;
        const rr = document.createRange();
        rr.setStart(next, 0); rr.collapse(true);
        s.removeAllRanges(); s.addRange(rr);
      } else {
        const after = document.createTextNode('​');
        r.insertNode(node);
        node.after(after);
        caretAfter(after);
      }
      changed();
    }

    function toggleCode() {
      area.focus();
      restore();
      const s = getSelection();
      if (!s.rangeCount || !inArea(s.getRangeAt(0).commonAncestorContainer)) return;
      const r = s.getRangeAt(0);
      const start = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
      const code = start.closest('code');
      if (code && area.contains(code)) {
        code.replaceWith(document.createTextNode(code.textContent));
      } else if (r.collapsed) {
        const c = el('code', null, '​');
        r.insertNode(c);
        r.setStart(c.firstChild, 1); r.collapse(true);
        s.removeAllRanges(); s.addRange(r);
      } else {
        const c = el('code', null, r.toString());
        r.deleteContents();
        r.insertNode(c);
        r.selectNodeContents(c);
        s.removeAllRanges(); s.addRange(r);
      }
      area.normalize();
      changed();
    }

    const btn = (label, title, cmd, arg, cls) => el('button', {
      type: 'button', class: 'wy-btn ' + (cls || ''), title, 'aria-label': title, 'data-cmd': typeof cmd === 'string' ? cmd : '', html: label,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => (typeof cmd === 'function' ? cmd() : exec(cmd, arg))
    });
    const sep = () => el('span', { class: 'wy-sep' });
    const tools = [
      btn('<b>B</b>', 'Bold (Ctrl/⌘+B)', 'bold'),
      btn('<i>I</i>', 'Italic (Ctrl/⌘+I)', 'italic'),
      btn('<u>U</u>', 'Underline (Ctrl/⌘+U)', 'underline'),
      sep(),
      btn('x<sup>2</sup>', 'Superscript', 'superscript'),
      btn('x<sub>2</sub>', 'Subscript', 'subscript'),
      btn('<code>{}</code>', 'Code (monospace)', toggleCode)
    ];
    if (!opts.compact) tools.push(sep(),
      btn('•&#8202;≡', 'Bulleted list', 'insertUnorderedList'),
      btn('1.&#8202;≡', 'Numbered list', 'insertOrderedList'));
    tools.push(sep(), btn('√x', 'Insert math (LaTeX)', () => openPanel('math', null)));
    if (opts.blanks) tools.push(btn('[&#8202;_&#8202;]', 'Insert a blank', () => openPanel('blank', null)));
    if (imgStore()) tools.push(btn('<span class="wy-ico">▣</span>', 'Insert a picture (or paste or drop one here)', () => pickPicture(null)));
    if (imgStore() && !opts.compact) tools.push(btn('<span class="wy-ico">▦</span>', 'Insert a table', () => openTablePicker()));
    tools.push(btn('⌫<small>A</small>', 'Clear formatting', 'removeFormat'));
    const bar = el('div', { class: 'wy-bar', role: 'toolbar', 'aria-label': 'Formatting' }, tools);

    /* ---------- panel for math and blank names ---------- */
    const pLabel = el('span');
    const pIn = el('input', { type: 'text', 'aria-label': 'Value' });
    const pDisplay = el('input', { type: 'checkbox', 'aria-label': 'Display math on its own line' });
    const pDisplayWrap = el('label', { class: 'wy-mdisp' }, pDisplay, ' own line');
    const prev = el('span', { class: 'wy-mprev' });
    const okBtn = el('button', { type: 'button', class: 'small primary', onclick: () => commit() }, 'Insert');
    const delBtn = el('button', { type: 'button', class: 'small danger', onclick: () => { if (editing) { editing.remove(); editing = null; changed(); } closePanel(); } }, 'Remove');
    let editing = null, mode = 'math';
    const panel = el('div', { class: 'wy-mpanel', hidden: true },
      el('label', null, pLabel, pIn), pDisplayWrap, prev, okBtn,
      el('button', { type: 'button', class: 'small', onclick: () => closePanel() }, 'Cancel'), delBtn);
    const preview = () => {
      const v = pIn.value.trim();
      if (mode === 'math') prev.innerHTML = v ? mathHtml(v, pDisplay.checked) : '';
      else prev.textContent = v && !BLANK_NAME.test(v) ? 'Use letters, digits, - or _' : '';
    };
    pIn.oninput = preview;
    pDisplay.onchange = preview;
    pIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };
    function nextBlankName() {
      const used = new Set(Array.from(area.querySelectorAll('.wy-blank')).map(b => b.getAttribute('data-name')));
      for (let i = 0; i < 26; i++) { const n = String.fromCharCode(97 + i); if (!used.has(n)) return n; }
      return 'blank' + (used.size + 1);
    }
    function hidePanels() { panel.hidden = true; picPanel.hidden = true; tablePanel.hidden = true; area.querySelectorAll('.wy-pic.selected').forEach(i => i.classList.remove('selected')); }
    function openPanel(m, chip) {
      save();
      hidePanels();
      mode = m;
      editing = chip;
      pLabel.textContent = m === 'math' ? 'Math (LaTeX) ' : 'Blank name ';
      pIn.placeholder = m === 'math' ? 'e.g. \\frac{a}{b} or x^2' : 'e.g. a';
      pIn.classList.toggle('mono', m === 'math');
      pIn.value = chip ? chip.getAttribute(m === 'math' ? 'data-tex' : 'data-name') : (m === 'blank' ? nextBlankName() : '');
      pDisplay.checked = !!(chip && chip.getAttribute('data-display'));
      pDisplayWrap.hidden = m !== 'math' || !!opts.compact;
      preview();
      delBtn.hidden = !chip;
      okBtn.textContent = chip ? 'Update' : 'Insert';
      panel.hidden = false;
      pIn.focus();
      pIn.select();
    }
    function closePanel() { hidePanels(); editing = null; area.focus(); restore(); }
    function commit() {
      const v = pIn.value.trim();
      if (!v) { closePanel(); return; }
      if (mode === 'blank' && !BLANK_NAME.test(v)) { pIn.focus(); return; }
      const chip = mode === 'math' ? mathChip(v, pDisplay.checked && !opts.compact) : blankChip(v);
      panel.hidden = true;
      if (editing) { editing.replaceWith(chip); editing = null; changed(); return; }
      insertAtCaret(chip);
    }

    /* ---------- pictures ---------- */
    const fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml', hidden: true });
    let fileTarget = null;
    function pickPicture(replaceImg) {
      save();
      fileTarget = replaceImg;
      fileIn.value = '';
      fileIn.click();
    }
    fileIn.onchange = async () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (fileTarget) {
        const pic = await storePicture(imgStore(), f, notify);
        if (!pic) return;
        const img = fileTarget;
        img.src = imageUrl(imgStore(), pic.name);
        applyPicture(img, Object.assign(pictureData(img), { name: pic.name }));
        changed();
        openPicturePanel(img);
        return;
      }
      insertPictureFile(f);
    };
    async function insertPictureFile(file) {
      const pic = await storePicture(imgStore(), file, notify);
      if (!pic) return;
      // start no wider than the field; the settings can change it
      const cap = opts.compact ? 160 : 420;
      const img = pictureEl(imgStore(), { name: pic.name, alt: '', width: pic.width && pic.width > cap ? cap : null, align: 'inline' });
      insertAtCaret(img);
      openPicturePanel(img, true);
    }
    const pictureData = (img) => ({
      name: img.getAttribute('data-name'), alt: img.getAttribute('alt') || '',
      width: parseInt(img.getAttribute('width'), 10) || null, align: img.getAttribute('data-align') || 'inline'
    });

    const picPanel = el('div', { class: 'wy-mpanel wy-ppanel', hidden: true, role: 'group', 'aria-label': 'Picture settings' });
    function openPicturePanel(img, isNew) {
      save();
      hidePanels();
      img.classList.add('selected');
      const p = pictureData(img);
      const natural = () => img.naturalWidth || p.width || 400;
      const set = (patch) => { Object.assign(p, patch); applyPicture(img, p); changed(); sizeLabel(); };
      const alt = el('input', { type: 'text', placeholder: 'e.g. Bar chart of sales by region', 'aria-label': 'Description for screen readers' });
      alt.value = p.alt;
      alt.addEventListener('input', () => set({ alt: alt.value }));
      const range = el('input', { type: 'range', min: '5', max: '100', step: '1', 'aria-label': 'Size' });
      const label = el('span', { class: 'wy-size-label' });
      const pct = () => Math.round(((p.width || natural()) / natural()) * 100);
      function sizeLabel() {
        const wpx = p.width || natural();
        label.textContent = wpx + ' px (' + Math.min(100, pct()) + '%)';
        range.value = String(Math.min(100, pct()));
      }
      range.addEventListener('input', () => { const v = +range.value; set({ width: v >= 100 ? null : Math.max(16, Math.round(natural() * v / 100)) }); });
      const preset = (txt, px) => el('button', { type: 'button', class: 'small', onclick: () => set({ width: px && px < natural() ? px : null }) }, txt);
      const ALIGNS = ['inline', 'left', 'center', 'right'];
      const alignBtns = ALIGNS.map(a => el('button', {
        type: 'button', class: 'small' + (p.align === a ? ' on' : ''), 'aria-pressed': String(p.align === a),
        title: a === 'inline' ? 'Sits in the line of text' : 'On its own line, ' + a + ' aligned',
        onclick: () => { set({ align: a }); alignBtns.forEach((b, i) => { const on = ALIGNS[i] === a; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
      }, { inline: 'In line', left: 'Left', center: 'Center', right: 'Right' }[a]));
      const done = () => { hidePanels(); area.focus(); caretAfter(img); };
      picPanel.replaceChildren(
        el('div', { class: 'wy-ptitle' }, isNew ? 'Picture added' : 'Picture'),
        el('label', { class: 'wy-prow' }, el('span', null, 'Description'), alt),
        el('div', { class: 'wy-prow' }, el('span', null, 'Size'), el('div', { class: 'wy-size' }, range, label),
          el('div', { class: 'wy-presets' }, preset('Small', 200), preset('Medium', 360), preset('Large', 560), preset('Original', 0))),
        el('div', { class: 'wy-prow' }, el('span', null, 'Alignment'), el('div', { class: 'wy-seg', role: 'group', 'aria-label': 'Alignment' }, alignBtns)),
        el('div', { class: 'wy-pactions' },
          el('button', { type: 'button', class: 'small', onclick: () => pickPicture(img) }, 'Replace…'),
          el('button', { type: 'button', class: 'small danger', onclick: () => { hidePanels(); img.remove(); changed(); area.focus(); } }, 'Remove'),
          el('button', { type: 'button', class: 'small primary', onclick: done }, 'Done')));
      picPanel.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } if (e.key === 'Enter' && e.target === alt) { e.preventDefault(); done(); } };
      if (!img.complete) img.addEventListener('load', sizeLabel, { once: true });
      sizeLabel();
      picPanel.hidden = false;
      alt.focus();
    }

    /* ---------- tables ---------- */
    const tablePanel = el('div', { class: 'wy-mpanel wy-tpanel', hidden: true, role: 'group', 'aria-label': 'Insert a table' });
    function openTablePicker() {
      save();
      hidePanels();
      let rows = 3, cols = 3;
      const MAXR = 8, MAXC = 8;
      const grid = el('div', { class: 'wy-tgrid', style: 'grid-template-columns: repeat(' + MAXC + ', 1.35rem)' });
      const sizeTxt = el('span', { class: 'wy-size-label' });
      const rIn = el('input', { type: 'number', min: 1, max: 30, value: rows, 'aria-label': 'Rows' });
      const cIn = el('input', { type: 'number', min: 1, max: 12, value: cols, 'aria-label': 'Columns' });
      const head = el('input', { type: 'checkbox', checked: true });
      const alignSel = el('select', { 'aria-label': 'Table alignment' }, el('option', { value: 'left' }, 'Left'), el('option', { value: 'center' }, 'Center'), el('option', { value: 'right' }, 'Right'));
      const paint = () => {
        grid.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.r < rows && +b.dataset.c < cols));
        sizeTxt.textContent = rows + ' × ' + cols;
      };
      const insert = () => {
        const t = el('table');
        setTableAlign(t, alignSel.value);
        for (let r = 0; r < rows; r++) {
          const tr = el('tr');
          for (let c = 0; c < cols; c++) tr.append(el(r === 0 && head.checked ? 'th' : 'td', null, el('br')));
          t.append(tr);
        }
        tablePanel.hidden = true;
        insertAtCaret(t, true);
        const first = t.querySelector('th, td');
        const s = getSelection(); const rr = document.createRange(); rr.setStart(first, 0); rr.collapse(true); s.removeAllRanges(); s.addRange(rr);
        syncTable();
      };
      for (let r = 0; r < MAXR; r++) for (let c = 0; c < MAXC; c++) {
        grid.append(el('button', {
          type: 'button', 'data-r': String(r), 'data-c': String(c), 'aria-label': (r + 1) + ' by ' + (c + 1),
          onmouseenter: () => { rows = r + 1; cols = c + 1; rIn.value = rows; cIn.value = cols; paint(); },
          onfocus: () => { rows = r + 1; cols = c + 1; rIn.value = rows; cIn.value = cols; paint(); },
          onclick: () => { rows = r + 1; cols = c + 1; insert(); }
        }));
      }
      rIn.oninput = () => { rows = Math.max(1, Math.min(30, +rIn.value || 1)); paint(); };
      cIn.oninput = () => { cols = Math.max(1, Math.min(12, +cIn.value || 1)); paint(); };
      tablePanel.replaceChildren(
        el('div', { class: 'wy-ptitle' }, 'Insert a table ', el('small', null, 'point at the grid, or type the size')),
        el('div', { class: 'wy-tpick' }, grid,
          el('div', { class: 'wy-tside' }, sizeTxt,
            el('label', null, 'Rows ', rIn), el('label', null, 'Columns ', cIn),
            el('label', { class: 'wy-check' }, head, ' First row is headings'),
            el('label', null, 'Align ', alignSel),
            el('div', { class: 'wy-pactions' },
              el('button', { type: 'button', class: 'small', onclick: () => closePanel() }, 'Cancel'),
              el('button', { type: 'button', class: 'small primary', onclick: insert }, 'Insert table')))));
      tablePanel.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); } };
      paint();
      tablePanel.hidden = false;
      rIn.focus();
    }

    /* row and column tools, shown while the caret is in a table */
    let curCell = null;
    const cellAtCaret = () => {
      const s = getSelection();
      if (!s.rangeCount) return null;
      const n = s.getRangeAt(0).startContainer;
      const e = n.nodeType === 1 ? n : n.parentNode;
      const c = e && e.closest && e.closest('td, th');
      return c && area.contains(c) ? c : null;
    };
    function tableOp(op) {
      const cell = curCell;
      if (!cell || !cell.isConnected) return;
      const tr = cell.parentNode;
      const table = cell.closest('table');
      const rows = Array.from(table.querySelectorAll('tr'));
      const ci = Array.from(tr.children).indexOf(cell);
      const ri = rows.indexOf(tr);
      const hasHead = !!rows[0].querySelector('th');
      const newCell = (tag) => el(tag, null, el('br'));
      let focus = cell;
      if (op === 'rowAbove' || op === 'rowBelow') {
        const nr = el('tr');
        Array.from(tr.children).forEach(() => nr.append(newCell('td')));
        if (op === 'rowAbove' && !(hasHead && ri === 0)) tr.before(nr); else tr.after(nr);
        focus = nr.children[ci] || nr.firstChild;
      } else if (op === 'colLeft' || op === 'colRight') {
        rows.forEach((r, k) => {
          const ref = r.children[Math.min(ci, r.children.length - 1)];
          const nc = newCell(hasHead && k === 0 ? 'th' : 'td');
          if (op === 'colLeft') ref.before(nc); else ref.after(nc);
          if (r === tr) focus = nc;
        });
      } else if (op === 'delRow') {
        if (rows.length <= 1) { removeTable(table); return; }
        focus = (rows[ri + 1] || rows[ri - 1]).children[ci] || null;
        tr.remove();
        if (hasHead && ri === 0 && rows[1]) Array.from(rows[1].children).forEach(c => swapTag(c, 'th'));
      } else if (op === 'delCol') {
        if (tr.children.length <= 1) { removeTable(table); return; }
        rows.forEach(r => { if (r.children[ci]) r.children[ci].remove(); });
        focus = tr.children[Math.min(ci, tr.children.length - 1)];
      } else if (op === 'head') {
        Array.from(rows[0].children).forEach(c => swapTag(c, hasHead ? 'td' : 'th'));
        focus = rows[0].children[ci] && ri === 0 ? rows[0].children[ci] : cell;
      } else if (op === 'deleteTable') {
        removeTable(table); return;
      } else if (/^align-/.test(op)) {
        setTableAlign(table, op.slice(6));
      }
      if (focus && focus.isConnected) {
        const s = getSelection(); const r = document.createRange(); r.selectNodeContents(focus); r.collapse(true); s.removeAllRanges(); s.addRange(r);
      }
      changed();
      syncTable();
    }
    function swapTag(c, tag) {
      if (c.localName === tag) return;
      const n = el(tag);
      while (c.firstChild) n.append(c.firstChild);
      if (c.getAttribute('colspan')) n.setAttribute('colspan', c.getAttribute('colspan'));
      c.replaceWith(n);
    }
    function removeTable(table) {
      const after = el('div', null, el('br'));
      table.replaceWith(after);
      const s = getSelection(); const r = document.createRange(); r.setStart(after, 0); r.collapse(true); s.removeAllRanges(); s.addRange(r);
      changed();
      syncTable();
    }
    const tbtn = (label, title, op) => el('button', { type: 'button', class: 'wy-btn wy-tb', title, 'aria-label': title, html: label, onmousedown: (e) => e.preventDefault(), onclick: () => tableOp(op) });
    const tbar = el('div', { class: 'wy-tbar', hidden: true, role: 'toolbar', 'aria-label': 'Table' },
      el('span', { class: 'wy-tlabel' }, 'Table'),
      tbtn('+ Row above', 'Add a row above', 'rowAbove'), tbtn('+ Row below', 'Add a row below', 'rowBelow'), tbtn('− Row', 'Delete this row', 'delRow'),
      el('span', { class: 'wy-sep' }),
      tbtn('+ Col left', 'Add a column to the left', 'colLeft'), tbtn('+ Col right', 'Add a column to the right', 'colRight'), tbtn('− Col', 'Delete this column', 'delCol'),
      el('span', { class: 'wy-sep' }),
      tbtn('Heading row', 'Make the first row headings (or plain cells)', 'head'),
      tbtn('⇤', 'Align the table left', 'align-left'), tbtn('⇔', 'Center the table', 'align-center'), tbtn('⇥', 'Align the table right', 'align-right'),
      el('span', { class: 'wy-sep' }),
      tbtn('Delete table', 'Delete the whole table', 'deleteTable'));
    function syncTable() {
      const c = document.activeElement === area ? cellAtCaret() : null;
      if (c) curCell = c;
      else if (document.activeElement === area) curCell = null;
      tbar.hidden = !curCell || !curCell.isConnected;
      area.querySelectorAll('table.wy-cur').forEach(t => t.classList.remove('wy-cur'));
      if (curCell && curCell.isConnected) curCell.closest('table').classList.add('wy-cur');
    }

    /* clicks on chips and pictures */
    area.addEventListener('click', (e) => {
      const m = e.target.closest('.wy-math');
      if (m) { openPanel('math', m); return; }
      const b = e.target.closest('.wy-blank');
      if (b) { openPanel('blank', b); return; }
      const img = e.target.closest('img.wy-pic');
      if (img && imgStore()) openPicturePanel(img);
    });

    /* keep pasted content to the formatting we support; pictures become project pictures */
    area.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
      const html = cd.getData('text/html');
      const text = cd.getData('text/plain');
      if (files.length && imgStore() && !text.trim()) {
        e.preventDefault();
        save();
        files.reduce((p, f) => p.then(() => insertPictureFile(f)), Promise.resolve());
        return;
      }
      e.preventDefault();
      if (html) {
        const box = document.createElement('div');
        box.innerHTML = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|meta|title)\b[\s\S]*?<\/\1>/gi, '');
        box.querySelectorAll('img').forEach(i => i.remove());
        let mk = serialize(box);
        if (opts.compact) mk = mk.replace(/<\/?(ul|ol|li)>/g, ' ').replace(/\n+/g, ' ');
        document.execCommand('insertHTML', false, toEditable(mk, { images: imgStore(), blanks: opts.blanks }));
      } else {
        document.execCommand('insertText', false, opts.compact ? text.replace(/\s*\n\s*/g, ' ') : text);
      }
      changed();
    });
    area.addEventListener('dragover', (e) => {
      if (!imgStore() || !e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      area.classList.add('wy-drop');
    });
    area.addEventListener('dragleave', () => area.classList.remove('wy-drop'));
    area.addEventListener('drop', (e) => {
      area.classList.remove('wy-drop');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /^image\//.test(f.type));
      if (!imgStore() || !files.length) return;
      e.preventDefault();
      e.stopPropagation();
      // put the picture where it was dropped
      let r = null;
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(e.clientX, e.clientY);
      else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
      if (r && inArea(r.startContainer)) saved = r;
      files.reduce((p, f) => p.then(() => insertPictureFile(f)), Promise.resolve());
    });
    area.addEventListener('keydown', (e) => {
      if (opts.compact && e.key === 'Enter') e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); toggleCode(); }
      // Tab moves between table cells
      if (e.key === 'Tab' && curCell && curCell.isConnected && !e.altKey) {
        const cells = Array.from(curCell.closest('table').querySelectorAll('th, td'));
        const i = cells.indexOf(curCell) + (e.shiftKey ? -1 : 1);
        if (i >= 0 && i < cells.length) {
          e.preventDefault();
          const s = getSelection(); const r = document.createRange(); r.selectNodeContents(cells[i]); s.removeAllRanges(); s.addRange(r);
          syncTable();
        }
      }
    });
    area.addEventListener('input', changed);
    area.addEventListener('keyup', () => { save(); syncTable(); });
    area.addEventListener('mouseup', () => { save(); syncTable(); });
    area.addEventListener('focus', syncTable);
    area.addEventListener('blur', save);

    function syncButtons() {
      bar.querySelectorAll('[data-cmd]').forEach(b => {
        const c = b.getAttribute('data-cmd');
        if (!/^(bold|italic|underline|superscript|subscript|insertUnorderedList|insertOrderedList)$/.test(c)) return;
        let on = false;
        try { on = document.activeElement === area && document.queryCommandState(c); } catch (e) { /* ignore */ }
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    document.addEventListener('selectionchange', () => { if (document.activeElement === area) { syncButtons(); syncTable(); } });

    const wrap = el('div', { class: 'wy' + (opts.mini ? ' wy-mini' : '') }, bar, tbar, panel, picPanel, tablePanel, area, fileIn);
    const api = {
      el: wrap,
      area,
      focus: () => area.focus(),
      get value() { return serialize(area); },
      set value(v) {
        area.innerHTML = toEditable(v || '', { images: imgStore(), blanks: opts.blanks });
        last = serialize(area);
        area.classList.toggle('wy-empty', isEmpty());
      }
    };
    api.value = opts.value || '';
    try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (e) { /* ignore */ }
    return api;
  }

  PT.wysiwyg = wysiwyg;
  PT.wysiwygSerialize = serialize;
  PT.wysiwygToEditable = toEditable;
})();
