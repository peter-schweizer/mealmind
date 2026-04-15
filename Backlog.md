# MealMind — Backlog & Technische Notizen

> Letzte Aktualisierung: April 2026  
> Zweck: Dokumentiert offene Aufgaben, verworfene Ideen und Recherche-Ergebnisse für zukünftige Sessions.

---

## Aktuelle Architektur

| Schicht | Technologie |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Datenbank | PostgreSQL auf Neon.com (`pg`-Treiber, JSONB-Spalten) |
| Deployment | Vercel (Serverless Function für Backend, Static für Frontend) |
| Scraping | Axios + Cheerio + robots-parser |

---

## Meta-Suche: Recherche-Ergebnisse & Status

### ✅ Chefkoch (aktiv, funktioniert)
- **Methode:** Öffentliche JSON-API (`api.chefkoch.de/v2/recipes?query=…`)
- **Kein API-Key erforderlich**
- **Liefert:** Titel, Bild-URL, `siteUrl`, Schwierigkeitsgrad, Bewertung
- **Hinweis:** Inoffizielle API — kann sich ohne Ankündigung ändern. HTML-Scraping der Suchergebnisseite (`chefkoch.de/rs/s0/{query}/Rezepte.html`) als Fallback implementiert.
- **Einzelrezept-Import:** Funktioniert über `/api/recipes/scrape` (JSON-LD + HTML-Fallback)

---

### 🔑 Spoonacular (integriert, benötigt API-Key)
- **Offizielle REST-API:** `api.spoonacular.com/recipes/complexSearch`
- **Registrierung:** [spoonacular.com/food-api/console](https://spoonacular.com/food-api/console) (kostenlos)
- **Free Tier:** ~150 API-Punkte/Tag ≈ 15 Suchanfragen à 10 Ergebnisse
- **Paid Plans:** Cook ($29/Monat, 1.500 Punkte), Culinarian ($79), Chef ($149)
- **Aktivierung:** `SPOONACULAR_API_KEY=<key>` in `backend/.env` und als Vercel-Umgebungsvariable
- **Relevante Parameter:**
  ```
  GET https://api.spoonacular.com/recipes/complexSearch
    ?query={suchbegriff}
    &number=10
    &addRecipeInformation=true   ← liefert sourceUrl, readyInMinutes, dietary flags
    &apiKey={key}
  ```
- **Optionaler Filter:** `cuisine=German` für explizit deutsche Küche (schränkt Ergebnisse stark ein — nicht standardmäßig aktiv)
- **Einzelrezept-Import:** Über `sourceUrl` (externe Rezeptseite) möglich; Spoonacular-native Rezepte ohne externe URL können nicht per Scraper importiert werden

---

### ❌ fddb.info (nicht geeignet — verworfen)
- **Warum nicht:** fddb.info ist eine **Lebensmittel- und Nährwert-Datenbank**, kein Rezeptportal.
- Die API (`fddb.info/api/v18/documentation/`) bietet nur `search` (nach Lebensmitteln) und `get_item` (Nährwert-Details).
- **Keine Rezeptsuche**, keine Rezept-URLs, keine Zubereitung.
- **Fazit:** Für MealMind nicht verwendbar. Könnte höchstens für eine Nährwert-Erweiterung relevant sein.

---

### ❌ REWE (Suche blockiert, Einzelimport funktioniert)
- **Problem:** REWE.de antwortet auf Serveranfragen mit HTTP 403 (Bot-Detection) oder liefert nur eine leere JavaScript-Shell ohne Inhalte.
- Alle getesteten URLs blockiert: `/rezepte/suche/`, `/rezepte/?q=`, `/api/v1/recipes/search`
- **Einzelrezept-Import:** Kann manuell über die URL `/api/recipes/scrape` versucht werden (JSON-LD auf REWE-Rezeptseiten vorhanden).
- **Zukunft:** Könnte mit einem Headless Browser (Playwright/Puppeteer) funktionieren — siehe Backlog unten.

---

### ❌ Lecker.de (JavaScript-rendered — verworfen)
- Suchergebnisseite liefert leeres HTML, Inhalte werden clientseitig geladen.
- Keine `__NEXT_DATA__` oder JSON-LD in der initialen Response.

### ❌ EatSmarter (JavaScript-rendered — nicht getestet)
- Öffentlich dokumentierte API: keine bekannt.
- Such-URL: `https://eatsmarter.de/suche/rezepte?ft={query}`
- Wahrscheinlich ebenfalls JS-rendered — Test ausstehend.

### ❌ Kitchen Stories (JavaScript-rendered — nicht getestet)
- Such-URL: `https://www.kitchenstories.com/de/suche?search={query}`
- App-zentrischer Dienst, API vermutlich intern/nicht öffentlich.

### ❌ Gutekueche.at (JavaScript-rendered — getestet, leer)
- Suchergebnisseite liefert zwar HTML (47 KB), aber keine Rezept-Links in der initialen Response.

---

## Backlog — Offene Aufgaben

### 🔴 Hoch (nächste Priorität)

#### [SEARCH-1] Edamam Recipe Search API integrieren
- **API:** [developer.edamam.com](https://developer.edamam.com/edamam-recipe-api)
- **Vorteile:** Sehr große Datenbank, unterstützt deutsche Suchbegriffe gut (semantische Analyse), gibt Nährwerte zurück
- **Free Tier:** 10.000 Aufrufe/Monat (Developer Plan)
- **Registrierung:** Kostenlos, gibt `app_id` + `app_key`
- **Endpoint:** `https://api.edamam.com/api/recipes/v2?type=public&q={query}&app_id=X&app_key=Y`
- **Response:** Enthält `shareAs` (Rezept-URL), `label` (Titel), `image`, `totalTime`, `dietLabels`
- **Implementierung:** Analog zu Spoonacular in `search.ts`, aktiviert via `EDAMAM_APP_ID` + `EDAMAM_APP_KEY` in `.env`

#### [SEARCH-2] REWE via Headless Browser (Playwright)
- **Idee:** Playwright als Backend-Dependency installieren und für REWE-Suche nutzen (chromium headless)
- **Problem:** Playwright-Bundle ist ~300 MB → zu groß für Vercel Serverless Functions (Limit: 50 MB)
- **Alternativen:**
  - Separater Microservice (z.B. Railway, Render) der Playwright hostet
  - Browserless.io (Cloud-Headless-Browser als Service, hat Free Tier)
  - `playwright-aws-lambda` mit Lambda (komplexer Setup)
- **Vercel-Lösung:** Könnte mit `@sparticuz/chromium` + Vercel Edge Functions gehen — noch nicht getestet

---

### 🟡 Mittel

#### [SEARCH-3] RSS.app / Chefkoch-RSS-Feeds nutzen
- Chefkoch bietet RSS-Feeds für Kategorien an (z.B. `chefkoch.de/rss/was-koche-ich-heute.xml`)
- RSS.app kann dynamisch aus Chefkoch-Suchanfragen einen Feed generieren
- **Vorteil:** Kein Scraping-Risiko, standardisiertes Format
- **Implementierung:** RSS-Parser (`rss-parser` npm-Paket) integrieren, neuen Source-Typ `rss` anlegen

#### [SEARCH-4] Spoonacular `cuisine=German` als optionalen Filter
- Aktuell kein Cuisine-Filter aktiv (zu restriktiv für allgemeine Suchanfragen)
- Idee: Frontend-Checkbox „Nur deutsche Küche" → Backend übergibt `cuisine=German` an Spoonacular
- Datenmodell: `SearchOptions.germanOnly?: boolean`

#### [IMPORT-1] Spoonacular-native Rezepte ohne externe URL importieren
- Aktuell werden Rezepte mit `sourceUrl: spoonacular.com/*` (native) nicht importierbar
- Lösung: Neuen Scraper-Typ `spoonacular` anlegen, der die Spoonacular-API für Zutaten/Schritte nutzt
  - `GET https://api.spoonacular.com/recipes/{id}/information?apiKey={key}`
  - Kosten: 1 API-Punkt pro Abruf
- Kostet API-Punkte → nur bei explizitem Nutzer-Klick auslösen

#### [IMPORT-2] Import-Qualität verbessern (Duplicate Detection)
- Aktuell können identische Rezepte mehrfach importiert werden (keine URL-Deduplizierung)
- Lösung: Vor dem Scrapen prüfen ob `source_url` bereits in der DB existiert
- SQL: `SELECT id FROM recipes WHERE source_url = $1`
- Bei Treffer: Vorhandenes Rezept zurückgeben statt neu anlegen

#### [UX-1] Suchergebnis-Paginierung
- Aktuell: fix 12 Ergebnisse pro Suche
- Idee: „Weitere laden"-Button → `offset` Parameter an Backend
- Chefkoch-API unterstützt `offset`, Spoonacular ebenfalls

---

### 🟢 Niedrig / Nice-to-have

#### [SEARCH-5] TheMealDB (kostenlos, englischsprachig)
- **API:** [themealdb.com/api.php](https://www.themealdb.com/api.php) — komplett kostenlos
- **Problem:** Hauptsächlich englische Rezepte, keine deutschen Spezialitäten
- **Vorteil:** Kein API-Key, sofort nutzbar
- **Endpoint:** `https://www.themealdb.com/api/json/v1/1/search.php?s={query}`
- Sinnvoll als Fallback oder für internationale Küche

#### [NUTRITION-1] Nährwerte via fddb.info oder Spoonacular
- fddb.info API kann für Lebensmittel-Nährwerte genutzt werden (nicht für Rezeptsuche)
- Spoonacular gibt mit `addNutrition=true` vollständige Makros zurück (kostet extra Punkte)
- Idee: Nährwert-Karte im Rezept-Modal anzeigen (Kalorien, Protein, Kohlenhydrate, Fett)

#### [SOURCE-1] Chefkoch-Benutzerkonto-Sync (Favoritenliste)
- Chefkoch erlaubt Login, gespeicherte Rezepte könnten importiert werden
- Sehr komplex (Session-Cookies, kein OAuth) — niedrige Priorität

#### [SCRAPER-1] JSON-LD Schema.org als primäre Extraktionsstrategie
- Fast alle deutschen Rezeptseiten (Chefkoch, REWE, Lecker, EatSmarter) nutzen `Recipe`-Schema
- Aktueller Scraper macht das bereits — sicherstellen dass neue Quellen dasselbe Schema nutzen
- Mögliche neue Quellen die JSON-LD anbieten: Küchengötter, Brigitte, Essen & Trinken

---

## Umgebungsvariablen (vollständige Liste)

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL Connection String |
| `PORT` | ❌ | Lokaler Port (Standard: 3001) |
| `SPOONACULAR_API_KEY` | ❌ | Aktiviert Spoonacular-Suche. Key auf spoonacular.com/food-api/console |
| `EDAMAM_APP_ID` | ❌ | Geplant: Edamam App ID |
| `EDAMAM_APP_KEY` | ❌ | Geplant: Edamam App Key |

---

## Technische Schulden

| ID | Datei | Beschreibung |
|---|---|---|
| TD-1 | `backend/src/scrapers/chefkoch.ts` | Chefkoch-HTML-Scraper nutzt CSS-Klassen die sich ändern können — fragil |
| TD-2 | `backend/src/scrapers/rewe.ts` | REWE-Scraper funktioniert für Einzelrezepte nur wenn kein Bot-Block aktiv |
| TD-3 | `backend/src/services/suggestionEngine.ts` | KI-Empfehlungslogik rein regelbasiert — kein echtes ML |
| TD-4 | `frontend/src/pages/Sources.tsx` | `MetaSearch`-Komponente sollte in eigene Datei ausgelagert werden |
| TD-5 | allgemein | Keine automatisierten Tests vorhanden |
