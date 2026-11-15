<?php
defined('TOOLS_APP') || exit;

$uid = Auth::id();
$tools = Tools::enabled();
$prefs = Tools::prefs($uid);
$cats = Tools::categories();
$usedCats = array_values(array_unique(array_column($tools, 'category')));
$favCount = count(array_filter($tools, fn($t) => !empty($prefs[$t['slug']]['favorite'])));

// Ostatnio używane (maks. 4)
$recent = array_filter($tools, fn($t) => !empty($prefs[$t['slug']]['last_used_at']));
uasort($recent, fn($a, $b) => strcmp((string)$prefs[$b['slug']]['last_used_at'], (string)$prefs[$a['slug']]['last_used_at']));
$recent = array_slice($recent, 0, 4, true);

$card = function (array $t, bool $compact = false) use ($prefs): string {
    $fav = !empty($prefs[$t['slug']]['favorite']);
    $name = Tools::name($t['slug']);
    $desc = __('tool.' . $t['slug'] . '.desc');
    $tags = __('tool.' . $t['slug'] . '.tags');
    $hay = mb_strtolower($name . ' ' . $desc . ' ' . ($tags !== 'tool.' . $t['slug'] . '.tags' ? $tags : '') . ' ' . $t['slug']);
    ob_start(); ?>
    <article class="tool-card<?= $compact ? ' compact' : '' ?>" data-slug="<?= e($t['slug']) ?>" data-cat="<?= e($t['category']) ?>" data-fav="<?= $fav ? 1 : 0 ?>" data-search="<?= e($hay) ?>">
      <a class="tool-link" href="<?= e(url('tool', ['t' => $t['slug']])) ?>">
        <span class="tool-ic" data-cat="<?= e($t['category']) ?>"><?= icon($t['icon']) ?></span>
        <span class="tool-text">
          <strong class="tool-name"><?= e($name) ?></strong>
          <?php if (!$compact): ?><span class="tool-desc muted"><?= e($desc) ?></span><?php endif; ?>
        </span>
      </a>
      <div class="tool-foot">
        <span class="badge"><?= icon(Tools::categories()[$t['category']]) ?><?= e(__('cat.' . $t['category'])) ?></span>
        <?php if ($t['local']): ?><span class="badge badge-success" title="<?= e(__('tools.local_hint')) ?>"><?= icon('shield-check') ?><?= e(__('tools.local')) ?></span><?php endif; ?>
        <button type="button" class="btn-icon fav-btn <?= $fav ? 'on' : '' ?>" data-fav-tool="<?= e($t['slug']) ?>" title="<?= e(__('tools.favorite')) ?>" aria-pressed="<?= $fav ? 'true' : 'false' ?>"><?= icon('star', 'ic-off') ?><?= icon('star-filled', 'ic-on') ?></button>
      </div>
    </article>
    <?php return (string)ob_get_clean();
};

ob_start(); ?>
<div class="page-head">
  <div>
    <h1><?= e(__('tools.title')) ?></h1>
    <p class="muted"><?= e(__('tools.count', ['n' => count($tools)])) ?></p>
  </div>
  <div class="page-actions">
    <div class="search">
      <?= icon('search') ?>
      <input type="search" id="tool-search" placeholder="<?= e(__('tools.search')) ?>" autocomplete="off" autofocus>
    </div>
  </div>
</div>

<?php if (!$tools): ?>
<div class="empty">
  <div class="auth-icon"><?= icon('tool') ?></div>
  <h2><?= e(__('tools.none_title')) ?></h2>
  <p class="muted"><?= e(__('tools.none_text')) ?></p>
</div>
<?php else: ?>
<div class="chips" role="tablist" id="tool-filters">
  <button type="button" class="chip active" data-filter="all"><?= icon('layout-grid') ?><?= e(__('tools.all')) ?> <span class="seg-count"><?= count($tools) ?></span></button>
  <button type="button" class="chip" data-filter="fav"><?= icon('star') ?><?= e(__('tools.favorites')) ?> <span class="seg-count" id="fav-count"><?= $favCount ?></span></button>
  <?php foreach ($cats as $c => $ic): if (!in_array($c, $usedCats, true)) continue; ?>
  <button type="button" class="chip" data-filter="cat:<?= e($c) ?>"><?= icon($ic) ?><?= e(__('cat.' . $c)) ?></button>
  <?php endforeach; ?>
</div>

<?php if ($recent): ?>
<section class="tool-section" id="recent-section">
  <h2 class="section-title"><?= icon('clock') ?><?= e(__('tools.recent')) ?></h2>
  <div class="tool-grid tool-grid-compact">
    <?php foreach ($recent as $t) echo $card($t, true); ?>
  </div>
</section>
<?php endif; ?>

<section class="tool-section">
  <?php if ($recent): ?><h2 class="section-title" id="all-title"><?= icon('layout-grid') ?><?= e(__('tools.all_tools')) ?></h2><?php endif; ?>
  <div class="tool-grid" id="tool-grid">
    <?php foreach ($tools as $t) echo $card($t); ?>
  </div>
  <p class="empty-search muted" id="no-results" hidden><?= e(__('tools.no_results')) ?></p>
  <p class="empty-search muted" id="no-favs" hidden><?= e(__('tools.no_favorites')) ?></p>
</section>
<?php endif; ?>
<?php
echo view('layout_app', ['title' => __('tools.title'), 'content' => ob_get_clean(), 'active' => 'tools', 'extraJs' => ['js/tools.js']]);
