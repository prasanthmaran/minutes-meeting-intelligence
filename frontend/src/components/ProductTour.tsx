import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  FolderOpen,
  FileDown,
  KeyRound,
  LayoutPanelTop,
  ListChecks,
  MessagesSquare,
  Mic,
  ScrollText,
  Upload,
  X,
} from "lucide-react";
import { Button } from "./ui/button";

export const TOUR_KEY = "minutes.tourCompleted";
export const MEETING_TOUR_KEY = "minutes.meetingTourCompleted";

export type TourStep = {
  id?: string; // lets the page prepare itself for a step (e.g. switch tabs)
  target?: string; // data-tour anchor; the card is centered when it is not on screen
  icon: ReactNode;
  title: string;
  body: ReactNode;
};

export const APP_TOUR: TourStep[] = [
  {
    icon: <AudioLines size={20} />,
    title: "Welcome to Minutes",
    body: "Turn a meeting transcript into decisions, action items and answers you can trace back to the exact moment they were said. Six quick steps.",
  },
  {
    target: "upload",
    icon: <Upload size={20} />,
    title: "Import transcripts",
    body: "Upload one or several files. Timestamped .txt, Otter or Google Meet exports, Zoom/Teams .vtt and .srt all work, in any language.",
  },
  {
    target: "library",
    icon: <FolderOpen size={20} />,
    title: "Your meeting library",
    body: "Search by title or participant and filter by status. New uploads show live progress while Claude reads them.",
  },
  {
    target: "settings",
    icon: <KeyRound size={20} />,
    title: "Connect Claude and voice",
    body: "Add your Anthropic key for summaries and answers, and ElevenLabs for voice. Keys are stored encrypted on the server, never in the browser.",
  },
  {
    target: "tabs",
    icon: <LayoutPanelTop size={20} />,
    title: "Explore a meeting",
    body: "Overview shows the summary and decisions. Transcript has conversation, per-speaker, timeline and original-file views with questions and emotions marked. Action items list owners and deadlines.",
  },
  {
    target: "chat",
    icon: <MessagesSquare size={20} />,
    title: "Ask with evidence",
    body: "Ask in your own words, or by voice. Every answer cites the transcript passages it used, so you can check it.",
  },
];

/** Shown the first time a ready meeting is opened. */
export const MEETING_TOUR: TourStep[] = [
  {
    id: "overview",
    target: "meeting-header",
    icon: <ScrollText size={20} />,
    title: "Your meeting at a glance",
    body: "Title, processing status, length, participants and turns. Everything on this page comes from this one transcript.",
  },
  {
    id: "overview",
    target: "tab-overview",
    icon: <LayoutPanelTop size={20} />,
    title: "Overview",
    body: "The summary, confirmed decisions and open questions. Each item links to the transcript moment that supports it.",
  },
  {
    id: "transcript",
    target: "tab-transcript",
    icon: <MessagesSquare size={20} />,
    title: "Transcript, four ways",
    body: "Read the conversation with questions, decisions and emotions marked, open each speaker’s summary, follow the timeline, or see the original file.",
  },
  {
    id: "actions",
    target: "tab-actions",
    icon: <ListChecks size={20} />,
    title: "Action items",
    body: "Who committed to what, and by when. Calendar, email, Jira and PR buttons show where integrations will plug in.",
  },
  {
    id: "overview",
    target: "ask",
    icon: <MessagesSquare size={20} />,
    title: "Ask your meeting",
    body: "Type any question, like “What did we decide about pricing?”. Answers cite the passages they used, and say so when the transcript doesn’t cover it.",
  },
  {
    id: "overview",
    target: "voice",
    icon: <Mic size={20} />,
    title: "Talk to the voice agent",
    body: "Prefer speaking? Open the voice agent, ask out loud and hear the answer, with the supporting evidence shown alongside. Needs ElevenLabs in Settings.",
  },
];

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;

function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  const node = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? node : null;
}

export function ProductTour({
  steps,
  storageKey,
  onClose,
  onStep,
  secondary,
  finishLabel = "Get started",
  missingHint,
}: {
  steps: TourStep[];
  storageKey: string;
  onClose: () => void;
  onStep?: (step: TourStep) => void;
  secondary?: { label: string; onClick: () => void } | null;
  finishLabel?: string;
  missingHint?: string;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    onStep?.(step);
  }, [step]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "true");
    } catch {
      /* Preference storage is optional. */
    }
    onClose();
  }, [onClose, storageKey]);

  const measure = useCallback(() => {
    const node = findTarget(step.target);
    if (!node) {
      setRect(null);
      return;
    }
    const r = node.getBoundingClientRect();
    setRect({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    });
  }, [step.target]);

  useLayoutEffect(() => {
    findTarget(step.target)?.scrollIntoView({ block: "nearest" });
    measure();
    // The page may change for this step (e.g. a tab switch): measure again once it settles.
    const frame = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, step.target]);

  useEffect(() => {
    card.current?.focus();
  }, [index]);

  // Card placement: beside the spotlight when there is room, otherwise below/above it.
  let position: React.CSSProperties = {};
  if (rect) {
    const width = Math.min(360, window.innerWidth - 32);
    const right = rect.left + rect.width + 16;
    if (right + width <= window.innerWidth - 16 && rect.height < window.innerHeight * 0.6) {
      position = {
        left: right,
        top: Math.min(Math.max(16, rect.top), window.innerHeight - 280),
      };
    } else {
      const below = rect.top + rect.height + 16;
      position = {
        left: Math.min(Math.max(16, rect.left), window.innerWidth - width - 16),
        ...(below + 260 < window.innerHeight
          ? { top: below }
          : { bottom: Math.max(16, window.innerHeight - rect.top + 16) }),
      };
    }
  }

  return (
    <div className="tour-layer">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour-backdrop" aria-hidden="true" />
      )}
      <div
        ref={card}
        className={`tour-card ${rect ? "anchored" : "centered"}`}
        style={position}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key === "Escape") finish();
          if (e.key === "ArrowRight" && !last) setIndex(i => i + 1);
          if (e.key === "ArrowLeft" && index > 0) setIndex(i => i - 1);
          if (e.key === "Tab") {
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"),
            ];
            const first = items[0],
              end = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              end?.focus();
            } else if (!e.shiftKey && document.activeElement === end) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="tour-head">
          <span className="tour-icon" aria-hidden="true">
            {step.icon}
          </span>
          <span className="tour-count">
            Step {index + 1} of {steps.length}
          </span>
          <button className="tour-close" aria-label="Skip tour" onClick={finish}>
            <X size={16} />
          </button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        {step.target && !rect && missingHint && <p className="tour-hint">{missingHint}</p>}
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i === index ? "on" : i < index ? "done" : ""} />
          ))}
        </div>
        <div className="tour-actions">
          {index > 0 ? (
            <Button variant="ghost" onClick={() => setIndex(i => i - 1)}>
              <ArrowLeft size={15} /> Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={finish}>
              Skip
            </Button>
          )}
          {last ? (
            <div className="tour-final">
              {secondary && (
                <Button
                  variant="outline"
                  onClick={() => {
                    finish();
                    secondary.onClick();
                  }}
                >
                  {secondary.label}
                </Button>
              )}
              <Button onClick={finish}>{finishLabel}</Button>
            </div>
          ) : (
            <Button onClick={() => setIndex(i => i + 1)}>
              Next <ArrowRight size={15} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
