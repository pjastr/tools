<?php
defined('TOOLS_APP') || exit;
// Wspólny widok narzędzi metadanych Office: app/views/office_meta.php
echo view('office_meta', [
    'slug' => 'excel-metadata',
    'accept' => '.xlsx,.xlsm,.xltx,.xltm,.xls,.xlt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'icon' => 'file-spreadsheet',
    'opts' => [
        'anonymize' => 'user-off', 'removeComments' => 'messages', 'removePrinter' => 'device-desktop', 'removeSharingUser' => 'user',
        'removeThumbnail' => 'photo', 'removeCustomXml' => 'database', 'removePersonalInfo' => 'eraser',
    ],
]);
