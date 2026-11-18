# Coldtec Artikelstammdaten

Lokale Web-App zur Erfassung von Artikelstammdaten für den SAP-/Shop-Import. Sie erzeugt pro Artikel zwei CSV-Dateien (`…_FSP_Import.csv` und `…_CT_Import.csv`) im exakten SAP-Importformat (Windows-1252, CRLF, Semikolon) und schreibt sie direkt in den konfigurierten Ordner. Shop-Texte können über einen Anthropic Managed Agent automatisch erzeugt werden.

Ablauf: **1 Erfassen → 2 Prüfen → 3 Fertig**

## Einrichtung (einmalig)

1. **Node.js installieren** (Version 20 oder neuer), z.B. in PowerShell:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   Danach ein neues PowerShell-Fenster öffnen.
2. **Abhängigkeiten installieren** im Projektordner:
   ```powershell
   npm install
   ```
3. **Konfiguration anlegen:** `.env.example` nach `.env` kopieren und ausfüllen:
   ```powershell
   Copy-Item .env.example .env
   ```

   | Variable | Bedeutung |
   |---|---|
   | `ANTHROPIC_API_KEY` | API-Key für die Anthropic API |
   | `ANTHROPIC_AGENT_ID` | ID des Managed Agents, der die Texte schreibt |
   | `ANTHROPIC_ENVIRONMENT_ID` | ID der Agent-Umgebung |
   | `OUTPUT_DIR` | Zielordner für die CSV-Dateien, Standard `\\srv102\Datenaustausch\Artikelimport` |
   | `PORT` | Port der App (Standard 3000) |
   | `AGENT_TIMEOUT_MS` | Maximale Wartezeit auf den Agenten (Standard 180000 = 3 Minuten) |

   Die `.env` enthält Geheimnisse: nicht weitergeben, nicht einchecken (steht in `.gitignore`). Die Werte werden nur im Server verwendet, nie geloggt und nie an den Browser geschickt.

## Starten

```powershell
npm start
```

Dann im Browser öffnen: <http://localhost:3000>. Die App ist nur auf diesem PC erreichbar (bindet an 127.0.0.1).

## Bedienung

- **Erfassen:** Pflichtfelder EAN (optional), Artikelnummer, Bezeichnung, Artikelgruppe, Preis. „Texte automatisch generieren" startet den Agenten (neue Session pro Klick). Alle Texte bleiben editierbar und können auch komplett manuell eingetragen werden:
  - Keywords kommagetrennt
  - Kurzbeschrieb: ein Stichpunkt pro Zeile
  - Langbeschrieb: Absätze durch eine Leerzeile trennen
  - Verkaufstext: Einleitung, Überschrift, Merkmale (eins pro Zeile)
  - Erweiterte Felder (einklappbar) mit Standardwerten: ProdukttypShop `simple`, SichtbarkeitShop `4`, vonRMAausschliessen `N`, NichtaufToppreise `Y`.
- **Prüfen:** zeigt pro Datei jedes Feld mit dem exakten Exportwert, die Rohzeilen und den Quellenhinweis des Agenten (recherchiert oder generisch).
- **Fertig:** Dateinamen und Zielordner. Pro Minute ist ein Export möglich (Dateiname `YYYYMMDDHHmm`); bestehende Dateien werden nie überschrieben.
- **Artikelgruppen verwalten:** Zuordnung Artikelgruppe → Google-Kategorie-Code hinzufügen, ändern, löschen. Gespeichert in `data/mapping.json`.
- **Historie:** die letzten Exporte (gespeichert in `data/history.jsonl`, inkl. EAN).

## Exportformat

- Kodierung Windows-1252, Zeilenende CRLF, Trennzeichen `;`. Felder mit `;`, `"` oder Zeilenumbruch werden in `"` gesetzt, `"` verdoppelt.
- Zeichen, die in Windows-1252 nicht vorkommen (z.B. `≈`, `→`, Emojis), werden vor dem Schreiben gemeldet und müssen ersetzt werden.
- Die EAN wird **nicht** exportiert.
- Preis mit Dezimalpunkt ohne überflüssige Nullen (59.90 → `59.9`, 60.00 → `60`).

## Tests

```powershell
npm test
```

Prüft das Exportformat gegen echte Beispielzeilen (Header, Feldaufbau, Escaping, Kodierung, Preisformat).

## Hinweise zum Agenten

- Managed Agents ist ein Beta-Angebot von Anthropic. Abgerechnet werden Tokens plus Laufzeit der Session; die Session-Verläufe bleiben in der Anthropic Console gespeichert, bis sie gelöscht werden.
- Der Agent sollte Tools ohne Rückfrage ausführen dürfen (Berechtigung `always_allow`). Wartet er auf eine Freigabe, meldet die App das als Fehler.
- Fehler (ungültiger Key, falsche IDs, Rate-Limit, Zeitüberschreitung, ungültige JSON-Antwort) werden verständlich angezeigt. Die Texte können dann manuell eingetragen werden.

## Fehlerbehebung

| Meldung | Lösung |
|---|---|
| `npm` wird nicht erkannt | Node.js installieren, neues PowerShell-Fenster öffnen |
| Zielordner nicht erreichbar | Netzlaufwerk/VPN prüfen oder `OUTPUT_DIR` in `.env` anpassen, App neu starten |
| Agent nicht konfiguriert | Die drei `ANTHROPIC_*`-Werte in `.env` setzen, App neu starten |
| Port belegt | `PORT` in `.env` ändern |
