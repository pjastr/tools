<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: śledzone zmiany i komentarze w dokumentach Word (DOCX, DOCM, DOTX, DOTM, DOC, DOT).
 * Lista zmian (wstawienia, usunięcia, przeniesienia, formatowanie) i komentarzy z autorami, datami,
 * odpowiedziami i kontekstem; dla DOCX także akceptowanie / odrzucanie wszystkich zmian i usuwanie komentarzy.
 * Wszystko w przeglądarce – plik nie jest wysyłany na serwer.
 */
return [
    'icon' => 'git-compare',
    'category' => 'office',
    'order' => 21,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/fflate.min.js', 'js/lib/toolkit.js', 'js/lib/ooxml.js', 'js/lib/ole.js', 'tools/word-review/word-review.js'],
    'css' => [],
];
