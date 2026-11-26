import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Cpu, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import type { HermesFallbackProvider, HermesModelOptionProvider } from "../../shared/types";
import {
  fetchModelOptions,
  fetchProfileFallback,
  updateProfileFallback,
  updateProfileModel,
} from "../lib/hermesApi";
import { RECOMMENDED_ANTHROPIC_FALLBACK } from "../lib/usageLimits";
import { Sheet } from "./Sheet";

interface ModelPickerSheetProps {
  open: boolean;
  profileName: string;
  botLabel: string;
  allProfileNames?: string[];
  currentProvider?: string | null;
  currentModel?: string | null;
  initialSearch?: string;
  initialProvider?: string;
  onSwitched: (provider: string, model: string) => void;
  onFallbackChanged?: (fallbacks: HermesFallbackProvider[]) => void;
  onClose: () => void;
}

export const ModelPickerSheet: React.FC<ModelPickerSheetProps> = ({
  open,
  profileName,
  botLabel,
  allProfileNames = [],
  currentProvider,
  currentModel,
  initialSearch = "",
  initialProvider = "",
  onSwitched,
  onFallbackChanged,
  onClose,
}) => {
  const [providers, setProviders] = useState<HermesModelOptionProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("");
  const [activeModel, setActiveModel] = useState<string>(currentModel || "");
  const [selectedProvider, setSelectedProvider] = useState<string>(initialProvider || currentProvider || "");
  const [search, setSearch] = useState(initialSearch);
  const [customModel, setCustomModel] = useState("");
  const [fallbacks, setFallbacks] = useState<HermesFallbackProvider[]>([]);
  const [defaultFallback, setDefaultFallback] = useState<HermesFallbackProvider>(
    RECOMMENDED_ANTHROPIC_FALLBACK
  );
  const [savingFallback, setSavingFallback] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const [res, profFb, defFb] = await Promise.all([
          fetchModelOptions(profileName, refresh),
          fetchProfileFallback(profileName).catch(() => []),
          profileName === "default"
            ? Promise.resolve([])
            : fetchProfileFallback("default").catch(() => []),
        ]);
        const list = Array.isArray(res?.providers) ? res.providers : [];
        setProviders(list);
        setFallbacks(profFb);

        const sourceForRecommended =
          profileName === "default" ? profFb : defFb;
        const anthropicEntry = sourceForRecommended.find((f) =>
          f.provider.toLowerCase().includes("anthropic")
        );
        if (anthropicEntry) {
          setDefaultFallback(anthropicEntry);
        } else {
          // Pick first available Anthropic model from Hermes provider list if present
          const anthProv = list.find((p) => p.slug === "anthropic");
          const bestModel =
            anthProv?.featured_models?.[0] ||
            anthProv?.models?.find((m) => m.includes("sonnet")) ||
            RECOMMENDED_ANTHROPIC_FALLBACK.model;
          setDefaultFallback({ provider: "anthropic", model: bestModel });
        }

        const srvProvider = res?.provider || currentProvider || "";
        const srvModel = res?.model || currentModel || "";
        setActiveProvider(srvProvider);
        setActiveModel(srvModel);

        const targetProv =
          (initialProvider &&
            list.find(
              (p) =>
                p.slug.toLowerCase() === initialProvider.toLowerCase() ||
                p.name.toLowerCase().includes(initialProvider.toLowerCase())
            )?.slug) ||
          (srvProvider && list.find((p) => p.slug === srvProvider)?.slug) ||
          list.find((p) => p.is_current)?.slug ||
          list[0]?.slug ||
          "";
        setSelectedProvider((prev) =>
          prev && list.some((p) => p.slug === prev) && !initialProvider ? prev : targetProv
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Modelle und Anbieter konnten nicht geladen werden."
        );
      } finally {
        setLoading(false);
      }
    },
    [currentModel, currentProvider, initialProvider, profileName]
  );

  useEffect(() => {
    if (open) {
      setSearch(initialSearch);
      setCustomModel("");
      setFallbackNotice(null);
      void loadOptions(false);
    }
  }, [open, initialSearch, loadOptions]);

  const hasAnthropicFallback = fallbacks.some((f) =>
    f.provider.toLowerCase().includes("anthropic")
  );

  async function handleToggleAnthropicFallback() {
    setSavingFallback(true);
    setError(null);
    setFallbackNotice(null);
    try {
      const next: HermesFallbackProvider[] = hasAnthropicFallback
        ? fallbacks.filter((f) => !f.provider.toLowerCase().includes("anthropic"))
        : [defaultFallback, ...fallbacks.filter((f) => f.provider !== defaultFallback.provider)];
      const saved = await updateProfileFallback(profileName, next);
      setFallbacks(saved);
      onFallbackChanged?.(saved);
      setFallbackNotice(
        saved.length > 0
          ? `Automatischer Fallback aktiv: ${saved[0].provider} / ${saved[0].model}`
          : "Automatischer Fallback deaktiviert."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Fallback konnte nicht gespeichert werden."
      );
    } finally {
      setSavingFallback(false);
    }
  }

  async function handleApplyFallbackToAllBots() {
    const targets = Array.from(new Set([profileName, ...allProfileNames])).filter(Boolean);
    if (targets.length === 0) return;
    setSavingFallback(true);
    setError(null);
    setFallbackNotice(null);
    try {
      await Promise.all(
        targets.map((name) => updateProfileFallback(name, [defaultFallback]))
      );
      setFallbacks([defaultFallback]);
      onFallbackChanged?.([defaultFallback]);
      setFallbackNotice(
        `Anthropic-Fallback (${defaultFallback.model}) für alle ${targets.length} Bots aktiviert.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Fallback konnte nicht für alle Bots gesetzt werden."
      );
    } finally {
      setSavingFallback(false);
    }
  }

  const currentProviderObj = useMemo(
    () => providers.find((p) => p.slug === selectedProvider) || providers[0] || null,
    [providers, selectedProvider]
  );

  const visibleModels = useMemo(() => {
    if (!currentProviderObj) return [];
    const featured = Array.isArray(currentProviderObj.featured_models)
      ? currentProviderObj.featured_models
      : [];
    const all = Array.isArray(currentProviderObj.models) ? currentProviderObj.models : [];
    const unavailable = new Set(currentProviderObj.unavailable_models || []);

    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const m of [...featured, ...all]) {
      if (!m || seen.has(m) || unavailable.has(m)) continue;
      seen.add(m);
      ordered.push(m);
    }

    const q = search.trim().toLowerCase();
    if (!q) return ordered.slice(0, 60);
    return ordered.filter((m) => m.toLowerCase().includes(q)).slice(0, 60);
  }, [currentProviderObj, search]);

  async function handleSelect(providerSlug: string, modelId: string) {
    if (!providerSlug || !modelId.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateProfileModel(profileName, providerSlug, modelId.trim());
      onSwitched(res.provider || providerSlug, res.model || modelId.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modell konnte nicht gewechselt werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="sheet-header">
        <div>
          <h2 className="sheet-title">Modell &amp; KI-Anbieter</h2>
          <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2 }}>
            {botLabel} · aktuell: {activeProvider ? `${activeProvider} / ` : ""}
            {activeModel || "Standard"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Modelle aktualisieren"
            disabled={loading || saving}
            onClick={() => void loadOptions(true)}
          >
            <RefreshCw size={16} />
          </button>
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
      </div>

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Automatic Anthropic Fallback Card */}
      <div className="card" style={{ marginBottom: 14, borderColor: hasAnthropicFallback ? "rgba(52, 211, 153, 0.3)" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: "0.86rem" }}>
            <ShieldCheck
              size={16}
              style={{ color: hasAnthropicFallback ? "var(--status-ok)" : "var(--text-secondary)" }}
            />
            <span>Auto-Fallback bei Limit</span>
          </div>
          <span className={`pill ${hasAnthropicFallback ? "ok" : ""}`}>
            {hasAnthropicFallback ? "Anthropic aktiv" : "Aus"}
          </span>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 10 }}>
          {fallbacks.length > 0
            ? `Fällt bei Rate-Limit oder Quota-Ende automatisch auf ${fallbacks.map((f) => `${f.provider} / ${f.model}`).join(" → ")} zurück.`
            : `Aktiviere Anthropic (${defaultFallback.model}) als automatischen Fallback – genau wie bei Hermes.`}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`btn sm ${hasAnthropicFallback ? "" : "primary"}`}
            disabled={savingFallback || loading}
            onClick={() => void handleToggleAnthropicFallback()}
          >
            {savingFallback
              ? "Speichere…"
              : hasAnthropicFallback
                ? "Fallback ausschalten"
                : `Anthropic aktivieren (${defaultFallback.model})`}
          </button>
          {allProfileNames.length > 1 && (
            <button
              type="button"
              className="btn sm"
              disabled={savingFallback || loading}
              onClick={() => void handleApplyFallbackToAllBots()}
            >
              Für alle Bots aktivieren
            </button>
          )}
        </div>
        {fallbackNotice && (
          <div style={{ marginTop: 8, fontSize: "0.76rem", color: "var(--status-ok)" }}>
            {fallbackNotice}
          </div>
        )}
      </div>

      {loading && providers.length === 0 ? (
        <div className="empty-state">
          <p>Lade verfügbare KI-Anbieter &amp; Modelle aus Hermes…</p>
        </div>
      ) : providers.length === 0 ? (
        <div className="empty-state">
          <Cpu size={28} style={{ color: "var(--text-secondary)" }} />
          <h3>Keine Anbieter gefunden</h3>
          <p>In Hermes sind für dieses Profil noch keine KI-Anbieter konfiguriert.</p>
        </div>
      ) : (
        <>
          <div className="section-header" style={{ marginTop: 2 }}>
            <span className="section-title">KI-Anbieter ({providers.length})</span>
          </div>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            {providers.map((p) => (
              <button
                key={p.slug}
                type="button"
                className={`chip ${currentProviderObj?.slug === p.slug ? "selected" : ""}`}
                onClick={() => setSelectedProvider(p.slug)}
              >
                {p.name || p.slug}
              </button>
            ))}
          </div>

          <div className="search-wrap">
            <Search size={15} className="search-icon" />
            <input
              className="search-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Modelle bei ${currentProviderObj?.name || "Anbieter"} filtern…`}
            />
          </div>

          {currentProviderObj?.warning && (
            <div className="notice warn" style={{ marginBottom: 10 }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{currentProviderObj.warning}</span>
            </div>
          )}

          <div className="card-stack" style={{ marginBottom: 14 }}>
            {visibleModels.length === 0 ? (
              <div className="empty-state" style={{ padding: "18px 14px" }}>
                <p style={{ margin: 0 }}>Kein Modell passt zum Filter.</p>
              </div>
            ) : (
              visibleModels.map((modelId) => {
                const isActive =
                  modelId === activeModel &&
                  (!activeProvider || activeProvider === currentProviderObj?.slug);
                return (
                  <button
                    key={modelId}
                    type="button"
                    className="card"
                    disabled={saving}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "11px 14px",
                      textAlign: "left",
                      borderColor: isActive ? "rgba(245, 158, 11, 0.5)" : undefined,
                    }}
                    onClick={() =>
                      currentProviderObj && void handleSelect(currentProviderObj.slug, modelId)
                    }
                  >
                    <span
                      style={{
                        fontSize: "0.9rem",
                        fontWeight: isActive ? 700 : 500,
                        wordBreak: "break-word",
                      }}
                    >
                      {modelId}
                    </span>
                    {isActive && (
                      <Check size={17} style={{ color: "var(--accent-send)", flexShrink: 0 }} />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {currentProviderObj && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (customModel.trim()) {
                  void handleSelect(currentProviderObj.slug, customModel.trim());
                }
              }}
              style={{ display: "flex", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}
            >
              <input
                className="input"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Oder exakte Modell-ID eingeben…"
                disabled={saving}
              />
              <button
                type="submit"
                className="btn primary"
                disabled={saving || !customModel.trim()}
              >
                Setzen
              </button>
            </form>
          )}
        </>
      )}
    </Sheet>
  );
};
