import { useEffect, useState } from "react";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { clock } from "../api";
import { Button } from "./ui/button";
import type { Detail } from "../types";

function useElapsed(since?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : 0;
}

/** Live processing view: streamed steps, progress bar and a skeleton of what is coming. */
export function ProcessingProgress({
  meeting,
  live,
  onRetry,
}: {
  meeting: Detail;
  live: boolean;
  onRetry: () => void;
}) {
  const progress = meeting.progress;
  const failed = meeting.status === "failed";
  const queued = meeting.status === "queued" || !progress;
  const elapsed = useElapsed(failed ? undefined : progress?.started_at);
  const percent = progress?.percent ?? 0;

  return (
    <div className={`processing ${failed ? "is-failed" : ""}`}>
      <div className="processing-hero">
        <div className="processing-orb" aria-hidden="true">
          {[0, 1, 2, 3, 4].map(i => (
            <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
        <div>
          <h2>
            {failed
              ? "Processing needs attention"
              : queued
                ? "Waiting to start…"
                : "Making sense of your meeting"}
          </h2>
          <p className="processing-detail" aria-live="polite">
            {failed
              ? meeting.error
              : queued
                ? `${meeting.turn_count} turns from ${meeting.speakers.length} speakers are queued.`
                : progress?.detail}
          </p>
        </div>
      </div>

      <div className="processing-bar-row">
        <div
          className={`processing-bar ${queued && !failed ? "indeterminate" : ""}`}
          role="progressbar"
          aria-label="Processing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={queued ? undefined : percent}
        >
          <span style={{ width: queued && !failed ? undefined : `${percent}%` }} />
        </div>
        <span className="processing-percent">{queued && !failed ? "—" : `${percent}%`}</span>
      </div>
      <div className="processing-meta">
        {!failed && progress && <span>Elapsed {clock(elapsed)}</span>}
        {!failed && (
          <span className={`live-pill ${live ? "on" : ""}`}>
            <span aria-hidden="true" />
            {live ? "Live updates" : "Checking for updates"}
          </span>
        )}
      </div>

      {progress && (
        <ol className="processing-steps">
          {progress.steps.map(step => (
            <li key={step.key} className={`step-${step.state}`}>
              <span className="step-icon" aria-hidden="true">
                {step.state === "done" ? (
                  <Check size={14} strokeWidth={3} />
                ) : step.state === "active" ? (
                  <Loader2 size={14} className="spin" />
                ) : step.state === "failed" ? (
                  <X size={14} strokeWidth={3} />
                ) : null}
              </span>
              <span className="step-label">{step.label}</span>
              {step.state === "active" && step.total > 1 && (
                <span className="step-count">
                  {step.done} / {step.total}
                </span>
              )}
              <span className="sr-only">
                {step.state === "done"
                  ? "done"
                  : step.state === "active"
                    ? "in progress"
                    : step.state === "failed"
                      ? "failed"
                      : "waiting"}
              </span>
            </li>
          ))}
        </ol>
      )}

      {failed ? (
        <Button onClick={onRetry}>
          <RotateCcw size={16} /> Retry processing
        </Button>
      ) : (
        <div className="processing-preview" aria-hidden="true">
          <div className="skeleton-card">
            <span className="skeleton-line w-30" />
            <span className="skeleton-line w-95" />
            <span className="skeleton-line w-80" />
            <span className="skeleton-line w-60" />
          </div>
          <div className="skeleton-card">
            <span className="skeleton-line w-25" />
            <span className="skeleton-line w-70" />
            <span className="skeleton-line w-85" />
          </div>
        </div>
      )}
    </div>
  );
}
