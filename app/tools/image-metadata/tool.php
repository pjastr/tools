<?php
defined('TOOLS_APP') || exit;

/*
 * Narzędzie: metadane obrazów (JPEG, PNG, WEBP) – EXIF, GPS, XMP, IPTC, ICC, komentarze; bezstratne czyszczenie
 * w całości w przeglądarce. Obraz nie jest wysyłany na serwer ani ponownie kompresowany.
 */
return [
    'icon' => 'photo-scan',
    'category' => 'image',
    'order' => 30,
    'local' => true,
    'version' => '1.0.0',
    'js' => ['vendor/fflate.min.js', 'js/lib/toolkit.js', 'tools/image-metadata/image-metadata.js'],
    'css' => ['tools/image-metadata/image-metadata.css'],
];
