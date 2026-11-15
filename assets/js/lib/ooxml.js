/*
 * tools-php – obsługa pakietów Office Open XML (DOCX, XLSX, PPTX) (MIT)
 * Dostępne jako window.ToolsOoxml. Wymaga: js/lib/toolkit.js, vendor/fflate.min.js.
 */
(function () {
  'use strict';
  var K = window.ToolKit, u8str = K.u8str, utf8e = K.utf8e, xmlText = K.xmlText, xmlAttr = K.xmlAttr, validDate = K.validDate;

  var NS = {
    cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    dc: 'http://purl.org/dc/elements/1.1/',
    dcterms: 'http://purl.org/dc/terms/',
    xsi: 'http://www.w3.org/2001/XMLSchema-instance',
    ep: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
    cust: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
  };
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
    if (d.getElementsByTagName('parsererror').length) { var er = new Error('XML parse error'); er.code = 'xml_error'; throw er; }
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


  /** Otwiera pakiet ZIP; rzuca błąd z kodem zip_error. */
  function open(bytes) {
    try { return new Pkg(fflate.unzipSync(bytes)); } catch (e) { var er = new Error('ZIP error'); er.code = 'zip_error'; throw er; }
  }
  function save(pkg) { return fflate.zipSync(pkg.files, { level: 6 }); }
  function isZip(b) { return b.length > 4 && b[0] === 0x50 && b[1] === 0x4B; }

  window.ToolsOoxml = {
    NS: NS, REL: REL, REL_CORE: REL_CORE, REL_THUMB: REL_THUMB, XML_DECL: XML_DECL, Pkg: Pkg, resolve: resolve,
    parseXml: parseXml, serialize: serialize, childrenNS: childrenNS, childNS: childNS, soleNS: soleNS, parseW3C: parseW3C,
    open: open, save: save, isZip: isZip
  };
})();
