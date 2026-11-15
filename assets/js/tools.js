/* tools-php – katalog narzędzi: wyszukiwanie, filtry, ulubione (MIT) */
(function () {
  'use strict';
  var t = App.t;
  var grid = document.getElementById('tool-grid');
  var search = document.getElementById('tool-search');
  var filter = 'all';

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  }

  function apply() {
    if (!grid) return;
    var q = norm(search && search.value).trim();
    var words = q ? q.split(/\s+/) : [];
    var shown = 0;
    grid.querySelectorAll('.tool-card').forEach(function (c) {
      var hay = norm(c.getAttribute('data-search'));
      var ok = words.every(function (w) { return hay.indexOf(w) !== -1; });
      if (ok && filter === 'fav') ok = c.getAttribute('data-fav') === '1';
      if (ok && filter.indexOf('cat:') === 0) ok = c.getAttribute('data-cat') === filter.slice(4);
      c.hidden = !ok;
      if (ok) shown++;
    });
    var recent = document.getElementById('recent-section');
    var allTitle = document.getElementById('all-title');
    var plain = !q && filter === 'all';
    if (recent) recent.hidden = !plain;
    if (allTitle) allTitle.hidden = !plain;
    document.getElementById('no-results').hidden = shown > 0 || filter === 'fav' && !q;
    document.getElementById('no-favs').hidden = !(shown === 0 && filter === 'fav' && !q);
  }

  if (search) {
    search.addEventListener('input', apply);
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = grid && grid.querySelector('.tool-card:not([hidden]) .tool-link');
        if (first) location.href = first.href;
      }
      if (e.key === 'Escape') { search.value = ''; apply(); }
    });
  }
  document.querySelectorAll('#tool-filters [data-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#tool-filters [data-filter]').forEach(function (x) { x.classList.toggle('active', x === b); });
      filter = b.getAttribute('data-filter');
      apply();
    });
  });

  // Ulubione (lista i strona narzędzia)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-fav-tool]');
    if (!btn) return;
    e.preventDefault();
    var slug = btn.getAttribute('data-fav-tool');
    var on = !btn.classList.contains('on');
    btn.disabled = true;
    App.api('tool.fav', { tool: slug, favorite: on }).then(function () {
      document.querySelectorAll('[data-fav-tool="' + slug + '"]').forEach(function (b) {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      document.querySelectorAll('.tool-card[data-slug="' + slug + '"]').forEach(function (c) { c.setAttribute('data-fav', on ? '1' : '0'); });
      var fc = document.getElementById('fav-count');
      if (fc && grid) fc.textContent = grid.querySelectorAll('.tool-card[data-fav="1"]').length;
      App.toast(on ? t('tools.fav_added') : t('tools.fav_removed'), 'success');
      apply();
    }).catch(function (err) { App.toast(err.message, 'error'); })
      .then(function () { btn.disabled = false; });
  });

  apply();
})();
