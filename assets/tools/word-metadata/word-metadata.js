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
  if (!root || !window.fflate) return;

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

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtBytes(b) {
    var u = ['B', 'KB', 'MB', 'GB'], i = 0, v = b;
    while (v >= 1024 && i < 3) { v /= 1024; i++; }
    return (i ? v.toLocaleString(LANG, { maximumFractionDigits: 1 }) : v) + ' ' + u[i];
  }
  function fmtLocal(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function toInput(d) {
    return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) : '';
  }
  function isoUtc(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function validDate(d) { return d instanceof Date && !isNaN(d.getTime()); }
  function show(el, on) { if (el) el.hidden = !on; }
  function yesNo(v) { return v ? T('yes') : T('no'); }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, ''); }
  var utf8d = new TextDecoder('utf-8');
  var utf8e = new TextEncoder();
  function u8str(b) { return utf8d.decode(b).replace(/^﻿/, ''); }
  function xmlText(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); }).replace(/&amp;/g, '&'); }
  function xmlAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function initials(name) { return String(name).split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase(); }).join('').slice(0, 9) || 'A'; }
  function countBy(arr) { var m = {}; arr.forEach(function (x) { m[x] = (m[x] || 0) + 1; }); return m; }
  function latin1(b, from, to) { return new TextDecoder('latin1').decode(b.subarray(from || 0, to == null ? b.length : to)); }

  /* ====================================================================== */
  /* DOCX – pakiet Open XML                                                 */
  /* ====================================================================== */

  var NS = {
    cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    dc: 'http://purl.org/dc/elements/1.1/',
    dcterms: 'http://purl.org/dc/terms/',
    xsi: 'http://www.w3.org/2001/XMLSchema-instance',
    ep: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
    cust: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
  };
  var CORE = {
    title: ['dc', 'title'], subject: ['dc', 'subject'], creator: ['dc', 'creator'], keywords: ['cp', 'keywords'],
    description: ['dc', 'description'], lastModifiedBy: ['cp', 'lastModifiedBy'], revision: ['cp', 'revision'],
    category: ['cp', 'category'], contentStatus: ['cp', 'contentStatus'], language: ['dc', 'language'],
    created: ['dcterms', 'created'], modified: ['dcterms', 'modified'], lastPrinted: ['cp', 'lastPrinted']
  };
  var APPF = { company: 'Company', manager: 'Manager', template: 'Template', totalTime: 'TotalTime' };
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var REL_CORE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
  var REL_THUMB = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail';
  var XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  function Pkg(files) { this.files = files; }
  Pkg.prototype.has = function (p) { return !!this.files[p]; };
  Pkg.prototype.text = function (p) { return this.files[p] ? u8str(this.files[p]) : null; };
  Pkg.prototype.setText = function (p, s) { this.files[p] = utf8e.encode(s); };
  Pkg.prototype.relsPath = function (part) {
    if (!part) return '_rels/.rels';
    var i = part.lastIndexOf('/');
    return (i >= 0 ? part.slice(0, i + 1) : '') + '_rels/' + part.slice(i + 1) + '.rels';
  };
  Pkg.prototype.sourceOf = function (relsPath) {
    if (relsPath === '_rels/.rels') return '';
    var m = /^(.*?)_rels\/(.+)\.rels$/.exec(relsPath);
    return m ? m[1] + m[2] : '';
  };
  function resolve(source, target) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
    var t = target.charAt(0) === '/' ? target.slice(1) : ((source.lastIndexOf('/') >= 0 ? source.slice(0, source.lastIndexOf('/') + 1) : '') + target);
    var out = [];
    t.split('/').forEach(function (s) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s); });
    return out.join('/');
  }
  Pkg.prototype.rels = function (part) {
    var path = this.relsPath(part), xml = this.text(path), out = [];
    if (!xml) return out;
    var re = /<Relationship\b([^>]*?)\/?>/g, m;
    while ((m = re.exec(xml))) {
      var a = m[1], g = function (n) { var x = new RegExp('\\b' + n + '="([^"]*)"').exec(a); return x ? xmlText(x[1]) : ''; };
      var r = { id: g('Id'), type: g('Type'), target: g('Target'), external: g('TargetMode') === 'External' };
      r.path = r.external ? r.target : resolve(part || '', r.target);
      out.push(r);
    }
    return out;
  };
  Pkg.prototype.relByType = function (part, type) {
    var rs = this.rels(part);
    for (var i = 0; i < rs.length; i++) if (rs[i].type === type || rs[i].type.slice(-type.length - 1) === '/' + type) return rs[i];
    return null;
  };
  Pkg.prototype.allRelsFiles = function () { return Object.keys(this.files).filter(function (n) { return /(^|\/)_rels\/[^/]*\.rels$/.test(n); }); };
  /** Usuwa relację (po Id) z pliku .rels części. */
  Pkg.prototype.removeRelId = function (part, id) {
    var p = this.relsPath(part), xml = this.text(p);
    if (!xml) return;
    this.setText(p, xml.replace(new RegExp('<Relationship\\b[^>]*\\bId="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*?(?:\\/>|>\\s*<\\/Relationship>)', 'g'), ''));
  };
  /** Dodaje relację; zwraca Id. */
  Pkg.prototype.addRel = function (part, type, target) {
    var p = this.relsPath(part), xml = this.text(p) || XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    var n = 1, id;
    do { id = 'rIdTp' + n++; } while (xml.indexOf('Id="' + id + '"') !== -1);
    this.setText(p, xml.replace('</Relationships>', '<Relationship Id="' + id + '" Type="' + type + '" Target="' + xmlAttr(target) + '"/></Relationships>'));
    return id;
  };
  Pkg.prototype.addOverride = function (part, ctype) {
    var xml = this.text('[Content_Types].xml');
    if (!xml || xml.indexOf('PartName="/' + part + '"') !== -1) return;
    this.setText('[Content_Types].xml', xml.replace('</Types>', '<Override PartName="/' + part + '" ContentType="' + ctype + '"/></Types>'));
  };
  /** Usuwa część pakietu razem z jej relacjami, wpisem w [Content_Types].xml i odwołaniami w innych .rels. */
  Pkg.prototype.removePart = function (part) {
    var self = this;
    if (!this.files[part]) return;
    delete this.files[part];
    delete this.files[this.relsPath(part)];
    var ct = this.text('[Content_Types].xml');
    if (ct) this.setText('[Content_Types].xml', ct.replace(new RegExp('<Override\\b[^>]*PartName="/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*?\\/>', 'gi'), ''));
    this.allRelsFiles().forEach(function (rp) {
      var src = self.sourceOf(rp);
      self.rels(src).forEach(function (r) { if (!r.external && r.path === part) self.removeRelId(src, r.id); });
    });
  };

  function parseXml(s) {
    var d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error(T('xml_error'));
    return d;
  }
  function serialize(d) { return XML_DECL + new XMLSerializer().serializeToString(d.documentElement); }
  function childrenNS(parent, ns, local) {
    var out = [];
    for (var c = parent.firstElementChild; c; c = c.nextElementSibling) if (c.namespaceURI === ns && c.localName === local) out.push(c);
    return out;
  }
  /** Pierwszy element o danej nazwie (z niepustą treścią, jeśli jest kilka). */
  function childNS(parent, ns, local) {
    var all = childrenNS(parent, ns, local);
    return all.filter(function (c) { return c.textContent.trim() !== ''; })[0] || all[0] || null;
  }
  /** Element do zapisu – usuwa duplikaty, zostawia jeden. */
  function soleNS(parent, ns, local) {
    var all = childrenNS(parent, ns, local), keep = childNS(parent, ns, local);
    all.forEach(function (c) { if (c !== keep) parent.removeChild(c); });
    return keep;
  }

  function parseW3C(s) {
    if (!s) return null;
    var d = new Date(s.trim());
    return validDate(d) ? d : null;
  }

  var DOCX = {
    name: 'docx',
    read: function (bytes) {
      var files;
      try { files = fflate.unzipSync(bytes); } catch (e) { throw new Error(T('zip_error')); }
      var pkg = new Pkg(files);
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
      return fflate.zipSync(pkg.files, { level: 6 });
    }
  };

  /* ====================================================================== */
  /* Compound File Binary (OLE) – odczyt i zapis                            */
  /* ====================================================================== */

  var FREESECT = 0xFFFFFFFF, ENDOFCHAIN = 0xFFFFFFFE, FATSECT = 0xFFFFFFFD, DIFSECT = 0xFFFFFFFC, NOSTREAM = 0xFFFFFFFF;

  function isCfb(b) { return b.length > 512 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0 && b[4] === 0xA1 && b[5] === 0xB1 && b[6] === 0x1A && b[7] === 0xE1; }

  function readCfb(b) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var u16 = function (o) { return dv.getUint16(o, true); }, u32 = function (o) { return dv.getUint32(o, true); };
    var secShift = u16(0x1E), secSize = 1 << secShift, miniSize = 1 << u16(0x20);
    if (secShift !== 9 && secShift !== 12) throw new Error(T('cfb_error'));
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
    if (!entries.length || entries[0].type !== 5) throw new Error(T('cfb_error'));
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

  /* ====================================================================== */
  /* DOC – Word 97–2003                                                     */
  /* ====================================================================== */

  var SUM = { title: 2, subject: 3, creator: 4, keywords: 5, description: 6, template: 7, lastModifiedBy: 8, revision: 9, totalTime: 10, lastPrinted: 11, created: 12, modified: 13 };
  var DSUM = { category: 2, manager: 14, company: 15, contentStatus: 27, language: 28 };
  // Indeksy par fc/lcb w FibRgFcLcb97 ([MS-DOC] 2.5.6)
  var FIB = { plcfandRef: 4, sttbfAssoc: 32, grpXstAtnOwners: 36, sttbfRMark: 51, sttbSavedBy: 71 };
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
      App.toast(T('read_error') + ' ' + (err && err.message ? err.message : ''), 'error', null, 9000);
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
      return '<div class="wordm-list"><h3>' + App.icon(l.icon) + esc(l.title) + ' <span class="seg-count">' + l.items.length + '</span></h3><ul>'
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

  // Udostępnienie funkcji do testów automatycznych (bez wpływu na działanie)
  window.WordMetaInternals = { readCfb: readCfb, writeCfb: writeCfb, parsePropSet: parsePropSet, encPropSet: encPropSet, setProps: setProps, parseFib: parseFib };
})();
