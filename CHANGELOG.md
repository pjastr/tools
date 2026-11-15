# Historia zmian

Każda zmiana podnosi numer wersji w `app/version.php` (`APP_VERSION`).
Format: MAJOR.MINOR.PATCH – poprawki zwiększają PATCH, nowe funkcje MINOR.

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
