/*
 * tools-php – narzędzie „Historia zmian i komentarze PDF” (MIT)
 * Wszystko w przeglądarce (pdf-lib, MIT) – plik nie jest wysyłany na serwer.
 *  - komentarze (adnotacje) z autorami, datami, odpowiedziami i statusami recenzji,
 *  - wersje dokumentu zapisane przyrostowo (każdą można pobrać i porównać z poprzednią),
 *  - podpisy cyfrowe (która wersja jest podpisana, czy po podpisaniu coś zmieniono),
 *  - historia zmian zapisana w metadanych XMP.
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-pdfr]');
  if (!root || !window.PDFLib || !window.ToolKit) return;

  var L = window.PDFLib, K = window.ToolKit;
  var PDFName = L.PDFName, PDFString = L.PDFString, PDFHexString = L.PDFHexString, PDFDict = L.PDFDict, PDFArray = L.PDFArray,
    PDFRef = L.PDFRef, PDFNumber = L.PDFNumber, PDFStream = L.PDFStream;
  var T = function (k, p) { return App.t('tool.pdf-review.' + k, p); };
  var $ = function (s) { return root.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
  var esc = App.esc, fmtBytes = K.fmtBytes, fmtLocal = K.fmtLocal, pad = K.pad;
  var LOAD = { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false };
  var MAX_VERSIONS = 60;

  // Typy adnotacji traktowane jako komentarze/oznaczenia recenzenta
  var COMMENT = ['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly',
    'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound', 'Redact'];
  var state = null;

  /* ---------------------------------------------------------------------- */
  /* Pomocnicze                                                             */
  /* ---------------------------------------------------------------------- */

  function show(el, on) { if (el) el.hidden = !on; }
  function look(doc, o) { return o instanceof PDFRef ? doc.context.lookup(o) : o; }
  function str(doc, o) {
    o = look(doc, o);
    if (!o) return '';
    try {
      if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
      if (o instanceof PDFName) return o.decodeText();
      if (o instanceof PDFNumber) return String(o.asNumber());
      if (o instanceof PDFStream) return new TextDecoder('utf-8').decode(L.decodePDFRawStream(o).decode());
    } catch (e) { /* błędne kodowanie */ }
    return String(o.toString());
  }
  function pdfDate(s) {
    var m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([Zz+\-])?\s*(\d{2})?'?(\d{2})?/.exec(String(s || '').trim());
    if (!m) return null;
    var d, Y = +m[1], M = m[2] ? +m[2] - 1 : 0, D = m[3] ? +m[3] : 1, h = +(m[4] || 0), mi = +(m[5] || 0), se = +(m[6] || 0);
    if (m[7] === '+' || m[7] === '-') d = new Date(Date.UTC(Y, M, D, h, mi, se) - ((+(m[8] || 0)) * 60 + (+(m[9] || 0))) * (m[7] === '+' ? 1 : -1) * 60000);
    else if (m[7]) d = new Date(Date.UTC(Y, M, D, h, mi, se));
    else d = new Date(Y, M, D, h, mi, se);
    return K.validDate(d) ? d : null;
  }
  function fmtDate(d) { return d ? fmtLocal(d) : '—'; }
  function stripRich(s) { return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(); }
  /** Szybki skrót (FNV-1a) bajtów – do porównania treści stron między wersjami. */
  function hash(parts) {
    var h = 0x811c9dc5;
    parts.forEach(function (b) { for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } h ^= 0xff; });
    return (h >>> 0).toString(16);
  }
  function color(doc, d) {
    var c = look(doc, d.get(PDFName.of('C')));
    if (!(c instanceof PDFArray) || c.size() !== 3) return '';
    var v = [0, 1, 2].map(function (i) { var n = look(doc, c.get(i)); return Math.round(Math.max(0, Math.min(1, n instanceof PDFNumber ? n.asNumber() : 0)) * 255); });
    return 'rgb(' + v.join(',') + ')';
  }

  /* ---------------------------------------------------------------------- */
  /* Komentarze                                                             */
  /* ---------------------------------------------------------------------- */

  function readComments(doc) {
    var out = [], other = { Link: 0, Widget: 0, Popup: 0, other: 0 };
    var pages;
    try { pages = doc.getPages(); } catch (e) { pages = []; }
    pages.forEach(function (page, pi) {
      var annots = look(doc, page.node.get(PDFName.of('Annots')));
      if (!(annots instanceof PDFArray)) return;
      for (var i = 0; i < annots.size(); i++) {
        var ref = annots.get(i), d = look(doc, ref);
        if (!(d instanceof PDFDict)) continue;
        var sub = str(doc, d.get(PDFName.of('Subtype')));
        if (COMMENT.indexOf(sub) === -1) { if (other[sub] != null) other[sub]++; else other.other++; continue; }
        var irt = d.get(PDFName.of('IRT'));
        var c = {
          key: ref instanceof PDFRef ? ref.toString() : 'p' + pi + 'i' + i,
          page: pi + 1, type: sub,
          author: str(doc, d.get(PDFName.of('T'))),
          subject: str(doc, d.get(PDFName.of('Subj'))),
          text: str(doc, d.get(PDFName.of('Contents'))) || stripRich(str(doc, d.get(PDFName.of('RC')))),
          modified: pdfDate(str(doc, d.get(PDFName.of('M')))),
          created: pdfDate(str(doc, d.get(PDFName.of('CreationDate')))),
          irt: irt instanceof PDFRef ? irt.toString() : '',
          replyType: str(doc, d.get(PDFName.of('RT'))),
          state: str(doc, d.get(PDFName.of('State'))),
          stateModel: str(doc, d.get(PDFName.of('StateModel'))),
          icon: str(doc, d.get(PDFName.of('Name'))),
          color: color(doc, d),
          file: ''
        };
        if (sub === 'FileAttachment') {
          var fs = look(doc, d.get(PDFName.of('FS')));
          if (fs instanceof PDFDict) c.file = str(doc, fs.get(PDFName.of('UF')) || fs.get(PDFName.of('F')));
        }
        c.date = c.modified || c.created;
        c.sig = c.author + '|' + c.text + '|' + (c.date ? c.date.getTime() : '') + '|' + c.state;
        out.push(c);
      }
    });
    // Wątki: odpowiedzi i zmiany statusu przypinamy do komentarza nadrzędnego
    var byKey = {};
    out.forEach(function (c) { byKey[c.key] = c; c.replies = []; });
    out.forEach(function (c) { if (c.irt && byKey[c.irt] && c.irt !== c.key) { c.parent = byKey[c.irt]; byKey[c.irt].replies.push(c); } });
    out.forEach(function (c) {
      var p = c.parent, guard = 0;
      while (p && p.parent && guard++ < 50) p = p.parent;
      c.top = c.parent ? p : null;
    });
    return { list: out, other: other };
  }

  /* ---------------------------------------------------------------------- */
  /* Wersje (aktualizacje przyrostowe)                                      */
  /* ---------------------------------------------------------------------- */

  function findEofs(bytes) {
    var s = K.latin1(bytes), out = [], re = /%%EOF/g, m;
    while ((m = re.exec(s))) {
      var end = m.index + 5;
      if (s.charCodeAt(end) === 13) end++;
      if (s.charCodeAt(end) === 10) end++;
      out.push(end);
    }
    if (out.length && out[out.length - 1] < bytes.length && /^\s*$/.test(s.slice(out[out.length - 1]))) out[out.length - 1] = bytes.length;
    if (!out.length) out.push(bytes.length);
    var linearized = /\/Linearized\b/.test(s.slice(0, 1024));
    if (linearized && out.length > 1) out.shift(); // pierwszy %%EOF należy do sekcji linearyzacji
    return { ends: out, linearized: linearized, text: s };
  }

  function snapshot(doc) {
    var snap = { pages: 0, hashes: [], comments: {}, info: {} };
    try {
      var pages = doc.getPages();
      snap.pages = pages.length;
      pages.forEach(function (p) {
        var c = look(doc, p.node.get(PDFName.of('Contents'))), parts = [];
        var add = function (o) { o = look(doc, o); if (o instanceof PDFStream && o.getContents) parts.push(o.getContents()); };
        if (c instanceof PDFArray) for (var i = 0; i < c.size(); i++) add(c.get(i)); else add(c);
        var mb = p.node.get(PDFName.of('MediaBox'));
        parts.push(K.utf8e.encode(String(mb) + '|' + p.getRotation().angle));
        snap.hashes.push(hash(parts));
      });
    } catch (e) { snap.error = true; }
    readComments(doc).list.forEach(function (c) { snap.comments[c.key] = c; });
    var infoRef = doc.context.trailerInfo.Info, info = look(doc, infoRef);
    if (info instanceof PDFDict) ['ModDate', 'CreationDate', 'Producer', 'Creator', 'Author', 'Title'].forEach(function (k) { snap.info[k] = str(doc, info.get(PDFName.of(k))); });
    return snap;
  }

  function analyzeVersions(bytes, onProgress) {
    var eo = findEofs(bytes), ends = eo.ends.slice(-MAX_VERSIONS), versions = [];
    var skipped = eo.ends.length - ends.length;
    var chain = Promise.resolve();
    ends.forEach(function (end, idx) {
      chain = chain.then(function () {
        onProgress(idx + 1, ends.length);
        var prevEnd = idx > 0 ? ends[idx - 1] : (skipped ? eo.ends[skipped - 1] : 0);
        var seg = eo.text.slice(prevEnd, end);
        var v = { n: idx + 1 + skipped, start: prevEnd, end: end, size: end - prevEnd, objects: (seg.match(/\d+\s+\d+\s+obj\b/g) || []).length, xrefStream: /\/Type\s*\/XRef\b/.test(seg) };
        versions.push(v);
        var prefix = end === bytes.length ? bytes : bytes.slice(0, end);
        return L.PDFDocument.load(prefix, LOAD).then(function (d) { v.snap = snapshot(d); }).catch(function () { v.error = true; });
      });
    });
    return chain.then(function () {
      versions.forEach(function (v, i) {
        var p = i > 0 ? versions[i - 1] : null;
        v.changes = { pagesChanged: [], pagesAdded: 0, pagesRemoved: 0, added: [], removed: [], modified: [] };
        if (!v.snap || !p || !p.snap) return;
        var a = p.snap, b = v.snap;
        for (var k = 0; k < Math.min(a.hashes.length, b.hashes.length); k++) if (a.hashes[k] !== b.hashes[k]) v.changes.pagesChanged.push(k + 1);
        if (b.pages > a.pages) v.changes.pagesAdded = b.pages - a.pages;
        if (b.pages < a.pages) v.changes.pagesRemoved = a.pages - b.pages;
        Object.keys(b.comments).forEach(function (key) {
          if (!a.comments[key]) v.changes.added.push(b.comments[key]);
          else if (a.comments[key].sig !== b.comments[key].sig) v.changes.modified.push(b.comments[key]);
        });
        Object.keys(a.comments).forEach(function (key) { if (!b.comments[key]) v.changes.removed.push(a.comments[key]); });
        v.infoChanged = ['Title', 'Author', 'Creator', 'Producer', 'ModDate'].filter(function (k) { return (a.info[k] || '') !== (b.info[k] || ''); })
          .map(function (k) { return { key: k, from: a.info[k] || '', to: b.info[k] || '' }; });
      });
      return { versions: versions, linearized: eo.linearized, skipped: skipped };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Podpisy                                                                */
  /* ---------------------------------------------------------------------- */

  /** Nazwy (CN) z certyfikatów w podpisie PKCS#7 – proste przeszukanie DER. */
  function certNames(bytes) {
    var out = [];
    for (var i = 0; i + 7 < bytes.length; i++) {
      if (bytes[i] === 0x06 && bytes[i + 1] === 0x03 && bytes[i + 2] === 0x55 && bytes[i + 3] === 0x04 && (bytes[i + 4] === 0x03 || bytes[i + 4] === 0x0A)) {
        var tag = bytes[i + 5], len = bytes[i + 6];
        if ([0x0C, 0x13, 0x14, 0x16, 0x1E].indexOf(tag) !== -1 && len < 128 && i + 7 + len <= bytes.length) {
          var raw = bytes.subarray(i + 7, i + 7 + len), s;
          if (tag === 0x1E) { s = ''; for (var k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k] << 8) | raw[k + 1]); }
          else s = new TextDecoder(tag === 0x0C ? 'utf-8' : 'latin1').decode(raw);
          var label = (bytes[i + 4] === 0x03 ? 'CN=' : 'O=') + s;
          if (out.indexOf(label) === -1) out.push(label);
        }
      }
    }
    return out;
  }

  function readSignatures(doc, versions, fileLen) {
    var out = [], acro = look(doc, doc.catalog.get(PDFName.of('AcroForm')));
    if (!(acro instanceof PDFDict)) return out;
    var walk = function (arr, depth) {
      arr = look(doc, arr);
      if (!(arr instanceof PDFArray) || depth > 20) return;
      for (var i = 0; i < arr.size(); i++) {
        var f = look(doc, arr.get(i));
        if (!(f instanceof PDFDict)) continue;
        if (str(doc, f.get(PDFName.of('FT'))) === 'Sig') {
          var v = look(doc, f.get(PDFName.of('V')));
          var s = { field: str(doc, f.get(PDFName.of('T'))), signed: v instanceof PDFDict };
          if (s.signed) {
            s.name = str(doc, v.get(PDFName.of('Name')));
            s.date = pdfDate(str(doc, v.get(PDFName.of('M'))));
            s.reason = str(doc, v.get(PDFName.of('Reason')));
            s.location = str(doc, v.get(PDFName.of('Location')));
            s.contact = str(doc, v.get(PDFName.of('ContactInfo')));
            s.filter = str(doc, v.get(PDFName.of('Filter'))) + (v.get(PDFName.of('SubFilter')) ? ' / ' + str(doc, v.get(PDFName.of('SubFilter'))) : '');
            var br = look(doc, v.get(PDFName.of('ByteRange')));
            if (br instanceof PDFArray && br.size() === 4) {
              var n = function (k) { var x = look(doc, br.get(k)); return x instanceof PDFNumber ? x.asNumber() : 0; };
              s.covered = n(2) + n(3);
              s.after = fileLen - s.covered;
              var vi = -1;
              versions.forEach(function (ver, k) { if (Math.abs(ver.end - s.covered) <= 2) vi = k; });
              s.version = vi >= 0 ? versions[vi].n : null;
              s.laterVersions = vi >= 0 ? versions.length - 1 - vi : null;
            }
            var ref = look(doc, v.get(PDFName.of('Reference')));
            if (ref instanceof PDFArray) for (var r = 0; r < ref.size(); r++) {
              var rd = look(doc, ref.get(r));
              if (rd instanceof PDFDict && str(doc, rd.get(PDFName.of('TransformMethod'))) === 'DocMDP') s.certify = true;
            }
            var cont = v.get(PDFName.of('Contents'));
            try { s.certs = cont ? certNames(cont instanceof PDFHexString ? hexBytes(cont.asString()) : cont.asBytes()) : []; } catch (e) { s.certs = []; }
          }
          out.push(s);
        }
        if (f.get(PDFName.of('Kids'))) walk(f.get(PDFName.of('Kids')), depth + 1);
      }
    };
    walk(acro.get(PDFName.of('Fields')), 0);
    return out;
  }
  function hexBytes(h) { h = h.replace(/[^0-9a-f]/gi, ''); var b = new Uint8Array(h.length >> 1); for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; }

  /* ---------------------------------------------------------------------- */
  /* Historia XMP                                                           */
  /* ---------------------------------------------------------------------- */

  function readXmpHistory(doc) {
    var ms = look(doc, doc.catalog.get(PDFName.of('Metadata')));
    if (!(ms instanceof PDFStream)) return [];
    var xml = str(doc, ms), out = [];
    try {
      var d = new DOMParser().parseFromString(xml, 'application/xml');
      var ST = 'http://ns.adobe.com/xap/1.0/sType/ResourceEvent#', RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
      var hist = d.getElementsByTagNameNS('http://ns.adobe.com/xap/1.0/mm/', 'History');
      for (var h = 0; h < hist.length; h++) {
        var lis = hist[h].getElementsByTagNameNS(RDF, 'li');
        for (var i = 0; i < lis.length; i++) {
          var li = lis[i], g = function (n) {
            var a = li.getAttributeNS(ST, n);
            if (a) return a;
            var e = li.getElementsByTagNameNS(ST, n)[0];
            return e ? e.textContent.trim() : '';
          };
          out.push({ action: g('action'), when: g('when'), agent: g('softwareAgent'), changed: g('changed'), params: g('parameters') });
        }
      }
    } catch (e) { /* uszkodzony XMP */ }
    return out;
  }

  /* ---------------------------------------------------------------------- */
  /* Wczytanie                                                              */
  /* ---------------------------------------------------------------------- */

  function loadFile(file) {
    if (!file) return;
    show($('[data-drop]'), false); show($('[data-result]'), false); show($('[data-loading]'), true);
    $('[data-loading-text]').textContent = T('reading');
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (K.latin1(bytes, 0, Math.min(1024, bytes.length)).indexOf('%PDF-') === -1) { var e = new Error(T('not_pdf')); throw e; }
      return L.PDFDocument.load(bytes, LOAD).then(function (doc) {
        var st = { file: { name: file.name, size: file.size }, bytes: bytes, doc: doc };
        var cm = readComments(doc);
        st.comments = cm.list; st.other = cm.other;
        st.xmp = readXmpHistory(doc);
        st.encrypted = doc.isEncrypted;
        st.objStm = /\/Type\s*\/ObjStm\b/.test(K.latin1(bytes));
        st.header = (/%PDF-(\d\.\d)/.exec(K.latin1(bytes, 0, 1024)) || [])[1] || '';
        return analyzeVersions(bytes, function (i, n) { $('[data-loading-text]').textContent = T('reading_versions', { i: i, n: n }); }).then(function (vr) {
          st.versions = vr.versions; st.linearized = vr.linearized; st.skipped = vr.skipped;
          st.signatures = readSignatures(doc, st.versions, bytes.length);
          state = st;
          render();
        });
      });
    }).catch(function (err) {
      state = null;
      show($('[data-loading]'), false); show($('[data-drop]'), true);
      App.toast(T('read_error') + ' ' + (err && err.message ? err.message : ''), 'error', null, 9000);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Widok                                                                  */
  /* ---------------------------------------------------------------------- */

  function typeName(t) { var k = 'at.' + t, s = T(k); return s === 'tool.pdf-review.' + k ? t : s; }
  function stateName(s) { var k = 'state.' + s, x = T(k); return x === 'tool.pdf-review.' + k ? s : x; }

  function render() {
    var st = state;
    show($('[data-loading]'), false); show($('[data-result]'), true);
    $('[data-fname]').textContent = st.file.name;
    var pages = st.versions.length && st.versions[st.versions.length - 1].snap ? st.versions[st.versions.length - 1].snap.pages : '?';
    $('[data-fmeta]').textContent = [fmtBytes(st.file.size), T('pages_n', { n: pages }), 'PDF ' + st.header].join(' · ');
    var authors = K.countBy(st.comments.map(function (c) { return c.author || T('no_author'); }));
    var signedOk = st.signatures.filter(function (s) { return s.signed; });
    var modifiedAfter = signedOk.some(function (s) { return s.laterVersions > 0 || s.after > 2; });
    var stats = [
      ['messages', st.comments.length, T('stat_comments'), st.comments.length ? 'warn' : ''],
      ['users', Object.keys(authors).length, T('stat_authors'), ''],
      ['history', st.versions.length, T('stat_versions'), st.versions.length > 1 ? 'warn' : ''],
      ['signature', signedOk.length, T('stat_signatures'), modifiedAfter ? 'danger' : '']
    ];
    $('[data-stats]').innerHTML = stats.map(function (s) {
      return '<div class="card rev-stat ' + s[3] + '"><span class="stat-ic">' + App.icon(s[0]) + '</span><div><div class="stat-val">' + s[1] + '</div><div class="muted small">' + esc(s[2]) + '</div></div></div>';
    }).join('');
    var alerts = [];
    if (st.encrypted) alerts.push(['warning', T('warn_encrypted')]);
    if (st.versions.length > 1) alerts.push(['warning', T('warn_versions', { n: st.versions.length - 1 })]);
    if (modifiedAfter) alerts.push(['error', T('warn_modified_after_sign')]);
    if (st.skipped) alerts.push(['info', T('warn_many_versions', { n: MAX_VERSIONS })]);
    $('[data-alerts]').innerHTML = alerts.map(function (a) { return '<div class="alert alert-' + a[0] + '">' + App.icon(a[0] === 'info' ? 'info-circle' : 'alert-triangle') + '<span>' + esc(a[1]) + '</span></div>'; }).join('');
    $('[data-count-comments]').textContent = st.comments.length;
    $('[data-count-versions]').textContent = st.versions.length;
    $('[data-count-signatures]').textContent = signedOk.length || '';

    // Filtry
    var types = K.countBy(st.comments.map(function (c) { return c.type; }));
    $('[data-f-type]').innerHTML = '<option value="">' + esc(T('all_types')) + '</option>' + Object.keys(types).map(function (t) { return '<option value="' + esc(t) + '">' + esc(typeName(t)) + ' (' + types[t] + ')</option>'; }).join('');
    $('[data-f-author]').innerHTML = '<option value="">' + esc(T('all_authors')) + '</option>' + Object.keys(authors).map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + ' (' + authors[a] + ')</option>'; }).join('');
    $('[data-q]').value = '';
    renderComments();
    var o = st.other, otherTxt = [];
    if (o.Link) otherTxt.push(T('other.links', { n: o.Link }));
    if (o.Widget) otherTxt.push(T('other.widgets', { n: o.Widget }));
    if (o.other) otherTxt.push(T('other.other', { n: o.other }));
    $('[data-other-annots]').textContent = otherTxt.length ? T('other_intro') + ' ' + otherTxt.join(', ') + '.' : '';
    renderVersions();
    renderSignatures();
    var form = $('[data-form]');
    form.elements._filename.value = st.file.name.replace(/\.pdf$/i, '') + '-' + T('suffix') + '.pdf';
    form.elements._remove.checked = false; form.elements._anon.checked = false;
    $('[data-save-status]').textContent = '';
    form.querySelector('[type=submit]').disabled = st.encrypted;
  }

  function commentHtml(c, isReply) {
    var head = [];
    if (!isReply) head.push('<span class="badge">' + esc(T('page_n', { n: c.page })) + '</span>');
    head.push('<span class="badge">' + (c.color ? '<span class="rev-dot" style="background:' + c.color + '"></span> ' : '') + esc(typeName(c.type)) + '</span>');
    if (c.state) head.push('<span class="badge badge-state">' + esc(T('state_set', { s: stateName(c.state) })) + '</span>');
    head.push('<strong>' + esc(c.author || T('no_author')) + '</strong>');
    head.push('<span class="muted">' + esc(fmtDate(c.date)) + (c.created && c.modified && Math.abs(c.created - c.modified) > 60000 ? ' · ' + esc(T('created_at', { d: fmtDate(c.created) })) : '') + '</span>');
    var body = '';
    if (c.subject && c.subject !== c.type) body += '<div class="muted small">' + esc(T('subject', { s: c.subject })) + '</div>';
    if (c.text) body += '<div class="rev-text">' + esc(c.text) + '</div>';
    if (c.file) body += '<div class="small">' + App.icon('paperclip') + ' ' + esc(c.file) + '</div>';
    var replies = c.replies && c.replies.length ? '<div class="rev-replies">' + c.replies.map(function (r) { return commentHtml(r, true); }).join('') + '</div>' : '';
    return '<div class="rev-item" data-key="' + esc(c.key) + '"><div class="rev-head">' + head.join('') + '</div>' + body + replies + '</div>';
  }

  function renderComments() {
    var st = state, q = $('[data-q]').value.trim().toLowerCase(), ft = $('[data-f-type]').value, fa = $('[data-f-author]').value;
    var match = function (c) {
      if (ft && c.type !== ft) return false;
      if (fa && (c.author || T('no_author')) !== fa) return false;
      if (q && (c.author + ' ' + c.text + ' ' + c.subject).toLowerCase().indexOf(q) === -1) return false;
      return true;
    };
    var shown = 0;
    var tops = st.comments.filter(function (c) { return !c.parent; });
    var html = tops.map(function (c) {
      var ok = match(c) || c.replies.some(match);
      if (ok) shown++;
      return ok ? commentHtml(c, false) : '';
    }).join('');
    $('[data-comments]').innerHTML = html;
    show($('[data-no-comments]'), shown === 0);
    $('[data-no-comments]').lastChild.textContent = ' ' + (st.comments.length ? T('no_match') : T('no_comments'));
  }

  function renderVersions() {
    var st = state, vs = st.versions;
    $('[data-versions-intro]').textContent = vs.length > 1 ? T('versions_intro', { n: vs.length }) : T('versions_single');
    var signedAt = {};
    st.signatures.forEach(function (s) { if (s.version) (signedAt[s.version] = signedAt[s.version] || []).push(s); });
    $('[data-versions]').innerHTML = vs.slice().reverse().map(function (v, ri) {
      var idx = vs.length - 1 - ri, items = [];
      if (v.error) items.push(T('v.error'));
      else if (idx === 0 && !st.skipped) items.push(T('v.original', { pages: v.snap.pages, n: Object.keys(v.snap.comments).length }));
      else if (v.changes) {
        var ch = v.changes;
        if (ch.pagesChanged.length) items.push(T('v.pages_changed', { p: ch.pagesChanged.join(', ') }));
        if (ch.pagesAdded) items.push(T('v.pages_added', { n: ch.pagesAdded }));
        if (ch.pagesRemoved) items.push(T('v.pages_removed', { n: ch.pagesRemoved }));
        ch.added.forEach(function (c) { items.push(T('v.comment_added', { t: typeName(c.type), a: c.author || T('no_author'), p: c.page, x: (c.state ? stateName(c.state) : c.text).slice(0, 80) })); });
        ch.modified.forEach(function (c) { items.push(T('v.comment_modified', { t: typeName(c.type), a: c.author || T('no_author'), p: c.page })); });
        ch.removed.forEach(function (c) { items.push(T('v.comment_removed', { t: typeName(c.type), a: c.author || T('no_author'), p: c.page, x: c.text.slice(0, 80) })); });
        (v.infoChanged || []).forEach(function (c) {
          var f = function (x) { if (!x) return T('v.none'); var d = /Date$/.test(c.key) ? pdfDate(x) : null; return d ? fmtLocal(d) : x.length > 60 ? x.slice(0, 60) + '…' : x; };
          items.push(T('v.info_changed', { f: c.key, a: f(c.from), b: f(c.to) }));
        });
        if (!items.length) items.push(T('v.other', { n: v.objects }));
      }
      var sig = signedAt[v.n] || [];
      sig.forEach(function (sg) { items.unshift(T('v.signature_added', { who: sg.name || sg.field, d: fmtDate(sg.date) })); });
      var head = '<strong>' + esc(idx === vs.length - 1 ? T('v.current') : T('v.title', { n: v.n })) + '</strong>'
        + (sig.length ? '<span class="badge badge-success">' + App.icon('signature') + esc(T('v.signed', { who: sig.map(function (s) { return s.name || s.field; }).join(', ') })) + '</span>' : '')
        + '<span class="muted small">' + esc(T('v.size', { size: fmtBytes(v.end), add: fmtBytes(v.size) })) + '</span>'
        + (v.snap && v.snap.info.ModDate ? '<span class="muted small">' + esc(T('v.moddate', { d: fmtDate(pdfDate(v.snap.info.ModDate)) })) + '</span>' : '')
        + (v.snap && v.snap.info.Producer ? '<span class="muted small">' + esc(v.snap.info.Producer) + '</span>' : '');
      return '<li class="rev-version' + (sig.length ? ' signed' : '') + '" data-n="' + v.n + '"><div class="rev-head">' + head + '</div><ul>'
        + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
        + (idx < vs.length - 1 && !v.error ? '<div class="row-actions"><button type="button" class="btn btn-sm" data-action="get-version" data-idx="' + idx + '">' + App.icon('download') + esc(T('v.download')) + '</button></div>' : '')
        + '</li>';
    }).join('');
    show($('[data-xmp-wrap]'), st.xmp.length > 0);
    $('[data-xmp-history]').innerHTML = st.xmp.map(function (h) {
      var d = h.when ? new Date(h.when) : null;
      return '<tr><td class="nowrap">' + esc(d && K.validDate(d) ? fmtLocal(d) : h.when) + '</td><td>' + esc(h.action) + '</td><td class="break">' + esc(h.agent) + '</td><td class="break">' + esc(h.changed || h.params) + '</td></tr>';
    }).join('');
  }

  function renderSignatures() {
    var sigs = state.signatures;
    show($('[data-no-signatures]'), !sigs.length);
    $('[data-signatures]').innerHTML = sigs.map(function (s) {
      if (!s.signed) return '<div class="rev-sig"><h3>' + App.icon('signature') + esc(T('sig.empty', { f: s.field })) + '</h3></div>';
      var rows = [
        [T('sig.name'), s.name || '—'], [T('sig.date'), fmtDate(s.date)], [T('sig.reason'), s.reason || '—'], [T('sig.location'), s.location || '—'],
        [T('sig.contact'), s.contact || '—'], [T('sig.certs'), (s.certs || []).join('; ') || '—'], [T('sig.filter'), s.filter || '—'],
        [T('sig.kind'), s.certify ? T('sig.certify') : T('sig.approval')],
        [T('sig.version'), s.version ? T('v.title', { n: s.version }) : T('sig.version_unknown')]
      ];
      var after = s.laterVersions > 0 || s.after > 2;
      return '<div class="rev-sig"><h3>' + App.icon('signature') + esc(s.field) + ' '
        + (after ? '<span class="badge badge-danger">' + esc(T('sig.changed_after', { n: s.laterVersions || 1 })) + '</span>' : '<span class="badge badge-success">' + esc(T('sig.covers_all')) + '</span>')
        + '</h3><dl class="kv meta-kv">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd class="break">' + esc(r[1]) + '</dd>'; }).join('') + '</dl></div>';
    }).join('');
  }

  /* ---------------------------------------------------------------------- */
  /* Zapis: usuwanie / anonimizacja komentarzy                              */
  /* ---------------------------------------------------------------------- */

  function keepHeaderVersion(out, version) {
    if (!/^\d\.\d$/.test(version || '') || version === '1.7' || K.latin1(out, 0, 8) !== '%PDF-1.7') return out;
    out[5] = version.charCodeAt(0); out[7] = version.charCodeAt(2);
    return out;
  }

  function save(e) {
    e.preventDefault();
    if (!state || state.encrypted) return;
    var form = $('[data-form]'), rm = form.elements._remove.checked, an = form.elements._anon.checked;
    var name = (form.elements._anonName.value || '').trim() || T('anon_default');
    var go = state.signatures.some(function (s) { return s.signed; }) ? App.confirm(T('confirm_signed')) : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      $('[data-save-status]').textContent = T('saving');
      L.PDFDocument.load(state.bytes, LOAD).then(function (doc) {
        var removed = 0, renamed = 0, ctx = doc.context;
        doc.getPages().forEach(function (page) {
          var annots = look(doc, page.node.get(PDFName.of('Annots')));
          if (!(annots instanceof PDFArray)) return;
          var keep = [], drop = [];
          for (var i = 0; i < annots.size(); i++) {
            var ref = annots.get(i), d = look(doc, ref);
            if (!(d instanceof PDFDict)) { keep.push(ref); continue; }
            var sub = str(doc, d.get(PDFName.of('Subtype')));
            var isComment = COMMENT.indexOf(sub) !== -1;
            var parent = sub === 'Popup' ? d.get(PDFName.of('Parent')) : null;
            var parentD = parent ? look(doc, parent) : null;
            var parentIsComment = parentD instanceof PDFDict && COMMENT.indexOf(str(doc, parentD.get(PDFName.of('Subtype')))) !== -1;
            if (rm && (isComment || parentIsComment)) {
              drop.push(ref);
              var pop = d.get(PDFName.of('Popup'));
              if (pop) drop.push(pop);
              removed += isComment ? 1 : 0;
              continue;
            }
            if (an && isComment) {
              if (d.get(PDFName.of('T'))) { d.set(PDFName.of('T'), PDFHexString.fromText(name)); renamed++; }
              if (d.get(PDFName.of('RC'))) d.delete(PDFName.of('RC')); // tekst sformatowany może zawierać dane autora
            }
            keep.push(ref);
          }
          if (drop.length) {
            var dropKeys = drop.map(function (r) { return String(r); });
            keep = keep.filter(function (r) { return dropKeys.indexOf(String(r)) === -1; });
            if (keep.length) page.node.set(PDFName.of('Annots'), ctx.obj(keep));
            else page.node.delete(PDFName.of('Annots'));
            drop.forEach(function (r) { if (r instanceof PDFRef) { try { ctx.delete(r); } catch (er) { /* już usunięty */ } } });
          }
        });
        return doc.save({ useObjectStreams: state.objStm, addDefaultPage: false, updateFieldAppearances: false }).then(function (out) {
          return { out: keepHeaderVersion(out, state.header), removed: removed, renamed: renamed };
        });
      }).then(function (r) {
        var fname = (form.elements._filename.value.trim() || state.file.name).replace(/[\\/:*?"<>|]+/g, '_');
        if (!/\.pdf$/i.test(fname)) fname += '.pdf';
        K.download(new Blob([r.out], { type: 'application/pdf' }), fname);
        $('[data-save-status]').textContent = T('saved', { name: fname, size: fmtBytes(r.out.length), r: r.removed, a: r.renamed });
        App.toast(T('saved_toast'), 'success');
      }).catch(function (err) {
        $('[data-save-status]').textContent = '';
        App.toast(T('save_error') + ' ' + (err && err.message ? err.message : ''), 'error', null, 9000);
      }).then(function () { btn.disabled = false; });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Eksport                                                                */
  /* ---------------------------------------------------------------------- */

  function commentRows() {
    var rows = [[T('col.page'), T('col.type'), T('col.author'), T('col.date'), T('col.created'), T('col.subject'), T('col.text'), T('col.reply_to'), T('col.state')]];
    state.comments.forEach(function (c) {
      rows.push([c.page, typeName(c.type), c.author, c.date ? fmtLocal(c.date) : '', c.created ? fmtLocal(c.created) : '', c.subject, c.text,
        c.parent ? (c.parent.author + ': ' + c.parent.text).slice(0, 60) : '', c.state ? stateName(c.state) : '']);
    });
    return rows;
  }
  function exportJson() {
    var st = state;
    return {
      file: { name: st.file.name, size: st.file.size },
      comments: st.comments.map(function (c) { return { page: c.page, type: c.type, author: c.author, date: c.date ? c.date.toISOString() : null, created: c.created ? c.created.toISOString() : null, subject: c.subject, text: c.text, replyTo: c.parent ? c.parent.key : null, id: c.key, state: c.state || null, file: c.file || null }; }),
      versions: st.versions.map(function (v) {
        return { version: v.n, endOffset: v.end, addedBytes: v.size, error: !!v.error, pages: v.snap ? v.snap.pages : null, modDate: v.snap ? v.snap.info.ModDate : null,
          producer: v.snap ? v.snap.info.Producer : null, pagesChanged: v.changes ? v.changes.pagesChanged : [], commentsAdded: v.changes ? v.changes.added.length : 0,
          commentsRemoved: v.changes ? v.changes.removed.length : 0, commentsModified: v.changes ? v.changes.modified.length : 0 };
      }),
      signatures: st.signatures.map(function (s) { return { field: s.field, signed: s.signed, name: s.name || null, date: s.date ? s.date.toISOString() : null, reason: s.reason || null, location: s.location || null, certificates: s.certs || [], coversVersion: s.version || null, laterVersions: s.laterVersions, certification: !!s.certify }; }),
      xmpHistory: st.xmp,
      generated: new Date().toISOString()
    };
  }
  function exportTxt() {
    var x = exportJson(), out = [T('export_header', { name: x.file.name }), ''];
    out.push('[' + T('tab_comments') + ': ' + x.comments.length + ']');
    state.comments.forEach(function (c) {
      out.push((c.parent ? '    ↳ ' : '') + T('page_n', { n: c.page }) + ' | ' + typeName(c.type) + ' | ' + (c.author || T('no_author')) + ' | ' + fmtDate(c.date) + (c.state ? ' | ' + stateName(c.state) : ''));
      if (c.text) out.push((c.parent ? '      ' : '  ') + c.text.replace(/\n/g, ' '));
    });
    out.push('', '[' + T('tab_versions') + ': ' + x.versions.length + ']');
    $$('[data-versions] > li').reverse().forEach(function (li) {
      out.push(li.querySelector('.rev-head').textContent.replace(/\s+/g, ' ').trim());
      Array.prototype.forEach.call(li.querySelectorAll('ul li'), function (i) { out.push('  - ' + i.textContent); });
    });
    out.push('', '[' + T('tab_signatures') + ': ' + x.signatures.length + ']');
    x.signatures.forEach(function (s) { out.push(s.field + ': ' + (s.name || '') + ' ' + (s.date || '') + ' ' + (s.reason || '') + (s.laterVersions ? ' – ' + T('sig.changed_after', { n: s.laterVersions }) : '')); });
    if (x.xmpHistory.length) { out.push('', '[' + T('xmp_history') + ']'); x.xmpHistory.forEach(function (h) { out.push(h.when + ' ' + h.action + ' ' + h.agent + ' ' + (h.changed || '')); }); }
    return out.join('\r\n') + '\r\n';
  }

  /* ---------------------------------------------------------------------- */
  /* Zdarzenia                                                              */
  /* ---------------------------------------------------------------------- */

  var input = K.bindDrop(root, loadFile);
  root.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) { K.switchTab(root, tab.getAttribute('data-tab')); return; }
    var a = e.target.closest('[data-action]');
    if (!a || !state) { if (a && a.getAttribute('data-action') === 'another') input.click(); return; }
    var act = a.getAttribute('data-action'), base = K.baseName(state.file.name);
    if (act === 'another') input.click();
    else if (act === 'csv') K.download(new Blob([K.csv(commentRows())], { type: 'text/csv;charset=utf-8' }), base + '-' + T('suffix_comments') + '.csv');
    else if (act === 'json') K.download(new Blob([JSON.stringify(exportJson(), null, 2)], { type: 'application/json' }), base + '-' + T('suffix_history') + '.json');
    else if (act === 'txt') K.download(new Blob([exportTxt()], { type: 'text/plain;charset=utf-8' }), base + '-' + T('suffix_history') + '.txt');
    else if (act === 'get-version') {
      var v = state.versions[+a.getAttribute('data-idx')];
      K.download(new Blob([state.bytes.slice(0, v.end)], { type: 'application/pdf' }), base + '-' + T('suffix_version', { n: v.n }) + '.pdf');
    }
  });
  ['input', 'change'].forEach(function (ev) {
    root.addEventListener(ev, function (e) { if (e.target.matches('[data-q], [data-f-type], [data-f-author]')) renderComments(); });
  });
  $('[data-form]').addEventListener('submit', save);
})();
