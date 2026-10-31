/*
 * Minimal zip reading and writing, all in the browser.
 *  - read: stored and deflated entries (deflate via the built-in DecompressionStream)
 *  - write: stored entries (the writer from the Blackboard Question Editor)
 */
(function () {
  'use strict';
  const PT = (globalThis.PT = globalThis.PT || {});

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack compressed .zip files. Please use a current version of Chrome, Edge, Firefox or Safari.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Read a zip archive → Map(name → Uint8Array). */
  async function unzip(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a .zip archive.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The .zip archive is damaged.');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const nameBytes = bytes.subarray(p + 46, p + 46 + nlen);
      const name = (flags & 0x0800) ? dec.decode(nameBytes) : Array.from(nameBytes, b => String.fromCharCode(b)).join('');
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const lnlen = dv.getUint16(lho + 26, true);
      const lxlen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lxlen;
      const data = bytes.subarray(start, start + csize);
      if (method === 0) out.set(name, data.slice());
      else if (method === 8) out.set(name, await inflateRaw(data));
      else throw new Error('The .zip uses a compression method this page cannot read (' + method + ').');
    }
    return out;
  }

  /** files: [{ name, text } | { name, bytes }] → Uint8Array of a .zip (stored). */
  function zip(files, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = f.bytes || enc.encode(f.text);
      const crc = crc32(data);
      const head = (sig, central) => {
        const b = new DataView(new ArrayBuffer(central ? 46 : 30));
        let q = 0;
        const u32 = (v) => { b.setUint32(q, v, true); q += 4; };
        const u16 = (v) => { b.setUint16(q, v, true); q += 2; };
        u32(sig);
        if (central) u16(20);
        u16(20); u16(0x0800); u16(0);
        u16(dosTime); u16(dosDate);
        u32(crc); u32(data.length); u32(data.length);
        u16(name.length); u16(0);
        if (central) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
        return new Uint8Array(b.buffer);
      };
      const local = head(0x04034b50, false);
      locals.push(local, name, data);
      centrals.push(head(0x02014b50, true), name);
      offset += local.length + name.length + data.length;
    });
    const cdSize = centrals.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = locals.concat(centrals, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
    let q = 0;
    parts.forEach(a => { out.set(a, q); q += a.length; });
    return out;
  }

  const b64ToBytes = (b64) => {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const bytesToB64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  PT.zip = { unzip, zip, crc32, b64ToBytes, bytesToB64 };
})();
