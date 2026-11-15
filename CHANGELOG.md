# Historia zmian

Każda zmiana podnosi numer wersji w `app/version.php` (`APP_VERSION`).
Format: MAJOR.MINOR.PATCH – poprawki zwiększają PATCH, nowe funkcje MINOR.

## 1.3.0 — 2026-11-15
- Nowe narzędzie **Metadane PowerPoint (PPTX, PPT)** – w całości w przeglądarce:
  - właściwości prezentacji (autor, firma, daty, właściwości niestandardowe…), statystyki;
  - raport prywatności: notatki prelegenta, komentarze (stare i nowe, z odpowiedziami i kontami autorów),
    ukryte slajdy, osadzone pliki (np. arkusze Excela pod wykresami), odwołania zewnętrzne, miniatura,
    informacje o wersjach (revisionInfo), makra;
  - PPTX: usuwanie notatek, komentarzy, miniatury, customXml, revisionInfo, anonimizacja autorów,
    „Usuń dane osobowe przy zapisie”;
  - PPT: właściwości dokumentu, nazwa ostatnio zapisującego (Current User), odczyt notatek, komentarzy
    i zapisów przyrostowych z rekordów „PowerPoint Document”.
- Wspólny moduł narzędzi metadanych Office: `assets/js/lib/officemeta.js` i widok `app/views/office_meta.php`
  (właściwości OOXML/OLE, formularz, zapis, eksport), teksty wspólne `om.*` w `app/lang`.
  Narzędzie „Metadane Word” korzysta z niego bez zmian w działaniu.

## 1.2.0 — 2026-11-15
- Nowe narzędzie **Historia zmian i komentarze PDF**:
  - komentarze i adnotacje recenzenta (notatki, wyróżnienia, pola tekstowe, rysunki, pieczątki…)
    z autorami, datami, odpowiedziami i statusami recenzji; filtry, eksport CSV/JSON/TXT;
  - wersje pliku z zapisów przyrostowych: co zmieniło się w każdej wersji (strony, komentarze,
    metadane), pobieranie każdej wcześniejszej wersji;
  - podpisy cyfrowe: którą wersję obejmuje podpis, czy plik zmieniono po podpisaniu, nazwy z certyfikatów;
  - historia zmian z metadanych XMP;
  - usuwanie i anonimizacja komentarzy (zapis bez wcześniejszych wersji).
- Nowe narzędzie **Śledzone zmiany i komentarze Word (DOCX, DOC)**:
  - lista zmian (wstawienia, usunięcia, przeniesienia, formatowanie, akapity, wiersze i komórki tabel,
    nagłówki, stopki, przypisy) z autorem, datą i kontekstem;
  - komentarze z odpowiedziami, stanem „rozwiązany” i fragmentem tekstu, którego dotyczą;
  - historia dokumentu (autorzy, daty, liczba zapisów, czas edycji, sesje edycji, historia zapisów DOC);
  - DOCX: akceptowanie lub odrzucanie wszystkich zmian, usuwanie komentarzy, anonimizacja autorów,
    wyłączenie śledzenia zmian; DOC: odczyt z tabeli fragmentów i właściwości znaków (bez zapisu).
- Wspólne biblioteki narzędzi: `assets/js/lib/toolkit.js` (funkcje pomocnicze), `ooxml.js` (pakiety
  Office Open XML), `ole.js` (pliki OLE/DOC, zestawy właściwości, tekst i zmiany w DOC).

## 1.1.0 — 2026-11-15
- Nowe narzędzie **Metadane Word (DOCX, DOC)** – w całości w przeglądarce:
  - DOCX/DOCM/DOTX/DOTM: właściwości podstawowe, rozszerzone (firma, menedżer, szablon, czas edycji)
    i niestandardowe; raport prywatności (komentarze, śledzone zmiany, osoby, ścieżka szablonu,
    zmienne dokumentu, rsid, customXml/SharePoint, ukryty tekst, osadzone pliki, makra);
    czyszczenie: anonimizacja autorów, usuwanie komentarzy, rsid, szablonu, zmiennych, miniatury,
    customXml, włączenie „Usuń dane osobowe przy zapisie”.
  - DOC/DOT (Word 97–2003): własny odczyt i zapis plików OLE i zestawów właściwości
    (SummaryInformation, DocumentSummaryInformation, właściwości niestandardowe), odczyt autorów
    komentarzy i zmian, historii zapisów i ciągów powiązanych; anonimizacja autorów, usuwanie historii
    zapisów i ścieżki szablonu. Zapis tworzy plik od nowa (bez pozostałości w wolnych sektorach).
  - Eksport metadanych do JSON i TXT.
- Nowa kategoria narzędzi „Dokumenty Office”.
- Wspólne style narzędzi (strefa upuszczania, pasek pliku, formularz metadanych, raport) przeniesione
  do `assets/css/app.css`.
- Biblioteka fflate (MIT) do obsługi plików ZIP.

## 1.0.0 — 2026-11-15
- Pierwsza wersja: katalog narzędzi (wyszukiwarka, kategorie, ulubione, ostatnio używane),
  modułowa budowa narzędzi (`app/tools/<slug>/`), włączanie/wyłączanie i statystyki w Panelu admina.
- Narzędzie **Metadane PDF**: odczyt, edycja i usuwanie metadanych (Info, XMP) w całości
  w przeglądarce, szczegóły techniczne, raport prywatności, eksport JSON/TXT.
- Konta: logowanie, rejestracja, role admin/użytkownik, 2FA (TOTP) z kodami zapasowymi,
  ponowna weryfikacja 2FA przy wejściu do panelu admina, dziennik logowań.
- Panel admina: przegląd, użytkownicy, ustawienia, narzędzia, logowania, języki (PL, EN),
  aktualizacje z GitHub Releases lub paczki ZIP, kopia zapasowa bazy.
- Instalator i aktualizator bazy (migracje), prefiks tabel `webtoolXYZ_`, GitHub Action budujący paczkę ZIP.
- Aplikacja utworzona z pomocą Claude (Anthropic).
