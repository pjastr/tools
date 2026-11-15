<?php
/*
 * tools-php – JSON API (ulubione narzędzia itp.).
 * Licencja: MIT
 */
define('TOOLS_APP', true);
require __DIR__ . '/app/bootstrap.php';
app_boot();

const MAX_INPUT_BYTES = 64 * 1024;

$action = isset($_GET['a']) && is_string($_GET['a']) ? $_GET['a'] : '';
$user = Auth::user();

if (Migrator::needsUpdate()) {
    json_out(['error' => __('maint.title')], 503);
}
if (!$user) {
    json_out(['error' => 'unauthorized'], 401);
}
if (Auth::mustSetup2fa($user)) {
    json_out(['error' => __('auth.2fa_required_notice')], 403);
}

$isPost = is_post();
if ($isPost) {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf'] ?? null);
    if (!csrf_valid(is_string($token) ? $token : null)) {
        json_out(['error' => __('common.csrf_error')], 419);
    }
}

/** Dane wejściowe: JSON w treści żądania albo zwykły formularz. */
function input(): array
{
    static $in = null;
    if ($in === null) {
        $in = $_POST;
        if (str_contains((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
            $raw = file_get_contents('php://input', false, null, 0, MAX_INPUT_BYTES);
            $in = json_decode((string)$raw, true);
            if (!is_array($in)) {
                json_out(['error' => 'invalid json'], 400);
            }
        }
    }
    return $in;
}

function require_post(): void
{
    if (!is_post()) {
        json_out(['error' => 'method not allowed'], 405);
    }
}

/** Narzędzie musi istnieć i być włączone. */
function enabled_tool(string $slug): array
{
    $t = Tools::validSlug($slug) && Tools::isEnabled($slug) ? Tools::get($slug) : null;
    if (!$t) {
        json_out(['error' => __('tools.not_found')], 404);
    }
    return $t;
}

$uid = (int)$user['id'];

switch ($action) {
    case 'tool.fav':
        require_post();
        $in = input();
        $t = enabled_tool((string)($in['tool'] ?? ''));
        $fav = !empty($in['favorite']);
        Tools::setFavorite($uid, $t['slug'], $fav);
        json_out(['ok' => true, 'favorite' => $fav]);

    case 'user.theme':
        require_post();
        $in = input();
        $theme = in_array($in['theme'] ?? '', ['system', 'light', 'dark'], true) ? $in['theme'] : 'system';
        DB::update('users', ['theme' => $theme], '`id` = ?', [$uid]);
        json_out(['ok' => true, 'theme' => $theme]);

    default:
        json_out(['error' => 'unknown action'], 404);
}
