<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: metadane prezentacji PowerPoint (PPTX, PPTM, POTX, PPSX, PPT, PPS, POT) – odczyt, edycja
 * i czyszczenie w całości w przeglądarce. Plik nie jest wysyłany na serwer.
 * Wspólny moduł metadanych Office: assets/js/lib/officemeta.js, widok: app/views/office_meta.php.
 */
return [
    'icon' => 'presentation',
    'category' => 'office',
    'order' => 22,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/fflate.min.js', 'js/lib/toolkit.js', 'js/lib/ooxml.js', 'js/lib/ole.js', 'js/lib/officemeta.js', 'tools/ppt-metadata/ppt-metadata.js'],
    'css' => [],
];
