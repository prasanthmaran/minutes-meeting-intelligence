import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { Conversation } from "@elevenlabs/client";
import { api } from "../api";
import { Button } from "./ui/button";
import type { Source } from "../types";

type State = "idle" | "connecting" | "listening" | "speaking" | "stopping";
const labels: Record<State, string> = {
  idle: "Ready to talk",
  connecting: "Connecting live voice…",
  listening: "Listening…",
  speaking: "Speaking — you can interrupt",
  stopping: "Ending conversation…",
};
export function VoiceConversation({
  meetingId,
  disabled,
  onActive,
}: {
  meetingId: string;
  disabled: boolean;
  onActive: (active: boolean) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<{ id: number; role: string; text: string }[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const session = useRef<Conversation | null>(null);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const callback = useRef(onActive);
  callback.current = onActive;
  const logBottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcript.length) logBottom.current?.scrollIntoView?.({ block: "nearest" });
  }, [transcript]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      void session.current?.endSession();
      session.current = null;
      callback.current(false);
    };
  }, []);
  function update(next: State) {
    if (mounted.current) {
      setState(next);
      callback.current(next !== "idle");
    }
  }
  async function stop() {
    controller.current?.abort();
    update("stopping");
    const current = session.current;
    session.current = null;
    try {
      await current?.endSession();
    } finally {
      if (!pending.current) update("idle");
    }
  }
  async function start() {
    if (pending.current || session.current) return;
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const valid = () => mounted.current && !abort.signal.aborted;
    setError("");
    setTranscript([]);
    setSources([]);
    setMuted(false);
    update("connecting");
    try {
      const { token } = await api<{ token: string }>(`/meetings/${meetingId}/voice/session`, {
        method: "POST",
        headers: { "X-Local-Settings": "1" },
        signal: abort.signal,
      });
      if (!valid()) return;
      const { Conversation: LiveConversation } = await import("@elevenlabs/client");
      if (!valid()) return;
      const connected = await LiveConversation.startSession({
        conversationToken: token,
        connectionType: "webrtc",
        textOnly: false,
        onModeChange: ({ mode }) => {
          if (valid()) update(mode);
        },
        onMessage: ({ message, role, event_id }) => {
          if (valid())
            setTranscript(rows => {
              const line = {
                id: event_id,
                role: role === "user" ? "You" : "Minutes",
                text: message,
              };
              const existing = rows.findIndex(r => r.id === event_id && r.role === line.role);
              return existing < 0
                ? [...rows, line]
                : rows.map((r, i) => (i === existing ? line : r));
            });
        },
        onDisconnect: details => {
          if (!valid()) return;
          abort.abort();
          session.current = null;
          update("idle");
          if (details.reason === "error")
            setError("Live voice disconnected. Check your connection and start again.");
        },
        onError: () => {
          if (valid()) {
            setError(
              "Live voice encountered a connection or audio error. Check microphone permission and ElevenLabs Agents access."
            );
            void stop();
          }
        },
        clientTools: {
          meeting_evidence: async ({ question }: { question: string }) => {
            if (!valid()) return JSON.stringify({ error: "Session ended. Do not answer." });
            try {
              const result = await api<{ sources: Source[]; complete_transcript: boolean }>(
                `/meetings/${meetingId}/voice/evidence`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Local-Settings": "1" },
                  body: JSON.stringify({ text: question }),
                  signal: abort.signal,
                }
              );
              if (!valid()) return JSON.stringify({ error: "Session ended. Do not answer." });
              setSources(result.sources);
              return JSON.stringify(result);
            } catch {
              return JSON.stringify({
                error:
                  "Meeting evidence unavailable. Tell the user you cannot verify the answer. Do not guess.",
              });
            }
          },
        },
      });
      if (!valid()) {
        await connected.endSession();
        return;
      }
      session.current = connected;
      update("listening");
    } catch (err) {
      if (valid())
        setError(
          (err as Error).name === "NotAllowedError"
            ? "Allow microphone access and try again."
            : (err as Error).message || "Could not start live voice."
        );
    } finally {
      pending.current = false;
      if (!session.current) update("idle");
    }
  }
  const active = state !== "idle";
  return (
    <div className={`voice-conversation state-${state}`}>
      <div className="conversation-orb" aria-hidden="true">
        {state === "speaking" ? (
          <Volume2 size={28} />
        ) : state === "listening" ? (
          <Mic size={28} />
        ) : (
          <AudioLines size={28} />
        )}
      </div>
      <strong className="conversation-state" role="status">
        {labels[state]}
      </strong>
      <p>
        Speak naturally. Interrupt by speaking, and ask follow-up questions without pressing a
        button.
      </p>
      <div className="conversation-controls">
        {active ? (
          <>
            <Button
              variant="outline"
              disabled={!session.current}
              onClick={() => {
                session.current?.setMicMuted(!muted);
                setMuted(!muted);
              }}
            >
              {muted ? <Mic size={16} /> : <MicOff size={16} />}
              {muted ? "Unmute" : "Mute"}
            </Button>
            <Button onClick={() => void stop()} disabled={state === "stopping"}>
              <PhoneOff size={16} />
              End conversation
            </Button>
          </>
        ) : (
          <Button onClick={() => void start()} disabled={disabled}>
            <Mic size={17} />
            Start conversation
          </Button>
        )}
      </div>
      <div
        className="agent-conversation-log"
        aria-label="Voice conversation transcript"
        aria-live="polite"
      >
        {!transcript.length ? (
          <div className="agent-empty-transcript">
            <span>LIVE VOICE · SEPARATE FROM CHAT</span>
            <p>Try “Hi” or “What did we decide?”</p>
          </div>
        ) : (
          transcript.map((line, i) => (
            <article
              key={i}
              className={line.role === "You" ? "agent-user-line" : "agent-assistant-line"}
            >
              <b>{line.role}</b>
              <p>{line.text}</p>
            </article>
          ))
        )}
        <div ref={logBottom} />
      </div>
      {!!sources.length && (
        <details className="manual-voice">
          <summary>Evidence retrieved for the latest question ({sources.length})</summary>
          {sources.map(s => (
            <p key={s.id}>
              <b>
                {Math.floor(s.start / 60)}:{String(s.start % 60).padStart(2, "0")}
              </b>{" "}
              {s.text}
            </p>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="voice-error">
          {error}
        </p>
      )}
      <small>
        Starting streams microphone audio and requested meeting evidence to ElevenLabs. Uses Agents
        credits. End closes the microphone. Voice history stays in this window; provider retention
        settings also apply.
      </small>
    </div>
  );
}
