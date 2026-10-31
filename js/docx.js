/*
 * Word (.docx) export, built in the browser from the same blocks as the print view.
 * Math (MathML) becomes native Word equations (OMML); pictures are embedded.
 */
(function () {
  'use strict';
  const PT = (globalThis.PT = globalThis.PT || {});

  const x = (s) => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const PAGE = {
    letter: { w: 12240, h: 15840 },
    a4: { w: 11906, h: 16838 }
  };
  const MARGIN = 1080; // 0.75 in
  const CIRCLED = (ch) => {
    const c = ch.toUpperCase().charCodeAt(0);
    return c >= 65 && c <= 90 ? String.fromCharCode(0x24B6 + c - 65) : ch;
  };

  /* ---------- runs ---------- */
  function rPr(st) {
    let p = '';
    if (st.font) p += '<w:rFonts w:ascii="' + st.font + '" w:hAnsi="' + st.font + '" w:cs="' + st.font + '"/>';
    if (st.b) p += '<w:b/>';
    if (st.i) p += '<w:i/>';
    if (st.caps) p += '<w:smallCaps/>';
    if (st.strike) p += '<w:strike/>';
    if (st.color) p += '<w:color w:val="' + st.color + '"/>';
    if (st.sz) p += '<w:sz w:val="' + st.sz + '"/><w:szCs w:val="' + st.sz + '"/>';
    if (st.u) p += '<w:u w:val="single"/>';
    if (st.box) p += '<w:bdr w:val="single" w:sz="8" w:space="0" w:color="000000"/>';
    if (st.shade) p += '<w:shd w:val="clear" w:color="auto" w:fill="' + st.shade + '"/>';
    if (st.sup) p += '<w:vertAlign w:val="superscript"/>';
    if (st.sub) p += '<w:vertAlign w:val="subscript"/>';
    return p ? '<w:rPr>' + p + '</w:rPr>' : '';
  }
  const run = (t, st) => '<w:r>' + rPr(st || {}) + '<w:t xml:space="preserve">' + x(t) + '</w:t></w:r>';
  const tabRun = (st) => '<w:r>' + rPr(st || {}) + '<w:tab/></w:r>';

  function pPr(o) {
    o = o || {};
    let p = '';
    if (o.style) p += '<w:pStyle w:val="' + o.style + '"/>';
    if (o.keepNext) p += '<w:keepNext/>';
    if (o.keepLines !== false) p += '<w:keepLines/>';
    if (o.pageBreakBefore) p += '<w:pageBreakBefore/>';
    if (o.border) p += '<w:pBdr>' + o.border + '</w:pBdr>';
    if (o.shade) p += '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>';
    if (o.tabs) p += '<w:tabs>' + o.tabs.map(t => '<w:tab w:val="' + (t.val || 'left') + '"' + (t.leader ? ' w:leader="' + t.leader + '"' : '') + ' w:pos="' + t.pos + '"/>').join('') + '</w:tabs>';
    p += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '"' + (o.line ? ' w:line="' + o.line + '" w:lineRule="' + (o.lineRule || 'auto') + '"' : '') + '/>';
    if (o.left || o.hanging || o.right) p += '<w:ind w:left="' + (o.left || 0) + '"' + (o.right ? ' w:right="' + o.right + '"' : '') + (o.hanging ? ' w:hanging="' + o.hanging + '"' : '') + '/>';
    if (o.align) p += '<w:jc w:val="' + o.align + '"/>';
    return '<w:pPr>' + p + '</w:pPr>';
  }
  const para = (content, o) => '<w:p>' + pPr(o) + content + '</w:p>';

  /* ---------- MathML → OMML ---------- */
  const isEl = (n) => n && n.nodeType === 1;
  const lname = (n) => (n.localName || n.nodeName || '').toLowerCase().replace(/^.*:/, '');
  const elKids = (n) => Array.from(n.childNodes).filter(isEl);
  function mRun(t, plain) {
    return '<m:r>' + (plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '') + '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">' + x(t) + '</m:t></m:r>';
  }
  function mArg(n) { return n ? omml(n) : ''; }
  function omml(n) {
    if (!isEl(n)) return n && n.nodeType === 3 && n.nodeValue.trim() ? mRun(n.nodeValue.trim()) : '';
    const k = elKids(n);
    switch (lname(n)) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'menclose': case 'mfenced_inner':
        return k.map(omml).join('');
      case 'semantics': return k.length ? omml(k[0]) : '';
      case 'annotation': case 'annotation-xml': case 'mspace': case 'mphantom': return '';
      case 'mi': {
        const t = n.textContent.trim();
        return mRun(t, t.length > 1 || n.getAttribute('mathvariant') === 'normal');
      }
      case 'mn': case 'mo': return mRun(n.textContent.trim(), true);
      case 'mtext': case 'ms': return mRun(n.textContent, true);
      case 'msup': return '<m:sSup><m:e>' + mArg(k[0]) + '</m:e><m:sup>' + mArg(k[1]) + '</m:sup></m:sSup>';
      case 'msub': return '<m:sSub><m:e>' + mArg(k[0]) + '</m:e><m:sub>' + mArg(k[1]) + '</m:sub></m:sSub>';
      case 'msubsup': {
        if (k[0] && /^[∑∏∫∮⋃⋂]$/.test(k[0].textContent.trim())) return nary(k[0], k[1], k[2]);
        return '<m:sSubSup><m:e>' + mArg(k[0]) + '</m:e><m:sub>' + mArg(k[1]) + '</m:sub><m:sup>' + mArg(k[2]) + '</m:sup></m:sSubSup>';
      }
      case 'mfrac': return '<m:f><m:num>' + mArg(k[0]) + '</m:num><m:den>' + mArg(k[1]) + '</m:den></m:f>';
      case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + k.map(omml).join('') + '</m:e></m:rad>';
      case 'mroot': return '<m:rad><m:deg>' + mArg(k[1]) + '</m:deg><m:e>' + mArg(k[0]) + '</m:e></m:rad>';
      case 'mover': {
        const top = k[1] ? k[1].textContent.trim() : '';
        if (n.getAttribute('accent') === 'true' || /^[̀-ͯ¯^~˙¨→‾ˉ]$/.test(top)) {
          return '<m:acc><m:accPr><m:chr m:val="' + x(top === '¯' || top === '‾' || top === 'ˉ' ? '̅' : top) + '"/></m:accPr><m:e>' + mArg(k[0]) + '</m:e></m:acc>';
        }
        return '<m:limUpp><m:e>' + mArg(k[0]) + '</m:e><m:lim>' + mArg(k[1]) + '</m:lim></m:limUpp>';
      }
      case 'munder': return '<m:limLow><m:e>' + mArg(k[0]) + '</m:e><m:lim>' + mArg(k[1]) + '</m:lim></m:limLow>';
      case 'munderover': {
        if (k[0] && /^[∑∏∫∮⋃⋂]$/.test(k[0].textContent.trim())) return nary(k[0], k[1], k[2]);
        return '<m:limUpp><m:e><m:limLow><m:e>' + mArg(k[0]) + '</m:e><m:lim>' + mArg(k[1]) + '</m:lim></m:limLow></m:e><m:lim>' + mArg(k[2]) + '</m:lim></m:limUpp>';
      }
      case 'mtable': return '<m:m>' + k.map(tr => '<m:mr>' + elKids(tr).map(td => '<m:e>' + omml(td) + '</m:e>').join('') + '</m:mr>').join('') + '</m:m>';
      case 'mtr': case 'mtd': return k.map(omml).join('');
      case 'mfenced': {
        const open = n.getAttribute('open') == null ? '(' : n.getAttribute('open');
        const close = n.getAttribute('close') == null ? ')' : n.getAttribute('close');
        return '<m:d><m:dPr><m:begChr m:val="' + x(open) + '"/><m:endChr m:val="' + x(close) + '"/></m:dPr>' + k.map(c => '<m:e>' + omml(c) + '</m:e>').join('') + '</m:d>';
      }
    }
    return k.length ? k.map(omml).join('') : (n.textContent.trim() ? mRun(n.textContent.trim()) : '');
  }
  function nary(op, sub, sup) {
    return '<m:nary><m:naryPr><m:chr m:val="' + x(op.textContent.trim()) + '"/></m:naryPr><m:sub>' + mArg(sub) + '</m:sub><m:sup>' + mArg(sup) + '</m:sup><m:e></m:e></m:nary>';
  }

  /* ---------- pictures ---------- */
  function imageSize(bytes, type) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    try {
      if (type === 'image/png') return { w: dv.getUint32(16), h: dv.getUint32(20) };
      if (type === 'image/gif') return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
      if (type === 'image/jpeg') {
        let p = 2;
        while (p < bytes.length) {
          if (bytes[p] !== 0xFF) { p++; continue; }
          const m = bytes[p + 1];
          const len = dv.getUint16(p + 2);
          if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: dv.getUint16(p + 7), h: dv.getUint16(p + 5) };
          p += 2 + len;
        }
      }
    } catch (e) { /* fall through */ }
    return { w: 400, h: 300 };
  }

  /* ---------- the writer ---------- */
  function Writer(ctx) {
    this.ctx = ctx;
    this.media = [];        // { name, bytes, rid, type }
    this.mediaByName = new Map();
    this.textWidth = (PAGE[ctx.paper] || PAGE.letter).w - 2 * MARGIN;
    this.docPr = 1;
  }

  Writer.prototype.picture = function (src, alt, widthAttr) {
    const name = String(src || '').replace(/^pt-img:/, '');
    const im = this.ctx.images && this.ctx.images[name];
    if (!im) return run(alt ? '[Picture: ' + alt + ']' : '[Picture]');
    let m = this.mediaByName.get(name);
    if (!m) {
      const type = im.pngData ? 'image/png' : im.type;
      const data = im.pngData || im.data;
      const bytes = PT.zip.b64ToBytes(data);
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' }[type];
      if (!ext) return run(alt ? '[Picture: ' + alt + ']' : '[Picture]');
      const size = im.w && im.h ? { w: im.w, h: im.h } : imageSize(bytes, type);
      m = { name: 'image' + (this.media.length + 1) + '.' + ext, bytes, rid: 'rIdImg' + (this.media.length + 1), type, size };
      this.media.push(m);
      this.mediaByName.set(name, m);
    }
    let w = parseInt(widthAttr, 10) || m.size.w;
    let h = Math.round(m.size.h * (w / m.size.w));
    const maxW = this.textWidth / 1440 * 96 - 40;
    if (w > maxW) { h = Math.round(h * maxW / w); w = Math.round(maxW); }
    const cx = w * 9525, cy = h * 9525;
    const id = this.docPr++;
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + x(alt || '') + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + m.name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + m.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  };

  /**
   * Rich HTML → paragraphs (and tables).
   * o: { p: paragraph options, prefix: runs for the first paragraph, suffix: runs for the last, st: base run style }
   */
  Writer.prototype.rich = function (html, o) {
    o = o || {};
    const doc = new DOMParser().parseFromString('<!doctype html><html><body><div id="r">' + (html || '') + '</div></body></html>', 'text/html');
    const root = doc.getElementById ? doc.getElementById('r') : doc.querySelector('#r');
    const out = [];
    let cur = [];
    let first = true;
    const self = this;
    const flush = (force, extraP) => {
      if (!cur.length && !force) return;
      if (first && o.prefix) cur.unshift(o.prefix);
      out.push({ runs: cur, p: Object.assign({}, o.p, extraP || {}) });
      first = false;
      cur = [];
    };
    function walk(n, st, listInfo) {
      if (n.nodeType === 3) {
        let t = n.nodeValue;
        if (!st.pre) t = t.replace(/\s+/g, ' ');
        if (t) cur.push(run(t, st));
        return;
      }
      if (!isEl(n)) return;
      const tagName = lname(n);
      const s = Object.assign({}, st);
      switch (tagName) {
        case 'b': case 'strong': s.b = true; break;
        case 'i': case 'em': s.i = true; break;
        case 'u': s.u = true; break;
        case 's': case 'strike': case 'del': s.strike = true; break;
        case 'sup': s.sup = true; break;
        case 'sub': s.sub = true; break;
        case 'code': s.font = 'Consolas'; break;
        case 'br': cur.push('<w:r><w:br/></w:r>'); return;
        case 'img': {
          const pic = self.picture(n.getAttribute('src'), n.getAttribute('alt'), n.getAttribute('width'));
          const st = (n.getAttribute('style') || '').replace(/\s+/g, '');
          if (/display:block/.test(st)) {
            // aligned picture: a paragraph of its own
            const align = /margin:6px06pxauto/.test(st) ? 'right' : /margin:6pxauto6px0/.test(st) ? 'left' : 'center';
            flush();
            out.push({ runs: [pic], p: Object.assign({}, o.p, { align, hanging: 0, before: 60, after: 60 }) });
            return;
          }
          cur.push(pic);
          return;
        }
        case 'math':
          if (n.getAttribute('display') === 'block') {
            flush();
            out.push({ runs: ['<m:oMathPara><m:oMath>' + omml(n) + '</m:oMath></m:oMathPara>'], p: Object.assign({}, o.p, { hanging: 0, before: 60 }) });
            return;
          }
          cur.push('<m:oMath>' + omml(n) + '</m:oMath>'); return;
        case 'table': flush(); out.push({ xml: self.htmlTable(n, st) }); return;
        case 'hr': flush(); out.push({ runs: [], p: Object.assign({}, o.p, { border: '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/>' }) }); return;
        case 'ul': case 'ol': {
          flush();
          let k = 0;
          Array.from(n.childNodes).forEach(c => {
            if (isEl(c) && lname(c) === 'li') {
              k++;
              cur.push(run(tagName === 'ol' ? k + '. ' : '• ', st));
              Array.from(c.childNodes).forEach(cc => walk(cc, s));
              flush(false, { left: ((o.p && o.p.left) || 0) + 360, hanging: 240 });
            }
          });
          return;
        }
        case 'p': case 'div': case 'blockquote': case 'pre': case 'li':
          flush();
          if (tagName === 'pre') { s.pre = true; s.font = 'Consolas'; }
          Array.from(n.childNodes).forEach(c => walk(c, s));
          flush();
          return;
        case 'script': case 'style': return;
      }
      Array.from(n.childNodes).forEach(c => walk(c, s, listInfo));
    }
    Array.from(root.childNodes).forEach(c => walk(c, o.st || {}));
    if (cur.length || !out.length) flush(true);
    // the suffix goes on the last paragraph (add one if the content ended with a table)
    const lastPara = [...out].reverse().find(b => b.runs);
    if (o.suffix) {
      if (out.length && out[out.length - 1].runs) out[out.length - 1].runs.push(o.suffix);
      else out.push({ runs: [o.suffix], p: o.p });
    }
    void lastPara;
    return out.map(b => (b.xml ? { xml: b.xml } : { xml: null, runs: b.runs, p: b.p }));
  };

  Writer.prototype.htmlTable = function (tbl, st) {
    const rows = Array.from(tbl.getElementsByTagName('tr'));
    const ncols = Math.max(1, ...rows.map(r => Array.from(r.childNodes).filter(c => isEl(c) && /^t[dh]$/.test(lname(c))).reduce((a, c) => a + (parseInt(c.getAttribute('colspan'), 10) || 1), 0)));
    const w = Math.floor(Math.min(this.textWidth - 720, ncols * 2200) / ncols);
    const self = this;
    const tst = (tbl.getAttribute('style') || '').replace(/\s+/g, '');
    const jc = /margin-left:auto;margin-right:auto/.test(tst) ? 'center' : /margin-left:auto;margin-right:0/.test(tst) ? 'right' : '';
    return '<w:tbl><w:tblPr>' + (jc ? '<w:jc w:val="' + jc + '"/>' : '') + '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>').join('') +
      '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      Array.from({ length: ncols }, () => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' +
      rows.map(r => '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + Array.from(r.childNodes).filter(c => isEl(c) && /^t[dh]$/.test(lname(c))).map(c => {
        const span = parseInt(c.getAttribute('colspan'), 10) || 1;
        const inner = self.blocksXml(self.rich(c.innerHTML, { st: Object.assign({}, st, lname(c) === 'th' ? { b: true } : {}), p: { after: 0, keepNext: true } }));
        return '<w:tc><w:tcPr><w:tcW w:w="' + w * span + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + (lname(c) === 'th' ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : '') + '</w:tcPr>' + inner + '</w:tc>';
      }).join('') + '</w:tr>').join('') + '</w:tbl>';
  };

  Writer.prototype.blocksXml = function (blocks, keepAll) {
    return blocks.map((b, i) => {
      if (b.xml) return b.xml;
      const keep = keepAll || (b.p && b.p.keepNext);
      return para(b.runs.join(''), Object.assign({}, b.p, { keepNext: keep && (keepAll ? true : i < blocks.length - 1 || b.p.keepNext) }));
    }).join('');
  };

  /* ---------- simple layout tables ---------- */
  const NOBORDER = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="nil"/>').join('') + '</w:tblBorders>';
  function layoutTable(widths, rows, opts) {
    opts = opts || {};
    return '<w:tbl><w:tblPr><w:tblW w:w="' + widths.reduce((a, b) => a + b, 0) + '" w:type="dxa"/>' + (opts.center ? '<w:jc w:val="center"/>' : '') + (opts.indent ? '<w:tblInd w:w="' + opts.indent + '" w:type="dxa"/>' : '') +
      (opts.borders || NOBORDER) + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      widths.map(w => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>' +
      rows.map((r, ri) => '<w:tr><w:trPr><w:cantSplit/>' + (opts.rowGap ? '<w:trHeight w:val="' + (opts.rowGap + 560) + '" w:hRule="atLeast"/>' : '') + (opts.headerRow && ri === 0 ? '<w:tblHeader/>' : '') + '</w:trPr>' + r.map((c, ci) => {
        const cell = typeof c === 'string' ? { xml: c } : c;
        return '<w:tc><w:tcPr><w:tcW w:w="' + widths[ci] + '" w:type="dxa"/>' + (cell.tcPr || '') + '</w:tcPr>' + (cell.xml || para('', { after: 0 })) + '</w:tc>';
      }).join('') + '</w:tr>').join('') + '</w:tbl>';
  }

  /* ---------- blocks → body XML ---------- */
  Writer.prototype.body = function (d) {
    const W = this.textWidth;
    const s = d.settings || {};
    const base = s.largePrint ? 28 : 22;
    const small = base - 3;
    const out = [];
    const self = this;
    const lines = (n, left, keep) => Array.from({ length: Math.max(1, n | 0) }, (_, i) =>
      para('', { left: left || 0, keepNext: keep !== false && i < n - 1, line: base > 22 ? 480 : 400, lineRule: 'exact', after: 0, border: '<w:bottom w:val="single" w:sz="4" w:space="1" w:color="777777"/><w:between w:val="single" w:sz="4" w:space="1" w:color="777777"/>' })).join('');
    const blank = (len) => run('_'.repeat(len), { color: '444444' });

    d.blocks.forEach(b => {
      switch (b.k) {
        case 'header': {
          const k = base / 22;
          const hs = (pt) => Math.round(pt * 2 * k); // points → half-points, scaled for large print
          const cover = b.variant === 'cover';
          const boxBorder = (sz) => '<w:tcBorders>' + ['top', 'left', 'bottom', 'right'].map(x2 => '<w:' + x2 + ' w:val="single" w:sz="' + sz + '" w:space="0" w:color="000000"/>').join('') + '</w:tcBorders><w:vAlign w:val="center"/>';
          const codeXml = para(run('FORM', { sz: hs(8.5), b: true, color: '333333' }), { align: 'center', after: 0 }) +
            para(run(b.code, { b: true, sz: hs(cover ? 40 : 28) }), { align: 'center', after: 40 });
          const infoTable = (width, valuePt) => {
            const n = b.info.length;
            const cw = Math.floor(width / n);
            const cell = (x3) => ({ xml: para(run(x3.label, { sz: hs(9), color: '444444' }), { after: 0, align: cover ? 'center' : 'left' }) + para(run(x3.value, { b: true, sz: hs(valuePt) }), { after: 40, align: cover ? 'center' : 'left' }) });
            const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideV'].map(x4 => '<w:' + x4 + ' w:val="single" w:sz="8" w:space="0" w:color="000000"/>').join('') + '</w:tblBorders>';
            return layoutTable(Array(n).fill(cw), [b.info.map(cell)], { borders, center: cover });
          };
          if (cover) {
            if (b.course) out.push(para(run(b.course.toUpperCase(), { b: true, sz: hs(13), color: '333333' }), { align: 'center', after: 60 }));
            out.push(para(run(b.title, { b: true, sz: hs(29) }), { align: 'center', after: 60, line: 240, lineRule: 'auto' }));
            if (b.doc) out.push(para(run(b.doc, { sz: hs(14.5), color: '333333' }), { align: 'center', after: 240 }));
            out.push(layoutTable([2200], [[{ xml: codeXml, tcPr: boxBorder(24) }]], { center: true }));
            out.push(para('', { after: 160 }));
            out.push(infoTable(Math.min(W, 7800), 15.5));
          } else {
            const left = (b.course ? para(run(b.course, { b: true, sz: hs(11), color: '333333' }), { after: 0 }) : '') +
              para(run(b.title, { b: true, sz: hs(22) }), { after: 20 }) +
              (b.doc ? para(run(b.doc, { b: true, sz: hs(13) }), { after: 0 }) : '');
            out.push(layoutTable([W - 1700, 1700], [[{ xml: left, tcPr: '<w:vAlign w:val="bottom"/>' }, { xml: codeXml, tcPr: boxBorder(20) }]]));
            out.push(para('', { after: 0, line: 100, lineRule: 'exact', border: '<w:bottom w:val="single" w:sz="16" w:space="0" w:color="000000"/>' }));
            out.push(infoTable(W, 13.5));
          }
          break;
        }
        case 'fields': {
          const k = base / 22;
          const sz = Math.round((b.stacked ? 13 : 11.5) * 2 * k);
          const line = '<w:tcBorders><w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/></w:tcBorders><w:vAlign w:val="bottom"/>';
          if (b.stacked) {
            const lw = 1900;
            const fieldsTable = (fw, center) => layoutTable([lw, fw - lw], b.labels.map(l => [
              { xml: para(run(l, { b: true, sz }), { after: 0 }), tcPr: '<w:vAlign w:val="bottom"/>' },
              { xml: para('', { after: 0, line: 560, lineRule: 'exact' }), tcPr: line }
            ]), { center, rowGap: 40 });
            out.push(para('', { after: 0, line: 360, lineRule: 'exact' }));
            if (b.grade) {
              const gw = 3900, gap = 500, fw = W - gw - gap;
              const gsz = Math.round(11.5 * 2 * base / 22);
              const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x6 => '<w:' + x6 + ' w:val="single" w:sz="8" w:space="0" w:color="000000"/>').join('') + '</w:tblBorders>';
              const c = (t, o) => ({ xml: para(run(t, { sz: gsz, b: !!(o && o.b) }), { after: 0, before: 40, align: (o && o.align) || 'left' }), tcPr: (o && o.shade) ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : '' });
              const rows = [[c('Part', { b: true, shade: true }), c('Points', { b: true, shade: true, align: 'center' }), c('Score', { b: true, shade: true })]]
                .concat(b.grade.rows.map(r => [c(r.label), c(String(r.pts), { align: 'center' }), c('')]))
                .concat([[c('Total', { b: true }), c(String(b.grade.total), { b: true, align: 'center' }), c('')]]);
              const gradeXml = para(run('For grading', { b: true, sz: gsz }), { after: 60, keepNext: true }) + layoutTable([1500, 1100, 1300], rows, { borders }) + para('', { after: 0 });
              out.push(layoutTable([fw, gap, gw], [[{ xml: fieldsTable(fw - 100, false) + para('', { after: 0 }) }, { xml: para('', { after: 0 }) }, { xml: gradeXml }]]));
            } else {
              out.push(fieldsTable(Math.min(W, 8000), true));
            }
            out.push(para('', { after: 200 }));
            break;
          }
          const n = b.labels.length;
          const each = Math.floor(W / n);
          const cells = [];
          const widths = [];
          b.labels.forEach((l, i) => {
            const lw = Math.min(1900, 420 + l.length * 165);
            const gap = i < n - 1 ? 300 : 0;
            widths.push(lw, each - lw - gap);
            cells.push({ xml: para(run(l, { b: true, sz }), { after: 0 }), tcPr: '<w:vAlign w:val="bottom"/>' });
            cells.push({ xml: para('', { after: 0, line: 500, lineRule: 'exact' }), tcPr: line });
            if (gap) { widths.push(gap); cells.push({ xml: para('', { after: 0 }) }); }
          });
          out.push(para('', { after: 0, line: 240, lineRule: 'exact' }));
          out.push(layoutTable(widths, [cells]));
          out.push(para('', { after: 160 }));
          break;
        }
        case 'instructions': {
          const k = base / 22;
          const sz = Math.round((b.cover ? 13 : 11.5) * 2 * k);
          const pp = { after: 60, line: b.cover ? 324 : 300, lineRule: 'auto', keepNext: true };
          const inner = para(run('Instructions', { b: true, sz }), Object.assign({}, pp, { after: 40 })) + self.blocksXml(self.rich(b.html, { p: pp, st: { sz } }));
          const tcPr = '<w:tcBorders><w:left w:val="single" w:sz="24" w:space="0" w:color="555555"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="220" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="220" w:type="dxa"/></w:tcMar>';
          out.push(layoutTable([W], [[{ xml: inner, tcPr }]]));
          out.push(para('', { after: b.cover ? 160 : 120 }));
          break;
        }
        case 'note': {
          const k = base / 22;
          const sz = Math.round((b.cover ? 12 : 11) * 2 * k);
          out.push(para(run(b.text, { sz }), { after: 200, left: 80, right: 80, border: ['top', 'left', 'bottom', 'right'].map(x5 => '<w:' + x5 + ' w:val="single" w:sz="6" w:space="4" w:color="999999"/>').join('') }));
          break;
        }
        case 'callout': {
          const sz = Math.round(14 * 2 * base / 22);
          out.push(para(run(b.text, { b: true, sz }), { align: 'center', before: 360, after: 0, border: '<w:top w:val="single" w:sz="12" w:space="6" w:color="000000"/><w:bottom w:val="single" w:sz="12" w:space="6" w:color="000000"/>' }));
          break;
        }
        case 'pagebreak': out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); break;
        case 'section':
          out.push(para(run(b.text, { b: true, sz: base + 4 }) + (b.sub ? run('   ' + b.sub, { sz: small, color: '555555' }) : ''),
            { before: 240, after: 120, keepNext: true, border: '<w:bottom w:val="single" w:sz="6" w:space="2" w:color="000000"/>' }));
          break;
        case 'end':
          out.push(para('', { before: 360, after: 120, border: '<w:bottom w:val="single" w:sz="4" w:space="1" w:color="999999"/>' }));
          out.push(self.blocksXml(self.rich(b.html, { p: { align: 'center', after: 60 } })));
          break;
        case 'q': out.push(self.question(b, base, small, lines, blank)); break;
        case 'grid': {
          const cols = 3;
          const per = Math.ceil(b.rows.length / cols);
          const cw = Math.floor(W / cols);
          const cellFor = (r) => {
            if (!r) return { xml: para('', { after: 0 }) };
            let runs = run((r.n + '.').padEnd(4, ' ') + ' ', { b: true });
            if (b.style === 'bubbles') runs += r.letters.map(l => run(CIRCLED(l), { sz: base + 6, font: 'Segoe UI Symbol' }) + run('  ')).join('');
            else runs += run('       ' + (r.multi ? '       ' : ''), { box: true, sz: base + 6 }) + run('  ' + r.letters[0] + '–' + r.letters[r.letters.length - 1], { sz: small - 2, color: '666666' });
            if (r.multi) runs += run(' all', { i: true, sz: small - 2, color: '555555' });
            return { xml: para(runs, { after: 0, line: 420, lineRule: 'atLeast' }) };
          };
          const rows = [];
          for (let i = 0; i < per; i++) rows.push(Array.from({ length: cols }, (_, c) => cellFor(b.rows[c * per + i])));
          out.push(layoutTable(Array(cols).fill(cw), rows));
          out.push(para('', { after: 120 }));
          break;
        }
        case 'sheetItem': {
          const num = run((b.n + '.').padEnd(4, ' '), { b: true });
          if (b.boxes) out.push(para(num + b.boxes.map(l => run('  ' + l + ' ', { sz: small }) + run('      ', { box: true, sz: base + 6 })).join(run('  ')), { after: 160, line: 420, lineRule: 'atLeast' }));
          if (b.wide) out.push(para(num + b.wide.map(l => run(' ' + l + ' ', { sz: small }) + blank(b.wide.length > 1 ? 24 : 40)).join(run('  ')), { after: 200, line: 420, lineRule: 'atLeast' }));
          if (b.lines) {
            out.push(para(num, { keepNext: true, after: 0 }));
            out.push(lines(b.lines, 360));
            out.push(para('', { after: 120 }));
          }
          break;
        }
        case 'scorebox':
          out.push(para(run('For grading', { b: true, sz: small }) + tabRun() + run('Score: ', { sz: small }) + blank(10) + run(' / ' + b.total, { sz: small }) + tabRun() + run('Grader: ', { sz: small }) + blank(16),
            { before: 360, border: '<w:top w:val="single" w:sz="6" w:space="6" w:color="000000"/>', tabs: [{ pos: Math.floor(W * 0.35) }, { pos: Math.floor(W * 0.7) }] }));
          break;
        case 'keyTable': {
          const widths = [600, Math.floor(W * 0.42), 700, 1700];
          widths.push(W - widths.reduce((a, c) => a + c, 0));
          const head = ['#', 'Answer', 'Pts', 'Type', 'Pool / outcome'].map(t => ({ xml: para(run(t, { b: true, sz: small }), { after: 0 }), tcPr: '<w:shd w:val="clear" w:color="auto" w:fill="E8E8E8"/>' }));
          const rows = [head].concat(b.rows.map(r => [String(r.n), r.answer, String(r.pts), r.type, r.source].map((t, i) => ({ xml: para(run(t, i === 1 ? { b: true, sz: base } : { sz: small }), { after: 0 }) }))));
          rows.push(['', 'Total', String(b.total), '', ''].map(t => ({ xml: para(run(t, { b: true, sz: small }), { after: 0 }) })));
          const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s2 => '<w:' + s2 + ' w:val="single" w:sz="4" w:space="0" w:color="999999"/>').join('') + '</w:tblBorders>';
          out.push(layoutTable(widths, rows, { borders, headerRow: true }));
          out.push(para('', { after: 200 }));
          break;
        }
        case 'essayKey': {
          out.push(self.blocksXml(self.rich(b.stem, { prefix: run(b.n + '. ', { b: true }), suffix: run('  (' + b.pts + ')', { color: '555555', sz: small }), p: { keepNext: true, before: 200 } }), true));
          out.push(para(run('Sample answer', { b: true, sz: small }), { keepNext: true, left: 360 }));
          out.push(self.blocksXml(self.rich(b.sample || '<i>None given.</i>', { p: { left: 360, keepNext: true, shade: 'F3F3F3' } }), true));
          out.push(para(run('Rubric notes', { b: true, sz: small }), { keepNext: true, left: 360, before: 120 }));
          out.push(lines(b.lines, 360));
          break;
        }
      }
    });
    return out.join('');
  };

  Writer.prototype.question = function (b, base, small, lines, blank) {
    const self = this;
    const IND = 440;
    const out = [];
    out.push(self.blocksXml(self.rich(b.stem, {
      prefix: run(b.n + '.' + '\t', { b: true }),
      suffix: b.pts ? run('  (' + b.pts + ')', { color: '555555', sz: small }) : '',
      p: { left: IND, hanging: IND, keepNext: true, before: 180, tabs: [{ pos: IND }] }
    }), true));
    b.parts.forEach(p => {
      switch (p.k) {
        case 'hint': out.push(para(run(p.text, { i: true, sz: small, color: '444444' }), { left: IND, keepNext: true })); break;
        case 'choices':
          if (p.inline) {
            out.push(para(p.items.map(c => run(p.boxes ? '◯ ' : c.label + '. ', { b: !p.boxes }) + run(c.html)).join(run('        ')), { left: IND + 200, keepNext: true }));
          } else {
            p.items.forEach(c => out.push(self.blocksXml(self.rich(c.html, {
              prefix: run((p.boxes ? '◯ ' : '') + c.label + '.\t', { b: true }),
              p: { left: IND + 560, hanging: 560 - 200, keepNext: true, tabs: [{ pos: IND + 560 }], after: 40 }
            }), true)));
          }
          break;
        case 'match': {
          const avail = self.textWidth - IND;
          const lw = Math.floor(avail * 0.52);
          const cell = (items, blanks) => items.map(it => self.blocksXml(self.rich(it.html, {
            prefix: (blanks ? run('______', { color: '444444' }) + run(' ') : '') + run(it.label + '.\t', { b: true }),
            p: { left: blanks ? 1240 : 400, hanging: blanks ? 1240 : 400, tabs: [{ pos: blanks ? 1240 : 400 }], keepNext: true, after: 60 }
          }), true)).join('');
          out.push(layoutTable([lw, avail - lw], [[{ xml: cell(p.left, p.blanks) }, { xml: cell(p.right, false) }]], { indent: IND }));
          break;
        }
        case 'answerLine':
          out.push(para(p.labels.map(l => run(l + ' ', { sz: small }) + blank(p.labels.length > 1 ? 24 : 44)).join(run('   ')), { left: IND, before: 120, keepNext: true }));
          break;
        case 'lines': out.push(lines(p.n, IND)); break;
      }
    });
    // spacing paragraph ends the keep-together chain
    out.push(para('', { after: 0, line: 120, lineRule: 'exact' }));
    return out.join('');
  };

  /* ---------- package parts ---------- */
  const NS = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"';

  function stylesXml(s) {
    const sz = s.largePrint ? 28 : 22;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ' + NS + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="17"/><w:color w:val="555555"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '</w:styles>';
  }

  function footerXml(text, width) {
    const fld = (instr, ph) => '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + instr + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>' + ph + '</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ' + NS + '>' +
      '<w:p><w:pPr><w:pStyle w:val="Footer"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="999999"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="' + width + '"/></w:tabs></w:pPr>' +
      run(text) + '<w:r><w:tab/></w:r>' + run('Page ') + fld('PAGE', '1') + run(' of ') + fld('NUMPAGES', '1') + '</w:p></w:ftr>';
  }

  /** One document (blocks) → .docx bytes. ctx: { images, paper } */
  function build(d, ctx) {
    ctx = Object.assign({ paper: (d.settings && d.settings.paper) || 'letter' }, ctx || {});
    const w = new Writer(ctx);
    const body = w.body(d);
    const pg = PAGE[ctx.paper] || PAGE.letter;
    const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="' + pg.w + '" w:h="' + pg.h + '"/>' +
      '<w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN + '" w:header="576" w:footer="504" w:gutter="0"/></w:sectPr>';
    const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS + '><w:body>' + body + sect + '</w:body></w:document>';
    const mediaTypes = Array.from(new Set(w.media.map(m => m.name.split('.').pop())));
    const files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        mediaTypes.map(e => '<Default Extension="' + e + '" ContentType="image/' + e + '"/>').join('') +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + x(d.footer) + '</dc:title><dc:creator>Paper Test Editor</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') + '</dcterms:created></cp:coreProperties>' },
      { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
        '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
        w.media.map(m => '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.name + '"/>').join('') +
        '</Relationships>' },
      { name: 'word/document.xml', text: document },
      { name: 'word/styles.xml', text: stylesXml(d.settings || {}) },
      { name: 'word/settings.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ' + NS + '><w:defaultTabStop w:val="440"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><m:mathPr><m:mathFont m:val="Cambria Math"/></m:mathPr></w:settings>' },
      { name: 'word/footer1.xml', text: footerXml(d.footer, pg.w - 2 * MARGIN) }
    ].concat(w.media.map(m => ({ name: 'word/media/' + m.name, bytes: m.bytes })));
    return PT.zip.zip(files);
  }

  PT.docx = { build, omml };
})();
