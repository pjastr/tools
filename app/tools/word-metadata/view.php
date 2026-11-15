<?php
defined('TOOLS_APP') || exit;
// Wspólny widok narzędzi metadanych Office: app/views/office_meta.php
echo view('office_meta', [
    'slug' => 'word-metadata',
    'accept' => '.docx,.docm,.dotx,.dotm,.doc,.dot,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'icon' => 'file-word',
    'opts' => [
        'anonymize' => 'user-off', 'removeComments' => 'messages', 'removeRsid' => 'fingerprint', 'removeTemplate' => 'template',
        'removeDocVars' => 'variable', 'removeThumbnail' => 'photo', 'removeCustomXml' => 'database', 'removeSavedBy' => 'history',
        'removePersonalInfo' => 'eraser',
    ],
]);
