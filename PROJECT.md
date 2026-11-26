# Gemeinsamer Projektstand

## Gewünschtes Ergebnis

Eine auf dem iPhone gut bedienbare private Web-App für Hermes: Bot-Liste, Einzel- und Gruppenchats, Routinen und E-Mails. Visuelle Orientierung: die einfache, dunkle Grok-Bot-Oberfläche; eigene Umsetzung und eigene Ressourcen.

## Vorhandene Infrastruktur

- Ein bestehender Hermes-Server ist über ein privates Tailscale-Netz erreichbar; die Hermes-Weboberfläche nutzt HTTPS und eine bestehende Anmeldung.
- Mika existiert als Hermes-Profil. Ihre Rolle und exportierten Erinnerungen wurden importiert. Die importierte Mail-Routine ist pausiert. E-Mail-Zugang und Zustellung sind noch nicht verifiziert.
- Die konkrete Serveradresse und bestehende Zugangsdaten gehören in lokale, nicht versionierte Konfiguration. Keine Secrets im Repository oder in Issues dokumentieren.
- Die Schnittstelle des vorhandenen Hermes-Gateways und seine Version sind vor der Implementierung anhand der offiziellen Dokumentation und der lokalen Installation zu prüfen. Die bestehende Authentifizierung und Isolation dürfen nicht umgangen werden.

## Offene Arbeit

1. Schnittstellen und Authentifizierung für Profile, Chat, Gruppen, Routinen und E-Mail prüfen und mit dem bestehenden Server abgleichen.
2. Mobiles Design und bedienbare Anwendung umsetzen. Fehler- und Leerzustände deutlich darstellen.
3. Sicheres privates Hosting und iPhone-Zugriff integrieren; vorhandene Dienste unangetastet lassen.
4. Mit echten Profilen testen, ohne Nachrichten oder automatisierte Aktionen unbeabsichtigt auszulösen. E-Mail-Anbindung und Routinen gesondert verifizieren.

## Zusammenarbeit

Je Aufgabe eigenen Branch und nach Möglichkeit eigenen Git-Worktree nutzen. Vor der Übergabe Änderungen committen oder den uncommitteten Zustand klar mitteilen. Keine Branches anderer Personen zurücksetzen, keine unaufgeforderten Pushes oder Veröffentlichungen. Bei Entscheidungen oder Änderungen an der Infrastruktur das Ergebnis hier aktualisieren.
