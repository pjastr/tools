<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: metadane skoroszytów Excel (XLSX, XLSM, XLTX, XLTM, XLS, XLT) – odczyt, edycja i czyszczenie
 * w całości w przeglądarce. Plik nie jest wysyłany na serwer.
 * Wspólny moduł metadanych Office: assets/js/lib/officemeta.js, widok: app/views/office_meta.php.
 */
return [
    'icon' => 'file-spreadsheet',
    'category' => 'office',
    'order' => 23,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/fflate.min.js', 'js/lib/toolkit.js', 'js/lib/ooxml.js', 'js/lib/ole.js', 'js/lib/officemeta.js', 'tools/excel-metadata/excel-metadata.js'],
    'css' => [],
];
