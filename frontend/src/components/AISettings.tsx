import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, X, AudioLines } from "lucide-react";
import { api } from "../api";
import { Button } from "./ui/button";

export function AISettings({
  onClose,
  onConnected,
  mode = "demo",
  initialTab = "ai",
  onVoiceConnected,
}: {
  mode?: string;
  initialTab?: "ai" | "voice";
  onVoiceConnected?: () => void;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [voiceConnected, setVoiceConnected] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, [tab]);
  useEffect(() => {
    api<{ connected: boolean }>("/voice/status")
      .then(s => setVoiceConnected(s.connected))
      .catch(() => {});
  }, []);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(tab === "voice" ? "/settings/elevenlabs" : "/settings/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Local-Settings": "1" },
        body: JSON.stringify({ api_key: key }),
      });
      setKey("");
      if (tab === "voice") {
        setVoiceConnected(true);
        onVoiceConnected?.();
      } else onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form
        className="upload-modal ai-settings"
        onSubmit={connect}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-title"
        onKeyDown={e => {
          if (e.key === "Escape" && !busy) onClose();
          if (e.key === "Tab") {
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled)"
              ),
            ];
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
          type="button"
          className="modal-close"
          aria-label="Close AI settings"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {(["ai", "voice"] as const).map(t => (
            <button
              type="button"
              key={t}
              role="tab"
              aria-selected={tab === t}
              disabled={busy}
              onClick={() => {
                setTab(t);
                setKey("");
                setError("");
              }}
            >
              {t === "ai" ? "AI connection" : "Voice · ElevenLabs"}
            </button>
          ))}
        </div>
        <div className="intro-symbol">
          {tab === "voice" ? <AudioLines size={25} /> : <KeyRound size={25} />}
        </div>
        <h2 id="ai-title">{tab === "voice" ? "Voice settings" : "AI settings"}</h2>
        <div
          className={`settings-connection ${(tab === "voice" ? !voiceConnected : mode === "demo") ? "disconnected" : ""}`}
        >
          <span />
          {tab === "voice"
            ? voiceConnected
              ? "ElevenLabs connected"
              : "Voice not connected"
            : mode === "anthropic"
              ? "Claude enabled"
              : mode === "openai"
                ? "OpenAI enabled"
                : mode === "demo"
                  ? "Demo · no API key"
                  : "Checking connection…"}
        </div>
        <p>
          {tab === "voice"
            ? "Ask questions with your microphone and listen to answers from your transcript."
            : "Get real answers, decisions, and action items from your meeting conversation."}
        </p>
        <label className="key-label" htmlFor="anthropic-key">
          {tab === "voice" ? "ElevenLabs API key" : "Anthropic API key"}
        </label>
        <input
          ref={input}
          id="anthropic-key"
          className="key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder={
            tab === "voice"
              ? "Enter your ElevenLabs API key"
              : mode === "anthropic"
                ? "Enter a new key to change the connection"
                : "Enter your Anthropic API key"
          }
          maxLength={500}
          disabled={busy}
          required
        />
        <p className="upload-disclosure">
          {tab === "voice"
            ? "Your key stays in backend memory for this session. Voice questions are sent to ElevenLabs for transcription; answers are sent for speech generation. These use your ElevenLabs credits. Claude or OpenAI still provides the answers. The key needs voice-read, speech-to-text, and text-to-speech access."
            : "Your key stays in backend memory for this session and is cleared when the backend restarts. Connecting makes a short AI request. Meeting text and questions are sent to Anthropic when you process or chat."}
        </p>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !key.trim()}>
          {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
          {busy
            ? "Checking connection…"
            : tab === "voice"
              ? "Connect ElevenLabs"
              : "Connect and enable AI"}
        </Button>
      </form>
    </div>
  );
}
