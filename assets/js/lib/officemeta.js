/*
 * tools-php – wspólny moduł narzędzi „Metadane …” dla dokumentów Office (MIT)
 * Dostępne jako window.OfficeMeta. Wymaga: js/lib/toolkit.js, js/lib/ooxml.js, js/lib/ole.js, vendor/fflate.min.js.
 *
 *  - właściwości dokumentu w pakietach Office Open XML (docProps/core.xml, app.xml, custom.xml),
 *  - właściwości w plikach OLE (SummaryInformation, DocumentSummaryInformation, właściwości niestandardowe),
 *  - interfejs narzędzia: formularz pól, właściwości niestandardowe, opcje czyszczenia, szczegóły,
 *    raport prywatności, zapis, eksport (widok: app/views/office_meta.php).
 *
 * Narzędzie dostarcza adaptery formatów: { read(bytes, ctx) → model, write(model, values, options) → Uint8Array }.
 * Model: { format, fields, src, stats: [[klucz, wartość]], custom, details, lists, findings, options, alerts }.
 */
(function () {
  'use strict';
  var K = window.ToolKit, X = window.ToolsOoxml, O = window.ToolsOle;
  if (!K || !X || !O) return;

  var FIELDS = ['title', 'subject', 'creator', 'keywords', 'description', 'lastModifiedBy', 'category', 'contentStatus',
    'company', 'manager', 'template', 'revision', 'totalTime', 'language', 'created', 'modified', 'lastPrinted'];
  var DATE_F = { created: 1, modified: 1, lastPrinted: 1 };
  var NS = X.NS;

  function newModel(format) {
    return { format: format, fields: {}, src: {}, stats: [], custom: [], details: [], lists: [], findings: [], options: {}, alerts: [] };
  }

  /* ====================================================================== */
  /* Office Open XML: docProps                                              */
  /* ====================================================================== */

  var CORE = {
    title: ['dc', 'title'], subject: ['dc', 'subject'], creator: ['dc', 'creator'], keywords: ['cp', 'keywords'],
    description: ['dc', 'description'], lastModifiedBy: ['cp', 'lastModifiedBy'], revision: ['cp', 'revision'],
    category: ['cp', 'category'], contentStatus: ['cp', 'contentStatus'], language: ['dc', 'language'],
    created: ['dcterms', 'created'], modified: ['dcterms', 'modified'], lastPrinted: ['cp', 'lastPrinted']
  };
  var APPF = { company: 'Company', manager: 'Manager', template: 'Template', totalTime: 'TotalTime' };
  var APP_STATS = [['Application', 'application'], ['AppVersion', 'appVersion'], ['Pages', 'pages'], ['Slides', 'slides'], ['Notes', 'notes'],
    ['HiddenSlides', 'hiddenSlides'], ['MMClips', 'mmClips'], ['PresentationFormat', 'presentationFormat'], ['Words', 'words'], ['Characters', 'characters'],
    ['CharactersWithSpaces', 'charactersWithSpaces'], ['Lines', 'lines'], ['Paragraphs', 'paragraphs'], ['DocSecurity', 'docSecurity'],
    ['HyperlinkBase', 'hyperlinkBase'], ['SharedDoc', 'sharedDoc'], ['LinksUpToDate', 'linksUpToDate']];

  /** Odczyt właściwości z pakietu do modelu. */
  function ooxmlRead(pkg, m) {
    var coreRel = pkg.relByType('', X.REL_CORE) || pkg.relByType('', 'core-properties');
    m.corePath = coreRel ? coreRel.path : null;
    var core = m.corePath && pkg.has(m.corePath) ? X.parseXml(pkg.text(m.corePath)) : null;
    Object.keys(CORE).forEach(function (f) {
      var el = core ? X.childNS(core.documentElement, NS[CORE[f][0]], CORE[f][1]) : null;
      var v = el ? el.textContent : null;
      m.fields[f] = v == null ? null : DATE_F[f] ? X.parseW3C(v) : v;
      m.src[f] = CORE[f][0] + ':' + CORE[f][1];
    });
    var appRel = pkg.relByType('', 'extended-properties');
    m.appPath = appRel ? appRel.path : null;
    var app = m.appPath && pkg.has(m.appPath) ? X.parseXml(pkg.text(m.appPath)) : null;
    var appGet = function (n) { var el = app ? X.childNS(app.documentElement, NS.ep, n) : null; return el ? el.textContent : null; };
    Object.keys(APPF).forEach(function (f) {
      var v = appGet(APPF[f]);
      m.fields[f] = v == null ? null : f === 'totalTime' ? (+v || 0) : v;
      m.src[f] = 'app:' + APPF[f];
    });
    APP_STATS.forEach(function (p) {
      var v = appGet(p[0]);
      if (v != null && v !== '') m.stats.push([p[1], v]);
    });
    var custRel = pkg.relByType('', 'custom-properties');
    m.customPath = custRel ? custRel.path : null;
    if (m.customPath && pkg.has(m.customPath)) {
      var cd = X.parseXml(pkg.text(m.customPath));
      Array.prototype.forEach.call(cd.documentElement.children, function (p) {
        var v = p.firstElementChild;
        if (!v) return;
        var t = v.localName, item = { name: p.getAttribute('name') || '', raw: new XMLSerializer().serializeToString(v) };
        if (/^(lpwstr|lpstr|bstr)$/.test(t)) { item.type = 'text'; item.value = v.textContent; }
        else if (/^(i1|i2|i4|i8|int|ui1|ui2|ui4|ui8|uint|r4|r8|decimal)$/.test(t)) { item.type = 'number'; item.value = v.textContent; }
        else if (t === 'bool') { item.type = 'bool'; item.value = /^(true|1)$/i.test(v.textContent.trim()); }
        else if (t === 'filetime' || t === 'date') { item.type = 'date'; item.value = X.parseW3C(v.textContent); }
        else { item.type = 'other'; item.value = v.textContent; item.vtype = t; }
        m.custom.push(item);
      });
    }
    var th = pkg.relByType('', X.REL_THUMB);
    m.thumbnail = th && pkg.has(th.path) ? th.path : null;
  }

  /** Zapis właściwości (core, app, custom) do pakietu pkg (kopii). */
  function ooxmlWrite(pkg, m, v) {
    var XML_DECL = X.XML_DECL;
    var anyCore = Object.keys(CORE).some(function (f) { return v.fields[f] != null; });
    var corePath = m.corePath && pkg.has(m.corePath) ? m.corePath : null;
    if (corePath || anyCore) {
      if (!corePath) {
        corePath = 'docProps/core.xml';
        pkg.setText(corePath, XML_DECL + '<cp:coreProperties xmlns:cp="' + NS.cp + '" xmlns:dc="' + NS.dc + '" xmlns:dcterms="' + NS.dcterms + '" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="' + NS.xsi + '"></cp:coreProperties>');
        pkg.addRel('', X.REL_CORE, corePath);
        pkg.addOverride(corePath, 'application/vnd.openxmlformats-package.core-properties+xml');
      }
      var cd = X.parseXml(pkg.text(corePath)), cr = cd.documentElement;
      Object.keys(CORE).forEach(function (f) {
        var ns = NS[CORE[f][0]], local = CORE[f][1], el = X.soleNS(cr, ns, local), val = v.fields[f];
        if (val == null || val === '') { if (el) cr.removeChild(el); return; }
        if (!el) { el = cd.createElementNS(ns, CORE[f][0] + ':' + local); cr.appendChild(el); }
        if (DATE_F[f]) {
          el.textContent = K.isoUtc(val);
          if (f !== 'lastPrinted') el.setAttributeNS(NS.xsi, 'xsi:type', 'dcterms:W3CDTF');
        } else el.textContent = String(val);
      });
      pkg.setText(corePath, X.serialize(cd));
    }
    var appPath = m.appPath && pkg.has(m.appPath) ? m.appPath : null;
    var anyApp = Object.keys(APPF).some(function (f) { return v.fields[f] != null && v.fields[f] !== ''; });
    if (!appPath && anyApp) {
      appPath = 'docProps/app.xml';
      pkg.setText(appPath, XML_DECL + '<Properties xmlns="' + NS.ep + '" xmlns:vt="' + NS.vt + '"></Properties>');
      pkg.addRel('', X.REL + 'extended-properties', appPath);
      pkg.addOverride(appPath, 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
    }
    if (appPath) {
      var ad = X.parseXml(pkg.text(appPath)), ar = ad.documentElement;
      Object.keys(APPF).forEach(function (f) {
        var el = X.soleNS(ar, NS.ep, APPF[f]), val = v.fields[f];
        if (val == null || val === '') { if (el) ar.removeChild(el); return; }
        if (!el) { el = ad.createElementNS(NS.ep, APPF[f]); ar.appendChild(el); }
        el.textContent = f === 'totalTime' ? String(Math.max(0, Math.round(+val || 0))) : String(val);
      });
      pkg.setText(appPath, X.serialize(ad));
    }
    if (v.custom.length) {
      var cp = m.customPath && pkg.has(m.customPath) ? m.customPath : 'docProps/custom.xml';
      if (!pkg.has(cp)) {
        pkg.addRel('', X.REL + 'custom-properties', cp);
        pkg.addOverride(cp, 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
      }
      var body = v.custom.map(function (c, i) {
        var val;
        if (c.type === 'text') val = '<vt:lpwstr>' + K.xmlAttr(c.value) + '</vt:lpwstr>';
        else if (c.type === 'number') val = /^-?\d+$/.test(c.value) && Math.abs(+c.value) < 2147483648 ? '<vt:i4>' + (+c.value) + '</vt:i4>' : '<vt:r8>' + (+c.value) + '</vt:r8>';
        else if (c.type === 'bool') val = '<vt:bool>' + (c.value ? 'true' : 'false') + '</vt:bool>';
        else if (c.type === 'date') val = '<vt:filetime>' + K.isoUtc(c.value) + '</vt:filetime>';
        else val = c.raw.replace(/\sxmlns:vt="[^"]*"/, '');
        return '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="' + (i + 2) + '" name="' + K.xmlAttr(c.name) + '">' + val + '</property>';
      }).join('');
      pkg.setText(cp, XML_DECL + '<Properties xmlns="' + NS.cust + '" xmlns:vt="' + NS.vt + '">' + body + '</Properties>');
    } else if (m.customPath && pkg.has(m.customPath)) {
      pkg.removePart(m.customPath);
    }
  }

  /** Wspólne odwołania zewnętrzne pakietu: { hyperlinks: [], externals: ['typ: cel'] } */
  function ooxmlExternals(pkg) {
    var out = { hyperlinks: [], externals: [] };
    pkg.allRelsFiles().forEach(function (rp) {
      pkg.rels(pkg.sourceOf(rp)).forEach(function (r) {
        if (!r.external) return;
        var kind = r.type.slice(r.type.lastIndexOf('/') + 1);
        if (kind === 'hyperlink') out.hyperlinks.push(r.target);
        else out.externals.push(kind + ': ' + r.target);
      });
    });
    return out;
  }

  /** Usuwa części customXml (np. metadane SharePoint) z pakietu. */
  function ooxmlRemoveCustomXml(pkg) {
    Object.keys(pkg.files).filter(function (n) { return /^customXml\/item\d+\.xml$/.test(n); }).forEach(function (n) {
      pkg.rels(n).forEach(function (r) { if (!r.external) pkg.removePart(r.path); });
      pkg.removePart(n);
    });
  }

  /* ====================================================================== */
  /* OLE: SummaryInformation / DocumentSummaryInformation                   */
  /* ====================================================================== */

  var SUM = { title: 2, subject: 3, creator: 4, keywords: 5, description: 6, template: 7, lastModifiedBy: 8, revision: 9, totalTime: 10, lastPrinted: 11, created: 12, modified: 13 };
  var DSUM = { category: 2, manager: 14, company: 15, contentStatus: 27, language: 28 };
  var OLE_STATS = [['S', 18, 'application'], ['D', 23, 'appVersion'], ['S', 14, 'pages'], ['D', 7, 'slides'], ['D', 8, 'notes'], ['D', 9, 'hiddenSlides'],
    ['D', 10, 'mmClips'], ['D', 3, 'presentationFormat'], ['S', 15, 'words'], ['S', 16, 'characters'], ['D', 17, 'charactersWithSpaces'],
    ['D', 5, 'lines'], ['D', 6, 'paragraphs'], ['D', 4, 'bytes'], ['S', 19, 'docSecurity']];

  function oleRead(cfb, m, T) {
    m.cfb = cfb;
    m.sumIdx = cfb.find('\u0005SummaryInformation');
    m.dsumIdx = cfb.find('\u0005DocumentSummaryInformation');
    var sum = null, dsum = null;
    try { if (m.sumIdx >= 0) sum = O.parsePropSet(cfb.stream(m.sumIdx)); } catch (e) { m.alerts.push(['warning', T('warn_props')]); }
    try { if (m.dsumIdx >= 0) dsum = O.parsePropSet(cfb.stream(m.dsumIdx)); } catch (e) { m.alerts.push(['warning', T('warn_props')]); }
    m.sum = sum; m.dsum = dsum;
    var sec = function (ps, fmtid) { return ps ? ps.sections.filter(function (s) { return s.fmtid === fmtid; })[0] || null : null; };
    var sS = sec(sum, O.FMTID_SUMMARY), sD = sec(dsum, O.FMTID_DOCSUM), sU = sec(dsum, O.FMTID_USER);
    var val = function (s, id) { if (!s) return undefined; var p = s.props.filter(function (x) { return x.id === id; })[0]; return p ? p.value : undefined; };
    Object.keys(SUM).forEach(function (f) {
      var v = val(sS, SUM[f]);
      if (DATE_F[f]) m.fields[f] = v && v.lo != null ? O.ftToDate(v.lo, v.hi) : null;
      else if (f === 'totalTime') m.fields[f] = v && v.lo != null ? Number(((BigInt(v.hi) << 32n) | BigInt(v.lo)) / 600000000n) : null;
      else m.fields[f] = v == null ? null : String(v);
      m.src[f] = 'Summary #' + SUM[f];
    });
    Object.keys(DSUM).forEach(function (f) {
      var v = val(sD, DSUM[f]);
      m.fields[f] = v == null ? null : String(v);
      m.src[f] = 'DocSummary #' + DSUM[f];
    });
    OLE_STATS.forEach(function (x) {
      var v = val(x[0] === 'S' ? sS : sD, x[1]);
      if (v == null || typeof v === 'object') return;
      if (x[2] === 'appVersion' && typeof v === 'number') v = (v >>> 16) + '.' + (v & 0xFFFF);
      m.stats.push([x[2], String(v)]);
    });
    m.sumCp = sS ? sS.codepage : null;
    if (sU) {
      sU.props.forEach(function (p) {
        if (p.id === 1) return;
        var name = sU.dict && sU.dict[p.id] != null ? sU.dict[p.id] : '#' + p.id, item = { name: name };
        if (p.type === O.VT_LPSTR || p.type === O.VT_LPWSTR) { item.type = 'text'; item.value = p.value; }
        else if (p.type === O.VT_I4 || p.type === O.VT_I2 || p.type === O.VT_UI4 || p.type === O.VT_R8) { item.type = 'number'; item.value = String(p.value); }
        else if (p.type === O.VT_BOOL) { item.type = 'bool'; item.value = !!p.value; }
        else if (p.type === O.VT_FILETIME) { item.type = 'date'; item.value = p.value ? O.ftToDate(p.value.lo, p.value.hi) : null; }
        else { item.type = 'other'; item.value = '(0x' + p.type.toString(16) + ')'; item.rawProp = p; }
        m.custom.push(item);
      });
    }
    m.thumb = !!(sS && sS.props.some(function (p) { return p.id === 17; }));
  }

  /** Zapis strumieni właściwości: wypełnia contents (indeks → bajty) i add (nowe strumienie). */
  function oleWrite(m, v, o, contents, add) {
    var sumSets = {};
    Object.keys(SUM).forEach(function (f) {
      var val = v.fields[f], id = SUM[f];
      if (val == null || val === '') { sumSets[id] = null; return; }
      if (DATE_F[f]) sumSets[id] = { type: O.VT_FILETIME, value: val };
      else if (f === 'totalTime') sumSets[id] = { type: O.VT_FILETIME, value: BigInt(Math.max(0, Math.round(+val || 0))) * 600000000n };
      else sumSets[id] = { type: O.VT_LPSTR, value: String(val) };
    });
    if (o.removeThumbnail) sumSets[17] = null;
    var anySum = Object.keys(sumSets).some(function (k) { return sumSets[k]; });
    var copySec = function (s) { return { fmtid: s.fmtid, props: s.props.map(function (p) { return { id: p.id, raw: p.raw }; }), codepage: s.codepage, dict: s.dict }; };
    if (m.sum) {
      contents[m.sumIdx] = O.encPropSet(m.sum.header, m.sum.sections.map(function (s) { return s.fmtid === O.FMTID_SUMMARY ? O.setProps(s, sumSets) : copySec(s); }));
    } else if (anySum) {
      add.push({ name: '\u0005SummaryInformation', data: O.encPropSet(O.newHeader(), [O.setProps({ fmtid: O.FMTID_SUMMARY, props: [], codepage: 1200, dict: null }, sumSets)]) });
    }
    var dSets = {};
    Object.keys(DSUM).forEach(function (f) { var val = v.fields[f]; dSets[DSUM[f]] = val == null || val === '' ? null : { type: O.VT_LPSTR, value: String(val) }; });
    var userSec = null;
    if (v.custom.length) {
      var dict = {}, uSets = {}, raws = {}, id = 2;
      v.custom.forEach(function (c) {
        dict[id] = c.name;
        if (c.type === 'text') uSets[id] = { type: O.VT_LPSTR, value: c.value };
        else if (c.type === 'number') uSets[id] = /^-?\d+$/.test(c.value) && Math.abs(+c.value) < 2147483648 ? { type: O.VT_I4, value: +c.value } : { type: O.VT_R8, value: +c.value };
        else if (c.type === 'bool') uSets[id] = { type: O.VT_BOOL, value: !!c.value };
        else if (c.type === 'date') uSets[id] = { type: O.VT_FILETIME, value: c.value };
        else if (c.rawProp) raws[id] = c.rawProp.raw;
        id++;
      });
      var oldU = m.dsum ? m.dsum.sections.filter(function (s) { return s.fmtid === O.FMTID_USER; })[0] : null;
      userSec = O.setProps({ fmtid: O.FMTID_USER, props: [], codepage: oldU ? oldU.codepage : 1200, dict: dict }, uSets);
      Object.keys(raws).forEach(function (k) { userSec.props.push({ id: +k, raw: raws[k] }); });
    }
    var anyD = Object.keys(dSets).some(function (k) { return dSets[k]; });
    if (m.dsum) {
      var ds = [];
      m.dsum.sections.forEach(function (s) {
        if (s.fmtid === O.FMTID_DOCSUM) ds.push(O.setProps(s, dSets));
        else if (s.fmtid === O.FMTID_USER) { if (userSec) ds.push(userSec); }
        else ds.push(copySec(s));
      });
      if (userSec && !ds.some(function (s) { return s.fmtid === O.FMTID_USER; })) {
        if (!ds.some(function (s) { return s.fmtid === O.FMTID_DOCSUM; })) ds.unshift(O.setProps({ fmtid: O.FMTID_DOCSUM, props: [], codepage: 1200 }, dSets));
        ds.push(userSec);
      }
      contents[m.dsumIdx] = O.encPropSet(m.dsum.header, ds);
    } else if (anyD || userSec) {
      var nd = [O.setProps({ fmtid: O.FMTID_DOCSUM, props: [], codepage: 1200 }, dSets)];
      if (userSec) nd.push(userSec);
      add.push({ name: '\u0005DocumentSummaryInformation', data: O.encPropSet(O.newHeader(), nd) });
    }
  }

  /* ====================================================================== */
  /* Interfejs narzędzia                                                    */
  /* ====================================================================== */

  /**
   * cfg: { root, prefix: 'tool.xxx.', opts: [nazwy opcji], detect(bytes) → adapter,
   *        formatLabel(model), fileIcon(model), mime(model), countStat: 'pages' | 'slides', stripKeep: [opcje niezaznaczane przez „Usuń wszystko”] }
   */
  function ui(cfg) {
    var root = cfg.root, state = null;
    var T = function (k, p) {
      var full = cfg.prefix + k, s = App.t(full, p);
      return s === full ? App.t('om.' + k, p) : s;
    };
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
    var esc = App.esc, LANG = (App.cfg && App.cfg.lang) || 'pl';
    var show = function (el, on) { if (el) el.hidden = !on; };
    var stripKeep = cfg.stripKeep || ['removeComments'];

    function loadFile(file) {
      if (!file) return;
      show($('[data-drop]'), false); show($('[data-result]'), false); show($('[data-loading]'), true);
      file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        state = { file: { name: file.name, size: file.size, lastModified: file.lastModified ? new Date(file.lastModified) : null }, bytes: bytes };
        var ad = cfg.detect(bytes, T);
        state.adapter = ad;
        state.model = ad.read(bytes, { T: T, file: state.file });
        render();
      }).catch(function (err) {
        state = null;
        show($('[data-loading]'), false); show($('[data-drop]'), true);
        App.toast(T('read_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
      });
    }

    function render() {
      var m = state.model;
      show($('[data-loading]'), false); show($('[data-result]'), true);
      $('[data-fname]').textContent = state.file.name;
      var meta = [K.fmtBytes(state.file.size), cfg.formatLabel(m)];
      // liczba stron/slajdów: rzeczywista (model.count), a gdy jej brak – ze statystyk zapisanych w pliku
      var cnt = m.count != null ? m.count : (m.stats.filter(function (s) { return s[0] === cfg.countStat; })[0] || [])[1];
      if (cnt != null) meta.push(T(cfg.countStat + '_n', { n: cnt }));
      $('[data-fmeta]').textContent = meta.join(' · ');
      $('[data-ficon]').innerHTML = App.icon(cfg.fileIcon(m));
      $('[data-alerts]').innerHTML = m.alerts.map(function (a) {
        return '<div class="alert alert-' + a[0] + '">' + App.icon(a[0] === 'info' ? 'info-circle' : 'alert-triangle') + '<span>' + esc(a[1]) + '</span></div>';
      }).join('');
      fillForm();
      show($('[data-stats-wrap]'), m.stats.length > 0);
      $('[data-stats]').innerHTML = m.stats.map(function (s) { return '<dt>' + esc(T('s.' + s[0])) + '</dt><dd class="break">' + esc(s[1]) + '</dd>'; }).join('');
      var det = [[T('d.file'), state.file.name], [T('d.size'), K.fmtBytes(state.file.size) + ' (' + state.file.size.toLocaleString(LANG) + ' B)']];
      if (state.file.lastModified) det.push([T('d.file_modified'), K.fmtLocal(state.file.lastModified)]);
      $('[data-details]').innerHTML = det.concat(m.details).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd class="break">' + esc(r[1]) + '</dd>'; }).join('');
      $('[data-lists]').innerHTML = m.lists.map(function (l) {
        return '<div class="tool-list"><h3>' + App.icon(l.icon) + esc(l.title) + ' <span class="seg-count">' + l.items.length + '</span></h3><ul>'
          + l.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>';
      }).join('');
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
        var el = form.elements[k], v = m.fields[k], box = el.closest('.meta-field');
        box.querySelector('[data-src]').textContent = m.src[k] || '';
        box.classList.remove('changed');
        el.value = DATE_F[k] ? (v ? K.toInput(v) : '') : v == null ? '' : String(v);
        box.querySelector('[data-orig]').textContent = v == null || v === '' ? T('orig_none') : T('orig', { v: DATE_F[k] ? K.fmtLocal(v) : String(v).length > 120 ? String(v).slice(0, 120) + '…' : v });
      });
      $('[data-custom]').innerHTML = '';
      m.custom.forEach(function (c) { addCustomRow(c); });
      cfg.opts.forEach(function (o) {
        var row = $('[data-opt-row="' + o + '"]'), avail = Object.prototype.hasOwnProperty.call(m.options, o);
        if (!row) return;
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
      row.className = 'meta-custom-row om-crow';
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
      else if (type === 'date') el.value = value instanceof Date ? K.toInput(value) : '';
      else el.value = value == null ? '' : String(value);
    }

    function collect() {
      var form = $('[data-form]'), v = { fields: {}, custom: [] }, bad = null, seen = {};
      FIELDS.forEach(function (k) {
        var raw = form.elements[k].value;
        if (DATE_F[k]) { var d = raw ? new Date(raw) : null; v.fields[k] = K.validDate(d) ? d : null; }
        else if (k === 'totalTime') v.fields[k] = raw === '' ? null : Math.max(0, Math.round(+raw || 0));
        else v.fields[k] = raw.trim() === '' ? null : (k === 'description' ? raw.replace(/\r\n/g, '\n').trim() : raw.trim());
      });
      $$('.om-crow').forEach(function (row) {
        var name = row.querySelector('.ck').value.trim(), type = row.querySelector('.ct').value, val = row.querySelector('.cv').value;
        if (!name && !val) return;
        if (!name || seen[name.toLowerCase()]) { bad = name || '?'; return; }
        seen[name.toLowerCase()] = 1;
        if (type === 'bool') val = val === '1';
        else if (type === 'date') { val = val ? new Date(val) : null; if (!K.validDate(val)) { bad = name; return; } }
        else if (type === 'number' && (val === '' || isNaN(+val))) { bad = name; return; }
        var item = { name: name, type: type, value: val };
        if (type === 'other' && row._raw) { item.raw = row._raw.raw; item.rawProp = row._raw.rawProp; }
        v.custom.push(item);
      });
      var o = {};
      cfg.opts.forEach(function (k) { var el = form.elements['_' + k]; o[k] = !!(el && el.checked && !el.closest('[hidden]')); });
      o.anonName = form.elements._anonName ? (form.elements._anonName.value || '').trim() || T('anon_default') : T('anon_default');
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
        try { out = state.adapter.write(state.model, c.v, c.o); } catch (err) {
          btn.disabled = false;
          $('[data-save-status]').textContent = '';
          App.toast(T('save_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
          return;
        }
        var name = (c.filename || state.file.name).replace(/[\\/:*?"<>|]+/g, '_');
        var ext = (/\.[^.]+$/.exec(state.file.name) || ['.' + state.model.format])[0];
        if (!/\.[a-z0-9]{3,4}$/i.test(name)) name += ext;
        K.download(new Blob([out], { type: cfg.mime(state.model) }), name);
        App.toast(T('saved_toast'), 'success');
        try {
          var ad = cfg.detect(out, T), file = { name: name, size: out.length, lastModified: new Date() };
          state = { file: file, bytes: out, adapter: ad };
          state.model = ad.read(out, { T: T, file: file });
          render();
          $('[data-save-status]').textContent = T('saved', { size: K.fmtBytes(out.length), name: name }) + ' ' + T('saved_now_showing');
        } catch (err2) {
          $('[data-save-status]').textContent = T('saved', { size: K.fmtBytes(out.length), name: name }) + ' ' + T('verify_failed');
        }
        btn.disabled = false;
      }, 30);
    }

    function stripAll() {
      if (!state) return;
      var form = $('[data-form]');
      FIELDS.forEach(function (k) { form.elements[k].value = ''; markChanged(k); });
      $('[data-custom]').innerHTML = '';
      cfg.opts.forEach(function (o) {
        var el = form.elements['_' + o];
        if (el && !el.closest('[hidden]')) el.checked = stripKeep.indexOf(o) === -1;
      });
      K.switchTab(root, 'edit');
      App.toast(T('stripped_hint'), 'info', null, 7000);
    }

    function markChanged(k) {
      var m = state.model, el = $('[data-form]').elements[k], v = m.fields[k];
      var orig = v == null ? '' : DATE_F[k] ? K.toInput(v) : String(v);
      el.closest('.meta-field').classList.toggle('changed', el.value !== orig);
    }

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
      if (Object.keys(x.statistics).length) { L.push('', '[' + T('stats') + ']'); Object.keys(x.statistics).forEach(function (k) { L.push(T('s.' + k) + ': ' + x.statistics[k]); }); }
      L.push('', '[' + T('tab_details') + ']');
      Object.keys(x.details).forEach(function (k) { L.push(k + ': ' + x.details[k]); });
      x.lists.forEach(function (l) { L.push('', '[' + l.title + ']'); l.items.forEach(function (i) { L.push('- ' + i); }); });
      L.push('', '[' + T('tab_privacy') + ']');
      x.privacy.forEach(function (p) { L.push('- ' + p.text); });
      return L.join('\r\n') + '\r\n';
    }

    var input = K.bindDrop(root, loadFile);
    root.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (tab) { K.switchTab(root, tab.getAttribute('data-tab')); return; }
      var clr = e.target.closest('[data-clear]');
      if (clr) { var k = clr.getAttribute('data-clear'), el = $('[data-form]').elements[k]; el.value = ''; markChanged(k); el.focus(); return; }
      if (e.target.closest('[data-remove-custom]')) { e.target.closest('.om-crow').remove(); return; }
      var a = e.target.closest('[data-action]');
      if (!a) return;
      var act = a.getAttribute('data-action');
      if (act === 'another') { input.click(); return; }
      if (!state) return;
      if (act === 'add-custom') addCustomRow().querySelector('.ck').focus();
      else if (act === 'strip' || act === 'strip-go') stripAll();
      else if (act === 'reset') { fillForm(); App.toast(T('reset_done'), 'info'); }
      else if (act === 'json') K.download(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }), K.baseName(state.file.name) + '-metadata.json');
      else if (act === 'copy-json') App.copyText(JSON.stringify(exportData(), null, 2)).then(function () { App.toast(App.t('common.copied'), 'success'); });
      else if (act === 'txt') K.download(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }), K.baseName(state.file.name) + '-metadata.txt');
    });
    var form = $('[data-form]');
    form.addEventListener('submit', save);
    form.addEventListener('input', function (e) { if (FIELDS.indexOf(e.target.name) !== -1) markChanged(e.target.name); });
    form.addEventListener('change', function (e) {
      if (FIELDS.indexOf(e.target.name) !== -1) markChanged(e.target.name);
      if (e.target.matches('.ct')) { var row = e.target.closest('.om-crow'); setValueInput(row, e.target.value, row.querySelector('.cv').value); }
    });
    return { T: T };
  }

  window.OfficeMeta = {
    FIELDS: FIELDS, DATE_F: DATE_F, newModel: newModel,
    ooxmlRead: ooxmlRead, ooxmlWrite: ooxmlWrite, ooxmlExternals: ooxmlExternals, ooxmlRemoveCustomXml: ooxmlRemoveCustomXml,
    oleRead: oleRead, oleWrite: oleWrite, ui: ui
  };
})();
