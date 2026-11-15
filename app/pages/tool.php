<?php
defined('TOOLS_APP') || exit;

$slug = isset($_GET['t']) && is_string($_GET['t']) ? $_GET['t'] : '';
$tool = Tools::validSlug($slug) && Tools::isEnabled($slug) ? Tools::get($slug) : null;
if (!$tool || !is_file(Tools::dir() . '/' . $slug . '/view.php')) {
    http_response_code(404);
    flash('error', __('tools.not_found'));
    redirect(url('tools'));
}

$uid = Auth::id();
Tools::recordUse($uid, $slug);
$prefs = Tools::prefs($uid);
$fav = !empty($prefs[$slug]['favorite']);
$name = Tools::name($slug);

/** Widok narzędzia – dostęp do $tool, helperów i tłumaczeń. */
$renderTool = function (array $tool): string {
    ob_start();
    require Tools::dir() . '/' . $tool['slug'] . '/view.php';
    return (string)ob_get_clean();
};

ob_start(); ?>
<a class="back-link" href="<?= e(url('tools')) ?>"><?= icon('chevron-left') ?><?= e(__('tools.back')) ?></a>
<div class="page-head tool-head">
  <div class="tool-head-main">
    <span class="tool-ic tool-ic-lg" data-cat="<?= e($tool['category']) ?>"><?= icon($tool['icon']) ?></span>
    <div>
      <h1><?= e($name) ?></h1>
      <p class="muted"><?= e(__('tool.' . $slug . '.desc')) ?></p>
    </div>
  </div>
  <div class="page-actions">
    <?php if ($tool['local']): ?><span class="badge badge-success" title="<?= e(__('tools.local_hint')) ?>"><?= icon('shield-check') ?><?= e(__('tools.local')) ?></span><?php endif; ?>
    <button type="button" class="btn fav-btn <?= $fav ? 'on' : '' ?>" data-fav-tool="<?= e($slug) ?>" aria-pressed="<?= $fav ? 'true' : 'false' ?>"><?= icon('star', 'ic-off') ?><?= icon('star-filled', 'ic-on') ?><span><?= e(__('tools.favorite')) ?></span></button>
  </div>
</div>
<div class="tool-body" id="tool-<?= e($slug) ?>" data-tool="<?= e($slug) ?>">
  <?= $renderTool($tool) ?>
</div>
<noscript><div class="alert alert-warning"><?= icon('alert-triangle') ?><span><?= e(__('tools.need_js')) ?></span></div></noscript>
<?php
echo view('layout_app', [
    'title' => $name,
    'content' => ob_get_clean(),
    'active' => 'tools',
    'extraCss' => $tool['css'],
    'extraJs' => array_merge(['js/tools.js'], $tool['js']),
]);
