/*
 * tools-php – narzędzie „Metadane Word” (DOCX, DOCM, DOTX, DOTM, DOC, DOT) (MIT)
 * Odczyt, edycja i czyszczenie metadanych w całości w przeglądarce – plik nie jest wysyłany na serwer.
 * Wspólna część (właściwości dokumentu, formularz, zapis, eksport): assets/js/lib/officemeta.js.
 * Tutaj: elementy specyficzne dla Worda – komentarze, śledzone zmiany, rsid, szablon, zmienne dokumentu,
 * a w DOC struktury FIB (autorzy komentarzy i zmian, historia zapisów, ciągi powiązane).
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-officemeta="word-metadata"]');
  if (!root || !window.OfficeMeta) return;

  var K = window.ToolKit, X = window.ToolsOoxml, O = window.ToolsOle, OM = window.OfficeMeta;
  var fmtBytes = K.fmtBytes, xmlText = K.xmlText, xmlAttr = K.xmlAttr, initials = K.initials, countBy = K.countBy;
  var Pkg = X.Pkg, REL_THUMB = X.REL_THUMB;
  var FIB = O.FIB, WORD_VER = O.WORD_VER, parseFib = O.parseFib, readSttb = O.readSttb, writeSttbExt = O.writeSttbExt,
    readXstGroup = O.readXstGroup, writeXstGroup = O.writeXstGroup;
  var ASSOC = ['', 'template', 'title', 'subject', 'keywords', '', 'author', 'lastRevBy', 'dataDoc', 'headerDoc'];
  var T, state = { file: null };
  function yesNo(v) { return v ? T('yes') : T('no'); }

  /* ====================================================================== */
  /* DOCX                                                                   */
  /* ====================================================================== */

  var DOCX = {
    read: function (bytes, ctx) {
      state.file = ctx.file;
      var pkg = X.open(bytes);
      var mainRel = pkg.relByType('', 'officeDocument');
      var main = mainRel ? mainRel.path : 'word/document.xml';
      if (!pkg.has(main) || !/^word\//.test(main)) { var e = new Error(); e.code = 'not_word_ooxml'; throw e; }
      var m = OM.newModel('docx');
      m.pkg = pkg; m.main = main;
      OM.ooxmlRead(pkg, m);
      DOCX.analyze(m);
      return m;
    },

    /** Szczegóły i elementy istotne dla prywatności (komentarze, poprawki, ścieżki, identyfikatory…). */
    analyze: function (m) {
      var pkg = m.pkg, files = pkg.files, names = Object.keys(files);
      var wordParts = names.filter(function (n) { return /^word\/(glossary\/)?[^/]+\.xml$/.test(n); });
      var mainXml = pkg.text(m.main) || '';
      var d = m.info = {};
      d.ext = (state && state.file && (/\.([a-z]+)$/i.exec(state.file.name) || [])[1] || 'docx').toLowerCase();
      // Komentarze
      var comRel = pkg.relByType(m.main, 'comments');
      d.commentsPath = comRel ? comRel.path : null;
      var comXml = d.commentsPath ? pkg.text(d.commentsPath) || '' : '';
      var commentAuthors = [], commentInitials = [];
      comXml.replace(/<w:comment\b([^>]*)>/g, function (all, a) {
        var au = /\bw:author="([^"]*)"/.exec(a), ini = /\bw:initials="([^"]*)"/.exec(a);
        commentAuthors.push(au ? xmlText(au[1]) : '');
        if (ini) commentInitials.push(xmlText(ini[1]));
        return all;
      });
      d.comments = commentAuthors.length;
      d.commentAuthors = countBy(commentAuthors.filter(Boolean));
      // Śledzone zmiany
      var revAuthors = [];
      var reRev = /<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|tblGridChange|cellIns|cellDel|cellMerge|numberingChange)\b[^>]*?\bw:author="([^"]*)"/g;
      wordParts.forEach(function (p) {
        if (p === d.commentsPath) return;
        var x = pkg.text(p), r;
        reRev.lastIndex = 0;
        while ((r = reRev.exec(x))) revAuthors.push(xmlText(r[2]));
      });
      d.revisions = revAuthors.length;
      d.revisionAuthors = countBy(revAuthors);
      // Osoby (people.xml) – mogą zawierać adresy e-mail i identyfikatory kont
      var people = [];
      names.filter(function (n) { return /^word\/people\.xml$/.test(n); }).forEach(function (p) {
        var x = pkg.text(p);
        x.replace(/<w15:person\b[^>]*\bw15:author="([^"]*)"[^>]*>([\s\S]*?)<\/w15:person>|<w15:person\b[^>]*\bw15:author="([^"]*)"[^>]*\/>/g, function (all, a1, inner, a2) {
          var who = xmlText(a1 || a2 || ''), extra = '';
          var pi = inner && /w15:providerId="([^"]*)"[^>]*w15:userId="([^"]*)"/.exec(inner);
          if (pi) extra = ' (' + xmlText(pi[2]) + ', ' + xmlText(pi[1]) + ')';
          people.push(who + extra);
          return all;
        });
      });
      d.people = people;
      d.peoplePath = names.indexOf('word/people.xml') !== -1 ? 'word/people.xml' : null;
      // Ustawienia
      var setRel = pkg.relByType(m.main, 'settings');
      d.settingsPath = setRel ? setRel.path : null;
      var st = d.settingsPath ? pkg.text(d.settingsPath) || '' : '';
      d.trackRevisions = /<w:trackRevisions(?![^>]*w:val="(?:0|false|off)")[^>]*\/?>/.test(st);
      d.rsids = (st.match(/<w:rsid\b/g) || []).length + (st.match(/<w:rsidRoot\b/g) || []).length;
      d.rsidAttrs = 0;
      wordParts.forEach(function (p) { d.rsidAttrs += ((pkg.text(p) || '').match(/\sw:rsid[A-Za-z]*="/g) || []).length; });
      d.removePI = /<w:removePersonalInformation\b/.test(st);
      var prot = /<w:documentProtection\b([^>]*)\/?>/.exec(st);
      d.protection = prot && !/w:enforcement="(0|false|off)"/.test(prot[1]) ? ((/w:edit="([^"]*)"/.exec(prot[1]) || [])[1] || 'on') : '';
      d.docVars = [];
      st.replace(/<w:docVar\b[^>]*\bw:name="([^"]*)"[^>]*\bw:val="([^"]*)"/g, function (all, n, v) { d.docVars.push(xmlText(n) + ' = ' + xmlText(v).slice(0, 200)); return all; });
      d.template = '';
      var tm = /<w:attachedTemplate\b[^>]*\br:id="([^"]*)"/.exec(st);
      if (tm && d.settingsPath) {
        var tr = pkg.rels(d.settingsPath).filter(function (r) { return r.id === tm[1]; })[0];
        if (tr) { d.template = tr.target; d.templateRelId = tr.id; }
      }
      // Relacje zewnętrzne (ścieżki lokalne, adresy)
      d.hyperlinks = [];
      d.externals = [];
      pkg.allRelsFiles().forEach(function (rp) {
        pkg.rels(pkg.sourceOf(rp)).forEach(function (r) {
          if (!r.external) return;
          var kind = r.type.slice(r.type.lastIndexOf('/') + 1);
          if (kind === 'hyperlink') d.hyperlinks.push(r.target);
          else d.externals.push(kind + ': ' + r.target);
        });
      });
      // Elementy pakietu
      var media = names.filter(function (n) { return /^word\/media\//.test(n); });
      d.media = media.length;
      d.mediaSize = media.reduce(function (s, n) { return s + files[n].length; }, 0);
      d.embeddings = names.filter(function (n) { return /^word\/embeddings\//.test(n); });
      d.macros = names.some(function (n) { return /vbaProject\.bin$/i.test(n); });
      d.customXml = names.filter(function (n) { return /^customXml\/item\d+\.xml$/.test(n); });
      var spItems = d.customXml.filter(function (n) { return /sharepoint|schemas\.microsoft\.com\/office\/(2006\/metadata|infopath)/i.test(pkg.text(n) || ''); });
      d.sharepoint = spItems.length;
      var th = pkg.relByType('', REL_THUMB);
      d.thumbnail = th && pkg.has(th.path) ? th.path : null;
      d.fonts = names.filter(function (n) { return /^word\/fonts\//.test(n); }).length;
      d.glossary = names.some(function (n) { return /^word\/glossary\//.test(n); });
      d.hidden = (mainXml.match(/<w:vanish(?:\s*\/>|\s+w:val="(?:1|true|on)")/g) || []).length;
      d.files = names.length;

      // Szczegóły
      var det = m.details;
      det.push([T('d.format'), d.ext.toUpperCase() + ' (Office Open XML)']);
      det.push([T('d.parts'), String(d.files)]);
      det.push([T('d.comments'), String(d.comments)]);
      det.push([T('d.revisions'), String(d.revisions)]);
      det.push([T('d.track'), yesNo(d.trackRevisions)]);
      det.push([T('d.rsids'), d.rsids + ' / ' + d.rsidAttrs]);
      det.push([T('d.template_path'), d.template || '—']);
      det.push([T('d.docvars'), String(d.docVars.length)]);
      det.push([T('d.hyperlinks'), String(d.hyperlinks.length)]);
      det.push([T('d.externals'), String(d.externals.length)]);
      det.push([T('d.media'), d.media + (d.media ? ' (' + fmtBytes(d.mediaSize) + ')' : '')]);
      det.push([T('d.embeddings'), String(d.embeddings.length)]);
      det.push([T('d.macros'), yesNo(d.macros)]);
      det.push([T('d.customxml'), d.customXml.length + (d.sharepoint ? ' (' + T('d.sharepoint') + ')' : '')]);
      det.push([T('d.thumbnail'), yesNo(!!d.thumbnail)]);
      det.push([T('d.hidden'), String(d.hidden)]);
      det.push([T('d.fonts'), String(d.fonts)]);
      det.push([T('d.protection'), d.protection || T('no')]);
      det.push([T('d.remove_pi'), yesNo(d.removePI)]);
      var mapList = function (o) { return Object.keys(o).map(function (k) { return k + ' (' + o[k] + ')'; }); };
      if (d.comments) m.lists.push({ icon: 'messages', title: T('l.comment_authors'), items: mapList(d.commentAuthors) });
      if (d.revisions) m.lists.push({ icon: 'git-compare', title: T('l.revision_authors'), items: mapList(d.revisionAuthors) });
      if (d.people.length) m.lists.push({ icon: 'users', title: T('l.people'), items: d.people });
      if (d.docVars.length) m.lists.push({ icon: 'variable', title: T('l.docvars'), items: d.docVars });
      if (d.externals.length) m.lists.push({ icon: 'link', title: T('l.externals'), items: d.externals });
      if (d.hyperlinks.length) m.lists.push({ icon: 'world', title: T('l.hyperlinks'), items: d.hyperlinks.slice(0, 50).concat(d.hyperlinks.length > 50 ? ['…'] : []) });
      if (d.embeddings.length) m.lists.push({ icon: 'paperclip', title: T('l.embeddings'), items: d.embeddings.map(function (n) { return n.replace(/^word\/embeddings\//, '') + ' (' + fmtBytes(files[n].length) + ')'; }) });

      // Opcje czyszczenia
      var nAuth = Object.keys(d.commentAuthors).length + Object.keys(d.revisionAuthors).length;
      if (nAuth || d.people.length) m.options.anonymize = T('oi.authors', { n: Object.keys(Object.assign({}, d.commentAuthors, d.revisionAuthors)).length || d.people.length });
      if (d.comments) m.options.removeComments = T('oi.comments', { n: d.comments });
      if (d.rsids || d.rsidAttrs) m.options.removeRsid = T('oi.rsids', { n: d.rsidAttrs });
      if (d.template) m.options.removeTemplate = d.template;
      if (d.docVars.length) m.options.removeDocVars = T('oi.count', { n: d.docVars.length });
      if (d.thumbnail) m.options.removeThumbnail = '';
      if (d.customXml.length) m.options.removeCustomXml = T('oi.count', { n: d.customXml.length });
      if (!d.removePI) m.options.removePersonalInfo = T('oi.remove_pi');

      // Ostrzeżenia
      if (d.protection) m.alerts.push(['info', T('warn_protection', { v: d.protection })]);
      if (d.macros) m.alerts.push(['warning', T('warn_macros')]);

      // Raport prywatności
      var f = m.findings, F = m.fields;
      if (F.creator || F.lastModifiedBy) f.push(['user', 'warn', T('fi.author', { v: [F.creator, F.lastModifiedBy].filter(Boolean).join(' / ') })]);
      if (F.company || F.manager) f.push(['building', 'warn', T('fi.company', { v: [F.company, F.manager].filter(Boolean).join(' / ') })]);
      if (d.comments) f.push(['messages', 'warn', T('fi.comments', { n: d.comments, v: Object.keys(d.commentAuthors).join(', ') })]);
      if (d.revisions) f.push(['git-compare', 'danger', T('fi.revisions', { n: d.revisions, v: Object.keys(d.revisionAuthors).join(', ') })]);
      if (d.people.length) f.push(['users', 'warn', T('fi.people', { n: d.people.length })]);
      if (d.template && /^(file:|[a-z]:\\|\\\\|\/)/i.test(d.template)) f.push(['template', 'warn', T('fi.template', { v: d.template })]);
      if (d.externals.length) f.push(['link', 'warn', T('fi.externals', { n: d.externals.length })]);
      if (d.docVars.length) f.push(['variable', 'warn', T('fi.docvars', { n: d.docVars.length })]);
      if (d.rsids || d.rsidAttrs) f.push(['fingerprint', 'info', T('fi.rsids')]);
      if (d.customXml.length) f.push(['database', d.sharepoint ? 'warn' : 'info', T(d.sharepoint ? 'fi.sharepoint' : 'fi.customxml', { n: d.customXml.length })]);
      if (d.hidden) f.push(['eye-off', 'warn', T('fi.hidden', { n: d.hidden })]);
      if (d.thumbnail) f.push(['photo', 'info', T('fi.thumbnail')]);
      if (d.embeddings.length) f.push(['paperclip', 'warn', T('fi.embeddings', { n: d.embeddings.length })]);
      if (d.media) f.push(['photo', 'info', T('fi.media', { n: d.media })]);
      if (d.macros) f.push(['code', 'danger', T('fi.macros')]);
      if (m.custom.length) f.push(['list', 'warn', T('fi.custom', { v: m.custom.map(function (c) { return c.name; }).join(', ') })]);
      if (F.totalTime) f.push(['clock', 'info', T('fi.totaltime', { n: F.totalTime })]);
      if (F.created || F.modified) f.push(['calendar', 'info', T('fi.dates')]);
    },

    write: function (m, v, o) {
      var pkg = new Pkg(Object.assign({}, m.pkg.files));
      var info = m.info;
      OM.ooxmlWrite(pkg, m, v);
      var wordParts = function () { return Object.keys(pkg.files).filter(function (n) { return /^word\/(glossary\/)?[^/]+\.xml$/.test(n); }); };
      var edit = function (p, fn) { var x = pkg.text(p); if (x != null) { var y = fn(x); if (y !== x) pkg.setText(p, y); } };

      // --- komentarze: usunięcie
      if (o.removeComments && info.commentsPath) {
        wordParts().forEach(function (p) {
          edit(p, function (x) {
            return x.replace(/<w:commentRangeStart\b[^>]*\/>/g, '').replace(/<w:commentRangeEnd\b[^>]*\/>/g, '')
              .replace(/<w:r\b(?:(?!<w:r[ >])[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<w:r[ >])[\s\S])*?<\/w:r>/g, '')
              .replace(/<w:commentReference\b[^>]*\/>/g, '');
          });
        });
        ['comments', 'commentsExtended', 'commentsIds', 'commentsExtensible'].forEach(function (t) {
          var r = pkg.relByType(m.main, t);
          if (r) pkg.removePart(r.path);
        });
        pkg.removePart(info.commentsPath);
      }
      // --- anonimizacja autorów komentarzy i zmian
      if (o.anonymize) {
        var nm = xmlAttr(o.anonName || T('anon_default')), ini = xmlAttr(initials(o.anonName || T('anon_default')));
        wordParts().forEach(function (p) {
          edit(p, function (x) { return x.replace(/\bw:author="[^"]*"/g, 'w:author="' + nm + '"').replace(/\bw:initials="[^"]*"/g, 'w:initials="' + ini + '"'); });
        });
        if (info.peoplePath) pkg.removePart(info.peoplePath);
      }
      // --- identyfikatory sesji edycji (rsid)
      if (o.removeRsid) {
        wordParts().forEach(function (p) { edit(p, function (x) { return x.replace(/\sw:rsid[A-Za-z]*="[0-9A-Fa-f]*"/g, ''); }); });
        if (info.settingsPath) edit(info.settingsPath, function (x) { return x.replace(/<w:rsids>[\s\S]*?<\/w:rsids>|<w:rsids\s*\/>/g, ''); });
      }
      // --- szablon
      if (o.removeTemplate && info.settingsPath) {
        edit(info.settingsPath, function (x) { return x.replace(/<w:attachedTemplate\b[^>]*\/>/g, ''); });
        if (info.templateRelId) pkg.removeRelId(info.settingsPath, info.templateRelId);
      }
      // --- zmienne dokumentu
      if (o.removeDocVars && info.settingsPath) edit(info.settingsPath, function (x) { return x.replace(/<w:docVars>[\s\S]*?<\/w:docVars>|<w:docVars\s*\/>/g, ''); });
      // --- miniatura
      if (o.removeThumbnail && info.thumbnail) pkg.removePart(info.thumbnail);
      // --- customXml (np. metadane SharePoint)
      if (o.removeCustomXml) OM.ooxmlRemoveCustomXml(pkg);
      // --- „Usuń dane osobowe przy zapisie” (Word usunie je przy następnym zapisie)
      if (o.removePersonalInfo && info.settingsPath) {
        edit(info.settingsPath, function (x) {
          if (/<w:removePersonalInformation\b/.test(x)) return x;
          var add = '<w:removePersonalInformation/><w:removeDateAndTime/>';
          var anchor = /<w:zoom\b[^>]*\/>|<w:zoom\b[^>]*>[\s\S]*?<\/w:zoom>/.exec(x) || /<w:view\b[^>]*\/>/.exec(x) || /<w:writeProtection\b[^>]*\/>/.exec(x);
          if (anchor) return x.slice(0, anchor.index + anchor[0].length) + add + x.slice(anchor.index + anchor[0].length);
          return x.replace(/(<w:settings\b[^>]*>)/, '$1' + add);
        });
      }
      return X.save(pkg);
    }
  };

  /* ====================================================================== */
  /* DOC – Word 97–2003                                                     */
  /* ====================================================================== */

  var DOC = {
    read: function (bytes, ctx) {
      state.file = ctx.file;
      var cfb = O.readCfb(bytes);
      if (cfb.find('EncryptedPackage') >= 0 || cfb.find('EncryptionInfo') >= 0) { var e1 = new Error(); e1.code = 'encrypted_ooxml'; throw e1; }
      var wIdx = cfb.find('WordDocument');
      if (wIdx < 0) { var e2 = new Error(); e2.code = 'not_word_doc'; throw e2; }
      var m = OM.newModel('doc');
      m.wIdx = wIdx;
      OM.oleRead(cfb, m, T);
      DOC.analyze(m);
      return m;
    },
    analyze: function (m) {
      var cfb = m.cfb, d = m.info = {};
      var w = cfb.stream(m.wIdx), fib = parseFib(w);
      d.fib = fib;
      d.rootNames = cfb.children(0).map(function (i) { return cfb.entries[i].name; });
      d.macros = cfb.find('Macros') >= 0 || cfb.find('_VBA_PROJECT_CUR') >= 0;
      var op = cfb.find('ObjectPool');
      d.objects = op >= 0 ? cfb.children(op).length : 0;
      if (!fib) { m.alerts.push(['warning', T('warn_fib')]); m.readonlyFib = true; }
      else if (fib.old) { m.alerts.push(['info', T('warn_old')]); m.readonlyFib = true; }
      else if (fib.encrypted || fib.obfuscated) { m.alerts.push(['warning', T('warn_doc_encrypted')]); m.readonlyFib = true; }
      var tIdx = fib ? cfb.find(fib.table) : -1;
      d.tIdx = tIdx;
      var t = tIdx >= 0 && !m.readonlyFib ? cfb.stream(tIdx) : null;
      d.savedBy = []; d.assoc = []; d.atnOwners = []; d.rmark = []; d.comments = 0;
      if (t && fib.get) {
        var sb = readSttb(t, fib.get(FIB.sttbSavedBy));
        for (var i = 0; i + 1 < sb.length; i += 2) d.savedBy.push(sb[i] + ' — ' + sb[i + 1]);
        d.assocRaw = readSttb(t, fib.get(FIB.sttbfAssoc));
        d.assocRaw.forEach(function (s, k) { if (s && ASSOC[k]) d.assoc.push(T('assoc.' + ASSOC[k]) + ': ' + s); });
        d.atnOwners = readXstGroup(t, fib.get(FIB.grpXstAtnOwners));
        d.rmark = readSttb(t, fib.get(FIB.sttbfRMark));
        var pr = fib.get(FIB.plcfandRef);
        d.comments = pr && pr.lcb >= 4 ? Math.max(0, Math.round((pr.lcb - 4) / 34)) : 0;
      }
      var realRmark = d.rmark.filter(function (s) { return s && s !== 'Unknown'; });
      var det = m.details;
      det.push([T('d.format'), 'DOC (Word 97–2003, OLE)']);
      if (fib) {
        det.push([T('d.word_version'), (WORD_VER[fib.nFibNew || fib.nFib] || 'nFib 0x' + (fib.nFibNew || fib.nFib).toString(16)) + (fib.dot ? ' – ' + T('d.template_file') : '')]);
        det.push([T('d.lang_id'), '0x' + fib.lid.toString(16).padStart(4, '0')]);
        det.push([T('d.encrypted'), yesNo(fib.encrypted || fib.obfuscated)]);
        det.push([T('d.fast_saves'), fib.complex ? T('yes') + ' (' + fib.quickSaves + ')' : T('no')]);
        det.push([T('d.readonly_rec'), yesNo(fib.readOnlyRec)]);
      }
      det.push([T('d.comments'), String(d.comments)]);
      det.push([T('d.comment_authors'), String(d.atnOwners.length)]);
      det.push([T('d.revision_authors'), String(realRmark.length)]);
      det.push([T('d.saved_by'), String(d.savedBy.length)]);
      det.push([T('d.macros'), yesNo(d.macros)]);
      det.push([T('d.objects'), String(d.objects)]);
      det.push([T('d.thumbnail'), yesNo(m.thumb)]);
      det.push([T('d.streams'), d.rootNames.map(function (n) { return n.replace(/[\u0000-\u001f]/g, function (c) { return '\\x0' + c.charCodeAt(0).toString(16); }); }).join(', ')]);
      if (d.atnOwners.length) m.lists.push({ icon: 'messages', title: T('l.comment_authors'), items: d.atnOwners });
      if (realRmark.length) m.lists.push({ icon: 'git-compare', title: T('l.revision_authors'), items: realRmark });
      if (d.savedBy.length) m.lists.push({ icon: 'history', title: T('l.saved_by'), items: d.savedBy });
      if (d.assoc.length) m.lists.push({ icon: 'template', title: T('l.assoc'), items: d.assoc });

      if (!m.readonlyFib) {
        if (d.atnOwners.length || realRmark.length) m.options.anonymize = T('oi.authors', { n: d.atnOwners.length + realRmark.length });
        if (d.savedBy.length) m.options.removeSavedBy = T('oi.count', { n: d.savedBy.length / 1 });
        if (d.assoc.length) m.options.removeTemplate = T('oi.assoc');
      }
      if (m.thumb) m.options.removeThumbnail = '';
      if (d.macros) m.alerts.push(['warning', T('warn_macros')]);

      var f = m.findings, F = m.fields;
      if (F.creator || F.lastModifiedBy) f.push(['user', 'warn', T('fi.author', { v: [F.creator, F.lastModifiedBy].filter(Boolean).join(' / ') })]);
      if (F.company || F.manager) f.push(['building', 'warn', T('fi.company', { v: [F.company, F.manager].filter(Boolean).join(' / ') })]);
      if (d.comments || d.atnOwners.length) f.push(['messages', 'warn', T('fi.comments', { n: d.comments, v: d.atnOwners.join(', ') })]);
      if (realRmark.length) f.push(['git-compare', 'danger', T('fi.revisions_doc', { v: realRmark.join(', ') })]);
      if (d.savedBy.length) f.push(['history', 'danger', T('fi.saved_by', { n: d.savedBy.length })]);
      if (F.template && /[\\/]/.test(F.template) || d.assocRaw && d.assocRaw[1]) f.push(['template', 'warn', T('fi.template', { v: (d.assocRaw && d.assocRaw[1]) || F.template })]);
      if (fib && fib.complex) f.push(['history', 'danger', T('fi.fast_save')]);
      if (d.objects) f.push(['paperclip', 'warn', T('fi.embeddings', { n: d.objects })]);
      if (d.macros) f.push(['code', 'danger', T('fi.macros')]);
      if (m.thumb) f.push(['photo', 'info', T('fi.thumbnail')]);
      if (m.custom.length) f.push(['list', 'warn', T('fi.custom', { v: m.custom.map(function (c) { return c.name; }).join(', ') })]);
      if (F.totalTime) f.push(['clock', 'info', T('fi.totaltime', { n: F.totalTime })]);
      if (F.created || F.modified) f.push(['calendar', 'info', T('fi.dates')]);
      f.push(['file-search', 'info', T('fi.doc_body')]);
    },
    write: function (m, v, o) {
      var cfb = m.cfb, contents = {}, add = [], d = m.info;
      OM.oleWrite(m, v, o, contents, add);
      // --- Struktury Worda w strumieniu tabel (autorzy, historia zapisów, ścieżki)
      if (!m.readonlyFib && d.tIdx >= 0 && (o.anonymize || o.removeSavedBy || o.removeTemplate)) {
        var w = new Uint8Array(cfb.stream(m.wIdx)), t = cfb.stream(d.tIdx), fib = parseFib(w), wdv = new DataView(w.buffer);
        var tail = [], tlen = t.length;
        var setFcLcb = function (i, fc, lcb) { var e = fib.get(i); if (!e) return; wdv.setUint32(e.off, fc, true); wdv.setUint32(e.off + 4, lcb, true); };
        var clear = function (i) { var e = fib.get(i); if (e && e.lcb && e.fc + e.lcb <= t.length) t.fill(0, e.fc, e.fc + e.lcb); };
        var place = function (i, bytes) { clear(i); setFcLcb(i, tlen, bytes.length); tail.push(bytes); tlen += bytes.length; };
        t = new Uint8Array(t);
        if (o.removeSavedBy && d.savedBy.length) { clear(FIB.sttbSavedBy); setFcLcb(FIB.sttbSavedBy, fib.get(FIB.sttbSavedBy).fc, 0); }
        if (o.removeTemplate && d.assocRaw && d.assocRaw.length) {
          place(FIB.sttbfAssoc, writeSttbExt(d.assocRaw.map(function () { return ''; })));
        }
        if (o.anonymize) {
          var nm = (o.anonName || T('anon_default')).slice(0, 50);
          if (d.atnOwners.length) {
            place(FIB.grpXstAtnOwners, writeXstGroup(d.atnOwners.map(function () { return nm; })));
            // inicjały w ATRDPre10 (PlcfandRef)
            var pr = fib.get(FIB.plcfandRef), ini = initials(nm), tdv = new DataView(t.buffer);
            if (pr && pr.lcb >= 4) {
              var n = Math.round((pr.lcb - 4) / 34), base = pr.fc + (n + 1) * 4;
              for (var k = 0; k < n; k++) {
                var a = base + k * 30;
                if (a + 20 > t.length) break;
                t.fill(0, a, a + 20);
                tdv.setUint16(a, ini.length, true);
                for (var c = 0; c < ini.length && c < 9; c++) tdv.setUint16(a + 2 + c * 2, ini.charCodeAt(c), true);
              }
            }
          }
          if (d.rmark.length) place(FIB.sttbfRMark, writeSttbExt(d.rmark.map(function (s, k) { return k === 0 && s === 'Unknown' ? s : nm; })));
        }
        var nt = new Uint8Array(tlen);
        nt.set(t, 0);
        var p = t.length;
        tail.forEach(function (b) { nt.set(b, p); p += b.length; });
        contents[d.tIdx] = nt;
        contents[m.wIdx] = w;
      }
      return O.writeCfb(cfb, contents, add);
    }
  };

  /* ====================================================================== */
  /* Uruchomienie                                                           */
  /* ====================================================================== */

  T = OM.ui({
    root: root,
    prefix: 'tool.word-metadata.',
    opts: ['anonymize', 'removeComments', 'removeRsid', 'removeTemplate', 'removeDocVars', 'removeThumbnail', 'removeCustomXml', 'removeSavedBy', 'removePersonalInfo'],
    countStat: 'pages',
    detect: function (bytes) {
      if (X.isZip(bytes)) return DOCX;
      if (O.isCfb(bytes)) return DOC;
      var head = K.latin1(bytes, 0, Math.min(bytes.length, 512)), e = new Error();
      e.code = /^\{\\rtf/.test(head) ? 'is_rtf' : /<html|<\?xml|<w:wordDocument/i.test(head) ? 'is_xml' : 'unknown_format';
      throw e;
    },
    formatLabel: function (m) { return m.format === 'docx' ? 'DOCX (Office Open XML)' : 'DOC (Word 97–2003)'; },
    fileIcon: function (m) { return m.format === 'docx' ? 'file-type-docx' : 'file-type-doc'; },
    mime: function (m) { return m.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'; }
  }).T;
})();
