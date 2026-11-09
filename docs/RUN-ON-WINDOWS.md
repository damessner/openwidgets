# Testbetrieb auf einem Windows-Laptop

Ziel: OpenWidgets in 2 Minuten auf diesem Rechner ausprobieren – erst allein als Lehrkraft,
dann mit 2–3 Geräten im selben WLAN. **Nicht** für echte Schularbeiten oder echte
Schülerdaten gedacht (siehe „Grenzen" unten).

## Voraussetzungen

- Windows 10/11.
- Node.js ≥ 22.5. Das Startskript findet Node automatisch (`PATH`, `Program Files\nodejs`,
  der mit dem DSH ausgelieferte Node). Falls nicht vorhanden: LTS von <https://nodejs.org>
  installieren.
- Kein `npm install` nötig – OpenWidgets hat **keine** Laufzeit-Abhängigkeiten.

## Starten

1. **`start-openwidgets.bat` doppelklicken.**
2. Beim **ersten Start** fragt das Fenster nach einem Admin-Konto:
   - E-Mail (Default `admin@schule.local`), Anzeigename, Passwort (mind. 10 Zeichen).
   - Das Passwort wird beim Eintippen sichtbar angezeigt (Konsolenfenster) – ein
     Wegwerf-Testpasswort verwenden.
3. Der Browser öffnet automatisch <http://localhost:3000/login> → anmelden.
4. Optional Demo-Inhalte: in einem **zweiten** Fenster `seed-demo.bat` starten, Admin-E-Mail
   und -Passwort eingeben. Es entstehen ein Demo-Arbeitsblatt (alle Aufgabentypen) und ein
   Demo-Quiz, jeweils mit Beitrittscode.
5. Für Schüler:innen: Die Adresse aus dem Startfenster verwenden, z. B.
   `http://192.168.178.25:3000/` – Aufgabe über den Code der Lehrkraft öffnen.

Das Startfenster zeigt alle Adressen, das Datenverzeichnis und wie man beendet.

## Beenden

- Fenster schließen oder `Strg+C` im Startfenster.
- Der Server läuft nur, solange das Fenster offen ist. Es gibt keinen Hintergrunddienst.

## Wo liegen die Daten?

- `%LOCALAPPDATA%\OpenWidgets\data` (Datenbank + Uploads).
- Bewusst **nicht** im OneDrive-/Projektordner: SQLite und OneDrive-Sync vertragen sich
  nicht zuverlässig (Locking/Dateikonflikte).
- **Reset:** Server beenden, Ordner `%LOCALAPPDATA%\OpenWidgets\data` umbenennen oder
  löschen → beim nächsten Start kommt der Erststart-Dialog wieder.
- **Backup:** Ordner einfach kopieren, oder (bei laufendem Server)
  `npm run backup -- --out <Zielordner>`.

## Netzwerk & Firewall

- Beim ersten Start fragt die **Windows-Firewall**: „Zugriff zulassen" für **private
  Netzwerke** wählen. Sonst erreichen nur Geräte auf demselben Rechner die Instanz.
- Die Laptop-IP wird im Startfenster angezeigt (DHCP: kann sich ändern).
- Viele **Schul-WLANs isolieren Geräte** (Client Isolation) – dann erreichen iPads/
  Chromebooks den Laptop nicht. Zum Testen: privates WLAN, Handy-Hotspot oder LAN-Kabel.
- Energiesparmodus deaktivieren bzw. Laptop am Strom lassen, sonst bricht die Verbindung
  im Unterricht ab.

## Grenzen dieses Testaufbaus (bewusst)

| Punkt | Konsequenz |
| --- | --- |
| Kein HTTPS | Daten laufen unverschlüsselt durchs WLAN. **Nur Testdaten**, keine echten Namen/Noten. |
| Kein Dauerbetrieb | Kein systemd/Caddy, kein automatischer Neustart, keine automatischen Backups. |
| Admin-Passwort im Klartext beim Erststart | Wegwerf-Passwort verwenden; später ändern (Admin-Bereich oder CLI). |
| Ein Gerät, eine Datenbank | Für 1–3 parallele Tester:innen völlig ausreichend (SQLite/SSE). |
| Laptop schläft / WLAN wechselt | Verbindung bricht ab; Aufgaben-Autosave fängt das ab, aber live-Dashboard hängt. |

## Wann auf den Proxmox-Server wechseln?

Sobald mehr als eine Handvoll Geräte gleichzeitig arbeiten, Schüler:innen selbstständig über
mehrere Stunden arbeiten, oder die Instanz dauerhaft (mit TLS und Backups) laufen soll:
→ [`DEPLOY-LXC.md`](DEPLOY-LXC.md) (unprivilegierter LXC, Caddy/TLS, Backup/Retention).
Der Laptop ist zum **Ausprobieren und für den Lehrkräfte-Workflow**; der LXC trägt den
echten (Pilot-)Betrieb.

## Troubleshooting

| Problem | Lösung |
| --- | --- |
| Fenster öffnet sich und schließt sofort | In `cmd` starten (`cd` in den Projektordner, `start-openwidgets.bat`), um die Fehlermeldung zu sehen. |
| „Node.js wurde nicht gefunden" | Node.js LTS installieren, danach Skript erneut starten. |
| „EADDRINUSE" / Port belegt | Anderen Port wählen: `set PORT=3001` vor dem Start, oder das Skript mit gesetztem `PORT` starten. |
| Schüler:innen kommen nicht rein | Firewall (privat), gleiche WLAN, Client Isolation, richtige IP. |
| Passwort vergessen | Datenordner löschen (Testdaten!) oder `node scripts/create-admin.mjs --email … --password …` mit gesetztem `DATA_DIR`. |

## Manuelle Start-Optionen (für Fortgeschrittene)

```bat
REM nur prüfen (Node, Port, Datenverzeichnis):
start-openwidgets.bat --check

REM ohne Browser-Start:
start-openwidgets.bat --no-browser

REM anderer Port / anderes Datenverzeichnis:
set PORT=3001
set OW_DATA_DIR=D:\OpenWidgets\data
start-openwidgets.bat --no-browser
```
