/*
 * tools-php – narzędzie „Śledzone zmiany i komentarze Word” (DOCX, DOCM, DOTX, DOTM, DOC, DOT) (MIT)
 * Wszystko w przeglądarce – plik nie jest wysyłany na serwer.
 *  - DOCX: zmiany (w:ins, w:del, przeniesienia, formatowanie, akapity, tabele) i komentarze (z odpowiedziami,
 *          rozwiązaniem, zakresem tekstu); akceptowanie / odrzucanie wszystkich zmian, usuwanie komentarzy.
 *  - DOC:  odczyt tekstu z tabeli fragmentów, oznaczeń zmian z właściwości znaków (CHPX) i komentarzy (ATRD)
 *          – tylko do odczytu.
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-wordr]');
  if (!root || !window.ToolKit || !window.ToolsOle || !window.ToolsOoxml || !window.fflate) return;

  var K = window.ToolKit, X = window.ToolsOoxml, O = window.ToolsOle;
  var T = function (k, p) { return App.t('tool.word-review.' + k, p); };
  var $ = function (s) { return root.querySelector(s); };
  var esc = App.esc, fmtLocal = K.fmtLocal;
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  var W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
  var W16CID = 'http://schemas.microsoft.com/office/word/2016/wordml/cid';
  var W16CEX = 'http://schemas.microsoft.com/office/word/2018/wordml/cex';
  var CTX = 120; // znaki kontekstu przed i po zmianie
  var state = null;

  function show(el, on) { if (el) el.hidden = !on; }
  function fmtDate(d) { return d ? fmtLocal(d) : '—'; }
  function arr(list) { return Array.prototype.slice.call(list); }
  function cut(s, n, fromEnd) { s = s || ''; return s.length <= n ? s : fromEnd ? '…' + s.slice(-n) : s.slice(0, n) + '…'; }

  /* ====================================================================== */
  /* DOCX                                                                   */
  /* ====================================================================== */

  /** Tokeny tekstu w elemencie (w kolejności dokumentu). */
  function tokens(el) {
    var out = [];
    arr(el.getElementsByTagNameNS(W, '*')).forEach(function (n) {
      var l = n.localName, s = null;
      if (l === 't' || l === 'delText') s = n.textContent;
      else if (l === 'tab') s = '\t';
      else if (l === 'br' || l === 'cr') s = '\n';
      else if (l === 'noBreakHyphen') s = '-';
      if (s != null) out.push({ el: n, s: s });
    });
    return out;
  }
  function textOf(el) { return tokens(el).map(function (t) { return t.s; }).join(''); }
  function closest(el, local) { for (var p = el; p && p.nodeType === 1; p = p.parentNode) if (p.namespaceURI === W && p.localName === local) return p; return null; }
  function wattr(el, n) { return el.getAttributeNS(W, n) || el.getAttribute('w:' + n) || ''; }
  /** Word zapisuje w w:date czas lokalny autora z sufiksem „Z” – traktujemy go jak czas lokalny (tak pokazuje Word). */
  function wdate(el) {
    var v = wattr(el, 'date'), m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return K.validDate(d) ? d : null;
  }

  var INLINE = { ins: 'ins', del: 'del', moveFrom: 'moveFrom', moveTo: 'moveTo' };
  var PRCH = { rPrChange: 'fmtRun', pPrChange: 'fmtPara', sectPrChange: 'fmtSect', tblPrChange: 'fmtTable', trPrChange: 'fmtTable', tcPrChange: 'fmtTable', tblGridChange: 'fmtTable', tblPrExChange: 'fmtTable', numberingChange: 'fmtNum' };

  function docxParts(pkg, main) {
    var parts = [{ path: main, where: 'main' }];
    pkg.rels(main).forEach(function (r) {
      var t = r.type.slice(r.type.lastIndexOf('/') + 1);
      if (r.external || !pkg.has(r.path)) return;
      if (t === 'header' || t === 'footer' || t === 'footnotes' || t === 'endnotes' || t === 'comments') parts.push({ path: r.path, where: t === 'comments' ? 'comment' : t });
    });
    return parts;
  }

  function docxChanges(doc, where) {
    var out = [], prev = null;
    var all = arr(doc.getElementsByTagNameNS(W, '*'));
    all.forEach(function (el) {
      var l = el.localName, kind = null, c;
      var parent = el.parentNode, pl = parent && parent.localName;
      if (INLINE[l]) {
        if (pl === 'rPr' && parent.parentNode && parent.parentNode.localName === 'pPr') kind = l === 'ins' || l === 'moveTo' ? 'paraIns' : 'paraDel';
        else if (pl === 'trPr') kind = l === 'ins' ? 'rowIns' : 'rowDel';
        else if (pl === 'rPr' || pl === 'tcPr' || pl === 'numPr') kind = null;
        else kind = INLINE[l];
      } else if (PRCH[l]) kind = PRCH[l];
      else if (l === 'cellIns' || l === 'cellDel' || l === 'cellMerge') kind = 'cell';
      if (!kind) return;
      var p = closest(el, 'p');
      c = { kind: kind, author: wattr(el, 'author'), date: wdate(el), where: where, text: '', before: '', after: '', el: el, p: p };
      var tk = p ? tokens(p) : [];
      if (INLINE[kind]) {
        var inside = tk.filter(function (t) { return el.contains(t.el); });
        c.text = inside.map(function (t) { return t.s; }).join('');
        if (inside.length) {
          var a = tk.indexOf(inside[0]), b = tk.indexOf(inside[inside.length - 1]);
          c.before = tk.slice(0, a).map(function (t) { return t.s; }).join('');
          c.after = tk.slice(b + 1).map(function (t) { return t.s; }).join('');
        }
      } else if (kind === 'paraIns' || kind === 'paraDel') {
        c.text = '¶'; c.before = tk.map(function (t) { return t.s; }).join('');
      } else if (kind === 'fmtRun') {
        var r = closest(el, 'r');
        c.text = r ? textOf(r) : '';
        if (r) {
          var rt = tokens(r), i0 = rt.length ? tk.indexOf(tk.filter(function (t) { return t.el === rt[0].el; })[0]) : -1;
          if (i0 >= 0) { c.before = tk.slice(0, i0).map(function (t) { return t.s; }).join(''); c.after = tk.slice(i0 + rt.length).map(function (t) { return t.s; }).join(''); }
        }
      } else if (kind === 'fmtPara') {
        c.text = tk.map(function (t) { return t.s; }).join('');
      } else if (kind === 'rowIns' || kind === 'rowDel' || kind === 'cell') {
        var tr = closest(el, kind === 'cell' ? 'tc' : 'tr');
        c.text = tr ? textOf(tr) : '';
        if (kind === 'cell') c.cellKind = l;
      }
      // Scalanie sąsiednich fragmentów tej samej zmiany (Word dzieli je na przebiegi)
      if (prev && prev.kind === c.kind && prev.author === c.author && String(prev.date) === String(c.date) && prev.p === c.p && INLINE[c.kind] && adjacent(prev.lastEl, el)) {
        prev.text += c.text; prev.after = c.after; prev.lastEl = el;
        return;
      }
      c.lastEl = el;
      out.push(c);
      prev = c;
    });
    return out;
  }
  function adjacent(a, b) {
    for (var n = a.nextElementSibling, g = 0; n && g < 20; n = n.nextElementSibling, g++) {
      if (n === b) return true;
      if (!/^(commentRangeStart|commentRangeEnd|bookmarkStart|bookmarkEnd|proofErr|permStart|permEnd)$/.test(n.localName)) return false;
    }
    return false;
  }

  function docxComments(pkg, main, parts) {
    var rel = pkg.relByType(main, 'comments');
    if (!rel || !pkg.has(rel.path)) return [];
    var cd = X.parseXml(pkg.text(rel.path)), list = [], byId = {}, byPara = {};
    arr(cd.getElementsByTagNameNS(W, 'comment')).forEach(function (el) {
      var paras = arr(el.getElementsByTagNameNS(W, 'p'));
      var c = { id: wattr(el, 'id'), author: wattr(el, 'author'), initials: wattr(el, 'initials'), date: wdate(el), text: paras.map(textOf).join('\n').trim(), replies: [], anchor: '', where: '' };
      var last = paras[paras.length - 1];
      c.paraId = last ? (last.getAttributeNS(W14, 'paraId') || last.getAttribute('w14:paraId') || '') : '';
      list.push(c); byId[c.id] = c; if (c.paraId) byPara[c.paraId] = c;
    });
    // Odpowiedzi i rozwiązanie (commentsExtended), daty UTC (commentsIds + commentsExtensible)
    var ext = pkg.relByType(main, 'commentsExtended');
    if (ext && pkg.has(ext.path)) {
      arr(X.parseXml(pkg.text(ext.path)).getElementsByTagNameNS(W15, 'commentEx')).forEach(function (e) {
        var c = byPara[e.getAttributeNS(W15, 'paraId')];
        if (!c) return;
        c.done = e.getAttributeNS(W15, 'done') === '1';
        var par = byPara[e.getAttributeNS(W15, 'paraIdParent')];
        if (par && par !== c) c.parentC = par;
      });
    }
    var ids = pkg.relByType(main, 'commentsIds'), cex = pkg.relByType(main, 'commentsExtensible');
    if (ids && cex && pkg.has(ids.path) && pkg.has(cex.path)) {
      var dur = {};
      arr(X.parseXml(pkg.text(cex.path)).getElementsByTagNameNS(W16CEX, 'commentExtensible')).forEach(function (e) {
        var d = new Date(e.getAttributeNS(W16CEX, 'dateUtc'));
        if (K.validDate(d)) dur[e.getAttributeNS(W16CEX, 'durableId')] = d;
      });
      arr(X.parseXml(pkg.text(ids.path)).getElementsByTagNameNS(W16CID, 'commentId')).forEach(function (e) {
        var c = byPara[e.getAttributeNS(W16CID, 'paraId')], d = dur[e.getAttributeNS(W16CID, 'durableId')];
        if (c && d) c.date = d;
      });
    }
    // Zakres tekstu, którego dotyczy komentarz
    parts.forEach(function (pt) {
      if (pt.where === 'comment') return;
      var doc = pt.doc, open = {};
      arr(doc.getElementsByTagNameNS(W, '*')).forEach(function (n) {
        var l = n.localName;
        if (l === 'commentRangeStart') open[wattr(n, 'id')] = true;
        else if (l === 'commentRangeEnd') delete open[wattr(n, 'id')];
        else if (l === 'commentReference') { var c = byId[wattr(n, 'id')]; if (c && !c.where) c.where = pt.where; }
        else if (l === 't' || l === 'delText') Object.keys(open).forEach(function (id) { if (byId[id] && byId[id].anchor.length < 600) byId[id].anchor += n.textContent; });
      });
    });
    list.forEach(function (c) { if (c.parentC) c.parentC.replies.push(c); c.parent = c.parentC ? c.parentC.id : null; c.where = c.where || 'main'; });
    return list;
  }

  var DOCX = {
    read: function (bytes) {
      var pkg = X.open(bytes);
      var mr = pkg.relByType('', 'officeDocument'), main = mr ? mr.path : 'word/document.xml';
      if (!pkg.has(main) || !/^word\//.test(main)) { var e = new Error(); e.code = 'not_word_ooxml'; throw e; }
      var m = { format: 'docx', pkg: pkg, main: main, alerts: [] };
      m.parts = docxParts(pkg, main).map(function (p) { p.doc = X.parseXml(pkg.text(p.path)); return p; });
      m.changes = [];
      m.parts.forEach(function (p) { m.changes = m.changes.concat(docxChanges(p.doc, p.where)); });
      m.comments = docxComments(pkg, main, m.parts);
      // Historia dokumentu
      var core = pkg.relByType('', X.REL_CORE) || pkg.relByType('', 'core-properties'), app = pkg.relByType('', 'extended-properties');
      var cd = core && pkg.has(core.path) ? X.parseXml(pkg.text(core.path)).documentElement : null;
      var ad = app && pkg.has(app.path) ? X.parseXml(pkg.text(app.path)).documentElement : null;
      var cv = function (ns, n) { var el = cd ? X.childNS(cd, X.NS[ns], n) : null; return el ? el.textContent : ''; };
      var av = function (n) { var el = ad ? X.childNS(ad, X.NS.ep, n) : null; return el ? el.textContent : ''; };
      var setRel = pkg.relByType(main, 'settings'), st = setRel ? pkg.text(setRel.path) || '' : '';
      m.settingsPath = setRel ? setRel.path : null;
      m.track = /<w:trackRevisions(?![^>]*w:val="(?:0|false|off)")[^>]*\/?>/.test(st);
      var rsids = (st.match(/<w:rsid\b/g) || []).length;
      var people = [];
      if (pkg.has('word/people.xml')) pkg.text('word/people.xml').replace(/<w15:person\b[^>]*\bw15:author="([^"]*)"/g, function (a, n) { people.push(K.xmlText(n)); return a; });
      m.history = [
        [T('h.creator'), cv('dc', 'creator') || '—'], [T('h.created'), fmtDate(X.parseW3C(cv('dcterms', 'created')))],
        [T('h.last_by'), cv('cp', 'lastModifiedBy') || '—'], [T('h.modified'), fmtDate(X.parseW3C(cv('dcterms', 'modified')))],
        [T('h.printed'), fmtDate(X.parseW3C(cv('cp', 'lastPrinted')))], [T('h.revision'), cv('cp', 'revision') || '—'],
        [T('h.total_time'), av('TotalTime') ? T('h.minutes', { n: av('TotalTime') }) : '—'], [T('h.sessions'), rsids ? String(rsids) : '—'],
        [T('h.track'), m.track ? T('yes') : T('no')], [T('h.app'), [av('Application'), av('AppVersion')].filter(Boolean).join(' ') || '—']
      ];
      m.lists = people.length ? [{ icon: 'users', title: T('h.people'), items: people }] : [];
      m.rsids = rsids;
      return m;
    },

    /** Akceptuje lub odrzuca wszystkie zmiany w dokumencie XML (DOM). */
    applyRevisions: function (doc, accept) {
      var all = function (l) { return arr(doc.getElementsByTagNameNS(W, l)); };
      var rename = function (el, local) {
        var n = doc.createElementNS(W, 'w:' + local);
        arr(el.attributes).forEach(function (a) { n.setAttributeNS(a.namespaceURI, a.name, a.value); });
        while (el.firstChild) n.appendChild(el.firstChild);
        el.parentNode.replaceChild(n, el);
      };
      var unwrap = function (el) { var p = el.parentNode; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); };
      var remove = function (el) { if (el.parentNode) el.parentNode.removeChild(el); };
      var mergeNext = function (p) {
        var next = p && p.nextElementSibling;
        if (!next || next.namespaceURI !== W || next.localName !== 'p') return;
        arr(next.childNodes).forEach(function (ch) { if (!(ch.nodeType === 1 && ch.localName === 'pPr')) p.appendChild(ch); });
        remove(next);
      };
      // 1. Zmiany formatowania
      Object.keys(PRCH).forEach(function (l) {
        all(l).reverse().forEach(function (ch) {
          var pr = ch.parentNode;
          if (!accept && l !== 'numberingChange') {
            var old = ch.firstElementChild, keepRe = /^(rPr|sectPr|ins|del|moveFrom|moveTo|cellIns|cellDel|cellMerge)$/;
            var kept = arr(pr.children).filter(function (c) { return c !== ch && keepRe.test(c.localName); });
            arr(pr.children).forEach(function (c) { if (c !== ch && kept.indexOf(c) === -1) pr.removeChild(c); });
            var before = l === 'rPrChange' ? ch : (kept[0] || ch);
            if (old) while (old.firstChild) pr.insertBefore(old.firstChild, before);
          }
          remove(ch);
        });
      });
      // 2. Znaki akapitu, wiersze tabel, komórki
      ['ins', 'del', 'moveFrom', 'moveTo'].forEach(function (l) {
        all(l).reverse().forEach(function (el) {
          var parent = el.parentNode, pl = parent.localName, isIns = l === 'ins' || l === 'moveTo';
          if (pl === 'rPr' && parent.parentNode && parent.parentNode.localName === 'pPr') {
            var p = closest(el, 'p');
            remove(el);
            if (accept !== isIns) mergeNext(p);
          } else if (pl === 'trPr') {
            var tr = closest(el, 'tr');
            if (accept !== isIns) remove(tr); else remove(el);
          } else if (pl === 'rPr' || pl === 'numPr' || pl === 'tcPr') remove(el);
        });
      });
      all('cellIns').reverse().forEach(function (el) { if (!accept) remove(closest(el, 'tc')); else remove(el); });
      all('cellDel').reverse().forEach(function (el) { if (accept) remove(closest(el, 'tc')); else remove(el); });
      all('cellMerge').forEach(remove);
      // 3. Wstawienia, usunięcia, przeniesienia w tekście
      ['ins', 'moveTo', 'del', 'moveFrom'].forEach(function (l) {
        var isIns = l === 'ins' || l === 'moveTo';
        all(l).reverse().forEach(function (el) {
          if (!el.parentNode) return;
          if (accept === isIns) {
            if (!isIns) { arr(el.getElementsByTagNameNS(W, 'delText')).forEach(function (d) { rename(d, 't'); }); arr(el.getElementsByTagNameNS(W, 'delInstrText')).forEach(function (d) { rename(d, 'instrText'); }); }
            unwrap(el);
          } else remove(el);
        });
      });
      // 4. Znaczniki zakresów przeniesień i zmian w customXml
      ['moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart', 'customXmlInsRangeEnd',
        'customXmlDelRangeStart', 'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd'].forEach(function (l) { all(l).forEach(remove); });
    },

    write: function (m, o) {
      var pkg = new X.Pkg(Object.assign({}, m.pkg.files));
      if (o.mode === 'accept' || o.mode === 'reject') {
        m.parts.forEach(function (p) {
          var doc = X.parseXml(pkg.text(p.path));
          DOCX.applyRevisions(doc, o.mode === 'accept');
          pkg.setText(p.path, X.serialize(doc));
        });
      }
      var wordParts = function () { return Object.keys(pkg.files).filter(function (n) { return /^word\/(glossary\/)?[^/]+\.xml$/.test(n); }); };
      var edit = function (p, fn) { var x = pkg.text(p); if (x != null) { var y = fn(x); if (y !== x) pkg.setText(p, y); } };
      if (o.removeComments) {
        wordParts().forEach(function (p) {
          edit(p, function (x) {
            return x.replace(/<w:commentRangeStart\b[^>]*\/>/g, '').replace(/<w:commentRangeEnd\b[^>]*\/>/g, '')
              .replace(/<w:r\b(?:(?!<w:r[ >])[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<w:r[ >])[\s\S])*?<\/w:r>/g, '')
              .replace(/<w:commentReference\b[^>]*\/>/g, '');
          });
        });
        ['comments', 'commentsExtended', 'commentsIds', 'commentsExtensible'].forEach(function (t) { var r = pkg.relByType(m.main, t); if (r) pkg.removePart(r.path); });
      }
      if (o.anon) {
        var nm = K.xmlAttr(o.anonName), ini = K.xmlAttr(K.initials(o.anonName));
        wordParts().forEach(function (p) { edit(p, function (x) { return x.replace(/\bw:author="[^"]*"/g, 'w:author="' + nm + '"').replace(/\bw:initials="[^"]*"/g, 'w:initials="' + ini + '"'); }); });
        if (pkg.has('word/people.xml')) pkg.removePart('word/people.xml');
      }
      if (o.trackOff && m.settingsPath) edit(m.settingsPath, function (x) { return x.replace(/<w:trackRevisions\b[^>]*\/>|<w:trackRevisions\b[^>]*>[\s\S]*?<\/w:trackRevisions>/g, ''); });
      return X.save(pkg);
    }
  };

  /* ====================================================================== */
  /* DOC (Word 97–2003) – tylko odczyt                                      */
  /* ====================================================================== */

  /** Czyści tekst Worda: pola (kod ukryty, wynik widoczny), znaki sterujące. */
  function cleanDoc(s) {
    var out = '', stack = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x13) { stack.push('code'); continue; }
      if (c === 0x14) { if (stack.length) stack[stack.length - 1] = 'result'; continue; }
      if (c === 0x15) { stack.pop(); continue; }
      if (stack.some(function (x) { return x === 'code'; })) continue;
      if (c === 13 || c === 11 || c === 12) out += '\n';
      else if (c === 7) out += '\t';
      else if (c === 0x1E) out += '-';
      else if (c === 9 || c >= 32) out += s.charAt(i);
    }
    return out;
  }

  var DOC = {
    read: function (bytes) {
      var cfb = O.readCfb(bytes), wi = cfb.find('WordDocument');
      if (cfb.find('EncryptedPackage') >= 0) { var e1 = new Error(); e1.code = 'encrypted'; throw e1; }
      if (wi < 0) { var e2 = new Error(); e2.code = 'not_word_doc'; throw e2; }
      var w = cfb.stream(wi), fib = O.parseFib(w), m = { format: 'doc', alerts: [], changes: [], comments: [], lists: [] };
      if (!fib || fib.old) { m.alerts.push(['warning', T('warn_old')]); }
      else if (fib.encrypted || fib.obfuscated) { m.alerts.push(['warning', T('warn_doc_encrypted')]); }
      else {
        var t = cfb.stream(cfb.find(fib.table)), dt = O.docText(w, t, fib), cc = fib.ccp;
        var bounds = [['main', cc.text], ['footnotes', cc.ftn], ['header', cc.hdd], ['comment', cc.atn], ['endnotes', cc.edn], ['textbox', cc.txbx + cc.hdrTxbx]];
        var whereOf = function (cp) { var acc = 0; for (var i = 0; i < bounds.length; i++) { acc += bounds[i][1]; if (cp < acc) return bounds[i][0]; } return 'main'; };
        var rmark = O.readSttb(t, fib.get(O.FIB.sttbfRMark));
        var who = function (i) { return i != null && rmark[i] != null ? rmark[i] : ''; };
        // Zmiany
        var prev = null;
        O.docRevisions(w, t, fib, dt).forEach(function (r) {
          var rv = r.rev, kind = rv.del ? 'del' : rv.ins ? 'ins' : 'fmtRun';
          var author = who(kind === 'del' ? (rv.ibstDel != null ? rv.ibstDel : rv.ibst) : kind === 'ins' ? rv.ibst : rv.ibstFmt);
          var date = O.dttm(kind === 'del' ? (rv.dttmDel || rv.dttm) : kind === 'ins' ? rv.dttm : rv.dttmFmt);
          if (prev && prev.kind === kind && prev.author === author && String(prev.date) === String(date) && prev.cpB === r.cpA) { prev.cpB = r.cpB; return; }
          prev = { kind: kind, author: author, date: date, cpA: r.cpA, cpB: r.cpB };
          m.changes.push(prev);
        });
        m.changes.forEach(function (c) {
          c.where = whereOf(c.cpA);
          c.text = cleanDoc(dt.text(c.cpA, c.cpB)).replace(/\n$/, '¶');
          if (!c.text.trim()) c.text = c.text || '¶';
          c.before = cleanDoc(dt.text(Math.max(0, c.cpA - 300), c.cpA)); c.before = c.before.slice(c.before.lastIndexOf('\n') + 1);
          c.after = cleanDoc(dt.text(c.cpB, c.cpB + 300)); c.after = c.after.split('\n')[0];
          if (c.kind === 'del' && /\n|¶$/.test(c.text) && c.text.replace(/[\n¶]/g, '') === '') c.kind = 'paraDel';
        });
        // Komentarze
        var ref = O.readPlc(t, fib.get(O.FIB.plcfandRef), 30), txt = O.readPlc(t, fib.get(O.FIB.plcfandTxt), 0);
        var owners = O.readXstGroup(t, fib.get(O.FIB.grpXstAtnOwners));
        var ex = fib.get(O.FIB.atrdExtra), tdv = new DataView(t.buffer, t.byteOffset, t.byteLength);
        var bkf = O.readPlc(t, fib.get(O.FIB.plcfAtnBkf), 4), bkl = O.readPlc(t, fib.get(O.FIB.plcfAtnBkl), 0), sb = O.readSttbEx(t, fib.get(O.FIB.sttbfAtnBkmk));
        var atnStart = cc.text + cc.ftn + cc.hdd;
        ref.data.forEach(function (d, i) {
          var dv = new DataView(d.buffer, d.byteOffset, 30), c = { id: String(i), replies: [] };
          c.initials = O.utf16(d, 2, Math.min(9, dv.getUint16(0, true)));
          c.author = owners[dv.getUint16(20, true)] || '';
          if (txt.cps[i + 1] != null) c.text = cleanDoc(dt.text(atnStart + txt.cps[i], atnStart + txt.cps[i + 1])).replace(/^\u0005/, '').trim();
          c.text = (c.text || '').replace(/\u0005/g, '');
          if (ex && ex.lcb >= (i + 1) * 18 && ex.fc + (i + 1) * 18 <= t.length) {
            c.date = O.dttm(tdv.getUint32(ex.fc + i * 18, true));
            var depth = tdv.getUint32(ex.fc + i * 18 + 6, true), par = tdv.getInt32(ex.fc + i * 18 + 10, true);
            if (depth > 0 && par && i + par >= 0 && i + par < ref.data.length && par !== 0) c.parentIdx = i + par;
          }
          var tag = dv.getInt32(26, true), anchor = '';
          sb.extras.forEach(function (e, k) {
            if (anchor || e.length < 6) return;
            if (new DataView(e.buffer, e.byteOffset, e.length).getInt32(2, true) === tag && bkf.cps[k] != null && bkf.data[k]) {
              var ibkl = bkf.data[k][0] | (bkf.data[k][1] << 8);
              if (bkl.cps[ibkl] != null) anchor = cleanDoc(dt.text(bkf.cps[k], bkl.cps[ibkl]));
            }
          });
          if (!anchor && ref.cps[i] != null) { var bf = cleanDoc(dt.text(Math.max(0, ref.cps[i] - 80), ref.cps[i])); anchor = '…' + bf.slice(bf.lastIndexOf('\n') + 1); }
          c.anchor = anchor.replace(/\u0005/g, '');
          c.where = whereOf(ref.cps[i] || 0);
          m.comments.push(c);
        });
        m.comments.forEach(function (c) { if (c.parentIdx != null && m.comments[c.parentIdx]) { c.parent = String(c.parentIdx); m.comments[c.parentIdx].replies.push(c); } });
        var saved = O.readSttb(t, fib.get(O.FIB.sttbSavedBy)), sv = [];
        for (var s = 0; s + 1 < saved.length; s += 2) sv.push(saved[s] + ' — ' + saved[s + 1]);
        if (sv.length) m.lists.push({ icon: 'history', title: T('h.saved_by'), items: sv });
        m.fastSaved = fib.complex;
        if (fib.complex) m.alerts.push(['warning', T('warn_fast_save')]);
      }
      // Historia z SummaryInformation
      var si = cfb.find('\u0005SummaryInformation'), props = {};
      try {
        var ps = si >= 0 ? O.parsePropSet(cfb.stream(si)) : null;
        var sec = ps && ps.sections.filter(function (x) { return x.fmtid === O.FMTID_SUMMARY; })[0];
        if (sec) sec.props.forEach(function (p) { props[p.id] = p.value; });
      } catch (e) { /* brak lub uszkodzone właściwości */ }
      var ft = function (v) { return v && v.lo != null ? O.ftToDate(v.lo, v.hi) : null; };
      var mins = props[10] && props[10].lo != null ? Number(((BigInt(props[10].hi) << 32n) | BigInt(props[10].lo)) / 600000000n) : null;
      m.history = [
        [T('h.creator'), props[4] || '—'], [T('h.created'), fmtDate(ft(props[12]))], [T('h.last_by'), props[8] || '—'], [T('h.modified'), fmtDate(ft(props[13]))],
        [T('h.printed'), fmtDate(ft(props[11]))], [T('h.revision'), props[9] || '—'], [T('h.total_time'), mins != null ? T('h.minutes', { n: mins }) : '—'],
        [T('h.app'), props[18] || '—'], [T('h.word_version'), fib && !fib.old ? (O.WORD_VER[fib.nFibNew || fib.nFib] || 'nFib 0x' + (fib.nFibNew || fib.nFib).toString(16)) : '—'],
        [T('h.fast_save'), fib && fib.complex ? T('yes') + ' (' + fib.quickSaves + ')' : T('no')]
      ];
      return m;
    }
  };

  /* ====================================================================== */
  /* Wczytanie                                                              */
  /* ====================================================================== */

  function loadFile(file) {
    if (!file) return;
    show($('[data-drop]'), false); show($('[data-result]'), false); show($('[data-loading]'), true);
    file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf), ad;
      if (X.isZip(b)) ad = DOCX;
      else if (O.isCfb(b)) ad = DOC;
      else { var e = new Error(); e.code = /^\{\\rtf/.test(K.latin1(b, 0, 16)) ? 'is_rtf' : 'unknown_format'; throw e; }
      state = { file: { name: file.name, size: file.size }, bytes: b, adapter: ad, model: ad.read(b) };
      render();
    }).catch(function (err) {
      state = null;
      show($('[data-loading]'), false); show($('[data-drop]'), true);
      App.toast(T('read_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
    });
  }

  /* ====================================================================== */
  /* Widok                                                                  */
  /* ====================================================================== */

  var KIND_ICON = { ins: 'plus', del: 'trash', moveFrom: 'arrows-left-right', moveTo: 'arrows-left-right', paraIns: 'plus', paraDel: 'trash', rowIns: 'plus', rowDel: 'trash', cell: 'layout-grid', fmtRun: 'typography', fmtPara: 'typography', fmtSect: 'typography', fmtTable: 'layout-grid', fmtNum: 'list' };

  function render() {
    var m = state.model;
    show($('[data-loading]'), false); show($('[data-result]'), true);
    $('[data-fname]').textContent = state.file.name;
    $('[data-fmeta]').textContent = [K.fmtBytes(state.file.size), m.format === 'docx' ? 'DOCX (Office Open XML)' : 'DOC (Word 97–2003)'].join(' · ');
    $('[data-ficon]').innerHTML = App.icon(m.format === 'docx' ? 'file-type-docx' : 'file-type-doc');
    var authors = {};
    m.changes.forEach(function (c) { authors[c.author || T('no_author')] = 1; });
    m.comments.forEach(function (c) { authors[c.author || T('no_author')] = 1; });
    var open = m.comments.filter(function (c) { return !c.done; }).length;
    var stats = [
      ['git-compare', m.changes.length, T('stat_changes'), m.changes.length ? 'danger' : ''],
      ['messages', m.comments.length, T('stat_comments'), m.comments.length ? 'warn' : ''],
      ['users', Object.keys(authors).length, T('stat_authors'), ''],
      ['circle-check', m.comments.length - open, T('stat_resolved'), '']
    ];
    $('[data-stats]').innerHTML = stats.map(function (s) {
      return '<div class="card rev-stat ' + s[3] + '"><span class="stat-ic">' + App.icon(s[0]) + '</span><div><div class="stat-val">' + s[1] + '</div><div class="muted small">' + esc(s[2]) + '</div></div></div>';
    }).join('');
    var alerts = m.alerts.slice();
    if (m.changes.some(function (c) { return c.kind === 'del' || c.kind === 'moveFrom'; })) alerts.unshift(['error', T('warn_deleted_text')]);
    if (m.track) alerts.push(['info', T('warn_track_on')]);
    $('[data-alerts]').innerHTML = alerts.map(function (a) { return '<div class="alert alert-' + a[0] + '">' + App.icon(a[0] === 'info' ? 'info-circle' : 'alert-triangle') + '<span>' + esc(a[1]) + '</span></div>'; }).join('');
    $('[data-count-changes]').textContent = m.changes.length;
    $('[data-count-comments]').textContent = m.comments.length;
    var opts = function (list, all) { var cnt = K.countBy(list); return '<option value="">' + esc(all) + '</option>' + Object.keys(cnt).map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + ' (' + cnt[k] + ')</option>'; }).join(''); };
    var kinds = K.countBy(m.changes.map(function (c) { return c.kind; }));
    $('[data-f="ctype"]').innerHTML = '<option value="">' + esc(T('all_types')) + '</option>' + Object.keys(kinds).map(function (k) { return '<option value="' + k + '">' + esc(T('k.' + k)) + ' (' + kinds[k] + ')</option>'; }).join('');
    $('[data-f="cauthor"]').innerHTML = opts(m.changes.map(function (c) { return c.author || T('no_author'); }), T('all_authors'));
    $('[data-f="mauthor"]').innerHTML = opts(m.comments.map(function (c) { return c.author || T('no_author'); }), T('all_authors'));
    root.querySelectorAll('[data-q]').forEach(function (q) { q.value = ''; });
    $('[data-f="mstatus"]').value = '';
    renderChanges(); renderComments();
    $('[data-history]').innerHTML = m.history.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd class="break">' + esc(r[1]) + '</dd>'; }).join('');
    $('[data-history-lists]').innerHTML = m.lists.map(function (l) {
      return '<div class="tool-list"><h3 class="meta-sub">' + App.icon(l.icon) + esc(l.title) + ' <span class="seg-count">' + l.items.length + '</span></h3><ul>' + l.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    var docx = m.format === 'docx';
    show($('[data-docx-only]'), docx); show($('[data-doc-only]'), !docx);
    var form = $('[data-form]');
    if (docx) {
      form.elements._mode.value = 'keep';
      form.elements._removeComments.checked = false; form.elements._anon.checked = false; form.elements._trackOff.checked = false;
      form.elements._filename.value = K.baseName(state.file.name) + '-' + T('suffix') + (/\.[^.]+$/.exec(state.file.name) || ['.docx'])[0];
    }
  }

  function changeHtml(c) {
    var body = '';
    var marked = c.kind === 'del' || c.kind === 'moveFrom' || c.kind === 'paraDel' || c.kind === 'rowDel' ? 'rev-del' : (c.kind === 'ins' || c.kind === 'moveTo' || c.kind === 'paraIns' || c.kind === 'rowIns') ? 'rev-ins' : '';
    if (c.text || c.before || c.after) {
      body = '<div class="rev-quote">' + esc(cut(c.before, CTX, true)) + '<span class="' + marked + '">' + esc(cut(c.text, 1500)) + '</span>' + esc(cut(c.after, CTX)) + '</div>';
    }
    return '<div class="rev-item"><div class="rev-head"><span class="badge">' + App.icon(KIND_ICON[c.kind] || 'edit') + esc(T('k.' + c.kind)) + '</span>'
      + '<strong>' + esc(c.author || T('no_author')) + '</strong><span class="muted">' + esc(fmtDate(c.date)) + '</span>'
      + (c.where !== 'main' ? '<span class="badge">' + esc(T('w.' + c.where)) + '</span>' : '') + '</div>' + body + '</div>';
  }

  function commentHtml(c, reply) {
    return '<div class="rev-item"><div class="rev-head">'
      + (c.done ? '<span class="badge badge-success">' + App.icon('circle-check') + esc(T('resolved')) + '</span>' : '')
      + '<strong>' + esc(c.author || T('no_author')) + '</strong>' + (c.initials ? '<span class="muted">(' + esc(c.initials) + ')</span>' : '')
      + '<span class="muted">' + esc(fmtDate(c.date)) + '</span>' + (c.where && c.where !== 'main' ? '<span class="badge">' + esc(T('w.' + c.where)) + '</span>' : '') + '</div>'
      + (!reply && c.anchor ? '<div class="rev-quote">' + esc(cut(c.anchor, 400)) + '</div>' : '')
      + '<div class="rev-text">' + esc(c.text || '') + '</div>'
      + (c.replies.length ? '<div class="rev-replies">' + c.replies.map(function (r) { return commentHtml(r, true); }).join('') + '</div>' : '') + '</div>';
  }

  function renderChanges() {
    var m = state.model, q = $('[data-q="changes"]').value.trim().toLowerCase(), ft = $('[data-f="ctype"]').value, fa = $('[data-f="cauthor"]').value;
    var list = m.changes.filter(function (c) {
      return (!ft || c.kind === ft) && (!fa || (c.author || T('no_author')) === fa) && (!q || (c.author + ' ' + c.text + ' ' + c.before + ' ' + c.after).toLowerCase().indexOf(q) !== -1);
    });
    var LIMIT = 500;
    $('[data-changes]').innerHTML = list.slice(0, LIMIT).map(changeHtml).join('') + (list.length > LIMIT ? '<p class="muted center">' + esc(T('more', { n: list.length - LIMIT })) + '</p>' : '');
    var none = $('[data-none="changes"]');
    show(none, !list.length);
    none.textContent = m.changes.length ? T('no_match') : T('no_changes');
  }
  function renderComments() {
    var m = state.model, q = $('[data-q="comments"]').value.trim().toLowerCase(), fa = $('[data-f="mauthor"]').value, fs = $('[data-f="mstatus"]').value;
    var match = function (c) {
      return (!fa || (c.author || T('no_author')) === fa) && (!fs || (fs === 'done') === !!c.done) && (!q || (c.author + ' ' + c.text + ' ' + c.anchor).toLowerCase().indexOf(q) !== -1);
    };
    var tops = m.comments.filter(function (c) { return !c.parent; }).filter(function (c) { return match(c) || c.replies.some(match); });
    $('[data-comments]').innerHTML = tops.map(function (c) { return commentHtml(c, false); }).join('');
    var none = $('[data-none="comments"]');
    show(none, !tops.length);
    none.textContent = m.comments.length ? T('no_match') : T('no_comments');
  }

  /* ====================================================================== */
  /* Zapis (DOCX)                                                           */
  /* ====================================================================== */

  function save(e) {
    e.preventDefault();
    if (!state || state.model.format !== 'docx') return;
    var f = $('[data-form]');
    var o = { mode: f.elements._mode.value, removeComments: f.elements._removeComments.checked, anon: f.elements._anon.checked, trackOff: f.elements._trackOff.checked, anonName: (f.elements._anonName.value || '').trim() || T('anon_default') };
    if (o.mode === 'keep' && !o.removeComments && !o.anon && !o.trackOff) { App.toast(T('nothing_to_do'), 'info'); return; }
    var btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    $('[data-save-status]').textContent = T('saving');
    setTimeout(function () {
      try {
        var out = DOCX.write(state.model, o);
        var name = (f.elements._filename.value.trim() || state.file.name).replace(/[\\/:*?"<>|]+/g, '_');
        if (!/\.(docx|docm|dotx|dotm)$/i.test(name)) name += '.docx';
        K.download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name);
        App.toast(T('saved_toast'), 'success');
        state = { file: { name: name, size: out.length }, bytes: out, adapter: DOCX, model: DOCX.read(out) };
        render();
        $('[data-save-status]').textContent = T('saved', { name: name, size: K.fmtBytes(out.length) });
      } catch (err) {
        $('[data-save-status]').textContent = '';
        App.toast(T('save_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
      }
      btn.disabled = false;
    }, 30);
  }

  /* ====================================================================== */
  /* Eksport                                                                */
  /* ====================================================================== */

  function changeRows() {
    var rows = [[T('col.type'), T('col.author'), T('col.date'), T('col.where'), T('col.text'), T('col.context')]];
    state.model.changes.forEach(function (c) { rows.push([T('k.' + c.kind), c.author, c.date ? fmtLocal(c.date) : '', T('w.' + c.where), c.text, cut(c.before, CTX, true) + '[' + c.text + ']' + cut(c.after, CTX)]); });
    return rows;
  }
  function commentRows() {
    var rows = [[T('col.author'), T('col.initials'), T('col.date'), T('col.text'), T('col.anchor'), T('col.reply_to'), T('col.resolved')]];
    var byId = {};
    state.model.comments.forEach(function (c) { byId[c.id] = c; });
    state.model.comments.forEach(function (c) { rows.push([c.author, c.initials, c.date ? fmtLocal(c.date) : '', c.text, c.anchor, c.parent && byId[c.parent] ? byId[c.parent].author + ': ' + cut(byId[c.parent].text, 50) : '', c.done ? T('yes') : '']); });
    return rows;
  }
  function exportJson() {
    var m = state.model;
    return {
      file: { name: state.file.name, size: state.file.size, format: m.format },
      changes: m.changes.map(function (c) { return { type: c.kind, author: c.author, date: c.date ? c.date.toISOString() : null, where: c.where, text: c.text, before: cut(c.before, CTX, true), after: cut(c.after, CTX) }; }),
      comments: m.comments.map(function (c) { return { id: c.id, author: c.author, initials: c.initials, date: c.date ? c.date.toISOString() : null, text: c.text, anchor: c.anchor, replyTo: c.parent || null, resolved: !!c.done, where: c.where }; }),
      history: m.history.reduce(function (o, r) { o[r[0]] = r[1]; return o; }, {}),
      lists: m.lists,
      generated: new Date().toISOString()
    };
  }
  function exportTxt() {
    var m = state.model, out = [T('export_header', { name: state.file.name }), ''];
    out.push('[' + T('tab_changes') + ': ' + m.changes.length + ']');
    m.changes.forEach(function (c) { out.push('- ' + T('k.' + c.kind) + ' | ' + (c.author || T('no_author')) + ' | ' + fmtDate(c.date) + (c.where !== 'main' ? ' | ' + T('w.' + c.where) : '') + ': ' + (c.text || '').replace(/\n/g, ' ')); });
    out.push('', '[' + T('tab_comments') + ': ' + m.comments.length + ']');
    var walk = function (c, ind) {
      out.push(ind + '- ' + (c.author || T('no_author')) + ' | ' + fmtDate(c.date) + (c.done ? ' | ' + T('resolved') : '') + (c.anchor && !ind ? ' | „' + cut(c.anchor, 80) + '”' : ''));
      out.push(ind + '  ' + (c.text || '').replace(/\n/g, ' '));
      c.replies.forEach(function (r) { walk(r, ind + '    '); });
    };
    m.comments.filter(function (c) { return !c.parent; }).forEach(function (c) { walk(c, ''); });
    out.push('', '[' + T('tab_history') + ']');
    m.history.forEach(function (r) { out.push(r[0] + ': ' + r[1]); });
    m.lists.forEach(function (l) { out.push('', '[' + l.title + ']'); l.items.forEach(function (i) { out.push('- ' + i); }); });
    return out.join('\r\n') + '\r\n';
  }

  /* ====================================================================== */
  /* Zdarzenia                                                              */
  /* ====================================================================== */

  var input = K.bindDrop(root, loadFile);
  root.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) { K.switchTab(root, tab.getAttribute('data-tab')); return; }
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.getAttribute('data-action');
    if (act === 'another') { input.click(); return; }
    if (!state) return;
    var base = K.baseName(state.file.name);
    if (act === 'csv-changes') K.download(new Blob([K.csv(changeRows())], { type: 'text/csv;charset=utf-8' }), base + '-' + T('suffix_changes') + '.csv');
    else if (act === 'csv-comments') K.download(new Blob([K.csv(commentRows())], { type: 'text/csv;charset=utf-8' }), base + '-' + T('suffix_comments') + '.csv');
    else if (act === 'json') K.download(new Blob([JSON.stringify(exportJson(), null, 2)], { type: 'application/json' }), base + '-' + T('suffix_history') + '.json');
    else if (act === 'txt') K.download(new Blob([exportTxt()], { type: 'text/plain;charset=utf-8' }), base + '-' + T('suffix_history') + '.txt');
  });
  ['input', 'change'].forEach(function (ev) {
    root.addEventListener(ev, function (e) {
      if (!state) return;
      if (e.target.matches('[data-q="changes"], [data-f="ctype"], [data-f="cauthor"]')) renderChanges();
      if (e.target.matches('[data-q="comments"], [data-f="mauthor"], [data-f="mstatus"]')) renderComments();
    });
  });
  $('[data-form]').addEventListener('submit', save);
})();
