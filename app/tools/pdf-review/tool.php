<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: historia zmian i komentarze w PDF – wersje z aktualizacji przyrostowych (z możliwością
 * pobrania każdej wersji), komentarze/adnotacje z autorami i datami, podpisy cyfrowe, historia XMP.
 * Wszystko w przeglądarce – plik nie jest wysyłany na serwer. Biblioteka: pdf-lib (MIT).
 */
return [
    'icon' => 'history',
    'category' => 'pdf',
    'order' => 11,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/pdf-lib.min.js', 'js/lib/toolkit.js', 'tools/pdf-review/pdf-review.js'],
    'css' => [],
];
