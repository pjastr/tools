/*
 * tools-php – wspólne funkcje pomocnicze narzędzi (MIT)
 * Dostępne jako window.ToolKit. Dołącz w opisie narzędzia: 'js' => ['js/lib/toolkit.js', …]
 */
(function () {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtBytes(b) {
    var LANG = (window.App && App.cfg && App.cfg.lang) || 'pl';
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


  /** Wartość do pola CSV (separator „;”, zgodny z polskim Excelem). */
  function csvCell(v) { var t = v == null ? '' : String(v); return /[";\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function csv(rows) { return '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n') + '\r\n'; }

  /** Obsługa strefy upuszczania pliku i pola wyboru pliku. */
  function bindDrop(root, onFile) {
    var input = root.querySelector('[data-file]'), drop = root.querySelector('[data-drop]');
    input.addEventListener('change', function () { onFile(input.files[0]); input.value = ''; });
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
      onFile(e.dataTransfer.files[0]);
    });
    return input;
  }

  /** Przełączanie zakładek [data-tab] / [data-panel] w obrębie root. */
  function switchTab(root, name) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-panel]'), function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
  }

  window.ToolKit = {
    pad: pad, fmtBytes: fmtBytes, fmtLocal: fmtLocal, toInput: toInput, isoUtc: isoUtc, validDate: validDate, download: download,
    baseName: baseName, u8str: u8str, utf8e: utf8e, xmlText: xmlText, xmlAttr: xmlAttr, initials: initials, countBy: countBy,
    latin1: latin1, csv: csv, bindDrop: bindDrop, switchTab: switchTab
  };
})();
