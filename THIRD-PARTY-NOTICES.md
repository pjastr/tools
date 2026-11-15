# Komponenty zewnętrzne / Third-party notices

tools-php jest udostępniana na licencji MIT (plik `LICENSE`).
Aplikacja zawiera wyłącznie poniższe komponenty firm trzecich – wszystkie na licencjach
zgodnych z MIT (MIT, 0BSD, Zlib), pozwalających na swobodne użycie, modyfikację i dystrybucję,
także komercyjną. Pozostały kod (w tym obsługa TOTP/2FA i narzędzia) jest własną implementacją
projektu (MIT).

Nie są używane żadne zewnętrzne czcionki (tylko czcionki systemowe) ani usługi CDN –
wszystkie pliki są serwowane lokalnie.

| Komponent | Wersja | Plik | Licencja |
|---|---|---|---|
| pdf-lib (Andrew Dillon) | 1.17.1 | `assets/vendor/pdf-lib.min.js` | MIT |
| ↳ wbudowane: @pdf-lib/standard-fonts (Andrew Dillon) | 1.0.0 | jw. | MIT |
| ↳ wbudowane: @pdf-lib/upng (Photopea) | 1.0.1 | jw. | MIT |
| ↳ wbudowane: pako (Vitaly Puzrin, Andrei Tuputcyn) | 1.0.11 | jw. | MIT i Zlib |
| ↳ wbudowane: helpery tslib (Microsoft Corporation) | 1.14.1 | jw. | 0BSD |
| QR Code Generator for JavaScript (Kazuhiko Arase) | 1.4.4 | `assets/vendor/qrcode.js` | MIT |
| Tabler Icons (Paweł Kuna) | 3.19.0 | `assets/js/icons.js`, `app/lib/icons_data.php` (wybrane ikony) | MIT |

„QR Code” jest zastrzeżonym znakiem towarowym DENSO WAVE INCORPORATED.

---

## pdf-lib — MIT

Copyright (c) 2019 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## @pdf-lib/standard-fonts — MIT

Copyright (c) 2018 Andrew Dillon

Licensed under the MIT license (treść licencji MIT jak wyżej).

## @pdf-lib/upng — MIT

Copyright (c) 2017 Photopea

Licensed under the MIT license (treść licencji MIT jak wyżej).

## pako — MIT i Zlib

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Licensed under the MIT license (treść licencji MIT jak wyżej). Fragmenty pochodzące z biblioteki zlib:

(C) 1995-2013 Jean-loup Gailly and Mark Adler

This software is provided 'as-is', without any express or implied warranty. In no event will
the authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial
applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote
   the original software. If you use this software in a product, an acknowledgment in the
   product documentation would be appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as
   being the original software.
3. This notice may not be removed or altered from any source distribution.

## tslib helpers (wbudowane w pdf-lib) — 0BSD

Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL
THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF
CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE
OR PERFORMANCE OF THIS SOFTWARE.

## QR Code Generator for JavaScript — MIT

Copyright (c) 2009 Kazuhiko Arase — http://www.d-project.com/

Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
(treść licencji MIT jak wyżej).

## Tabler Icons — MIT

Copyright (c) 2020-2024 Paweł Kuna — https://tabler.io/icons

Licensed under the MIT license (treść licencji MIT jak wyżej).
