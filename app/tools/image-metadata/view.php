<?php
defined('TOOLS_APP') || exit;
// Widok narzędzia „Metadane obrazów” (logika: assets/tools/image-metadata/image-metadata.js).
// Teksty: tool.image-metadata.<klucz>, a gdy go brak – wspólne om.<klucz>.
$k = function (string $s, array $p = []): string {
    $key = 'tool.image-metadata.' . $s;
    $t = __($key, $p);
    return $t === $key ? __('om.' . $s, $p) : $t;
};
$opts = [
    'removeGps' => 'map-pin-off', 'removeSerials' => 'fingerprint', 'removeThumbnail' => 'photo', 'removeDates' => 'calendar',
    'removeExif' => 'camera', 'removeXmp' => 'code', 'removeIptc' => 'id', 'removeComments' => 'notes', 'removeOther' => 'paperclip', 'removeIcc' => 'palette',
];
$fields = ['artist' => 'text', 'copyright' => 'text', 'description' => 'textarea'];
?>
<div class="tool-app im" data-imgmeta>
  <label class="dropzone" data-drop>
    <input type="file" accept=".jpg,.jpeg,.jpe,.jfif,.png,.apng,.webp,image/jpeg,image/png,image/webp" data-file hidden>
    <span class="dz-ic" data-cat="image"><?= icon('photo-scan') ?></span>
    <strong class="dz-title"><?= e($k('drop_title')) ?></strong>
    <span class="muted"><?= e($k('drop_text')) ?></span>
    <span class="btn btn-primary"><?= icon('upload') ?><?= e($k('choose')) ?></span>
    <span class="dz-note"><?= icon('shield-check') ?><?= e($k('privacy_note')) ?></span>
  </label>

  <div class="card tool-loading" data-loading hidden><span class="spinner" aria-hidden="true"></span><span><?= e($k('reading')) ?></span></div>

  <div class="tool-result" data-result hidden>
    <div class="card file-bar">
      <span class="tool-ic" data-cat="image"><?= icon('photo') ?></span>
      <div class="file-bar-info">
        <strong data-fname></strong>
        <span class="muted small" data-fmeta></span>
      </div>
      <div class="row-actions">
        <button type="button" class="btn" data-action="another"><?= icon('upload') ?><span><?= e($k('another')) ?></span></button>
        <div class="dropdown">
          <button type="button" class="btn" data-dropdown><?= icon('download') ?><span><?= e($k('export')) ?></span><?= icon('chevron-down') ?></button>
          <div class="menu menu-right">
            <button type="button" class="menu-item" data-action="json"><?= icon('file-code') ?><?= e($k('export_json')) ?></button>
            <button type="button" class="menu-item" data-action="copy-json"><?= icon('copy') ?><?= e($k('copy_json')) ?></button>
            <button type="button" class="menu-item" data-action="txt"><?= icon('file-text') ?><?= e($k('export_txt')) ?></button>
          </div>
        </div>
      </div>
    </div>

    <div data-alerts></div>

    <div class="seg meta-tabs" role="tablist">
      <button type="button" class="active" role="tab" data-tab="meta"><?= icon('list-details') ?><?= e($k('tab_meta')) ?></button>
      <button type="button" role="tab" data-tab="privacy"><?= icon('eye') ?><?= e($k('tab_privacy')) ?> <span class="seg-count" data-privacy-count></span></button>
      <button type="button" role="tab" data-tab="edit"><?= icon('eraser') ?><?= e($k('tab_edit')) ?></button>
      <button type="button" role="tab" data-tab="struct"><?= icon('layers-subtract') ?><?= e($k('tab_struct')) ?></button>
    </div>

    <section class="card" data-panel="meta">
      <div class="im-top">
        <figure class="im-prev"><img data-preview alt="<?= e($k('preview')) ?>"></figure>
        <div class="im-sum">
          <h3 class="meta-sub"><?= icon('info-circle') ?><?= e($k('summary')) ?></h3>
          <dl class="kv meta-kv" data-summary></dl>
        </div>
      </div>
      <div class="im-thumbs-wrap" data-thumbs-note hidden>
        <p class="muted small"><?= icon('photo') ?> <?= e($k('thumbs_hint')) ?></p>
        <div class="im-thumbs" data-thumbs></div>
      </div>
      <div data-sections></div>
    </section>

    <section class="card" data-panel="privacy" hidden>
      <p class="muted"><?= e($k('privacy_intro')) ?></p>
      <ul class="findings" data-findings></ul>
      <div class="row-actions"><button type="button" class="btn" data-action="strip-go"><?= icon('eraser') ?><?= e($k('strip_all')) ?></button></div>
    </section>

    <section class="card" data-panel="edit" hidden>
      <form class="form meta-form" data-form autocomplete="off">
        <p class="muted small"><?= icon('info-circle') ?> <?= e($k('edit_hint')) ?></p>
        <div class="meta-fields">
          <?php foreach ($fields as $name => $type): ?>
          <div class="field meta-field<?= $type === 'textarea' ? ' wide' : '' ?>" data-field="<?= e($name) ?>">
            <span class="meta-label"><?= e($k('f.' . $name)) ?> <code class="muted"><?= e($k('f.' . $name . '_tag')) ?></code></span>
            <div class="meta-input">
              <?php if ($type === 'textarea'): ?>
                <textarea name="<?= e($name) ?>" rows="2" maxlength="2000"></textarea>
              <?php else: ?>
                <input type="text" name="<?= e($name) ?>" maxlength="500">
              <?php endif; ?>
              <button type="button" class="btn-icon" data-clear="<?= e($name) ?>" title="<?= e($k('clear_field')) ?>"><?= icon('x') ?></button>
            </div>
            <small class="hint" data-orig></small>
          </div>
          <?php endforeach; ?>
        </div>

        <hr class="sep">
        <h3 class="meta-sub"><?= icon('eraser') ?><?= e($k('clean_title')) ?></h3>
        <p class="muted small"><?= e($k('clean_hint')) ?></p>
        <p class="muted small" data-no-opts hidden><?= icon('circle-check') ?> <?= e($k('no_opts')) ?></p>
        <div class="om-opts">
          <?php foreach ($opts as $o => $ic): ?>
          <label class="check om-opt" data-opt-row="<?= e($o) ?>" hidden>
            <input type="checkbox" name="_<?= e($o) ?>" value="1">
            <span><?= icon($ic) ?> <strong><?= e($k('opt.' . $o)) ?></strong> <small class="muted" data-opt-info="<?= e($o) ?>"></small>
              <small class="muted im-opt-hint"><?= e($k('opth.' . $o)) ?></small></span>
          </label>
          <?php endforeach; ?>
        </div>

        <hr class="sep">
        <label class="field"><span><?= e($k('filename')) ?></span><input type="text" name="_filename" maxlength="200"></label>
        <div class="row-actions meta-actions">
          <button type="submit" class="btn btn-primary"><?= icon('download') ?><?= e($k('save')) ?></button>
          <button type="button" class="btn" data-action="strip"><?= icon('eraser') ?><?= e($k('strip_all')) ?></button>
          <button type="button" class="btn btn-ghost" data-action="reset"><?= icon('arrow-back-up') ?><?= e($k('reset')) ?></button>
        </div>
        <p class="muted small" data-save-status></p>
      </form>
    </section>

    <section class="card" data-panel="struct" hidden>
      <dl class="kv meta-kv" data-details></dl>
      <h3 class="meta-sub"><?= icon('layers-subtract') ?><?= e($k('struct_title')) ?></h3>
      <p class="muted small"><?= e($k('struct_hint')) ?></p>
      <div class="table-wrap"><table class="table im-struct"><thead><tr><th><?= e($k('st.block')) ?></th><th class="num"><?= e($k('st.size')) ?></th><th></th></tr></thead><tbody data-struct></tbody></table></div>
    </section>
  </div>
</div>
