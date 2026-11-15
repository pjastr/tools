<?php
defined('TOOLS_APP') || exit;
$k = fn(string $s, array $p = []) => __('tool.pdf-metadata.' . $s, $p);
$fields = [
    'Title' => 'text', 'Author' => 'text', 'Subject' => 'textarea', 'Keywords' => 'text',
    'Creator' => 'text', 'Producer' => 'text', 'CreationDate' => 'date', 'ModDate' => 'date', 'Trapped' => 'trapped',
];
?>
<div class="tool-app pdfm" data-pdfm>
  <label class="dropzone" data-drop>
    <input type="file" accept="application/pdf,.pdf" data-file hidden>
    <span class="dz-ic" data-cat="pdf"><?= icon('file-type-pdf') ?></span>
    <strong class="dz-title"><?= e($k('drop_title')) ?></strong>
    <span class="muted"><?= e($k('drop_text')) ?></span>
    <span class="btn btn-primary"><?= icon('upload') ?><?= e($k('choose')) ?></span>
    <span class="dz-note"><?= icon('shield-check') ?><?= e($k('privacy_note')) ?></span>
  </label>

  <div class="card tool-loading" data-loading hidden><span class="spinner" aria-hidden="true"></span><span><?= e($k('reading')) ?></span></div>

  <div class="tool-result" data-result hidden>
    <div class="card file-bar">
      <span class="tool-ic" data-cat="pdf"><?= icon('file-type-pdf') ?></span>
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
      <button type="button" class="active" role="tab" data-tab="edit"><?= icon('edit') ?><?= e($k('tab_info')) ?></button>
      <button type="button" role="tab" data-tab="xmp"><?= icon('code') ?>XMP <span class="seg-count" data-xmp-count></span></button>
      <button type="button" role="tab" data-tab="details"><?= icon('list-details') ?><?= e($k('tab_details')) ?></button>
      <button type="button" role="tab" data-tab="privacy"><?= icon('eye') ?><?= e($k('tab_privacy')) ?> <span class="seg-count" data-privacy-count></span></button>
    </div>

    <!-- Metadane dokumentu (słownik Info) – edycja -->
    <section class="card" data-panel="edit">
      <form class="form meta-form" data-form autocomplete="off">
        <p class="muted small"><?= icon('info-circle') ?> <?= e($k('info_hint')) ?></p>
        <div class="meta-fields">
          <?php foreach ($fields as $name => $type): ?>
          <div class="field meta-field<?= $type === 'textarea' ? ' wide' : '' ?>" data-field="<?= e($name) ?>">
            <span class="meta-label"><?= e($k('f.' . $name)) ?> <code class="muted">/<?= e($name) ?></code></span>
            <div class="meta-input">
              <?php if ($type === 'textarea'): ?>
                <textarea name="<?= e($name) ?>" rows="2"></textarea>
              <?php elseif ($type === 'date'): ?>
                <input type="datetime-local" name="<?= e($name) ?>" step="1">
              <?php elseif ($type === 'trapped'): ?>
                <select name="<?= e($name) ?>">
                  <option value=""><?= e($k('none')) ?></option>
                  <option value="True">True</option><option value="False">False</option><option value="Unknown">Unknown</option>
                </select>
              <?php else: ?>
                <input type="text" name="<?= e($name) ?>">
              <?php endif; ?>
              <button type="button" class="btn-icon" data-clear="<?= e($name) ?>" title="<?= e($k('clear_field')) ?>"><?= icon('x') ?></button>
            </div>
            <small class="hint" data-orig></small>
          </div>
          <?php endforeach; ?>
        </div>

        <h3 class="meta-sub"><?= icon('list') ?><?= e($k('custom')) ?></h3>
        <p class="muted small"><?= e($k('custom_hint')) ?></p>
        <div class="meta-custom" data-custom></div>
        <div><button type="button" class="btn btn-sm" data-action="add-custom"><?= icon('plus') ?><?= e($k('add_custom')) ?></button></div>

        <hr class="sep">
        <h3 class="meta-sub"><?= icon('device-floppy') ?><?= e($k('save_title')) ?></h3>
        <div class="grid-2 tight">
          <label class="field"><span><?= e($k('xmp_mode')) ?></span>
            <select name="_xmp" data-xmp-mode>
              <option value="update"><?= e($k('xmp_update')) ?></option>
              <option value="remove"><?= e($k('xmp_remove')) ?></option>
              <option value="keep"><?= e($k('xmp_keep')) ?></option>
            </select>
            <small class="hint" data-xmp-mode-hint></small>
          </label>
          <label class="field"><span><?= e($k('filename')) ?></span><input type="text" name="_filename" data-filename maxlength="200"></label>
        </div>
        <label class="check"><input type="checkbox" name="_moddate_now" value="1"> <?= e($k('moddate_now')) ?></label>
        <label class="check" data-id-row hidden><input type="checkbox" name="_strip_id" value="1"> <?= e($k('strip_id')) ?></label>
        <label class="check" data-embedded-row hidden><input type="checkbox" name="_strip_embedded" value="1"> <span data-embedded-label></span></label>
        <div class="row-actions meta-actions">
          <button type="submit" class="btn btn-primary"><?= icon('download') ?><?= e($k('save')) ?></button>
          <button type="button" class="btn" data-action="strip"><?= icon('eraser') ?><?= e($k('strip_all')) ?></button>
          <button type="button" class="btn btn-ghost" data-action="reset"><?= icon('arrow-back-up') ?><?= e($k('reset')) ?></button>
        </div>
        <p class="muted small" data-save-status></p>
      </form>
    </section>

    <!-- XMP -->
    <section class="card" data-panel="xmp" hidden>
      <div data-xmp-empty class="muted"><?= icon('info-circle') ?> <?= e($k('xmp_none')) ?></div>
      <div data-xmp-content hidden>
        <div class="table-scroll"><table class="table small"><thead><tr><th><?= e($k('property')) ?></th><th><?= e($k('value')) ?></th></tr></thead><tbody data-xmp-props></tbody></table></div>
        <details class="notes">
          <summary><?= e($k('xmp_raw')) ?></summary>
          <textarea class="code-area" readonly rows="14" data-xmp-raw id="pdfm-xmp-raw"></textarea>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" data-copy="#pdfm-xmp-raw"><?= icon('copy') ?><?= e(__('common.copy')) ?></button>
            <button type="button" class="btn btn-sm" data-action="xmp-download"><?= icon('download') ?><?= e($k('download_xml')) ?></button>
          </div>
        </details>
      </div>
    </section>

    <!-- Szczegóły techniczne -->
    <section class="card" data-panel="details" hidden>
      <dl class="kv meta-kv" data-details></dl>
      <div data-fonts-wrap hidden>
        <h3 class="meta-sub"><?= icon('typography') ?><?= e($k('fonts')) ?> <span class="seg-count" data-fonts-count></span></h3>
        <div class="table-scroll"><table class="table small"><thead><tr><th><?= e($k('font_name')) ?></th><th><?= e($k('font_type')) ?></th><th><?= e($k('font_embedded')) ?></th></tr></thead><tbody data-fonts></tbody></table></div>
      </div>
      <div data-attach-wrap hidden>
        <h3 class="meta-sub"><?= icon('paperclip') ?><?= e($k('attachments')) ?></h3>
        <ul class="list-plain" data-attachments></ul>
      </div>
    </section>

    <!-- Prywatność -->
    <section class="card" data-panel="privacy" hidden>
      <p class="muted"><?= e($k('privacy_intro')) ?></p>
      <ul class="findings" data-findings></ul>
      <div class="row-actions"><button type="button" class="btn" data-action="strip-go"><?= icon('eraser') ?><?= e($k('strip_all')) ?></button></div>
    </section>
  </div>
</div>
