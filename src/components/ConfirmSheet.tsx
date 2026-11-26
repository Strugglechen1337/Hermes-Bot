import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { Sheet } from "./Sheet";

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  description: string;
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmSheet: React.FC<ConfirmSheetProps> = ({
  open,
  title,
  description,
  warning,
  confirmLabel,
  cancelLabel = "Abbrechen",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Sheet
      open={open}
      ariaLabelledBy="confirm-sheet-title"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="sheet-header">
        <h2 id="confirm-sheet-title" className="sheet-title">
          {title}
        </h2>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Schließen"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={20} />
        </button>
      </div>

      <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {description}
      </p>

      {warning && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{warning}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          type="button"
          className="btn full"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn full ${danger ? "danger" : "primary"}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Wird ausgeführt…" : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
};
