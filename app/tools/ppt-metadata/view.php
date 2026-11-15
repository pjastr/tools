<?php
defined('TOOLS_APP') || exit;
// Wspólny widok narzędzi metadanych Office: app/views/office_meta.php
echo view('office_meta', [
    'slug' => 'ppt-metadata',
    'accept' => '.pptx,.pptm,.potx,.potm,.ppsx,.ppsm,.ppt,.pps,.pot,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'icon' => 'presentation',
    'opts' => [
        'anonymize' => 'user-off', 'removeComments' => 'messages', 'removeNotes' => 'note', 'removeThumbnail' => 'photo',
        'removeCustomXml' => 'database', 'removeRevInfo' => 'fingerprint', 'removePersonalInfo' => 'eraser',
    ],
]);
