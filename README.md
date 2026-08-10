# J.A.R.V.I.S. Mobile PWA – Phase 2

Neu:
- Mikrofonbutton
- Browser nimmt Audio als WebM/Opus auf
- Audio geht an eine authentifizierte Supabase Edge Function
- Edge Function sendet Audio mit serverseitig gespeichertem OPENAI_API_KEY an OpenAI
- `gpt-4o-mini-transcribe`, Sprache `de`
- Transkript wird automatisch an den mobilen JARVIS-Router übergeben
- Browser-Sprachausgabe für JARVIS-Antworten

## Sicherheit

Der OpenAI API-Key kommt NICHT in `config.js` und NICHT in die PWA.
Er wird nur als Supabase Edge-Function-Secret gespeichert.

`config.js` enthält weiterhin ausschließlich:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY

## 1. Deine bestehende config.js übernehmen

Wenn Phase 1 bereits funktioniert, kopiere die beiden Werte in die neue `config.js`.

## 2. OPENAI_API_KEY als Supabase Secret setzen

Im Supabase Dashboard:
Edge Functions / Secrets bzw. Project Settings / Edge Functions / Secrets
(je nach aktueller Dashboard-Navigation)

Secret anlegen:

    OPENAI_API_KEY = dein aktueller OpenAI API-Key

Den Key nicht in ChatGPT posten.

## 3. Edge Function deployen

Variante A – Supabase Dashboard:
- Edge Functions öffnen
- neue Function `jarvis-stt`
- Inhalt aus `supabase/functions/jarvis-stt/index.ts` verwenden
- JWT/Auth-Prüfung aktiviert lassen
- deployen

Variante B – Supabase CLI:
- Projekt verlinken
- dann:

    supabase functions deploy jarvis-stt

Die Funktion verlangt einen eingeloggten Supabase-User. Die PWA ruft sie über
`supabase.functions.invoke()` auf; die Session wird dabei verwendet.

## 4. PWA testen

Am PC funktioniert Mikrofonzugriff über:

    http://localhost:8080

Für ein echtes Handy über eine normale LAN-IP ist Mikrofonzugriff über HTTP
in Browsern typischerweise gesperrt. Für das Handy hosten wir die PWA im nächsten
Schritt über HTTPS.

## 5. Bedienung

Mikrofon einmal antippen:
- Aufnahme startet
- Button wird rot und zeigt ■

Noch einmal tippen:
- Aufnahme stoppt
- Audio wird transkribiert
- erkannter Text läuft automatisch durch den mobilen Router

Beispiele:
- "Wann kommt die blaue Tonne?"
- "Was weißt du über Stefan?"
- "Merke dir, dass Stefan der beste Rocket-League-Spieler aller Zeiten ist."

## Hinweis zu Erinnerungen

Die PWA kann Cloud-Erinnerungen anlegen und anzeigen.
Echte Hintergrund-Push-Benachrichtigungen bei komplett geschlossener PWA sind
noch nicht Teil von Phase 2. Dafür benötigen wir später Web Push / einen
serverseitigen Scheduler.


## Phase 2 Fix – Chrome Extension Cache

`sw.js` ignoriert jetzt `chrome-extension://` und andere Nicht-HTTP(S)-Requests.
Damit verschwindet der Fehler:

    Failed to execute 'put' on 'Cache': Request scheme 'chrome-extension' is unsupported

Außerdem schreibt die PWA die vollständige Antwort der Edge Function in die
Browser-Konsole als:

    [JARVIS STT] response: ...

Wenn weiterhin "Leere Transkription" erscheint, bitte genau diesen Konsolen-Eintrag
und den entsprechenden Supabase Edge-Function-Log prüfen.


## Mikrofon-Fix

Die PWA zeigt jetzt alle verfügbaren Eingabegeräte an und bevorzugt auf dem
Windows-PC automatisch ein Gerät mit "W8GS" im Namen, falls vorhanden.

Während der Aufnahme gibt es einen Live-Pegel:
- Beim Sprechen muss `MIC xx%` sichtbar ansteigen.
- Bleibt er bei 0 %, ist das falsche Mikrofon ausgewählt oder Chrome bekommt kein Signal.

In F12 → Console werden zusätzlich ausgegeben:
- `[JARVIS MIC] track:` ausgewähltes Gerät
- `[JARVIS MIC] recording:` Aufnahmedauer, Dateigröße, MIME-Typ und Chunk-Anzahl

Damit lässt sich sofort unterscheiden, ob das Problem vor oder nach OpenAI liegt.


## Wetter-Router

Die mobile PWA versteht jetzt zusätzlich:
- "Wie wird das Wetter heute?"
- "Wie ist das Wetter heute?"
- "Wie wird das Wetter morgen?"
- "Wie ist das Wetter morgen?"

Standardort ist Viersen, passend zum Windows-JARVIS.
Die Daten kommen direkt von Open-Meteo. Dafür ist kein zusätzlicher API-Key nötig.


## Phase 3 – App-Look & Installation

Neu:
- JARVIS App-Icon (192/512, Apple Touch Icon, Maskable Icon)
- eigener Start-/Splashscreen
- Installationsbutton mit Android-PWA-Prompt
- iOS-Hinweis für „Zum Home-Bildschirm“
- Standalone/Homescreen-Modus
- Safe-Area-Optimierung und größere mobile Touch-Flächen

### GitHub Pages aktualisieren

Lade den kompletten Inhalt dieses Ordners ins Root des Repositories `jarvis-mobile` und ersetze die vorhandenen Dateien.
Wichtig: deine funktionierende `config.js` entweder vorher sichern oder in dieser Version wieder mit Project URL und Publishable Key ausfüllen.

Nach dem Upload auf dem Handy die Seite einmal neu laden. Falls noch die alte Version erscheint, Browsercache für die Seite löschen oder die installierte PWA einmal schließen und neu öffnen.


## Phase 3.1 – Installationsbutton korrigiert

Der Button `APP INSTALLIEREN` wird jetzt ausschließlich angezeigt, wenn der
Browser das native PWA-Ereignis `beforeinstallprompt` geliefert hat.

Damit kann nicht mehr der Fall auftreten, dass der Button nur einen Hinweis
mit `VERSTANDEN` öffnet, obwohl gar keine native Installation verfügbar ist.

### Nach dem GitHub-Upload

1. Alle Dateien aus diesem Paket ins Repository übernehmen.
2. Die bestehende `config.js` mit deinen eigenen Supabase-Werten beibehalten.
3. GitHub Pages den neuen Commit deployen lassen.
4. Auf Android Chrome die Seite neu öffnen.
5. Wenn nötig: Chrome → Website-Einstellungen → Daten löschen bzw. die Seite
   vollständig neu laden, damit der alte Service Worker verschwindet.
6. Sobald Chrome die PWA als installierbar erkennt, erscheint
   `APP INSTALLIEREN`. Dieser Button öffnet dann den echten Android/Chrome-
   Installationsdialog.

Wenn der Button nicht erscheint, prüfe zusätzlich Chrome-Menü →
`App installieren` oder `Zum Startbildschirm hinzufügen`.
