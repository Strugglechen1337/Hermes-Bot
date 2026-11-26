import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  X,
  Zap,
} from "lucide-react";
import type { HermesCronJob, HermesCronRun, HermesProfile } from "../../shared/types";
import { getProfileAvatarByName } from "../lib/botTheme";
import { formatRelativeTime } from "../lib/format";
import {
  fetchCronJobRuns,
  fetchCronJobs,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "../lib/hermesApi";
import { ConfirmSheet } from "./ConfirmSheet";

interface RoutinesViewProps {
  profiles: HermesProfile[];
}

type PendingRoutineAction =
  | { kind: "resume"; job: HermesCronJob }
  | { kind: "trigger"; job: HermesCronJob }
  | null;

function jobProfileName(job: HermesCronJob): string {
  return job.profile || job.profile_name || "default";
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

export const RoutinesView: React.FC<RoutinesViewProps> = ({ profiles }) => {
  const [jobs, setJobs] = useState<HermesCronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileFilter, setProfileFilter] = useState<string>("all");
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingRoutineAction>(null);
  const [detailJob, setDetailJob] = useState<HermesCronJob | null>(null);
  const [runs, setRuns] = useState<HermesCronRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchCronJobs("all");
      setJobs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Routinen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const filteredJobs = useMemo(() => {
    if (profileFilter === "all") return jobs;
    return jobs.filter((j) => jobProfileName(j) === profileFilter);
  }, [jobs, profileFilter]);

  const availableFilterProfiles = useMemo(() => {
    const names = new Set<string>(jobs.map(jobProfileName));
    for (const p of profiles) {
      if (p.name === "mika") names.add("mika");
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "de"));
  }, [jobs, profiles]);

  async function openDetail(job: HermesCronJob) {
    setDetailJob(job);
    setRuns([]);
    setLoadingRuns(true);
    try {
      const history = await fetchCronJobRuns(job.id, jobProfileName(job), 15);
      setRuns(history);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }

  async function handlePause(job: HermesCronJob) {
    setBusyJobId(job.id);
    setFeedback(null);
    setError(null);
    try {
      await pauseCronJob(job.id, jobProfileName(job));
      setFeedback(`Routine „${job.name || job.id}“ wurde pausiert.`);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Routine konnte nicht pausiert werden.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function handleConfirmedAction() {
    if (!pendingAction) return;
    const { kind, job } = pendingAction;
    setBusyJobId(job.id);
    setFeedback(null);
    setError(null);
    try {
      if (kind === "resume") {
        await resumeCronJob(job.id, jobProfileName(job));
        setFeedback(`Routine „${job.name || job.id}“ wurde aktiviert.`);
      } else {
        await triggerCronJob(job.id, jobProfileName(job));
        setFeedback(`Routine „${job.name || job.id}“ wurde einmalig gestartet.`);
      }
      setPendingAction(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <div>
      <div className="notice warn" style={{ marginBottom: 14 }}>
        <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Sicherheitsmodus: Importierte Routinen bleiben pausiert, bis du sie bewusst nach Prüfung
          von E-Mail-Zugang und Zustellung aktivierst.
        </span>
      </div>

      {feedback && (
        <div className="notice ok" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{feedback}</span>
        </div>
      )}

      {error && (
        <div className="notice err" style={{ marginBottom: 12 }}>
          <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {availableFilterProfiles.length > 0 && (
        <div className="chip-row" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`chip ${profileFilter === "all" ? "selected" : ""}`}
            onClick={() => setProfileFilter("all")}
          >
            Alle ({jobs.length})
          </button>
          {availableFilterProfiles.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip ${profileFilter === name ? "selected" : ""}`}
              onClick={() => setProfileFilter(name)}
            >
              {getProfileAvatarByName(name, profiles).label}
            </button>
          ))}
        </div>
      )}

      <div className="section-header">
        <h2 className="section-title">Hermes-Routinen ({filteredJobs.length})</h2>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label="Routinen aktualisieren"
          style={{ minWidth: 34, minHeight: 34 }}
          onClick={() => void loadJobs()}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="empty-state">
          <p>Lade Routinen vom Hermes-Server…</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="empty-state">
          <CalendarClock size={30} style={{ color: "var(--accent-primary)" }} />
          <h3>Keine Routinen vorhanden</h3>
          <p>
            Für diesen Filter sind aktuell keine geplanten Hermes-Aufgaben hinterlegt.
          </p>
        </div>
      ) : (
        <div className="card-stack">
          {filteredJobs.map((job) => {
            const pName = jobProfileName(job);
            const vis = getProfileAvatarByName(pName, profiles);
            const isPaused = !job.enabled || job.state === "paused";
            const busy = busyJobId === job.id;

            return (
              <div key={`${pName}:${job.id}`} className="card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <button
                    type="button"
                    style={{ textAlign: "left", flex: 1, minWidth: 0 }}
                    onClick={() => void openDetail(job)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span className="avatar xs" style={{ background: vis.gradient }}>
                        {vis.initials}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                        {job.name?.trim() || `Routine ${job.id.slice(0, 8)}`}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      <Clock size={13} />
                      <span>{formatSchedule(job)}</span>
                    </div>
                    <div className="bot-card-tags" style={{ marginTop: 8 }}>
                      <span className="mini-tag">Bot: {vis.label}</span>
                      {job.deliver && <span className="mini-tag">Zustellung: {job.deliver}</span>}
                      {job.last_run_at && (
                        <span className="mini-tag">
                          Letzter Lauf: {formatRelativeTime(job.last_run_at)}
                        </span>
                      )}
                    </div>
                  </button>

                  <span className={`pill ${isPaused ? "warn" : "ok"}`}>
                    <span className="dot" />
                    {isPaused ? "Pausiert" : "Aktiv"}
                  </span>
                </div>

                {job.last_error && (
                  <div className="notice err" style={{ marginTop: 10, padding: "8px 10px" }}>
                    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{job.last_error}</span>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {isPaused ? (
                    <button
                      type="button"
                      className="btn sm full"
                      disabled={busy}
                      onClick={() => setPendingAction({ kind: "resume", job })}
                    >
                      <Play size={14} /> Aktivieren…
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn sm full"
                      disabled={busy}
                      onClick={() => void handlePause(job)}
                    >
                      <Pause size={14} /> Pausieren
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn sm full"
                    disabled={busy}
                    onClick={() => setPendingAction({ kind: "trigger", job })}
                  >
                    <Zap size={14} /> Jetzt testen…
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailJob && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailJob(null);
          }}
        >
          <div className="sheet">
            <div className="sheet-header">
              <h2 className="sheet-title">{detailJob.name || detailJob.id}</h2>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Schließen"
                onClick={() => setDetailJob(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="bot-card-tags" style={{ marginBottom: 12 }}>
              <span className={`pill ${!detailJob.enabled ? "warn" : "ok"}`}>
                {!detailJob.enabled ? "Pausiert" : "Aktiv"}
              </span>
              <span className="pill">{formatSchedule(detailJob)}</span>
              <span className="pill">Profil: {jobProfileName(detailJob)}</span>
            </div>

            {detailJob.prompt && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase" }}>
                  Aufgabe / Prompt
                </div>
                <div style={{ fontSize: "0.86rem", color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {detailJob.prompt}
                </div>
              </div>
            )}

            <div className="section-header">
              <h3 className="section-title">Letzte Ausführungen</h3>
            </div>
            {loadingRuns ? (
              <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Lade Verlauf…</p>
            ) : runs.length === 0 ? (
              <div className="empty-state" style={{ padding: "20px 14px" }}>
                <p style={{ margin: 0 }}>Bisher keine protokollierten Läufe in Hermes.</p>
              </div>
            ) : (
              <div className="card-stack">
                {runs.map((run, idx) => (
                  <div key={run.id || run.run_id || idx} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                      <strong>{run.status || run.outcome || "Lauf"}</strong>
                      <span style={{ color: "var(--text-muted)" }}>
                        {formatRelativeTime(run.started_at || run.completed_at)}
                      </span>
                    </div>
                    {(run.error || run.summary) && (
                      <div style={{ marginTop: 6, fontSize: "0.8rem", color: run.error ? "var(--status-err)" : "var(--text-secondary)" }}>
                        {run.error || run.summary}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmSheet
        open={Boolean(pendingAction)}
        title={
          pendingAction?.kind === "resume"
            ? "Routine wirklich aktivieren?"
            : "Routine jetzt einmalig ausführen?"
        }
        description={
          pendingAction?.kind === "resume"
            ? `„${pendingAction.job.name || pendingAction.job.id}“ (${formatSchedule(pendingAction.job)}) wird auf dem produktiven Hermes-Server scharfgeschaltet.`
            : `„${pendingAction?.job.name || pendingAction?.job.id}“ wird sofort einmalig auf dem Hermes-Server ausgeführt.`
        }
        warning="Prüfe vorher im Tab „E-Mail“, ob Zugangsdaten und Zustellung vollständig verifiziert sind. Aktive Routinen können echte Nachrichten oder Benachrichtigungen auslösen."
        confirmLabel={
          pendingAction?.kind === "resume" ? "Ja, aktivieren" : "Ja, einmalig starten"
        }
        busy={Boolean(busyJobId)}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void handleConfirmedAction()}
      />
    </div>
  );
};
