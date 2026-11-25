# GPSLogger für Gladys Assistant

Diese Integration macht Android-Handys mit der freien Open-Source-App
[GPSLogger](https://gpslogger.app) zu GPS-Trackern in Gladys: Position,
Entfernung von zu Hause, Anwesenheit, Akku, Geschwindigkeit. Anschließend
können Sie in Ihren Szenen auf Ankunft und Abfahrt reagieren und jedes Handy
im Dashboard verfolgen.

## Funktionsweise

GPSLogger ruft bei jeder aufgezeichneten Position eine URL auf. Gladys bietet
zwei URLs an:

| URL                         | Wann verwenden                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| **Lokal** (`http://…/log`)  | Das Handy erreicht Gladys im Heimnetz (WLAN) oder über ein VPN. Nichts verlässt Ihr Zuhause. |
| **Cloud** (Gladys-Plus-URL) | Das Handy sendet von überall (4G/5G). Erfordert ein Gladys-Plus-Abonnement.                  |

Sie können eine davon einrichten oder beide in zwei GPSLogger-Profilen. Jedes
Handy erscheint nach seiner ersten Position als Tracker im Reiter **Erkennung**
der Integration: Klicken Sie auf **Hinzufügen**, um sein Gerät anzulegen.

## 1. Die Integration einrichten

Öffnen Sie in Gladys **Integrationen → GPSLogger → Konfiguration**:

- **Lokalen Empfänger aktivieren** (standardmäßig an): Gladys öffnet einen
  HTTP-Port in Ihrem Netzwerk für GPSLogger. Die genaue lokale URL steht im
  Block „Lokale URL“ der Seite (`http://<Gladys-Adresse>:<Port>/log`).
- **Zugriffstoken** (optional, empfohlen): eine lange Zufallszeichenfolge.
  Jede Anfrage muss dann `token=<Wert>` oder den Header
  `Authorization: Bearer <Wert>` enthalten.
- **Radius um das Zuhause**: wie nah ein Handy am Standort des Hauses sein
  muss, um als zu Hause zu gelten (standardmäßig 150 m). Der Standort ist der
  in Gladys festgelegte (**Einstellungen → Häuser**): Gladys fragt bei der
  Installation nach dem Zugriff darauf. Ohne Standort bleiben Entfernung und
  Anwesenheit leer.
- **Schwelle für niedrigen Akku** und **Tracker verloren nach**: werden von
  den Szenen-Auslösern unten verwendet.

Für die Cloud-URL fügen Sie Ihren **Gladys Plus Open-API-Schlüssel** im Block
„Gladys Plus Webhooks“ ein. Klicken Sie dann auf **GPSLogger-URLs anzeigen**:
lokale URL, Cloud-URL und die zu sendenden Parameter werden angezeigt.

## 2. GPSLogger auf dem Handy einrichten

1. Installieren Sie GPSLogger (F-Droid, GitHub oder Google Play).
2. Öffnen Sie **Logging details → Log to custom URL** und aktivieren Sie es.
3. **URL**: die von Gladys angezeigte lokale oder Cloud-URL.
4. **HTTP method**: `POST`. **HTTP body**:

   ```
   device=%DEVNAME&lat=%LAT&lon=%LON&acc=%ACC&alt=%ALT&spd=%SPD&dir=%DIR&batt=%BATT&ischarging=%ISCHARGING&time=%TIME&prov=%PROV
   ```

   Fügen Sie `&token=IHR_TOKEN` hinzu, wenn Sie ein Zugriffstoken festgelegt
   haben. Mit der Methode `GET` hängen Sie dieselben Parameter nach einem `?`
   an die URL an.

5. **HTTP headers**: `Content-Type: application/x-www-form-urlencoded`.
6. Geben Sie jedem Handy einen eigenen **Gerätenamen** (**General options →
   Device name**): Es ist der Name des Trackers in Gladys und seine Kennung.
   Eine spätere Änderung legt einen neuen Tracker an.
7. Wählen Sie das Aufzeichnungsintervall (**Performance**): alle 1 bis 5
   Minuten ist ein guter Kompromiss mit dem Akku.

Ein bereits für die Home-Assistant-Integration GPSLogger eingerichtetes Handy
(`latitude=…&longitude=…&device=…`) funktioniert unverändert: Beide
Parameterstile werden akzeptiert.

Mit der Schaltfläche **Testposition senden** auf der Konfigurationsseite
können Sie alles ohne Handy prüfen.

## 3. Die Geräte

Jeder Tracker stellt diese Funktionen bereit (nur lesend):

| Funktion                | Einheit | Hinweis                                                |
| ----------------------- | ------- | ------------------------------------------------------ |
| Position                | Text    | „Breitengrad, Längengrad“                              |
| Breiten-/Längengrad     | Grad    |                                                        |
| Zu Hause                | 0/1     | innerhalb des Radius (mit 25 % Austrittsspanne)        |
| Entfernung von zu Hause | km      |                                                        |
| Genauigkeit             | m       | eine Position ungenauer als 1 km ändert „Zu Hause“ nie |
| Höhe                    | m       |                                                        |
| Geschwindigkeit         | km/h    | GPSLogger sendet m/s, umgerechnet                      |
| Richtung                | Grad    |                                                        |
| Akku                    | %       |                                                        |
| Lädt                    | 0/1     |                                                        |

Das Abzeichen jedes Geräts zeigt, wie seine letzte Position ankam: **lokal**,
**Cloud** oder **nicht erreichbar**, sobald der Tracker verloren ist. Die
Option „Lokale Verbindung bevorzugen“ der Konfigurationsseite hat keine
Wirkung: Das Handy entscheidet, welche URL es aufruft.

## 4. Szenen

Auslöser (Kategorie **Integrationen** des Szenen-Editors), jeweils mit einem
optionalen Tracker-Filter:

| Auslöser            | Wann                                                     | Variablen                                                             |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Position empfangen  | bei jeder Position                                       | Name, Breite, Länge, Genauigkeit, Tempo, Akku, Entfernung, Kartenlink |
| Zu Hause angekommen | der Tracker betritt den Radius um das Zuhause            | Name, Breite, Länge                                                   |
| Zuhause verlassen   | der Tracker verlässt den Radius                          | Name, Breite, Länge, Entfernung                                       |
| Handy-Akku schwach  | der Akku fällt unter die Schwelle (einmal pro Entladung) | Name, Akku                                                            |
| Tracker verloren    | keine Position seit der eingestellten Dauer (einmal)     | Name, Minuten seit der letzten Position                               |

Aktionen:

- **Position eines Trackers abrufen**: letzte Position, Akku, Entfernung von
  zu Hause, Anwesenheit, Minuten seit der Aktualisierung und ein
  OpenStreetMap-Link.
- **Entfernung zwischen zwei Trackern**: in km und m.
- **Entfernung zu einem Ort**: Entfernung zwischen einem Tracker und
  Koordinaten, und ob er innerhalb eines Radius liegt.

Alle drei liefern `found: false`, wenn eine Position unbekannt ist: Prüfen Sie
dies mit einer Bedingung in Ihrer Szene.

Beispiel: _bei „Zu Hause angekommen“ für Alices Handy die Alarmanlage
entschärfen, falls sie scharf ist, und „Willkommen zu Hause,
{{triggerEvent.data.device_name}}“ senden_.

## 5. Dashboard-Widgets

- **GPS-Tracker**: alle Handys auf einen Blick (zu Hause oder unterwegs,
  Entfernung, Akku, letzte Meldung); ein Tippen zeigt Details und einen
  OpenStreetMap-Link.
- **GPS-Tracker** (einzeln): ein Handy im Detail, mit Live-Kacheln
  (Entfernung, Akku, Tempo), seinem Status und einer Karten-Schaltfläche.
  Wählen Sie das Handy in den Widget-Einstellungen.

## Datenschutz und Sicherheit

- Positionen werden nur in Ihrem Gladys gespeichert (die Gerätezustände und
  `trackers.json` im Datenordner der Integration für die letzte Position).
- Der lokale Empfänger nimmt nur Positionen an; die Integration prüft sie
  (Token, Koordinaten). Legen Sie ein Zugriffstoken fest, wenn Ihr Netzwerk
  geteilt ist.
- Über Gladys Plus ist die URL selbst ein Geheimnis: Geben Sie sie nicht
  weiter. Das Zugriffstoken fügt eine zweite Prüfung hinzu.
- **Tracker vergessen** entfernt ein Handy aus der Integration (löschen Sie
  auch sein Gerät in Gladys).

## Fehlerbehebung

- **Kein Tracker in Erkennung**: Prüfen Sie das GPSLogger-Protokoll (der
  Bereich custom URL zeigt die HTTP-Antwort). `401`: Token fehlt oder ist
  falsch. `400`: Gerätename oder Koordinaten fehlen.
- **Lokale URL nicht erreichbar**: Das Handy muss im selben Netzwerk wie
  Gladys sein (oder im VPN), und „Lokalen Empfänger aktivieren“ muss an sein.
- **Cloud-URL fehlt**: Verknüpfen Sie Gladys Plus im Block „Gladys Plus
  Webhooks“ und klicken Sie erneut auf **GPSLogger-URLs anzeigen**.
- **„Zu Hause“ bleibt leer**: Legen Sie den Standort Ihres Hauses in Gladys
  fest.
