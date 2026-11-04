import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { api } from "../api";
import { Button } from "./ui/button";

export function AISettings({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/settings/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Local-Settings": "1" },
        body: JSON.stringify({ api_key: key }),
      });
      setKey("");
      onConnected();
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
        <div className="intro-symbol">
          <KeyRound size={25} />
        </div>
        <h2 id="ai-title">Connect Claude</h2>
        <p>Get real answers, decisions, and action items from your meeting conversation.</p>
        <label className="key-label" htmlFor="anthropic-key">
          Anthropic API key
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
          placeholder="Enter your replacement API key"
          maxLength={500}
          disabled={busy}
          required
        />
        <p className="upload-disclosure">
          Your key stays in backend memory for this session and is cleared when the backend
          restarts. Connecting makes a short AI request. Meeting text and questions are sent to
          Anthropic when you process or chat.
        </p>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !key.trim()}>
          {busy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
          {busy ? "Checking connection…" : "Connect and enable AI"}
        </Button>
      </form>
    </div>
  );
}
