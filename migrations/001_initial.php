<?php
defined('TOOLS_APP') || exit;

/*
 * Migracja 001 – schemat początkowy.
 * Każdy plik migracji zwraca funkcję wykonywaną raz. Numer w nazwie pliku = wersja schematu.
 * Nazwy tabel w nawiasach klamrowych są automatycznie poprzedzane prefiksem instalacji.
 */
return function (): void {
    $opts = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

    DB::run("CREATE TABLE IF NOT EXISTS {settings} (
        `name` VARCHAR(64) NOT NULL PRIMARY KEY,
        `value` MEDIUMTEXT NULL
    ) $opts");

    DB::run("CREATE TABLE IF NOT EXISTS {users} (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `username` VARCHAR(64) NOT NULL,
        `email` VARCHAR(190) NOT NULL,
        `password_hash` VARCHAR(255) NOT NULL,
        `role` VARCHAR(16) NOT NULL DEFAULT 'user',
        `status` VARCHAR(16) NOT NULL DEFAULT 'active',
        `totp_secret` VARCHAR(64) NULL,
        `totp_enabled` TINYINT(1) NOT NULL DEFAULT 0,
        `totp_last_step` BIGINT NOT NULL DEFAULT 0,
        `backup_codes` TEXT NULL,
        `lang` VARCHAR(12) NULL,
        `theme` VARCHAR(12) NOT NULL DEFAULT 'system',
        `created_at` DATETIME NOT NULL,
        `last_login_at` DATETIME NULL,
        `last_login_ip` VARCHAR(45) NULL,
        UNIQUE KEY `uniq_username` (`username`),
        UNIQUE KEY `uniq_email` (`email`)
    ) $opts");

    DB::run("CREATE TABLE IF NOT EXISTS {languages} (
        `code` VARCHAR(12) NOT NULL PRIMARY KEY,
        `name` VARCHAR(64) NOT NULL,
        `active` TINYINT(1) NOT NULL DEFAULT 1,
        `builtin` TINYINT(1) NOT NULL DEFAULT 0
    ) $opts");

    DB::run("CREATE TABLE IF NOT EXISTS {translations} (
        `lang` VARCHAR(12) NOT NULL,
        `tkey` VARCHAR(128) NOT NULL,
        `tvalue` TEXT NOT NULL,
        PRIMARY KEY (`lang`, `tkey`)
    ) $opts");

    DB::run("CREATE TABLE IF NOT EXISTS {login_attempts} (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `ip` VARCHAR(45) NOT NULL,
        `ident` VARCHAR(190) NOT NULL,
        `success` TINYINT(1) NOT NULL DEFAULT 0,
        `created_at` DATETIME NOT NULL,
        KEY `idx_ip` (`ip`, `created_at`),
        KEY `idx_ident` (`ident`, `created_at`)
    ) $opts");

    DB::run("CREATE TABLE IF NOT EXISTS {login_log} (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `user_id` INT UNSIGNED NULL,
        `username` VARCHAR(64) NULL,
        `ident` VARCHAR(190) NOT NULL DEFAULT '',
        `event` VARCHAR(16) NOT NULL DEFAULT 'login',
        `success` TINYINT(1) NOT NULL DEFAULT 0,
        `reason` VARCHAR(24) NOT NULL DEFAULT '',
        `ip` VARCHAR(45) NOT NULL DEFAULT '',
        `user_agent` VARCHAR(255) NOT NULL DEFAULT '',
        `created_at` DATETIME NOT NULL,
        KEY `idx_created` (`created_at`),
        KEY `idx_user` (`user_id`, `created_at`),
        KEY `idx_ip` (`ip`)
    ) $opts");

    DB::run("CREATE TABLE IF NOT EXISTS {tool_prefs} (
        `user_id` INT UNSIGNED NOT NULL,
        `tool` VARCHAR(64) NOT NULL,
        `favorite` TINYINT(1) NOT NULL DEFAULT 0,
        `uses` INT UNSIGNED NOT NULL DEFAULT 0,
        `last_used_at` DATETIME NULL,
        PRIMARY KEY (`user_id`, `tool`),
        KEY `idx_tool` (`tool`)
    ) $opts");

    DB::run("INSERT IGNORE INTO {languages} (`code`,`name`,`active`,`builtin`) VALUES ('pl','Polski',1,1),('en','English',1,1)");

    $defaults = [
        'site_name' => 'Narzędzia',
        'registration_enabled' => '1',
        'require_2fa' => 'none',
        'default_lang' => 'pl',
        'tools_disabled' => '[]',
        'login_log_days' => '90',
        'update_repo' => APP_UPDATE_REPO,
    ];
    foreach ($defaults as $k => $v) {
        DB::run('INSERT IGNORE INTO {settings} (`name`,`value`) VALUES (?,?)', [$k, $v]);
    }
};
