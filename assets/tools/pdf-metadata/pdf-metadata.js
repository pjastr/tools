/*
 * tools-php – narzędzie „Metadane PDF” (MIT)
 * Odczyt i edycja metadanych PDF w całości w przeglądarce – plik nie jest wysyłany na serwer.
 * Korzysta z biblioteki pdf-lib (MIT), dołączonej lokalnie w assets/vendor/pdf-lib.min.js.
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-pdfm]');
  if (!root || !window.PDFLib) return;

  var L = window.PDFLib;
  var PDFName = L.PDFName, PDFString = L.PDFString, PDFHexString = L.PDFHexString, PDFDict = L.PDFDict,
    PDFArray = L.PDFArray, PDFRef = L.PDFRef, PDFNumber = L.PDFNumber, PDFBool = L.PDFBool, PDFStream = L.PDFStream;

  var T = function (k, p) { return App.t('tool.pdf-metadata.' + k, p); };
  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  var STD = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];
  var DATE_KEYS = { CreationDate: 1, ModDate: 1 };

  var LANG = (App.cfg && App.cfg.lang) || 'pl';
  var state = null; // { file, bytes, doc, info, xmp, details, findings }

  /* ====================================================================== */
  /* Pomocnicze                                                             */
  /* ====================================================================== */

  function fmtBytes(b) {
    var u = ['B', 'KB', 'MB', 'GB'], i = 0, v = b;
    while (v >= 1024 && i < 3) { v /= 1024; i++; }
    return (i ? v.toLocaleString(LANG, { maximumFractionDigits: 1 }) : v) + ' ' + u[i];
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtLocal(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function toInputValue(d) {
    return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) : '';
  }
  function esc(s) { return App.esc(s); }

  /** Data PDF: D:YYYYMMDDHHmmSSOHH'mm' → { date, tz, raw } */
  function parsePdfDate(s) {
    if (!s) return null;
    var raw = String(s).trim();
    var m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([Zz+\-])?\s*(\d{2})?'?(\d{2})?'?/.exec(raw);
    if (!m) return { date: null, raw: raw, tz: '' };
    var y = +m[1], mo = m[2] ? +m[2] - 1 : 0, d = m[3] ? +m[3] : 1, h = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, se = m[6] ? +m[6] : 0;
    var sign = m[7], oh = m[8] ? +m[8] : 0, om = m[9] ? +m[9] : 0;
    var date, tz = '';
    if (sign === 'Z' || sign === 'z') {
      date = new Date(Date.UTC(y, mo, d, h, mi, se)); tz = 'UTC';
    } else if (sign === '+' || sign === '-') {
      var off = (oh * 60 + om) * (sign === '+' ? 1 : -1);
      date = new Date(Date.UTC(y, mo, d, h, mi, se) - off * 60000);
      tz = 'UTC' + sign + pad(oh) + ':' + pad(om);
    } else {
      date = new Date(y, mo, d, h, mi, se); // brak strefy – czas lokalny
    }
    if (isNaN(date.getTime())) date = null;
    return { date: date, raw: raw, tz: tz };
  }

  /** Data w formacie PDF z przesunięciem strefy lokalnej, np. D:20261115094500+01'00' */
  function pdfDate(d) {
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
    return 'D:' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
      + sign + pad(Math.floor(a / 60)) + "'" + pad(a % 60) + "'";
  }
  /** Data ISO 8601 z lokalną strefą (dla XMP) */
  function isoDate(d) {
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
      + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }

  function lookup(doc, obj) {
    return obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  }

  /** Tekst z obiektu PDF (ciąg, nazwa, liczba, wartość logiczna). */
  function objText(o) {
    if (!o) return '';
    try {
      if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
      if (o instanceof PDFName) return o.decodeText();
      if (o instanceof PDFNumber) return String(o.asNumber());
      if (o instanceof PDFBool) return o.asBoolean() ? 'true' : 'false';
    } catch (e) { /* błędne kodowanie */ }
    return String(o.toString());
  }

  function nameKey(n) {
    try { return n.decodeText(); } catch (e) { return String(n.asString()).replace(/^\//, ''); }
  }

  function latin1(bytes, from, to) {
    var sub = bytes.subarray(from || 0, to == null ? bytes.length : to);
    return new TextDecoder('latin1').decode(sub);
  }

  function streamBytes(stream) {
    try {
      if (L.decodePDFRawStream && stream instanceof L.PDFRawStream) return L.decodePDFRawStream(stream).decode();
      if (stream.getContents) return stream.getContents();
    } catch (e) { /* nieobsługiwany filtr */ }
    return null;
  }

  function decodeXml(bytes) {
    if (!bytes) return '';
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function baseName(name) { return String(name || 'document').replace(/\.pdf$/i, ''); }

  /* ====================================================================== */
  /* Odczyt                                                                 */
  /* ====================================================================== */

  function readInfo(doc) {
    var ref = doc.context.trailerInfo.Info;
    var dict = ref ? lookup(doc, ref) : null;
    var out = { ref: ref instanceof PDFRef ? ref : null, entries: [] };
    if (!(dict instanceof PDFDict)) return out;
    dict.entries().forEach(function (e) {
      var key = nameKey(e[0]);
      var val = lookup(doc, e[1]);
      var text = objText(val);
      var item = { key: key, value: text, isString: val instanceof PDFString || val instanceof PDFHexString };
      if (DATE_KEYS[key]) item.date = parsePdfDate(text);
      out.entries.push(item);
    });
    return out;
  }

  var NS = {
    'http://purl.org/dc/elements/1.1/': 'dc',
    'http://ns.adobe.com/xap/1.0/': 'xmp',
    'http://ns.adobe.com/pdf/1.3/': 'pdf',
    'http://ns.adobe.com/xap/1.0/mm/': 'xmpMM',
    'http://ns.adobe.com/xap/1.0/rights/': 'xmpRights',
    'http://www.aiim.org/pdfa/ns/id/': 'pdfaid',
    'http://www.aiim.org/pdfua/ns/id/': 'pdfuaid',
    'http://ns.adobe.com/photoshop/1.0/': 'photoshop',
    'http://ns.adobe.com/pdfx/1.3/': 'pdfx',
    'http://www.npes.org/pdfx/ns/id/': 'pdfxid',
    'http://ns.adobe.com/xap/1.0/sType/ResourceEvent#': 'stEvt',
    'http://ns.adobe.com/xap/1.0/sType/ResourceRef#': 'stRef'
  };
  var RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

  /** Spłaszcza RDF do listy właściwości [{ name, value }]. */
  function parseXmp(xml) {
    var props = [];
    var doc;
    try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch (e) { return { props: props, error: true }; }
    if (doc.getElementsByTagName('parsererror').length) return { props: props, error: true };
    function pname(el) {
      var p = NS[el.namespaceURI] || el.prefix || '';
      return (p ? p + ':' : '') + el.localName;
    }
    function textOf(el) {
      var lis = [];
      var containers = ['Alt', 'Seq', 'Bag'];
      for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (c.namespaceURI === RDF && containers.indexOf(c.localName) !== -1) {
          for (var j = 0; j < c.children.length; j++) {
            var li = c.children[j];
            if (li.children.length) lis.push(structText(li));
            else lis.push(li.textContent.trim());
          }
          return lis.join(c.localName === 'Alt' ? ' | ' : '; ');
        }
      }
      if (el.children.length) return structText(el);
      var res = el.getAttributeNS(RDF, 'resource');
      return res || el.textContent.trim();
    }
    function structText(el) {
      var parts = [];
      for (var a = 0; a < el.attributes.length; a++) {
        var at = el.attributes[a];
        if (at.namespaceURI === RDF || /^xmlns/.test(at.name)) continue;
        parts.push(at.localName + '=' + at.value);
      }
      var holder = el;
      if (el.children.length === 1 && el.children[0].namespaceURI === RDF && el.children[0].localName === 'Description') holder = el.children[0];
      for (var i = 0; i < holder.children.length; i++) {
        var c = holder.children[i];
        if (c.namespaceURI === RDF) continue;
        parts.push(c.localName + '=' + textOf(c));
      }
      return parts.length ? '{' + parts.join(', ') + '}' : el.textContent.trim();
    }
    var descs = doc.getElementsByTagNameNS(RDF, 'Description');
    for (var i = 0; i < descs.length; i++) {
      var d = descs[i];
      // zagnieżdżone Description (struktury) obsługuje structText
      if (d.parentNode && d.parentNode.namespaceURI !== RDF) continue;
      for (var a = 0; a < d.attributes.length; a++) {
        var at = d.attributes[a];
        if (at.namespaceURI === RDF || /^xmlns/.test(at.name) || at.name === 'about') continue;
        props.push({ name: (NS[at.namespaceURI] || at.prefix || '') + ':' + at.localName, value: at.value });
      }
      for (var c = 0; c < d.children.length; c++) {
        var el = d.children[c];
        props.push({ name: pname(el), value: textOf(el) });
      }
    }
    return { props: props, error: false };
  }

  function readXmp(doc) {
    var ref = doc.catalog.get(PDFName.of('Metadata'));
    var stream = lookup(doc, ref);
    if (!(stream instanceof PDFStream)) return null;
    var bytes = streamBytes(stream);
    if (!bytes) return { ref: ref, xml: '', props: [], error: true };
    var xml = decodeXml(bytes);
    var parsed = parseXmp(xml);
    return { ref: ref instanceof PDFRef ? ref : null, xml: xml, props: parsed.props, error: parsed.error, size: bytes.length };
  }

  function xmpValue(xmp, name) {
    if (!xmp) return '';
    for (var i = 0; i < xmp.props.length; i++) if (xmp.props[i].name === name) return xmp.props[i].value;
    return '';
  }

  /** Szczegóły techniczne i elementy istotne dla prywatności. */
  function readDetails(doc, bytes, info, xmp) {
    var d = {};
    var head = latin1(bytes, 0, Math.min(bytes.length, 2048));
    var hm = /%PDF-(\d+\.\d+)/.exec(head);
    d.headerVersion = hm ? hm[1] : '';
    var cv = doc.catalog.get(PDFName.of('Version'));
    d.catalogVersion = cv ? objText(cv) : '';
    d.linearized = /\/Linearized\b/.test(head);
    var tail = latin1(bytes, Math.max(0, bytes.length - Math.min(bytes.length, 64 * 1024 * 1024)));
    d.eofCount = (tail.match(/%%EOF/g) || []).length;
    d.objStreams = /\/Type\s*\/ObjStm\b/.test(tail);
    d.encrypted = !!doc.isEncrypted;
    var enc = lookup(doc, doc.context.trailerInfo.Encrypt);
    d.encryptFilter = enc instanceof PDFDict ? objText(enc.get(PDFName.of('Filter'))) + (enc.get(PDFName.of('V')) ? ' V' + objText(enc.get(PDFName.of('V'))) : '') : '';

    // Identyfikator dokumentu z trailera
    var id = lookup(doc, doc.context.trailerInfo.ID);
    d.ids = [];
    if (id instanceof PDFArray) {
      for (var i = 0; i < id.size(); i++) {
        var o = id.get(i);
        try { d.ids.push(o instanceof PDFHexString ? o.asString() : o instanceof PDFString ? Array.prototype.map.call(o.asBytes(), function (b) { return pad16(b); }).join('') : String(o)); } catch (e) { d.ids.push(String(o)); }
      }
    }

    // Strony
    try {
      var pages = doc.getPages();
      d.pages = pages.length;
      var sizes = {};
      pages.forEach(function (p) {
        var s = p.getSize();
        var key = Math.round(s.width) + '×' + Math.round(s.height);
        sizes[key] = (sizes[key] || 0) + 1;
      });
      d.pageSizes = Object.keys(sizes).map(function (k) { return { size: k, n: sizes[k] }; }).sort(function (a, b) { return b.n - a.n; });
      if (pages[0]) {
        var s0 = pages[0].getSize();
        d.firstSize = { w: s0.width, h: s0.height, rot: pages[0].getRotation().angle };
      }
    } catch (e) { d.pages = null; }

    var cat = doc.catalog;
    var lang = cat.get(PDFName.of('Lang'));
    d.lang = lang ? objText(lookup(doc, lang)) : '';
    var mark = lookup(doc, cat.get(PDFName.of('MarkInfo')));
    d.tagged = !!(mark instanceof PDFDict && objText(mark.get(PDFName.of('Marked'))) === 'true') || !!cat.get(PDFName.of('StructTreeRoot'));
    d.pageMode = objText(cat.get(PDFName.of('PageMode')));
    d.pageLayout = objText(cat.get(PDFName.of('PageLayout')));
    d.outlines = !!cat.get(PDFName.of('Outlines'));
    var vp = lookup(doc, cat.get(PDFName.of('ViewerPreferences')));
    d.displayTitle = vp instanceof PDFDict && objText(vp.get(PDFName.of('DisplayDocTitle'))) === 'true';

    // Standardy
    var part = xmpValue(xmp, 'pdfaid:part');
    d.pdfa = part ? 'PDF/A-' + part + (xmpValue(xmp, 'pdfaid:conformance') || '').toLowerCase() : '';
    d.pdfua = xmpValue(xmp, 'pdfuaid:part') ? 'PDF/UA-' + xmpValue(xmp, 'pdfuaid:part') : '';
    var gts = info.entries.filter(function (e) { return e.key === 'GTS_PDFXVersion'; })[0];
    d.pdfx = gts ? gts.value : (xmpValue(xmp, 'pdfxid:GTS_PDFXVersion') || xmpValue(xmp, 'pdfx:GTS_PDFXVersion'));

    // Przegląd obiektów: czcionki, obrazy, osadzone XMP, podpisy, JavaScript, pliki
    d.fonts = [];
    d.images = 0;
    d.embeddedXmp = [];
    d.signatures = 0;
    d.javascript = false;
    d.pieceInfo = 0;
    var seenFonts = {};
    var catalogXmp = xmp && xmp.ref ? xmp.ref.toString() : '';
    doc.context.enumerateIndirectObjects().forEach(function (pair) {
      var ref = pair[0], obj = pair[1];
      var dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
      if (!dict) return;
      var type = objText(dict.get(PDFName.of('Type')));
      var sub = objText(dict.get(PDFName.of('Subtype')));
      if (type === 'Font' && sub !== 'Type0') {
        var bf = objText(dict.get(PDFName.of('BaseFont')));
        var fd = lookup(doc, dict.get(PDFName.of('FontDescriptor')));
        var embedded = fd instanceof PDFDict && !!(fd.get(PDFName.of('FontFile')) || fd.get(PDFName.of('FontFile2')) || fd.get(PDFName.of('FontFile3')));
        var key = bf + '|' + sub;
        if (!seenFonts[key]) { seenFonts[key] = 1; d.fonts.push({ name: bf || '—', type: sub, embedded: embedded, subset: /^[A-Z]{6}\+/.test(bf) }); }
      }
      if (sub === 'Image' && obj instanceof PDFStream) d.images++;
      if (dict.get(PDFName.of('Metadata'))) {
        var mref = dict.get(PDFName.of('Metadata'));
        if (mref && mref.toString() !== catalogXmp && dict !== doc.catalog) d.embeddedXmp.push({ owner: ref, ref: mref });
      }
      if (dict.get(PDFName.of('PieceInfo'))) d.pieceInfo++;
      if (dict.get(PDFName.of('ByteRange')) && dict.get(PDFName.of('Contents'))) d.signatures++;
      var s = dict.get(PDFName.of('S'));
      if (s && objText(s) === 'JavaScript' && dict.get(PDFName.of('JS'))) d.javascript = true;
    });
    d.fonts.sort(function (a, b) { return a.name.localeCompare(b.name); });

    // Formularze
    var acro = lookup(doc, cat.get(PDFName.of('AcroForm')));
    var fields = acro instanceof PDFDict ? lookup(doc, acro.get(PDFName.of('Fields'))) : null;
    d.formFields = fields instanceof PDFArray ? fields.size() : 0;

    // Osadzone pliki i JavaScript w drzewie nazw
    d.attachments = [];
    var names = lookup(doc, cat.get(PDFName.of('Names')));
    if (names instanceof PDFDict) {
      if (names.get(PDFName.of('JavaScript'))) d.javascript = true;
      var ef = lookup(doc, names.get(PDFName.of('EmbeddedFiles')));
      if (ef instanceof PDFDict) collectNameTree(doc, ef, d.attachments, 0);
    }
    return d;
  }

  function pad16(b) { return (b < 16 ? '0' : '') + b.toString(16).toUpperCase(); }

  function collectNameTree(doc, node, out, depth) {
    if (depth > 20 || out.length > 500) return;
    var arr = lookup(doc, node.get(PDFName.of('Names')));
    if (arr instanceof PDFArray) {
      for (var i = 0; i + 1 < arr.size(); i += 2) {
        var spec = lookup(doc, arr.get(i + 1));
        var fname = objText(lookup(doc, arr.get(i)));
        var size = null;
        if (spec instanceof PDFDict) {
          var uf = spec.get(PDFName.of('UF')) || spec.get(PDFName.of('F'));
          if (uf) fname = objText(lookup(doc, uf)) || fname;
          var efd = lookup(doc, spec.get(PDFName.of('EF')));
          var fs = efd instanceof PDFDict ? lookup(doc, efd.get(PDFName.of('F')) || efd.get(PDFName.of('UF'))) : null;
          if (fs instanceof PDFStream) {
            var params = lookup(doc, fs.dict.get(PDFName.of('Params')));
            var sz = params instanceof PDFDict ? params.get(PDFName.of('Size')) : null;
            size = sz instanceof PDFNumber ? sz.asNumber() : null;
          }
        }
        out.push({ name: fname, size: size });
      }
    }
    var kids = lookup(doc, node.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) {
      for (var k = 0; k < kids.size(); k++) {
        var kid = lookup(doc, kids.get(k));
        if (kid instanceof PDFDict) collectNameTree(doc, kid, out, depth + 1);
      }
    }
  }

  function findings(st) {
    var f = [];
    var info = st.info, d = st.details, x = st.xmp;
    var get = function (k) { var e = info.entries.filter(function (i) { return i.key === k && !i.encrypted; })[0]; return e ? e.value : ''; };
    var xs = function (n) { return xmpValue(x, n); };
    if (get('Author') || xs('dc:creator')) f.push(['user', 'warn', T('fi.author', { v: get('Author') || xs('dc:creator') })]);
    if (get('Creator') || get('Producer') || xs('xmp:CreatorTool')) f.push(['device-desktop', 'info', T('fi.software', { v: [get('Creator') || xs('xmp:CreatorTool'), get('Producer') || xs('pdf:Producer')].filter(Boolean).join(' / ') })]);
    if (get('CreationDate') || get('ModDate')) f.push(['calendar', 'info', T('fi.dates')]);
    var custom = info.entries.filter(function (e) { return STD.indexOf(e.key) === -1; });
    if (custom.length) f.push(['list', 'warn', T('fi.custom', { v: custom.map(function (e) { return e.key; }).join(', ') })]);
    if (x) {
      var hist = x.props.filter(function (p) { return p.name === 'xmpMM:History'; }).length;
      f.push(['code', hist ? 'warn' : 'info', hist ? T('fi.xmp_history') : T('fi.xmp')]);
      if (x.props.some(function (p) { return /^photoshop:|xmpMM:DerivedFrom|xmpMM:Ingredients|xmpMM:Manifest/.test(p.name); })) f.push(['photo', 'warn', T('fi.xmp_source')]);
    }
    if (d.embeddedXmp.length) f.push(['layers-subtract', 'warn', T('fi.embedded_xmp', { n: d.embeddedXmp.length })]);
    if (d.pieceInfo) f.push(['layers-subtract', 'warn', T('fi.pieceinfo', { n: d.pieceInfo })]);
    if (d.eofCount > 1 && !d.linearized || d.eofCount > 2) f.push(['history', 'warn', T('fi.incremental', { n: d.eofCount - 1 })]);
    if (d.ids.length) f.push(['fingerprint', 'info', T('fi.docid')]);
    if (d.attachments.length) f.push(['paperclip', 'warn', T('fi.attachments', { n: d.attachments.length })]);
    if (d.javascript) f.push(['code', 'danger', T('fi.javascript')]);
    if (d.signatures) f.push(['signature', 'danger', T('fi.signatures', { n: d.signatures })]);
    if (d.formFields) f.push(['forms', 'info', T('fi.forms', { n: d.formFields })]);
    return f;
  }

  /* ====================================================================== */
  /* Wczytanie pliku                                                        */
  /* ====================================================================== */

  function show(el, on) { if (el) el.hidden = !on; }

  function loadFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      App.toast(T('not_pdf'), 'error');
      return;
    }
    show($('[data-drop]'), false);
    show($('[data-result]'), false);
    show($('[data-loading]'), true);
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (latin1(bytes, 0, Math.min(1024, bytes.length)).indexOf('%PDF-') === -1) throw new Error(T('not_pdf'));
      return parse(bytes).then(function (st) {
        st.file = { name: file.name, size: file.size, lastModified: file.lastModified ? new Date(file.lastModified) : null };
        state = st;
        render();
      });
    }).catch(function (err) {
      show($('[data-loading]'), false);
      show($('[data-drop]'), true);
      App.toast(T('read_error') + ' ' + (err && err.message ? err.message : ''), 'error', null, 8000);
    });
  }

  function parse(bytes) {
    return L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false }).then(function (doc) {
      var st = { bytes: bytes, doc: doc };
      st.info = readInfo(doc);
      if (doc.isEncrypted) {
        // Ciągi w zaszyfrowanym pliku są zaszyfrowane – pokazujemy tylko nazwy wpisów
        st.info.entries.forEach(function (e) {
          if (e.isString) { e.value = T('encrypted_value'); e.date = null; e.encrypted = true; }
        });
      }
      st.xmp = readXmp(doc);
      st.details = readDetails(doc, bytes, st.info, st.xmp);
      st.findings = findings(st);
      return st;
    });
  }

  /* ====================================================================== */
  /* Widok                                                                  */
  /* ====================================================================== */

  function render() {
    var st = state, d = st.details;
    show($('[data-loading]'), false);
    show($('[data-result]'), true);
    $('[data-fname]').textContent = st.file.name;
    var meta = [fmtBytes(st.file.size)];
    if (d.pages != null) meta.push(T('pages_n', { n: d.pages }));
    meta.push('PDF ' + (d.catalogVersion || d.headerVersion));
    $('[data-fmeta]').textContent = meta.join(' · ');

    // Ostrzeżenia
    var alerts = [];
    if (d.encrypted) alerts.push(['warning', T('warn_encrypted')]);
    if (d.signatures) alerts.push(['warning', T('warn_signed', { n: d.signatures })]);
    if (st.xmp && st.xmp.error) alerts.push(['warning', T('warn_xmp_error')]);
    $('[data-alerts]').innerHTML = alerts.map(function (a) {
      return '<div class="alert alert-' + a[0] + '">' + App.icon('alert-triangle') + '<span>' + esc(a[1]) + '</span></div>';
    }).join('');

    fillForm();
    renderXmp();
    renderDetails();
    renderFindings();
    $('[data-save-status]').textContent = '';
    var form = $('[data-form]');
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name && el.name.charAt(0) !== '_' || el.matches('[data-action]') || el.type === 'submit') el.disabled = d.encrypted; });
    form.querySelector('[type=submit]').disabled = d.encrypted;
  }

  function infoMap() {
    var m = {};
    state.info.entries.forEach(function (e) { m[e.key] = e; });
    return m;
  }

  function fillForm() {
    var form = $('[data-form]');
    var m = infoMap();
    STD.forEach(function (k) {
      var el = form.elements[k];
      var e = m[k];
      var orig = $('[data-field="' + k + '"] [data-orig]');
      if (DATE_KEYS[k]) {
        el.value = e && e.date && e.date.date ? toInputValue(e.date.date) : '';
        orig.textContent = e ? T('orig', { v: e.date && e.date.date ? fmtLocal(e.date.date) + (e.date.tz ? ' (' + e.date.tz + ')' : '') : e.value }) + (e.date && e.date.raw ? ' · ' + e.date.raw : '') : T('orig_none');
      } else {
        el.value = e ? e.value : '';
        orig.textContent = e ? T('orig', { v: e.value === '' ? '""' : e.value.length > 120 ? e.value.slice(0, 120) + '…' : e.value }) : T('orig_none');
      }
      el.closest('.pdfm-field').classList.remove('changed');
    });
    var box = $('[data-custom]');
    box.innerHTML = '';
    state.info.entries.forEach(function (e) { if (STD.indexOf(e.key) === -1) addCustomRow(e.key, e.value); });
    var mode = $('[data-xmp-mode]');
    var has = !!state.xmp;
    mode.options[0].textContent = has ? T('xmp_update') : T('xmp_add');
    mode.options[1].textContent = has ? T('xmp_remove') : T('xmp_none_opt');
    mode.options[2].hidden = !has;
    mode.value = has ? 'update' : 'remove';
    updateModeHint();
    form.elements._filename.value = state.file.name;
    form.elements._moddate_now.checked = false;
    var er = $('[data-embedded-row]');
    var n = state.details.embeddedXmp.length + state.details.pieceInfo;
    show(er, n > 0);
    $('[data-embedded-label]').textContent = T('strip_embedded', { n: n });
    form.elements._strip_embedded.checked = false;
    show($('[data-id-row]'), state.details.ids.length > 0);
    form.elements._strip_id.checked = false;
  }

  function updateModeHint() {
    var v = $('[data-xmp-mode]').value;
    $('[data-xmp-mode-hint]').textContent = v === 'update' ? T('xmp_update_hint') : v === 'keep' ? T('xmp_keep_hint') : state && state.xmp ? T('xmp_remove_hint') : '';
  }

  function addCustomRow(key, value) {
    var row = document.createElement('div');
    row.className = 'pdfm-custom-row';
    row.innerHTML = '<input type="text" class="ck" placeholder="' + esc(T('custom_key')) + '" maxlength="64" pattern="[A-Za-z0-9_.\\-]{1,64}">'
      + '<input type="text" class="cv" placeholder="' + esc(T('custom_value')) + '">'
      + '<button type="button" class="btn-icon" data-remove-custom title="' + esc(App.t('common.delete')) + '">' + App.icon('trash') + '</button>';
    row.querySelector('.ck').value = key || '';
    row.querySelector('.cv').value = value || '';
    $('[data-custom]').appendChild(row);
    return row;
  }

  function renderXmp() {
    var x = state.xmp;
    $('[data-xmp-count]').textContent = x ? x.props.length : '0';
    show($('[data-xmp-empty]'), !x);
    show($('[data-xmp-content]'), !!x);
    if (!x) return;
    $('[data-xmp-props]').innerHTML = x.props.map(function (p) {
      return '<tr><td class="nowrap"><code>' + esc(p.name) + '</code></td><td class="break">' + esc(p.value) + '</td></tr>';
    }).join('') || '<tr><td colspan="2" class="muted">' + esc(T('xmp_empty_props')) + '</td></tr>';
    $('[data-xmp-raw]').value = x.xml;
  }

  function yesNo(v) { return v ? T('yes') : T('no'); }

  function renderDetails() {
    var st = state, d = st.details;
    var rows = [];
    rows.push([T('d.file'), st.file.name]);
    rows.push([T('d.size'), fmtBytes(st.file.size) + ' (' + st.file.size.toLocaleString(LANG) + ' B)']);
    if (st.file.lastModified) rows.push([T('d.file_modified'), fmtLocal(st.file.lastModified)]);
    rows.push([T('d.version'), (d.catalogVersion ? d.catalogVersion + ' (' + T('d.catalog') + '), ' + T('d.header') + ' ' + d.headerVersion : d.headerVersion) || '—']);
    if (d.pages != null) rows.push([T('d.pages'), String(d.pages)]);
    if (d.firstSize) {
      var mm = function (pt) { return (pt / 72 * 25.4).toFixed(1); };
      var fs = d.firstSize;
      rows.push([T('d.page_size'), mm(fs.w) + ' × ' + mm(fs.h) + ' mm (' + Math.round(fs.w) + ' × ' + Math.round(fs.h) + ' pt)' + (paperName(fs.w, fs.h) ? ' – ' + paperName(fs.w, fs.h) : '') + (fs.rot ? ', ' + T('d.rotation', { n: fs.rot }) : '')]);
      if (d.pageSizes.length > 1) rows.push([T('d.page_sizes'), d.pageSizes.map(function (s) { return s.size + ' pt × ' + s.n; }).join(', ')]);
    }
    rows.push([T('d.encrypted'), d.encrypted ? T('yes') + (d.encryptFilter ? ' (' + d.encryptFilter + ')' : '') : T('no')]);
    rows.push([T('d.linearized'), yesNo(d.linearized)]);
    rows.push([T('d.updates'), String(Math.max(0, d.eofCount - 1 - (d.linearized ? 1 : 0)))]);
    rows.push([T('d.objstm'), yesNo(d.objStreams)]);
    rows.push([T('d.tagged'), yesNo(d.tagged)]);
    rows.push([T('d.lang'), d.lang || '—']);
    rows.push([T('d.standards'), [d.pdfa, d.pdfua, d.pdfx].filter(Boolean).join(', ') || '—']);
    rows.push([T('d.outlines'), yesNo(d.outlines)]);
    rows.push([T('d.forms'), d.formFields ? String(d.formFields) : T('no')]);
    rows.push([T('d.signatures'), d.signatures ? String(d.signatures) : T('no')]);
    rows.push([T('d.javascript'), yesNo(d.javascript)]);
    rows.push([T('d.images'), String(d.images)]);
    rows.push([T('d.attachments'), String(d.attachments.length)]);
    if (d.pageMode) rows.push([T('d.page_mode'), d.pageMode]);
    if (d.pageLayout) rows.push([T('d.page_layout'), d.pageLayout]);
    rows.push([T('d.display_title'), yesNo(d.displayTitle)]);
    if (d.ids.length) rows.push([T('d.docid'), d.ids.join('\n')]);
    $('[data-details]').innerHTML = rows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd class="break">' + esc(r[1]).replace(/\n/g, '<br>') + '</dd>';
    }).join('');

    show($('[data-fonts-wrap]'), d.fonts.length > 0);
    $('[data-fonts-count]').textContent = d.fonts.length;
    $('[data-fonts]').innerHTML = d.fonts.map(function (f) {
      return '<tr><td class="break"><code>' + esc(f.name) + '</code></td><td>' + esc(f.type || '—') + '</td><td>'
        + (f.embedded ? '<span class="badge badge-success">' + esc(f.subset ? T('font_subset') : T('yes')) + '</span>' : '<span class="badge">' + esc(T('no')) + '</span>') + '</td></tr>';
    }).join('');
    show($('[data-attach-wrap]'), d.attachments.length > 0);
    $('[data-attachments]').innerHTML = d.attachments.map(function (a) {
      return '<li>' + App.icon('paperclip') + ' ' + esc(a.name) + (a.size != null ? ' <span class="muted small">(' + esc(fmtBytes(a.size)) + ')</span>' : '') + '</li>';
    }).join('');
  }

  function paperName(w, h) {
    var a = Math.min(w, h), b = Math.max(w, h);
    var list = [['A3', 841.89, 1190.55], ['A4', 595.28, 841.89], ['A5', 419.53, 595.28], ['Letter', 612, 792], ['Legal', 612, 1008], ['B5', 498.9, 708.66]];
    for (var i = 0; i < list.length; i++) if (Math.abs(a - list[i][1]) < 3 && Math.abs(b - list[i][2]) < 3) return list[i][0] + (w > h ? ' ' + T('d.landscape') : '');
    return '';
  }

  function renderFindings() {
    var f = state.findings;
    $('[data-privacy-count]').textContent = f.filter(function (x) { return x[1] !== 'info'; }).length || '';
    $('[data-findings]').innerHTML = f.length ? f.map(function (x) {
      return '<li class="lvl-' + x[1] + '">' + App.icon(x[0]) + '<span>' + esc(x[2]) + '</span></li>';
    }).join('') : '<li class="lvl-ok">' + App.icon('circle-check') + '<span>' + esc(T('fi.clean')) + '</span></li>';
  }

  /* ====================================================================== */
  /* Zapis                                                                  */
  /* ====================================================================== */

  function collect() {
    var form = $('[data-form]');
    var values = {};
    STD.forEach(function (k) {
      var v = form.elements[k].value;
      if (DATE_KEYS[k]) {
        values[k] = v ? new Date(v) : null;
        if (values[k] && isNaN(values[k].getTime())) values[k] = null;
      } else {
        values[k] = v.trim() === '' ? null : (k === 'Subject' ? v.replace(/\r\n/g, '\n').trim() : v.trim());
      }
    });
    var custom = [];
    var bad = null;
    $$('.pdfm-custom-row').forEach(function (row) {
      var key = row.querySelector('.ck').value.trim(), val = row.querySelector('.cv').value;
      if (!key && !val) return;
      if (!/^[A-Za-z0-9_.\-]{1,64}$/.test(key) || STD.indexOf(key) !== -1) { bad = key || '?'; return; }
      custom.push([key, val]);
    });
    return { values: values, custom: custom, bad: bad, xmpMode: form.elements._xmp.value, modNow: form.elements._moddate_now.checked, stripEmbedded: form.elements._strip_embedded.checked, stripId: form.elements._strip_id.checked, filename: form.elements._filename.value.trim() };
  }

  function xmlEsc(s) { return String(s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]; }); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /** Nowy pakiet XMP zgodny z polami Info (zachowuje identyfikację PDF/A, PDF/UA i DocumentID). */
  function buildXmp(v, oldXmp) {
    var keep = function (n) { return xmpValue(oldXmp, n); };
    var p = [];
    var alt = function (tag, val) { return '   <' + tag + '><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(val) + '</rdf:li></rdf:Alt></' + tag + '>'; };
    if (v.Title) p.push(alt('dc:title', v.Title));
    if (v.Author) p.push('   <dc:creator><rdf:Seq>' + v.Author.split(/\s*;\s*/).filter(Boolean).map(function (a) { return '<rdf:li>' + xmlEsc(a) + '</rdf:li>'; }).join('') + '</rdf:Seq></dc:creator>');
    if (v.Subject) p.push(alt('dc:description', v.Subject));
    if (v.Keywords) {
      p.push('   <pdf:Keywords>' + xmlEsc(v.Keywords) + '</pdf:Keywords>');
      p.push('   <dc:subject><rdf:Bag>' + v.Keywords.split(/\s*[,;]\s*/).filter(Boolean).map(function (k) { return '<rdf:li>' + xmlEsc(k) + '</rdf:li>'; }).join('') + '</rdf:Bag></dc:subject>');
    }
    if (v.Producer) p.push('   <pdf:Producer>' + xmlEsc(v.Producer) + '</pdf:Producer>');
    if (v.Trapped) p.push('   <pdf:Trapped>' + xmlEsc(v.Trapped) + '</pdf:Trapped>');
    if (v.Creator) p.push('   <xmp:CreatorTool>' + xmlEsc(v.Creator) + '</xmp:CreatorTool>');
    if (v.CreationDate) p.push('   <xmp:CreateDate>' + isoDate(v.CreationDate) + '</xmp:CreateDate>');
    if (v.ModDate) {
      p.push('   <xmp:ModifyDate>' + isoDate(v.ModDate) + '</xmp:ModifyDate>');
      p.push('   <xmp:MetadataDate>' + isoDate(v.ModDate) + '</xmp:MetadataDate>');
    }
    p.push('   <dc:format>application/pdf</dc:format>');
    if (keep('xmpMM:DocumentID')) p.push('   <xmpMM:DocumentID>' + xmlEsc(keep('xmpMM:DocumentID')) + '</xmpMM:DocumentID>');
    p.push('   <xmpMM:InstanceID>uuid:' + uuid() + '</xmpMM:InstanceID>');
    if (keep('pdfaid:part')) p.push('   <pdfaid:part>' + xmlEsc(keep('pdfaid:part')) + '</pdfaid:part>');
    if (keep('pdfaid:conformance')) p.push('   <pdfaid:conformance>' + xmlEsc(keep('pdfaid:conformance')) + '</pdfaid:conformance>');
    if (keep('pdfaid:amd')) p.push('   <pdfaid:amd>' + xmlEsc(keep('pdfaid:amd')) + '</pdfaid:amd>');
    if (keep('pdfuaid:part')) p.push('   <pdfuaid:part>' + xmlEsc(keep('pdfuaid:part')) + '</pdfuaid:part>');
    var xml = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
      + '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
      + '  <rdf:Description rdf:about=""\n    xmlns:dc="http://purl.org/dc/elements/1.1/"\n    xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n'
      + '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"\n    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"\n'
      + '    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"\n    xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">\n'
      + p.join('\n') + '\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n';
    // wypełnienie pozwalające na późniejszą edycję w miejscu (zalecenie XMP)
    for (var i = 0; i < 20; i++) xml += '                                                                                                    \n';
    return xml + '<?xpacket end="w"?>';
  }

  function setXmpStream(doc, xml, oldRef) {
    var bytes = new TextEncoder().encode(xml);
    var stream = doc.context.stream(bytes, { Type: 'Metadata', Subtype: 'XML', Length: bytes.length });
    if (oldRef instanceof PDFRef) {
      doc.context.assign(oldRef, stream);
      doc.catalog.set(PDFName.of('Metadata'), oldRef);
    } else {
      doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    }
  }

  /** pdf-lib zawsze zapisuje nagłówek %PDF-1.7 – przywracamy wersję oryginału (ta sama długość, offsety bez zmian). */
  function keepHeaderVersion(out, version, min) {
    if (!/^\d\.\d$/.test(version || '')) return out;
    if (parseFloat(version) < parseFloat(min)) version = min;
    if (latin1(out, 0, 8) !== '%PDF-1.7' || version === '1.7') return out;
    out[5] = version.charCodeAt(0); out[7] = version.charCodeAt(2);
    return out;
  }

  function removeRef(doc, ref) {
    if (ref instanceof PDFRef) { try { doc.context.delete(ref); } catch (e) { /* już usunięty */ } }
  }

  function save(e) {
    if (e) e.preventDefault();
    if (!state || state.details.encrypted) return;
    var c = collect();
    if (c.bad) { App.toast(T('custom_bad', { k: c.bad }), 'error'); return; }
    var go = state.details.signatures ? App.confirm(T('confirm_signed')) : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var btn = $('[data-form] [type=submit]');
      btn.disabled = true;
      $('[data-save-status]').textContent = T('saving');
      // Zapis zawsze na świeżo wczytanej kopii (bez zmian pozostawionych przez poprzedni zapis)
      L.PDFDocument.load(state.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false }).then(function (doc) {
        var v = c.values;
        if (c.modNow) v.ModDate = new Date();
        // Słownik Info – budowany od nowa (usuwa wszystkie stare wpisy)
        var oldInfoRef = doc.context.trailerInfo.Info;
        var dict = doc.context.obj({});
        STD.forEach(function (k) {
          var val = v[k];
          if (val == null) return;
          if (DATE_KEYS[k]) dict.set(PDFName.of(k), PDFString.of(pdfDate(val)));
          else if (k === 'Trapped') dict.set(PDFName.of(k), PDFName.of(val));
          else dict.set(PDFName.of(k), PDFHexString.fromText(val));
        });
        c.custom.forEach(function (kv) { dict.set(PDFName.of(kv[0]), PDFHexString.fromText(kv[1])); });
        if (dict.entries().length) {
          if (oldInfoRef instanceof PDFRef) { doc.context.assign(oldInfoRef, dict); doc.context.trailerInfo.Info = oldInfoRef; }
          else doc.context.trailerInfo.Info = doc.context.register(dict);
        } else {
          removeRef(doc, oldInfoRef);
          doc.context.trailerInfo.Info = undefined;
        }
        // XMP dokumentu
        var xref = doc.catalog.get(PDFName.of('Metadata'));
        if (c.xmpMode === 'update') setXmpStream(doc, buildXmp(v, state.xmp), xref);
        else if (c.xmpMode === 'remove') { doc.catalog.delete(PDFName.of('Metadata')); removeRef(doc, xref); }
        // XMP i dane prywatne aplikacji w stronach i obrazach
        if (c.stripEmbedded) {
          var catRef = xref ? xref.toString() : '';
          doc.context.enumerateIndirectObjects().forEach(function (pair) {
            var obj = pair[1];
            var d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
            if (!d || d === doc.catalog) return;
            var m = d.get(PDFName.of('Metadata'));
            if (m && m.toString() !== catRef) { d.delete(PDFName.of('Metadata')); removeRef(doc, m); }
            if (d.get(PDFName.of('PieceInfo'))) { var pi = d.get(PDFName.of('PieceInfo')); d.delete(PDFName.of('PieceInfo')); removeRef(doc, pi); }
          });
        }
        if (c.stripId) doc.context.trailerInfo.ID = undefined;
        var pdfa1 = xmpValue(state.xmp, 'pdfaid:part') === '1';
        var hasXmp = c.xmpMode === 'update' || c.xmpMode === 'keep' && !!state.xmp;
        return doc.save({ useObjectStreams: state.details.objStreams && !pdfa1, addDefaultPage: false, updateFieldAppearances: false }).then(function (out) {
          return keepHeaderVersion(out, state.details.headerVersion, hasXmp ? '1.4' : '1.0');
        });
      }).then(function (out) {
        if (!out) return;
        var name = (c.filename || state.file.name).replace(/[\\/:*?"<>|]+/g, '_');
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        download(new Blob([out], { type: 'application/pdf' }), name);
        $('[data-save-status]').textContent = T('saved', { size: fmtBytes(out.length), name: name });
        App.toast(T('saved_toast'), 'success');
        // Weryfikacja: ponowny odczyt zapisanego pliku
        return parse(out).then(function (st2) {
          st2.file = { name: name, size: out.length, lastModified: new Date() };
          state = st2;
          render();
          $('[data-save-status]').textContent = T('saved', { size: fmtBytes(out.length), name: name }) + ' ' + T('saved_now_showing');
        });
      }).catch(function (err) {
        $('[data-save-status]').textContent = '';
        App.toast(T('save_error') + ' ' + (err && err.message ? err.message : ''), 'error', null, 8000);
      }).then(function () { btn.disabled = false; });
    });
  }

  function stripAll() {
    if (!state || state.details.encrypted) return;
    var form = $('[data-form]');
    STD.forEach(function (k) { form.elements[k].value = ''; markChanged(k); });
    $('[data-custom]').innerHTML = '';
    form.elements._xmp.value = 'remove';
    form.elements._moddate_now.checked = false;
    form.elements._strip_embedded.checked = true;
    form.elements._strip_id.checked = !state.details.pdfa;
    updateModeHint();
    switchTab('edit');
    App.toast(T('stripped_hint'), 'info', null, 6000);
  }

  function markChanged(k) {
    var m = infoMap();
    var form = $('[data-form]');
    var el = form.elements[k];
    var orig = m[k] ? (DATE_KEYS[k] ? (m[k].date && m[k].date.date ? toInputValue(m[k].date.date) : '') : m[k].value) : '';
    el.closest('.pdfm-field').classList.toggle('changed', el.value !== orig);
  }

  /* ====================================================================== */
  /* Eksport                                                                */
  /* ====================================================================== */

  function exportData() {
    var st = state, d = st.details;
    var info = {};
    st.info.entries.forEach(function (e) { info[e.key] = e.date && e.date.date ? { raw: e.value, iso: e.date.date.toISOString() } : e.value; });
    var xmp = null;
    if (st.xmp) { xmp = {}; st.xmp.props.forEach(function (p) { xmp[p.name] = p.value; }); }
    return {
      file: { name: st.file.name, size: st.file.size, lastModified: st.file.lastModified ? st.file.lastModified.toISOString() : null },
      info: info,
      xmp: xmp,
      xmpRaw: st.xmp ? st.xmp.xml : null,
      details: {
        pdfVersion: d.catalogVersion || d.headerVersion, headerVersion: d.headerVersion, pages: d.pages, firstPageSizePt: d.firstSize,
        pageSizes: d.pageSizes, encrypted: d.encrypted, encryption: d.encryptFilter || null, linearized: d.linearized,
        incrementalUpdates: Math.max(0, d.eofCount - 1 - (d.linearized ? 1 : 0)), objectStreams: d.objStreams, tagged: d.tagged,
        language: d.lang || null, pdfa: d.pdfa || null, pdfua: d.pdfua || null, pdfx: d.pdfx || null, outlines: d.outlines,
        formFields: d.formFields, signatures: d.signatures, javascript: d.javascript, images: d.images,
        attachments: d.attachments, fonts: d.fonts, documentId: d.ids, embeddedXmp: d.embeddedXmp.length, pieceInfo: d.pieceInfo
      },
      generated: new Date().toISOString()
    };
  }

  function exportText() {
    var x = exportData();
    var lines = [T('export_header', { name: x.file.name }), ''];
    lines.push('[Info]');
    Object.keys(x.info).forEach(function (k) { var v = x.info[k]; lines.push(k + ': ' + (typeof v === 'object' ? v.raw + ' (' + v.iso + ')' : v)); });
    if (x.xmp) {
      lines.push('', '[XMP]');
      Object.keys(x.xmp).forEach(function (k) { lines.push(k + ': ' + x.xmp[k]); });
    }
    lines.push('', '[' + T('tab_details') + ']');
    $$('[data-details] dt').forEach(function (dt) { lines.push(dt.textContent + ': ' + dt.nextElementSibling.innerText.replace(/\n/g, ', ')); });
    if (x.details.fonts.length) {
      lines.push('', '[' + T('fonts') + ']');
      x.details.fonts.forEach(function (f) { lines.push(f.name + ' (' + f.type + ')' + (f.embedded ? ' – ' + T('font_embedded') : '')); });
    }
    return lines.join('\r\n') + '\r\n';
  }

  /* ====================================================================== */
  /* Zdarzenia                                                              */
  /* ====================================================================== */

  function switchTab(name) {
    $$('[data-tab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
  }

  var input = $('[data-file]');
  input.addEventListener('change', function () { loadFile(input.files[0]); input.value = ''; });

  var drop = $('[data-drop]');
  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') === -1) return;
      e.preventDefault();
      drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (ev === 'dragleave' && e.relatedTarget) return;
      drop.classList.remove('over');
    });
  });
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  root.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) { switchTab(tab.getAttribute('data-tab')); return; }
    var clr = e.target.closest('[data-clear]');
    if (clr) {
      var k = clr.getAttribute('data-clear');
      var el = $('[data-form]').elements[k];
      el.value = '';
      markChanged(k);
      el.focus();
      return;
    }
    if (e.target.closest('[data-remove-custom]')) { e.target.closest('.pdfm-custom-row').remove(); return; }
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.getAttribute('data-action');
    if (act === 'another') input.click();
    else if (act === 'add-custom') addCustomRow('', '').querySelector('.ck').focus();
    else if (act === 'strip' || act === 'strip-go') stripAll();
    else if (act === 'reset') { fillForm(); App.toast(T('reset_done'), 'info'); }
    else if (act === 'json') download(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }), baseName(state.file.name) + '-metadata.json');
    else if (act === 'copy-json') App.copyText(JSON.stringify(exportData(), null, 2)).then(function () { App.toast(App.t('common.copied'), 'success'); });
    else if (act === 'txt') download(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }), baseName(state.file.name) + '-metadata.txt');
    else if (act === 'xmp-download' && state.xmp) download(new Blob([state.xmp.xml], { type: 'application/xml' }), baseName(state.file.name) + '-xmp.xml');
  });

  var form = $('[data-form]');
  form.addEventListener('submit', save);
  form.addEventListener('input', function (e) { if (STD.indexOf(e.target.name) !== -1) markChanged(e.target.name); });
  form.addEventListener('change', function (e) {
    if (STD.indexOf(e.target.name) !== -1) markChanged(e.target.name);
    if (e.target.matches('[data-xmp-mode]')) updateModeHint();
  });
})();
