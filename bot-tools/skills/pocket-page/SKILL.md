---
name: pocket-page
description: Erstellt schön gestaltete Seiten (Tagesbriefing, News-Überblick, Bericht, Recherche, Plan, Dashboard) und sendet sie als antippbare Karte direkt in den Hermes-Pocket-Chat.
---
# Seiten & Briefings direkt in den Chat senden (Hermes Pocket)

Nutze diesen Skill, wenn der Nutzer ein **Briefing, Tagesbriefing, News-Überblick, Bericht,
Recherche-Ergebnis, Reiseplan, Vergleich, Wochenplan, Dashboard** oder allgemein eine
„Seite“ möchte – oder wenn deine Antwort für eine normale Chatnachricht zu lang und
strukturiert wäre.

## Ablauf

1. Inhalte recherchieren (z. B. `web_search`, Browser, eigene Dateien). Nur echte,
   überprüfte Informationen verwenden und Quellen-Links angeben. Nichts erfinden.
2. Inhalt als JSON-Datei speichern (empfohlen – wird automatisch im Hermes-Pocket-Design gestaltet):

```bash
cat > /tmp/briefing.json <<'JSON'
{
  "eyebrow": "Tagesbriefing",
  "title": "Dein Morgen-Briefing",
  "subtitle": "Die wichtigsten Themen des Tages in 3 Minuten",
  "intro": "Kurzer Einstieg in 1–3 Sätzen.",
  "highlights": ["Wichtigster Punkt", "Zweiter Punkt", "Dritter Punkt"],
  "sections": [
    {
      "icon": "🌍",
      "title": "Welt",
      "items": [
        {
          "title": "Schlagzeile",
          "text": "2–3 Sätze Zusammenfassung.",
          "url": "https://quelle.example/artikel",
          "source": "quelle.example",
          "image": "https://quelle.example/bild.jpg",
          "tag": "Neu"
        }
      ]
    },
    { "icon": "💶", "title": "Wirtschaft", "items": [] },
    { "icon": "🌦️", "title": "Wetter", "items": [] }
  ],
  "footer": "Quellen: siehe Links. Stand: heute früh."
}
JSON
```

   Alternativ: `--markdown datei.md` (Markdown mit `##`-Überschriften, Listen, Links,
   `![Bild](https://...)`) oder `--html datei.html` (eigenes, vollständig eigenständiges
   HTML mit Inline-CSS/-JS; keine externen Skripte, keine Formulare).

3. Veröffentlichen:

```bash
~/hermes-pocket/bin/publish-page --bot "<dein-profilname>" \
  --title "Dein Morgen-Briefing" \
  --summary "Welt, Wirtschaft & Wetter – die 3 wichtigsten Themen" \
  --json /tmp/briefing.json
```

4. Das Skript gibt genau eine Zeile aus, z. B.
   `[POCKET_PAGE: dein-morgen-briefing-20261126-a1b2c3 | Dein Morgen-Briefing | Welt, Wirtschaft & Wetter …]`.
   **Setze diese Zeile unverändert ans Ende deiner Chat-Antwort.** Hermes Pocket zeigt
   daraus automatisch eine antippbare Vorschaukarte, die die Seite im Vollbild öffnet.
   Schreibe davor 1–2 kurze Sätze (z. B. was drinsteht).

## Routinen / geplante Briefings

Bei geplanten Aufgaben (z. B. jeden Morgen ein Briefing) zusätzlich `--notify` anhängen,
damit eine iPhone-Push-Benachrichtigung kommt. Die `[POCKET_PAGE: …]`-Zeile trotzdem in
die Antwort schreiben.

## Regeln

- Niemals Passwörter, Tokens, Kartendaten oder andere Geheimnisse in Seiten schreiben.
- Bilder nur als direkte `https://`-Bild-URLs aus seriösen Quellen.
- Mobil denken: kurze Absätze, klare Überschriften, wichtigste Infos zuerst.
- Die Seite ist privat: Sie wird nur in Hermes Pocket nach Anmeldung angezeigt.
