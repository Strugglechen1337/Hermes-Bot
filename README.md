# Hermes Pocket

Private, mobile-first Oberfläche für einen selbst betriebenen Hermes Agent.

## Ziel

Benannte Bots, Einzel- und Gruppenchats, Routinen und E-Mail-Zugänge in einer auf dem iPhone gut bedienbaren Oberfläche. Die bestehende Hermes-Installation bleibt die Quelle für Bots und Daten.

## Architektur und Sicherheitsziele

- Zugriff über das bestehende private Tailscale-Netz und HTTPS.
- Authentifizierung und Berechtigungen des Hermes-Gateways beibehalten; keine Zugangsdaten in Browser-Code, Git oder Logs speichern.
- Hermes-Gateway als Quelle für Profile, Chats, Gruppen und Routinen verwenden. Keine parallele Agentenlaufzeit anlegen.
- E-Mail-Zugriff nur über ausdrücklich eingerichtete Integrationen. Importierte Routinen bleiben pausiert, bis Verbindung und Zustellung geprüft sind.
- Die Oberfläche orientiert sich an Grok Bot, verwendet aber eine eigene Gestaltung und keine kopierten App-Ressourcen.

## Status

Projektinitialisierung. Funktion und Hosting sind noch nicht implementiert.
