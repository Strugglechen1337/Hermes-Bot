import { describe, expect, it } from "vitest";
import {
  detectBotSecretForm,
  detectBotSecretRequest,
  detectBotVaultRequest,
  extractPocketPages,
  extractProductDeals,
  isPlaintextFormFieldKey,
  stripSecretRequestTag,
} from "./secretDetection";

describe("secretDetection", () => {
  it("detects explicit [SECRET_REQUEST: KEY | Prompt] tags", () => {
    const res = detectBotSecretRequest(
      "Ich verbinde mich gern. [SECRET_REQUEST: HOME_ASSISTANT_TOKEN | Home Assistant Long-Lived Token]"
    );
    expect(res).toEqual({
      keyName: "HOME_ASSISTANT_TOKEN",
      prompt: "Home Assistant Long-Lived Token",
      explicit: true,
    });
    expect(
      stripSecretRequestTag(
        "Ich verbinde mich gern. [SECRET_REQUEST: HOME_ASSISTANT_TOKEN | Prompt]"
      )
    ).toBe("Ich verbinde mich gern.");
  });

  it("detects multi-field [SECRET_FORM] + [SECRET_REQUEST] bundles and strips all tags", () => {
    const raw = [
      "Ich habe das günstigste Angebot gefunden. Bitte gib kurz deine Shop-Daten im gesicherten Formular ein:",
      "[SECRET_FORM: Shop-Zugangsdaten]",
      "[SECRET_REQUEST: SHOP_EMAIL | E-Mail-Adresse]",
      "[SECRET_REQUEST: SHOP_PASSWORD | Shop-Passwort]",
      "[SECRET_REQUEST: SHIPPING_ADDRESS | Lieferadresse]",
    ].join("\n");

    const form = detectBotSecretForm(raw);
    expect(form).not.toBeNull();
    expect(form?.title).toBe("Shop-Zugangsdaten");
    expect(form?.explicit).toBe(true);
    expect(form?.fields.map((f) => f.keyName)).toEqual([
      "SHOP_EMAIL",
      "SHOP_PASSWORD",
      "SHIPPING_ADDRESS",
    ]);
    expect(stripSecretRequestTag(raw)).toBe(
      "Ich habe das günstigste Angebot gefunden. Bitte gib kurz deine Shop-Daten im gesicherten Formular ein:"
    );
  });

  it("classifies sensitive vs plaintext form keys safely", () => {
    expect(isPlaintextFormFieldKey("SHOP_EMAIL")).toBe(true);
    expect(isPlaintextFormFieldKey("SHIPPING_ADDRESS")).toBe(true);
    expect(isPlaintextFormFieldKey("SHOP_PASSWORD")).toBe(false);
    expect(isPlaintextFormFieldKey("HASS_TOKEN")).toBe(false);
    expect(isPlaintextFormFieldKey("CARD_CVV")).toBe(false);
    expect(isPlaintextFormFieldKey("PAYMENT_IBAN")).toBe(false);
  });

  it("detects explicit and natural [VAULT_REQUEST] cards for payment, address, and login", () => {
    const explicit = detectBotVaultRequest(
      "Bitte hinterlege deine Karte sicher: [VAULT_REQUEST: payment | Kreditkarte für MediaMarkt]"
    );
    expect(explicit).toEqual({
      kind: "payment",
      prompt: "Kreditkarte für MediaMarkt",
      origin: undefined,
      explicit: true,
    });

    const login = detectBotVaultRequest(
      "[VAULT_REQUEST: login | MediaMarkt Konto | https://www.mediamarkt.de]"
    );
    expect(login?.kind).toBe("login");
    expect(login?.origin).toBe("https://www.mediamarkt.de");

    const natural = detectBotVaultRequest(
      "Die Bestellung steht fertig an der Kasse. Zum Bezahlen fehlt mir noch eine Karte – trag sie bitte ins sichere Formular ein."
    );
    expect(natural?.kind).toBe("payment");
    expect(natural?.explicit).toBe(false);
  });

  it("extracts [DEAL_CARD] entries (including optional image URL) and strips them from prose", () => {
    const raw =
      "Hier ist der aktuelle Bestpreis:\n" +
      "[DEAL_CARD: BeispielShop DE | PS5 Spiel (Disc) | 24,99 € | 65,00 € | https://example.com/product]\n" +
      "[DEAL_CARD: OTTO | Beispiel-Artikel | 14,99 € | 20,00 € | https://otto.example/p | https://cdn.example/p.jpg]";
    const deals = extractProductDeals(raw);
    expect(deals).toEqual([
      {
        shop: "BeispielShop DE",
        title: "PS5 Spiel (Disc)",
        price: "24,99 €",
        oldPrice: "65,00 €",
        url: "https://example.com/product",
      },
      {
        shop: "OTTO",
        title: "Beispiel-Artikel",
        price: "14,99 €",
        oldPrice: "20,00 €",
        url: "https://otto.example/p",
        imageUrl: "https://cdn.example/p.jpg",
      },
    ]);
    expect(stripSecretRequestTag(raw)).toBe("Hier ist der aktuelle Bestpreis:");
  });

  it("extracts [POCKET_PAGE] briefing cards and strips the directive from prose", () => {
    const raw =
      "Dein Tagesbriefing ist fertig!\n[POCKET_PAGE: tagesbriefing-20261126-a1b2c3 | Dein Tagesbriefing | Welt, Wirtschaft & Wetter in 3 Minuten]";
    expect(extractPocketPages(raw)).toEqual([
      {
        id: "tagesbriefing-20261126-a1b2c3",
        title: "Dein Tagesbriefing",
        summary: "Welt, Wirtschaft & Wetter in 3 Minuten",
      },
    ]);
    expect(stripSecretRequestTag(raw)).toBe("Dein Tagesbriefing ist fertig!");
  });

  it("detects natural German bot requests and extracts explicit or inferred env var names", () => {
    const explicitVar = detectBotSecretRequest(
      "Bitte hinterlege noch den Wert für `PIHOLE_API_KEY`, damit ich Pi-hole abfragen kann."
    );
    expect(explicitVar?.keyName).toBe("PIHOLE_API_KEY");

    const inferred = detectBotSecretRequest(
      "Ich brauche noch deinen Home Assistant Long-Lived Access Token, bitte gib ihn ein."
    );
    expect(inferred?.keyName).toBe("HASS_TOKEN");

    const securityAware = detectBotSecretRequest(
      "Gern – bitte nicht hier im Chat senden. Hinterlege das Token stattdessen lokal."
    );
    expect(securityAware?.keyName).toBe("SERVICE_API_TOKEN");
  });

  it("does not trigger on security refusals or past confirmations", () => {
    expect(
      detectBotSecretRequest(
        "Einen API-Schlüssel würde ich nicht ungeprüft über einen normalen Chat verschicken."
      )
    ).toBeNull();
    expect(
      detectBotSecretRequest("Dein Token wurde erfolgreich gespeichert.")
    ).toBeNull();
  });
});
