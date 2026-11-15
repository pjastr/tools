<?php
defined('TOOLS_APP') || exit;
$k = fn(string $s, array $p = []) => __('tool.pdf-review.' . $s, $p);
?>
<div class="tool-app rev" data-pdfr>
  <label class="dropzone" data-drop>
    <input type="file" accept="application/pdf,.pdf" data-file hidden>
    <span class="dz-ic" data-cat="pdf"><?= icon('history') ?></span>
    <strong class="dz-title"><?= e($k('drop_title')) ?></strong>
    <span class="muted"><?= e($k('drop_text')) ?></span>
    <span class="btn btn-primary"><?= icon('upload') ?><?= e($k('choose')) ?></span>
    <span class="dz-note"><?= icon('shield-check') ?><?= e($k('privacy_note')) ?></span>
  </label>

  <div class="card tool-loading" data-loading hidden><span class="spinner" aria-hidden="true"></span><span data-loading-text><?= e($k('reading')) ?></span></div>

  <div class="tool-result" data-result hidden>
    <div class="card file-bar">
      <span class="tool-ic" data-cat="pdf"><?= icon('file-type-pdf') ?></span>
      <div class="file-bar-info"><strong data-fname></strong><span class="muted small" data-fmeta></span></div>
      <div class="row-actions">
        <button type="button" class="btn" data-action="another"><?= icon('upload') ?><span><?= e($k('another')) ?></span></button>
        <div class="dropdown">
          <button type="button" class="btn" data-dropdown><?= icon('download') ?><span><?= e($k('export')) ?></span><?= icon('chevron-down') ?></button>
          <div class="menu menu-right">
            <button type="button" class="menu-item" data-action="csv"><?= icon('file-text') ?><?= e($k('export_csv')) ?></button>
            <button type="button" class="menu-item" data-action="json"><?= icon('file-code') ?><?= e($k('export_json')) ?></button>
            <button type="button" class="menu-item" data-action="txt"><?= icon('file-text') ?><?= e($k('export_txt')) ?></button>
          </div>
        </div>
      </div>
    </div>

    <div class="rev-stats" data-stats></div>
    <div data-alerts></div>

    <div class="seg meta-tabs" role="tablist">
      <button type="button" class="active" role="tab" data-tab="comments"><?= icon('messages') ?><?= e($k('tab_comments')) ?> <span class="seg-count" data-count-comments></span></button>
      <button type="button" role="tab" data-tab="versions"><?= icon('history') ?><?= e($k('tab_versions')) ?> <span class="seg-count" data-count-versions></span></button>
      <button type="button" role="tab" data-tab="signatures"><?= icon('signature') ?><?= e($k('tab_signatures')) ?> <span class="seg-count" data-count-signatures></span></button>
    </div>

    <section class="card" data-panel="comments">
      <div class="rev-filters">
        <div class="search"><?= icon('search') ?><input type="search" data-q placeholder="<?= e($k('search')) ?>"></div>
        <select data-f-type aria-label="<?= e($k('filter_type')) ?>"></select>
        <select data-f-author aria-label="<?= e($k('filter_author')) ?>"></select>
      </div>
      <div class="rev-list" data-comments></div>
      <p class="muted center" data-no-comments hidden><?= icon('circle-check') ?> <?= e($k('no_comments')) ?></p>
      <p class="muted small" data-other-annots></p>

      <form class="form meta-form rev-clean" data-form>
        <hr class="sep">
        <h3 class="meta-sub"><?= icon('eraser') ?><?= e($k('clean_title')) ?></h3>
        <p class="muted small"><?= e($k('clean_hint')) ?></p>
        <label class="check"><input type="checkbox" name="_remove" value="1"> <?= e($k('opt_remove')) ?></label>
        <label class="check"><input type="checkbox" name="_anon" value="1"> <?= e($k('opt_anon')) ?> <input type="text" name="_anonName" class="rev-anon" maxlength="40" value="<?= e($k('anon_default')) ?>" aria-label="<?= e($k('anon_name')) ?>"></label>
        <div class="grid-2 tight"><label class="field"><span><?= e($k('filename')) ?></span><input type="text" name="_filename" maxlength="200"></label></div>
        <div class="row-actions meta-actions">
          <button type="submit" class="btn btn-primary"><?= icon('download') ?><?= e($k('save')) ?></button>
        </div>
        <p class="muted small" data-save-status></p>
      </form>
    </section>

    <section class="card" data-panel="versions" hidden>
      <p class="muted" data-versions-intro></p>
      <ol class="rev-timeline" data-versions></ol>
      <div data-xmp-wrap hidden>
        <h3 class="meta-sub"><?= icon('code') ?><?= e($k('xmp_history')) ?></h3>
        <p class="muted small"><?= e($k('xmp_history_hint')) ?></p>
        <div class="table-scroll"><table class="table small"><thead><tr><th><?= e($k('xh.when')) ?></th><th><?= e($k('xh.action')) ?></th><th><?= e($k('xh.agent')) ?></th><th><?= e($k('xh.changed')) ?></th></tr></thead><tbody data-xmp-history></tbody></table></div>
      </div>
    </section>

    <section class="card" data-panel="signatures" hidden>
      <div data-signatures></div>
      <p class="muted" data-no-signatures hidden><?= icon('info-circle') ?> <?= e($k('no_signatures')) ?></p>
      <p class="muted small"><?= icon('info-circle') ?> <?= e($k('sig_note')) ?></p>
    </section>
  </div>
</div>
