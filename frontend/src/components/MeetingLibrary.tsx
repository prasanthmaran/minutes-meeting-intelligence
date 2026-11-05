import { useState } from "react";
import { ArrowRight, AudioLines, FileText, Search, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { clock } from "../api";
import type { Meeting } from "../types";

export function MeetingLibrary({
  meetings,
  loading,
  onOpen,
  onUpload,
  onSample,
  uploading,
}: {
  meetings: Meeting[];
  loading: boolean;
  onOpen: (id: string) => void;
  onUpload: () => void;
  onSample: () => void;
  uploading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = meetings.filter(
    m =>
      (filter === "all" || m.status === filter) &&
      [m.title, ...m.speakers].join(" ").toLowerCase().includes(search.trim().toLowerCase())
  );
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
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={18} />
          <input
            aria-label="Search meetings"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search meetings or participants…"
          />
        </label>
        <label className="library-filter">
          <span className="sr-only">Filter meetings by status</span>
          <select
            aria-label="Filter meetings by status"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <span className="library-count">
          {filtered.length} {filtered.length === 1 ? "meeting" : "meetings"}
        </span>
      </div>
      {loading ? (
        <div className="library-empty" role="status">
          Loading meetings…
        </div>
      ) : meetings.length === 0 ? (
        <div className="library-empty">
          <div className="library-empty-icon">
            <AudioLines size={30} />
          </div>
          <h2>Your next conversation starts here.</h2>
          <p>
            Upload a transcript to get a meeting summary, decisions, action items, and cited
            answers.
          </p>
          <div>
            <Button onClick={onUpload}>Upload your first transcript</Button>
            <Button variant="outline" onClick={onSample} disabled={uploading}>
              Explore a sample <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="meeting-table-wrap">
          <table className="meeting-table">
            <caption className="sr-only">
              Uploaded meetings. Select a meeting to open its details.
            </caption>
            <thead>
              <tr>
                <th>Meeting</th>
                <th>Uploaded</th>
                <th>Participants</th>
                <th>Transcript</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
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
                  <td>
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
          {!filtered.length && (
            <p className="library-no-results">No meetings match your search or status filter.</p>
          )}
        </div>
      )}
      {meetings.length > 0 && (
        <p className="library-help">
          Participant counts reflect speaker labels in the transcript. Open a meeting to review the
          original conversation.
        </p>
      )}
    </section>
  );
}
