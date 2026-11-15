# tools-php

Zestaw narzędzi online napisany w czystym **PHP + MySQL/MariaDB** – bez Composera, bez Node.js na
serwerze i bez zewnętrznych usług. Działa na zwykłym hostingu współdzielonym. Licencja: **MIT**.

> Aplikacja została utworzona z pomocą **Claude** (asystenta AI firmy Anthropic) na podstawie
> wymagań autora repozytorium. Kod został przejrzany i przetestowany, ale – jak w przypadku każdego
> oprogramowania – przed użyciem produkcyjnym warto go sprawdzić we własnym środowisku.

## Narzędzia

| Narzędzie | Kategoria | Przetwarzanie | Opis |
|---|---|---|---|
| **Metadane PDF** | PDF | lokalnie w przeglądarce | Odczyt, edycja i usuwanie metadanych PDF (Info i XMP), szczegóły techniczne pliku, raport prywatności |
| **Metadane Word (DOCX, DOC)** | Dokumenty Office | lokalnie w przeglądarce | Odczyt, edycja i czyszczenie metadanych dokumentów Word (także starego formatu DOC), raport prywatności |
| **Metadane PowerPoint (PPTX, PPT)** | Dokumenty Office | lokalnie w przeglądarce | Właściwości prezentacji, notatki prelegenta, komentarze, ukryte slajdy, osadzone pliki; czyszczenie |
| **Metadane Excel (XLSX, XLS)** | Dokumenty Office | lokalnie w przeglądarce | Właściwości skoroszytu, ukryte arkusze/wiersze/kolumny, komentarze, łącza, połączenia z danymi; czyszczenie |
| **Historia zmian i komentarze PDF** | PDF | lokalnie w przeglądarce | Komentarze z autorami i datami, wcześniejsze wersje pliku (do pobrania), podpisy i zmiany po podpisaniu |
| **Śledzone zmiany i komentarze Word (DOCX, DOC)** | Dokumenty Office | lokalnie w przeglądarce | Lista zmian i komentarzy z kontekstem; akceptowanie / odrzucanie zmian i usuwanie komentarzy (DOCX) |

Docelowo aplikacja ma zawierać 10–30 narzędzi. Każde narzędzie to osobny moduł (zob.
„Dodawanie narzędzia”), który pojawia się na liście automatycznie.

### Metadane PDF

- Plik **nie jest wysyłany na serwer** – odczyt i zapis odbywają się w przeglądarce
  (biblioteka [pdf-lib](https://pdf-lib.js.org), MIT, dołączona lokalnie).
- Odczyt: tytuł, autor, temat, słowa kluczowe, program tworzący i generujący, daty (ze strefą czasową),
  Trapped, pola niestandardowe, pełne metadane **XMP** (tabela właściwości i kod XML).
- Szczegóły: wersja PDF, liczba i rozmiary stron, szyfrowanie, linearyzacja, aktualizacje przyrostowe,
  tagowanie, język, PDF/A / PDF/UA / PDF/X, zakładki, formularze, podpisy, JavaScript, obrazy,
  załączniki, czcionki (osadzone / podzbiory), identyfikator dokumentu.
- **Prywatność**: lista elementów, które mogą zdradzić więcej niż treść dokumentu (autor, oprogramowanie,
  historia XMP, stare wersje z aktualizacji przyrostowych, załączniki, JavaScript…).
- Edycja i zapis: zmiana i usuwanie pól, pola niestandardowe, aktualizacja / usunięcie XMP
  (z zachowaniem oznaczeń PDF/A i PDF/UA), „Usuń wszystkie metadane” (także XMP w stronach i obrazach
  oraz identyfikator dokumentu). Pobierana jest nowa kopia – oryginał pozostaje bez zmian.
- Eksport metadanych do JSON i TXT.
- Ograniczenia: plików zaszyfrowanych nie można edytować; zapis unieważnia podpisy cyfrowe
  (aplikacja ostrzega przed zapisem).

### Metadane Word (DOCX, DOC)

- Obsługuje **DOCX, DOCM, DOTX, DOTM** (pakiet ZIP, biblioteka [fflate](https://github.com/101arrowz/fflate), MIT)
  oraz **DOC i DOT** z Worda 97–2003 (własny czytnik i zapis plików OLE / Compound File).
  Plik **nie jest wysyłany na serwer**.
- Właściwości: tytuł, temat, autor, słowa kluczowe, komentarze, ostatnio modyfikujący, kategoria, stan,
  firma, menedżer, szablon, numer poprawki, łączny czas edycji, język, daty; statystyki (strony, wyrazy…);
  właściwości niestandardowe (tekst, liczba, tak/nie, data) – dodawanie, zmiana, usuwanie.
- **Prywatność**: komentarze i ich autorzy, śledzone zmiany (usunięty tekst nadal jest w pliku!), lista osób
  z kontami, ścieżka szablonu z nazwą użytkownika, zmienne dokumentu, identyfikatory sesji edycji (rsid),
  dane SharePoint/customXml, ukryty tekst, osadzone pliki, makra; w DOC także historia zapisów
  (autorzy i ścieżki) i „szybkie zapisywanie”.
- Czyszczenie: anonimizacja autorów komentarzy i zmian, usuwanie komentarzy, rsid, ścieżki szablonu,
  zmiennych, miniatury, customXml, historii zapisów (DOC), włączenie w Wordzie „Usuń dane osobowe przy
  zapisie”; przycisk „Usuń wszystkie metadane”. Pobierana jest nowa kopia – oryginał pozostaje bez zmian.
- Ograniczenia: dokumentów zaszyfrowanych hasłem nie można edytować; narzędzie nie akceptuje śledzonych
  zmian (trzeba to zrobić w Wordzie); w formacie DOC Word może przechowywać dodatkowe ślady w treści pliku.

### Metadane PowerPoint (PPTX, PPT)

- Obsługuje **PPTX, PPTM, POTX, PPSX** oraz **PPT, PPS, POT** z PowerPointa 97–2003. Plik nie jest wysyłany na serwer.
- Właściwości jak w narzędziu dla Worda (autor, firma, daty, właściwości niestandardowe…) i statystyki prezentacji.
- **Prywatność**: notatki prelegenta (z treścią), komentarze w starym i nowym formacie z odpowiedziami i kontami
  autorów (adresy e-mail), ukryte slajdy, osadzone pliki (np. arkusz Excela z danymi wykresu), odwołania do plików
  lokalnych, miniatura pierwszego slajdu, informacje o wersjach, makra; w PPT także nazwa ostatnio zapisującego
  i zapisy przyrostowe.
- Czyszczenie PPTX: usunięcie notatek, komentarzy, miniatury, customXml, revisionInfo, anonimizacja autorów
  komentarzy, „Usuń dane osobowe przy zapisie”. PPT: właściwości dokumentu i nazwa ostatnio zapisującego.

### Metadane Excel (XLSX, XLS)

- Obsługuje **XLSX, XLSM, XLTX, XLTM** oraz **XLS, XLT** z Excela 97–2003. Plik nie jest wysyłany na serwer.
- **Prywatność**: ukryte i „bardzo ukryte” arkusze, ukryte wiersze i kolumny (dane są w pliku!), komentarze
  i notatki (także wątkowe, z kontami autorów), nazwy zdefiniowane, łącza do innych skoroszytów (ścieżki),
  połączenia z bazami danych (z ostrzeżeniem o zapisanych hasłach), pamięci podręczne tabel przestawnych
  (kopie danych źródłowych), Power Query, nazwy drukarek, użytkownik rezerwacji pliku, historia zmian
  skoroszytu udostępnionego; w XLS także nazwa ostatnio zapisującego.
- Czyszczenie XLSX: komentarze, ustawienia drukarki, użytkownik rezerwacji, miniatura, customXml, anonimizacja
  autorów, „Usuń dane osobowe przy zapisie”. Ukrytych danych narzędzie nie usuwa – tylko je wskazuje.
  XLS: właściwości dokumentu i nazwa ostatnio zapisującego.

### Historia zmian i komentarze PDF

- **Komentarze**: notatki, wyróżnienia, podkreślenia, przekreślenia, pola tekstowe, rysunki, pieczątki,
  załączniki – z autorem, datą utworzenia i modyfikacji, tematem, odpowiedziami (wątki) i statusami recenzji
  (zaakceptowano, odrzucono…). Wyszukiwarka, filtry, eksport do CSV, JSON i TXT.
- **Wersje**: każdy zapis przyrostowy dopisuje zmiany na końcu pliku, a poprzednia treść zostaje w środku.
  Narzędzie odtwarza każdą wersję, pokazuje, co się w niej zmieniło (treść stron, komentarze, metadane),
  i pozwala ją pobrać dokładnie w takiej postaci, w jakiej była zapisana.
- **Podpisy cyfrowe**: kto i kiedy podpisał (wg podpisu i certyfikatu), którą wersję obejmuje podpis
  i czy dokument zmieniono po podpisaniu. Narzędzie nie weryfikuje kryptograficznie podpisu.
- **Historia XMP** (np. wpisy Adobe Acrobat / Photoshop).
- **Czyszczenie**: usunięcie wszystkich komentarzy lub zamiana autorów; zapis tworzy plik z jedną wersją.

### Śledzone zmiany i komentarze Word (DOCX, DOC)

- **Zmiany**: wstawienia, usunięcia (usunięty tekst nadal jest w pliku!), przeniesienia, zmiany formatowania
  tekstu i akapitów, połączone i nowe akapity, wiersze i komórki tabel – także w nagłówkach, stopkach,
  przypisach i komentarzach; z autorem, datą i fragmentem otaczającego tekstu.
- **Komentarze**: autor, inicjały, data, treść, fragment tekstu, którego dotyczą, odpowiedzi i stan
  „rozwiązany”.
- **Historia dokumentu**: autor, daty, liczba zapisów, łączny czas edycji, sesje edycji (rsid), osoby,
  w DOC także historia zapisów (autorzy i ścieżki) i „szybkie zapisywanie”.
- **DOCX**: zaakceptuj lub odrzuć wszystkie zmiany, usuń komentarze, zamień autorów, wyłącz śledzenie zmian.
  **DOC**: tylko odczyt (zmiany i komentarze są odczytywane bezpośrednio ze struktur pliku Word 97–2003).
- Eksport zmian i komentarzy do CSV, JSON i TXT.

## Konta i administracja

- Logowanie, rejestracja (do wyłączenia), role **administrator / użytkownik**.
- Weryfikacja dwuetapowa **2FA (TOTP)** z kodem QR i kodami zapasowymi, opcjonalne wymuszanie 2FA,
  blokada po nieudanych próbach logowania. Wejście do panelu admina wymaga nowego kodu 2FA.
- Ulubione i ostatnio używane narzędzia, wyszukiwarka i filtry kategorii.
- **Panel administratora**: przegląd, użytkownicy, ustawienia, **narzędzia** (włączanie/wyłączanie,
  statystyki użycia), dziennik logowań, języki (PL i EN wbudowane, dodawanie kolejnych i tłumaczenie
  w przeglądarce, także tekstów narzędzi), aktualizacje, kopia zapasowa bazy (.sql).
- Tryb jasny i ciemny, działa w Chrome i Firefox (także na tabletach i telefonach).

## Wymagania

- PHP **8.1+** z rozszerzeniami `pdo_mysql` i `mbstring`
  (opcjonalnie `zip` i `curl` – do aktualizacji jednym kliknięciem)
- MySQL **5.7+** lub MariaDB **10.2+**
- Apache (plik `.htaccess` jest dołączony) lub inny serwer WWW z PHP

## Instalacja

1. Utwórz pustą bazę danych (lub użyj istniejącej – tabele dostaną własny prefiks).
2. Wgraj wszystkie pliki na serwer (np. przez FTP).
3. Otwórz adres aplikacji w przeglądarce – uruchomi się instalator (`install.php`):
   - sprawdzi wymagania serwera,
   - poprosi o dane bazy i pozwoli **sprawdzić połączenie**,
   - poprosi o nazwę aplikacji i konto administratora.
4. Gotowe. Instalator sam:
   - wylosuje wolny prefiks tabel **`webtoolXYZ_`** (XYZ = 3 losowe cyfry, sprawdza, czy nie jest zajęty),
   - utworzy tabele i zapisze `config.php`
     (jeśli serwer nie pozwala na zapis, wyświetli plik do pobrania/wgrania).

## Aktualizacja

Bez ręcznych zmian w bazie danych:

- **Panel admina → Aktualizacje → Sprawdź aktualizacje → Zainstaluj** (pobiera wydanie z GitHub
  Releases repozytorium ustawionego w panelu, domyślnie `pjastr/tools`), albo
- **Wgraj paczkę ZIP** nowej wersji w tym samym miejscu, albo
- wgraj nowe pliki przez FTP, nadpisując stare (nie usuwaj `config.php`).

Po podmianie plików aplikacja sama wykryje nowszy schemat bazy i wyświetli administratorowi
ekran **„Wymagana aktualizacja bazy danych”** – wystarczy kliknąć jeden przycisk. Przed
aktualizacją można pobrać kopię bazy (Panel admina → Aktualizacje → Pobierz kopię bazy).

## Dodawanie narzędzia

Każde narzędzie to katalog `app/tools/<slug>/` (slug: małe litery, cyfry i `-`):

```
app/tools/<slug>/tool.php        – opis: ikona, kategoria, kolejność, pliki JS/CSS
app/tools/<slug>/view.php        – interfejs (HTML wstawiany na stronę narzędzia)
app/tools/<slug>/lang/pl.php     – tłumaczenia: tool.<slug>.name, .desc, .tags i własne klucze
app/tools/<slug>/lang/en.php
assets/tools/<slug>/…            – pliki JS i CSS narzędzia
```

Przykład `tool.php`:

```php
<?php
defined('TOOLS_APP') || exit;
return [
    'icon' => 'file-info',          // ikona z assets/js/icons.js
    'category' => 'pdf',            // pdf | office | image | text | dev | convert | security | other
    'order' => 20,
    'local' => true,                // true = dane przetwarzane tylko w przeglądarce
    'version' => '1.0.0',
    'js' => ['tools/<slug>/app.js'],   // ścieżki względem assets/
    'css' => ['tools/<slug>/style.css'],
];
```

Narzędzie pojawi się na liście automatycznie, a w Panelu admina → Narzędzia można je wyłączyć.
Teksty narzędzia trafiają do wspólnego słownika, więc w JS są dostępne przez
`App.t('tool.<slug>.klucz')`. Polityka CSP pozwala tylko na skrypty z tego samego serwera – biblioteki
dołączaj lokalnie (np. w `assets/vendor/`) i dopisz je do `THIRD-PARTY-NOTICES.md`.
Wspólne elementy interfejsu narzędzi (strefa upuszczania `.dropzone`, pasek pliku `.file-bar`,
formularz metadanych `.meta-*`, raport `.findings`, listy komentarzy i wersji `.rev-*`) są w
`assets/css/app.css`. Wspólny kod JS jest w `assets/js/lib/`:
`toolkit.js` (`window.ToolKit` – formatowanie, pobieranie plików, strefa upuszczania, zakładki, CSV),
`ooxml.js` (`window.ToolsOoxml` – pakiety DOCX/XLSX/PPTX, wymaga `vendor/fflate.min.js`),
`ole.js` (`window.ToolsOle` – pliki OLE, zestawy właściwości, struktury i tekst dokumentów DOC),
`officemeta.js` (`window.OfficeMeta` – gotowe narzędzie „Metadane …” dla formatów Office: wystarczy adapter
formatu i widok `app/views/office_meta.php`; teksty wspólne `om.*`, nadpisywane przez `tool.<slug>.*`).
Dołącz potrzebne pliki w polu `js` opisu narzędzia (przed własnym skryptem).
Nowe ikony: dopisz nazwę do `scripts/build-icons.js` i uruchom
`node scripts/build-icons.js <ścieżka do @tabler/icons>`.

## Nowa wersja (dla programistów)

1. Zwiększ `APP_VERSION` w `app/version.php` i opisz zmiany w `CHANGELOG.md`.
2. Zmiany w bazie dodaj jako nowy plik `migrations/NNN_opis.php` (kolejny numer), który zwraca
   funkcję wykonującą zapytania; nazwy tabel zapisuj jako `{nazwa}` – prefiks zostanie dodany
   automatycznie.
3. Zrób commit na `main`. GitHub Action (`.github/workflows/build-zip.yml`) po każdym commicie:
   - sprawdza składnię wszystkich plików PHP,
   - buduje paczkę `tools-php-X.Y.Z.zip` (bez `config.php`, `scripts/` i plików tymczasowych)
     i udostępnia ją jako artefakt w zakładce **Actions**,
   - jeśli wersja z `APP_VERSION` nie ma jeszcze tagu `vX.Y.Z`, tworzy **Release** z tym ZIP-em –
     wtedy zainstalowane aplikacje zobaczą aktualizację w panelu admina.

## Struktura

```
index.php        – strony (logowanie, narzędzia, profil, panel admina)
api.php          – API JSON (ulubione, motyw)
install.php      – instalator
app/             – kod PHP (lib/, pages/, views/, lang/, tools/)
migrations/      – migracje schematu bazy
assets/          – CSS, JS, ikony, biblioteki, pliki narzędzi (assets/tools/)
storage/         – pliki tymczasowe aktualizatora
scripts/         – skrypty pomocnicze (nieużywane na serwerze)
```

## Bezpieczeństwo

Hasła: `password_hash`; ochrona CSRF; ciasteczka sesji `HttpOnly`/`SameSite`; nagłówki CSP
(tylko zasoby z własnego serwera); limit prób logowania; dziennik logowań. Narzędzia oznaczone
jako „Lokalnie” nie wysyłają plików ani danych na serwer. Katalogi `app/`, `migrations/`, `storage/`
i `scripts/` są chronione przez `.htaccess` (na serwerze nginx zablokuj do nich dostęp w konfiguracji).

## Licencja

MIT – zob. `LICENSE`. Komponenty zewnętrzne (wszystkie na licencjach zgodnych z MIT):
`THIRD-PARTY-NOTICES.md`.
