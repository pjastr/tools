<?php
defined('TOOLS_APP') || exit;

$all = Tools::all();
if (is_post()) {
    $action = post('action');
    if ($action === 'toggle') {
        $slug = post('tool');
        if (isset($all[$slug])) {
            $on = !Tools::isEnabled($slug);
            Tools::setEnabled($slug, $on);
            flash('success', __($on ? 'admin.tools.enabled_msg' : 'admin.tools.disabled_msg', ['name' => Tools::name($slug)]));
        }
    } elseif ($action === 'enable_all') {
        Settings::set('tools_disabled', '[]');
        flash('success', __('admin.tools.all_enabled'));
    }
    redirect(url('admin-tools'));
}

$stats = Tools::usageStats();
$cats = Tools::categories();
$enabledCount = count(Tools::enabled());

ob_start(); ?>
<div class="page-head">
  <div>
    <h1><?= e(__('admin.nav.tools')) ?></h1>
    <p class="muted"><?= e(__('admin.tools.sub', ['on' => $enabledCount, 'all' => count($all)])) ?></p>
  </div>
  <?php if ($enabledCount < count($all)): ?>
  <div class="page-actions">
    <form method="post"><?= csrf_field() ?><input type="hidden" name="action" value="enable_all">
      <button class="btn" type="submit"><?= icon('checks') ?><?= e(__('admin.tools.enable_all')) ?></button></form>
  </div>
  <?php endif; ?>
</div>

<div class="card table-card">
  <table class="table">
    <thead><tr>
      <th><?= e(__('admin.tools.tool')) ?></th>
      <th><?= e(__('admin.tools.category')) ?></th>
      <th><?= e(__('admin.tools.processing')) ?></th>
      <th class="num"><?= e(__('admin.tools.uses')) ?></th>
      <th class="num"><?= e(__('admin.tools.users')) ?></th>
      <th class="num"><?= e(__('admin.tools.favs')) ?></th>
      <th><?= e(__('admin.tools.last')) ?></th>
      <th><?= e(__('admin.users.status')) ?></th>
    </tr></thead>
    <tbody>
    <?php foreach ($all as $slug => $t): $on = Tools::isEnabled($slug); $st = $stats[$slug] ?? null; ?>
      <tr class="<?= $on ? '' : 'row-off' ?>">
        <td class="tool-cell">
          <div class="user-cell">
            <span class="tool-ic tool-ic-sm" data-cat="<?= e($t['category']) ?>"><?= icon($t['icon']) ?></span>
            <div><strong><?= e(Tools::name($slug)) ?></strong><div class="muted small"><code><?= e($slug) ?></code> · v<?= e($t['version']) ?></div></div>
          </div>
        </td>
        <td class="nowrap"><?= icon($cats[$t['category']]) ?> <?= e(__('cat.' . $t['category'])) ?></td>
        <td><?php if ($t['local']): ?><span class="badge badge-success"><?= icon('shield-check') ?><?= e(__('tools.local')) ?></span><?php else: ?><span class="badge"><?= icon('server') ?><?= e(__('tools.server')) ?></span><?php endif; ?></td>
        <td class="num"><?= (int)($st['uses'] ?? 0) ?></td>
        <td class="num"><?= (int)($st['users'] ?? 0) ?></td>
        <td class="num"><?= (int)($st['favs'] ?? 0) ?></td>
        <td class="nowrap small"><?= e(format_date($st['last'] ?? null)) ?></td>
        <td>
          <form method="post" class="inline-form">
            <?= csrf_field() ?><input type="hidden" name="action" value="toggle"><input type="hidden" name="tool" value="<?= e($slug) ?>">
            <label class="switch-field compact" title="<?= e($on ? __('admin.tools.on') : __('admin.tools.off')) ?>">
              <input type="checkbox" <?= $on ? 'checked' : '' ?> data-autosubmit aria-label="<?= e(Tools::name($slug)) ?>">
              <span class="switch" aria-hidden="true"></span>
              <span class="small"><?= e($on ? __('admin.tools.on') : __('admin.tools.off')) ?></span>
            </label>
          </form>
        </td>
      </tr>
    <?php endforeach; ?>
    <?php if (!$all): ?><tr><td colspan="8" class="muted center"><?= e(__('tools.none_title')) ?></td></tr><?php endif; ?>
    </tbody>
  </table>
</div>
<p class="muted small"><?= icon('info-circle') ?> <?= e(__('admin.tools.howto')) ?></p>
<?php
echo view('layout_app', ['title' => __('admin.nav.tools'), 'content' => ob_get_clean(), 'active' => 'admin-tools', 'admin' => true]);
