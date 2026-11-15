/*
 * tools-php – narzędzie „Metadane Excel” (XLSX, XLSM, XLTX, XLTM, XLS, XLT) (MIT)
 * Odczyt, edycja i czyszczenie metadanych w całości w przeglądarce – plik nie jest wysyłany na serwer.
 * Wspólna część (właściwości dokumentu, formularz, zapis, eksport): assets/js/lib/officemeta.js.
 * Tutaj: ukryte arkusze, wiersze i kolumny, komentarze (zwykłe i wątkowe), nazwy, łącza do innych plików,
 * połączenia z danymi, tabele przestawne, drukarki, rezerwacja pliku; w XLS – rekordy BIFF8 strumienia Workbook.
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-officemeta="excel-metadata"]');
  if (!root || !window.OfficeMeta) return;

  var K = window.ToolKit, X = window.ToolsOoxml, O = window.ToolsOle, OM = window.OfficeMeta;
  var S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var TC = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments';
  var RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var T;
  function yesNo(v) { return v ? T('yes') : T('no'); }
  function arr(l) { return Array.prototype.slice.call(l); }
  function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
  function dateStr(s) { var d = s ? new Date(String(s)) : null; return d && K.validDate(d) ? K.fmtLocal(d) : (s || ''); }
  function count(re, s) { return (String(s || '').match(re) || []).length; }
  /** Ukrywa hasła w tekście połączenia. */
  function maskPwd(s) { return String(s).replace(/((?:password|pwd)\s*=\s*)("[^"]*"|[^;]*)/gi, '$1••••••'); }
  /** Nazwa drukarki z bloku DEVMODEW (pierwsze 32 znaki UTF-16). */
  function devmodeName(b) {
    if (!b || b.length < 64) return '';
    var s = '';
    for (var i = 0; i < 64; i += 2) { var c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
    return s.trim();
  }

  /* ====================================================================== */
  /* XLSX                                                                   */
  /* ====================================================================== */

  var XLSX = {
    read: function (bytes, ctx) {
      var pkg = X.open(bytes);
      var mr = pkg.relByType('', 'officeDocument'), main = mr ? mr.path : 'xl/workbook.xml';
      if (!pkg.has(main) || !/^xl\//.test(main)) { var e = new Error(); e.code = 'not_xls_ooxml'; throw e; }
      var m = OM.newModel('xlsx');
      m.pkg = pkg; m.main = main; m.fileName = ctx && ctx.file ? ctx.file.name : '';
      OM.ooxmlRead(pkg, m);
      XLSX.analyze(m);
      return m;
    },

    analyze: function (m) {
      var pkg = m.pkg, names = Object.keys(pkg.files), d = m.info = {};
      var wbXml = pkg.text(m.main), wb = X.parseXml(wbXml), wrels = pkg.rels(m.main), byId = {};
      wrels.forEach(function (r) { byId[r.id] = r; });
      var relOf = function (type) { return wrels.filter(function (r) { return r.type.slice(-type.length - 1) === '/' + type; }); };
      // Arkusze
      d.sheets = arr(wb.getElementsByTagNameNS(S, 'sheet')).map(function (s, i) {
        var rid = s.getAttributeNS(RNS, 'id') || s.getAttribute('r:id');
        return { n: i + 1, name: s.getAttribute('name'), state: s.getAttribute('state') || 'visible', path: byId[rid] ? byId[rid].path : null };
      });
      m.count = d.sheets.length;
      d.hiddenSheets = d.sheets.filter(function (s) { return s.state === 'hidden'; }).map(function (s) { return s.name; });
      d.veryHidden = d.sheets.filter(function (s) { return s.state === 'veryHidden'; }).map(function (s) { return s.name; });
      // Rezerwacja pliku, prywatność, ochrona
      var fs = wb.getElementsByTagNameNS(S, 'fileSharing')[0];
      d.sharingUser = fs ? fs.getAttribute('userName') || '' : '';
      var wpr = wb.getElementsByTagNameNS(S, 'workbookPr')[0];
      d.filterPrivacy = !!(wpr && /^(1|true)$/.test(wpr.getAttribute('filterPrivacy') || ''));
      d.wbProtected = !!wb.getElementsByTagNameNS(S, 'workbookProtection')[0] && /lockStructure="(1|true)"|workbookPassword|workbookHashValue/.test(wbXml);
      d.names = arr(wb.getElementsByTagNameNS(S, 'definedName')).map(function (n) {
        return (n.getAttribute('hidden') === '1' ? '(' + T('hidden') + ') ' : '') + n.getAttribute('name') + ' = ' + n.textContent;
      }).filter(function (n) { return !/_xlnm\./.test(n); });
      d.pivotCaches = names.filter(function (n) { return /^xl\/pivotCache\/pivotCacheRecords\d*\.xml$/.test(n); }).length;
      d.pivotTables = names.filter(function (n) { return /^xl\/pivotTables\/[^/]+\.xml$/.test(n); }).length;
      // Arkusze: ukryte wiersze i kolumny, ochrona, komentarze, drukarki
      d.hiddenRows = 0; d.hiddenCols = 0; d.protectedSheets = 0; d.comments = []; d.commentParts = []; d.threadParts = []; d.vmlParts = [];
      d.printerParts = []; d.printers = []; d.rowColInfo = [];
      var persons = {}, people = [];
      relOf('person').forEach(function (r) {
        if (!pkg.has(r.path)) return;
        d.personsPath = r.path;
        arr(X.parseXml(pkg.text(r.path)).getElementsByTagNameNS(TC, 'person')).forEach(function (p) {
          persons[p.getAttribute('id')] = p.getAttribute('displayName') || '';
          var uid = p.getAttribute('userId');
          people.push((p.getAttribute('displayName') || '') + (uid ? ' (' + uid + (p.getAttribute('providerId') ? ', ' + p.getAttribute('providerId') : '') + ')' : ''));
        });
      });
      d.people = people;
      d.sheets.forEach(function (sh) {
        if (!sh.path || !pkg.has(sh.path)) return;
        var x = pkg.text(sh.path);
        var hr = count(/<row\b[^>]*\bhidden="(1|true)"/g, x), hc = count(/<col\b[^>]*\bhidden="(1|true)"/g, x);
        d.hiddenRows += hr; d.hiddenCols += hc;
        if (hr || hc) d.rowColInfo.push(T('sheet_rc', { s: sh.name, r: hr, c: hc }));
        if (/<sheetProtection\b/.test(x)) d.protectedSheets++;
        pkg.rels(sh.path).forEach(function (r) {
          if (r.external || !pkg.has(r.path)) return;
          var t = r.type.slice(r.type.lastIndexOf('/') + 1);
          if (t === 'comments') {
            d.commentParts.push(r.path);
            var cd = X.parseXml(pkg.text(r.path));
            var authors = arr(cd.getElementsByTagNameNS(S, 'author')).map(function (a) { return a.textContent; });
            arr(cd.getElementsByTagNameNS(S, 'comment')).forEach(function (c) {
              var tx = c.getElementsByTagNameNS(S, 'text')[0];
              var text = tx ? arr(tx.getElementsByTagNameNS(S, 't')).map(function (t) { return t.textContent; }).join('') : '';
              // komentarz wątkowy ma też kopię „notatki” – pomijamy kopie ([Threaded comment]…)
              if (/^\[Threaded comment\]/.test(text)) return;
              d.comments.push({ sheet: sh.name, ref: c.getAttribute('ref'), author: authors[+c.getAttribute('authorId')] || '', text: text });
            });
          } else if (t === 'threadedComment') {
            d.threadParts.push(r.path);
            arr(X.parseXml(pkg.text(r.path)).getElementsByTagNameNS(TC, 'threadedComment')).forEach(function (c) {
              var tx = c.getElementsByTagNameNS(TC, 'text')[0];
              d.comments.push({ sheet: sh.name, ref: c.getAttribute('ref'), author: persons[c.getAttribute('personId')] || '', date: c.getAttribute('dT'), text: tx ? tx.textContent : '', reply: !!c.getAttribute('parentId') });
            });
          } else if (t === 'vmlDrawing') {
            d.vmlParts.push({ sheet: sh.path, path: r.path, id: r.id });
          } else if (t === 'printerSettings') {
            d.printerParts.push({ sheet: sh.path, path: r.path, id: r.id });
            var nm = devmodeName(pkg.files[r.path]);
            if (nm && d.printers.indexOf(nm) === -1) d.printers.push(nm);
          }
        });
      });
      d.commentAuthors = d.comments.map(function (c) { return c.author; }).filter(function (a, i, x) { return a && x.indexOf(a) === i; });
      // Łącza do innych skoroszytów
      d.extLinks = [];
      relOf('externalLink').forEach(function (r) {
        pkg.rels(r.path).forEach(function (er) { if (er.external) d.extLinks.push(er.target); });
      });
      // Połączenia z danymi
      d.connections = [];
      d.connPasswords = false;
      relOf('connections').forEach(function (r) {
        if (!pkg.has(r.path)) return;
        arr(X.parseXml(pkg.text(r.path)).getElementsByTagNameNS(S, 'connection')).forEach(function (c) {
          var parts = [];
          arr(c.children).forEach(function (ch) {
            ['connection', 'command', 'url', 'sourceFile'].forEach(function (a) { if (ch.getAttribute(a)) parts.push(ch.getAttribute(a)); });
          });
          var all = parts.join(' | ');
          if (/password\s*=|pwd\s*=/i.test(all) || c.getAttribute('savePassword') === '1') d.connPasswords = true;
          d.connections.push((c.getAttribute('name') || '?') + ': ' + cut(maskPwd(all), 300));
        });
      });
      // Historia zmian skoroszytu udostępnionego
      d.revisions = [];
      if (pkg.has('xl/revisions/revisionHeaders.xml')) {
        arr(X.parseXml(pkg.text('xl/revisions/revisionHeaders.xml')).getElementsByTagNameNS(S, 'header')).forEach(function (h) {
          d.revisions.push(dateStr(h.getAttribute('dateTime')) + ' — ' + (h.getAttribute('userName') || '?'));
        });
      }
      // Pozostałe elementy pakietu
      var ex = OM.ooxmlExternals(pkg);
      d.hyperlinks = ex.hyperlinks;
      d.externals = ex.externals.filter(function (e) { return !/^externalLinkPath: /.test(e); });
      var media = names.filter(function (n) { return /^xl\/media\//.test(n); });
      d.media = media.length;
      d.embeddings = names.filter(function (n) { return /^xl\/embeddings\//.test(n); });
      d.macros = names.some(function (n) { return /vbaProject\.bin$/i.test(n); });
      d.customXml = names.filter(function (n) { return /^customXml\/item\d+\.xml$/.test(n); });
      d.powerQuery = d.customXml.some(function (n) { return /DataMashup/.test(pkg.text(n) || ''); });
      d.sharepoint = d.customXml.filter(function (n) { return /sharepoint|schemas\.microsoft\.com\/office\/(2006\/metadata|infopath)/i.test(pkg.text(n) || ''); }).length;

      // Szczegóły
      var det = m.details;
      det.push([T('d.format'), ((/\.([a-z]+)$/i.exec(m.fileName || '') || [])[1] || 'xlsx').toUpperCase() + ' (Office Open XML)']);
      det.push([T('d.parts'), String(names.length)]);
      det.push([T('d.sheets'), d.sheets.map(function (s) { return s.name; }).join(', ')]);
      det.push([T('d.hidden_sheets'), d.hiddenSheets.join(', ') || T('no')]);
      det.push([T('d.very_hidden'), d.veryHidden.join(', ') || T('no')]);
      det.push([T('d.hidden_rc'), T('rc', { r: d.hiddenRows, c: d.hiddenCols })]);
      det.push([T('d.comments'), String(d.comments.length)]);
      det.push([T('d.names'), String(d.names.length)]);
      det.push([T('d.ext_links'), String(d.extLinks.length)]);
      det.push([T('d.connections'), String(d.connections.length)]);
      det.push([T('d.pivots'), d.pivotTables + ' / ' + d.pivotCaches]);
      det.push([T('d.power_query'), yesNo(d.powerQuery)]);
      det.push([T('d.printers'), d.printers.join(', ') || '—']);
      det.push([T('d.sharing_user'), d.sharingUser || '—']);
      det.push([T('d.protection'), [d.wbProtected ? T('prot_wb') : '', d.protectedSheets ? T('prot_sheets', { n: d.protectedSheets }) : ''].filter(Boolean).join(', ') || T('no')]);
      det.push([T('d.hyperlinks'), String(d.hyperlinks.length)]);
      det.push([T('d.media'), String(d.media)]);
      det.push([T('d.embeddings'), String(d.embeddings.length)]);
      det.push([T('d.macros'), yesNo(d.macros)]);
      det.push([T('d.customxml'), d.customXml.length + (d.sharepoint ? ' (' + T('d.sharepoint') + ')' : '')]);
      det.push([T('d.thumbnail'), yesNo(!!m.thumbnail)]);
      det.push([T('d.filter_privacy'), yesNo(d.filterPrivacy)]);
      if (d.comments.length) m.lists.push({ icon: 'messages', title: T('l.comments'), items: d.comments.map(function (c) { return c.sheet + '!' + c.ref + ' · ' + (c.reply ? '↳ ' : '') + (c.author || '?') + (c.date ? ' · ' + dateStr(c.date) : '') + ': ' + cut(c.text, 200); }) });
      if (d.rowColInfo.length) m.lists.push({ icon: 'eye-off', title: T('l.hidden_rc'), items: d.rowColInfo });
      if (d.extLinks.length) m.lists.push({ icon: 'link', title: T('l.ext_links'), items: d.extLinks });
      if (d.connections.length) m.lists.push({ icon: 'database', title: T('l.connections'), items: d.connections });
      if (d.names.length) m.lists.push({ icon: 'variable', title: T('l.names'), items: d.names.slice(0, 100) });
      if (d.revisions.length) m.lists.push({ icon: 'history', title: T('l.revisions'), items: d.revisions });
      if (d.people.length) m.lists.push({ icon: 'users', title: T('l.people'), items: d.people });
      if (d.externals.length) m.lists.push({ icon: 'link', title: T('l.externals'), items: d.externals });
      if (d.hyperlinks.length) m.lists.push({ icon: 'world', title: T('l.hyperlinks'), items: d.hyperlinks.slice(0, 50) });
      if (d.embeddings.length) m.lists.push({ icon: 'paperclip', title: T('l.embeddings'), items: d.embeddings.map(function (n) { return n.replace(/^xl\/embeddings\//, '') + ' (' + K.fmtBytes(pkg.files[n].length) + ')'; }) });

      // Opcje czyszczenia
      if (d.commentAuthors.length || d.people.length) m.options.anonymize = T('oi.authors', { n: d.commentAuthors.length });
      if (d.comments.length) m.options.removeComments = T('oi.comments', { n: d.comments.length });
      if (d.printerParts.length) m.options.removePrinter = d.printers.join(', ');
      if (d.sharingUser) m.options.removeSharingUser = d.sharingUser;
      if (m.thumbnail) m.options.removeThumbnail = '';
      if (d.customXml.length && !d.powerQuery) m.options.removeCustomXml = T('oi.count', { n: d.customXml.length });
      if (!d.filterPrivacy) m.options.removePersonalInfo = T('oi.remove_pi');
      if (d.veryHidden.length) m.alerts.push(['warning', T('warn_very_hidden', { s: d.veryHidden.join(', ') })]);
      if (d.connPasswords) m.alerts.push(['error', T('warn_conn_password')]);
      if (d.macros) m.alerts.push(['warning', T('warn_macros')]);

      // Raport prywatności
      var f = m.findings, F = m.fields;
      if (F.creator || F.lastModifiedBy) f.push(['user', 'warn', T('fi.author', { v: [F.creator, F.lastModifiedBy].filter(Boolean).join(' / ') })]);
      if (F.company || F.manager) f.push(['building', 'warn', T('fi.company', { v: [F.company, F.manager].filter(Boolean).join(' / ') })]);
      if (d.hiddenSheets.length || d.veryHidden.length) f.push(['eye-off', 'danger', T('fi.hidden_sheets', { s: d.hiddenSheets.concat(d.veryHidden).join(', ') })]);
      if (d.hiddenRows || d.hiddenCols) f.push(['eye-off', 'danger', T('fi.hidden_rc', { r: d.hiddenRows, c: d.hiddenCols })]);
      if (d.connections.length) f.push(['database', d.connPasswords ? 'danger' : 'warn', T('fi.connections', { n: d.connections.length })]);
      if (d.extLinks.length) f.push(['link', 'warn', T('fi.ext_links', { n: d.extLinks.length })]);
      if (d.pivotCaches) f.push(['table', 'warn', T('fi.pivots', { n: d.pivotCaches })]);
      if (d.powerQuery) f.push(['database', 'warn', T('fi.power_query')]);
      if (d.comments.length) f.push(['messages', 'warn', T('fi.comments', { n: d.comments.length, v: d.commentAuthors.join(', ') })]);
      if (d.people.some(function (p) { return /@|::/.test(p); })) f.push(['users', 'warn', T('fi.people', { n: d.people.length })]);
      if (d.names.length) f.push(['variable', 'info', T('fi.names', { n: d.names.length })]);
      if (d.revisions.length) f.push(['history', 'danger', T('fi.revisions', { n: d.revisions.length })]);
      if (d.printers.length) f.push(['device-desktop', 'info', T('fi.printers', { v: d.printers.join(', ') })]);
      if (d.sharingUser) f.push(['user', 'warn', T('fi.sharing_user', { v: d.sharingUser })]);
      if (d.embeddings.length) f.push(['paperclip', 'warn', T('fi.embeddings', { n: d.embeddings.length })]);
      if (d.externals.length) f.push(['link', 'warn', T('fi.externals', { n: d.externals.length })]);
      if (d.customXml.length) f.push(['database', d.sharepoint ? 'warn' : 'info', T(d.sharepoint ? 'fi.sharepoint' : 'fi.customxml', { n: d.customXml.length })]);
      if (m.thumbnail) f.push(['photo', 'info', T('fi.thumbnail')]);
      if (d.macros) f.push(['code', 'danger', T('fi.macros')]);
      if (m.custom.length) f.push(['list', 'warn', T('fi.custom', { v: m.custom.map(function (c) { return c.name; }).join(', ') })]);
      if (F.created || F.modified) f.push(['calendar', 'info', T('fi.dates')]);
    },

    write: function (m, v, o) {
      var pkg = new X.Pkg(Object.assign({}, m.pkg.files)), d = m.info;
      OM.ooxmlWrite(pkg, m, v);
      var edit = function (p, fn) { var x = pkg.text(p); if (x != null) { var y = fn(x); if (y !== x) pkg.setText(p, y); } };
      if (o.removeComments) {
        d.commentParts.concat(d.threadParts).forEach(function (p) { pkg.removePart(p); });
        // rysunki VML z notatkami (tylko gdy zawierają wyłącznie notatki)
        d.vmlParts.forEach(function (vp) {
          var vml = pkg.text(vp.path) || '';
          var types = vml.match(/ObjectType="([^"]+)"/g) || [];
          if (types.length && types.every(function (t) { return /"Note"/.test(t); })) {
            pkg.removePart(vp.path);
            edit(vp.sheet, function (x) { return x.replace(new RegExp('<legacyDrawing\\b[^>]*\\br:id="' + vp.id + '"[^>]*/>'), ''); });
          }
        });
        if (d.personsPath) pkg.removePart(d.personsPath);
      } else if (o.anonymize) {
        var nm = K.xmlAttr(o.anonName);
        d.commentParts.forEach(function (p) { edit(p, function (x) { return x.replace(/<author>[^<]*<\/author>/g, '<author>' + nm + '</author>'); }); });
        if (d.personsPath) edit(d.personsPath, function (x) { return x.replace(/\bdisplayName="[^"]*"/g, 'displayName="' + nm + '"').replace(/\s(userId|providerId)="[^"]*"/g, ''); });
        if (pkg.has('xl/revisions/revisionHeaders.xml')) edit('xl/revisions/revisionHeaders.xml', function (x) { return x.replace(/\buserName="[^"]*"/g, 'userName="' + nm + '"'); });
        if (pkg.has('xl/revisions/userNames.xml')) edit('xl/revisions/userNames.xml', function (x) { return x.replace(/\bname="[^"]*"/g, 'name="' + nm + '"'); });
      }
      if (o.removePrinter) {
        d.printerParts.forEach(function (pp) {
          pkg.removePart(pp.path);
          edit(pp.sheet, function (x) { return x.replace(new RegExp('(<pageSetup\\b[^>]*?)\\s+r:id="' + pp.id + '"'), '$1'); });
        });
      }
      if (o.removeSharingUser) edit(m.main, function (x) { return x.replace(/(<fileSharing\b[^>]*?)\s+userName="[^"]*"/, '$1'); });
      if (o.removeThumbnail && m.thumbnail) pkg.removePart(m.thumbnail);
      if (o.removeCustomXml) OM.ooxmlRemoveCustomXml(pkg);
      if (o.removePersonalInfo) {
        edit(m.main, function (x) {
          if (/filterPrivacy=/.test(x)) return x.replace(/filterPrivacy="[^"]*"/, 'filterPrivacy="1"');
          if (/<workbookPr\b/.test(x)) return x.replace(/<workbookPr\b/, '<workbookPr filterPrivacy="1"');
          return x.replace(/(<sheets\b)/, '<workbookPr filterPrivacy="1"/>$1');
        });
      }
      return X.save(pkg);
    }
  };

  /* ====================================================================== */
  /* XLS (Excel 97–2003, BIFF8)                                             */
  /* ====================================================================== */

  /** XLUnicodeString ([MS-XLS] 2.5.294): cch, flagi, znaki. Zwraca { s, end }. */
  function xlString(b, p, cch, noCch) {
    var n = cch, q = p;
    if (!noCch) { n = b[q] | (b[q + 1] << 8); q += 2; }
    var high = b[q] & 1; q += 1;
    var s = '';
    for (var i = 0; i < n && q < b.length; i++) { if (high) { s += String.fromCharCode(b[q] | (b[q + 1] << 8)); q += 2; } else { s += String.fromCharCode(b[q]); q += 1; } }
    return { s: s, end: q };
  }
  /** Ścieżka zakodowana w SUPBOOK (VirtualPath, [MS-XLS] 2.5.277). */
  function virtPath(s) {
    return s.replace(/^\u0001@/, '\\\\').replace(/^\u0001(.)/, '$1:\\').replace(/\u0002/g, '\\').replace(/\u0003/g, '\\').replace(/\u0004/g, '..\\').replace(/\u0005/g, '').replace(/\u0006/g, '').replace(/[\u0000-\u001f]/g, '');
  }

  function scanBiff(b) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), r = { sheets: [], names: 0, supbooks: [], notes: [], hiddenRows: 0, hiddenCols: 0, encrypted: false };
    var recs = function (start, onRec) {
      var p = start, depth = 0;
      while (p + 4 <= b.length) {
        var type = dv.getUint16(p, true), len = dv.getUint16(p + 2, true), body = p + 4;
        if (body + len > b.length) break;
        if (onRec(type, body, len, p) === false) break;
        if (type === 0x0809) depth++;
        if (type === 0x000A) { depth--; if (depth <= 0) break; }
        p = body + len;
      }
    };
    recs(0, function (type, p, len, at) {
      if (type === 0x002F) { r.encrypted = true; return false; }
      if (type === 0x005C && len >= 3) { r.writeAccess = xlString(b, p).s.replace(/\s+$/, ''); r.writeAccessAt = p; r.writeAccessLen = len; }
      else if (type === 0x0085 && len >= 8) r.sheets.push({ pos: dv.getUint32(p, true), state: b[p + 4] & 3, name: xlString(b, p + 7, b[p + 6], true).s });
      else if (type === 0x0018) r.names++;
      else if (type === 0x01AE && len >= 4) {
        var cch = dv.getUint16(p + 2, true);
        if (cch !== 0x0401 && cch !== 0x3A01 && cch > 0) r.supbooks.push(virtPath(xlString(b, p + 4, cch, true).s));
      } else if (type === 0x005B && len >= 7) r.sharingUser = xlString(b, p + 4).s;
    });
    if (r.encrypted) return r;
    r.sheets.forEach(function (sh) {
      if (sh.pos >= b.length) return;
      recs(sh.pos, function (type, p, len) {
        if (type === 0x001C && len >= 10) r.notes.push({ sheet: sh.name, author: xlString(b, p + 8).s.replace(/\0+$/, '') });
        else if (type === 0x0208 && len >= 16 && (dv.getUint16(p + 12, true) & 0x20)) r.hiddenRows++;
        else if (type === 0x007D && len >= 10 && (dv.getUint16(p + 8, true) & 1)) r.hiddenCols++;
      });
    });
    return r;
  }

  var XLS = {
    read: function (bytes) {
      var cfb = O.readCfb(bytes);
      if (cfb.find('EncryptedPackage') >= 0) { var e1 = new Error(); e1.code = 'encrypted_ooxml'; throw e1; }
      var wi = cfb.find('Workbook');
      if (wi < 0) wi = cfb.find('Book');
      if (wi < 0) { var e2 = new Error(); e2.code = 'not_xls'; throw e2; }
      var m = OM.newModel('xls');
      OM.oleRead(cfb, m, T);
      var d = m.info = { wIdx: wi }, sc = d.scan = scanBiff(cfb.stream(wi));
      m.count = sc.sheets.length || null;
      d.macros = cfb.find('_VBA_PROJECT_CUR') >= 0;
      var hidden = sc.sheets.filter(function (s) { return s.state === 1; }).map(function (s) { return s.name; });
      var very = sc.sheets.filter(function (s) { return s.state === 2; }).map(function (s) { return s.name; });
      var noteAuthors = sc.notes.map(function (n) { return n.author; }).filter(function (a, i, x) { return a && x.indexOf(a) === i; });
      var det = m.details;
      det.push([T('d.format'), 'XLS (Excel 97–2003, BIFF8)']);
      det.push([T('d.write_access'), sc.writeAccess || '—']);
      det.push([T('d.encrypted'), yesNo(sc.encrypted)]);
      det.push([T('d.sheets'), sc.sheets.map(function (s) { return s.name; }).join(', ') || '—']);
      det.push([T('d.hidden_sheets'), hidden.join(', ') || T('no')]);
      det.push([T('d.very_hidden'), very.join(', ') || T('no')]);
      det.push([T('d.hidden_rc'), T('rc', { r: sc.hiddenRows, c: sc.hiddenCols })]);
      det.push([T('d.comments'), String(sc.notes.length)]);
      det.push([T('d.names'), String(sc.names)]);
      det.push([T('d.ext_links'), String(sc.supbooks.length)]);
      det.push([T('d.sharing_user'), sc.sharingUser || '—']);
      det.push([T('d.macros'), yesNo(d.macros)]);
      det.push([T('d.thumbnail'), yesNo(m.thumb)]);
      det.push([T('d.streams'), cfb.children(0).map(function (i) { return cfb.entries[i].name.replace(/[\u0000-\u001f]/g, function (c) { return '\\x0' + c.charCodeAt(0).toString(16); }); }).join(', ')]);
      if (sc.notes.length) m.lists.push({ icon: 'messages', title: T('l.comment_authors_xls'), items: sc.notes.map(function (n) { return n.sheet + ': ' + (n.author || '?'); }) });
      if (sc.supbooks.length) m.lists.push({ icon: 'link', title: T('l.ext_links'), items: sc.supbooks });

      if (sc.writeAccess && !sc.encrypted) m.options.anonymize = T('oi.write_access', { v: sc.writeAccess });
      if (m.thumb) m.options.removeThumbnail = '';
      if (sc.encrypted) m.alerts.push(['warning', T('warn_xls_encrypted')]);
      if (very.length) m.alerts.push(['warning', T('warn_very_hidden', { s: very.join(', ') })]);
      if (d.macros) m.alerts.push(['warning', T('warn_macros')]);
      m.alerts.push(['info', T('warn_xls_readonly')]);

      var f = m.findings, F = m.fields;
      if (F.creator || F.lastModifiedBy) f.push(['user', 'warn', T('fi.author', { v: [F.creator, F.lastModifiedBy].filter(Boolean).join(' / ') })]);
      if (sc.writeAccess) f.push(['user', 'warn', T('fi.write_access', { v: sc.writeAccess })]);
      if (F.company || F.manager) f.push(['building', 'warn', T('fi.company', { v: [F.company, F.manager].filter(Boolean).join(' / ') })]);
      if (hidden.length || very.length) f.push(['eye-off', 'danger', T('fi.hidden_sheets', { s: hidden.concat(very).join(', ') })]);
      if (sc.hiddenRows || sc.hiddenCols) f.push(['eye-off', 'danger', T('fi.hidden_rc', { r: sc.hiddenRows, c: sc.hiddenCols })]);
      if (sc.supbooks.length) f.push(['link', 'warn', T('fi.ext_links', { n: sc.supbooks.length })]);
      if (sc.notes.length) f.push(['messages', 'warn', T('fi.comments', { n: sc.notes.length, v: noteAuthors.join(', ') })]);
      if (sc.names) f.push(['variable', 'info', T('fi.names', { n: sc.names })]);
      if (sc.sharingUser) f.push(['user', 'warn', T('fi.sharing_user', { v: sc.sharingUser })]);
      if (m.thumb) f.push(['photo', 'info', T('fi.thumbnail')]);
      if (d.macros) f.push(['code', 'danger', T('fi.macros')]);
      if (m.custom.length) f.push(['list', 'warn', T('fi.custom', { v: m.custom.map(function (c) { return c.name; }).join(', ') })]);
      if (F.created || F.modified) f.push(['calendar', 'info', T('fi.dates')]);
      return m;
    },
    write: function (m, v, o) {
      var contents = {}, add = [], sc = m.info.scan;
      OM.oleWrite(m, v, o, contents, add);
      if (o.anonymize && sc.writeAccessAt != null) {
        // WRITEACCESS ma stałą długość (112 bajtów) – nowa nazwa uzupełniona spacjami, bez zmiany układu rekordów
        var w = new Uint8Array(m.cfb.stream(m.info.wIdx)), p = sc.writeAccessAt, len = sc.writeAccessLen;
        var name = o.anonName.slice(0, Math.floor((len - 3) / 2)), uni = /[^\u0000-ÿ]/.test(name);
        w.fill(0x20, p, p + len);
        w[p] = name.length & 255; w[p + 1] = name.length >> 8; w[p + 2] = uni ? 1 : 0;
        for (var i = 0; i < name.length; i++) {
          if (uni) { w[p + 3 + i * 2] = name.charCodeAt(i) & 255; w[p + 4 + i * 2] = name.charCodeAt(i) >> 8; } else w[p + 3 + i] = name.charCodeAt(i);
        }
        contents[m.info.wIdx] = w;
      }
      return O.writeCfb(m.cfb, contents, add);
    }
  };

  /* ====================================================================== */
  /* Uruchomienie                                                           */
  /* ====================================================================== */

  var ui = OM.ui({
    root: root,
    prefix: 'tool.excel-metadata.',
    opts: ['anonymize', 'removeComments', 'removePrinter', 'removeSharingUser', 'removeThumbnail', 'removeCustomXml', 'removePersonalInfo'],
    countStat: 'sheets',
    detect: function (bytes) {
      if (X.isZip(bytes)) return XLSX;
      if (O.isCfb(bytes)) return XLS;
      var e = new Error(); e.code = 'unknown_format'; throw e;
    },
    formatLabel: function (m) { return m.format === 'xlsx' ? 'XLSX (Office Open XML)' : 'XLS (Excel 97–2003)'; },
    fileIcon: function () { return 'file-type-xls'; },
    mime: function (m) { return m.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel'; }
  });
  T = ui.T;
})();
