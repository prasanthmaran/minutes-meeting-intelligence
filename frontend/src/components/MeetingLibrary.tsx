import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "./ui/button";
import { EmptyState } from "./EmptyState";
import { clock } from "../api";
import type { Meeting, MeetingPage, MeetingQuery, MeetingSort } from "../types";

const STATUS_LABELS = {
  all: "All statuses",
  ready: "Ready",
  queued: "Queued",
  processing: "Processing",
  failed: "Failed",
} as const;

/** Page numbers to show: first, last, and a window around the current page. */
function pageList(page: number, pages: number): (number | "gap")[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i && p - sorted[i - 1] > 1 ? ["gap" as const, p] : [p]));
}

export function MeetingLibrary({
  page,
  query,
  onQueryChange,
  loading,
  refreshing,
  onOpen,
  onUpload,
  onSample,
  onDelete,
  uploading,
}: {
  page: MeetingPage;
  query: MeetingQuery;
  onQueryChange: (change: Partial<MeetingQuery>) => void;
  loading: boolean;
  refreshing: boolean;
  onOpen: (id: string) => void;
  onUpload: () => void;
  onSample: () => void;
  onDelete: (meeting: Meeting) => void;
  uploading: boolean;
}) {
  const [search, setSearch] = useState(query.q);
  // Debounced server-side search: one request after typing pauses, back to page 1.
  useEffect(() => {
    if (search === query.q) return;
    const timer = setTimeout(() => onQueryChange({ q: search, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const meetings = page.items;
  const hasAnyMeeting = page.counts.all > 0 || !!query.q || query.status !== "all";
  const first = page.total ? (page.page - 1) * page.page_size + 1 : 0;
  const last = Math.min(page.page * page.page_size, page.total);

  function sortHeader(label: string, key: MeetingSort): ReactNode {
    const active = query.sort === key;
    const nextOrder = active
      ? query.order === "asc"
        ? "desc"
        : "asc"
      : key === "title"
        ? "asc"
        : "desc";
    return (
      <th aria-sort={active ? (query.order === "asc" ? "ascending" : "descending") : "none"}>
        <button
          className={`sort-button ${active ? "active" : ""}`}
          onClick={() => onQueryChange({ sort: key, order: nextOrder, page: 1 })}
          title={`Sort by ${label.toLowerCase()}`}
        >
          {label}
          {active ? (
            query.order === "asc" ? (
              <ArrowUp size={13} />
            ) : (
              <ArrowDown size={13} />
            )
          ) : (
            <ArrowUpDown size={13} className="sort-idle" />
          )}
        </button>
      </th>
    );
  }
  return (
    <section className="meeting-library" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <div className="library-eyebrow">YOUR WORKSPACE</div>
          <h1 id="library-title">Meetings</h1>
          <p>Find a conversation. Open it to explore the notes, transcript, and answers.</p>
        </div>
        <Button onClick={onUpload}>
          <Upload size={18} />
          Upload transcript
        </Button>
      </div>
      <div className="library-toolbar" data-tour="library">
        <label className="library-search">
          <Search size={18} />
          <input
            aria-label="Search meetings"
            value={search}
            onChange={e => setSearch(e.target.value)}
            maxLength={200}
            placeholder="Search meetings or participants…"
          />
        </label>
        <label className="library-filter">
          <span className="sr-only">Filter meetings by status</span>
          <select
            aria-label="Filter meetings by status"
            value={query.status}
            onChange={e =>
              onQueryChange({ status: e.target.value as MeetingQuery["status"], page: 1 })
            }
          >
            {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map(key => (
              <option key={key} value={key}>
                {STATUS_LABELS[key]} ({page.counts[key] ?? 0})
              </option>
            ))}
          </select>
        </label>
        <span className="library-count" aria-live="polite">
          {refreshing && <Loader2 size={14} className="spin" aria-hidden="true" />}
          {page.total
            ? `${first}–${last} of ${page.total} ${page.total === 1 ? "meeting" : "meetings"}`
            : "0 meetings"}
        </span>
      </div>
      {loading ? (
        <div className="library-empty" role="status">
          Loading meetings…
        </div>
      ) : !hasAnyMeeting ? (
        <EmptyState
          art="library"
          title="No meetings yet"
          actions={
            <>
              <Button onClick={onUpload} disabled={uploading}>
                <Upload size={16} /> Import meetings
              </Button>
              <Button variant="outline" onClick={onSample} disabled={uploading}>
                Explore a sample <ArrowRight size={16} />
              </Button>
            </>
          }
        >
          Import one or more timestamped .txt transcripts to get summaries, decisions, action items,
          and answers with cited evidence.
        </EmptyState>
      ) : (
        <div className="meeting-table-wrap">
          <table className={`meeting-table ${refreshing ? "is-refreshing" : ""}`}>
            <caption className="sr-only">
              Uploaded meetings. Select a meeting to open its details.
            </caption>
            <thead>
              <tr>
                {sortHeader("Meeting", "title")}
                {sortHeader("Uploaded", "created_at")}
                <th>Participants</th>
                {sortHeader("Transcript", "duration")}
                {sortHeader("Status", "status")}
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m: Meeting) => (
                <tr key={m.id}>
                  <td>
                    <button className="meeting-title-button" onClick={() => onOpen(m.id)}>
                      <span className="meeting-file-icon">
                        <FileText size={20} />
                      </span>
                      <span>{m.title}</span>
                    </button>
                  </td>
                  <td>
                    <time dateTime={m.created_at}>
                      {new Date(m.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      <small>
                        {new Date(m.created_at).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </time>
                  </td>
                  <td>
                    <strong>{m.speakers.length} speaker labels</strong>
                    <span className="table-speakers" title={m.speakers.join(", ")}>
                      {m.speakers.join(", ")}
                    </span>
                  </td>
                  <td>
                    <strong>{clock(m.duration)}</strong>
                    <small>last timestamp · {m.turn_count} turns</small>
                  </td>
                  <td>
                    <span className={`meeting-status status-${m.status}`}>{m.status}</span>
                  </td>
                  <td className="meeting-row-actions">
                    <button
                      className="meeting-delete-button"
                      aria-label={`Delete ${m.title}`}
                      title={
                        ["queued", "processing"].includes(m.status)
                          ? "Wait for processing to finish before deleting"
                          : `Delete ${m.title}`
                      }
                      disabled={["queued", "processing"].includes(m.status)}
                      onClick={() => onDelete(m)}
                    >
                      <Trash2 size={17} />
                    </button>
                    <button
                      className="meeting-open-button"
                      aria-label={`Open ${m.title}`}
                      title={`Open ${m.title}`}
                      onClick={() => onOpen(m.id)}
                    >
                      <ArrowRight size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!meetings.length && (
            <p className="library-no-results">No meetings match your search or status filter.</p>
          )}
          {page.total > 0 && (
            <nav className="pagination" aria-label="Meeting pages">
              <label className="page-size">
                <span>Rows</span>
                <select
                  aria-label="Meetings per page"
                  value={query.page_size}
                  onChange={e => onQueryChange({ page_size: Number(e.target.value), page: 1 })}
                >
                  {[10, 20, 50].map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="page-buttons">
                <button
                  aria-label="Previous page"
                  disabled={page.page <= 1}
                  onClick={() => onQueryChange({ page: page.page - 1 })}
                >
                  <ChevronLeft size={16} />
                </button>
                {pageList(page.page, page.pages).map((p, i) =>
                  p === "gap" ? (
                    <span key={`gap-${i}`} className="page-gap">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      aria-label={`Page ${p}`}
                      aria-current={p === page.page ? "page" : undefined}
                      className={p === page.page ? "current" : ""}
                      onClick={() => onQueryChange({ page: p })}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  aria-label="Next page"
                  disabled={page.page >= page.pages}
                  onClick={() => onQueryChange({ page: page.page + 1 })}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </nav>
          )}
        </div>
      )}
      {page.total > 0 && (
        <p className="library-help">
          Participant counts reflect speaker labels in the transcript. Open a meeting to review the
          original conversation.
        </p>
      )}
    </section>
  );
}
