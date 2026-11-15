/*
 * tools-php – narzędzie „Metadane Word” (DOCX, DOCM, DOTX, DOTM, DOC, DOT) (MIT)
 * Odczyt, edycja i czyszczenie metadanych w całości w przeglądarce – plik nie jest wysyłany na serwer.
 *  - DOCX: pakiet ZIP (biblioteka fflate, MIT) + pliki XML (docProps, word/*).
 *  - DOC:  własny czytnik i zapis plików OLE / Compound File Binary ([MS-CFB]), zestawów właściwości
 *          ([MS-OLEPS]: SummaryInformation, DocumentSummaryInformation) oraz struktur FIB Worda ([MS-DOC]).
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-wordm]');
  if (!root || !window.fflate || !window.ToolKit || !window.ToolsOle || !window.ToolsOoxml) return;

  var T = function (k, p) { return App.t('tool.word-metadata.' + k, p); };
  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
  var LANG = (App.cfg && App.cfg.lang) || 'pl';
  var esc = App.esc;

  var FIELDS = ['title', 'subject', 'creator', 'keywords', 'description', 'lastModifiedBy', 'category', 'contentStatus',
    'company', 'manager', 'template', 'revision', 'totalTime', 'language', 'created', 'modified', 'lastPrinted'];
  var DATE_F = { created: 1, modified: 1, lastPrinted: 1 };
  var OPTS = ['anonymize', 'removeComments', 'removeRsid', 'removeTemplate', 'removeDocVars', 'removeThumbnail', 'removeCustomXml', 'removeSavedBy', 'removePersonalInfo'];

  var state = null; // { file, bytes, model, adapter }

  /* ====================================================================== */
  /* Pomocnicze                                                             */
  /* ====================================================================== */

  var K = window.ToolKit, X = window.ToolsOoxml, O = window.ToolsOle;
  var pad = K.pad, fmtBytes = K.fmtBytes, fmtLocal = K.fmtLocal, toInput = K.toInput, isoUtc = K.isoUtc, validDate = K.validDate,
    download = K.download, baseName = K.baseName, xmlText = K.xmlText, xmlAttr = K.xmlAttr, initials = K.initials, countBy = K.countBy, latin1 = K.latin1;
  function show(el, on) { if (el) el.hidden = !on; }
  function yesNo(v) { return v ? T('yes') : T('no'); }

  /* ====================================================================== */
  /* DOCX – pakiet Open XML                                                 */
  /* ====================================================================== */

  var NS = X.NS, REL = X.REL, REL_CORE = X.REL_CORE, REL_THUMB = X.REL_THUMB, XML_DECL = X.XML_DECL, Pkg = X.Pkg,
    parseXml = X.parseXml, serialize = X.serialize, childNS = X.childNS, soleNS = X.soleNS, parseW3C = X.parseW3C;
  var CORE = {
    title: ['dc', 'title'], subject: ['dc', 'subject'], creator: ['dc', 'creator'], keywords: ['cp', 'keywords'],
    description: ['dc', 'description'], lastModifiedBy: ['cp', 'lastModifiedBy'], revision: ['cp', 'revision'],
    category: ['cp', 'category'], contentStatus: ['cp', 'contentStatus'], language: ['dc', 'language'],
    created: ['dcterms', 'created'], modified: ['dcterms', 'modified'], lastPrinted: ['cp', 'lastPrinted']
  };
  var APPF = { company: 'Company', manager: 'Manager', template: 'Template', totalTime: 'TotalTime' };
  var DOCX = {
    name: 'docx',
    read: function (bytes) {
      var files;
      var pkg = X.open(bytes);
      var mainRel = pkg.relByType('', 'officeDocument');
      var main = mainRel ? mainRel.path : 'word/document.xml';
      if (!pkg.has(main) || !/^word\//.test(main)) throw new Error(T('not_word_ooxml'));
      var m = { format: 'docx', fields: {}, src: {}, stats: [], custom: [], details: [], lists: [], findings: [], options: {}, alerts: [], readonly: false };
      m.pkg = pkg; m.main = main;

      // Właściwości podstawowe (core.xml)
      var coreRel = pkg.relByType('', REL_CORE) || pkg.relByType('', 'core-properties');
      m.corePath = coreRel ? coreRel.path : null;
      var core = m.corePath && pkg.has(m.corePath) ? parseXml(pkg.text(m.corePath)) : null;
      Object.keys(CORE).forEach(function (f) {
        var el = core ? childNS(core.documentElement, NS[CORE[f][0]], CORE[f][1]) : null;
        var v = el ? el.textContent : null;
        m.fields[f] = v == null ? null : DATE_F[f] ? parseW3C(v) : v;
        m.src[f] = CORE[f][0] + ':' + CORE[f][1];
      });
      // Właściwości rozszerzone (app.xml)
      var appRel = pkg.relByType('', 'extended-properties');
      m.appPath = appRel ? appRel.path : null;
      var app = m.appPath && pkg.has(m.appPath) ? parseXml(pkg.text(m.appPath)) : null;
      var appGet = function (n) { var el = app ? childNS(app.documentElement, NS.ep, n) : null; return el ? el.textContent : null; };
      Object.keys(APPF).forEach(function (f) {
        var v = appGet(APPF[f]);
        m.fields[f] = v == null ? null : f === 'totalTime' ? (+v || 0) : v;
        m.src[f] = 'app:' + APPF[f];
      });
      [['Application', 'application'], ['AppVersion', 'appVersion'], ['Pages', 'pages'], ['Words', 'words'], ['Characters', 'characters'],
        ['CharactersWithSpaces', 'charactersWithSpaces'], ['Lines', 'lines'], ['Paragraphs', 'paragraphs'], ['DocSecurity', 'docSecurity'],
        ['HyperlinkBase', 'hyperlinkBase'], ['SharedDoc', 'sharedDoc'], ['LinksUpToDate', 'linksUpToDate']].forEach(function (p) {
        var v = appGet(p[0]);
        if (v != null && v !== '') m.stats.push([T('s.' + p[1]), v]);
      });
      // Właściwości niestandardowe (custom.xml)
      var custRel = pkg.relByType('', 'custom-properties');
      m.customPath = custRel ? custRel.path : null;
      if (m.customPath && pkg.has(m.customPath)) {
        var cd = parseXml(pkg.text(m.customPath));
        Array.prototype.forEach.call(cd.documentElement.children, function (p) {
          var v = p.firstElementChild;
          if (!v) return;
          var t = v.localName, item = { name: p.getAttribute('name') || '', raw: new XMLSerializer().serializeToString(v) };
          if (/^(lpwstr|lpstr|bstr)$/.test(t)) { item.type = 'text'; item.value = v.textContent; }
          else if (/^(i1|i2|i4|i8|int|ui1|ui2|ui4|ui8|uint|r4|r8|decimal)$/.test(t)) { item.type = 'number'; item.value = v.textContent; }
          else if (t === 'bool') { item.type = 'bool'; item.value = /^(true|1)$/i.test(v.textContent.trim()); }
          else if (t === 'filetime' || t === 'date') { item.type = 'date'; item.value = parseW3C(v.textContent); }
          else { item.type = 'other'; item.value = v.textContent; item.vtype = t; }
          m.custom.push(item);
        });
      }
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
      // --- core.xml
      var anyCore = Object.keys(CORE).some(function (f) { return v.fields[f] != null; });
      var corePath = m.corePath && pkg.has(m.corePath) ? m.corePath : null;
      if (corePath || anyCore) {
        if (!corePath) {
          corePath = 'docProps/core.xml';
          pkg.setText(corePath, XML_DECL + '<cp:coreProperties xmlns:cp="' + NS.cp + '" xmlns:dc="' + NS.dc + '" xmlns:dcterms="' + NS.dcterms + '" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="' + NS.xsi + '"></cp:coreProperties>');
          pkg.addRel('', REL_CORE, corePath);
          pkg.addOverride(corePath, 'application/vnd.openxmlformats-package.core-properties+xml');
        }
        var cd = parseXml(pkg.text(corePath)), cr = cd.documentElement;
        Object.keys(CORE).forEach(function (f) {
          var ns = NS[CORE[f][0]], local = CORE[f][1], el = soleNS(cr, ns, local), val = v.fields[f];
          if (val == null || val === '') { if (el) cr.removeChild(el); return; }
          if (!el) {
            el = cd.createElementNS(ns, CORE[f][0] + ':' + local);
            cr.appendChild(el);
          }
          if (DATE_F[f]) {
            el.textContent = isoUtc(val);
            if (f !== 'lastPrinted') el.setAttributeNS(NS.xsi, 'xsi:type', 'dcterms:W3CDTF');
          } else el.textContent = String(val);
        });
        pkg.setText(corePath, serialize(cd));
      }
      // --- app.xml
      var appPath = m.appPath && pkg.has(m.appPath) ? m.appPath : null;
      var anyApp = Object.keys(APPF).some(function (f) { return v.fields[f] != null && v.fields[f] !== ''; });
      if (!appPath && anyApp) {
        appPath = 'docProps/app.xml';
        pkg.setText(appPath, XML_DECL + '<Properties xmlns="' + NS.ep + '" xmlns:vt="' + NS.vt + '"></Properties>');
        pkg.addRel('', REL + 'extended-properties', appPath);
        pkg.addOverride(appPath, 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
      }
      if (appPath) {
        var ad = parseXml(pkg.text(appPath)), ar = ad.documentElement;
        Object.keys(APPF).forEach(function (f) {
          var el = soleNS(ar, NS.ep, APPF[f]), val = v.fields[f];
          if (val == null || val === '') { if (el) ar.removeChild(el); return; }
          if (!el) { el = ad.createElementNS(NS.ep, APPF[f]); ar.appendChild(el); }
          el.textContent = f === 'totalTime' ? String(Math.max(0, Math.round(+val || 0))) : String(val);
        });
        pkg.setText(appPath, serialize(ad));
      }
      // --- custom.xml
      if (v.custom.length) {
        var cp = m.customPath && pkg.has(m.customPath) ? m.customPath : 'docProps/custom.xml';
        if (!pkg.has(cp)) {
          pkg.addRel('', REL + 'custom-properties', cp);
          pkg.addOverride(cp, 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
        }
        var body = v.custom.map(function (c, i) {
          var val;
          if (c.type === 'text') val = '<vt:lpwstr>' + xmlAttr(c.value) + '</vt:lpwstr>';
          else if (c.type === 'number') val = /^-?\d+$/.test(c.value) && Math.abs(+c.value) < 2147483648 ? '<vt:i4>' + (+c.value) + '</vt:i4>' : '<vt:r8>' + (+c.value) + '</vt:r8>';
          else if (c.type === 'bool') val = '<vt:bool>' + (c.value ? 'true' : 'false') + '</vt:bool>';
          else if (c.type === 'date') val = '<vt:filetime>' + isoUtc(c.value) + '</vt:filetime>';
          else val = c.raw.replace(/\sxmlns:vt="[^"]*"/, '');
          return '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="' + (i + 2) + '" name="' + xmlAttr(c.name) + '">' + val + '</property>';
        }).join('');
        pkg.setText(cp, XML_DECL + '<Properties xmlns="' + NS.cust + '" xmlns:vt="' + NS.vt + '">' + body + '</Properties>');
      } else if (m.customPath && pkg.has(m.customPath)) {
        pkg.removePart(m.customPath);
      }

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
      if (o.removeCustomXml) {
        Object.keys(pkg.files).filter(function (n) { return /^customXml\/item\d+\.xml$/.test(n); }).forEach(function (n) {
          pkg.rels(n).forEach(function (r) { if (!r.external) pkg.removePart(r.path); });
          pkg.removePart(n);
        });
      }
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
  /* Compound File Binary (OLE) – odczyt i zapis                            */
  /* ====================================================================== */

  var isCfb = O.isCfb, readCfb = O.readCfb, writeCfb = O.writeCfb, parsePropSet = O.parsePropSet, encPropSet = O.encPropSet,
    setProps = O.setProps, newHeader = O.newHeader, ftToDate = O.ftToDate;
  var FMTID_SUMMARY = O.FMTID_SUMMARY, FMTID_DOCSUM = O.FMTID_DOCSUM, FMTID_USER = O.FMTID_USER;
  var VT_I2 = O.VT_I2, VT_I4 = O.VT_I4, VT_R8 = O.VT_R8, VT_BOOL = O.VT_BOOL, VT_UI4 = O.VT_UI4, VT_LPSTR = O.VT_LPSTR, VT_LPWSTR = O.VT_LPWSTR, VT_FILETIME = O.VT_FILETIME;

  /* ====================================================================== */
  /* DOC – Word 97–2003                                                     */
  /* ====================================================================== */

  var SUM = { title: 2, subject: 3, creator: 4, keywords: 5, description: 6, template: 7, lastModifiedBy: 8, revision: 9, totalTime: 10, lastPrinted: 11, created: 12, modified: 13 };
  var DSUM = { category: 2, manager: 14, company: 15, contentStatus: 27, language: 28 };
  // Indeksy par fc/lcb w FibRgFcLcb97 ([MS-DOC] 2.5.6)
  var FIB = O.FIB, WORD_VER = O.WORD_VER, parseFib = O.parseFib, readSttb = O.readSttb, writeSttbExt = O.writeSttbExt,
    readXstGroup = O.readXstGroup, writeXstGroup = O.writeXstGroup;
  var ASSOC = ['', 'template', 'title', 'subject', 'keywords', '', 'author', 'lastRevBy', 'dataDoc', 'headerDoc'];

  var DOC = {
    name: 'doc',
    read: function (bytes) {
      var cfb = readCfb(bytes);
      if (cfb.find('EncryptedPackage') >= 0 || cfb.find('EncryptionInfo') >= 0) throw new Error(T('encrypted_ooxml'));
      var wIdx = cfb.find('WordDocument');
      if (wIdx < 0) throw new Error(T('not_word_doc'));
      var m = { format: 'doc', fields: {}, src: {}, stats: [], custom: [], details: [], lists: [], findings: [], options: {}, alerts: [], readonly: false };
      m.cfb = cfb; m.wIdx = wIdx;
      m.sumIdx = cfb.find('\u0005SummaryInformation');
      m.dsumIdx = cfb.find('\u0005DocumentSummaryInformation');
      var sum = null, dsum = null;
      try { if (m.sumIdx >= 0) sum = parsePropSet(cfb.stream(m.sumIdx)); } catch (e) { m.alerts.push(['warning', T('warn_props')]); }
      try { if (m.dsumIdx >= 0) dsum = parsePropSet(cfb.stream(m.dsumIdx)); } catch (e) { m.alerts.push(['warning', T('warn_props')]); }
      m.sum = sum; m.dsum = dsum;
      var sec = function (ps, fmtid) { return ps ? ps.sections.filter(function (s) { return s.fmtid === fmtid; })[0] || null : null; };
      var sS = sec(sum, FMTID_SUMMARY), sD = sec(dsum, FMTID_DOCSUM), sU = sec(dsum, FMTID_USER);
      var val = function (s, id) { if (!s) return undefined; var p = s.props.filter(function (x) { return x.id === id; })[0]; return p ? p.value : undefined; };
      Object.keys(SUM).forEach(function (f) {
        var v = val(sS, SUM[f]);
        if (DATE_F[f]) m.fields[f] = v && v.lo != null ? ftToDate(v.lo, v.hi) : null;
        else if (f === 'totalTime') m.fields[f] = v && v.lo != null ? Number(((BigInt(v.hi) << 32n) | BigInt(v.lo)) / 600000000n) : null;
        else m.fields[f] = v == null ? null : String(v);
        m.src[f] = 'Summary #' + SUM[f];
      });
      Object.keys(DSUM).forEach(function (f) {
        var v = val(sD, DSUM[f]);
        m.fields[f] = v == null ? null : String(v);
        m.src[f] = 'DocSummary #' + DSUM[f];
      });
      [[sS, 18, 'application'], [sD, 23, 'appVersion'], [sS, 14, 'pages'], [sS, 15, 'words'], [sS, 16, 'characters'], [sD, 17, 'charactersWithSpaces'],
        [sD, 5, 'lines'], [sD, 6, 'paragraphs'], [sD, 4, 'bytes'], [sS, 19, 'docSecurity']].forEach(function (x) {
        var v = val(x[0], x[1]);
        if (v == null) return;
        if (x[2] === 'appVersion' && typeof v === 'number') v = (v >>> 16) + '.' + (v & 0xFFFF);
        m.stats.push([T('s.' + x[2]), String(v)]);
      });
      m.sumCp = sS ? sS.codepage : null;
      if (sU) {
        sU.props.forEach(function (p) {
          if (p.id === 1) return;
          var name = sU.dict && sU.dict[p.id] != null ? sU.dict[p.id] : '#' + p.id, item = { name: name };
          if (p.type === VT_LPSTR || p.type === VT_LPWSTR) { item.type = 'text'; item.value = p.value; }
          else if (p.type === VT_I4 || p.type === VT_I2 || p.type === VT_UI4 || p.type === VT_R8) { item.type = 'number'; item.value = String(p.value); }
          else if (p.type === VT_BOOL) { item.type = 'bool'; item.value = !!p.value; }
          else if (p.type === VT_FILETIME) { item.type = 'date'; item.value = p.value ? ftToDate(p.value.lo, p.value.hi) : null; }
          else { item.type = 'other'; item.value = '(0x' + p.type.toString(16) + ')'; item.rawProp = p; }
          m.custom.push(item);
        });
      }
      m.thumb = !!(sS && sS.props.some(function (p) { return p.id === 17; }));
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
      // --- SummaryInformation
      var sumSets = {}, sumCp = m.sumCp || 1252;
      Object.keys(SUM).forEach(function (f) {
        var val = v.fields[f], id = SUM[f];
        if (val == null || val === '') { sumSets[id] = null; return; }
        if (DATE_F[f]) sumSets[id] = { type: VT_FILETIME, value: val };
        else if (f === 'totalTime') sumSets[id] = { type: VT_FILETIME, value: BigInt(Math.max(0, Math.round(+val || 0))) * 600000000n };
        else sumSets[id] = { type: VT_LPSTR, value: String(val) };
      });
      if (o.removeThumbnail) sumSets[17] = null;
      var anySum = Object.keys(sumSets).some(function (k) { return sumSets[k]; });
      if (m.sum) {
        var secs = m.sum.sections.map(function (s) { return s.fmtid === FMTID_SUMMARY ? setProps(s, sumSets) : { fmtid: s.fmtid, props: s.props.map(function (p) { return { id: p.id, raw: p.raw }; }), codepage: s.codepage, dict: s.dict }; });
        contents[m.sumIdx] = encPropSet(m.sum.header, secs);
      } else if (anySum) {
        add.push({ name: '\u0005SummaryInformation', data: encPropSet(newHeader(), [setProps({ fmtid: FMTID_SUMMARY, props: [], codepage: 1200, dict: null }, sumSets)]) });
      }
      // --- DocumentSummaryInformation (+ sekcja właściwości niestandardowych)
      var dSets = {};
      Object.keys(DSUM).forEach(function (f) {
        var val = v.fields[f];
        dSets[DSUM[f]] = val == null || val === '' ? null : { type: VT_LPSTR, value: String(val) };
      });
      var userSec = null;
      if (v.custom.length) {
        var dict = {}, uSets = {}, id = 2;
        v.custom.forEach(function (c) {
          dict[id] = c.name;
          if (c.type === 'text') uSets[id] = { type: VT_LPSTR, value: c.value };
          else if (c.type === 'number') uSets[id] = /^-?\d+$/.test(c.value) && Math.abs(+c.value) < 2147483648 ? { type: VT_I4, value: +c.value } : { type: VT_R8, value: +c.value };
          else if (c.type === 'bool') uSets[id] = { type: VT_BOOL, value: !!c.value };
          else if (c.type === 'date') uSets[id] = { type: VT_FILETIME, value: c.value };
          else if (c.rawProp) uSets[id] = { raw: c.rawProp.raw };
          id++;
        });
        var oldU = m.dsum ? m.dsum.sections.filter(function (s) { return s.fmtid === FMTID_USER; })[0] : null;
        var base = { fmtid: FMTID_USER, props: [], codepage: oldU ? oldU.codepage : 1200, dict: dict };
        var raws = {};
        Object.keys(uSets).forEach(function (k) { if (uSets[k].raw) { raws[k] = uSets[k].raw; delete uSets[k]; } });
        userSec = setProps(base, uSets);
        Object.keys(raws).forEach(function (k) { userSec.props.push({ id: +k, raw: raws[k] }); });
      }
      var anyD = Object.keys(dSets).some(function (k) { return dSets[k]; });
      if (m.dsum) {
        var ds = [];
        m.dsum.sections.forEach(function (s) {
          if (s.fmtid === FMTID_DOCSUM) ds.push(setProps(s, dSets));
          else if (s.fmtid === FMTID_USER) { if (userSec) ds.push(userSec); }
          else ds.push({ fmtid: s.fmtid, props: s.props.map(function (p) { return { id: p.id, raw: p.raw }; }), codepage: s.codepage, dict: s.dict });
        });
        if (userSec && !ds.some(function (s) { return s.fmtid === FMTID_USER; })) {
          if (!ds.some(function (s) { return s.fmtid === FMTID_DOCSUM; })) ds.unshift(setProps({ fmtid: FMTID_DOCSUM, props: [], codepage: 1200 }, dSets));
          ds.push(userSec);
        }
        contents[m.dsumIdx] = encPropSet(m.dsum.header, ds);
      } else if (anyD || userSec) {
        var nd = [setProps({ fmtid: FMTID_DOCSUM, props: [], codepage: 1200 }, dSets)];
        if (userSec) nd.push(userSec);
        add.push({ name: '\u0005DocumentSummaryInformation', data: encPropSet(newHeader(), nd) });
      }
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
      return writeCfb(cfb, contents, add);
    }
  };

  /* ====================================================================== */
  /* Wczytanie pliku                                                        */
  /* ====================================================================== */

  function detect(bytes, name) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) return DOCX;
    if (isCfb(bytes)) return DOC;
    var head = latin1(bytes, 0, Math.min(bytes.length, 512));
    if (/^\{\\rtf/.test(head)) throw new Error(T('is_rtf'));
    if (/<html|<\?xml|<w:wordDocument/i.test(head)) throw new Error(T('is_xml'));
    throw new Error(T('unknown_format'));
  }

  function loadFile(file) {
    if (!file) return;
    show($('[data-drop]'), false);
    show($('[data-result]'), false);
    show($('[data-loading]'), true);
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      state = { file: { name: file.name, size: file.size, lastModified: file.lastModified ? new Date(file.lastModified) : null }, bytes: bytes };
      var ad = detect(bytes, file.name);
      state.adapter = ad;
      state.model = ad.read(bytes);
      render();
    }).catch(function (err) {
      state = null;
      show($('[data-loading]'), false);
      show($('[data-drop]'), true);
      App.toast(T('read_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
    });
  }

  /* ====================================================================== */
  /* Widok                                                                  */
  /* ====================================================================== */

  function render() {
    var m = state.model;
    show($('[data-loading]'), false);
    show($('[data-result]'), true);
    $('[data-fname]').textContent = state.file.name;
    var meta = [fmtBytes(state.file.size), m.format === 'docx' ? 'DOCX (Office Open XML)' : 'DOC (Word 97–2003)'];
    var pages = m.stats.filter(function (s) { return s[0] === T('s.pages'); })[0];
    if (pages) meta.push(T('pages_n', { n: pages[1] }));
    $('[data-fmeta]').textContent = meta.join(' · ');
    $('[data-ficon]').innerHTML = App.icon(m.format === 'docx' ? 'file-type-docx' : 'file-type-doc');
    $('[data-alerts]').innerHTML = m.alerts.map(function (a) {
      return '<div class="alert alert-' + a[0] + '">' + App.icon(a[0] === 'info' ? 'info-circle' : 'alert-triangle') + '<span>' + esc(a[1]) + '</span></div>';
    }).join('');
    fillForm();
    // Statystyki
    show($('[data-stats-wrap]'), m.stats.length > 0);
    $('[data-stats]').innerHTML = m.stats.map(function (s) { return '<dt>' + esc(s[0]) + '</dt><dd class="break">' + esc(s[1]) + '</dd>'; }).join('');
    // Szczegóły
    var det = [[T('d.file'), state.file.name], [T('d.size'), fmtBytes(state.file.size) + ' (' + state.file.size.toLocaleString(LANG) + ' B)']];
    if (state.file.lastModified) det.push([T('d.file_modified'), fmtLocal(state.file.lastModified)]);
    $('[data-details]').innerHTML = det.concat(m.details).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd class="break">' + esc(r[1]) + '</dd>'; }).join('');
    $('[data-lists]').innerHTML = m.lists.map(function (l) {
      return '<div class="tool-list"><h3>' + App.icon(l.icon) + esc(l.title) + ' <span class="seg-count">' + l.items.length + '</span></h3><ul>'
        + l.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    // Prywatność
    var f = m.findings;
    $('[data-privacy-count]').textContent = f.filter(function (x) { return x[1] !== 'info'; }).length || '';
    $('[data-findings]').innerHTML = f.length ? f.map(function (x) {
      return '<li class="lvl-' + x[1] + '">' + App.icon(x[0]) + '<span>' + esc(x[2]) + '</span></li>';
    }).join('') : '<li class="lvl-ok">' + App.icon('circle-check') + '<span>' + esc(T('fi.clean')) + '</span></li>';
    $('[data-save-status]').textContent = '';
  }

  function fillForm() {
    var m = state.model, form = $('[data-form]');
    FIELDS.forEach(function (k) {
      var el = form.elements[k], v = m.fields[k];
      var box = el.closest('.meta-field');
      box.querySelector('[data-src]').textContent = m.src[k] || '';
      box.classList.remove('changed');
      if (DATE_F[k]) el.value = v ? toInput(v) : '';
      else el.value = v == null ? '' : String(v);
      var orig = box.querySelector('[data-orig]');
      orig.textContent = v == null || v === '' ? T('orig_none') : T('orig', { v: DATE_F[k] ? fmtLocal(v) : String(v).length > 120 ? String(v).slice(0, 120) + '…' : v });
    });
    $('[data-custom]').innerHTML = '';
    m.custom.forEach(function (c) { addCustomRow(c); });
    OPTS.forEach(function (o) {
      var row = $('[data-opt-row="' + o + '"]');
      var avail = Object.prototype.hasOwnProperty.call(m.options, o);
      show(row, avail);
      row.querySelector('input[type=checkbox]').checked = false;
      $('[data-opt-info="' + o + '"]').textContent = avail ? m.options[o] : '';
    });
    form.elements._filename.value = state.file.name;
    form.elements._modifiedNow.checked = false;
  }

  function addCustomRow(c) {
    c = c || { name: '', type: 'text', value: '' };
    var row = document.createElement('div');
    row.className = 'meta-custom-row wordm-crow';
    row.innerHTML = '<input type="text" class="ck" maxlength="255" placeholder="' + esc(T('custom_key')) + '">'
      + '<select class="ct" aria-label="' + esc(T('custom_type')) + '">'
      + ['text', 'number', 'bool', 'date'].concat(c.type === 'other' ? ['other'] : []).map(function (t) { return '<option value="' + t + '">' + esc(T('type.' + t)) + '</option>'; }).join('')
      + '</select><span class="cvw"></span>'
      + '<button type="button" class="btn-icon" data-remove-custom title="' + esc(App.t('common.delete')) + '">' + App.icon('trash') + '</button>';
    row.querySelector('.ck').value = c.name;
    row.querySelector('.ct').value = c.type;
    if (c.type === 'other') { row.querySelector('.ct').disabled = true; row._raw = c; }
    setValueInput(row, c.type, c.value);
    $('[data-custom]').appendChild(row);
    return row;
  }
  function setValueInput(row, type, value) {
    var w = row.querySelector('.cvw'), html;
    if (type === 'bool') html = '<select class="cv"><option value="1">' + esc(T('yes')) + '</option><option value="0">' + esc(T('no')) + '</option></select>';
    else if (type === 'date') html = '<input type="datetime-local" step="1" class="cv">';
    else if (type === 'number') html = '<input type="number" step="any" class="cv">';
    else html = '<input type="text" class="cv"' + (type === 'other' ? ' readonly' : '') + '>';
    w.innerHTML = html;
    var el = w.querySelector('.cv');
    if (type === 'bool') el.value = value ? '1' : '0';
    else if (type === 'date') el.value = value instanceof Date ? toInput(value) : '';
    else el.value = value == null ? '' : String(value);
  }

  /* ====================================================================== */
  /* Zapis                                                                  */
  /* ====================================================================== */

  function collect() {
    var form = $('[data-form]'), v = { fields: {}, custom: [] }, bad = null;
    FIELDS.forEach(function (k) {
      var raw = form.elements[k].value;
      if (DATE_F[k]) { var d = raw ? new Date(raw) : null; v.fields[k] = validDate(d) ? d : null; }
      else if (k === 'totalTime') v.fields[k] = raw === '' ? null : Math.max(0, Math.round(+raw || 0));
      else v.fields[k] = raw.trim() === '' ? null : (k === 'description' ? raw.replace(/\r\n/g, '\n').trim() : raw.trim());
    });
    var seen = {};
    $$('.wordm-crow').forEach(function (row) {
      var name = row.querySelector('.ck').value.trim(), type = row.querySelector('.ct').value, el = row.querySelector('.cv'), val = el.value;
      if (!name && !val) return;
      if (!name || seen[name.toLowerCase()]) { bad = name || '?'; return; }
      seen[name.toLowerCase()] = 1;
      if (type === 'bool') val = val === '1';
      else if (type === 'date') { val = val ? new Date(val) : null; if (!validDate(val)) { bad = name; return; } }
      else if (type === 'number' && (val === '' || isNaN(+val))) { bad = name; return; }
      var item = { name: name, type: type, value: val };
      if (type === 'other' && row._raw) { item.raw = row._raw.raw; item.rawProp = row._raw.rawProp; }
      v.custom.push(item);
    });
    var o = {};
    OPTS.forEach(function (k) { var el = form.elements['_' + k]; o[k] = !!(el && el.checked && !el.closest('[hidden]')); });
    o.anonName = (form.elements._anonName.value || '').trim() || T('anon_default');
    if (form.elements._modifiedNow.checked) v.fields.modified = new Date();
    return { v: v, o: o, bad: bad, filename: form.elements._filename.value.trim() };
  }

  function save(e) {
    if (e) e.preventDefault();
    if (!state) return;
    var c = collect();
    if (c.bad) { App.toast(T('custom_bad', { k: c.bad }), 'error'); return; }
    var btn = $('[data-form] [type=submit]');
    btn.disabled = true;
    $('[data-save-status]').textContent = T('saving');
    setTimeout(function () {
      var out;
      try {
        out = state.adapter.write(state.model, c.v, c.o);
      } catch (err) {
        btn.disabled = false;
        $('[data-save-status]').textContent = '';
        App.toast(T('save_error') + ' ' + (err && err.message ? err.message : ''), 'error', null, 9000);
        return;
      }
      var name = (c.filename || state.file.name).replace(/[\\/:*?"<>|]+/g, '_');
      var ext = (/\.[^.]+$/.exec(state.file.name) || ['.' + state.model.format])[0];
      if (!/\.[a-z0-9]{3,4}$/i.test(name)) name += ext;
      var mime = state.model.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword';
      download(new Blob([out], { type: mime }), name);
      App.toast(T('saved_toast'), 'success');
      // Weryfikacja: ponowny odczyt zapisanego pliku
      try {
        var ad = detect(out, name);
        var keepFile = { name: name, size: out.length, lastModified: new Date() };
        state = { file: keepFile, bytes: out, adapter: ad };
        state.model = ad.read(out);
        render();
        $('[data-save-status]').textContent = T('saved', { size: fmtBytes(out.length), name: name }) + ' ' + T('saved_now_showing');
      } catch (err2) {
        $('[data-save-status]').textContent = T('saved', { size: fmtBytes(out.length), name: name }) + ' ' + T('verify_failed');
      }
      btn.disabled = false;
    }, 30);
  }

  function stripAll() {
    if (!state) return;
    var form = $('[data-form]');
    FIELDS.forEach(function (k) { form.elements[k].value = ''; markChanged(k); });
    $('[data-custom]').innerHTML = '';
    OPTS.forEach(function (o) {
      var el = form.elements['_' + o];
      if (el && !el.closest('[hidden]')) el.checked = o !== 'removeComments';
    });
    switchTab('edit');
    App.toast(T('stripped_hint'), 'info', null, 7000);
  }

  function markChanged(k) {
    var m = state.model, form = $('[data-form]'), el = form.elements[k], v = m.fields[k];
    var orig = v == null ? '' : DATE_F[k] ? toInput(v) : String(v);
    el.closest('.meta-field').classList.toggle('changed', el.value !== orig);
  }

  /* ====================================================================== */
  /* Eksport                                                                */
  /* ====================================================================== */

  function exportData() {
    var m = state.model, fields = {};
    FIELDS.forEach(function (k) { var v = m.fields[k]; if (v != null && v !== '') fields[k] = v instanceof Date ? v.toISOString() : v; });
    return {
      file: { name: state.file.name, size: state.file.size, format: m.format, lastModified: state.file.lastModified ? state.file.lastModified.toISOString() : null },
      properties: fields,
      statistics: m.stats.reduce(function (o, s) { o[s[0]] = s[1]; return o; }, {}),
      custom: m.custom.map(function (c) { return { name: c.name, type: c.type, value: c.value instanceof Date ? c.value.toISOString() : c.value }; }),
      details: m.details.reduce(function (o, s) { o[s[0]] = s[1]; return o; }, {}),
      lists: m.lists.map(function (l) { return { title: l.title, items: l.items }; }),
      privacy: m.findings.map(function (f) { return { level: f[1], text: f[2] }; }),
      generated: new Date().toISOString()
    };
  }
  function exportText() {
    var x = exportData(), L = [T('export_header', { name: x.file.name }), ''];
    L.push('[' + T('tab_meta') + ']');
    Object.keys(x.properties).forEach(function (k) { L.push(T('f.' + k) + ': ' + x.properties[k]); });
    if (x.custom.length) { L.push('', '[' + T('custom') + ']'); x.custom.forEach(function (c) { L.push(c.name + ': ' + c.value); }); }
    if (Object.keys(x.statistics).length) { L.push('', '[' + T('stats') + ']'); Object.keys(x.statistics).forEach(function (k) { L.push(k + ': ' + x.statistics[k]); }); }
    L.push('', '[' + T('tab_details') + ']');
    Object.keys(x.details).forEach(function (k) { L.push(k + ': ' + x.details[k]); });
    x.lists.forEach(function (l) { L.push('', '[' + l.title + ']'); l.items.forEach(function (i) { L.push('- ' + i); }); });
    L.push('', '[' + T('tab_privacy') + ']');
    x.privacy.forEach(function (p) { L.push('- ' + p.text); });
    return L.join('\r\n') + '\r\n';
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
    document.addEventListener(ev, function (e) { if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); });
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
    if (clr) { var k = clr.getAttribute('data-clear'), el = $('[data-form]').elements[k]; el.value = ''; markChanged(k); el.focus(); return; }
    if (e.target.closest('[data-remove-custom]')) { e.target.closest('.wordm-crow').remove(); return; }
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.getAttribute('data-action');
    if (act === 'another') input.click();
    else if (act === 'add-custom') addCustomRow().querySelector('.ck').focus();
    else if (act === 'strip' || act === 'strip-go') stripAll();
    else if (act === 'reset') { fillForm(); App.toast(T('reset_done'), 'info'); }
    else if (act === 'json') download(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }), baseName(state.file.name) + '-metadata.json');
    else if (act === 'copy-json') App.copyText(JSON.stringify(exportData(), null, 2)).then(function () { App.toast(App.t('common.copied'), 'success'); });
    else if (act === 'txt') download(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }), baseName(state.file.name) + '-metadata.txt');
  });
  var form = $('[data-form]');
  form.addEventListener('submit', save);
  form.addEventListener('input', function (e) { if (FIELDS.indexOf(e.target.name) !== -1) markChanged(e.target.name); });
  form.addEventListener('change', function (e) {
    if (FIELDS.indexOf(e.target.name) !== -1) markChanged(e.target.name);
    if (e.target.matches('.ct')) { var row = e.target.closest('.wordm-crow'); setValueInput(row, e.target.value, row.querySelector('.cv').value); }
  });

})();
