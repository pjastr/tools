# Historia zmian

Każda zmiana podnosi numer wersji w `app/version.php` (`APP_VERSION`).
Format: MAJOR.MINOR.PATCH – poprawki zwiększają PATCH, nowe funkcje MINOR.

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
