/*
 * tools-php – narzędzie „Metadane PowerPoint” (PPTX, PPTM, POTX, PPSX, PPT, PPS, POT) (MIT)
 * Odczyt, edycja i czyszczenie metadanych w całości w przeglądarce – plik nie jest wysyłany na serwer.
 * Wspólna część (właściwości dokumentu, formularz, zapis, eksport): assets/js/lib/officemeta.js.
 * Tutaj: notatki prelegenta, komentarze (stare i nowe), ukryte slajdy, osadzone pliki, odwołania,
 * informacje o wersjach (revisionInfo); w PPT – rekordy strumienia „PowerPoint Document” i „Current User”.
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-officemeta="ppt-metadata"]');
  if (!root || !window.OfficeMeta) return;

  var K = window.ToolKit, X = window.ToolsOoxml, O = window.ToolsOle, OM = window.OfficeMeta;
  var P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var P188 = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
  var T;
  function yesNo(v) { return v ? T('yes') : T('no'); }
  function arr(l) { return Array.prototype.slice.call(l); }
  function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
  function dateStr(s) { var d = s ? new Date(String(s).replace(/(\.\d+)?$/, '')) : null; return d && K.validDate(d) ? K.fmtLocal(d) : (s || ''); }

  /* ====================================================================== */
  /* PPTX                                                                   */
  /* ====================================================================== */

  /** Tekst z elementów a:t (akapity rozdzielone nową linią). */
  function drawText(el) {
    return arr(el.getElementsByTagNameNS(A, 'p')).map(function (p) {
      return arr(p.getElementsByTagNameNS(A, 't')).map(function (t) { return t.textContent; }).join('');
    }).join('\n').trim();
  }
  /** Tekst notatek: kształty poza symbolami zastępczymi numeru slajdu, daty, nagłówka i stopki. */
  function notesText(doc) {
    return arr(doc.getElementsByTagNameNS(P, 'sp')).filter(function (sp) {
      var ph = sp.getElementsByTagNameNS(P, 'ph')[0], t = ph ? ph.getAttribute('type') : '';
      return !/^(sldNum|dt|hdr|ftr|sldImg)$/.test(t || '');
    }).map(drawText).filter(Boolean).join('\n').trim();
  }

  var PPTX = {
    read: function (bytes, ctx) {
      var pkg = X.open(bytes);
      var mr = pkg.relByType('', 'officeDocument'), main = mr ? mr.path : 'ppt/presentation.xml';
      if (!pkg.has(main) || !/^ppt\//.test(main)) { var e = new Error(); e.code = 'not_ppt_ooxml'; throw e; }
      var m = OM.newModel('pptx');
      m.pkg = pkg; m.main = main; m.fileName = ctx && ctx.file ? ctx.file.name : '';
      OM.ooxmlRead(pkg, m);
      PPTX.analyze(m);
      return m;
    },

    analyze: function (m) {
      var pkg = m.pkg, names = Object.keys(pkg.files), d = m.info = {};
      var pres = X.parseXml(pkg.text(m.main));
      var presRels = pkg.rels(m.main), byId = {};
      presRels.forEach(function (r) { byId[r.id] = r; });
      // Slajdy w kolejności prezentacji
      d.slides = arr(pres.getElementsByTagNameNS(P, 'sldId')).map(function (s, i) {
        var rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
        return { n: i + 1, path: byId[rid] ? byId[rid].path : null };
      }).filter(function (s) { return s.path && pkg.has(s.path); });
      m.count = d.slides.length;
      d.removePI = pres.documentElement.getAttribute('removePersonalInfoOnSave') === '1' || pres.documentElement.getAttribute('removePersonalInfoOnSave') === 'true';
      d.embeddedFonts = pres.getElementsByTagNameNS(P, 'embeddedFont').length;
      // Autorzy komentarzy (stare: commentAuthors.xml, nowe: authors.xml)
      var authors = {}, people = [];
      var ca = presRels.filter(function (r) { return /\/commentAuthors$/.test(r.type); })[0];
      if (ca && pkg.has(ca.path)) {
        d.commentAuthorsPath = ca.path;
        arr(X.parseXml(pkg.text(ca.path)).getElementsByTagNameNS(P, 'cmAuthor')).forEach(function (a) { authors['L' + a.getAttribute('id')] = a.getAttribute('name') || ''; });
      }
      var au = presRels.filter(function (r) { return /\/authors$/.test(r.type); })[0];
      if (au && pkg.has(au.path)) {
        d.authorsPath = au.path;
        arr(X.parseXml(pkg.text(au.path)).getElementsByTagNameNS(P188, 'author')).forEach(function (a) {
          authors['M' + a.getAttribute('id')] = a.getAttribute('name') || '';
          var uid = a.getAttribute('userId');
          people.push((a.getAttribute('name') || '') + (uid ? ' (' + uid + (a.getAttribute('providerId') ? ', ' + a.getAttribute('providerId') : '') + ')' : ''));
        });
      }
      // Slajdy: ukryte, notatki, komentarze
      d.hidden = []; d.notes = []; d.comments = []; d.commentParts = []; d.notesParts = [];
      d.slides.forEach(function (s) {
        var sx = X.parseXml(pkg.text(s.path));
        var show = sx.documentElement.getAttribute('show');
        if (show === '0' || show === 'false') d.hidden.push(s.n);
        pkg.rels(s.path).forEach(function (r) {
          if (r.external || !pkg.has(r.path)) return;
          var t = r.type.slice(r.type.lastIndexOf('/') + 1);
          if (t === 'notesSlide') {
            d.notesParts.push(r.path);
            var txt = notesText(X.parseXml(pkg.text(r.path)));
            if (txt) d.notes.push({ n: s.n, text: txt });
          } else if (t === 'comments') {
            d.commentParts.push(r.path);
            var cd = X.parseXml(pkg.text(r.path));
            arr(cd.getElementsByTagNameNS(P, 'cm')).forEach(function (c) {
              var tx = c.getElementsByTagNameNS(P, 'text')[0];
              d.comments.push({ n: s.n, author: authors['L' + c.getAttribute('authorId')] || '', date: c.getAttribute('dt'), text: tx ? tx.textContent : '' });
            });
            arr(cd.getElementsByTagNameNS(P188, 'cm')).concat(arr(cd.getElementsByTagNameNS(P188, 'reply'))).forEach(function (c) {
              var body = arr(c.children).filter(function (x) { return x.localName === 'txBody'; })[0];
              d.comments.push({ n: s.n, author: authors['M' + c.getAttribute('authorId')] || '', date: c.getAttribute('created'), text: body ? drawText(body) : '', reply: c.localName === 'reply' });
            });
          }
        });
      });
      d.people = people;
      d.authorNames = Object.keys(authors).map(function (k) { return authors[k]; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      // Pozostałe elementy pakietu
      var ex = OM.ooxmlExternals(pkg);
      d.hyperlinks = ex.hyperlinks; d.externals = ex.externals;
      var media = names.filter(function (n) { return /^ppt\/media\//.test(n); });
      d.media = media.length;
      d.mediaSize = media.reduce(function (s, n) { return s + pkg.files[n].length; }, 0);
      d.embeddings = names.filter(function (n) { return /^ppt\/embeddings\//.test(n); });
      d.macros = names.some(function (n) { return /vbaProject\.bin$/i.test(n); });
      d.customXml = names.filter(function (n) { return /^customXml\/item\d+\.xml$/.test(n); });
      d.sharepoint = d.customXml.filter(function (n) { return /sharepoint|schemas\.microsoft\.com\/office\/(2006\/metadata|infopath)/i.test(pkg.text(n) || ''); }).length;
      var ri = presRels.filter(function (r) { return /\/revisionInfo$/.test(r.type); })[0];
      d.revInfoPath = ri && pkg.has(ri.path) ? ri.path : null;
      d.revClients = d.revInfoPath ? (pkg.text(d.revInfoPath).match(/<p1510:client\b/g) || []).length : 0;
      d.tags = names.filter(function (n) { return /^ppt\/tags\/[^/]+\.xml$/.test(n); }).length;
      d.ext = (/\.([a-z]+)$/i.exec(m.fileName || '') || [])[1] || 'pptx';

      // Szczegóły
      var det = m.details;
      det.push([T('d.format'), d.ext.toUpperCase() + ' (Office Open XML)']);
      det.push([T('d.parts'), String(names.length)]);
      det.push([T('d.slides'), String(d.slides.length)]);
      det.push([T('d.hidden_slides'), d.hidden.length ? d.hidden.join(', ') : T('no')]);
      det.push([T('d.notes'), String(d.notes.length)]);
      det.push([T('d.comments'), String(d.comments.length)]);
      det.push([T('d.hyperlinks'), String(d.hyperlinks.length)]);
      det.push([T('d.externals'), String(d.externals.length)]);
      det.push([T('d.media'), d.media + (d.media ? ' (' + K.fmtBytes(d.mediaSize) + ')' : '')]);
      det.push([T('d.embeddings'), String(d.embeddings.length)]);
      det.push([T('d.macros'), yesNo(d.macros)]);
      det.push([T('d.customxml'), d.customXml.length + (d.sharepoint ? ' (' + T('d.sharepoint') + ')' : '')]);
      det.push([T('d.thumbnail'), yesNo(!!m.thumbnail)]);
      det.push([T('d.revinfo'), d.revClients ? String(d.revClients) : T('no')]);
      det.push([T('d.tags'), String(d.tags)]);
      det.push([T('d.fonts'), String(d.embeddedFonts)]);
      det.push([T('d.remove_pi'), yesNo(d.removePI)]);
      if (d.notes.length) m.lists.push({ icon: 'note', title: T('l.notes'), items: d.notes.map(function (x) { return T('slide_n', { n: x.n }) + ': ' + cut(x.text, 300); }) });
      if (d.comments.length) m.lists.push({ icon: 'messages', title: T('l.comments'), items: d.comments.map(function (c) { return T('slide_n', { n: c.n }) + ' · ' + (c.reply ? '↳ ' : '') + (c.author || '?') + (c.date ? ' · ' + dateStr(c.date) : '') + ': ' + cut(c.text, 200); }) });
      if (d.people.length) m.lists.push({ icon: 'users', title: T('l.people'), items: d.people });
      if (d.externals.length) m.lists.push({ icon: 'link', title: T('l.externals'), items: d.externals });
      if (d.hyperlinks.length) m.lists.push({ icon: 'world', title: T('l.hyperlinks'), items: d.hyperlinks.slice(0, 50) });
      if (d.embeddings.length) m.lists.push({ icon: 'paperclip', title: T('l.embeddings'), items: d.embeddings.map(function (n) { return n.replace(/^ppt\/embeddings\//, '') + ' (' + K.fmtBytes(pkg.files[n].length) + ')'; }) });

      // Opcje czyszczenia
      if (d.authorNames.length) m.options.anonymize = T('oi.authors', { n: d.authorNames.length });
      if (d.comments.length) m.options.removeComments = T('oi.comments', { n: d.comments.length });
      if (d.notesParts.length) m.options.removeNotes = T('oi.notes', { n: d.notes.length });
      if (m.thumbnail) m.options.removeThumbnail = '';
      if (d.customXml.length) m.options.removeCustomXml = T('oi.count', { n: d.customXml.length });
      if (d.revInfoPath) m.options.removeRevInfo = '';
      if (!d.removePI) m.options.removePersonalInfo = T('oi.remove_pi');
      if (d.macros) m.alerts.push(['warning', T('warn_macros')]);
      if (d.hidden.length) m.alerts.push(['info', T('warn_hidden', { s: d.hidden.join(', ') })]);

      // Raport prywatności
      var f = m.findings, F = m.fields;
      if (F.creator || F.lastModifiedBy) f.push(['user', 'warn', T('fi.author', { v: [F.creator, F.lastModifiedBy].filter(Boolean).join(' / ') })]);
      if (F.company || F.manager) f.push(['building', 'warn', T('fi.company', { v: [F.company, F.manager].filter(Boolean).join(' / ') })]);
      if (d.notes.length) f.push(['note', 'danger', T('fi.notes', { n: d.notes.length })]);
      if (d.comments.length) f.push(['messages', 'warn', T('fi.comments', { n: d.comments.length, v: d.authorNames.join(', ') })]);
      if (d.people.some(function (p) { return /@|::/.test(p); })) f.push(['users', 'warn', T('fi.people', { n: d.people.length })]);
      if (d.hidden.length) f.push(['eye-off', 'danger', T('fi.hidden', { s: d.hidden.join(', ') })]);
      if (d.embeddings.length) f.push(['paperclip', 'danger', T('fi.embeddings_ppt', { n: d.embeddings.length })]);
      if (d.externals.length) f.push(['link', 'warn', T('fi.externals', { n: d.externals.length })]);
      if (d.revClients) f.push(['fingerprint', 'info', T('fi.revinfo', { n: d.revClients })]);
      if (d.customXml.length) f.push(['database', d.sharepoint ? 'warn' : 'info', T(d.sharepoint ? 'fi.sharepoint' : 'fi.customxml', { n: d.customXml.length })]);
      if (m.thumbnail) f.push(['photo', 'warn', T('fi.thumbnail_ppt')]);
      if (d.media) f.push(['photo', 'info', T('fi.media', { n: d.media })]);
      if (d.macros) f.push(['code', 'danger', T('fi.macros')]);
      if (m.custom.length) f.push(['list', 'warn', T('fi.custom', { v: m.custom.map(function (c) { return c.name; }).join(', ') })]);
      if (F.totalTime) f.push(['clock', 'info', T('fi.totaltime', { n: F.totalTime })]);
      if (F.created || F.modified) f.push(['calendar', 'info', T('fi.dates')]);
    },

    write: function (m, v, o) {
      var pkg = new X.Pkg(Object.assign({}, m.pkg.files)), d = m.info;
      OM.ooxmlWrite(pkg, m, v);
      if (o.removeNotes) d.notesParts.forEach(function (p) { pkg.removePart(p); });
      if (o.removeComments) {
        d.commentParts.forEach(function (p) { pkg.removePart(p); });
        if (d.commentAuthorsPath) pkg.removePart(d.commentAuthorsPath);
        if (d.authorsPath) pkg.removePart(d.authorsPath);
      } else if (o.anonymize) {
        var nm = K.xmlAttr(o.anonName), ini = K.xmlAttr(K.initials(o.anonName));
        [d.commentAuthorsPath, d.authorsPath].forEach(function (p) {
          if (!p || !pkg.has(p)) return;
          pkg.setText(p, pkg.text(p).replace(/\bname="[^"]*"/g, 'name="' + nm + '"').replace(/\binitials="[^"]*"/g, 'initials="' + ini + '"')
            .replace(/\s(userId|providerId)="[^"]*"/g, ''));
        });
      }
      if (o.removeThumbnail && m.thumbnail) pkg.removePart(m.thumbnail);
      if (o.removeCustomXml) OM.ooxmlRemoveCustomXml(pkg);
      if (o.removeRevInfo && d.revInfoPath) pkg.removePart(d.revInfoPath);
      if (o.removePersonalInfo) {
        var px = pkg.text(m.main);
        if (!/removePersonalInfoOnSave=/.test(px)) pkg.setText(m.main, px.replace(/<p:presentation\b/, '<p:presentation removePersonalInfoOnSave="1"'));
      }
      return X.save(pkg);
    }
  };

  /* ====================================================================== */
  /* PPT (PowerPoint 97–2003)                                               */
  /* ====================================================================== */

  var RT = { Slide: 0x03EE, Notes: 0x03F0, Comment10: 0x2EE0, Comment10Atom: 0x2EE1, CString: 0x0FBA, TextChars: 0x0FA0, TextBytes: 0x0FA8,
    TextHeader: 0x0F9F, UserEdit: 0x0FF5, ExOleEmbed: 0x0FCC, ExOleLink: 0x0FCE, ExHyperlink: 0x0FD7, CurrentUser: 0x0FF6 };

  /** Przegląd rekordów strumienia „PowerPoint Document” ([MS-PPT] 2.3). */
  function scanPpt(b) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), r = { slides: 0, userEdits: 0, embeds: 0, links: 0, hyperlinks: [], comments: [], notes: [] };
    var seenNotes = {}, seenComments = {};
    function utf16(p, len) { var s = ''; for (var i = 0; i + 1 < len; i += 2) s += String.fromCharCode(dv.getUint16(p + i, true)); return s; }
    function latin(p, len) { return new TextDecoder('windows-1252').decode(b.subarray(p, p + len)); }
    function walk(start, end, ctx, depth) {
      var p = start, textType = -1;
      while (p + 8 <= end && depth < 40) {
        var vi = dv.getUint16(p, true), type = dv.getUint16(p + 2, true), len = dv.getUint32(p + 4, true);
        var ver = vi & 0xF, inst = vi >> 4, body = p + 8, next = body + len;
        if (next > end || next < body) break;
        if (type === RT.Slide) r.slides++;
        else if (type === RT.UserEdit) r.userEdits++;
        else if (type === RT.ExOleEmbed) r.embeds++;
        else if (type === RT.ExOleLink) r.links++;
        if (ver === 0xF) {
          var c = ctx;
          if (type === RT.Notes) c = { notes: [] };
          else if (type === RT.Comment10) c = { comment: {} };
          else if (type === RT.ExHyperlink) c = { link: [] };
          walk(body, next, c, depth + 1);
          if (type === RT.Notes) { var nt = c.notes.join('\n').trim(); if (nt && !seenNotes[nt]) { seenNotes[nt] = 1; r.notes.push(nt); } }
          if (type === RT.Comment10) { var key = (c.comment.author || '') + '|' + (c.comment.text || ''); if (!seenComments[key]) { seenComments[key] = 1; r.comments.push(c.comment); } }
          if (type === RT.ExHyperlink && c.link.length) r.hyperlinks.push(c.link.filter(Boolean).join(' → '));
        } else if (ctx) {
          if (type === RT.TextHeader && len >= 4) textType = dv.getUint32(body, true);
          if (ctx.notes && (type === RT.TextChars || type === RT.TextBytes) && (textType === 2 || textType === -1)) ctx.notes.push((type === RT.TextChars ? utf16(body, len) : latin(body, len)).replace(/\r/g, '\n'));
          if (ctx.comment && type === RT.CString) ctx.comment[['author', 'text', 'initials'][inst] || 'x'] = utf16(body, len);
          if (ctx.comment && type === RT.Comment10Atom && len >= 20) {
            var y = dv.getUint16(body + 4, true), mo = dv.getUint16(body + 6, true), dd = dv.getUint16(body + 10, true), hh = dv.getUint16(body + 12, true), mi = dv.getUint16(body + 14, true);
            var dt = new Date(y, mo - 1, dd, hh, mi);
            if (K.validDate(dt) && y > 1990) ctx.comment.date = dt;
          }
          if (ctx.link && type === RT.CString) ctx.link.push(utf16(body, len));
        }
        p = next;
      }
    }
    walk(0, b.length, null, 0);
    return r;
  }

  /** Strumień „Current User” – nazwa użytkownika, który ostatnio zapisał plik. */
  function readCurrentUser(b) {
    if (!b || b.length < 8 + 20) return null;
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint16(2, true) !== RT.CurrentUser) return null;
    var recLen = dv.getUint32(4, true), p = 8, token = dv.getUint32(p + 4, true), n = dv.getUint16(p + 12, true);
    var ansi = new TextDecoder('windows-1252').decode(b.subarray(p + 20, p + 20 + n));
    var uni = '', u = p + 20 + n + 4;
    if (8 + recLen >= u - 0 + n * 2 && u + n * 2 <= b.length) for (var i = 0; i < n; i++) uni += String.fromCharCode(dv.getUint16(u + i * 2, true));
    return { name: uni || ansi, encrypted: token === 0xF3D1C4DF, raw: b };
  }
  function writeCurrentUser(cu, name) {
    var b = cu.raw, dv = new DataView(b.buffer, b.byteOffset, b.byteLength), old = dv.getUint16(8 + 12, true);
    name = name.slice(0, 255);
    var n = name.length, head = b.subarray(8, 8 + 20), rel = b.subarray(8 + 20 + old, 8 + 20 + old + 4);
    var out = new Uint8Array(8 + 20 + n + 4 + n * 2), ov = new DataView(out.buffer);
    out.set(b.subarray(0, 8), 0); out.set(head, 8);
    ov.setUint32(4, 20 + n + 4 + n * 2, true);
    ov.setUint16(8 + 12, n, true);
    for (var i = 0; i < n; i++) out[8 + 20 + i] = name.charCodeAt(i) < 256 ? name.charCodeAt(i) : 63;
    out.set(rel.length === 4 ? rel : new Uint8Array([8, 0, 3, 0]), 8 + 20 + n);
    for (var k = 0; k < n; k++) ov.setUint16(8 + 20 + n + 4 + k * 2, name.charCodeAt(k), true);
    return out;
  }

  var PPT = {
    read: function (bytes) {
      var cfb = O.readCfb(bytes);
      if (cfb.find('EncryptedPackage') >= 0) { var e1 = new Error(); e1.code = 'encrypted_ooxml'; throw e1; }
      var pd = cfb.find('PowerPoint Document');
      if (pd < 0) { var e2 = new Error(); e2.code = 'not_ppt'; throw e2; }
      var m = OM.newModel('ppt');
      OM.oleRead(cfb, m, T);
      var d = m.info = {};
      d.cuIdx = cfb.find('Current User');
      d.cu = d.cuIdx >= 0 ? readCurrentUser(cfb.stream(d.cuIdx)) : null;
      d.encrypted = !!(d.cu && d.cu.encrypted) || cfb.find('EncryptedSummary') >= 0;
      d.scan = d.encrypted ? null : scanPpt(cfb.stream(pd));
      var pic = cfb.find('Pictures');
      d.pictures = pic >= 0 ? cfb.entries[pic].size : 0;
      d.macros = cfb.find('_VBA_PROJECT_CUR') >= 0 || cfb.find('VBA') >= 0;
      var sc = d.scan || { slides: 0, userEdits: 0, embeds: 0, links: 0, hyperlinks: [], comments: [], notes: [] };
      var det = m.details;
      det.push([T('d.format'), 'PPT (PowerPoint 97–2003, OLE)']);
      det.push([T('d.current_user'), d.cu ? d.cu.name || '—' : '—']);
      det.push([T('d.encrypted'), yesNo(d.encrypted)]);
      det.push([T('d.user_edits'), String(sc.userEdits)]);
      det.push([T('d.notes'), String(sc.notes.length)]);
      det.push([T('d.comments'), String(sc.comments.length)]);
      det.push([T('d.hyperlinks'), String(sc.hyperlinks.length)]);
      det.push([T('d.objects'), String(sc.embeds)]);
      det.push([T('d.linked'), String(sc.links)]);
      det.push([T('d.pictures'), d.pictures ? K.fmtBytes(d.pictures) : '0']);
      det.push([T('d.macros'), yesNo(d.macros)]);
      det.push([T('d.thumbnail'), yesNo(m.thumb)]);
      det.push([T('d.streams'), cfb.children(0).map(function (i) { return cfb.entries[i].name.replace(/[\u0000-\u001f]/g, function (c) { return '\\x0' + c.charCodeAt(0).toString(16); }); }).join(', ')]);
      if (sc.notes.length) m.lists.push({ icon: 'note', title: T('l.notes'), items: sc.notes.map(function (t) { return cut(t, 300); }) });
      if (sc.comments.length) m.lists.push({ icon: 'messages', title: T('l.comments'), items: sc.comments.map(function (c) { return (c.author || '?') + (c.date ? ' · ' + K.fmtLocal(c.date) : '') + ': ' + cut(c.text, 200); }) });
      if (sc.hyperlinks.length) m.lists.push({ icon: 'world', title: T('l.hyperlinks'), items: sc.hyperlinks.slice(0, 50) });

      if (d.cu && d.cu.name && !d.encrypted) m.options.anonymize = T('oi.current_user', { v: d.cu.name });
      if (m.thumb) m.options.removeThumbnail = '';
      if (d.encrypted) m.alerts.push(['warning', T('warn_ppt_encrypted')]);
      if (d.macros) m.alerts.push(['warning', T('warn_macros')]);
      m.alerts.push(['info', T('warn_ppt_readonly')]);

      var f = m.findings, F = m.fields;
      if (F.creator || F.lastModifiedBy) f.push(['user', 'warn', T('fi.author', { v: [F.creator, F.lastModifiedBy].filter(Boolean).join(' / ') })]);
      if (d.cu && d.cu.name) f.push(['user', 'warn', T('fi.current_user', { v: d.cu.name })]);
      if (F.company || F.manager) f.push(['building', 'warn', T('fi.company', { v: [F.company, F.manager].filter(Boolean).join(' / ') })]);
      if (sc.notes.length) f.push(['note', 'danger', T('fi.notes', { n: sc.notes.length })]);
      if (sc.comments.length) f.push(['messages', 'warn', T('fi.comments', { n: sc.comments.length, v: sc.comments.map(function (c) { return c.author; }).filter(function (a, i, x) { return a && x.indexOf(a) === i; }).join(', ') })]);
      if (sc.userEdits > 1) f.push(['history', 'danger', T('fi.user_edits', { n: sc.userEdits })]);
      if (sc.embeds) f.push(['paperclip', 'danger', T('fi.embeddings_ppt', { n: sc.embeds })]);
      if (sc.links) f.push(['link', 'warn', T('fi.externals', { n: sc.links })]);
      if (m.thumb) f.push(['photo', 'warn', T('fi.thumbnail_ppt')]);
      if (d.macros) f.push(['code', 'danger', T('fi.macros')]);
      if (m.custom.length) f.push(['list', 'warn', T('fi.custom', { v: m.custom.map(function (c) { return c.name; }).join(', ') })]);
      if (F.totalTime) f.push(['clock', 'info', T('fi.totaltime', { n: F.totalTime })]);
      if (F.created || F.modified) f.push(['calendar', 'info', T('fi.dates')]);
      return m;
    },
    write: function (m, v, o) {
      var contents = {}, add = [], d = m.info;
      OM.oleWrite(m, v, o, contents, add);
      if (o.anonymize && d.cu && d.cuIdx >= 0) contents[d.cuIdx] = writeCurrentUser(d.cu, o.anonName);
      return O.writeCfb(m.cfb, contents, add);
    }
  };

  /* ====================================================================== */
  /* Uruchomienie                                                           */
  /* ====================================================================== */

  var ui = OM.ui({
    root: root,
    prefix: 'tool.ppt-metadata.',
    opts: ['anonymize', 'removeComments', 'removeNotes', 'removeThumbnail', 'removeCustomXml', 'removeRevInfo', 'removePersonalInfo'],
    stripKeep: ['removeComments', 'removeNotes'],
    countStat: 'slides',
    detect: function (bytes) {
      if (X.isZip(bytes)) return PPTX;
      if (O.isCfb(bytes)) return PPT;
      var e = new Error(); e.code = 'unknown_format'; throw e;
    },
    formatLabel: function (m) { return m.format === 'pptx' ? 'PPTX (Office Open XML)' : 'PPT (PowerPoint 97–2003)'; },
    fileIcon: function () { return 'file-type-ppt'; },
    mime: function (m) { return m.format === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/vnd.ms-powerpoint'; }
  });
  T = ui.T;
})();
