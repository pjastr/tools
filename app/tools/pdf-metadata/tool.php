<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: metadane PDF – odczyt i edycja metadanych (Info, XMP) w całości w przeglądarce.
 * Plik PDF nie jest wysyłany na serwer. Biblioteka: pdf-lib (MIT).
 */
return [
    'icon' => 'file-info',
    'category' => 'pdf',
    'order' => 10,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/pdf-lib.min.js', 'tools/pdf-metadata/pdf-metadata.js'],
    'css' => ['tools/pdf-metadata/pdf-metadata.css'],
];
