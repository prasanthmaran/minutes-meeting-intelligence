import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  FileText,
  ListFilter,
  MessagesSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { OriginalTranscript } from "./OriginalTranscript";
import { clock } from "../api";
import { Button } from "./ui/button";
import type { Detail, Emotion, MarkKind, Turn, TurnMark } from "../types";

type View = "conversation" | "speakers" | "timeline" | "original";
type Filter = "all" | MarkKind | "emotion";

export const KINDS: Record<MarkKind, { emoji: string; label: string; plural: string }> = {
  question: { emoji: "❓", label: "Question", plural: "Questions" },
  decision: { emoji: "✅", label: "Decision", plural: "Decisions" },
  action: { emoji: "📌", label: "Action", plural: "Actions" },
  risk: { emoji: "⚠️", label: "Risk", plural: "Risks" },
  proposal: { emoji: "💡", label: "Proposal", plural: "Proposals" },
};
export const EMOTIONS: Record<Exclude<Emotion, "neutral">, { emoji: string; label: string }> = {
  positive: { emoji: "😊", label: "Positive" },
  excited: { emoji: "🤩", label: "Excited" },
  agreement: { emoji: "👍", label: "Agreement" },
  concerned: { emoji: "😟", label: "Concerned" },
  frustrated: { emoji: "😤", label: "Frustrated" },
  anxious: { emoji: "😰", label: "Anxious" },
  confused: { emoji: "😕", label: "Confused" },
  surprised: { emoji: "😮", label: "Surprised" },
};
const KIND_ORDER = Object.keys(KINDS) as MarkKind[];

function emotionOf(mark?: TurnMark) {
  return mark && mark.emotion !== "neutral" ? EMOTIONS[mark.emotion] : null;
}

/** Seconds each turn lasts: until the next turn, or a reading-speed estimate for the last. */
function durations(turns: Turn[]) {
  return turns.map((turn, i) => {
    const next = turns[i + 1];
    if (next) return Math.max(next.seconds - turn.seconds, 1);
    return Math.max(4, Math.round(turn.text.split(/\s+/).length / 2.5));
  });
}

function Markers({ mark }: { mark?: TurnMark }) {
  const emotion = emotionOf(mark);
  if (!mark || (!mark.kinds.length && !emotion)) return null;
  return (
    <div className="turn-marks">
      {mark.kinds.map(kind => (
        <span key={kind} className={`mark-chip mark-${kind}`}>
          <span aria-hidden="true">{KINDS[kind].emoji}</span> {KINDS[kind].label}
        </span>
      ))}
      {emotion && (
        <span className={`mark-chip emotion-chip emotion-${mark.emotion}`}>
          <span aria-hidden="true">{emotion.emoji}</span> {emotion.label}
          {mark.emotion_note && <span className="emotion-note"> · {mark.emotion_note}</span>}
        </span>
      )}
    </div>
  );
}

export function TranscriptViews({
  detail,
  aiAvailable,
  onReprocess,
}: {
  detail: Detail;
  aiAvailable: boolean;
  onReprocess: () => void;
}) {
  const [view, setView] = useState<View>("conversation");
  const [filter, setFilter] = useState<Filter>("all");
  const [focus, setFocus] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(detail.speakers.slice(0, 1)));
  const listRef = useRef<HTMLDivElement>(null);

  const marks = useMemo(
    () => new Map((detail.notes?.turn_marks ?? []).map(m => [m.turn_id, m])),
    [detail.notes]
  );
  const summaries = useMemo(
    () => new Map((detail.notes?.speakers ?? []).map(s => [s.speaker, s])),
    [detail.notes]
  );
  const lengths = useMemo(() => durations(detail.turns), [detail.turns]);
  const total = Math.max(detail.turns.at(-1)!.seconds + lengths.at(-1)!, 1);
  const analysis = detail.notes?.analysis;
  const color = (speaker: string) => `person-color-${detail.speakers.indexOf(speaker) % 4}`;

  const stats = useMemo(
    () =>
      detail.speakers.map(speaker => {
        const indexes = detail.turns.flatMap((t, i) => (t.speaker === speaker ? [i] : []));
        const seconds = indexes.reduce((sum, i) => sum + lengths[i], 0);
        const emotions = new Map<string, number>();
        for (const i of indexes) {
          const mark = marks.get(detail.turns[i].id);
          if (mark && mark.emotion !== "neutral")
            emotions.set(mark.emotion, (emotions.get(mark.emotion) ?? 0) + 1);
        }
        return {
          speaker,
          turns: indexes.map(i => detail.turns[i]),
          seconds,
          share: Math.round((seconds / total) * 100),
          emotions: [...emotions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        };
      }),
    [detail, lengths, marks, total]
  );

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: detail.turns.length,
      question: 0,
      decision: 0,
      action: 0,
      risk: 0,
      proposal: 0,
      emotion: 0,
    };
    for (const mark of marks.values()) {
      for (const kind of mark.kinds) result[kind] += 1;
      if (mark.emotion !== "neutral") result.emotion += 1;
    }
    return result;
  }, [marks, detail.turns.length]);

  const visible = detail.turns.filter(turn => {
    if (filter === "all") return true;
    const mark = marks.get(turn.id);
    if (!mark) return false;
    return filter === "emotion" ? mark.emotion !== "neutral" : mark.kinds.includes(filter);
  });

  function jump(turnId: number) {
    setFilter("all");
    setView("conversation");
    setFocus(turnId);
  }
  useEffect(() => {
    if (focus === null || view !== "conversation") return;
    const node = listRef.current?.querySelector<HTMLElement>(`#turn-${focus}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    node?.focus({ preventScroll: true });
    const timer = setTimeout(() => setFocus(null), 2400);
    return () => clearTimeout(timer);
  }, [focus, view]);

  const moments = detail.turns.filter(turn => {
    const mark = marks.get(turn.id);
    return !!mark && (mark.kinds.length > 0 || mark.emotion !== "neutral");
  });
  const tick = [30, 60, 120, 300, 600, 900, 1800].find(step => total / step <= 8) ?? 3600;

  return (
    <div className="transcript-views">
      <div className="transcript-toolbar">
        <div className="view-switch" role="tablist" aria-label="Transcript view">
          {(
            [
              ["conversation", "Conversation", <MessagesSquare size={15} key="c" />],
              ["speakers", "By speaker", <Users size={15} key="s" />],
              ["timeline", "Timeline", <Clock3 size={15} key="t" />],
              ["original", "Original", <FileText size={15} key="o" />],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}>
              {icon}
              {label}
            </button>
          ))}
        </div>
        <span className="transcript-meta">
          {detail.turn_count} turns · {detail.speakers.length} speakers · {clock(total)}
        </span>
      </div>

      {analysis !== "ai" && view !== "original" && (
        <div className="analysis-notice">
          <Sparkles size={16} />
          <p>
            {analysis === "failed"
              ? "Emotion and speaker analysis could not be generated for this meeting. Questions are marked from punctuation."
              : analysis === "demo"
                ? "Demo mode marks questions only. Emotions, decisions, actions and speaker summaries need Claude."
                : "This meeting was processed before transcript analysis existed."}
          </p>
          {aiAvailable && (
            <Button variant="outline" onClick={onReprocess}>
              Reprocess with Claude
            </Button>
          )}
        </div>
      )}

      {view === "conversation" && (
        <>
          <div className="mark-filters" role="group" aria-label="Show turns">
            <ListFilter size={15} aria-hidden="true" />
            {(["all", ...KIND_ORDER, "emotion"] as Filter[])
              .filter(f => f === "all" || counts[f] > 0)
              .map(f => (
                <button
                  key={f}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className="filter-chip"
                >
                  {f !== "all" && (
                    <span aria-hidden="true">{f === "emotion" ? "🎭" : KINDS[f].emoji}</span>
                  )}
                  {f === "all" ? "All" : f === "emotion" ? "Emotions" : KINDS[f].plural}
                  <span className="filter-count">{counts[f]}</span>
                </button>
              ))}
          </div>
          <div className="transcript" ref={listRef}>
            {visible.map(turn => (
              <article
                id={`turn-${turn.id}`}
                key={turn.id}
                tabIndex={-1}
                className={focus === turn.id ? "turn-focus" : undefined}
              >
                <span className={`speaker-avatar ${color(turn.speaker)}`}>{turn.speaker[0]}</span>
                <div>
                  <div className="turn-heading">
                    <strong>{turn.speaker}</strong>
                    <time title={turn.estimated ? "Estimated time" : undefined}>
                      {turn.estimated ? "≈ " : ""}
                      {clock(turn.seconds)}
                    </time>
                  </div>
                  <p>{turn.text}</p>
                  <Markers mark={marks.get(turn.id)} />
                </div>
              </article>
            ))}
            {visible.length === 0 && (
              <p className="transcript-empty">No turns match this filter.</p>
            )}
          </div>
        </>
      )}

      {view === "speakers" && (
        <div className="speaker-sections">
          <div className="speaker-tools">
            <Button variant="ghost" onClick={() => setOpen(new Set(detail.speakers))}>
              Expand all
            </Button>
            <Button variant="ghost" onClick={() => setOpen(new Set())}>
              Collapse all
            </Button>
          </div>
          {stats.map(s => {
            const expanded = open.has(s.speaker);
            const summary = summaries.get(s.speaker);
            const panel = `speaker-panel-${detail.speakers.indexOf(s.speaker)}`;
            return (
              <section key={s.speaker} className={`speaker-section ${expanded ? "open" : ""}`}>
                <button
                  className="speaker-header"
                  aria-expanded={expanded}
                  aria-controls={panel}
                  onClick={() =>
                    setOpen(current => {
                      const next = new Set(current);
                      if (next.has(s.speaker)) next.delete(s.speaker);
                      else next.add(s.speaker);
                      return next;
                    })
                  }
                >
                  <span className={`speaker-avatar ${color(s.speaker)}`}>{s.speaker[0]}</span>
                  <span className="speaker-title">
                    <strong>{s.speaker}</strong>
                    <small>
                      {s.turns.length} {s.turns.length === 1 ? "turn" : "turns"} ·{" "}
                      {clock(s.seconds)} talk time · {s.share}%
                    </small>
                  </span>
                  <span className="speaker-moods" aria-label="Most common emotions">
                    {s.emotions.map(([emotion, n]) => (
                      <span
                        key={emotion}
                        title={`${EMOTIONS[emotion as keyof typeof EMOTIONS].label} × ${n}`}
                      >
                        {EMOTIONS[emotion as keyof typeof EMOTIONS].emoji}
                      </span>
                    ))}
                  </span>
                  <span className="share-bar" aria-hidden="true">
                    <span
                      className={color(s.speaker)}
                      style={{ width: `${Math.max(s.share, 2)}%` }}
                    />
                  </span>
                  <ChevronDown size={18} className="speaker-chevron" aria-hidden="true" />
                </button>
                {expanded && (
                  <div className="speaker-body" id={panel}>
                    {summary ? (
                      <div className="speaker-summary">
                        <p>{summary.summary}</p>
                        {summary.key_points.length > 0 && (
                          <ul>
                            {summary.key_points.map(point => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <p className="speaker-summary muted">
                        {analysis === "ai"
                          ? "No summary for this speaker."
                          : "A summary of what this person said appears after processing with Claude."}
                      </p>
                    )}
                    <ol className="speaker-turns">
                      {s.turns.map(turn => (
                        <li key={turn.id}>
                          <button
                            className="time-link"
                            onClick={() => jump(turn.id)}
                            aria-label={`Open ${clock(turn.seconds)} in the conversation`}
                          >
                            {clock(turn.seconds)}
                          </button>
                          <div>
                            <p>{turn.text}</p>
                            <Markers mark={marks.get(turn.id)} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {view === "original" && <OriginalTranscript detail={detail} />}

      {view === "timeline" && (
        <div className="timeline-view">
          <div className="timeline-scroll">
            <div className="timeline-grid" style={{ ["--lanes" as string]: stats.length }}>
              <div className="timeline-label" />
              <div className="timeline-pins" aria-label="Marked moments">
                {moments
                  .filter(t => marks.get(t.id)!.kinds.length)
                  .map(t => {
                    const mark = marks.get(t.id)!;
                    return (
                      <button
                        key={t.id}
                        className="timeline-pin"
                        style={{ left: `${(t.seconds / total) * 100}%` }}
                        onClick={() => jump(t.id)}
                        title={`${clock(t.seconds)} ${t.speaker}: ${mark.kinds.map(k => KINDS[k].label).join(", ")}`}
                        aria-label={`${clock(t.seconds)} ${t.speaker}: ${mark.kinds.map(k => KINDS[k].label).join(", ")}`}
                      >
                        {KINDS[mark.kinds[0]].emoji}
                      </button>
                    );
                  })}
              </div>
              {stats.map(s => (
                <div className="timeline-row" key={s.speaker}>
                  <div className="timeline-label">
                    <span className={`speaker-avatar ${color(s.speaker)}`}>{s.speaker[0]}</span>
                    <span>{s.speaker}</span>
                  </div>
                  <div className="timeline-lane">
                    {s.turns.map(turn => {
                      const i = detail.turns.indexOf(turn);
                      const emotion = emotionOf(marks.get(turn.id));
                      return (
                        <button
                          key={turn.id}
                          className={`timeline-block ${color(s.speaker)}`}
                          style={{
                            left: `${(turn.seconds / total) * 100}%`,
                            width: `${Math.max((lengths[i] / total) * 100, 0.6)}%`,
                          }}
                          onClick={() => jump(turn.id)}
                          title={`${clock(turn.seconds)} ${s.speaker}${emotion ? ` ${emotion.emoji}` : ""}: ${turn.text.slice(0, 120)}`}
                          aria-label={`${clock(turn.seconds)} ${s.speaker}: ${turn.text.slice(0, 80)}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="timeline-label" />
              <div className="timeline-axis" aria-hidden="true">
                {Array.from({ length: Math.floor(total / tick) + 1 }, (_, n) => n * tick).map(
                  sec => (
                    <span key={sec} style={{ left: `${(sec / total) * 100}%` }}>
                      {clock(sec)}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>

          <h3 className="moments-title">Key moments</h3>
          {moments.length === 0 ? (
            <p className="transcript-empty">
              No questions, decisions, actions or emotional moments were marked.
            </p>
          ) : (
            <ol className="moments">
              {moments.map(turn => {
                const mark = marks.get(turn.id)!;
                const emotion = emotionOf(mark);
                return (
                  <li key={turn.id}>
                    <button className="moment" onClick={() => jump(turn.id)}>
                      <time title={turn.estimated ? "Estimated time" : undefined}>
                        {turn.estimated ? "≈ " : ""}
                        {clock(turn.seconds)}
                      </time>
                      <span className={`moment-dot ${color(turn.speaker)}`} aria-hidden="true" />
                      <span className="moment-body">
                        <span className="moment-head">
                          <strong>{turn.speaker}</strong>
                          {mark.kinds.map(k => (
                            <span key={k} className={`mark-chip mark-${k}`}>
                              <span aria-hidden="true">{KINDS[k].emoji}</span> {KINDS[k].label}
                            </span>
                          ))}
                          {emotion && (
                            <span className={`mark-chip emotion-chip emotion-${mark.emotion}`}>
                              <span aria-hidden="true">{emotion.emoji}</span> {emotion.label}
                            </span>
                          )}
                        </span>
                        <span className="moment-text">{turn.text}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
