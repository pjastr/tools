/*
 * tools-php – pliki OLE / Compound File Binary ([MS-CFB]), zestawy właściwości ([MS-OLEPS])
 * i struktury dokumentów Word 97–2003 ([MS-DOC]) – odczyt i zapis (MIT, własna implementacja).
 * Dostępne jako window.ToolsOle. Wymaga: js/lib/toolkit.js.
 */
(function () {
  'use strict';
  var K = window.ToolKit, utf8e = K.utf8e, latin1 = K.latin1, validDate = K.validDate;
  function cfbErr() { var e = new Error('Damaged OLE file'); e.code = 'cfb_error'; return e; }

  var FREESECT = 0xFFFFFFFF, ENDOFCHAIN = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD, DIFSECT = 0xFFFFFFFC, NOSTREAM = 0xFFFFFFFF;

  function isCfb(b) { return b.length > 512 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0 && b[4] === 0xA1 && b[5] === 0xB1 && b[6] === 0x1A && b[7] === 0xE1; }

  function readCfb(b) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var u16 = function (o) { return dv.getUint16(o, true); }, u32 = function (o) { return dv.getUint32(o, true); };
    var secShift = u16(0x1E), secSize = 1 << secShift, miniSize = 1 << u16(0x20);
    if (secShift !== 9 && secShift !== 12) throw cfbErr();
    var cutoff = u32(0x38) || 4096;
    var secOff = function (s) { return (s + 1) * secSize; };
    var fatSecs = [];
    for (var i = 0; i < 109; i++) { var v = u32(0x4C + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); }
    var dif = u32(0x44), guard = 0;
    while (dif < 0xFFFFFFFA && guard++ < 100000) {
      var o = secOff(dif);
      if (o + secSize > b.length) break;
      for (var j = 0; j < secSize / 4 - 1; j++) { var w = u32(o + j * 4); if (w < 0xFFFFFFFA) fatSecs.push(w); }
      dif = u32(o + secSize - 4);
    }
    var per = secSize / 4, fat = new Uint32Array(fatSecs.length * per);
    fatSecs.forEach(function (s, k) {
      var off = secOff(s);
      for (var j = 0; j < per; j++) fat[k * per + j] = off + j * 4 + 4 <= b.length ? u32(off + j * 4) : FREESECT;
    });
    function chain(start, table) {
      var out = [], s = start, seen = 0;
      while (s < 0xFFFFFFFA && s < table.length && seen++ < table.length + 1) { out.push(s); s = table[s]; }
      return out;
    }
    function readChain(start, size) {
      var secs = chain(start, fat), out = new Uint8Array(size == null ? secs.length * secSize : size), p = 0;
      for (var k = 0; k < secs.length && p < out.length; k++) {
        var off = secOff(secs[k]), n = Math.min(secSize, out.length - p, b.length - off);
        if (n <= 0) break;
        out.set(b.subarray(off, off + n), p);
        p += n;
      }
      return out;
    }
    var dir = readChain(u32(0x30));
    var entries = [];
    for (var e = 0; e + 128 <= dir.length; e += 128) {
      var ddv = new DataView(dir.buffer, dir.byteOffset + e, 128);
      var nl = ddv.getUint16(64, true), name = '';
      for (var c = 0; c < Math.max(0, nl / 2 - 1) && c < 32; c++) name += String.fromCharCode(ddv.getUint16(c * 2, true));
      entries.push({
        name: name, type: dir[e + 66], color: dir[e + 67], left: ddv.getUint32(68, true), right: ddv.getUint32(72, true),
        child: ddv.getUint32(76, true), start: ddv.getUint32(116, true), size: ddv.getUint32(120, true),
        raw: dir.slice(e, e + 128)
      });
    }
    if (!entries.length || entries[0].type !== 5) throw cfbErr();
    var miniFat = new Uint32Array(0);
    if (u32(0x3C) < 0xFFFFFFFA) {
      var mf = readChain(u32(0x3C));
      miniFat = new Uint32Array(mf.buffer, mf.byteOffset, Math.floor(mf.length / 4));
    }
    var rootEnt = entries[0];
    var mini = rootEnt.start < 0xFFFFFFFA ? readChain(rootEnt.start, rootEnt.size) : new Uint8Array(0);
    function stream(i) {
      var en = entries[i];
      if (!en || en.type !== 2) return null;
      if (en.size < cutoff) {
        var out = new Uint8Array(en.size), p = 0, secs = chain(en.start, miniFat);
        for (var k = 0; k < secs.length && p < en.size; k++) {
          var off = secs[k] * miniSize, n = Math.min(miniSize, en.size - p, mini.length - off);
          if (n <= 0) break;
          out.set(mini.subarray(off, off + n), p);
          p += n;
        }
        return out;
      }
      return readChain(en.start, en.size);
    }
    function children(i) {
      var out = [], stack = [entries[i] ? entries[i].child : NOSTREAM], guard2 = 0;
      while (stack.length && guard2++ < entries.length * 2 + 2) {
        var x = stack.pop();
        if (x === NOSTREAM || x >= entries.length) continue;
        out.push(x);
        stack.push(entries[x].left, entries[x].right);
      }
      return out;
    }
    function find(name, parent) {
      var kids = children(parent || 0);
      for (var k = 0; k < kids.length; k++) if (entries[kids[k]].name === name) return kids[k];
      return -1;
    }
    return { entries: entries, stream: stream, children: children, find: find, cutoff: cutoff, version: u16(0x1A) };
  }

  /** Porównanie nazw w drzewie katalogu CFB: najpierw długość, potem wielkie litery. */
  function cfbCompare(a, b) {
    if (a.length !== b.length) return a.length - b.length;
    var A = a.toUpperCase(), B = b.toUpperCase();
    return A < B ? -1 : A > B ? 1 : 0;
  }

  /**
   * Zapisuje nowy plik CFB (wersja 3, sektory 512 B). Zachowuje drzewo katalogu oryginału,
   * zmienia tylko zawartość strumieni. Wolne sektory i pozostałości starych danych nie są kopiowane.
   * cfb: wynik readCfb; contents: { indeksWpisu: Uint8Array } – nowa zawartość; add: [{ name, data }] – nowe strumienie w korzeniu.
   */
  function writeCfb(cfb, contents, add) {
    var SS = 512, MS = 64, CUT = 4096, PER = SS / 4;
    var ents = cfb.entries.map(function (e) { return { name: e.name, type: e.type, color: e.color, left: e.left, right: e.right, child: e.child, raw: new Uint8Array(e.raw) }; });
    var data = {};
    ents.forEach(function (e, i) { if (e.type === 2) data[i] = contents[i] || cfb.stream(i); });
    if (add && add.length) {
      add.forEach(function (a) {
        var raw = new Uint8Array(128), dv = new DataView(raw.buffer);
        for (var c = 0; c < a.name.length; c++) dv.setUint16(c * 2, a.name.charCodeAt(c), true);
        dv.setUint16(64, (a.name.length + 1) * 2, true);
        raw[66] = 2; // strumień
        ents.push({ name: a.name, type: 2, color: 1, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, raw: raw });
        data[ents.length - 1] = a.data;
      });
      // Przebudowa drzewa dzieci korzenia (zrównoważone drzewo BST, wszystkie węzły czarne)
      var kids = cfb.children(0).concat(add.map(function (a, k) { return cfb.entries.length + k; }));
      kids.sort(function (x, y) { return cfbCompare(ents[x].name, ents[y].name); });
      var build = function (lo, hi) {
        if (lo > hi) return NOSTREAM;
        var mid = (lo + hi) >> 1, idx = kids[mid];
        ents[idx].left = build(lo, mid - 1);
        ents[idx].right = build(mid + 1, hi);
        ents[idx].color = 1;
        return idx;
      };
      ents[0].child = build(0, kids.length - 1);
    }
    // Mini strumień
    var miniParts = [], miniFat = [], miniLen = 0;
    var start = {}, size = {};
    ents.forEach(function (e, i) {
      if (e.type !== 2) return;
      var d = data[i] || new Uint8Array(0);
      size[i] = d.length;
      if (d.length === 0) { start[i] = ENDOFCHAIN; return; }
      if (d.length < CUT) {
        var n = Math.ceil(d.length / MS), first = miniLen / MS;
        for (var k = 0; k < n; k++) miniFat.push(k === n - 1 ? ENDOFCHAIN : first + k + 1);
        miniParts.push({ off: miniLen, data: d });
        miniLen += n * MS;
        start[i] = first;
      }
    });
    var mini = new Uint8Array(miniLen);
    miniParts.forEach(function (p) { mini.set(p.data, p.off); });
    // Plan sektorów: duże strumienie, mini strumień, katalog, mini FAT, FAT, DIFAT
    var blocks = [];
    ents.forEach(function (e, i) { if (e.type === 2 && size[i] >= CUT) blocks.push({ kind: 's', i: i, data: data[i] }); });
    if (miniLen) blocks.push({ kind: 'mini', data: mini });
    var dirCount = Math.ceil(ents.length * 128 / SS);
    var dirBytes = new Uint8Array(dirCount * SS);
    blocks.push({ kind: 'dir', data: dirBytes });
    var miniFatBytes = new Uint8Array(Math.ceil(miniFat.length * 4 / SS) * SS);
    if (miniFat.length) blocks.push({ kind: 'minifat', data: miniFatBytes });
    var nData = 0;
    blocks.forEach(function (bl) { bl.n = Math.ceil(bl.data.length / SS); bl.first = nData; nData += bl.n; });
    var nFat = 0, nDif = 0;
    for (var it = 0; it < 50; it++) {
      var nf = Math.ceil((nData + nFat + nDif) / PER), nd = nf > 109 ? Math.ceil((nf - 109) / (PER - 1)) : 0;
      if (nf === nFat && nd === nDif) break;
      nFat = nf; nDif = nd;
    }
    var total = nData + nFat + nDif;
    var fat = new Uint32Array(nFat * PER).fill(FREESECT);
    blocks.forEach(function (bl) { for (var k = 0; k < bl.n; k++) fat[bl.first + k] = k === bl.n - 1 ? ENDOFCHAIN : bl.first + k + 1; });
    var fatStart = nData, difStart = nData + nFat;
    for (var f = 0; f < nFat; f++) fat[fatStart + f] = FATSECT;
    for (var g = 0; g < nDif; g++) fat[difStart + g] = DIFSECT;
    var startOf = function (kind) { for (var k = 0; k < blocks.length; k++) if (blocks[k].kind === kind) return blocks[k].first; return ENDOFCHAIN; };
    blocks.forEach(function (bl) { if (bl.kind === 's') start[bl.i] = bl.first; });
    // Katalog
    ents.forEach(function (e, i) {
      var raw = e.raw, dv = new DataView(raw.buffer, raw.byteOffset, 128);
      raw[67] = e.color;
      dv.setUint32(68, e.left, true); dv.setUint32(72, e.right, true); dv.setUint32(76, e.child, true);
      if (e.type === 2) { dv.setUint32(116, start[i], true); dv.setUint32(120, size[i], true); }
      else if (e.type === 5) { dv.setUint32(116, miniLen ? startOf('mini') : ENDOFCHAIN, true); dv.setUint32(120, miniLen, true); }
      else { dv.setUint32(116, 0, true); dv.setUint32(120, 0, true); }
      dv.setUint32(124, 0, true);
      dirBytes.set(raw, i * 128);
    });
    for (var u = ents.length; u < dirCount * 4; u++) {
      var dv2 = new DataView(dirBytes.buffer, u * 128, 128);
      dv2.setUint32(68, NOSTREAM, true); dv2.setUint32(72, NOSTREAM, true); dv2.setUint32(76, NOSTREAM, true);
    }
    var mfv = new DataView(miniFatBytes.buffer);
    for (var q = 0; q < miniFatBytes.length / 4; q++) mfv.setUint32(q * 4, q < miniFat.length ? miniFat[q] : FREESECT, true);
    // Plik wynikowy
    var out = new Uint8Array((total + 1) * SS), ov = new DataView(out.buffer);
    out.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0);
    ov.setUint16(0x18, 0x3E, true); ov.setUint16(0x1A, 3, true); ov.setUint16(0x1C, 0xFFFE, true);
    ov.setUint16(0x1E, 9, true); ov.setUint16(0x20, 6, true);
    ov.setUint32(0x2C, nFat, true); ov.setUint32(0x30, startOf('dir'), true); ov.setUint32(0x38, CUT, true);
    ov.setUint32(0x3C, miniFat.length ? startOf('minifat') : ENDOFCHAIN, true);
    ov.setUint32(0x40, miniFat.length ? miniFatBytes.length / SS : 0, true);
    ov.setUint32(0x44, nDif ? difStart : ENDOFCHAIN, true); ov.setUint32(0x48, nDif, true);
    for (var h = 0; h < 109; h++) ov.setUint32(0x4C + h * 4, h < nFat ? fatStart + h : FREESECT, true);
    blocks.forEach(function (bl) { out.set(bl.data, (bl.first + 1) * SS); });
    for (var fs = 0; fs < nFat; fs++) for (var fe = 0; fe < PER; fe++) ov.setUint32((fatStart + fs + 1) * SS + fe * 4, fat[fs * PER + fe], true);
    for (var ds = 0; ds < nDif; ds++) {
      var base = (difStart + ds + 1) * SS;
      for (var de = 0; de < PER - 1; de++) {
        var idx = 109 + ds * (PER - 1) + de;
        ov.setUint32(base + de * 4, idx < nFat ? fatStart + idx : FREESECT, true);
      }
      ov.setUint32(base + SS - 4, ds === nDif - 1 ? ENDOFCHAIN : difStart + ds + 1, true);
    }
    return out;
  }

  /* ====================================================================== */
  /* Zestawy właściwości OLE ([MS-OLEPS])                                    */
  /* ====================================================================== */

  var FMTID_SUMMARY = 'F29F85E0-4FF9-1068-AB91-08002B27B3D9';
  var FMTID_DOCSUM = 'D5CDD502-2E9C-101B-9397-08002B2CF9AE';
  var FMTID_USER = 'D5CDD505-2E9C-101B-9397-08002B2CF9AE';
  var VT_I2 = 2, VT_I4 = 3, VT_R8 = 5, VT_BOOL = 11, VT_UI4 = 19, VT_LPSTR = 30, VT_LPWSTR = 31, VT_FILETIME = 64;
  var EPOCH = 116444736000000000n;

  function guidAt(dv, o) {
    var h = function (n, l) { return n.toString(16).toUpperCase().padStart(l, '0'); };
    var s = h(dv.getUint32(o, true), 8) + '-' + h(dv.getUint16(o + 4, true), 4) + '-' + h(dv.getUint16(o + 6, true), 4) + '-';
    for (var i = 8; i < 16; i++) { s += h(dv.getUint8(o + i), 2); if (i === 9) s += '-'; }
    return s;
  }
  function guidBytes(g) {
    var hex = g.replace(/-/g, ''), b = new Uint8Array(16), dv = new DataView(b.buffer);
    dv.setUint32(0, parseInt(hex.slice(0, 8), 16), true);
    dv.setUint16(4, parseInt(hex.slice(8, 12), 16), true);
    dv.setUint16(6, parseInt(hex.slice(12, 16), 16), true);
    for (var i = 0; i < 8; i++) b[8 + i] = parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16);
    return b;
  }
  var CP_LABEL = { 1200: 'utf-16le', 1201: 'utf-16be', 65001: 'utf-8', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 866: 'ibm866', 28591: 'iso-8859-1', 28592: 'iso-8859-2', 20127: 'us-ascii' };
  function cpLabel(cp) { return CP_LABEL[cp] || (cp >= 1250 && cp <= 1258 ? 'windows-' + cp : 'windows-1252'); }
  function decodeCp(bytes, cp) {
    try { return new TextDecoder(cpLabel(cp)).decode(bytes).replace(/\0+$/, '').replace(/\0.*$/, ''); } catch (e) { return new TextDecoder('windows-1252').decode(bytes).replace(/\0[\s\S]*$/, ''); }
  }
  var revMaps = {};
  /** Kodowanie tekstu w stronie kodowej; null, jeśli znak nie istnieje w tej stronie kodowej. */
  function encodeCp(str, cp) {
    if (cp === 1200) { var u = new Uint8Array(str.length * 2); for (var i = 0; i < str.length; i++) { u[i * 2] = str.charCodeAt(i) & 255; u[i * 2 + 1] = str.charCodeAt(i) >> 8; } return u; }
    if (cp === 65001) return utf8e.encode(str);
    var label = cpLabel(cp);
    if (!/^(windows-|iso-8859|macintosh|ibm866|us-ascii)/.test(label)) return null;
    var map = revMaps[label];
    if (!map) {
      map = {};
      var all = new Uint8Array(256);
      for (var k = 0; k < 256; k++) all[k] = k;
      var dec;
      try { dec = new TextDecoder(label).decode(all); } catch (e) { return null; }
      for (var j = 0; j < dec.length; j++) if (!(dec.charAt(j) in map)) map[dec.charAt(j)] = j;
      revMaps[label] = map;
    }
    var out = new Uint8Array(str.length);
    for (var c = 0; c < str.length; c++) { var bt = map[str.charAt(c)]; if (bt == null) return null; out[c] = bt; }
    return out;
  }
  function ftToDate(lo, hi) {
    var ft = (BigInt(hi) << 32n) | BigInt(lo);
    if (ft === 0n) return null;
    var d = new Date(Number((ft - EPOCH) / 10000n));
    return validDate(d) && d.getFullYear() > 1601 ? d : null;
  }

  /** Odczyt strumienia zestawu właściwości. */
  function parsePropSet(b) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 28 || dv.getUint16(0, true) !== 0xFFFE) throw new Error('bad property set');
    var n = dv.getUint32(24, true), sets = [];
    for (var s = 0; s < n && s < 8; s++) {
      var fmtid = guidAt(dv, 28 + s * 20), off = dv.getUint32(28 + s * 20 + 16, true);
      if (off + 8 > b.length) continue;
      var secSize = dv.getUint32(off, true), np = dv.getUint32(off + 4, true), list = [];
      for (var p = 0; p < np && p < 4096; p++) list.push({ id: dv.getUint32(off + 8 + p * 8, true), off: dv.getUint32(off + 12 + p * 8, true) });
      var sorted = list.slice().sort(function (a, c) { return a.off - c.off; });
      var sec = { fmtid: fmtid, props: [], codepage: 1252, dict: null };
      sorted.forEach(function (pr, k) {
        var end = k + 1 < sorted.length ? sorted[k + 1].off : secSize;
        var a = off + pr.off, z = Math.min(off + Math.max(end, pr.off + 4), b.length);
        pr.raw = b.slice(a, z);
        if (pr.id !== 0) pr.type = new DataView(pr.raw.buffer).getUint16(0, true);
      });
      var cpProp = list.filter(function (x) { return x.id === 1; })[0];
      if (cpProp && cpProp.raw.length >= 6) sec.codepage = new DataView(cpProp.raw.buffer).getUint16(4, true);
      list.forEach(function (pr) {
        if (pr.id === 0) { sec.dict = parseDict(pr.raw, sec.codepage); return; }
        try { pr.value = parseValue(pr.raw, sec.codepage); } catch (e) { pr.value = undefined; }
        sec.props.push(pr);
      });
      sets.push(sec);
    }
    return { header: b.slice(0, 24), sections: sets };
  }
  function parseDict(raw, cp) {
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), n = dv.getUint32(0, true), p = 4, out = {};
    for (var i = 0; i < n && p + 8 <= raw.length; i++) {
      var id = dv.getUint32(p, true), len = dv.getUint32(p + 4, true);
      p += 8;
      if (cp === 1200) {
        out[id] = decodeCp(raw.subarray(p, p + len * 2), 1200);
        p += len * 2;
        p += (4 - (len * 2) % 4) % 4;
      } else {
        out[id] = decodeCp(raw.subarray(p, p + len), cp);
        p += len;
      }
    }
    return out;
  }
  function parseValue(raw, cp) {
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), t = dv.getUint16(0, true);
    switch (t) {
      case VT_I2: return dv.getInt16(4, true);
      case VT_I4: return dv.getInt32(4, true);
      case VT_UI4: return dv.getUint32(4, true);
      case VT_R8: return dv.getFloat64(4, true);
      case VT_BOOL: return dv.getUint16(4, true) !== 0;
      case VT_LPSTR: { var sz = dv.getUint32(4, true); return decodeCp(raw.subarray(8, 8 + sz), cp); }
      case VT_LPWSTR: { var ch = dv.getUint32(4, true); return decodeCp(raw.subarray(8, 8 + ch * 2), 1200); }
      case VT_FILETIME: return { lo: dv.getUint32(4, true), hi: dv.getUint32(8, true) };
      case 0x101E: { // wektor VT_LPSTR (np. TitlesOfParts)
        var cnt = dv.getUint32(4, true), p = 8, out = [];
        for (var i = 0; i < cnt && p + 4 <= raw.length && i < 500; i++) {
          var l = dv.getUint32(p, true); p += 4;
          out.push(decodeCp(raw.subarray(p, p + l), cp)); p += l;
          if (cp === 1200) p += (4 - l % 4) % 4;
        }
        return out;
      }
    }
    return undefined;
  }
  function pad4(n) { return (4 - n % 4) % 4; }
  function encValue(type, value, cp) {
    var b, dv;
    if (type === VT_LPSTR) {
      var s = encodeCp(String(value) + '\0', cp);
      if (!s) return null;
      b = new Uint8Array(8 + s.length + pad4(s.length)); dv = new DataView(b.buffer);
      dv.setUint16(0, type, true); dv.setUint32(4, s.length, true); b.set(s, 8);
      return b;
    }
    if (type === VT_LPWSTR) {
      var w = encodeCp(String(value) + '\0', 1200);
      b = new Uint8Array(8 + w.length + pad4(w.length)); dv = new DataView(b.buffer);
      dv.setUint16(0, type, true); dv.setUint32(4, w.length / 2, true); b.set(w, 8);
      return b;
    }
    if (type === VT_FILETIME) {
      var ft = value instanceof Date ? BigInt(value.getTime()) * 10000n + EPOCH : BigInt(value);
      b = new Uint8Array(12); dv = new DataView(b.buffer);
      dv.setUint16(0, type, true); dv.setUint32(4, Number(ft & 0xFFFFFFFFn), true); dv.setUint32(8, Number(ft >> 32n), true);
      return b;
    }
    if (type === VT_R8) { b = new Uint8Array(12); dv = new DataView(b.buffer); dv.setUint16(0, type, true); dv.setFloat64(4, value, true); return b; }
    b = new Uint8Array(8); dv = new DataView(b.buffer); dv.setUint16(0, type, true);
    if (type === VT_I2) dv.setInt16(4, value, true);
    else if (type === VT_BOOL) dv.setUint16(4, value ? 0xFFFF : 0, true);
    else if (type === VT_UI4) dv.setUint32(4, value >>> 0, true);
    else dv.setInt32(4, value | 0, true);
    return b;
  }
  function encDict(dict, cp) {
    var ids = Object.keys(dict), parts = [], len = 4;
    ids.forEach(function (id) {
      var name = dict[id] + '\0', nb = encodeCp(name, cp) || encodeCp(name, 1200);
      var entry = new Uint8Array(8 + nb.length + (cp === 1200 ? pad4(nb.length) : 0)), dv = new DataView(entry.buffer);
      dv.setUint32(0, +id, true); dv.setUint32(4, cp === 1200 ? name.length : nb.length, true); entry.set(nb, 8);
      parts.push(entry); len += entry.length;
    });
    var out = new Uint8Array(len + pad4(len)), ov = new DataView(out.buffer), p = 4;
    ov.setUint32(0, ids.length, true);
    parts.forEach(function (e) { out.set(e, p); p += e.length; });
    return out;
  }
  /** Sekcja: { fmtid, props: [{id, raw}], dict } → bajty */
  function encSection(sec) {
    var props = sec.props.slice();
    if (sec.dict) props.push({ id: 0, raw: encDict(sec.dict, sec.codepage) });
    props.sort(function (a, b) { return a.id - b.id; });
    var head = 8 + props.length * 8, len = head;
    props.forEach(function (p) { p.len = p.raw.length + pad4(p.raw.length); len += p.len; });
    var out = new Uint8Array(len), dv = new DataView(out.buffer), off = head;
    dv.setUint32(0, len, true); dv.setUint32(4, props.length, true);
    props.forEach(function (p, i) {
      dv.setUint32(8 + i * 8, p.id, true); dv.setUint32(12 + i * 8, off, true);
      out.set(p.raw, off); off += p.len;
    });
    return out;
  }
  function encPropSet(header, sections) {
    var secs = sections.map(encSection), start = 28 + sections.length * 20, len = start;
    secs.forEach(function (s) { len += s.length; });
    var out = new Uint8Array(len), dv = new DataView(out.buffer);
    out.set(header.subarray(0, 24), 0);
    dv.setUint16(0, 0xFFFE, true);
    dv.setUint32(24, sections.length, true);
    var off = start;
    sections.forEach(function (s, i) {
      out.set(guidBytes(s.fmtid), 28 + i * 20);
      dv.setUint32(28 + i * 20 + 16, off, true);
      out.set(secs[i], off); off += secs[i].length;
    });
    return out;
  }
  function newHeader() { var h = new Uint8Array(24), dv = new DataView(h.buffer); dv.setUint16(0, 0xFFFE, true); dv.setUint32(4, 0x00020006, true); return h; }

  /** Ustawia właściwości tekstowe w sekcji; w razie potrzeby przełącza stronę kodową na Unicode (1200). */
  function setProps(sec, sets) {
    var strings = [];
    sec.props.forEach(function (p) { if (p.type === VT_LPSTR && typeof p.value === 'string' && !(p.id in sets)) strings.push(p.value); });
    Object.keys(sets).forEach(function (id) { var s = sets[id]; if (s && s.type === VT_LPSTR) strings.push(s.value); });
    var cp = sec.codepage;
    var ok = strings.every(function (s) { return encodeCp(s + '\0', cp); });
    if (sec.dict) ok = ok && Object.keys(sec.dict).every(function (k) { return encodeCp(sec.dict[k] + '\0', cp); });
    var changeCp = !ok;
    if (changeCp) cp = 1200;
    var out = [];
    sec.props.forEach(function (p) {
      if (p.id in sets) return;
      if (p.id === 1) { out.push({ id: 1, raw: encValue(VT_I2, cp === 1200 ? 1200 : sec.codepage) }); return; }
      if (changeCp && p.type === VT_LPSTR) { out.push({ id: p.id, raw: encValue(VT_LPSTR, p.value || '', cp) }); return; }
      if (changeCp && (p.type & 0x1000) && (p.type & 0xFFF) === VT_LPSTR) return; // wektory tekstów w starej stronie kodowej – pomijamy (Word je odtworzy)
      if (changeCp && p.type === 0x100C) return;
      out.push({ id: p.id, raw: p.raw });
    });
    Object.keys(sets).forEach(function (id) {
      var s = sets[id];
      if (!s) return;
      out.push({ id: +id, raw: encValue(s.type, s.value, cp) });
    });
    if (!out.some(function (p) { return p.id === 1; })) out.push({ id: 1, raw: encValue(VT_I2, cp) });
    return { fmtid: sec.fmtid, props: out, codepage: cp, dict: sec.dict };
  }

  // Indeksy par fc/lcb w FibRgFcLcb97/2000/2002 ([MS-DOC] 2.5.6–2.5.8)
  var FIB = { plcfBteChpx: 12, plcffndRef: 2, plcfandRef: 4, plcfandTxt: 5, sttbfAssoc: 32, clx: 33, grpXstAtnOwners: 36,
    sttbfAtnBkmk: 37, plcfAtnBkf: 42, plcfAtnBkl: 43, sttbfRMark: 51, sttbSavedBy: 71, atrdExtra: 112 };
  var WORD_VER = { 0xC1: 'Word 97', 0xD9: 'Word 2000', 0x101: 'Word 2002 (XP)', 0x10C: 'Word 2003', 0x112: 'Word 2007+' };

  function parseFib(w) {
    if (!w || w.length < 64) return null;
    var dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
    if (dv.getUint16(0, true) !== 0xA5EC) return null;
    var f = { nFib: dv.getUint16(2, true), lid: dv.getUint16(6, true) };
    var fl = dv.getUint16(0x0A, true);
    f.dot = !!(fl & 1); f.complex = !!(fl & 4); f.quickSaves = (fl >> 4) & 15; f.encrypted = !!(fl & 0x100);
    f.table = (fl & 0x200) ? '1Table' : '0Table'; f.readOnlyRec = !!(fl & 0x400); f.writeRes = !!(fl & 0x800); f.obfuscated = !!(fl & 0x8000);
    if (f.nFib < 101) { f.old = true; return f; }
    var p = 32, csw = dv.getUint16(p, true); p += 2 + csw * 2;
    var cslw = dv.getUint16(p, true), lw = p + 2; p += 2 + cslw * 4;
    f.cb = dv.getUint16(p, true); f.blob = p + 2;
    f.ccpAtn = cslw > 7 ? dv.getInt32(lw + 7 * 4, true) : 0;
    // Długości poddokumentów (w znakach): treść, przypisy, nagłówki, komentarze, przypisy końcowe, pola tekstowe
    var lwv = function (i) { return cslw > i ? Math.max(0, dv.getInt32(lw + i * 4, true)) : 0; };
    f.ccp = { text: lwv(3), ftn: lwv(4), hdd: lwv(5), atn: lwv(7), edn: lwv(8), txbx: lwv(9), hdrTxbx: lwv(10) };
    var after = f.blob + f.cb * 8;
    if (after + 4 <= w.length && dv.getUint16(after, true) > 0) f.nFibNew = dv.getUint16(after + 2, true);
    f.get = function (i) { return i < f.cb && f.blob + i * 8 + 8 <= w.length ? { fc: dv.getUint32(f.blob + i * 8, true), lcb: dv.getUint32(f.blob + i * 8 + 4, true), off: f.blob + i * 8 } : null; };
    return f;
  }
  function utf16(b, p, n) { var s = ''; for (var i = 0; i < n && p + i * 2 + 1 < b.length; i++) s += String.fromCharCode(b[p + i * 2] | (b[p + i * 2 + 1] << 8)); return s; }
  /** STTB – tablica ciągów ([MS-DOC] 2.2.4) */
  function readSttb(t, e) {
    if (!e || !e.lcb || e.fc + e.lcb > t.length) return [];
    var dv = new DataView(t.buffer, t.byteOffset, t.byteLength), p = e.fc, end = e.fc + e.lcb;
    var ext = dv.getUint16(p, true) === 0xFFFF; if (ext) p += 2;
    var n = dv.getUint16(p, true), extra = dv.getUint16(p + 2, true), out = [];
    p += 4;
    for (var i = 0; i < n && p < end; i++) {
      if (ext) { var c = dv.getUint16(p, true); p += 2; out.push(utf16(t, p, c)); p += c * 2; }
      else { var c8 = t[p]; p += 1; out.push(latin1(t, p, p + c8)); p += c8; }
      p += extra;
    }
    return out;
  }
  function writeSttbExt(strings) {
    var len = 6; strings.forEach(function (s) { len += 2 + s.length * 2; });
    var b = new Uint8Array(len), dv = new DataView(b.buffer), p = 6;
    dv.setUint16(0, 0xFFFF, true); dv.setUint16(2, strings.length, true); dv.setUint16(4, 0, true);
    strings.forEach(function (s) { dv.setUint16(p, s.length, true); p += 2; for (var i = 0; i < s.length; i++) { dv.setUint16(p, s.charCodeAt(i), true); p += 2; } });
    return b;
  }
  function readXstGroup(t, e) {
    if (!e || !e.lcb || e.fc + e.lcb > t.length) return [];
    var dv = new DataView(t.buffer, t.byteOffset, t.byteLength), p = e.fc, end = e.fc + e.lcb, out = [];
    while (p + 2 <= end && out.length < 10000) { var c = dv.getUint16(p, true); p += 2; out.push(utf16(t, p, c)); p += c * 2; }
    return out;
  }
  function writeXstGroup(strings) {
    var len = 0; strings.forEach(function (s) { len += 2 + s.length * 2; });
    var b = new Uint8Array(len), dv = new DataView(b.buffer), p = 0;
    strings.forEach(function (s) { dv.setUint16(p, s.length, true); p += 2; for (var i = 0; i < s.length; i++) { dv.setUint16(p, s.charCodeAt(i), true); p += 2; } });
    return b;
  }

  /** STTB z dodatkowymi danymi (cbExtra) dla każdego ciągu. */
  function readSttbEx(t, e) {
    var res = { strings: [], extras: [] };
    if (!e || !e.lcb || e.fc + e.lcb > t.length) return res;
    var dv = new DataView(t.buffer, t.byteOffset, t.byteLength), p = e.fc, end = e.fc + e.lcb;
    var ext = dv.getUint16(p, true) === 0xFFFF; if (ext) p += 2;
    var n = dv.getUint16(p, true), extra = dv.getUint16(p + 2, true);
    p += 4;
    for (var i = 0; i < n && p < end; i++) {
      if (ext) { var c = dv.getUint16(p, true); p += 2; res.strings.push(utf16(t, p, c)); p += c * 2; }
      else { var c8 = t[p]; p += 1; res.strings.push(latin1(t, p, p + c8)); p += c8; }
      res.extras.push(t.subarray(p, p + extra)); p += extra;
    }
    return res;
  }

  /** PLC: tablica n+1 pozycji CP i n struktur o rozmiarze cbData. */
  function readPlc(t, e, cbData) {
    var out = { cps: [], data: [] };
    if (!e || !e.lcb || e.fc + e.lcb > t.length) return out;
    var n = Math.floor((e.lcb - 4) / (4 + cbData)), dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    for (var i = 0; i <= n; i++) out.cps.push(dv.getInt32(e.fc + i * 4, true));
    for (var k = 0; k < n; k++) out.data.push(t.subarray(e.fc + (n + 1) * 4 + k * cbData, e.fc + (n + 1) * 4 + (k + 1) * cbData));
    return out;
  }

  /** DTTM ([MS-DOC] 2.9.66) → Date (czas lokalny autora) lub null. */
  function dttm(v) {
    if (!v) return null;
    var mi = v & 0x3F, h = (v >> 6) & 0x1F, d = (v >> 11) & 0x1F, mo = (v >> 16) & 0xF, y = (v >>> 20) & 0x1FF;
    if (!d || !mo) return null;
    var r = new Date(1900 + y, mo - 1, d, h, mi, 0);
    return validDate(r) ? r : null;
  }

  // Znaki 0x80–0x9F w tekście „skompresowanym” ([MS-DOC] 2.4.1)
  var CP1252 = { 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9F: 0x0178 };

  /**
   * Tekst dokumentu Word z tabeli fragmentów (Clx / PlcPcd).
   * Zwraca { pieces, text(cpA, cpB), length } – CP to pozycje znaków w całym tekście (wszystkie poddokumenty).
   */
  function docText(w, t, fib) {
    var e = fib.get(FIB.clx), pieces = [];
    if (e && e.lcb && e.fc + e.lcb <= t.length) {
      var dv = new DataView(t.buffer, t.byteOffset, t.byteLength), p = e.fc, end = e.fc + e.lcb, guard = 0;
      while (p < end && guard++ < 100000) {
        if (t[p] === 1) { p += 3 + dv.getInt16(p + 1, true); continue; }
        if (t[p] !== 2) break;
        var lcb = dv.getUint32(p + 1, true), plc = p + 5, n = Math.floor((lcb - 4) / 12);
        for (var i = 0; i < n; i++) {
          var cpA = dv.getUint32(plc + i * 4, true), cpB = dv.getUint32(plc + (i + 1) * 4, true);
          var pcd = plc + (n + 1) * 4 + i * 8, fcv = dv.getUint32(pcd + 2, true);
          var comp = !!(fcv & 0x40000000), fc = fcv & 0x3FFFFFFF;
          pieces.push({ cpA: cpA, cpB: cpB, comp: comp, fc: comp ? fc / 2 : fc });
        }
        break;
      }
    }
    if (!pieces.length) {
      // brak tabeli fragmentów – tekst ciągły (stare pliki); zakładamy Unicode od fcMin
      var total = fib.ccp ? fib.ccp.text + fib.ccp.ftn + fib.ccp.hdd + fib.ccp.atn + fib.ccp.edn + fib.ccp.txbx + fib.ccp.hdrTxbx + 1 : 0;
      pieces.push({ cpA: 0, cpB: total, comp: false, fc: 0x800 });
    }
    function text(a, b) {
      var out = '';
      pieces.forEach(function (pc) {
        var s = Math.max(a, pc.cpA), z = Math.min(b, pc.cpB);
        for (var cp = s; cp < z; cp++) {
          var k = cp - pc.cpA;
          if (pc.comp) { var by = w[pc.fc + k]; out += String.fromCharCode(CP1252[by] || by); }
          else { var o = pc.fc + k * 2; if (o + 1 < w.length) out += String.fromCharCode(w[o] | (w[o + 1] << 8)); }
        }
      });
      return out;
    }
    var length = pieces.reduce(function (m, pc) { return Math.max(m, pc.cpB); }, 0);
    return { pieces: pieces, text: text, length: length };
  }

  var SPRM_SIZE = [1, 1, 2, 4, 2, 2, -1, 3];
  /** Właściwości znaków związane ze śledzeniem zmian z grpprl (lista sprm). */
  function revisionSprms(g) {
    var r = null, p = 0, dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
    var set = function (k, v) { (r = r || {})[k] = v; };
    while (p + 2 <= g.length) {
      var sprm = dv.getUint16(p, true), size = SPRM_SIZE[sprm >> 13];
      p += 2;
      if (size === -1) { size = g[p] + 1; if (sprm === 0xD608 || sprm === 0xC615) size = dv.getUint16(p, true) + 2; }
      if (p + size > g.length) break;
      switch (sprm) {
        case 0x0800: set('del', g[p] !== 0); break;
        case 0x0801: set('ins', g[p] !== 0); break;
        case 0x4804: set('ibst', dv.getUint16(p, true)); break;
        case 0x6805: set('dttm', dv.getUint32(p, true)); break;
        case 0x4863: set('ibstDel', dv.getUint16(p, true)); break;
        case 0x6864: set('dttmDel', dv.getUint32(p, true)); break;
        case 0xCA89: if (size >= 8 && g[p + 1]) { set('fmt', true); set('ibstFmt', dv.getUint16(p + 2, true)); set('dttmFmt', dv.getUint32(p + 4, true)); } break;
      }
      p += size;
    }
    return r;
  }

  /** Przebiegi znaków (CHPX) z FKP: [{ fcA, fcB, rev }] – tylko te z oznaczeniami zmian. */
  function chpxRevisions(w, t, fib) {
    var e = fib.get(FIB.plcfBteChpx), out = [];
    if (!e || !e.lcb || e.fc + e.lcb > t.length) return out;
    var dv = new DataView(t.buffer, t.byteOffset, t.byteLength), n = Math.floor((e.lcb - 4) / 8);
    for (var i = 0; i < n; i++) {
      var pn = dv.getUint32(e.fc + (n + 1) * 4 + i * 4, true) & 0x3FFFFF, base = pn * 512;
      if (base + 512 > w.length) continue;
      var crun = w[base + 511], wdv = new DataView(w.buffer, w.byteOffset + base, 512);
      for (var k = 0; k < crun; k++) {
        var off = w[base + (crun + 1) * 4 + k] * 2;
        if (!off) continue;
        var cb = w[base + off];
        var rev = revisionSprms(w.subarray(base + off + 1, base + off + 1 + cb));
        if (rev && (rev.ins || rev.del || rev.fmt)) out.push({ fcA: wdv.getUint32(k * 4, true), fcB: wdv.getUint32((k + 1) * 4, true), rev: rev });
      }
    }
    return out;
  }

  /** Zakresy CP ze śledzonymi zmianami: [{ cpA, cpB, rev }] (posortowane). */
  function docRevisions(w, t, fib, dt) {
    var runs = chpxRevisions(w, t, fib), out = [];
    dt.pieces.forEach(function (pc) {
      var size = pc.comp ? 1 : 2, fcA = pc.fc, fcB = pc.fc + (pc.cpB - pc.cpA) * size;
      runs.forEach(function (r) {
        var a = Math.max(fcA, r.fcA), b = Math.min(fcB, r.fcB);
        if (a >= b) return;
        out.push({ cpA: pc.cpA + Math.floor((a - fcA) / size), cpB: pc.cpA + Math.ceil((b - fcA) / size), rev: r.rev });
      });
    });
    out.sort(function (x, y) { return x.cpA - y.cpA; });
    return out;
  }

  window.ToolsOle = {
    isCfb: isCfb, readCfb: readCfb, writeCfb: writeCfb, cfbCompare: cfbCompare,
    FMTID_SUMMARY: FMTID_SUMMARY, FMTID_DOCSUM: FMTID_DOCSUM, FMTID_USER: FMTID_USER,
    VT_I2: VT_I2, VT_I4: VT_I4, VT_R8: VT_R8, VT_BOOL: VT_BOOL, VT_UI4: VT_UI4, VT_LPSTR: VT_LPSTR, VT_LPWSTR: VT_LPWSTR, VT_FILETIME: VT_FILETIME,
    parsePropSet: parsePropSet, encPropSet: encPropSet, setProps: setProps, newHeader: newHeader, ftToDate: ftToDate,
    decodeCp: decodeCp, encodeCp: encodeCp,
    FIB: FIB, WORD_VER: WORD_VER, parseFib: parseFib, utf16: utf16, readSttb: readSttb, writeSttbExt: writeSttbExt,
    readXstGroup: readXstGroup, writeXstGroup: writeXstGroup, readSttbEx: readSttbEx, readPlc: readPlc, dttm: dttm,
    docText: docText, docRevisions: docRevisions
  };
})();
