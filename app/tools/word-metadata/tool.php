<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: metadane dokumentów Word (DOCX, DOCM, DOTX, DOTM, DOC, DOT) – odczyt, edycja i czyszczenie
 * w całości w przeglądarce. Plik nie jest wysyłany na serwer.
 * DOCX: pakiet ZIP (biblioteka fflate, MIT). DOC: własny czytnik i zapis plików OLE (Compound File).
 */
return [
    'icon' => 'file-word',
    'category' => 'office',
    'order' => 20,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/fflate.min.js', 'js/lib/toolkit.js', 'js/lib/ooxml.js', 'js/lib/ole.js', 'js/lib/officemeta.js', 'tools/word-metadata/word-metadata.js'],
    'css' => [],
];
