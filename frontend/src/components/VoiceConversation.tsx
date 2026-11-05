import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, PhoneOff, Square, Volume2 } from "lucide-react";
import { api } from "../api";
import { Button } from "./ui/button";
import { Conversation, type ConversationState } from "../voice/conversation";
import { BrowserMicrophone } from "../voice/browserAudio";
import type { Message } from "../types";

const labels: Record<ConversationState, string> = {
  idle: "Ready to talk",
  connecting: "Connecting microphone…",
  listening: "Listening…",
  transcribing: "Understanding your question…",
  thinking: "Finding evidence…",
  preparing: "Preparing the voice…",
  speaking: "Speaking…",
};
export function VoiceConversation({
  meetingId,
  disabled,
  onActive,
  onTurn,
}: {
  meetingId: string;
  disabled: boolean;
  onActive: (active: boolean) => void;
  onTurn: (question: string, answer: Message) => void;
}) {
  const [state, setState] = useState<ConversationState>("idle");
  const [heard, setHeard] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const engine = useRef<Conversation | null>(null);
  const mounted = useRef(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const callbacks = useRef({ onActive, onTurn });
  callbacks.current = { onActive, onTurn };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      engine.current?.stop();
      callbacks.current.onActive(false);
    };
  }, []);
  function releasePlayer() {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }
  async function start() {
    if (engine.current) return;
    setError("");
    setHeard("");
    setAnswer("");
    const mic = new BrowserMicrophone();
    const conversation = new Conversation(
      {
        open: signal => mic.open(signal),
        capture: signal => mic.capture(signal),
        transcribe: async (blob, signal) => {
          const body = new FormData();
          body.append("file", blob, "question.audio");
          const result = await api<{ text: string }>(`/meetings/${meetingId}/voice/transcribe`, {
            method: "POST",
            headers: { "X-Local-Settings": "1" },
            body,
            signal,
          });
          return result.text;
        },
        answer: async (question, signal) => {
          const result = await api<Message>(`/meetings/${meetingId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: question }),
            signal,
          });
          if (!signal.aborted && mounted.current) callbacks.current.onTurn(question, result);
          return result;
        },
        speech: async (id, signal) => {
          const response = await fetch(`/api/meetings/${meetingId}/messages/${id}/speech`, {
            method: "POST",
            headers: { "X-Local-Settings": "1" },
            signal,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.detail ?? "Speech generation failed.");
          }
          return response.blob();
        },
        play: (blob, signal) =>
          new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(new DOMException("Stopped", "AbortError"));
              return;
            }
            releasePlayer();
            url.current = URL.createObjectURL(blob);
            const player = new Audio(url.current);
            audio.current = player;
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              signal.removeEventListener("abort", cancel);
              player.onended = null;
              player.onerror = null;
              releasePlayer();
              error ? reject(error) : resolve();
            };
            const cancel = () => finish(new DOMException("Stopped", "AbortError"));
            player.onended = () => finish();
            player.onerror = () =>
              finish(new Error("Audio playback failed. Check your output device and start again."));
            signal.addEventListener("abort", cancel, { once: true });
            player
              .play()
              .catch(() =>
                finish(
                  new Error(
                    "Browser blocked speech playback. Allow sound for this site and start again."
                  )
                )
              );
          }),
        close: () => {
          mic.close();
          releasePlayer();
        },
      },
      next => {
        if (mounted.current) {
          setState(next);
          callbacks.current.onActive(next !== "idle");
        }
      },
      text => {
        if (mounted.current) setHeard(text);
      },
      text => {
        if (mounted.current) setAnswer(text);
      },
      message => {
        if (mounted.current) setError(message);
      }
    );
    engine.current = conversation;
    await conversation.start();
    if (engine.current === conversation) engine.current = null;
  }
  const supported =
    typeof window.AudioContext !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;
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
      <p>Start once. Speak naturally, pause for an answer, and keep the conversation going.</p>
      <div className="conversation-controls">
        {active ? (
          <>
            <Button
              variant="outline"
              onClick={() => engine.current?.interrupt()}
              disabled={state !== "speaking"}
            >
              <Square size={15} />
              Interrupt & speak
            </Button>
            <Button onClick={() => engine.current?.stop()}>
              <PhoneOff size={16} />
              End conversation
            </Button>
          </>
        ) : (
          <Button onClick={start} disabled={disabled || !supported}>
            <Mic size={17} />
            Start conversation
          </Button>
        )}
      </div>
      {!supported && (
        <p className="voice-warning">
          Use Chrome, Edge, or Safari on localhost/HTTPS with microphone access.
        </p>
      )}
      {heard && (
        <p className="conversation-line">
          <b>You</b>
          {heard}
        </p>
      )}
      {answer && (
        <p className="conversation-line">
          <b>Assistant</b>
          {answer}
        </p>
      )}
      {error && (
        <p role="alert" className="voice-error">
          {error}
        </p>
      )}
      <small>
        Microphone access stays on until End. Press Interrupt to stop playback and ask a follow-up.
      </small>
    </div>
  );
}
