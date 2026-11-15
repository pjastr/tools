/*
 * tools-php – narzędzie „Metadane obrazów” (JPEG, PNG, WEBP) (MIT)
 * Odczyt i bezstratne czyszczenie metadanych w całości w przeglądarce – obraz nie jest wysyłany na serwer
 * ani ponownie kompresowany (zmieniają się tylko bloki metadanych, dane obrazu są kopiowane bajt w bajt).
 * Obsługiwane: EXIF (z GPS i miniaturą), XMP (także rozszerzony), IPTC/Photoshop, profile ICC, komentarze JPEG,
 * fragmenty tekstowe PNG (tEXt, zTXt, iTXt, surowe profile ImageMagick), Content Credentials (C2PA),
 * dodatkowe obrazy MPF i dane za końcem obrazu (np. wideo Motion Photo).
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-imgmeta]');
  if (!root || !window.App || !window.ToolKit) return;

  var K = window.ToolKit, Z = window.fflate;
  var PFX = 'tool.image-metadata.';
  function T(k, p) { var f = PFX + k, s = App.t(f, p); return s === f ? App.t('om.' + k, p) : s; }
  var esc = App.esc, LANG = (App.cfg && App.cfg.lang) || 'pl';
  var $ = function (s) { return root.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
  var show = function (el, on) { if (el) el.hidden = !on; };
  function fail(code) { var e = new Error(code); e.code = code; throw e; }

  /* ====================================================================== */
  /* Bajty                                                                  */
  /* ====================================================================== */

  function be16(b, p) { return (b[p] << 8) | b[p + 1]; }
  function be32(b, p) { return b[p] * 16777216 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]); }
  function le16(b, p) { return b[p] | (b[p + 1] << 8); }
  function le24(b, p) { return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16); }
  function le32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216; }
  function wbe32(b, p, v) { b[p] = (v >>> 24) & 255; b[p + 1] = (v >>> 16) & 255; b[p + 2] = (v >>> 8) & 255; b[p + 3] = v & 255; }
  function wle32(b, p, v) { b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; b[p + 2] = (v >>> 16) & 255; b[p + 3] = (v >>> 24) & 255; }
  function ascii(b, p, n) { var s = ''; for (var i = 0; i < n && p + i < b.length; i++) s += String.fromCharCode(b[p + i]); return s; }
  function starts(b, p, s) { if (p + s.length > b.length) return false; for (var i = 0; i < s.length; i++) if (b[p + i] !== s.charCodeAt(i)) return false; return true; }
  function asc(s) { var o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }
  var utf8enc = new TextEncoder(), utf8strict = new TextDecoder('utf-8', { fatal: true });
  /** Tekst w UTF-8, a gdy to niemożliwe – w Latin-1. */
  function text(b) { try { return utf8strict.decode(b).replace(/^\uFEFF/, ''); } catch (e) { return K.latin1(b); } }
  function cstr(b) { var i = b.indexOf(0); return text(i < 0 ? b : b.subarray(0, i)).replace(/\s+$/, ''); }
  function concat(parts) {
    var n = 0, q = 0; parts.forEach(function (p) { n += p.length; });
    var o = new Uint8Array(n); parts.forEach(function (p) { o.set(p, q); q += p.length; });
    return o;
  }
  function find(b, s, from, to) {
    var n = s.length, c0 = s.charCodeAt(0), end = Math.min(to == null ? b.length : to, b.length) - n;
    for (var i = from || 0; i <= end; i++) { if (b[i] === c0 && starts(b, i, s)) return i; }
    return -1;
  }
  var CRC = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  function crc32(parts) {
    var c = -1;
    parts.forEach(function (b) { for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); });
    return (c ^ -1) >>> 0;
  }
  function inflate(b) { return Z.unzlibSync(b); }
  function round(x, d) { var f = Math.pow(10, d == null ? 4 : d); return Math.round(x * f) / f; }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ====================================================================== */
  /* EXIF (TIFF)                                                            */
  /* ====================================================================== */

  var TSIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  var TAGS = {
    0x0100: 'ImageWidth', 0x0101: 'ImageHeight', 0x0102: 'BitsPerSample', 0x0103: 'Compression', 0x0106: 'PhotometricInterpretation',
    0x010E: 'ImageDescription', 0x010F: 'Make', 0x0110: 'Model', 0x0111: 'StripOffsets', 0x0112: 'Orientation', 0x0115: 'SamplesPerPixel',
    0x011A: 'XResolution', 0x011B: 'YResolution', 0x011C: 'PlanarConfiguration', 0x0128: 'ResolutionUnit', 0x0131: 'Software', 0x0132: 'DateTime',
    0x013B: 'Artist', 0x013C: 'HostComputer', 0x013E: 'WhitePoint', 0x013F: 'PrimaryChromaticities', 0x0201: 'ThumbnailOffset', 0x0202: 'ThumbnailLength',
    0x0211: 'YCbCrCoefficients', 0x0212: 'YCbCrSubSampling', 0x0213: 'YCbCrPositioning', 0x0214: 'ReferenceBlackWhite', 0x02BC: 'ApplicationNotes (XMP)',
    0x4746: 'Rating', 0x4749: 'RatingPercent', 0x8298: 'Copyright', 0x83BB: 'IPTC-NAA', 0x8649: 'PhotoshopSettings', 0x8769: 'ExifOffset',
    0x8773: 'ICC_Profile', 0x8825: 'GPSInfo', 0x9C9B: 'XPTitle', 0x9C9C: 'XPComment', 0x9C9D: 'XPAuthor', 0x9C9E: 'XPKeywords', 0x9C9F: 'XPSubject',
    0xA480: 'GDALMetadata', 0xC4A5: 'PrintIM', 0xC612: 'DNGVersion', 0xC614: 'UniqueCameraModel', 0xC62F: 'CameraSerialNumber', 0xEA1C: 'Padding',
    0x829A: 'ExposureTime', 0x829D: 'FNumber', 0x8822: 'ExposureProgram', 0x8824: 'SpectralSensitivity', 0x8827: 'ISO', 0x8830: 'SensitivityType',
    0x8832: 'RecommendedExposureIndex', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'CreateDate', 0x9010: 'OffsetTime',
    0x9011: 'OffsetTimeOriginal', 0x9012: 'OffsetTimeDigitized', 0x9101: 'ComponentsConfiguration', 0x9102: 'CompressedBitsPerPixel',
    0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue', 0x9203: 'BrightnessValue', 0x9204: 'ExposureCompensation', 0x9205: 'MaxApertureValue',
    0x9206: 'SubjectDistance', 0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920A: 'FocalLength', 0x9214: 'SubjectArea',
    0x927C: 'MakerNote', 0x9286: 'UserComment', 0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized',
    0x9400: 'AmbientTemperature', 0x9401: 'Humidity', 0x9402: 'Pressure', 0x9403: 'WaterDepth', 0x9404: 'Acceleration', 0x9405: 'CameraElevationAngle',
    0xA000: 'FlashpixVersion', 0xA001: 'ColorSpace', 0xA002: 'ExifImageWidth', 0xA003: 'ExifImageHeight', 0xA004: 'RelatedSoundFile',
    0xA005: 'InteropOffset', 0xA20B: 'FlashEnergy', 0xA20E: 'FocalPlaneXResolution', 0xA20F: 'FocalPlaneYResolution', 0xA210: 'FocalPlaneResolutionUnit',
    0xA214: 'SubjectLocation', 0xA215: 'ExposureIndex', 0xA217: 'SensingMethod', 0xA300: 'FileSource', 0xA301: 'SceneType', 0xA302: 'CFAPattern',
    0xA401: 'CustomRendered', 0xA402: 'ExposureMode', 0xA403: 'WhiteBalance', 0xA404: 'DigitalZoomRatio', 0xA405: 'FocalLengthIn35mmFormat',
    0xA406: 'SceneCaptureType', 0xA407: 'GainControl', 0xA408: 'Contrast', 0xA409: 'Saturation', 0xA40A: 'Sharpness', 0xA40C: 'SubjectDistanceRange',
    0xA420: 'ImageUniqueID', 0xA430: 'OwnerName', 0xA431: 'SerialNumber', 0xA432: 'LensInfo', 0xA433: 'LensMake', 0xA434: 'LensModel',
    0xA435: 'LensSerialNumber', 0xA460: 'CompositeImage', 0xA500: 'Gamma', 0x0001: 'InteropIndex', 0x0002: 'InteropVersion'
  };
  var GPS_TAGS = {
    0: 'GPSVersionID', 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef', 6: 'GPSAltitude',
    7: 'GPSTimeStamp', 8: 'GPSSatellites', 9: 'GPSStatus', 10: 'GPSMeasureMode', 11: 'GPSDOP', 12: 'GPSSpeedRef', 13: 'GPSSpeed', 14: 'GPSTrackRef',
    15: 'GPSTrack', 16: 'GPSImgDirectionRef', 17: 'GPSImgDirection', 18: 'GPSMapDatum', 19: 'GPSDestLatitudeRef', 20: 'GPSDestLatitude',
    21: 'GPSDestLongitudeRef', 22: 'GPSDestLongitude', 23: 'GPSDestBearingRef', 24: 'GPSDestBearing', 25: 'GPSDestDistanceRef', 26: 'GPSDestDistance',
    27: 'GPSProcessingMethod', 28: 'GPSAreaInformation', 29: 'GPSDateStamp', 30: 'GPSDifferential', 31: 'GPSHPositioningError'
  };
  var ENUM = {
    0x0112: { 1: 'Normal', 2: 'Mirror horizontal', 3: 'Rotate 180', 4: 'Mirror vertical', 5: 'Mirror horizontal and rotate 270 CW', 6: 'Rotate 90 CW', 7: 'Mirror horizontal and rotate 90 CW', 8: 'Rotate 270 CW' },
    0x0128: { 1: 'None', 2: 'inches', 3: 'cm' }, 0xA210: { 1: 'None', 2: 'inches', 3: 'cm' },
    0x0103: { 1: 'Uncompressed', 6: 'JPEG (old-style)', 7: 'JPEG' }, 0x0213: { 1: 'Centered', 2: 'Co-sited' },
    0x8822: { 0: 'Not defined', 1: 'Manual', 2: 'Program AE', 3: 'Aperture-priority AE', 4: 'Shutter speed priority AE', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape' },
    0x9207: { 0: 'Unknown', 1: 'Average', 2: 'Center-weighted average', 3: 'Spot', 4: 'Multi-spot', 5: 'Multi-segment', 6: 'Partial', 255: 'Other' },
    0xA001: { 1: 'sRGB', 2: 'Adobe RGB', 0xFFFF: 'Uncalibrated' }, 0xA402: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' }, 0xA403: { 0: 'Auto', 1: 'Manual' },
    0xA406: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' }, 0xA401: { 0: 'Normal', 1: 'Custom' }
  };
  var IFD_NAMES = { ifd0: 'IFD0', exif: 'ExifIFD', gps: 'GPS', interop: 'InteropIFD', ifd1: 'IFD1' };

  function dv(r) { return new DataView(r.buffer, r.byteOffset, r.byteLength); }

  /** Czyta strukturę TIFF (EXIF): katalogi IFD0, Exif, GPS, Interop, IFD1 i miniaturę. */
  function parseTiff(b) {
    if (!b || b.length < 8) return null;
    var le = b[0] === 0x49 && b[1] === 0x49;
    if (!le && !(b[0] === 0x4D && b[1] === 0x4D)) return null;
    var D = dv(b), u16 = function (p) { return D.getUint16(p, le); }, u32 = function (p) { return D.getUint32(p, le); };
    if (u16(2) !== 42) return null;
    var ex = { le: le, ifds: {}, thumb: null, size: b.length }, seen = {};
    function readIfd(off, name) {
      if (!off || off + 2 > b.length || seen[off]) return 0;
      seen[off] = 1;
      var n = u16(off), list = [];
      if (off + 2 + n * 12 > b.length) n = Math.floor((b.length - off - 2) / 12);
      for (var i = 0; i < n; i++) {
        var e = off + 2 + i * 12, type = u16(e + 2), cnt = u32(e + 4);
        if (!TSIZE[type] || cnt > 16777216) continue;
        var sz = TSIZE[type] * cnt, vp = sz <= 4 ? e + 8 : u32(e + 8);
        if (vp + sz > b.length) continue;
        list.push({ tag: u16(e), type: type, count: cnt, raw: b.slice(vp, vp + sz) });
      }
      ex.ifds[name] = list;
      return off + 6 + n * 12 <= b.length ? u32(off + 2 + n * 12) : 0;
    }
    var next = readIfd(u32(4), 'ifd0');
    var ptr = function (ifd, tag) { var e = (ex.ifds[ifd] || []).filter(function (x) { return x.tag === tag && x.raw.length >= 4; })[0]; return e ? dv(e.raw).getUint32(0, le) : 0; };
    readIfd(ptr('ifd0', 0x8769), 'exif');
    readIfd(ptr('ifd0', 0x8825), 'gps');
    readIfd(ptr('exif', 0xA005), 'interop');
    if (next && readIfd(next, 'ifd1') !== null) {
      var to = ptr('ifd1', 0x0201), tl = ptr('ifd1', 0x0202);
      if (to && tl && to + tl <= b.length) ex.thumb = b.slice(to, to + tl);
    }
    return ex;
  }

  function nums(ex, e) {
    var D = dv(e.raw), le = ex.le, out = [], n = Math.min(e.count, 512);
    for (var i = 0; i < n; i++) {
      switch (e.type) {
        case 1: case 7: out.push(e.raw[i]); break;
        case 6: out.push(e.raw[i] << 24 >> 24); break;
        case 3: out.push(D.getUint16(i * 2, le)); break;
        case 8: out.push(D.getInt16(i * 2, le)); break;
        case 4: case 13: out.push(D.getUint32(i * 4, le)); break;
        case 9: out.push(D.getInt32(i * 4, le)); break;
        case 5: var a = D.getUint32(i * 8, le), b = D.getUint32(i * 8 + 4, le); out.push(b ? a / b : 0); break;
        case 10: var c = D.getInt32(i * 8, le), d = D.getInt32(i * 8 + 4, le); out.push(d ? c / d : 0); break;
        case 11: out.push(D.getFloat32(i * 4, le)); break;
        case 12: out.push(D.getFloat64(i * 8, le)); break;
      }
    }
    return out;
  }
  function ucs2(raw, le) {
    var s = '';
    for (var i = 0; i + 1 < raw.length; i += 2) { var c = le ? raw[i] | (raw[i + 1] << 8) : (raw[i] << 8) | raw[i + 1]; if (!c) break; s += String.fromCharCode(c); }
    return s;
  }
  /** UserComment, GPSProcessingMethod: 8 bajtów kodu znaków + tekst. */
  function encText(raw, le) {
    var code = ascii(raw, 0, 8).replace(/\0+$/, ''), body = raw.subarray(8);
    if (code === 'UNICODE') {
      if (body[0] === 0xFE && body[1] === 0xFF) return ucs2(body.subarray(2), false).trim();
      if (body[0] === 0xFF && body[1] === 0xFE) return ucs2(body.subarray(2), true).trim();
      return ucs2(body, le).trim();
    }
    return cstr(body).trim();
  }
  function hex(raw, max) {
    var s = [], n = Math.min(raw.length, max || 24);
    for (var i = 0; i < n; i++) s.push((raw[i] < 16 ? '0' : '') + raw[i].toString(16));
    return s.join(' ') + (raw.length > n ? ' …' : '');
  }
  function dms(d) { return round(d[0] + d[1] / 60 + d[2] / 3600, 6) + '° (' + d[0] + '° ' + d[1] + '′ ' + round(d[2], 2) + '″)'; }
  function tagName(ifd, tag) { return (ifd === 'gps' ? GPS_TAGS[tag] : TAGS[tag]) || ('0x' + ('000' + tag.toString(16)).slice(-4)); }

  /** Wartość znacznika EXIF do wyświetlenia. */
  function fmtTag(ex, ifd, e) {
    var t = e.tag, le = ex.le, n;
    if (ifd === 'gps') {
      if ((t === 2 || t === 4 || t === 20 || t === 22) && e.count === 3) return dms(nums(ex, e));
      if (t === 7 && e.count === 3) { n = nums(ex, e); return pad(n[0]) + ':' + pad(n[1]) + ':' + pad(round(n[2], 2)) + ' UTC'; }
      if (t === 27 || t === 28) return encText(e.raw, le);
      if (t === 0) return Array.prototype.join.call(e.raw, '.');
      if (t === 6) return round(nums(ex, e)[0], 2) + ' m';
      if (t === 5) return e.raw[0] === 1 ? 'Below sea level' : 'Above sea level';
    } else {
      if (t >= 0x9C9B && t <= 0x9C9F) return ucs2(e.raw, true);
      if (t === 0x9286) return encText(e.raw, le);
      if (t === 0x9000 || t === 0xA000 || (ifd === 'interop' && t === 2)) return ascii(e.raw, 0, Math.min(4, e.raw.length));
      if (t === 0x829A) { n = nums(ex, e)[0]; return n > 0 && n < 1 ? '1/' + round(1 / n, 1) + ' s' : round(n, 3) + ' s'; }
      if (t === 0x829D) return 'f/' + round(nums(ex, e)[0], 1);
      if (t === 0x9202 || t === 0x9205) return 'f/' + round(Math.pow(2, nums(ex, e)[0] / 2), 1);
      if (t === 0x9201) { n = Math.pow(2, -nums(ex, e)[0]); return n > 0 && n < 1 ? '1/' + round(1 / n, 0) + ' s' : round(n, 2) + ' s'; }
      if (t === 0x920A) return round(nums(ex, e)[0], 1) + ' mm';
      if (t === 0xA405) return nums(ex, e)[0] + ' mm';
      if (t === 0x9204) return round(nums(ex, e)[0], 2) + ' EV';
      if (t === 0x9209) { n = nums(ex, e)[0]; return (n & 1 ? 'Fired' : 'No flash') + ' (0x' + n.toString(16) + ')'; }
      if (t === 0xA432 && e.count === 4) { n = nums(ex, e).map(function (x) { return round(x, 1); }); return n[0] + (n[1] !== n[0] ? '–' + n[1] : '') + ' mm f/' + n[2] + (n[3] !== n[2] ? '–' + n[3] : ''); }
      if (t === 0x927C || t === 0xC4A5 || t === 0xEA1C || t === 0x8773 || t === 0x83BB || t === 0x02BC || t === 0x8649) return T('bytes', { n: e.raw.length.toLocaleString(LANG) });
      if (ENUM[t] && e.type !== 2) { n = nums(ex, e)[0]; return String(ENUM[t][n] != null ? ENUM[t][n] : n); }
    }
    if (e.type === 2) return cstr(e.raw);
    if ((e.type === 7 || e.type === 1 || e.type === 6) && e.raw.length > 24) return T('bytes', { n: e.raw.length.toLocaleString(LANG) });
    if (e.type === 7) return /^[\x20-\x7e]+\0*$/.test(ascii(e.raw, 0, e.raw.length)) ? cstr(e.raw) : hex(e.raw);
    var a = nums(ex, e).map(function (x) { return round(x); });
    return a.length > 16 ? a.slice(0, 16).join(', ') + ' … (' + e.count + ')' : a.join(', ');
  }
  function getTag(ex, ifd, tag) { return ex && ex.ifds[ifd] ? ex.ifds[ifd].filter(function (e) { return e.tag === tag; })[0] || null : null; }
  function tagText(ex, ifd, tag) { var e = getTag(ex, ifd, tag); return e ? String(fmtTag(ex, ifd, e)).trim() : ''; }
  function exifDate(s) { var m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/.exec(s || ''); return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + (m[6] ? ':' + m[6] : '') : s; }

  function gpsOf(ex) {
    if (!ex || !ex.ifds.gps) return null;
    var la = getTag(ex, 'gps', 2), lo = getTag(ex, 'gps', 4);
    if (!la || !lo || la.count < 3 || lo.count < 3) return null;
    var a = nums(ex, la), b = nums(ex, lo), lat = a[0] + a[1] / 60 + a[2] / 3600, lon = b[0] + b[1] / 60 + b[2] / 3600;
    if (/S/i.test(tagText(ex, 'gps', 1))) lat = -lat;
    if (/W/i.test(tagText(ex, 'gps', 3))) lon = -lon;
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    var alt = getTag(ex, 'gps', 6), altv = alt ? nums(ex, alt)[0] : null;
    if (altv != null && getTag(ex, 'gps', 5) && getTag(ex, 'gps', 5).raw[0] === 1) altv = -altv;
    return { lat: round(lat, 6), lon: round(lon, 6), alt: altv == null ? null : round(altv, 1), zero: lat === 0 && lon === 0 };
  }

  /** Tworzy strukturę TIFF z katalogów (ta sama kolejność bajtów co oryginał). */
  function buildTiff(le, I, thumb) {
    var P = function (tag) { return { tag: tag, type: 4, count: 1, raw: new Uint8Array(4), ptr: true }; };
    var strip = function (l, tags) { return (l || []).filter(function (e) { return tags.indexOf(e.tag) < 0; }); };
    var i0 = strip(I.ifd0, [0x8769, 0x8825, 0x0201, 0x0202]);
    var iop = I.interop && I.interop.length ? I.interop.slice() : null;
    var ex = strip(I.exif, [0xA005]);
    if (!ex.length && !iop) ex = null;
    var gps = I.gps && I.gps.length ? I.gps.slice() : null;
    var i1 = thumb && I.ifd1 ? strip(I.ifd1, [0x0201, 0x0202]) : null;
    if (ex) i0.push(P(0x8769));
    if (gps) i0.push(P(0x8825));
    if (ex && iop) ex.push(P(0xA005));
    if (i1) { i1.push(P(0x0201)); var L = P(0x0202); L.len = thumb.length; i1.push(L); }
    var order = [['ifd0', i0], ['exif', ex], ['interop', ex && iop], ['gps', gps], ['ifd1', i1]].filter(function (x) { return x[1]; });
    order.forEach(function (x) { x[1].sort(function (a, b) { return a.tag - b.tag; }); });
    var size = function (l) { var s = 6 + 12 * l.length; l.forEach(function (e) { if (!e.ptr && e.raw.length > 4) s += e.raw.length + (e.raw.length & 1); }); return s; };
    var pos = 8, off = {};
    order.forEach(function (x) { off[x[0]] = pos; pos += size(x[1]); });
    var thumbOff = pos;
    if (i1) pos += thumb.length;
    var out = new Uint8Array(pos), D = new DataView(out.buffer);
    out[0] = out[1] = le ? 0x49 : 0x4D;
    D.setUint16(2, 42, le); D.setUint32(4, 8, le);
    order.forEach(function (x) {
      var l = x[1], p = off[x[0]], data = p + 6 + 12 * l.length;
      D.setUint16(p, l.length, le);
      l.forEach(function (e, i) {
        var q = p + 2 + i * 12;
        D.setUint16(q, e.tag, le); D.setUint16(q + 2, e.type, le); D.setUint32(q + 4, e.count, le);
        if (e.ptr) D.setUint32(q + 8, e.tag === 0x8769 ? off.exif : e.tag === 0x8825 ? off.gps : e.tag === 0xA005 ? off.interop : e.tag === 0x0201 ? thumbOff : e.len, le);
        else if (e.raw.length <= 4) out.set(e.raw, q + 8);
        else { D.setUint32(q + 8, data, le); out.set(e.raw, data); data += e.raw.length + (e.raw.length & 1); }
      });
      D.setUint32(p + 2 + 12 * l.length, x[0] === 'ifd0' && i1 ? off.ifd1 : 0, le);
    });
    if (i1) out.set(thumb, thumbOff);
    return out;
  }
  function asciiEntry(tag, s) { var u = utf8enc.encode(s), raw = new Uint8Array(u.length + 1); raw.set(u); return { tag: tag, type: 2, count: raw.length, raw: raw }; }
  function xpEntry(tag, s) { var raw = new Uint8Array(s.length * 2 + 2); for (var i = 0; i < s.length; i++) { raw[i * 2] = s.charCodeAt(i) & 255; raw[i * 2 + 1] = s.charCodeAt(i) >> 8; } return { tag: tag, type: 1, count: raw.length, raw: raw }; }
  function shortEntry(tag, v, le) { var raw = new Uint8Array(2); new DataView(raw.buffer).setUint16(0, v, le); return { tag: tag, type: 3, count: 1, raw: raw }; }
  function setTag(list, tag, entry) {
    for (var i = list.length - 1; i >= 0; i--) if (list[i].tag === tag) list.splice(i, 1);
    if (entry) list.push(entry);
  }

  /* ====================================================================== */
  /* XMP, IPTC, ICC                                                         */
  /* ====================================================================== */

  var RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  function kids(el) { return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 1; }); }
  function attrs(el) {
    return Array.prototype.filter.call(el.attributes, function (a) { return !/^xmlns(:|$)/.test(a.name) && a.namespaceURI !== RDF && a.name !== 'xml:lang'; })
      .map(function (a) { return [a.name, a.value]; });
  }
  function xmpValue(el) {
    var ch = kids(el);
    if (!ch.length) {
      var at = attrs(el);
      if (at.length) return '{' + at.map(function (kv) { return kv[0] + '=' + kv[1]; }).join(', ') + '}';
      return el.getAttributeNS(RDF, 'resource') || el.textContent.trim();
    }
    var c = ch[0];
    if (c.namespaceURI === RDF && /^(Alt|Bag|Seq)$/.test(c.localName)) return kids(c).map(xmpValue).join('; ');
    var target = c.namespaceURI === RDF && c.localName === 'Description' ? c : el;
    var parts = attrs(target).map(function (kv) { return kv[0] + '=' + kv[1]; });
    kids(target).forEach(function (k) { parts.push(k.nodeName + '=' + xmpValue(k)); });
    return '{' + parts.join(', ') + '}';
  }
  function parseXmp(xml) {
    var r = { props: [], history: [], people: [], xml: xml };
    var doc = new DOMParser().parseFromString(xml.replace(/^[^<]+/, '').replace(/[\s\0]+$/, ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) { r.error = true; return r; }
    Array.prototype.forEach.call(doc.getElementsByTagNameNS(RDF, 'Description'), function (d) {
      if (d.parentNode && d.parentNode.namespaceURI === RDF && d.parentNode.localName !== 'RDF') return;
      attrs(d).forEach(function (kv) { r.props.push(kv); });
      kids(d).forEach(function (k) { r.props.push([k.nodeName, xmpValue(k)]); });
    });
    Array.prototype.forEach.call(doc.getElementsByTagName('*'), function (el) {
      if (el.localName !== 'History') return;
      var seq = kids(el)[0];
      if (!seq) return;
      kids(seq).forEach(function (li) {
        var o = {};
        attrs(li).forEach(function (kv) { o[kv[0].replace(/^.*:/, '')] = kv[1]; });
        kids(li).forEach(function (k) {
          if (k.namespaceURI === RDF && k.localName === 'Description') { attrs(k).forEach(function (kv) { o[kv[0].replace(/^.*:/, '')] = kv[1]; }); kids(k).forEach(function (kk) { o[kk.localName] = kk.textContent.trim(); }); }
          else o[k.localName] = k.textContent.trim();
        });
        r.history.push(o);
      });
    });
    var re = /(?:mwg-rs:Name|MPRI:PersonDisplayName|MP:PersonDisplayName|Iptc4xmpExt:PersonInImage)(?:\s*=\s*"([^"]*)"|>([^<]*)<)/g, m;
    while ((m = re.exec(xml))) { var nm = (m[1] || m[2] || '').trim(); if (nm) r.people.push(K.xmlText(nm)); }
    var pin = r.props.filter(function (p) { return /PersonInImage$/.test(p[0]); })[0];
    if (pin) pin[1].split('; ').forEach(function (n) { r.people.push(n); });
    r.people = uniq(r.people);
    return r;
  }
  /** Usuwa z pakietu XMP właściwości o podanych nazwach (wyrażenia regularne nazw kwalifikowanych). */
  function xmpStrip(xml, names) {
    names.forEach(function (n) {
      xml = xml.replace(new RegExp('\\s(' + n + ')\\s*=\\s*("[^"]*"|\'[^\']*\')', 'g'), '')
        .replace(new RegExp('<(' + n + ')\\b[^>]*/>', 'g'), '')
        .replace(new RegExp('<(' + n + ')\\b[^>]*>[\\s\\S]*?</\\1>', 'g'), '');
    });
    return xml;
  }
  var XMP_GPS = ['exif:GPS\\w+', 'exifEX:GPS\\w+', 'photoshop:(?:City|State|Country)', 'Iptc4xmpCore:(?:Location|CountryCode)', 'Iptc4xmpExt:Location(?:Created|Shown)', 'drone-dji:\\w*(?:Latitude|Longitude|Altitude)\\w*', 'Camera:(?:Latitude|Longitude|Altitude)\\w*'];
  var XMP_IDS = ['aux:SerialNumber', 'aux:LensSerialNumber', 'aux:OwnerName', 'exifEX:(?:BodySerialNumber|LensSerialNumber|CameraOwnerName)', 'exif:ImageUniqueID', 'exifEX:ImageUniqueID',
    'xmpMM:(?:DocumentID|InstanceID|OriginalDocumentID|DerivedFrom|History|Ingredients|Manifest|Pantry|PreservedFileName)', 'photoshop:DocumentAncestors', 'aux:ImageNumber'];
  var XMP_DATES = ['xmp:(?:CreateDate|ModifyDate|MetadataDate)', 'photoshop:DateCreated', 'exif:(?:DateTimeOriginal|DateTimeDigitized)', 'tiff:DateTime', 'stEvt:when', 'Iptc4xmpCore:DateCreated'];
  var XMP_THUMB = ['xmp:Thumbnails', 'xapGImg:image', 'xmpGImg:image'];

  var IPTC2 = { 0: 'RecordVersion', 5: 'ObjectName', 7: 'EditStatus', 10: 'Urgency', 12: 'SubjectReference', 15: 'Category', 20: 'SupplementalCategories', 22: 'FixtureIdentifier',
    25: 'Keywords', 26: 'ContentLocationCode', 27: 'ContentLocationName', 30: 'ReleaseDate', 35: 'ReleaseTime', 37: 'ExpirationDate', 40: 'SpecialInstructions',
    55: 'DateCreated', 60: 'TimeCreated', 62: 'DigitalCreationDate', 63: 'DigitalCreationTime', 65: 'OriginatingProgram', 70: 'ProgramVersion', 75: 'ObjectCycle',
    80: 'By-line', 85: 'By-lineTitle', 90: 'City', 92: 'Sub-location', 95: 'Province-State', 100: 'Country-PrimaryLocationCode', 101: 'Country-PrimaryLocationName',
    103: 'OriginalTransmissionReference', 105: 'Headline', 110: 'Credit', 115: 'Source', 116: 'CopyrightNotice', 118: 'Contact', 120: 'Caption-Abstract', 122: 'Writer-Editor' };
  var IPTC_LOC = [26, 27, 90, 92, 95, 100, 101], IPTC_DATES = [30, 35, 37, 55, 60, 62, 63];
  function parseIim(b) {
    var out = [], p = 0, utf8 = false;
    while (p + 5 <= b.length && b[p] === 0x1C) {
      var rec = b[p + 1], ds = b[p + 2], len = be16(b, p + 3), q = p + 5;
      if (len & 0x8000) { var n = len & 0x7fff; len = 0; for (var i = 0; i < n; i++) len = len * 256 + b[q + i]; q += n; }
      if (q + len > b.length) break;
      var d = b.subarray(q, q + len);
      if (rec === 1 && ds === 90 && d[0] === 0x1B && d[1] === 0x25 && d[2] === 0x47) utf8 = true;
      out.push({ rec: rec, ds: ds, data: d, raw: b.subarray(p, q + len) });
      p = q + len;
    }
    out.forEach(function (x) {
      x.name = x.rec === 2 ? IPTC2[x.ds] || '2:' + x.ds : x.rec === 1 && x.ds === 90 ? 'CodedCharacterSet' : x.rec + ':' + x.ds;
      x.value = x.rec === 2 && x.ds === 0 ? String(be16(x.data, 0)) : x.rec === 1 && x.ds === 90 ? (utf8 ? 'UTF-8' : hex(x.data)) : utf8 ? K.u8str(x.data) : text(x.data);
    });
    return out;
  }
  var IRB_NAMES = { 0x03E9: 'PrintInfo', 0x03ED: 'ResolutionInfo', 0x03F3: 'PrintFlags', 0x0404: 'IPTC-NAA', 0x0406: 'JPEG_Quality', 0x0408: 'GridGuides',
    0x0409: 'PhotoshopThumbnail (old)', 0x040A: 'CopyrightFlag', 0x040B: 'URL', 0x040C: 'PhotoshopThumbnail', 0x040D: 'GlobalAngle', 0x040F: 'ICC_Profile',
    0x0414: 'IDsBaseValue', 0x0419: 'GlobalAltitude', 0x041A: 'Slices', 0x041E: 'URL_List', 0x0421: 'VersionInfo', 0x0422: 'EXIFInfo', 0x0424: 'XMP',
    0x0425: 'IPTCDigest', 0x0426: 'PrintScale', 0x0428: 'PixelInfo', 0x0BB7: 'ClippingPathName', 0x2710: 'PrintFlagsInfo' };
  function parseIrb(b) {
    var p = 0, out = [];
    while (p + 12 <= b.length && starts(b, p, '8BIM')) {
      var id = be16(b, p + 4), nl = b[p + 6], q = p + 6 + ((nl + 2) & ~1);
      if (q + 4 > b.length) break;
      var size = be32(b, q), end = q + 4 + size;
      if (end > b.length) break;
      out.push({ id: id, head: b.subarray(p, q), data: b.subarray(q + 4, end), name: IRB_NAMES[id] || '0x' + id.toString(16) });
      p = end + (size & 1);
    }
    return out;
  }
  function buildIrb(res) {
    var parts = [];
    res.forEach(function (r) { var sz = new Uint8Array(4); wbe32(sz, 0, r.data.length); parts.push(r.head, sz, r.data); if (r.data.length & 1) parts.push(new Uint8Array(1)); });
    return concat(parts);
  }

  function parseIcc(b) {
    if (!b || b.length < 132) return null;
    var r = { size: be32(b, 0), cmm: ascii(b, 4, 4).replace(/\0/g, '').trim(), version: b[8] + '.' + (b[9] >> 4) + '.' + (b[9] & 15), cls: ascii(b, 12, 4), space: ascii(b, 16, 4).trim(),
      pcs: ascii(b, 20, 4).trim(), platform: ascii(b, 40, 4).replace(/\0/g, '').trim(), manufacturer: ascii(b, 48, 4).replace(/\0/g, '').trim(),
      model: ascii(b, 52, 4).replace(/\0/g, '').trim(), creator: ascii(b, 80, 4).replace(/\0/g, '').trim() };
    var y = be16(b, 24);
    if (y) r.date = y + '-' + pad(be16(b, 26)) + '-' + pad(be16(b, 28)) + ' ' + pad(be16(b, 30)) + ':' + pad(be16(b, 32)) + ':' + pad(be16(b, 34)) + ' UTC';
    var n = Math.min(be32(b, 128), 200);
    var tag = function (sig) {
      for (var i = 0; i < n; i++) {
        var p = 132 + i * 12;
        if (p + 12 > b.length || ascii(b, p, 4) !== sig) continue;
        var off = be32(b, p + 4), size = be32(b, p + 8);
        if (off + size > b.length || size < 12) return '';
        var type = ascii(b, off, 4);
        if (type === 'desc') return cstr(b.subarray(off + 12, off + 12 + Math.min(be32(b, off + 8), size - 12)));
        if (type === 'text') return cstr(b.subarray(off + 8, off + size));
        if (type === 'mluc' && size >= 28) { var len = be32(b, off + 20), o = be32(b, off + 24); return ucs2(b.subarray(off + o, off + o + len), false).trim(); }
        return '';
      }
      return '';
    };
    r.desc = tag('desc'); r.cprt = tag('cprt'); r.dmnd = tag('dmnd'); r.dmdd = tag('dmdd');
    return r;
  }

  /* ====================================================================== */
  /* Kontenery: JPEG, PNG, WEBP                                             */
  /* ====================================================================== */

  var NS_XMP = 'http://ns.adobe.com/xap/1.0/\0', NS_XMPEXT = 'http://ns.adobe.com/xmp/extension/\0';

  function parseJpeg(b) {
    var segs = [], p = 2, sos = -1, guard = 0;
    while (p + 2 <= b.length && guard++ < 100000) {
      if (b[p] !== 0xFF) fail('jpeg_error');
      var mk = b[p + 1];
      if (mk === 0xFF) { p++; continue; }
      if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { p += 2; continue; }
      if (mk === 0xD9) { p += 2; break; }
      if (p + 4 > b.length) fail('jpeg_error');
      var len = be16(b, p + 2), end = p + 2 + len;
      if (len < 2 || end > b.length) fail('jpeg_error');
      var s = { m: mk, start: p, end: end, data: b.subarray(p + 4, end), pre: sos < 0 };
      segs.push(s);
      p = end;
      if (mk === 0xDA) {
        if (sos < 0) sos = s.start;
        while (p + 1 < b.length) {
          if (b[p] === 0xFF) { var n = b[p + 1]; if (n === 0 || (n >= 0xD0 && n <= 0xD7)) { p += 2; continue; } if (n === 0xFF) { p++; continue; } break; }
          p++;
        }
      }
    }
    if (sos < 0) fail('jpeg_error');
    segs.forEach(function (s) {
      var d = s.data, m = s.m;
      s.kind = 'core';
      if (!s.pre) return;
      if (m === 0xE0) s.kind = starts(d, 0, 'JFIF\0') ? 'jfif' : starts(d, 0, 'JFXX\0') ? 'jfxx' : 'app';
      else if (m === 0xE1) s.kind = starts(d, 0, 'Exif\0') ? 'exif' : starts(d, 0, NS_XMP) ? 'xmp' : starts(d, 0, NS_XMPEXT) ? 'xmpext' : 'app';
      else if (m === 0xE2) s.kind = starts(d, 0, 'ICC_PROFILE\0') ? 'icc' : starts(d, 0, 'MPF\0') ? 'mpf' : starts(d, 0, 'FPXR\0') ? 'fpxr' : 'app';
      else if (m === 0xEB) s.kind = starts(d, 0, 'JP') ? 'c2pa' : 'app';
      else if (m === 0xEC) s.kind = starts(d, 0, 'Ducky') ? 'ducky' : 'app';
      else if (m === 0xED) s.kind = starts(d, 0, 'Photoshop 3.0\0') ? 'irb' : 'app';
      else if (m === 0xEE) s.kind = starts(d, 0, 'Adobe') ? 'adobe' : 'app';
      else if (m === 0xFE) s.kind = 'com';
      else if (m >= 0xE0 && m <= 0xEF) s.kind = 'app';
    });
    return { segs: segs, sos: sos, end: p };
  }

  function parsePng(b) {
    var chunks = [], p = 8;
    while (p + 12 <= b.length) {
      var len = be32(b, p), type = ascii(b, p + 4, 4), end = p + 12 + len;
      if (end > b.length || !/^[A-Za-z]{4}$/.test(type)) fail('png_error');
      chunks.push({ type: type, start: p, end: end, data: b.subarray(p + 8, p + 8 + len) });
      p = end;
      if (type === 'IEND') break;
    }
    if (!chunks.length || chunks[0].type !== 'IHDR') fail('png_error');
    return { chunks: chunks, end: p };
  }
  /** Fragment tekstowy PNG → { key, value, lang?, compressed? }. */
  function pngText(c) {
    var d = c.data, z = d.indexOf(0);
    if (z < 0) return { key: K.latin1(d), value: '' };
    var key = K.latin1(d, 0, z), r = { key: key };
    try {
      if (c.type === 'tEXt') r.value = K.latin1(d, z + 1);
      else if (c.type === 'zTXt') { r.value = K.latin1(inflate(d.subarray(z + 2))); r.compressed = true; }
      else {
        var flag = d[z + 1], q = z + 3, l = d.indexOf(0, q), t = d.indexOf(0, l + 1);
        r.lang = K.latin1(d, q, l); r.tkey = K.u8str(d.subarray(l + 1, t));
        var body = d.subarray(t + 1);
        r.value = K.u8str(flag ? inflate(body) : body); r.compressed = !!flag;
      }
    } catch (e) { r.value = ''; r.broken = true; }
    return r;
  }
  /** Surowe profile ImageMagick/exiftool („Raw profile type exif” itd.) – dane szesnastkowo w tekście. */
  function rawProfile(v) {
    var m = /^\s*\n?\s*([\w-]+)\s*\n\s*(\d+)\s*\n([\s\S]*)$/.exec(v || '');
    if (!m) return null;
    var h = m[3].replace(/[^0-9a-f]/gi, ''), n = Math.min(+m[2], h.length >> 1), o = new Uint8Array(n);
    for (var i = 0; i < n; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
    return o;
  }

  function parseWebp(b) {
    var size = le32(b, 4), end = Math.min(8 + size, b.length), chunks = [], p = 12;
    while (p + 8 <= end) {
      var cc = ascii(b, p, 4), sz = le32(b, p + 4), dend = p + 8 + sz;
      if (dend > b.length) fail('webp_error');
      chunks.push({ type: cc, start: p, end: Math.min(dend + (sz & 1), b.length), data: b.subarray(p + 8, dend) });
      p = dend + (sz & 1);
    }
    if (!chunks.length) fail('webp_error');
    return { chunks: chunks, end: Math.min(Math.max(p, end), b.length) };
  }
  function webpChunk(type, data) {
    var h = new Uint8Array(8); h.set(asc(type)); wle32(h, 4, data.length);
    return data.length & 1 ? concat([h, data, new Uint8Array(1)]) : concat([h, data]);
  }
  function pngChunk(type, data) {
    var h = new Uint8Array(8), t = asc(type), c = new Uint8Array(4);
    wbe32(h, 0, data.length); h.set(t, 4); wbe32(c, 0, crc32([t, data]));
    return concat([h, data, c]);
  }
  function jpegSeg(marker, data) {
    if (data.length + 2 > 65535) fail('segment_too_big');
    var h = new Uint8Array(4); h[0] = 0xFF; h[1] = marker; h[2] = (data.length + 2) >> 8; h[3] = (data.length + 2) & 255;
    return concat([h, data]);
  }
  function tiffOf(d) { return starts(d, 0, 'Exif\0') ? d.subarray(6) : d; }

  /* ====================================================================== */
  /* Analiza                                                                */
  /* ====================================================================== */

  var PNG_SAFE = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'cICP', 'mDCV', 'cLLI', 'sBIT', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT'];
  var PNG_TEXT = ['tEXt', 'zTXt', 'iTXt'];
  var AI_KEYS = /^(parameters|prompt|workflow|negative_prompt|sd-metadata|invokeai_metadata|dream|generation_data|aigc)$/i;
  var COLOR_TYPES = { 0: 'Grayscale', 2: 'RGB', 3: 'Palette', 4: 'Grayscale + alpha', 6: 'RGBA' };

  function detect(b) {
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (starts(b, 0, '\x89PNG\r\n\x1a\n')) return 'png';
    if (starts(b, 0, 'RIFF') && starts(b, 8, 'WEBP')) return 'webp';
    fail('unknown_image');
  }

  function analyze(bytes, file) {
    var m = { bytes: bytes, file: file, format: detect(bytes), struct: [], ex: null, exSrc: '', xmps: [], iim: [], irb: [], icc: null, iccSrc: '',
      texts: [], c2pa: 0, trailer: 0, mpf: 0, thumbs: [], info: [], metaBytes: 0, alerts: [], other: [] };
    var addStruct = function (name, size, meta, note) { m.struct.push({ name: name, size: size, meta: meta, note: note || '' }); if (meta) m.metaBytes += size; };
    var setExif = function (tiff, src) { if (m.ex) return; var ex = parseTiff(tiff); if (ex) { m.ex = ex; m.exSrc = src; } };
    var addXmp = function (bytesOrStr, src) {
      var xml = typeof bytesOrStr === 'string' ? bytesOrStr : text(bytesOrStr);
      try { var x = parseXmp(xml); x.src = src; m.xmps.push(x); } catch (e) { m.xmps.push({ props: [], history: [], people: [], xml: xml, error: true, src: src }); }
    };
    var addIrb = function (d, src) {
      var res = parseIrb(d);
      m.irb = m.irb.concat(res.map(function (r) { return r.name; }));
      res.forEach(function (r) {
        if (r.id === 0x0404) m.iim = m.iim.concat(parseIim(r.data));
        else if ((r.id === 0x040C || r.id === 0x0409) && r.data.length > 28 && r.data[28] === 0xFF && r.data[29] === 0xD8) m.thumbs.push({ src: 'Photoshop', data: r.data.subarray(28) });
        else if (r.id === 0x040F && !m.icc) { m.icc = parseIcc(r.data); m.iccSrc = 'Photoshop'; }
      });
    };
    var b = bytes;

    if (m.format === 'jpeg') {
      var J = parseJpeg(b), iccParts = [], ext = {};
      m.jpeg = J;
      J.segs.forEach(function (s) {
        var mk = 'FF' + s.m.toString(16).toUpperCase(), size = s.end - s.start, d = s.data;
        if (s.m >= 0xC0 && s.m <= 0xCF && s.m !== 0xC4 && s.m !== 0xC8 && s.m !== 0xCC && !m.height) {
          m.precision = d[0]; m.height = be16(d, 1); m.width = be16(d, 3); m.components = d[5]; m.progressive = s.m === 0xC2 || s.m === 0xC6 || s.m === 0xCA;
        }
        if (s.kind === 'core') { if (s.pre && s.m !== 0xDA) addStruct(mk + ' ' + ({ 0xDB: 'DQT', 0xC4: 'DHT', 0xDD: 'DRI', 0xC0: 'SOF0', 0xC1: 'SOF1', 0xC2: 'SOF2' }[s.m] || ''), size, false); return; }
        var label = 'APP' + (s.m - 0xE0);
        switch (s.kind) {
          case 'jfif': m.jfif = d[5] + '.' + pad(d[6]) + (d[7] ? ', ' + be16(d, 8) + '×' + be16(d, 10) + (d[7] === 1 ? ' dpi' : ' dpcm') : ''); addStruct(label + ' JFIF', size, false); break;
          case 'jfxx': if (d[5] === 0x10) m.thumbs.push({ src: 'JFXX', data: d.subarray(6) }); addStruct(label + ' JFXX', size, true, T('st.thumbnail')); break;
          case 'exif': setExif(tiffOf(d), 'APP1'); addStruct(label + ' EXIF', size, true); break;
          case 'xmp': addXmp(d.subarray(NS_XMP.length), 'APP1'); addStruct(label + ' XMP', size, true); break;
          case 'xmpext':
            var g = ascii(d, NS_XMPEXT.length, 32), full = be32(d, NS_XMPEXT.length + 32), off = be32(d, NS_XMPEXT.length + 36);
            ext[g] = ext[g] || new Uint8Array(full);
            if (off + d.length - NS_XMPEXT.length - 40 <= full) ext[g].set(d.subarray(NS_XMPEXT.length + 40), off);
            addStruct(label + ' XMP (extended)', size, true); break;
          case 'icc': iccParts.push({ n: d[12], data: d.subarray(14) }); addStruct(label + ' ICC', size, true); break;
          case 'mpf': var mp = parseTiff(d.subarray(4)), nE = mp && getTag(mp, 'ifd0', 0xB001); m.mpf = nE ? nums(mp, nE)[0] : 1; m.mpfSeg = s; addStruct(label + ' MPF', size, true, T('st.mpf', { n: m.mpf })); break;
          case 'irb': addIrb(d.subarray(14), 'APP13'); addStruct(label + ' Photoshop/IPTC', size, true); break;
          case 'adobe': m.adobe = d[11]; addStruct(label + ' Adobe', size, false); break;
          case 'c2pa': m.c2pa += size; addStruct(label + ' JUMBF (C2PA)', size, true); break;
          case 'com': m.texts.push({ key: T('jpeg_comment'), value: text(d), src: 'COM' }); addStruct('COM', size, true); break;
          default: var id = cstr(d.subarray(0, 32)).replace(/[^\x20-\x7e]/g, '').slice(0, 24); m.other.push(label + (id ? ' ' + id : '')); addStruct(label + (id ? ' ' + id : '') + (s.kind === 'ducky' ? '' : ''), size, true);
        }
      });
      if (iccParts.length) { iccParts.sort(function (a, c) { return a.n - c.n; }); m.icc = parseIcc(concat(iccParts.map(function (x) { return x.data; }))); m.iccSrc = 'APP2'; }
      Object.keys(ext).forEach(function (g) { addXmp(ext[g], 'APP1 (extended)'); });
      addStruct(T('st.image_data'), J.end - J.sos, false);
      m.trailer = b.length - J.end;
      m.info.push([T('d.jpeg_type'), (m.progressive ? 'Progressive' : 'Baseline') + ', ' + (m.precision || 8) + ' bit, ' + ({ 1: T('cs.gray'), 3: 'YCbCr', 4: 'CMYK' }[m.components] || m.components + ' ' + T('cs.components'))]);
      if (m.jfif) m.info.push([T('d.jfif'), m.jfif]);
    } else if (m.format === 'png') {
      var P = parsePng(b);
      m.png = P;
      P.chunks.forEach(function (c) {
        var size = c.end - c.start, d = c.data, meta = PNG_SAFE.indexOf(c.type) < 0 || c.type === 'iCCP';
        c.kind = 'core';
        if (c.type === 'IHDR') { m.width = be32(d, 0); m.height = be32(d, 4); m.info.push([T('d.png_type'), (COLOR_TYPES[d[9]] || d[9]) + ', ' + d[8] + ' bit' + (d[12] ? ', interlaced' : '')]); }
        else if (c.type === 'acTL') { m.frames = be32(d, 0); }
        else if (c.type === 'pHYs' && d[8] === 1) m.info.push([T('d.dpi'), round(be32(d, 0) * 0.0254, 0) + ' × ' + round(be32(d, 4) * 0.0254, 0) + ' dpi']);
        else if (c.type === 'sRGB') m.info.push([T('d.color'), 'sRGB']);
        else if (c.type === 'gAMA') m.info.push(['gAMA', round(be32(d, 0) / 100000, 5)]);
        else if (c.type === 'cICP') m.info.push(['cICP', Array.prototype.join.call(d, ', ')]);
        else if (c.type === 'iCCP') { c.kind = 'icc'; var z = d.indexOf(0); try { m.icc = parseIcc(inflate(d.subarray(z + 2))); m.iccSrc = 'iCCP'; if (m.icc) m.icc.name = K.latin1(d, 0, z); } catch (e) { /* uszkodzony profil */ } }
        else if (c.type === 'eXIf') { c.kind = 'exif'; setExif(tiffOf(d), 'eXIf'); }
        else if (c.type === 'tIME') { c.kind = 'time'; m.pngTime = be16(d, 0) + '-' + pad(d[2]) + '-' + pad(d[3]) + ' ' + pad(d[4]) + ':' + pad(d[5]) + ':' + pad(d[6]) + ' UTC'; }
        else if (c.type === 'caBX') { c.kind = 'c2pa'; m.c2pa += size; }
        else if (PNG_TEXT.indexOf(c.type) >= 0) {
          var t = pngText(c);
          c.key = t.key;
          if (t.key === 'XML:com.adobe.xmp') { c.kind = 'xmp'; addXmp(t.value, c.type); }
          else if (/^Raw profile type /i.test(t.key)) {
            var typ = t.key.replace(/^Raw profile type /i, '').toLowerCase(), raw = rawProfile(t.value);
            c.kind = typ === 'exif' || typ === 'app1' ? 'rawexif' : typ === 'iptc' || typ === '8bim' ? 'rawiptc' : typ === 'xmp' ? 'xmp' : typ === 'icc' || typ === 'icm' ? 'rawicc' : 'text';
            if (raw && c.kind === 'rawexif') setExif(starts(raw, 0, 'Exif\0') ? raw.subarray(6) : raw, c.type + ' (' + t.key + ')');
            else if (raw && c.kind === 'rawiptc') { var pi = find(raw, '8BIM'); if (pi >= 0) addIrb(raw.subarray(pi), c.type); else m.iim = m.iim.concat(parseIim(raw)); }
            else if (raw && c.kind === 'xmp') addXmp(raw, c.type + ' (' + t.key + ')');
            else if (raw && c.kind === 'rawicc' && !m.icc) { m.icc = parseIcc(raw); m.iccSrc = c.type; }
            else if (c.kind === 'text') m.texts.push({ key: t.key, value: t.value, src: c.type });
          } else { c.kind = 'text'; m.texts.push({ key: t.key + (t.tkey && t.tkey !== t.key ? ' (' + t.tkey + ')' : ''), value: t.value, src: c.type, rawKey: t.key }); }
        } else if (PNG_SAFE.indexOf(c.type) < 0) { c.kind = 'other'; m.other.push(c.type); }
        if (c.type !== 'IDAT' && c.type !== 'fdAT') addStruct(c.type + (c.key ? ' „' + cut(c.key, 30) + '”' : ''), size, meta);
      });
      var idat = P.chunks.filter(function (c) { return c.type === 'IDAT' || c.type === 'fdAT'; });
      if (idat.length) addStruct(T('st.image_data') + ' (IDAT × ' + idat.length + ')', idat.reduce(function (s, c) { return s + c.end - c.start; }, 0), false);
      m.trailer = b.length - P.end;
    } else {
      var W = parseWebp(b);
      m.webp = W;
      var kind = [];
      W.chunks.forEach(function (c) {
        var d = c.data, size = c.end - c.start, meta = false;
        c.kind = 'core';
        if (c.type === 'VP8X') { m.vp8x = d[0]; m.width = le24(d, 4) + 1; m.height = le24(d, 7) + 1; }
        else if (c.type === 'VP8 ' && !m.width) { m.width = le16(d, 6) & 0x3fff; m.height = le16(d, 8) & 0x3fff; }
        else if (c.type === 'VP8L' && !m.width) { var v = le32(d, 1); m.width = (v & 0x3fff) + 1; m.height = ((v >>> 14) & 0x3fff) + 1; m.alpha = (v >>> 28) & 1; }
        if (c.type === 'VP8 ') kind.push('lossy'); else if (c.type === 'VP8L') kind.push('lossless');
        else if (c.type === 'ANMF') { m.frames = (m.frames || 0) + 1; var sub = d.subarray(16); if (find(sub, 'VP8L', 0, 32) >= 0) kind.push('lossless'); else kind.push('lossy'); }
        else if (c.type === 'ALPH') m.alpha = 1;
        else if (c.type === 'ICCP') { c.kind = 'icc'; meta = true; m.icc = parseIcc(d); m.iccSrc = 'ICCP'; }
        else if (c.type === 'EXIF') { c.kind = 'exif'; meta = true; setExif(tiffOf(d), 'EXIF'); }
        else if (c.type === 'XMP ') { c.kind = 'xmp'; meta = true; addXmp(d, 'XMP'); }
        else if (['ANIM', 'VP8X'].indexOf(c.type) < 0) { c.kind = 'other'; meta = true; if (/c2pa/i.test(c.type)) m.c2pa += size; else m.other.push(c.type.trim()); }
        if (c.type !== 'ANMF' || m.frames === 1) addStruct(c.type === 'ANMF' ? 'ANMF …' : c.type.trim(), size, meta);
      });
      if (m.vp8x != null) m.alpha = m.alpha || (m.vp8x & 0x10 ? 1 : 0);
      m.info.push([T('d.webp_type'), uniq(kind).join(' + ') + (m.vp8x != null ? ' (VP8X)' : '') + (m.alpha ? ', alpha' : '')]);
      m.trailer = b.length - W.end;
    }
    if (m.trailer > 0) {
      var tr = b.subarray(b.length - m.trailer), what = [];
      if (find(tr, 'ftyp', 0, Math.min(tr.length, 4096 * 1024)) >= 0) what.push(T('st.video'));
      if (m.mpf > 1 || (tr[0] === 0xFF && tr[1] === 0xD8) || find(tr, '\xFF\xD8\xFF', 0, 64) >= 0) what.push(T('st.jpeg_images'));
      m.trailerWhat = what.join(', ');
      addStruct(T('st.trailer'), m.trailer, true, m.trailerWhat);
    }
    if (m.ex && m.ex.thumb && m.ex.thumb[0] === 0xFF && m.ex.thumb[1] === 0xD8) m.thumbs.unshift({ src: 'EXIF', data: m.ex.thumb });
    var o = m.ex && getTag(m.ex, 'ifd0', 0x0112);
    m.orientation = o ? nums(m.ex, o)[0] : 1;
    build(m);
    return m;
  }

  /* ====================================================================== */
  /* Prezentacja: podsumowanie, sekcje, prywatność                          */
  /* ====================================================================== */

  function xmpGet(m, names) {
    for (var i = 0; i < names.length; i++) for (var j = 0; j < m.xmps.length; j++) {
      var p = m.xmps[j].props.filter(function (x) { return x[0] === names[i]; })[0];
      if (p && p[1]) return p[1];
    }
    return '';
  }
  function iimGet(m, ds) { return uniq(m.iim.filter(function (x) { return x.rec === 2 && x.ds === ds; }).map(function (x) { return x.value; })).join('; '); }
  function txtGet(m, keys) { var t = m.texts.filter(function (x) { return keys.indexOf((x.rawKey || x.key).toLowerCase()) >= 0; })[0]; return t ? t.value : ''; }
  function xmpCoord(s) {
    var r = /^\s*(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?:,(\d+(?:\.\d+)?))?\s*([NSEW])?\s*$/i.exec(s || '');
    if (!r) return null;
    var v = +r[1] + (r[2] ? r[2] / 60 : 0) + (r[3] ? r[3] / 3600 : 0);
    return r[4] && /[SW]/i.test(r[4]) ? -v : v;
  }
  function curFields(m) {
    var ex = m.ex;
    return { artist: tagText(ex, 'ifd0', 0x013B), copyright: tagText(ex, 'ifd0', 0x8298), description: tagText(ex, 'ifd0', 0x010E) };
  }

  function build(m) {
    var ex = m.ex, S = [], sum = [], f = [], opts = {};
    var add = function (k, v, href) { if (v != null && String(v).trim() !== '') sum.push([T('sum.' + k), String(v).trim(), href]); };
    // Podsumowanie
    if (m.width) add('dimensions', m.width + ' × ' + m.height + ' px (' + round(m.width * m.height / 1e6, 1).toLocaleString(LANG) + ' Mpx)' + (m.frames > 1 ? ', ' + T('frames', { n: m.frames }) : ''));
    var make = tagText(ex, 'ifd0', 0x010F) || xmpGet(m, ['tiff:Make']), model = tagText(ex, 'ifd0', 0x0110) || xmpGet(m, ['tiff:Model']);
    add('camera', model && make && model.toLowerCase().indexOf(make.toLowerCase().split(' ')[0]) === 0 ? model : [make, model].filter(Boolean).join(' '));
    add('lens', tagText(ex, 'exif', 0xA434) || xmpGet(m, ['exifEX:LensModel', 'aux:Lens']));
    var taken = tagText(ex, 'exif', 0x9003);
    add('taken', taken ? exifDate(taken) + (tagText(ex, 'exif', 0x9011) ? ' ' + tagText(ex, 'exif', 0x9011) : '') : xmpGet(m, ['exif:DateTimeOriginal', 'photoshop:DateCreated', 'xmp:CreateDate']) || iimGet(m, 55) || txtGet(m, ['creation time', 'date:create']));
    add('modified', exifDate(tagText(ex, 'ifd0', 0x0132)) || xmpGet(m, ['xmp:ModifyDate']) || m.pngTime || txtGet(m, ['date:modify']));
    var expo = [tagText(ex, 'exif', 0x829A), tagText(ex, 'exif', 0x829D), tagText(ex, 'exif', 0x8827) ? 'ISO ' + tagText(ex, 'exif', 0x8827) : '', tagText(ex, 'exif', 0x920A)].filter(Boolean);
    add('exposure', expo.join(' · '));
    add('author', uniq([tagText(ex, 'ifd0', 0x013B), tagText(ex, 'ifd0', 0x9C9D), xmpGet(m, ['dc:creator']), iimGet(m, 80), txtGet(m, ['author', 'artist'])]).join(' / '));
    add('copyright', uniq([tagText(ex, 'ifd0', 0x8298), xmpGet(m, ['dc:rights']), iimGet(m, 116), txtGet(m, ['copyright'])]).join(' / '));
    add('description', uniq([tagText(ex, 'ifd0', 0x010E), tagText(ex, 'ifd0', 0x9C9B), xmpGet(m, ['dc:title', 'dc:description']), iimGet(m, 5), iimGet(m, 120), txtGet(m, ['title', 'description'])]).map(function (x) { return cut(x, 300); }).join(' / '));
    add('software', uniq([tagText(ex, 'ifd0', 0x0131), xmpGet(m, ['xmp:CreatorTool']), iimGet(m, 65), txtGet(m, ['software'])]).join(' / '));
    var gps = gpsOf(ex), loc = null;
    if (gps && !gps.zero) loc = gps;
    else { var xla = xmpCoord(xmpGet(m, ['exif:GPSLatitude'])), xlo = xmpCoord(xmpGet(m, ['exif:GPSLongitude'])); if (xla != null && xlo != null && (xla || xlo)) loc = { lat: round(xla, 6), lon: round(xlo, 6), alt: null }; }
    m.loc = loc;
    if (loc) add('location', loc.lat + ', ' + loc.lon + (loc.alt != null ? ' · ' + loc.alt + ' m' : '') + ' — ' + T('map_link'), 'https://www.openstreetmap.org/?mlat=' + loc.lat + '&mlon=' + loc.lon + '#map=16/' + loc.lat + '/' + loc.lon);
    var place = uniq([xmpGet(m, ['photoshop:City']), iimGet(m, 90), xmpGet(m, ['photoshop:State']), iimGet(m, 95), xmpGet(m, ['photoshop:Country']), iimGet(m, 101)]).join(', ');
    add('place', place);
    if (m.orientation > 1) add('orientation', T('orient.' + m.orientation));
    add('color', m.icc ? (m.icc.desc || m.icc.space) + ' (ICC ' + m.icc.version + ')' : tagText(ex, 'exif', 0xA001));
    var serial = uniq([tagText(ex, 'exif', 0xA431), tagText(ex, 'ifd0', 0xC62F), xmpGet(m, ['aux:SerialNumber', 'exifEX:BodySerialNumber'])]).join(' / ');
    var lensSerial = tagText(ex, 'exif', 0xA435) || xmpGet(m, ['aux:LensSerialNumber', 'exifEX:LensSerialNumber']);
    var owner = tagText(ex, 'exif', 0xA430) || xmpGet(m, ['aux:OwnerName', 'exifEX:CameraOwnerName']);
    add('serial', [serial, lensSerial ? T('lens_serial', { v: lensSerial }) : ''].filter(Boolean).join(' · '));
    add('owner', owner);
    m.summary = sum;

    // Sekcje szczegółowe
    if (ex) ['ifd0', 'exif', 'gps', 'interop', 'ifd1'].forEach(function (k) {
      var l = ex.ifds[k];
      if (!l || !l.length) return;
      var rows = l.filter(function (e) { return [0x8769, 0x8825, 0xA005, 0x0201, 0x0202].indexOf(e.tag) < 0; }).map(function (e) { return [tagName(k, e.tag), fmtTag(ex, k, e)]; });
      if (rows.length) S.push({ icon: k === 'gps' ? 'map-pin' : k === 'ifd1' ? 'photo' : 'camera', title: T('sec.exif_' + k) + ' · ' + IFD_NAMES[k], src: m.exSrc, rows: rows });
    });
    m.xmps.forEach(function (x) {
      var rows = x.error ? [[T('xmp_broken'), T('bytes', { n: x.xml.length.toLocaleString(LANG) })]] : x.props.map(function (p) { return [p[0], /Thumbnails|:image$/.test(p[0]) ? T('chars', { n: p[1].length.toLocaleString(LANG) }) : cut(p[1], 600)]; });
      if (rows.length) S.push({ icon: 'code', title: 'XMP', src: x.src, rows: rows });
    });
    if (m.iim.length) S.push({ icon: 'id', title: 'IPTC', src: 'IIM', rows: m.iim.filter(function (x) { return !(x.rec === 1 && x.ds !== 90); }).map(function (x) { return [x.name, cut(x.value, 600)]; }) });
    if (m.irb.length) S.push({ icon: 'layers-subtract', title: T('sec.photoshop'), src: 'IRB', rows: [[T('irb_resources'), uniq(m.irb).join(', ')]] });
    if (m.icc) {
      var I = m.icc;
      S.push({ icon: 'palette', title: T('sec.icc'), src: m.iccSrc, rows: [[T('icc.desc'), I.desc], [T('icc.copyright'), I.cprt], [T('icc.version'), I.version], [T('icc.class'), I.cls], [T('icc.space'), I.space + ' → ' + I.pcs],
        [T('icc.cmm'), I.cmm], [T('icc.creator'), I.creator], [T('icc.device'), [I.manufacturer, I.model, I.dmnd, I.dmdd].filter(Boolean).join(' / ')], [T('icc.date'), I.date], [T('icc.size'), T('bytes', { n: I.size.toLocaleString(LANG) })], [T('icc.name'), I.name]].filter(function (r) { return r[1]; }) });
    }
    if (m.texts.length) S.push({ icon: 'notes', title: T('sec.texts'), src: '', rows: m.texts.map(function (t) { return [t.key + ' · ' + t.src, cut(t.value, 2000)]; }) });
    var hist = [];
    m.xmps.forEach(function (x) { x.history.forEach(function (h) { hist.push([h.when ? h.when.replace('T', ' ') : '?', [h.action, h.softwareAgent, h.changed ? '(' + h.changed + ')' : ''].filter(Boolean).join(' · ')]); }); });
    if (hist.length) S.push({ icon: 'history', title: T('sec.history'), src: 'XMP', rows: hist });
    m.sections = S;

    // Szczegóły pliku
    m.details = [[T('d.format'), { jpeg: 'JPEG', png: 'PNG' + (m.frames ? ' (APNG)' : ''), webp: 'WebP' }[m.format]]].concat(m.info);
    m.details.push([T('d.meta_size'), K.fmtBytes(m.metaBytes) + ' (' + round(m.metaBytes / m.bytes.length * 100, 1) + '%)']);
    if (m.trailer) m.details.push([T('d.trailer'), K.fmtBytes(m.trailer) + (m.trailerWhat ? ' – ' + m.trailerWhat : '')]);

    // Prywatność
    var people = uniq([].concat.apply([], m.xmps.map(function (x) { return x.people; })));
    var author = sum.filter(function (r) { return r[0] === T('sum.author'); })[0];
    var aiText = m.texts.filter(function (t) { return AI_KEYS.test(t.rawKey || '') || /\bSteps: \d+,.*Sampler|negative prompt:/i.test(t.value); });
    var aiXmp = m.xmps.some(function (x) { return /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/.test(x.xml); }) || /Steps: \d+,.*Sampler/i.test(tagText(ex, 'exif', 0x9286));
    var hasDates = !!(ex && (getTag(ex, 'ifd0', 0x0132) || getTag(ex, 'exif', 0x9003) || getTag(ex, 'exif', 0x9004) || getTag(ex, 'gps', 29))) || m.xmps.some(function (x) { return /CreateDate|ModifyDate|DateCreated|DateTimeOriginal|MetadataDate|stEvt:when/.test(x.xml); }) || !!m.pngTime || m.iim.some(function (x) { return x.rec === 2 && IPTC_DATES.indexOf(x.ds) >= 0; });
    var ids = uniq([tagText(ex, 'exif', 0xA420), xmpGet(m, ['xmpMM:DocumentID']), xmpGet(m, ['xmpMM:OriginalDocumentID'])]);
    var hasSerial = !!(serial || lensSerial || owner || getTag(ex, 'exif', 0x927C) || ids.length || hist.length || m.xmps.some(function (x) { return /DocumentAncestors|xmpMM:(DerivedFrom|Ingredients)/.test(x.xml); }));
    var xmpLoc = m.xmps.some(function (x) { return new RegExp(XMP_GPS.join('|')).test(x.xml); }), iimLoc = m.iim.some(function (x) { return x.rec === 2 && IPTC_LOC.indexOf(x.ds) >= 0; });

    if (loc) f.push(['map-pin', 'danger', T('fi.gps', { v: loc.lat + ', ' + loc.lon })]);
    else if (gps && gps.zero) f.push(['map-pin', 'info', T('fi.gps_zero')]);
    if (place) f.push(['map-pin', 'warn', T('fi.place', { v: place })]);
    if (ex && getTag(ex, 'gps', 17)) f.push(['map-pin', 'info', T('fi.direction')]);
    if (people.length) f.push(['users', 'danger', T('fi.people', { v: people.join(', ') })]);
    if (author) f.push(['user', 'warn', T('fi.author', { v: author[1] })]);
    if (owner) f.push(['user', 'warn', T('fi.owner', { v: owner })]);
    if (serial || lensSerial) f.push(['fingerprint', 'warn', T('fi.serial', { v: [serial, lensSerial].filter(Boolean).join(', ') })]);
    if (getTag(ex, 'exif', 0x927C)) f.push(['fingerprint', 'info', T('fi.makernote', { n: K.fmtBytes(getTag(ex, 'exif', 0x927C).raw.length) })]);
    if (ids.length) f.push(['fingerprint', 'info', T('fi.ids')]);
    if (m.thumbs.length) f.push(['photo', 'warn', T('fi.thumbnail', { v: m.thumbs.map(function (t) { return t.src; }).join(', ') })]);
    if (hist.length) f.push(['history', 'warn', T('fi.history', { n: hist.length })]);
    if (aiText.length || aiXmp) f.push(['robot', 'warn', T('fi.ai')]);
    var comments = m.texts.filter(function (t) { return aiText.indexOf(t) < 0; });
    if (comments.length) f.push(['notes', 'warn', T('fi.texts', { n: comments.length, v: cut(comments.map(function (t) { return t.key + ': ' + t.value; }).join(' | '), 200) })]);
    if (m.c2pa) f.push(['certificate', 'warn', T('fi.c2pa')]);
    if (m.trailer) f.push(['paperclip', 'danger', T('fi.trailer', { n: K.fmtBytes(m.trailer), v: m.trailerWhat || T('st.unknown') })]);
    var cam = sum.filter(function (r) { return r[0] === T('sum.camera'); })[0];
    if (cam) f.push(['camera', 'info', T('fi.camera', { v: cam[1] })]);
    var sw = sum.filter(function (r) { return r[0] === T('sum.software'); })[0];
    if (sw) f.push(['tools', 'info', T('fi.software', { v: sw[1] })]);
    if (hasDates) f.push(['calendar', 'info', T('fi.dates')]);
    if (m.other.length) f.push(['database', 'info', T('fi.other', { v: uniq(m.other).join(', ') })]);
    if (m.icc && /^(?!sRGB|Display P3|Adobe RGB|ProPhoto|Generic|Apple|DCI|Rec|ITU|Coated|Uncoated|U\.S\.|Japan|Euroscale|Dot Gain|Gray Gamma|c2|uRGB|Camera RGB)/i.test(m.icc.desc || '')) f.push(['palette', 'info', T('fi.icc', { v: m.icc.desc || '?' })]);
    m.findings = f;

    // Opcje czyszczenia (tylko te, które mają zastosowanie)
    if (gps || xmpLoc || iimLoc) opts.removeGps = loc ? loc.lat + ', ' + loc.lon : place || T('oi.location');
    if (hasSerial) opts.removeSerials = [serial, lensSerial, owner, getTag(ex, 'exif', 0x927C) ? 'MakerNote' : '', ids.length ? 'ID' : '', hist.length ? T('oi.history') : ''].filter(Boolean).join(', ');
    if (m.thumbs.length || m.xmps.some(function (x) { return /xmp:Thumbnails/.test(x.xml); })) opts.removeThumbnail = m.thumbs.map(function (t) { return t.src + ' ' + K.fmtBytes(t.data.length); }).join(', ');
    if (hasDates) opts.removeDates = '';
    if (ex) opts.removeExif = K.fmtBytes(ex.size) + (m.orientation > 1 ? ' · ' + T('oi.keep_orientation') : '');
    if (m.xmps.length) opts.removeXmp = K.fmtBytes(m.xmps.reduce(function (s, x) { return s + x.xml.length; }, 0));
    if (m.iim.length || m.irb.length) opts.removeIptc = m.iim.length ? T('oi.count', { n: m.iim.length }) : uniq(m.irb).join(', ');
    if (m.texts.length) opts.removeComments = T('oi.count', { n: m.texts.length });
    if (m.other.length || m.c2pa || m.trailer || m.mpf || m.pngTime || (m.webp && m.webp.chunks.some(function (c) { return c.kind === 'other'; }))) opts.removeOther = uniq(m.other.concat(m.c2pa ? ['C2PA'] : [], m.mpf ? ['MPF'] : [], m.pngTime ? ['tIME'] : [], m.trailer ? [T('oi.trailer', { n: K.fmtBytes(m.trailer) })] : [])).join(', ');
    if (m.icc) opts.removeIcc = m.icc.desc || '';
    m.options = opts;

    m.alerts = [];
    if (m.trailer && m.trailerWhat) m.alerts.push(['warning', T('warn_trailer', { n: K.fmtBytes(m.trailer), v: m.trailerWhat })]);
    if (loc) m.alerts.push(['error', T('warn_gps')]);
    if (m.xmps.some(function (x) { return x.error; })) m.alerts.push(['warning', T('warn_xmp_broken')]);
  }

  /* ====================================================================== */
  /* Zapis                                                                  */
  /* ====================================================================== */

  var SERIAL = { ifd0: [0xC62F], exif: [0xA430, 0xA431, 0xA435, 0xA420, 0x927C] };
  var DATES = { ifd0: [0x0132], exif: [0x9003, 0x9004, 0x9010, 0x9011, 0x9012, 0x9290, 0x9291, 0x9292], gps: [7, 29] };
  var FIELD_TAGS = { artist: [0x013B, 0x9C9D], copyright: [0x8298, 0], description: [0x010E, 0x9C9B] };
  function dropTags(I, map) { Object.keys(map).forEach(function (k) { if (I[k]) I[k] = I[k].filter(function (e) { return map[k].indexOf(e.tag) < 0; }); }); }

  /** Nowy blok EXIF: null = bez zmian, false = usunąć, Uint8Array = nowa struktura TIFF. */
  function exifPlan(m, v, o) {
    var ex = m.ex, cur = curFields(m), le = ex ? ex.le : true;
    var changed = Object.keys(FIELD_TAGS).filter(function (k) { return (v[k] || '') !== (cur[k] || ''); });
    var applyFields = function (I, fresh) {
      Object.keys(FIELD_TAGS).forEach(function (k) {
        if (fresh ? !v[k] : changed.indexOf(k) < 0) return;
        var t = FIELD_TAGS[k];
        setTag(I.ifd0, t[0], v[k] ? asciiEntry(t[0], v[k]) : null);
        if (t[1] && (fresh || I.ifd0.some(function (e) { return e.tag === t[1]; }))) setTag(I.ifd0, t[1], v[k] ? xpEntry(t[1], v[k]) : null);
      });
    };
    var fresh = function (withFields) {
      var I = { ifd0: [] };
      if (m.orientation > 1) I.ifd0.push(shortEntry(0x0112, m.orientation, le));
      if (withFields) applyFields(I, true);
      return I.ifd0.length ? buildTiff(le, I, null) : false;
    };
    if (o.removeExif) return ex || changed.length ? fresh(changed.length > 0) : null;
    if (!ex) return changed.some(function (k) { return v[k]; }) ? fresh(true) : null;
    var touch = changed.length || (o.removeGps && ex.ifds.gps) || (o.removeThumbnail && ex.thumb) || o.removeSerials || o.removeDates;
    if (!touch) return null;
    var I = {};
    Object.keys(ex.ifds).forEach(function (k) { I[k] = ex.ifds[k].slice(); });
    if (o.removeGps) I.gps = null;
    if (o.removeSerials) dropTags(I, SERIAL);
    if (o.removeDates) dropTags(I, DATES);
    applyFields(I, false);
    if (!I.ifd0.length && !(I.exif || []).length && !(I.gps || []).length) return false;
    return buildTiff(le, I, o.removeThumbnail ? null : ex.thumb);
  }
  function xmpPlan(o) {
    var names = [].concat(o.removeGps ? XMP_GPS : [], o.removeSerials ? XMP_IDS : [], o.removeDates ? XMP_DATES : [], o.removeThumbnail ? XMP_THUMB : []);
    return names.length ? function (xml) { return xmpStrip(xml, names); } : null;
  }
  /** Zasoby Photoshopa/IPTC po zmianach: null = bez zmian, false = usunąć, Uint8Array = nowe dane. */
  function irbPlan(irbBytes, o) {
    if (o.removeIptc) return false;
    var res = parseIrb(irbBytes), changed = false, ds = [].concat(o.removeGps ? IPTC_LOC : [], o.removeDates ? IPTC_DATES : []);
    res = res.filter(function (r) {
      if (o.removeThumbnail && (r.id === 0x040C || r.id === 0x0409)) { changed = true; return false; }
      return true;
    });
    if (ds.length) {
      res = res.map(function (r) {
        if (r.id !== 0x0404) return r;
        var recs = parseIim(r.data), keep = recs.filter(function (x) { return !(x.rec === 2 && ds.indexOf(x.ds) >= 0) && !(o.removeDates && x.rec === 1 && (x.ds === 70 || x.ds === 80)); });
        if (keep.length === recs.length) return r;
        changed = true;
        return { id: r.id, head: r.head, data: concat(keep.map(function (x) { return x.raw; })), name: r.name };
      });
      if (changed) res = res.filter(function (r) { return r.id !== 0x0425; });
    }
    if (!changed) return null;
    return res.length ? buildIrb(res) : false;
  }

  function writeJpeg(m, v, o) {
    var b = m.bytes, J = m.jpeg, tiff = exifPlan(m, v, o), xf = xmpPlan(o), parts = [b.subarray(0, 2)], exifDone = tiff === null, mpfAt = -1, outLen = 2;
    var push = function (x) { parts.push(x); outLen += x.length; };
    var exifSeg = tiff ? jpegSeg(0xE1, concat([asc('Exif\0\0'), tiff])) : null;
    var pre = J.segs.filter(function (s) { return s.pre && s.m !== 0xDA; });
    var lead = pre.length && pre[0].kind === 'jfif' ? 1 : 0;
    pre.forEach(function (s, i) {
      if (i === lead && exifSeg && !exifDone && !pre.some(function (x) { return x.kind === 'exif'; })) { push(exifSeg); exifDone = true; }
      var raw = b.subarray(s.start, s.end), k = s.kind;
      if (k === 'exif') { if (tiff === null) push(raw); else if (exifSeg && !exifDone) { push(exifSeg); exifDone = true; } return; }
      if (k === 'xmp') {
        if (o.removeXmp) return;
        if (xf) { var x0 = text(s.data.subarray(NS_XMP.length)), x1 = xf(x0); if (x1 !== x0) { push(jpegSeg(0xE1, concat([asc(NS_XMP), utf8enc.encode(x1)]))); return; } }
        push(raw); return;
      }
      if (k === 'xmpext') { if (!o.removeXmp) push(raw); return; }
      if (k === 'irb') {
        var ir = irbPlan(s.data.subarray(14), o);
        if (ir === null) push(raw); else if (ir) push(jpegSeg(0xED, concat([asc('Photoshop 3.0\0'), ir])));
        return;
      }
      if (k === 'icc') { if (!o.removeIcc) push(raw); return; }
      if (k === 'com') { if (!o.removeComments) push(raw); return; }
      if (k === 'jfxx') { if (!o.removeThumbnail && !o.removeOther) push(raw); return; }
      if (k === 'mpf') { if (!o.removeOther) { mpfAt = outLen; push(raw); } return; }
      if (k === 'fpxr' || k === 'ducky' || k === 'c2pa' || k === 'app') { if (!o.removeOther) push(raw); return; }
      push(raw);
    });
    if (exifSeg && !exifDone) { parts.splice(1, 0, exifSeg); outLen += exifSeg.length; if (mpfAt >= 0) mpfAt += exifSeg.length; }
    push(b.subarray(J.sos, J.end));
    if (!o.removeOther && m.trailer) push(b.subarray(J.end));
    var out = concat(parts);
    // MPF: przesunięcia kolejnych obrazów liczone są od nagłówka MPF – poprawiamy je, jeśli zmieniła się długość pliku głównego
    if (mpfAt >= 0) {
      var delta = (outLen - (m.trailer && !o.removeOther ? m.trailer : 0) - mpfAt) - (J.end - m.mpfSeg.start);
      if (delta) patchMpf(out, mpfAt + 8, delta);
    }
    return out;
  }
  function patchMpf(out, t, delta) {
    var ex = parseTiff(out.subarray(t)), e = ex && getTag(ex, 'ifd0', 0xB002);
    if (!e) return;
    var D = new DataView(out.buffer, out.byteOffset + t), le = ex.le, n = Math.floor(e.raw.length / 16);
    // znajdź położenie danych MPEntry w strukturze (wpis w IFD0)
    var ifd = D.getUint32(4, le), cnt = D.getUint16(ifd, le);
    for (var i = 0; i < cnt; i++) {
      var q = ifd + 2 + i * 12;
      if (D.getUint16(q, le) !== 0xB002) continue;
      var p = D.getUint32(q + 8, le);
      for (var j = 0; j < n; j++) { var off = D.getUint32(p + j * 16 + 8, le); if (off) D.setUint32(p + j * 16 + 8, off + delta, le); }
    }
  }

  function writePng(m, v, o) {
    var b = m.bytes, P = m.png, tiff = exifPlan(m, v, o), xf = xmpPlan(o), parts = [b.subarray(0, 8)], exifDone = tiff === null;
    P.chunks.forEach(function (c) {
      var raw = b.subarray(c.start, c.end), k = c.kind;
      if ((c.type === 'IDAT' || c.type === 'acTL') && !exifDone) { if (tiff) parts.push(pngChunk('eXIf', tiff)); exifDone = true; }
      if (k === 'exif') { if (tiff === null) parts.push(raw); else if (!exifDone) { if (tiff) parts.push(pngChunk('eXIf', tiff)); exifDone = true; } return; }
      if (k === 'rawexif') { if (tiff === null) parts.push(raw); return; }
      if (k === 'xmp') {
        if (o.removeXmp) return;
        if (xf && c.key === 'XML:com.adobe.xmp') {
          var x0 = pngText(c).value, x1 = xf(x0);
          if (x1 !== x0) { parts.push(pngChunk('iTXt', concat([asc('XML:com.adobe.xmp\0\0\0\0\0'), utf8enc.encode(x1)]))); return; }
        }
        parts.push(raw); return;
      }
      if (k === 'rawiptc') { if (!o.removeIptc) parts.push(raw); return; }
      if (k === 'icc' || k === 'rawicc') { if (!o.removeIcc) parts.push(raw); return; }
      if (k === 'text') { if (!o.removeComments && !(o.removeDates && /date|time/i.test(c.key || ''))) parts.push(raw); return; }
      if (k === 'time') { if (!o.removeDates && !o.removeOther) parts.push(raw); return; }
      if (k === 'c2pa' || k === 'other') { if (!o.removeOther) parts.push(raw); return; }
      parts.push(raw);
    });
    if (!o.removeOther && m.trailer) parts.push(b.subarray(P.end));
    return concat(parts);
  }

  function writeWebp(m, v, o) {
    var b = m.bytes, W = m.webp, tiff = exifPlan(m, v, o), xf = xmpPlan(o), body = [], hasIcc = false, hasExif = false, hasXmp = false, vp8x = null;
    W.chunks.forEach(function (c) {
      var raw = b.subarray(c.start, c.end), k = c.kind;
      if (c.type === 'VP8X') { vp8x = new Uint8Array(c.data); body.push(null); return; }
      if (k === 'icc') { if (!o.removeIcc) { body.push(raw); hasIcc = true; } return; }
      if (k === 'exif') { if (tiff === null) { body.push(raw); hasExif = true; } else if (tiff && !hasExif) { body.push(webpChunk('EXIF', tiff)); hasExif = true; } return; }
      if (k === 'xmp') {
        if (o.removeXmp) return;
        hasXmp = true;
        if (xf) { var x0 = text(c.data), x1 = xf(x0); if (x1 !== x0) { body.push(webpChunk('XMP ', utf8enc.encode(x1))); return; } }
        body.push(raw); return;
      }
      if (k === 'other') { if (!o.removeOther) body.push(raw); return; }
      body.push(raw);
    });
    if (tiff && !hasExif) {
      var xi = -1;
      body.forEach(function (x, i) { if (x && starts(x, 0, 'XMP ')) xi = i; });
      var ec = webpChunk('EXIF', tiff);
      if (xi >= 0) body.splice(xi, 0, ec); else body.push(ec);
      hasExif = true;
    }
    var needX = vp8x || hasIcc || hasExif || hasXmp;
    if (needX && !vp8x) {
      vp8x = new Uint8Array(10);
      var w = m.width - 1, h = m.height - 1;
      vp8x[4] = w & 255; vp8x[5] = (w >> 8) & 255; vp8x[6] = (w >> 16) & 255; vp8x[7] = h & 255; vp8x[8] = (h >> 8) & 255; vp8x[9] = (h >> 16) & 255;
      if (m.alpha) vp8x[0] |= 0x10;
      body.unshift(null);
    }
    if (vp8x) {
      vp8x[0] = (vp8x[0] & ~(0x20 | 0x08 | 0x04)) | (hasIcc ? 0x20 : 0) | (hasExif ? 0x08 : 0) | (hasXmp ? 0x04 : 0);
      body = body.map(function (x) { return x || webpChunk('VP8X', vp8x); });
    }
    var data = concat(body), head = new Uint8Array(12);
    head.set(asc('RIFF')); wle32(head, 4, data.length + 4); head.set(asc('WEBP'), 8);
    var parts = [head, data];
    if (!o.removeOther && m.trailer) parts.push(b.subarray(W.end));
    return concat(parts);
  }

  /* ====================================================================== */
  /* Interfejs                                                              */
  /* ====================================================================== */

  var OPTS = ['removeGps', 'removeSerials', 'removeThumbnail', 'removeDates', 'removeExif', 'removeXmp', 'removeIptc', 'removeComments', 'removeOther', 'removeIcc'];
  var FIELDS = ['artist', 'copyright', 'description'];
  var MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  var state = null, urls = [];

  function objUrl(bytes, type) { var u = URL.createObjectURL(new Blob([bytes], { type: type })); urls.push(u); return u; }
  function freeUrls() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = []; }

  function loadFile(file) {
    if (!file) return;
    show($('[data-drop]'), false); show($('[data-result]'), false); show($('[data-loading]'), true);
    file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), f = { name: file.name, size: file.size, lastModified: file.lastModified ? new Date(file.lastModified) : null };
      state = { file: f, model: analyze(bytes, f) };
      render();
    }).catch(function (err) {
      state = null;
      show($('[data-loading]'), false); show($('[data-drop]'), true);
      App.toast(T('read_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
    });
  }

  function kv(rows) {
    return rows.map(function (r) {
      var v = r[2] ? '<a href="' + esc(r[2]) + '" target="_blank" rel="noopener noreferrer">' + esc(r[1]) + App.icon('external-link') + '</a>' : esc(r[1]);
      return '<dt>' + esc(r[0]) + '</dt><dd class="break">' + v + '</dd>';
    }).join('');
  }

  function render() {
    var m = state.model, f = state.file;
    freeUrls();
    show($('[data-loading]'), false); show($('[data-result]'), true);
    $('[data-fname]').textContent = f.name;
    $('[data-fmeta]').textContent = [K.fmtBytes(f.size), m.details[0][1], m.width ? m.width + ' × ' + m.height + ' px' : ''].filter(Boolean).join(' · ');
    $('[data-alerts]').innerHTML = m.alerts.map(function (a) {
      return '<div class="alert alert-' + a[0] + '">' + App.icon(a[0] === 'info' ? 'info-circle' : 'alert-triangle') + '<span>' + esc(a[1]) + '</span></div>';
    }).join('');
    var prev = $('[data-preview]');
    prev.src = objUrl(m.bytes, MIME[m.format]);
    prev.style.transform = '';
    $('[data-thumbs]').innerHTML = m.thumbs.map(function (t, i) {
      return '<figure class="im-thumb"><img data-thumb="' + i + '" alt=""><figcaption>' + esc(T('thumb_cap', { v: t.src, n: K.fmtBytes(t.data.length) })) + '</figcaption></figure>';
    }).join('');
    m.thumbs.forEach(function (t, i) { $('[data-thumb="' + i + '"]').src = objUrl(t.data, 'image/jpeg'); });
    show($('[data-thumbs-note]'), m.thumbs.length > 0);
    $('[data-summary]').innerHTML = m.summary.length ? kv(m.summary) : '<dt>' + esc(T('sum.none')) + '</dt><dd></dd>';
    $('[data-sections]').innerHTML = m.sections.map(function (s) {
      return '<details class="im-sec"' + (s.rows.length <= 40 ? ' open' : '') + '><summary>' + App.icon(s.icon) + '<strong>' + esc(s.title) + '</strong>'
        + (s.src ? ' <code class="muted">' + esc(s.src) + '</code>' : '') + ' <span class="seg-count">' + s.rows.length + '</span></summary><dl class="kv meta-kv">' + kv(s.rows) + '</dl></details>';
    }).join('') || '<p class="muted">' + esc(T('no_meta')) + '</p>';
    var det = [[T('d.file'), f.name], [T('d.size'), K.fmtBytes(f.size) + ' (' + f.size.toLocaleString(LANG) + ' B)']];
    if (f.lastModified) det.push([T('d.file_modified'), K.fmtLocal(f.lastModified)]);
    if (m.width) det.push([T('d.dimensions'), m.width + ' × ' + m.height + ' px']);
    $('[data-details]').innerHTML = kv(det.concat(m.details));
    $('[data-struct]').innerHTML = m.struct.map(function (s) {
      return '<tr' + (s.meta ? ' class="im-meta"' : '') + '><td>' + esc(s.name) + (s.note ? ' <span class="muted small">' + esc(s.note) + '</span>' : '') + '</td><td class="num">' + esc(K.fmtBytes(s.size)) + '</td><td>' + (s.meta ? esc(T('st.meta')) : '') + '</td></tr>';
    }).join('');
    var fl = m.findings;
    $('[data-privacy-count]').textContent = fl.filter(function (x) { return x[1] !== 'info'; }).length || '';
    $('[data-findings]').innerHTML = fl.length ? fl.map(function (x) {
      return '<li class="lvl-' + x[1] + '">' + App.icon(x[0]) + '<span>' + esc(x[2]) + '</span></li>';
    }).join('') : '<li class="lvl-ok">' + App.icon('circle-check') + '<span>' + esc(T('fi.clean')) + '</span></li>';
    fillForm();
    $('[data-save-status]').textContent = '';
  }

  function fillForm() {
    var m = state.model, form = $('[data-form]'), cur = curFields(m);
    FIELDS.forEach(function (k) {
      var el = form.elements[k], box = el.closest('.meta-field');
      el.value = cur[k];
      box.classList.remove('changed');
      box.querySelector('[data-orig]').textContent = cur[k] ? T('orig', { v: cut(cur[k], 120) }) : T('orig_none');
    });
    OPTS.forEach(function (o) {
      var row = $('[data-opt-row="' + o + '"]'), avail = Object.prototype.hasOwnProperty.call(m.options, o);
      show(row, avail);
      row.querySelector('input').checked = false;
      $('[data-opt-info="' + o + '"]').textContent = avail ? m.options[o] : '';
    });
    show($('[data-no-opts]'), !Object.keys(m.options).length);
    form.elements._filename.value = state.file.name;
  }
  function markChanged(k) {
    var el = $('[data-form]').elements[k];
    el.closest('.meta-field').classList.toggle('changed', el.value !== curFields(state.model)[k]);
  }

  function collect() {
    var form = $('[data-form]'), v = {}, o = {};
    FIELDS.forEach(function (k) { v[k] = form.elements[k].value.replace(/\r\n?/g, '\n').trim(); });
    OPTS.forEach(function (k) { var el = form.elements['_' + k]; o[k] = !!(el && el.checked && !el.closest('[data-opt-row]').hidden); });
    return { v: v, o: o, filename: form.elements._filename.value.trim() };
  }

  function save(e) {
    if (e) e.preventDefault();
    if (!state) return;
    var c = collect(), m = state.model, btn = $('[data-form] [type=submit]');
    btn.disabled = true;
    $('[data-save-status]').textContent = T('saving');
    setTimeout(function () {
      var out;
      try { out = (m.format === 'jpeg' ? writeJpeg : m.format === 'png' ? writePng : writeWebp)(m, c.v, c.o); } catch (err) {
        btn.disabled = false;
        $('[data-save-status]').textContent = '';
        App.toast(T('save_error') + ' ' + (err && err.code ? T(err.code) : err && err.message ? err.message : ''), 'error', null, 9000);
        return;
      }
      var name = (c.filename || state.file.name).replace(/[\\/:*?"<>|]+/g, '_');
      if (!/\.[a-z0-9]{3,4}$/i.test(name)) name += { jpeg: '.jpg', png: '.png', webp: '.webp' }[m.format];
      K.download(new Blob([out], { type: MIME[m.format] }), name);
      App.toast(T('saved_toast'), 'success');
      var before = m.bytes.length;
      try {
        var f = { name: name, size: out.length, lastModified: new Date() };
        state = { file: f, model: analyze(out, f) };
        render();
        $('[data-save-status]').textContent = T('saved', { size: K.fmtBytes(out.length), name: name }) + ' ' + (before > out.length ? T('saved_diff', { n: K.fmtBytes(before - out.length) }) + ' ' : '') + T('saved_now_showing');
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
    OPTS.forEach(function (o) { var el = form.elements['_' + o]; if (el && !el.closest('[data-opt-row]').hidden) el.checked = o !== 'removeIcc'; });
    K.switchTab(root, 'edit');
    App.toast(T('stripped_hint'), 'info', null, 7000);
  }

  function exportData() {
    var m = state.model, sec = {};
    m.sections.forEach(function (s) { var o = sec[s.title] = {}; s.rows.forEach(function (r) { o[r[0]] = o[r[0]] != null ? o[r[0]] + '; ' + r[1] : r[1]; }); });
    return {
      file: { name: state.file.name, size: state.file.size, format: m.format, width: m.width || null, height: m.height || null, lastModified: state.file.lastModified ? state.file.lastModified.toISOString() : null },
      summary: m.summary.reduce(function (o, r) { o[r[0]] = r[1]; return o; }, {}),
      location: m.loc || null,
      metadata: sec,
      details: m.details.reduce(function (o, r) { o[r[0]] = r[1]; return o; }, {}),
      structure: m.struct.map(function (s) { return { block: s.name, bytes: s.size, metadata: s.meta }; }),
      privacy: m.findings.map(function (x) { return { level: x[1], text: x[2] }; }),
      generated: new Date().toISOString()
    };
  }
  function exportText() {
    var x = exportData(), L = [T('export_header', { name: x.file.name }), ''];
    L.push('[' + T('summary') + ']');
    Object.keys(x.summary).forEach(function (k) { L.push(k + ': ' + x.summary[k]); });
    Object.keys(x.metadata).forEach(function (s) { L.push('', '[' + s + ']'); Object.keys(x.metadata[s]).forEach(function (k) { L.push(k + ': ' + x.metadata[s][k]); }); });
    L.push('', '[' + T('tab_struct') + ']');
    Object.keys(x.details).forEach(function (k) { L.push(k + ': ' + x.details[k]); });
    x.structure.forEach(function (s) { L.push('- ' + s.block + ': ' + s.bytes + ' B'); });
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
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.getAttribute('data-action');
    if (act === 'another') { input.click(); return; }
    if (!state) return;
    if (act === 'strip' || act === 'strip-go') stripAll();
    else if (act === 'reset') { fillForm(); App.toast(T('reset_done'), 'info'); }
    else if (act === 'json') K.download(new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' }), K.baseName(state.file.name) + '-metadata.json');
    else if (act === 'copy-json') App.copyText(JSON.stringify(exportData(), null, 2)).then(function () { App.toast(App.t('common.copied'), 'success'); });
    else if (act === 'txt') K.download(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }), K.baseName(state.file.name) + '-metadata.txt');
  });
  var form = $('[data-form]');
  form.addEventListener('submit', save);
  form.addEventListener('input', function (e) { if (FIELDS.indexOf(e.target.name) >= 0) markChanged(e.target.name); });
  // Testy jednostkowe w konsoli (bez interfejsu)
  window.ToolsImageMeta = { analyze: analyze, parseTiff: parseTiff, buildTiff: buildTiff };
})();
