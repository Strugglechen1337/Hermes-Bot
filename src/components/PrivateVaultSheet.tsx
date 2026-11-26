import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  EyeOff,
  Lock,
  Plus,
  ShieldCheck,
  Unlock,
  X,
} from "lucide-react";
import type { HermesProfile } from "../../shared/types";
import { getBotVisual } from "../lib/botTheme";
import {
  clearVaultPin,
  hasVaultPin,
  setVaultPin,
  verifyVaultPin,
} from "../lib/privateVault";
import { formatBadgeCount, type BotUnreadInfo } from "../lib/unreadStore";
import { BotAvatar } from "./BotAvatar";
import { Sheet } from "./Sheet";

interface PrivateVaultSheetProps {
  open: boolean;
  unlocked: boolean;
  privateProfiles: HermesProfile[];
  regularProfiles: HermesProfile[];
  avatars: Record<string, string>;
  unreadByBot?: Record<string, BotUnreadInfo>;
  onUnlocked: () => void;
  onLock: () => void;
  onOpenPrivateBot: (profileName: string) => void;
  onToggleBotPrivate: (profile: HermesProfile, makePrivate: boolean) => Promise<void>;
  onCreatePrivateBot: () => void;
  onClose: () => void;
}

export const PrivateVaultSheet: React.FC<PrivateVaultSheetProps> = ({
  open,
  unlocked,
  privateProfiles,
  regularProfiles,
  avatars,
  unreadByBot = {},
  onUnlocked,
  onLock,
  onOpenPrivateBot,
  onToggleBotPrivate,
  onCreatePrivateBot,
  onClose,
}) => {
  const [pinConfigured, setPinConfigured] = useState(hasVaultPin());
  const [pinInput, setPinInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [busyProfile, setBusyProfile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const hasPin = hasVaultPin();
      setPinConfigured(hasPin);
      setPinInput("");
      setNewPin("");
      setShowPinSetup(false);
      setError(null);
      if (!hasPin && !unlocked) {
        onUnlocked();
      }
    }
  }, [open, unlocked, onUnlocked]);

  async function handleUnlockSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ok = await verifyVaultPin(pinInput);
    if (!ok) {
      setError("PIN stimmt nicht.");
      setPinInput("");
      return;
    }
    setPinInput("");
    onUnlocked();
  }

  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = newPin.trim();
    if (cleaned.length < 4) {
      setError("Bitte mindestens 4 Zeichen/Ziffern wählen.");
      return;
    }
    await setVaultPin(cleaned);
    setPinConfigured(true);
    setNewPin("");
    setShowPinSetup(false);
    setError(null);
  }

  async function handleMove(profile: HermesProfile, makePrivate: boolean) {
    setBusyProfile(profile.name);
    setError(null);
    try {
      await onToggleBotPrivate(profile, makePrivate);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Status konnte nicht geändert werden."
      );
    } finally {
      setBusyProfile(null);
    }
  }

  const needsPinUnlock = pinConfigured && !unlocked;

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={18} style={{ color: "var(--status-ok)" }} />
          <h2 className="sheet-title">Privater Bereich</h2>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {unlocked && pinConfigured && (
            <button
              type="button"
              className="btn sm"
              style={{ minHeight: 32, padding: "0 10px" }}
              onClick={() => {
                onLock();
                onClose();
              }}
            >
              <Lock size={13} /> Sperren
            </button>
          )}
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Schließen"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {needsPinUnlock ? (
        <form onSubmit={(e) => void handleUnlockSubmit(e)}>
          <div className="card" style={{ marginBottom: 14, textAlign: "center" }}>
            <Lock size={28} style={{ color: "var(--status-ok)", marginBottom: 8 }} />
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Bereich ist geschützt</div>
            <p style={{ margin: "0 0 14px", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              Gib deine PIN ein, um deine versteckten Bots zu öffnen.
            </p>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN eingeben…"
              style={{ textAlign: "center", letterSpacing: "0.25em", marginBottom: 10 }}
              autoFocus
            />
            <button
              type="submit"
              className="btn primary full"
              disabled={pinInput.trim().length < 4}
            >
              <Unlock size={15} /> Entsperren
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="notice ok" style={{ marginBottom: 14 }}>
            <ShieldCheck size={17} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Private Bots sind in der normalen Bot-Liste, in der Suche und in Gruppen unsichtbar.
              In Hermes ist ihr Bot-zu-Bot-Protokoll deaktiviert und ihr{" "}
              <strong>Privater Chat</strong> bleibt isoliert.
            </span>
          </div>

          <div className="section-header" style={{ marginTop: 0 }}>
            <span className="section-title">Private Bots ({privateProfiles.length})</span>
            <button
              type="button"
              className="btn sm primary"
              style={{ minHeight: 30, padding: "0 11px" }}
              onClick={() => {
                onClose();
                onCreatePrivateBot();
              }}
            >
              <Plus size={14} /> Neuer privater Bot
            </button>
          </div>

          {privateProfiles.length === 0 ? (
            <div className="empty-state" style={{ padding: "22px 14px", marginBottom: 14 }}>
              <EyeOff size={24} style={{ color: "var(--text-muted)" }} />
              <p style={{ margin: "8px 0 0" }}>
                Noch kein Bot im privaten Bereich. Erstelle einen neuen oder verschiebe einen
                bestehenden Bot hierher.
              </p>
            </div>
          ) : (
            <div className="card-stack" style={{ marginBottom: 14 }}>
              {privateProfiles.map((p) => {
                const vis = getBotVisual(p);
                const unread = unreadByBot[p.name];
                return (
                  <div
                    key={p.name}
                    className={`card ${unread ? "has-unread-card" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}
                  >
                    <button
                      type="button"
                      style={{ flex: 1, display: "flex", alignItems: "center", gap: 11, textAlign: "left", minWidth: 0 }}
                      onClick={() => {
                        onClose();
                        onOpenPrivateBot(p.name);
                      }}
                    >
                      <BotAvatar visual={vis} imageUrl={avatars[p.name]} size="sm" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontWeight: 700, fontSize: "0.94rem" }}>{vis.label}</span>
                          {unread && (
                            <span
                              className="unread-badge"
                              aria-label={`${unread.count} neue ${unread.count === 1 ? "Nachricht" : "Nachrichten"}`}
                            >
                              {formatBadgeCount(unread.count)}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "0.76rem",
                            color: unread ? "var(--text-primary)" : "var(--text-secondary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {unread?.preview || p.description || "Privater Chat · isoliert"}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busyProfile === p.name}
                      onClick={() => void handleMove(p, false)}
                    >
                      {busyProfile === p.name ? "…" : "Sichtbar"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {regularProfiles.length > 0 && (
            <details style={{ marginBottom: 14 }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  padding: "6px 2px",
                }}
              >
                Bestehenden Bot in privaten Bereich verschieben
              </summary>
              <div className="card-stack" style={{ marginTop: 8 }}>
                {regularProfiles.map((p) => {
                  const vis = getBotVisual(p);
                  return (
                    <div
                      key={p.name}
                      className="card"
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <BotAvatar visual={vis} imageUrl={avatars[p.name]} size="xs" />
                        <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>{vis.label}</span>
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busyProfile === p.name}
                        onClick={() => void handleMove(p, true)}
                      >
                        <Lock size={12} /> {busyProfile === p.name ? "…" : "Privat machen"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Optional PIN lock settings */}
          <div style={{ paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
            {showPinSetup ? (
              <form onSubmit={(e) => void handleSavePin(e)} style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="Neue PIN (mind. 4 Ziffern)"
                  autoComplete="off"
                />
                <button type="submit" className="btn primary sm">
                  Setzen
                </button>
              </form>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setShowPinSetup(true)}
                >
                  <Lock size={13} /> {pinConfigured ? "PIN ändern" : "PIN-Sperre einrichten"}
                </button>
                {pinConfigured && (
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={() => {
                      clearVaultPin();
                      setPinConfigured(false);
                    }}
                  >
                    PIN entfernen
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
};
