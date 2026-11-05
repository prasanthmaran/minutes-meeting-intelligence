import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { VoiceAssistant } from "./components/VoiceAssistant";
import { Sidebar } from "./components/Sidebar";
import { MeetingLibrary } from "./components/MeetingLibrary";
import { AISettings } from "./components/AISettings";
import { EmptyState } from "./components/EmptyState";
import { Button } from "./components/ui/button";
import { api, ApiError, clock } from "./api";
import { sample } from "./sample";
import type { Detail, Meeting, Message, Note, Source } from "./types";

type Tab = "overview" | "transcript" | "actions";
const prompts = [
  "What did we decide about the launch?",
  "Who owns the security review?",
  "What is still unresolved?",
];

function meetingFromHash() {
  return window.location.hash.match(/^#\/meetings\/([a-zA-Z0-9-]+)$/)?.[1] ?? null;
}

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<string | null>(meetingFromHash);
  const [detail, setDetail] = useState<Detail | null>(null);
  // "missing" = the meeting no longer exists (deleted, or an old link); otherwise a load error.
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState("");
  const [aiSettings, setAISettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"ai" | "voice">("ai");
  const [voiceSettingsVersion, setVoiceSettingsVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return (
        (window.localStorage.getItem("minutes.sidebarCollapsed") ??
          String(window.innerWidth < 768)) === "true"
      );
    } catch {
      return false;
    }
  });
  const [question, setQuestion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [evidence, setEvidence] = useState<Source | null>(null);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatBottom = useRef<HTMLDivElement>(null);
  const current = useRef<string | null>(selected);
  const modalClose = useRef<HTMLButtonElement>(null);
  current.current = selected;

  function openMeeting(id: string | null) {
    setSelected(id);
    setDetailError(null);
    setEvidence(null);
    setError("");
    window.location.hash = id ? `/meetings/${id}` : "/meetings";
  }
  useEffect(() => {
    const onRoute = () => {
      setSelected(meetingFromHash());
      setEvidence(null);
    };
    window.addEventListener("hashchange", onRoute);
    return () => window.removeEventListener("hashchange", onRoute);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("minutes.sidebarCollapsed", String(collapsed));
    } catch {
      /* Optional preference storage. */
    }
  }, [collapsed]);

  async function loadList() {
    setMeetings(await api<Meeting[]>("/meetings"));
  }
  useEffect(() => {
    Promise.all([api<Meeting[]>("/meetings"), api<{ mode: string }>("/health")])
      .then(([list, health]) => {
        setMeetings(list);
        setMode(health.mode);
      })
      .catch(e => setError(e.message))
      .finally(() => setLibraryLoading(false));
  }, []);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setMessages([]);
      setEvidence(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailError(null);
    setMessages([]);
    setEvidence(null);
    setTab("overview");
    setMenu(false);
    setQuestion("");
    Promise.all([
      api<Detail>(`/meetings/${selected}`),
      api<Message[]>(`/meetings/${selected}/messages`),
    ])
      .then(([meeting, history]) => {
        if (active) {
          setDetail(meeting);
          setMessages(history);
        }
      })
      .catch(e => {
        if (!active) return;
        if (e instanceof ApiError && e.status === 404) {
          setDetailError("missing");
          loadList().catch(() => {});
        } else setDetailError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [selected, detailAttempt]);
  useEffect(() => {
    if (!meetings.some(m => ["queued", "processing"].includes(m.status))) return;
    const interval = setInterval(async () => {
      try {
        await loadList();
        if (current.current) {
          const id = current.current;
          const result = await api<Detail>(`/meetings/${id}`);
          if (current.current === id) setDetail(result);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setDetail(null);
          setDetailError("missing");
        } else setError((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [meetings]);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, sending]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    modalClose.current?.focus();
    return () => previous?.focus();
  }, [modal]);

  async function upload(input: File | File[]) {
    const files = Array.isArray(input) ? input : [input];
    if (!files.length) return;
    setUploading(true);
    setError("");
    const imported: Meeting[] = [];
    const failed: string[] = [];
    try {
      // One at a time: the API validates and queues each transcript independently.
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);
        try {
          imported.push(await api<Meeting>("/meetings", { method: "POST", body }));
        } catch (e) {
          failed.push(
            files.length > 1 ? `${file.name}: ${(e as Error).message}` : (e as Error).message
          );
        }
      }
      await loadList().catch(() => {});
      if (imported.length) setModal(false);
      if (imported.length === 1 && files.length === 1) openMeeting(imported[0].id);
      else if (imported.length) openMeeting(null);
      if (failed.length)
        setError(
          (files.length > 1 ? `Imported ${imported.length} of ${files.length} transcripts. ` : "") +
            failed.join(" · ")
        );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function send(text: string) {
    if (!selected || !text.trim() || sending) return;
    const id = selected;
    setSending(true);
    setError("");
    setQuestion("");
    const optimistic = { id: "pending", role: "user", content: text.trim(), citations: [] };
    setMessages(m => [...m, optimistic]);
    try {
      await api<Message>(`/meetings/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const history = await api<Message[]>(`/meetings/${id}/messages`);
      if (current.current === id) setMessages(history);
    } catch (e) {
      if (current.current === id) {
        setMessages(m => m.filter(item => item.id !== "pending"));
        setQuestion(text);
        setError((e as Error).message);
      }
    } finally {
      setSending(false);
    }
  }
  async function reprocess() {
    if (!selected) return;
    try {
      await api(`/meetings/${selected}/retry`, { method: "POST" });
      setMessages([]);
      setDetail(d => (d ? { ...d, status: "queued", notes: null } : d));
      await loadList();
      setMenu(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    if (
      !selected ||
      !window.confirm("Delete this meeting, its notes, and chat history? This cannot be undone.")
    )
      return;
    setDeleting(true);
    try {
      await api(`/meetings/${selected}`, { method: "DELETE" });
      const list = await api<Meeting[]>("/meetings");
      setMeetings(list);
      openMeeting(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  function showSource(id: string) {
    setEvidence(detail?.sources.find(s => s.id === id) ?? null);
  }
  function exportNotes() {
    if (!detail) return;
    let content = `# ${detail.title}\n\nMode: ${detail.mode}\n\n`;
    for (const [heading, items] of Object.entries(detail.notes ?? {})) {
      content += `## ${heading}\n\n`;
      for (const item of items as Note[])
        content += `- ${item.text}${"owner" in item ? ` — Owner: ${item.owner ?? "Not specified"}; Deadline: ${item.deadline ?? "Not specified"}` : ""}\n${item.source_ids
          .map(id => {
            const s = detail.sources.find(s => s.id === id);
            return s
              ? `  - Evidence [${clock(s.start)}–${clock(s.end)}]:\n${s.text
                  .split("\n")
                  .map(line => `    > ${line}`)
                  .join("\n")}\n`
              : "";
          })
          .join("")}`;
    }
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "meeting-notes.md";
    a.click();
    URL.revokeObjectURL(url);
  }
  const ready = detail?.status === "ready";
  const date = detail
    ? new Date(detail.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  function NoteList({ items, kind }: { items: Note[]; kind: string }) {
    if (!items.length)
      return (
        <p className="muted empty-note">
          {detail?.mode === "demo"
            ? "Available with AI mode. Explore the original transcript below."
            : `No ${kind} explicitly identified in this transcript.`}
        </p>
      );
    return (
      <div className="note-list">
        {items.map((item, i) => (
          <article className="note-item" key={`${i}-${item.text}`}>
            <span className="note-check">
              <Check size={14} />
            </span>
            <div>
              <p>{item.text}</p>
              {"owner" in item && (
                <div className="action-meta">
                  <span>{item.owner ?? "Owner not specified"}</span>
                  <span>{item.deadline ?? "Deadline not specified"}</span>
                </div>
              )}
              <div className="citations">
                {item.source_ids.map(id => {
                  const s = detail?.sources.find(s => s.id === id);
                  return (
                    s && (
                      <button key={id} onClick={() => showSource(id)}>
                        <AudioLines size={12} />
                        {clock(s.start)}
                      </button>
                    )
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        onMeetings={() => openMeeting(null)}
        onUpload={() => setModal(true)}
        onSettings={() => {
          setSettingsTab("ai");
          setAISettings(true);
        }}
        isLibrary={!selected}
      />

      <main className="main">
        <header className="topbar">
          <div>
            <button className="breadcrumb-link" onClick={() => openMeeting(null)}>
              Meetings
            </button>
            {selected && (
              <>
                <ChevronRight size={16} />
                <strong>{detail?.title ?? "Meeting details"}</strong>
              </>
            )}
          </div>
          <div className="topbar-account">
            <div className="topbar-profile" title="Personal workspace">
              <span className="avatar">P</span>
              <div className="topbar-profile-label">
                <strong>Personal workspace</strong>
                <small>Meeting intelligence</small>
              </div>
            </div>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {!selected ? (
          <MeetingLibrary
            meetings={meetings}
            loading={libraryLoading}
            onOpen={openMeeting}
            onUpload={() => setModal(true)}
            uploading={uploading}
            onSample={() =>
              upload(new File([sample], "Atlas beta launch.txt", { type: "text/plain" }))
            }
          />
        ) : detailError === "missing" ? (
          <EmptyState
            art="missing"
            role="status"
            title="This meeting isn’t available"
            actions={
              <>
                <Button onClick={() => openMeeting(null)}>
                  <ArrowLeft size={16} /> Back to meetings
                </Button>
                <Button variant="outline" onClick={() => setModal(true)}>
                  <Upload size={16} /> Import meetings
                </Button>
              </>
            }
          >
            It may have been deleted, or the link is from an earlier workspace. Your other meetings
            are still in the library.
          </EmptyState>
        ) : detailError ? (
          <EmptyState
            art="error"
            role="alert"
            title="We couldn’t load this meeting"
            actions={
              <>
                <Button onClick={() => setDetailAttempt(n => n + 1)}>Try again</Button>
                <Button variant="outline" onClick={() => openMeeting(null)}>
                  <ArrowLeft size={16} /> Back to meetings
                </Button>
              </>
            }
          >
            {detailError}
          </EmptyState>
        ) : !detail ? (
          <div className="loading" role="status">
            <Loader2 className="spin" /> Loading meeting…
          </div>
        ) : (
          <>
            <section className="meeting-header">
              <button className="back-to-meetings" onClick={() => openMeeting(null)}>
                <ArrowLeft size={17} /> Back to meetings
              </button>
              <div className="title-row">
                <h1>{detail.title}</h1>
                <div className="header-actions">
                  <Button variant="outline" onClick={exportNotes} disabled={!ready}>
                    <ArrowDownToLine size={15} /> Export notes
                  </Button>
                  <div className="menu-wrap">
                    <Button
                      variant="ghost"
                      aria-label="Meeting options"
                      aria-expanded={menu}
                      onClick={() => setMenu(!menu)}
                    >
                      <MoreHorizontal size={20} />
                    </Button>
                    {menu && (
                      <div className="dropdown">
                        <button
                          onClick={reprocess}
                          disabled={!["ready", "failed"].includes(detail.status)}
                        >
                          Reprocess meeting
                        </button>
                        <button
                          className="danger"
                          onClick={remove}
                          disabled={deleting || ["queued", "processing"].includes(detail.status)}
                        >
                          <Trash2 size={14} /> Delete meeting
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="meeting-meta">
                <span>
                  <Clock3 size={14} />
                  {clock(detail.duration)} last timestamp
                </span>
                <span>
                  <Users size={14} />
                  {detail.speakers.length} participants
                </span>
                <span>Uploaded {date}</span>
                <span className="ready-pill">
                  {ready ? <Check size={12} /> : <Loader2 className="spin" size={12} />}
                  {detail.status}
                </span>
              </div>
            </section>
            <div className="workspace-grid">
              <section className="notes-pane">
                <div className="tabs" role="tablist" aria-label="Meeting views">
                  {(["overview", "transcript", "actions"] as Tab[]).map(t => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={tab === t ? "active" : ""}
                    >
                      {t === "overview"
                        ? "Overview"
                        : t === "transcript"
                          ? "Transcript"
                          : "Action items"}
                      {t === "actions" && <span>{detail.notes?.actions.length ?? 0}</span>}
                    </button>
                  ))}
                </div>
                <div className="notes-scroll">
                  {!ready ? (
                    <div className="processing-card">
                      <AudioLines size={32} />
                      <h2>
                        {detail.status === "failed"
                          ? "Processing needs attention"
                          : "Making sense of your meeting"}
                      </h2>
                      <p>
                        {detail.error ??
                          "Parsing speakers, preparing evidence, and organizing the conversation. This page updates automatically."}
                      </p>
                      {detail.status === "failed" && (
                        <Button onClick={reprocess}>Retry processing</Button>
                      )}
                    </div>
                  ) : (
                    <>
                      {detail.mode === "demo" && (
                        <div className="demo-notice">
                          <Sparkles size={17} />
                          <p>
                            <strong>You’re exploring demo mode.</strong> Search real transcript
                            passages. AI summaries and synthesized answers need an API key.
                            <button
                              className="text-button"
                              onClick={() => {
                                setSettingsTab("ai");
                                setAISettings(true);
                              }}
                            >
                              Connect Claude <ArrowRight size={14} />
                            </button>
                          </p>
                        </div>
                      )}
                      {tab === "overview" && (
                        <>
                          <div className="section-label">
                            <Sparkles size={16} />
                            <h2>At a glance</h2>
                            <span>GROUNDED IN YOUR MEETING</span>
                          </div>
                          <div className="summary-card">
                            {detail.mode === "demo" ? (
                              <>
                                <h3>The conversation, ready to explore.</h3>
                                <p>
                                  {detail.turn_count} speaker turns from{" "}
                                  {detail.speakers.join(", ")}. Open the transcript or ask about a
                                  specific topic to find the original evidence.
                                </p>
                                <button
                                  className="text-button"
                                  onClick={() => setTab("transcript")}
                                >
                                  Read the transcript <ArrowRight size={14} />
                                </button>
                              </>
                            ) : (
                              <NoteList items={detail.notes?.summary ?? []} kind="summary points" />
                            )}
                          </div>
                          <div className="section-label">
                            <CheckCheck size={17} />
                            <h2>Key decisions</h2>
                            <span>{detail.notes?.decisions.length ?? 0} CONFIRMED</span>
                          </div>
                          <div className="content-card">
                            <NoteList
                              items={detail.notes?.decisions ?? []}
                              kind="confirmed decisions"
                            />
                          </div>
                          <div className="section-label">
                            <MessageSquare size={16} />
                            <h2>Still on the table</h2>
                          </div>
                          <div className="content-card">
                            <NoteList
                              items={detail.notes?.questions ?? []}
                              kind="unresolved questions"
                            />
                          </div>
                          <div className="participants">
                            <span>IN THE CONVERSATION</span>
                            <div>
                              {detail.speakers.map((speaker, i) => (
                                <span className="person" key={speaker}>
                                  <b className={`person-color-${i % 4}`}>{speaker.slice(0, 1)}</b>
                                  {speaker}
                                </span>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                      {tab === "actions" && (
                        <>
                          <div className="section-label">
                            <CheckCheck size={17} />
                            <h2>Next steps</h2>
                          </div>
                          <p className="muted section-description">
                            Explicit commitments only. Missing owners and deadlines stay
                            unspecified.
                          </p>
                          <div className="content-card">
                            <NoteList items={detail.notes?.actions ?? []} kind="action items" />
                          </div>
                        </>
                      )}
                      {tab === "transcript" && (
                        <>
                          <div className="section-label">
                            <AudioLines size={17} />
                            <h2>The original conversation</h2>
                            <span>{detail.turn_count} TURNS</span>
                          </div>
                          <div className="transcript">
                            {detail.turns.map(turn => (
                              <article id={`turn-${turn.id}`} key={turn.id}>
                                <span
                                  className={`speaker-avatar person-color-${detail.speakers.indexOf(turn.speaker) % 4}`}
                                >
                                  {turn.speaker[0]}
                                </span>
                                <div>
                                  <div className="turn-heading">
                                    <strong>{turn.speaker}</strong>
                                    <time>{clock(turn.seconds)}</time>
                                  </div>
                                  <p>{turn.text}</p>
                                </div>
                              </article>
                            ))}
                          </div>
                        </>
                      )}
                      <div className="evidence-footer">
                        <ShieldCheck size={14} /> Keep the source close. Verify important decisions.
                      </div>
                    </>
                  )}
                </div>
              </section>
              <aside className="chat-pane">
                <div className="chat-heading">
                  <span className="chat-symbol">
                    <Sparkles size={17} />
                  </span>
                  <div>
                    <h2>Ask your meeting</h2>
                    <p>Answers with a paper trail.</p>
                  </div>
                  <span className="scope-label">THIS MEETING</span>
                </div>
                <VoiceAssistant
                  key={detail.id}
                  meetingId={detail.id}
                  meetingTitle={detail.title}
                  onAIStatus={setMode}
                  ready={!!ready}
                  aiEnabled={mode !== "demo" && !!mode}
                  sending={sending}
                  onAISettings={() => {
                    setSettingsTab("ai");
                    setAISettings(true);
                  }}
                  onConversationActive={setVoiceActive}
                  onConversationTurn={(question, answer) => {
                    if (current.current === detail.id)
                      setMessages(history => [
                        ...history,
                        {
                          id: `voice-${answer.id}`,
                          role: "user",
                          content: question,
                          citations: [],
                        },
                        answer,
                      ]);
                  }}
                  settingsVersion={voiceSettingsVersion}
                  lastAnswer={[...messages].reverse().find(m => m.role === "assistant") ?? null}
                  onQuestion={setQuestion}
                  onSettings={() => {
                    setSettingsTab("voice");
                    setAISettings(true);
                  }}
                />
                <div className="chat-messages" aria-live="polite">
                  {!messages.length && (
                    <div className="chat-intro">
                      <div className="intro-symbol">
                        <AudioLines size={28} />
                      </div>
                      <h3>A little more clarity?</h3>
                      <p>Ask about decisions, responsibilities, or anything you want to revisit.</p>
                      <div className="suggestions">
                        {prompts.map(prompt => (
                          <button
                            disabled={!ready || sending || voiceActive}
                            key={prompt}
                            onClick={() => send(prompt)}
                          >
                            {prompt}
                            <ArrowRight size={14} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map(message => (
                    <article key={message.id} className={`chat-message ${message.role}`}>
                      <div className="message-author">
                        {message.role === "user" ? (
                          "You"
                        ) : (
                          <>
                            <Sparkles size={13} /> Minutes
                            {detail.mode === "demo" && <span>EXCERPT SEARCH</span>}
                          </>
                        )}
                      </div>
                      <p>{message.content}</p>
                      {message.citations.length > 0 && (
                        <div className="source-list">
                          {message.citations.map((s, i) => (
                            <button key={s.id} onClick={() => setEvidence(s)}>
                              <span>{i + 1}</span>
                              <div>
                                <strong>Transcript evidence</strong>
                                <small>
                                  {clock(s.start)} – {clock(s.end)}
                                </small>
                              </div>
                              <ChevronRight size={14} />
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                  {sending && (
                    <div className="thinking">
                      <Loader2 className="spin" size={14} /> Finding the relevant evidence…
                    </div>
                  )}
                  <div ref={chatBottom} />
                </div>
                <form
                  className="composer"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    send(question);
                  }}
                >
                  <label className="sr-only" htmlFor="question">
                    Ask a question about this meeting
                  </label>
                  <textarea
                    id="question"
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send(question);
                      }
                    }}
                    placeholder="What would you like to know?"
                    maxLength={2000}
                    disabled={!ready || sending || voiceActive}
                    rows={2}
                  />
                  <div>
                    <span>
                      <ShieldCheck size={12} /> Grounded in this transcript
                    </span>
                    <Button
                      aria-label="Send question"
                      disabled={!ready || sending || voiceActive || !question.trim()}
                    >
                      <Send size={16} />
                    </Button>
                  </div>
                </form>
                <p className="chat-foot">AI can make mistakes. Follow the evidence.</p>
              </aside>
            </div>
          </>
        )}
      </main>
      {aiSettings && (
        <AISettings
          initialTab={settingsTab}
          onVoiceConnected={() => {
            setVoiceSettingsVersion(v => v + 1);
            setAISettings(false);
          }}
          mode={mode}
          onClose={() => setAISettings(false)}
          onConnected={() => {
            setMode("anthropic");
            setAISettings(false);
            if (selected) reprocess();
          }}
          onDisconnected={setMode}
          onVoiceDisconnected={() => setVoiceSettingsVersion(v => v + 1)}
        />
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => !uploading && setModal(false)}>
          <section
            className="upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === "Escape" && !uploading) setModal(false);
              if (e.key === "Tab") {
                const items = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled), input:not(:disabled)"
                  ),
                ].filter(el => el.offsetParent !== null);
                const first = items[0],
                  last = items.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              ref={modalClose}
              className="modal-close"
              onClick={() => setModal(false)}
              aria-label="Close upload"
              disabled={uploading}
            >
              <X size={20} />
            </button>
            <div className="intro-symbol">
              <Upload size={25} />
            </div>
            <h2 id="upload-title">Bring your meeting to Minutes.</h2>
            <p>Import one or more timestamped transcripts. We’ll take it from here.</p>
            <button
              className="dropzone"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                if (!uploading && e.dataTransfer.files.length) upload([...e.dataTransfer.files]);
              }}
            >
              {uploading ? <Loader2 className="spin" /> : <FileText size={30} />}
              <strong>
                {uploading ? "Importing transcripts…" : "Choose transcripts or drop them here"}
              </strong>
              <small>UTF-8 .txt files · up to 250 KB / 60,000 characters each</small>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={e => {
                if (e.target.files?.length) upload([...e.target.files]);
              }}
            />
            <div className="format-example">
              <span>EXPECTED FORMAT</span>
              <pre>
                [00:00] Maya: Let’s review the launch.{"\n"}[00:35] Leo: I’ll finish testing by
                Friday.
              </pre>
            </div>
            {error && (
              <p role="alert" className="modal-error">
                {error}
              </p>
            )}
            <div className="upload-disclosure">
              {mode !== "demo" && mode
                ? `AI mode sends transcript text to ${mode === "anthropic" ? "Anthropic" : "OpenAI"} for processing.`
                : "Demo mode processes your transcript locally, without sending it to an AI provider."}
            </div>
            <Button
              variant="ghost"
              disabled={uploading}
              onClick={() =>
                upload(new File([sample], "Atlas beta launch.txt", { type: "text/plain" }))
              }
            >
              Try the sample meeting instead <ArrowRight size={14} />
            </Button>
          </section>
        </div>
      )}
      {evidence && (
        <div className="evidence-panel" role="region" aria-label="Transcript evidence">
          <div>
            <span>
              <AudioLines size={17} /> SOURCE EVIDENCE
            </span>
            <button onClick={() => setEvidence(null)} aria-label="Close evidence">
              <X size={18} />
            </button>
          </div>
          <h3>
            {clock(evidence.start)} – {clock(evidence.end)}
          </h3>
          <pre>{evidence.text}</pre>
          <Button
            variant="outline"
            onClick={() => {
              setTab("transcript");
              const turn = detail?.turns.find(t => t.seconds === evidence.start);
              setEvidence(null);
              setTimeout(
                () =>
                  document
                    .getElementById(`turn-${turn?.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                50
              );
            }}
          >
            View in transcript <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
