<?php
defined('TOOLS_APP') || exit;

/**
 * Rejestr narzędzi. Każde narzędzie to osobny katalog app/tools/<slug>/:
 *   tool.php      – opis (ikona, kategoria, pliki JS/CSS z katalogu assets/), zwraca tablicę
 *   view.php      – interfejs narzędzia (HTML wstawiany do strony)
 *   lang/<kod>.php – tłumaczenia (klucze tool.<slug>.*) – trafiają do wspólnego słownika,
 *                   więc można je też tłumaczyć w Panelu admina → Języki
 * Pliki statyczne narzędzia leżą w assets/tools/<slug>/.
 * Nowe narzędzie = nowy katalog; nie trzeba zmieniać bazy ani innych plików.
 */
final class Tools
{
    private static ?array $all = null;

    public static function dir(): string
    {
        return ROOT . '/app/tools';
    }

    public static function validSlug(string $slug): bool
    {
        return (bool)preg_match('/^[a-z0-9][a-z0-9-]{1,47}$/', $slug);
    }

    /** Kategorie: klucz => ikona (nazwy w tłumaczeniach jako cat.<klucz>). */
    public static function categories(): array
    {
        return [
            'pdf' => 'file-type-pdf',
            'image' => 'photo',
            'text' => 'typography',
            'dev' => 'code',
            'convert' => 'arrows-left-right',
            'security' => 'shield-lock',
            'other' => 'tool',
        ];
    }

    /** Wszystkie zainstalowane narzędzia: slug => opis (posortowane). */
    public static function all(): array
    {
        if (self::$all !== null) {
            return self::$all;
        }
        $list = [];
        foreach (glob(self::dir() . '/*/tool.php') ?: [] as $file) {
            $slug = basename(dirname($file));
            if (!self::validSlug($slug)) {
                continue;
            }
            $m = require $file;
            if (!is_array($m)) {
                continue;
            }
            $cats = self::categories();
            $list[$slug] = [
                'slug' => $slug,
                'icon' => (string)($m['icon'] ?? 'tool'),
                'category' => isset($cats[$m['category'] ?? '']) ? $m['category'] : 'other',
                'order' => (int)($m['order'] ?? 100),
                'local' => (bool)($m['local'] ?? true),
                'version' => (string)($m['version'] ?? '1.0.0'),
                'js' => array_values(array_filter((array)($m['js'] ?? []), 'is_string')),
                'css' => array_values(array_filter((array)($m['css'] ?? []), 'is_string')),
            ];
        }
        uasort($list, fn($a, $b) => [$a['order'], $a['slug']] <=> [$b['order'], $b['slug']]);
        return self::$all = $list;
    }

    public static function get(string $slug): ?array
    {
        return self::all()[$slug] ?? null;
    }

    public static function name(string $slug): string
    {
        return __('tool.' . $slug . '.name');
    }

    /* ---------- Włączanie / wyłączanie (Panel admina → Narzędzia) ---------- */

    public static function disabledList(): array
    {
        $v = json_decode((string)Settings::get('tools_disabled', '[]'), true);
        return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
    }

    public static function isEnabled(string $slug): bool
    {
        return isset(self::all()[$slug]) && !in_array($slug, self::disabledList(), true);
    }

    public static function setEnabled(string $slug, bool $on): void
    {
        $list = array_diff(self::disabledList(), [$slug]);
        if (!$on) {
            $list[] = $slug;
        }
        Settings::set('tools_disabled', json_encode(array_values(array_unique($list))));
    }

    /** Narzędzia dostępne dla użytkowników. */
    public static function enabled(): array
    {
        $off = self::disabledList();
        return array_filter(self::all(), fn($t) => !in_array($t['slug'], $off, true));
    }

    /* ---------- Tłumaczenia narzędzi ---------- */

    /** Połączone tłumaczenia wszystkich narzędzi dla języka (z plików app/tools/<slug>/lang/<kod>.php). */
    public static function langFile(string $code): array
    {
        $out = [];
        if (!preg_match('/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/', $code)) {
            return $out;
        }
        foreach (glob(self::dir() . '/*/lang/' . $code . '.php') ?: [] as $file) {
            $arr = require $file;
            if (is_array($arr)) {
                $out = array_merge($out, $arr);
            }
        }
        return $out;
    }

    /* ---------- Preferencje użytkownika: ulubione i ostatnio używane ---------- */

    /** slug => ['favorite' => bool, 'uses' => int, 'last_used_at' => ?string] */
    public static function prefs(int $uid): array
    {
        $out = [];
        try {
            foreach (DB::all('SELECT * FROM {tool_prefs} WHERE `user_id` = ?', [$uid]) as $r) {
                $out[$r['tool']] = ['favorite' => (int)$r['favorite'] === 1, 'uses' => (int)$r['uses'], 'last_used_at' => $r['last_used_at']];
            }
        } catch (Throwable $e) {
            // brak tabeli przed aktualizacją bazy
        }
        return $out;
    }

    public static function recordUse(int $uid, string $slug): void
    {
        try {
            DB::run('INSERT INTO {tool_prefs} (`user_id`,`tool`,`favorite`,`uses`,`last_used_at`) VALUES (?,?,0,1,?)
                ON DUPLICATE KEY UPDATE `uses` = `uses` + 1, `last_used_at` = VALUES(`last_used_at`)', [$uid, $slug, DB::now()]);
        } catch (Throwable $e) {
        }
    }

    public static function setFavorite(int $uid, string $slug, bool $fav): void
    {
        DB::run('INSERT INTO {tool_prefs} (`user_id`,`tool`,`favorite`,`uses`) VALUES (?,?,?,0)
            ON DUPLICATE KEY UPDATE `favorite` = VALUES(`favorite`)', [$uid, $slug, $fav ? 1 : 0]);
    }

    /** Statystyki użycia: slug => ['uses' => int, 'users' => int, 'last' => ?string] */
    public static function usageStats(): array
    {
        $out = [];
        try {
            foreach (DB::all('SELECT `tool`, SUM(`uses`) AS uses, SUM(`uses` > 0) AS users, MAX(`last_used_at`) AS last, SUM(`favorite`) AS favs FROM {tool_prefs} GROUP BY `tool`') as $r) {
                $out[$r['tool']] = ['uses' => (int)$r['uses'], 'users' => (int)$r['users'], 'last' => $r['last'], 'favs' => (int)$r['favs']];
            }
        } catch (Throwable $e) {
        }
        return $out;
    }
}
