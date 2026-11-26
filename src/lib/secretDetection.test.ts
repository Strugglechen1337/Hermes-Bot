import { describe, expect, it } from "vitest";
import { detectBotSecretRequest, stripSecretRequestTag } from "./secretDetection";

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

  it("detects natural German bot requests and extracts explicit or inferred env var names", () => {
    const explicitVar = detectBotSecretRequest(
      "Bitte hinterlege noch den Wert für `PIHOLE_API_KEY`, damit ich Pi-hole abfragen kann."
    );
    expect(explicitVar?.keyName).toBe("PIHOLE_API_KEY");

    const inferred = detectBotSecretRequest(
      "Ich brauche noch deinen Home Assistant Long-Lived Access Token, bitte gib ihn ein."
    );
    expect(inferred?.keyName).toBe("HOME_ASSISTANT_TOKEN");
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
