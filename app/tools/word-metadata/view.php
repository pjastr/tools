<?php
defined('TOOLS_APP') || exit;
$k = fn(string $s, array $p = []) => __('tool.word-metadata.' . $s, $p);
// pole => [typ, formaty]
$fields = [
    'title' => ['text', 'docx doc'], 'subject' => ['text', 'docx doc'], 'creator' => ['text', 'docx doc'],
    'keywords' => ['text', 'docx doc'], 'description' => ['textarea', 'docx doc'],
    'lastModifiedBy' => ['text', 'docx doc'], 'category' => ['text', 'docx doc'], 'contentStatus' => ['text', 'docx doc'],
    'company' => ['text', 'docx doc'], 'manager' => ['text', 'docx doc'], 'template' => ['text', 'docx doc'],
    'revision' => ['text', 'docx doc'], 'totalTime' => ['number', 'docx doc'], 'language' => ['text', 'docx doc'],
    'created' => ['date', 'docx doc'], 'modified' => ['date', 'docx doc'], 'lastPrinted' => ['date', 'docx doc'],
];
$opts = [
    'anonymize' => 'user-off', 'removeComments' => 'messages', 'removeRsid' => 'fingerprint', 'removeTemplate' => 'template',
    'removeDocVars' => 'variable', 'removeThumbnail' => 'photo', 'removeCustomXml' => 'database', 'removeSavedBy' => 'history',
    'removePersonalInfo' => 'eraser',
];
?>
<div class="tool-app wordm" data-wordm>
  <label class="dropzone" data-drop>
    <input type="file" accept=".docx,.docm,.dotx,.dotm,.doc,.dot,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-file hidden>
    <span class="dz-ic" data-cat="office"><?= icon('file-word') ?></span>
    <strong class="dz-title"><?= e($k('drop_title')) ?></strong>
    <span class="muted"><?= e($k('drop_text')) ?></span>
    <span class="btn btn-primary"><?= icon('upload') ?><?= e($k('choose')) ?></span>
    <span class="dz-note"><?= icon('shield-check') ?><?= e($k('privacy_note')) ?></span>
  </label>

  <div class="card tool-loading" data-loading hidden><span class="spinner" aria-hidden="true"></span><span><?= e($k('reading')) ?></span></div>

  <div class="tool-result" data-result hidden>
    <div class="card file-bar">
      <span class="tool-ic" data-cat="office" data-ficon><?= icon('file-type-docx') ?></span>
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
      <button type="button" class="active" role="tab" data-tab="edit"><?= icon('edit') ?><?= e($k('tab_meta')) ?></button>
      <button type="button" role="tab" data-tab="details"><?= icon('list-details') ?><?= e($k('tab_details')) ?></button>
      <button type="button" role="tab" data-tab="privacy"><?= icon('eye') ?><?= e($k('tab_privacy')) ?> <span class="seg-count" data-privacy-count></span></button>
    </div>

    <section class="card" data-panel="edit">
      <form class="form meta-form" data-form autocomplete="off">
        <p class="muted small"><?= icon('info-circle') ?> <?= e($k('info_hint')) ?></p>
        <div class="meta-fields">
          <?php foreach ($fields as $name => [$type, $fmt]): ?>
          <div class="field meta-field<?= $type === 'textarea' ? ' wide' : '' ?>" data-field="<?= e($name) ?>">
            <span class="meta-label"><?= e($k('f.' . $name)) ?> <code class="muted" data-src></code></span>
            <div class="meta-input">
              <?php if ($type === 'textarea'): ?>
                <textarea name="<?= e($name) ?>" rows="2"></textarea>
              <?php elseif ($type === 'date'): ?>
                <input type="datetime-local" name="<?= e($name) ?>" step="1">
              <?php elseif ($type === 'number'): ?>
                <input type="number" name="<?= e($name) ?>" min="0" step="1">
              <?php else: ?>
                <input type="text" name="<?= e($name) ?>">
              <?php endif; ?>
              <button type="button" class="btn-icon" data-clear="<?= e($name) ?>" title="<?= e($k('clear_field')) ?>"><?= icon('x') ?></button>
            </div>
            <small class="hint" data-orig></small>
          </div>
          <?php endforeach; ?>
        </div>

        <div data-stats-wrap hidden>
          <h3 class="meta-sub"><?= icon('chart-bar') ?><?= e($k('stats')) ?></h3>
          <p class="muted small"><?= e($k('stats_hint')) ?></p>
          <dl class="kv meta-kv" data-stats></dl>
        </div>

        <h3 class="meta-sub"><?= icon('list') ?><?= e($k('custom')) ?></h3>
        <p class="muted small"><?= e($k('custom_hint')) ?></p>
        <div class="meta-custom" data-custom></div>
        <div><button type="button" class="btn btn-sm" data-action="add-custom"><?= icon('plus') ?><?= e($k('add_custom')) ?></button></div>

        <hr class="sep">
        <h3 class="meta-sub"><?= icon('eraser') ?><?= e($k('clean_title')) ?></h3>
        <p class="muted small"><?= e($k('clean_hint')) ?></p>
        <div class="wordm-opts">
          <?php foreach ($opts as $o => $ic): ?>
          <label class="check wordm-opt" data-opt-row="<?= e($o) ?>" hidden>
            <input type="checkbox" name="_<?= e($o) ?>" value="1">
            <span><?= icon($ic) ?> <strong><?= e($k('opt.' . $o)) ?></strong> <small class="muted" data-opt-info="<?= e($o) ?>"></small>
              <?php if ($o === 'anonymize'): ?><input type="text" name="_anonName" class="wordm-anon" maxlength="40" value="<?= e($k('anon_default')) ?>" aria-label="<?= e($k('anon_name')) ?>"><?php endif; ?>
            </span>
          </label>
          <?php endforeach; ?>
        </div>

        <hr class="sep">
        <div class="grid-2 tight">
          <label class="field"><span><?= e($k('filename')) ?></span><input type="text" name="_filename" maxlength="200"></label>
          <div class="field"><span>&nbsp;</span><label class="check"><input type="checkbox" name="_modifiedNow" value="1"> <?= e($k('modified_now')) ?></label></div>
        </div>
        <div class="row-actions meta-actions">
          <button type="submit" class="btn btn-primary"><?= icon('download') ?><?= e($k('save')) ?></button>
          <button type="button" class="btn" data-action="strip"><?= icon('eraser') ?><?= e($k('strip_all')) ?></button>
          <button type="button" class="btn btn-ghost" data-action="reset"><?= icon('arrow-back-up') ?><?= e($k('reset')) ?></button>
        </div>
        <p class="muted small" data-save-status></p>
      </form>
    </section>

    <section class="card" data-panel="details" hidden>
      <dl class="kv meta-kv" data-details></dl>
      <div data-lists></div>
    </section>

    <section class="card" data-panel="privacy" hidden>
      <p class="muted"><?= e($k('privacy_intro')) ?></p>
      <ul class="findings" data-findings></ul>
      <div class="row-actions"><button type="button" class="btn" data-action="strip-go"><?= icon('eraser') ?><?= e($k('strip_all')) ?></button></div>
    </section>
  </div>
</div>
