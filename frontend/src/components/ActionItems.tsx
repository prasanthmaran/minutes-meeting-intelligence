import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AudioLines,
  CalendarClock,
  CalendarPlus,
  Check,
  GitPullRequest,
  Mail,
  Rocket,
  SquareKanban,
  UserRound,
  X,
} from "lucide-react";
import { clock } from "../api";
import type { Note, Source } from "../types";

type Integration = {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  pitch: (item: Note) => string;
};

/** Proof-of-concept integrations: the buttons show where each will live, nothing is sent. */
const INTEGRATIONS: Integration[] = [
  {
    key: "calendar",
    label: "Calendar",
    title: "Add to calendar",
    icon: <CalendarPlus size={14} />,
    pitch: item =>
      `Will create a calendar event${item.deadline ? ` for “${item.deadline}”` : ""} with this action and its transcript evidence.`,
  },
  {
    key: "email",
    label: "Email",
    title: "Send email",
    icon: <Mail size={14} />,
    pitch: item =>
      `Will draft a follow-up email${item.owner ? ` to ${item.owner}` : ""} with this action, deadline and evidence.`,
  },
  {
    key: "jira",
    label: "Jira",
    title: "Create Jira task",
    icon: <SquareKanban size={14} />,
    pitch: item =>
      `Will create a Jira task${item.owner ? ` assigned to ${item.owner}` : ""}, linked back to this meeting.`,
  },
  {
    key: "pr",
    label: "PR",
    title: "Create pull request",
    icon: <GitPullRequest size={14} />,
    pitch: () => "Will open a GitHub pull request draft referencing this action item.",
  },
];

export function ActionItems({
  items,
  sources,
  emptyText,
  onSource,
}: {
  items: Note[];
  sources: Source[];
  emptyText: string;
  onSource: (id: string) => void;
}) {
  const [notice, setNotice] = useState<{ title: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function comingSoon(integration: Integration, item: Note) {
    clearTimeout(timer.current);
    setNotice({ title: `${integration.title} is coming soon`, text: integration.pitch(item) });
    timer.current = setTimeout(() => setNotice(null), 4500);
  }

  if (!items.length) return <p className="muted empty-note">{emptyText}</p>;

  return (
    <>
      <ol className="action-list">
        {items.map((item, i) => (
          <li className="action-row" key={`${i}-${item.text}`}>
            <span className="action-check" aria-hidden="true">
              <Check size={13} strokeWidth={3} />
            </span>
            <div className="action-main">
              <p className="action-text">{item.text}</p>
              <div className="action-details">
                <span className={item.owner ? "" : "unspecified"}>
                  <UserRound size={13} aria-hidden="true" />
                  {item.owner ?? "Owner not specified"}
                </span>
                <span className={item.deadline ? "" : "unspecified"}>
                  <CalendarClock size={13} aria-hidden="true" />
                  {item.deadline ?? "No deadline"}
                </span>
                {item.source_ids.map(id => {
                  const source = sources.find(s => s.id === id);
                  return (
                    source && (
                      <button
                        key={id}
                        className="action-evidence"
                        onClick={() => onSource(id)}
                        aria-label={`Show evidence at ${clock(source.start)}`}
                      >
                        <AudioLines size={12} aria-hidden="true" />
                        {clock(source.start)}
                      </button>
                    )
                  );
                })}
              </div>
            </div>
            <div className="action-integrations" role="group" aria-label="Send this action to">
              {INTEGRATIONS.map(integration => (
                <button
                  key={integration.key}
                  className={`integration-btn integration-${integration.key}`}
                  title={`${integration.title} (coming soon)`}
                  aria-label={`${integration.title} (coming soon)`}
                  onClick={() => comingSoon(integration, item)}
                >
                  {integration.icon}
                  <span>{integration.label}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="poc-toast-region" aria-live="polite">
        {notice && (
          <div className="poc-toast" role="status">
            <Rocket size={18} aria-hidden="true" />
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.text}</p>
              <small>Proof of concept: nothing was sent.</small>
            </div>
            <button aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
