import React from "react";
import {
  AlertCircle,
  Bell,
  BellOff,
  Camera,
  Cpu,
  Lock,
  Pin,
  Star,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import type { HermesProfile } from "../../shared/types";
import { getBotVisual } from "../lib/botTheme";
import type { WsConnectionState } from "../lib/hermesWs";
import { BotAvatar } from "./BotAvatar";
import { Sheet } from "./Sheet";

export interface BotManageSheetProps {
  profile: HermesProfile;
  avatarUrl: string | null;
  wsState: WsConnectionState;
  editTitle: string;
  editDesc: string;
  editSoul: string;
  loadingSoul: boolean;
  saving: boolean;
  error: string | null;
  onChangeTitle: (val: string) => void;
  onChangeDesc: (val: string) => void;
  onChangeSoul: (val: string) => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onOpenModelPicker: () => void;
  onSave: (e: React.FormEvent) => void;
  onRequestDelete: () => void;
  isPrivate?: boolean;
  isChief?: boolean;
  isPinned?: boolean;
  pushEnabled?: boolean;
  pushGlobalEnabled?: boolean;
  onTogglePush?: () => void;
  onToggleChief?: () => void;
  onTogglePin?: () => void;
  onTogglePrivate?: () => Promise<void> | void;
  onRequestHide?: () => void;
  onClose: () => void;
}

export const BotManageSheet: React.FC<BotManageSheetProps> = ({
  profile,
  avatarUrl,
  wsState,
  editTitle,
  editDesc,
  editSoul,
  loadingSoul,
  saving,
  error,
  onChangeTitle,
  onChangeDesc,
  onChangeSoul,
  onPickImage,
  onClearImage,
  onOpenModelPicker,
  onSave,
  onRequestDelete,
  isPrivate = false,
  isChief = false,
  isPinned = false,
  pushEnabled = true,
  pushGlobalEnabled = true,
  onTogglePush,
  onToggleChief,
  onTogglePin,
  onTogglePrivate,
  onRequestHide,
  onClose,
}) => {
  const vis = getBotVisual(profile);

  return (
    <Sheet
      open
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="sheet-header">
        <h2 className="sheet-title">{vis.label}</h2>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Schließen"
          disabled={saving}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          className="avatar-edit-btn"
          disabled={saving || wsState !== "connected"}
          onClick={onPickImage}
        >
          <BotAvatar visual={vis} imageUrl={avatarUrl} size="lg" />
          <span className="avatar-camera-badge" style={{ width: 24, height: 24 }}>
            <Camera size={13} />
          </span>
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn sm"
            disabled={saving || wsState !== "connected"}
            onClick={onPickImage}
          >
            <Camera size={14} /> Bild ändern
          </button>
          {avatarUrl && (
            <button
              type="button"
              className="btn sm"
              disabled={saving || wsState !== "connected"}
              onClick={onClearImage}
            >
              Entfernen
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn sm"
          disabled={saving}
          onClick={onOpenModelPicker}
        >
          <Cpu size={14} />
          {profile.provider ? `${profile.provider} / ` : ""}
          {profile.model || "Modell & Anbieter wählen"}
        </button>

        {(onToggleChief || onTogglePin || onTogglePush || isPrivate) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {onToggleChief && (
              <button
                type="button"
                className={`btn sm ${isChief ? "chief-active-btn" : ""}`}
                disabled={saving}
                onClick={onToggleChief}
              >
                <Star size={14} fill={isChief ? "currentColor" : "none"} />
                {isChief ? "Chef-Bot (entfernen)" : "Als Chef oben markieren"}
              </button>
            )}
            {onTogglePin && (
              <button
                type="button"
                className={`btn sm ${isPinned ? "primary" : ""}`}
                disabled={saving}
                onClick={onTogglePin}
              >
                <Pin size={14} />
                {isPinned ? "Oben angeheftet" : "Oben anheften"}
              </button>
            )}
            {onTogglePush && !isPrivate && (
              <button
                type="button"
                className={`btn sm ${pushEnabled ? "push-active-btn" : ""}`}
                disabled={saving || !pushGlobalEnabled}
                title={
                  !pushGlobalEnabled
                    ? "Master-Schalter für Push ist aus (unter Konto aktivieren)"
                    : undefined
                }
                onClick={onTogglePush}
              >
                {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
                {!pushGlobalEnabled
                  ? "Push (alle aus)"
                  : pushEnabled
                    ? "Push: An"
                    : "Push: Aus"}
              </button>
            )}
            {isPrivate && (
              <span className="pill" style={{ fontSize: "0.74rem" }}>
                <BellOff size={12} /> Push dauerhaft aus (Privat)
              </span>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSave}>
        <div className="field">
          <label htmlFor="edit-bot-title">Rufname (Anzeigename · funktioniert ohne @)</label>
          <input
            id="edit-bot-title"
            className="input"
            value={editTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="z. B. Clara, Anna, Nina, Mika"
          />
        </div>

        <div className="field">
          <label htmlFor="edit-bot-desc">Kurzbeschreibung</label>
          <input
            id="edit-bot-desc"
            className="input"
            value={editDesc}
            onChange={(e) => onChangeDesc(e.target.value)}
            placeholder="Rolle des Bots"
          />
        </div>

        <div className="field">
          <label htmlFor="edit-bot-soul">Persönlichkeit / Anweisungen (SOUL)</label>
          <textarea
            id="edit-bot-soul"
            className="textarea"
            value={loadingSoul ? "Lade…" : editSoul}
            disabled={loadingSoul}
            onChange={(e) => onChangeSoul(e.target.value)}
            placeholder="Anweisungen für diesen Bot…"
          />
        </div>

        {error && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="btn primary full" disabled={saving || loadingSoul}>
          {saving ? "Speichere…" : "Änderungen speichern"}
        </button>
      </form>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
        {!profile.is_default && onTogglePrivate && (
          <button
            type="button"
            className="btn full"
            style={{ borderColor: isPrivate ? "rgba(52, 211, 153, 0.35)" : undefined }}
            disabled={saving}
            onClick={() => void onTogglePrivate()}
          >
            {isPrivate ? <Unlock size={15} /> : <Lock size={15} />}
            {isPrivate
              ? "Aus privatem Bereich holen (sichtbar machen)"
              : "In privaten Bereich verschieben (isoliert)"}
          </button>
        )}
        {!profile.is_default ? (
          <button
            type="button"
            className="btn danger full"
            disabled={saving}
            onClick={onRequestDelete}
          >
            <Trash2 size={15} /> Bot dauerhaft aus Hermes löschen
          </button>
        ) : (
          onRequestHide && (
            <>
              <button
                type="button"
                className="btn danger full"
                disabled={saving}
                onClick={onRequestHide}
              >
                Aus meiner Bot-Liste ausblenden
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                Hinweis: Das System-Basisprofil „default“ trägt den Hermes-Gateway und kann nicht gelöscht, aber jederzeit ausgeblendet werden.
              </span>
            </>
          )
        )}
      </div>
    </Sheet>
  );
};
