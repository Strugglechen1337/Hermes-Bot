import React from "react";
import { Cpu, Gauge, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { HermesFallbackProvider } from "../../shared/types";
import {
  formatCompactTokens,
  formatResetCountdown,
  parsePlanGaugePercent,
  type ChatUsageState,
} from "../lib/usageLimits";
import { Sheet } from "./Sheet";

interface LimitSheetProps {
  open: boolean;
  botLabel: string;
  usage: ChatUsageState;
  activeProvider: string | null;
  activeModel: string | null;
  fallbacks: HermesFallbackProvider[];
  loading: boolean;
  onRefresh: () => void;
  onOpenModelPicker: () => void;
  onClose: () => void;
}

export const LimitSheet: React.FC<LimitSheetProps> = ({
  open,
  botLabel,
  usage,
  activeProvider,
  activeModel,
  fallbacks,
  loading,
  onRefresh,
  onOpenModelPicker,
  onClose,
}) => {
  const gaugePct = parsePlanGaugePercent(usage.planGauge);
  const gaugeReset = formatResetCountdown(usage.planGauge?.resets_at_ms);

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="sheet-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Gauge size={18} style={{ color: "var(--accent-send)" }} />
          <h2 className="sheet-title">Limit &amp; Verbrauch</h2>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Limit aktualisieren"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw size={16} />
          </button>
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

      {/* Active model & automatic fallback status */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Aktives Modell ({botLabel})
        </div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginTop: 4 }}>
          {activeProvider ? `${activeProvider} / ` : ""}
          {activeModel || usage.model || "Standard"}
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {fallbacks.length > 0 ? (
            <span className="pill ok">
              <ShieldCheck size={12} />
              Auto-Fallback: {fallbacks[0].provider} / {fallbacks[0].model}
            </span>
          ) : (
            <span className="pill warn">Kein automatischer Fallback aktiv</span>
          )}
        </div>
      </div>

      {/* Live Plan Gauge / Quota Windows */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Anbieter-Kontingent
        </div>

        {gaugePct !== null && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{usage.planGauge?.label || "Plan-Limit"}</span>
              <span style={{ fontWeight: 700 }}>
                {gaugePct}% genutzt {gaugeReset ? `· Reset ${gaugeReset}` : ""}
              </span>
            </div>
            <div className="limit-progress-track">
              <div
                className={`limit-progress-fill ${gaugePct >= 90 ? "critical" : gaugePct >= 70 ? "warn" : ""}`}
                style={{ width: `${gaugePct}%` }}
              />
            </div>
          </div>
        )}

        {usage.quotaWindows.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {usage.quotaWindows.map((win, idx) => (
              <div key={`${win.label}-${idx}`}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.84rem", marginBottom: 4, gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{win.label}</span>
                  <span style={{ color: "var(--text-secondary)", textAlign: "right" }}>
                    <strong style={{ color: "var(--text-primary)" }}>{win.usedPercent}%</strong> genutzt
                    {win.resetText ? ` · ${win.resetText}` : ""}
                  </span>
                </div>
                <div className="limit-progress-track">
                  <div
                    className={`limit-progress-fill ${win.usedPercent >= 90 ? "critical" : win.usedPercent >= 70 ? "warn" : ""}`}
                    style={{ width: `${win.usedPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : usage.accountLines.length > 0 ? (
          <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {usage.accountLines.join("\n")}
          </div>
        ) : gaugePct === null ? (
          <div style={{ fontSize: "0.83rem", color: "var(--text-secondary)" }}>
            {loading
              ? "Frage aktuelles Anbieter-Limit bei Hermes ab…"
              : "Dieser Anbieter meldet aktuell keine separaten Kontingent-Fenster. Sobald Antworten laufen, werden Live-Werte hier angezeigt."}
          </div>
        ) : null}
      </div>

      {/* Chat Context Fill */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Chat-Kontext
          </span>
          <span style={{ fontSize: "0.83rem", fontWeight: 700 }}>
            {usage.contextPercent !== null ? `${usage.contextPercent}%` : "0%"}
          </span>
        </div>
        <div className="limit-progress-track" style={{ marginBottom: 6 }}>
          <div
            className={`limit-progress-fill ${(usage.contextPercent ?? 0) >= 90 ? "critical" : (usage.contextPercent ?? 0) >= 75 ? "warn" : ""}`}
            style={{ width: `${usage.contextPercent ?? 0}%` }}
          />
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
          <span>
            {usage.contextTokens !== null
              ? `${formatCompactTokens(usage.contextTokens)} / ${formatCompactTokens(usage.contextMax)} Tokens`
              : "Noch keine Nachrichten im Kontext"}
          </span>
          {usage.totalTokens !== null && (
            <span>Gesamt: {formatCompactTokens(usage.totalTokens)}</span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="btn primary full"
        onClick={() => {
          onClose();
          onOpenModelPicker();
        }}
      >
        <Cpu size={16} /> Modell &amp; Anthropic-Fallback anpassen
      </button>
    </Sheet>
  );
};
