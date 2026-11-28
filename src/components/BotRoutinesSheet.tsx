import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, Clock, RefreshCw, X } from "lucide-react";
import type { HermesCronJob } from "../../shared/types";
import { fetchCronJobs, pauseCronJob, resumeCronJob } from "../lib/hermesApi";
import { ConfirmSheet } from "./ConfirmSheet";
import { Sheet } from "./Sheet";

interface BotRoutinesSheetProps {
  open: boolean;
  profileName: string;
  botLabel: string;
  onClose: () => void;
}

function formatSchedule(job: HermesCronJob): string {
  return (
    job.schedule_display ||
    job.schedule?.display ||
    job.schedule?.expr ||
    job.schedule?.run_at ||
    "Zeitplan nicht angegeben"
  );
}

export const BotRoutinesSheet: React.FC<BotRoutinesSheetProps> = ({
  open,
  profileName,
  botLabel,
  onClose,
}) => {
  const [jobs, setJobs] = useState<HermesCronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnableJob, setConfirmEnableJob] = useState<HermesCronJob | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchCronJobs(profileName);
      setJobs(list);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Routinen konnten nicht geladen werden."
      );
    } finally {
      setLoading(false);
    }
  }, [profileName]);

  useEffect(() => {
    if (open) {
      void loadJobs();
    }
  }, [open, loadJobs]);

  async function handleToggle(job: HermesCronJob) {
    if (busyJobId) return;
    if (job.enabled) {
      // Pausing is immediately safe
      setBusyJobId(job.id);
      setError(null);
      try {
        await pauseCronJob(job.id, profileName);
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, enabled: false } : j))
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Routine konnte nicht pausiert werden."
        );
      } finally {
        setBusyJobId(null);
      }
    } else {
      // Activating a paused routine requires explicit confirmation
      setConfirmEnableJob(job);
    }
  }

  async function handleConfirmEnable() {
    if (!confirmEnableJob) return;
    const job = confirmEnableJob;
    setConfirmEnableJob(null);
    setBusyJobId(job.id);
    setError(null);
    try {
      await resumeCronJob(job.id, profileName);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, enabled: true } : j))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Routine konnte nicht aktiviert werden."
      );
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose}>
        <div className="sheet-header">
          <h2 className="sheet-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CalendarClock size={18} />
            Routinen · {botLabel}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label="Routinen aktualisieren"
              disabled={loading}
              onClick={() => void loadJobs()}
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

        {error && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {loading && jobs.length === 0 ? (
          <div className="empty-state" style={{ padding: "28px 12px" }}>
            <div className="spinner" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="empty-state" style={{ padding: "28px 12px" }}>
            <CalendarClock size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Keine Routinen vorhanden</div>
            <div style={{ fontSize: "0.84rem", color: "var(--text-secondary)" }}>
              Für {botLabel} sind aktuell keine Zeitpläne oder Automatisierungen eingerichtet.
            </div>
          </div>
        ) : (
          <div className="routine-toggle-list" role="list" aria-label={`Routinen von ${botLabel}`}>
            {jobs.map((job) => {
              const title = job.name || job.id;
              const isBusy = busyJobId === job.id;
              return (
                <div key={job.id} className="routine-toggle-row" role="listitem">
                  <div className="routine-toggle-icon" aria-hidden="true">
                    <Clock size={16} />
                  </div>
                  <div className="routine-toggle-meta">
                    <div className="routine-toggle-title">{title}</div>
                    <div className="routine-toggle-sub">
                      {formatSchedule(job)} · {job.enabled ? "Aktiv" : "Pausiert"}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={job.enabled}
                    aria-label={`${title} ${job.enabled ? "pausieren" : "aktivieren"}`}
                    disabled={isBusy}
                    className={`hp-switch${job.enabled ? " on" : ""}`}
                    onClick={() => void handleToggle(job)}
                  >
                    <span className="hp-switch-thumb" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={Boolean(confirmEnableJob)}
        title="Routine aktivieren?"
        description={
          confirmEnableJob
            ? `„${confirmEnableJob.name || confirmEnableJob.id}“ (${formatSchedule(confirmEnableJob)}) wird für ${botLabel} auf dem produktiven Hermes-Server aktiviert.`
            : ""
        }
        warning="Aktive Routinen werden nach Zeitplan ausgeführt und können echte Meldungen oder Aktionen auslösen."
        confirmLabel="Ja, aktivieren"
        onConfirm={() => void handleConfirmEnable()}
        onCancel={() => setConfirmEnableJob(null)}
      />
    </>
  );
};
