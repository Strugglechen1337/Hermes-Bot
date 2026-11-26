import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CreditCard,
  Globe,
  KeyRound,
  Lock,
  MapPin,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { HermesProfile } from "../../shared/types";
import type { WsConnectionState } from "../lib/hermesWs";
import {
  addVaultItem,
  addVaultItemToProfiles,
  buildSafeCardLabel,
  listVaultItems,
  removeVaultItem,
  type VaultAddPayload,
  type VaultItemKind,
  type VaultItemMeta,
} from "../lib/vaultClient";
import { Sheet } from "./Sheet";

interface CredentialVaultSheetProps {
  open: boolean;
  wsState: WsConnectionState;
  publicProfiles: HermesProfile[];
  onClose: () => void;
}

export const CredentialVaultSheet: React.FC<CredentialVaultSheetProps> = ({
  open,
  wsState,
  publicProfiles,
  onClose,
}) => {
  const [items, setItems] = useState<VaultItemMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [addingKind, setAddingKind] = useState<VaultItemKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncAllBots, setSyncAllBots] = useState(true);

  // Payment fields
  const [cardLabel, setCardLabel] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [billingZip, setBillingZip] = useState("");

  // Address fields
  const [addrLabel, setAddrLabel] = useState("Zuhause");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrCountry, setAddrCountry] = useState("Deutschland");

  // Login fields
  const [loginLabel, setLoginLabel] = useState("");
  const [loginOrigin, setLoginOrigin] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const loadItems = useCallback(async () => {
    if (wsState !== "connected") return;
    setLoading(true);
    setError(null);
    try {
      const list = await listVaultItems("default");
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tresor konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [wsState]);

  useEffect(() => {
    if (open) {
      setFeedback(null);
      setAddingKind(null);
      void loadItems();
    }
  }, [open, loadItems]);

  function resetForms() {
    setCardLabel("");
    setCardHolder("");
    setCardNumber("");
    setExpMonth("");
    setExpYear("");
    setCvc("");
    setBillingZip("");
    setAddrLabel("Zuhause");
    setAddrLine1("");
    setAddrLine2("");
    setAddrZip("");
    setAddrCity("");
    setAddrCountry("Deutschland");
    setLoginLabel("");
    setLoginOrigin("");
    setLoginIdentifier("");
    setLoginPassword("");
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!addingKind) return;
    setError(null);
    setFeedback(null);

    let payload: VaultAddPayload | null = null;
    if (addingKind === "payment") {
      const digits = cardNumber.replace(/\D+/g, "");
      if (digits.length < 12 || !expMonth.trim() || !expYear.trim() || !cvc.trim()) {
        setError("Bitte Kartennummer, Ablaufmonat, Ablaufjahr und CVC ausfüllen.");
        return;
      }
      const normYear = expYear.trim().length === 2 ? `20${expYear.trim()}` : expYear.trim();
      payload = {
        kind: "payment",
        label: buildSafeCardLabel(digits, cardLabel),
        secret: {
          card_number: digits,
          ...(cardHolder.trim() ? { cardholder_name: cardHolder.trim() } : {}),
          exp_month: expMonth.trim().padStart(2, "0"),
          exp_year: normYear,
          cvc: cvc.trim(),
          ...(billingZip.trim() ? { billing_postal_code: billingZip.trim() } : {}),
        },
      };
    } else if (addingKind === "address") {
      if (!addrLine1.trim() || !addrZip.trim() || !addrCity.trim() || !addrCountry.trim()) {
        setError("Bitte Straße/Hausnummer, PLZ, Stadt und Land ausfüllen.");
        return;
      }
      payload = {
        kind: "address",
        label: addrLabel.trim() || "Lieferadresse",
        secret: {
          address_line1: addrLine1.trim(),
          ...(addrLine2.trim() ? { address_line2: addrLine2.trim() } : {}),
          postal_code: addrZip.trim(),
          city: addrCity.trim(),
          country: addrCountry.trim(),
        },
      };
    } else if (addingKind === "login") {
      const cleanOrigin = loginOrigin.trim().startsWith("http")
        ? loginOrigin.trim()
        : `https://${loginOrigin.trim()}`;
      if (!loginOrigin.trim() || !loginIdentifier.trim() || !loginPassword) {
        setError("Bitte Shop-Domain, E-Mail/Benutzername und Passwort ausfüllen.");
        return;
      }
      payload = {
        kind: "login",
        label: loginLabel.trim() || loginOrigin.trim(),
        origin: cleanOrigin,
        secret: {
          identifier_type: loginIdentifier.includes("@") ? "email" : "username",
          identifier: loginIdentifier.trim(),
          password: loginPassword,
        },
      };
    }

    if (!payload) return;
    setSaving(true);
    try {
      const targets = syncAllBots
        ? ["default", ...publicProfiles.map((p) => p.name)]
        : ["default"];
      if (targets.length > 1) {
        const res = await addVaultItemToProfiles(targets, payload);
        setFeedback(
          `„${payload.label}“ verschlüsselt im Tresor gespeichert (${res.savedProfiles.length} Bot-Profile).`
        );
      } else {
        await addVaultItem("default", payload);
        setFeedback(`„${payload.label}“ verschlüsselt im Tresor gespeichert.`);
      }
      resetForms();
      setAddingKind(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte nicht im Tresor gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(item: VaultItemMeta) {
    setError(null);
    setFeedback(null);
    try {
      await removeVaultItem("default", item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      setFeedback(`„${item.label}“ wurde aus dem Haupt-Tresor entfernt.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eintrag konnte nicht entfernt werden.");
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={19} style={{ color: "var(--status-ok)" }} />
          <h2 className="sheet-title">Hermes Tresor</h2>
        </div>
        <button type="button" className="icon-btn ghost" aria-label="Schließen" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
        Verschlüsselter Browser-Tresor für <strong>Zahlungskarten</strong>,{" "}
        <strong>Lieferadressen</strong> und <strong>Shop-Logins</strong>. Bots füllen damit
        Bestellformulare im Browser direkt aus, ohne jemals deine Kartennummer oder Passwörter im
        Chat zu sehen.
      </p>

      {wsState !== "connected" && (
        <div className="notice warn" style={{ marginBottom: 12 }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>WebSocket nicht verbunden – Tresor kurz nicht erreichbar.</span>
        </div>
      )}

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {feedback && (
        <div className="notice ok" style={{ marginBottom: 12 }}>
          <Lock size={15} style={{ flexShrink: 0 }} />
          <span>{feedback}</span>
        </div>
      )}

      {!addingKind ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              className="btn sm"
              disabled={wsState !== "connected"}
              onClick={() => setAddingKind("payment")}
            >
              <CreditCard size={14} /> Karte
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={wsState !== "connected"}
              onClick={() => setAddingKind("address")}
            >
              <MapPin size={14} /> Adresse
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={wsState !== "connected"}
              onClick={() => setAddingKind("login")}
            >
              <KeyRound size={14} /> Login
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "18px 0", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Lade Tresor…
            </div>
          ) : items.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 18 }}>
              <Lock size={20} style={{ color: "var(--text-muted)", marginBottom: 6 }} />
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Noch keine Einträge</div>
              <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                Hinterlege hier einmalig deine Karte oder Lieferadresse – oder direkt im Chat, wenn
                ein Bot danach fragt.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {item.kind === "payment" ? (
                      <CreditCard size={17} style={{ color: "var(--accent-indigo)", flexShrink: 0 }} />
                    ) : item.kind === "address" ? (
                      <MapPin size={17} style={{ color: "var(--status-ok)", flexShrink: 0 }} />
                    ) : (
                      <Globe size={17} style={{ color: "var(--accent-amber)", flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: "0.74rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.kind === "payment"
                          ? "Zahlungskarte (verschlüsselt)"
                          : item.kind === "address"
                            ? "Lieferadresse (verschlüsselt)"
                            : [item.identifier, item.origin].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn ghost"
                    aria-label={`${item.label} entfernen`}
                    onClick={() => void handleRemove(item)}
                  >
                    <Trash2 size={15} style={{ color: "var(--status-err)" }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <form onSubmit={(e) => void handleSaveItem(e)} autoComplete="off">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <strong style={{ fontSize: "0.92rem" }}>
              {addingKind === "payment"
                ? "Neue Zahlungskarte"
                : addingKind === "address"
                  ? "Neue Lieferadresse"
                  : "Neuer Shop-Login"}
            </strong>
            <button
              type="button"
              className="btn sm"
              disabled={saving}
              onClick={() => {
                resetForms();
                setAddingKind(null);
              }}
            >
              Zurück
            </button>
          </div>

          {addingKind === "payment" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="prompt-input"
                placeholder="Bezeichnung (optional, z. B. Visa Privat)"
                value={cardLabel}
                onChange={(e) => setCardLabel(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                placeholder="Karteninhaber"
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                inputMode="numeric"
                placeholder="Kartennummer"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                disabled={saving}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <input
                  className="prompt-input"
                  inputMode="numeric"
                  placeholder="Monat (MM)"
                  maxLength={2}
                  value={expMonth}
                  onChange={(e) => setExpMonth(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="prompt-input"
                  inputMode="numeric"
                  placeholder="Jahr (JJJJ)"
                  maxLength={4}
                  value={expYear}
                  onChange={(e) => setExpYear(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="prompt-input"
                  type="password"
                  inputMode="numeric"
                  placeholder="CVC"
                  maxLength={4}
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value)}
                  disabled={saving}
                />
              </div>
              <input
                className="prompt-input"
                inputMode="numeric"
                placeholder="Rechnungs-PLZ (optional)"
                value={billingZip}
                onChange={(e) => setBillingZip(e.target.value)}
                disabled={saving}
              />
            </div>
          )}

          {addingKind === "address" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="prompt-input"
                placeholder="Bezeichnung (z. B. Zuhause)"
                value={addrLabel}
                onChange={(e) => setAddrLabel(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                placeholder="Straße und Hausnummer"
                value={addrLine1}
                onChange={(e) => setAddrLine1(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                placeholder="Adresszusatz (optional)"
                value={addrLine2}
                onChange={(e) => setAddrLine2(e.target.value)}
                disabled={saving}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                <input
                  className="prompt-input"
                  placeholder="PLZ"
                  value={addrZip}
                  onChange={(e) => setAddrZip(e.target.value)}
                  disabled={saving}
                />
                <input
                  className="prompt-input"
                  placeholder="Stadt"
                  value={addrCity}
                  onChange={(e) => setAddrCity(e.target.value)}
                  disabled={saving}
                />
              </div>
              <input
                className="prompt-input"
                placeholder="Land"
                value={addrCountry}
                onChange={(e) => setAddrCountry(e.target.value)}
                disabled={saving}
              />
            </div>
          )}

          {addingKind === "login" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="prompt-input"
                placeholder="Shop-Name (z. B. MediaMarkt)"
                value={loginLabel}
                onChange={(e) => setLoginLabel(e.target.value)}
                disabled={saving}
              />
              <input
                className="prompt-input"
                placeholder="Shop-Website (z. B. https://www.mediamarkt.de)"
                value={loginOrigin}
                onChange={(e) => setLoginOrigin(e.target.value)}
                autoCapitalize="none"
                disabled={saving}
              />
              <input
                className="prompt-input"
                placeholder="E-Mail oder Benutzername"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                autoCapitalize="none"
                disabled={saving}
              />
              <input
                className="prompt-input"
                type="password"
                placeholder="Passwort"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                disabled={saving}
              />
            </div>
          )}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 12,
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={syncAllBots}
              onChange={(e) => setSyncAllBots(e.target.checked)}
              disabled={saving}
            />
            <span>Für alle Bots im Tresor freigeben (außer private Bots)</span>
          </label>

          <button
            type="submit"
            className="btn primary full"
            style={{ marginTop: 12 }}
            disabled={saving}
          >
            <Plus size={15} />
            {saving ? "Speichere verschlüsselt…" : "Verschlüsselt im Tresor speichern"}
          </button>
        </form>
      )}
    </Sheet>
  );
};
