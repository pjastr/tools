<?php
defined('TOOLS_APP') || exit;
$k = fn(string $s, array $p = []) => __('tool.word-review.' . $s, $p);
?>
<div class="tool-app rev" data-wordr>
  <label class="dropzone" data-drop>
    <input type="file" accept=".docx,.docm,.dotx,.dotm,.doc,.dot,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-file hidden>
    <span class="dz-ic" data-cat="office"><?= icon('git-compare') ?></span>
    <strong class="dz-title"><?= e($k('drop_title')) ?></strong>
    <span class="muted"><?= e($k('drop_text')) ?></span>
    <span class="btn btn-primary"><?= icon('upload') ?><?= e($k('choose')) ?></span>
    <span class="dz-note"><?= icon('shield-check') ?><?= e($k('privacy_note')) ?></span>
  </label>

  <div class="card tool-loading" data-loading hidden><span class="spinner" aria-hidden="true"></span><span><?= e($k('reading')) ?></span></div>

  <div class="tool-result" data-result hidden>
    <div class="card file-bar">
      <span class="tool-ic" data-cat="office" data-ficon><?= icon('file-type-docx') ?></span>
      <div class="file-bar-info"><strong data-fname></strong><span class="muted small" data-fmeta></span></div>
      <div class="row-actions">
        <button type="button" class="btn" data-action="another"><?= icon('upload') ?><span><?= e($k('another')) ?></span></button>
        <div class="dropdown">
          <button type="button" class="btn" data-dropdown><?= icon('download') ?><span><?= e($k('export')) ?></span><?= icon('chevron-down') ?></button>
          <div class="menu menu-right">
            <button type="button" class="menu-item" data-action="csv-changes"><?= icon('file-text') ?><?= e($k('export_csv_changes')) ?></button>
            <button type="button" class="menu-item" data-action="csv-comments"><?= icon('file-text') ?><?= e($k('export_csv_comments')) ?></button>
            <button type="button" class="menu-item" data-action="json"><?= icon('file-code') ?><?= e($k('export_json')) ?></button>
            <button type="button" class="menu-item" data-action="txt"><?= icon('file-text') ?><?= e($k('export_txt')) ?></button>
          </div>
        </div>
      </div>
    </div>

    <div class="rev-stats" data-stats></div>
    <div data-alerts></div>

    <div class="seg meta-tabs" role="tablist">
      <button type="button" class="active" role="tab" data-tab="changes"><?= icon('git-compare') ?><?= e($k('tab_changes')) ?> <span class="seg-count" data-count-changes></span></button>
      <button type="button" role="tab" data-tab="comments"><?= icon('messages') ?><?= e($k('tab_comments')) ?> <span class="seg-count" data-count-comments></span></button>
      <button type="button" role="tab" data-tab="history"><?= icon('history') ?><?= e($k('tab_history')) ?></button>
    </div>

    <section class="card" data-panel="changes">
      <div class="rev-filters">
        <div class="search"><?= icon('search') ?><input type="search" data-q="changes" placeholder="<?= e($k('search')) ?>"></div>
        <select data-f="ctype" aria-label="<?= e($k('filter_type')) ?>"></select>
        <select data-f="cauthor" aria-label="<?= e($k('filter_author')) ?>"></select>
      </div>
      <div class="rev-list" data-changes></div>
      <p class="muted center" data-none="changes" hidden></p>
    </section>

    <section class="card" data-panel="comments" hidden>
      <div class="rev-filters">
        <div class="search"><?= icon('search') ?><input type="search" data-q="comments" placeholder="<?= e($k('search')) ?>"></div>
        <select data-f="mauthor" aria-label="<?= e($k('filter_author')) ?>"></select>
        <select data-f="mstatus" aria-label="<?= e($k('filter_status')) ?>">
          <option value=""><?= e($k('status_all')) ?></option>
          <option value="open"><?= e($k('status_open')) ?></option>
          <option value="done"><?= e($k('status_done')) ?></option>
        </select>
      </div>
      <div class="rev-list" data-comments></div>
      <p class="muted center" data-none="comments" hidden></p>
    </section>

    <section class="card" data-panel="history" hidden>
      <p class="muted"><?= e($k('history_intro')) ?></p>
      <dl class="kv meta-kv" data-history></dl>
      <div data-history-lists></div>
    </section>

    <section class="card" data-actions-card>
      <form class="form meta-form rev-clean" data-form>
        <h3 class="meta-sub"><?= icon('checks') ?><?= e($k('actions_title')) ?></h3>
        <div data-docx-only>
          <p class="muted small"><?= e($k('actions_hint')) ?></p>
          <div class="field"><span><?= e($k('rev_mode')) ?></span>
            <div class="radio-list">
              <label><input type="radio" name="_mode" value="keep" checked> <?= e($k('mode_keep')) ?></label>
              <label><input type="radio" name="_mode" value="accept"> <?= e($k('mode_accept')) ?></label>
              <label><input type="radio" name="_mode" value="reject"> <?= e($k('mode_reject')) ?></label>
            </div>
          </div>
          <label class="check"><input type="checkbox" name="_removeComments" value="1"> <?= e($k('opt_remove_comments')) ?></label>
          <label class="check"><input type="checkbox" name="_anon" value="1"> <?= e($k('opt_anon')) ?> <input type="text" name="_anonName" class="rev-anon" maxlength="40" value="<?= e($k('anon_default')) ?>" aria-label="<?= e($k('anon_name')) ?>"></label>
          <label class="check"><input type="checkbox" name="_trackOff" value="1"> <?= e($k('opt_track_off')) ?></label>
          <div class="grid-2 tight"><label class="field"><span><?= e($k('filename')) ?></span><input type="text" name="_filename" maxlength="200"></label></div>
          <div class="row-actions meta-actions"><button type="submit" class="btn btn-primary"><?= icon('download') ?><?= e($k('save')) ?></button></div>
          <p class="muted small" data-save-status></p>
        </div>
        <div data-doc-only hidden>
          <p class="muted"><?= icon('info-circle') ?> <?= e($k('doc_readonly')) ?></p>
        </div>
      </form>
    </section>
  </div>
</div>
