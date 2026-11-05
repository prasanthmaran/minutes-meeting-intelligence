import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AudioLines,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { Button } from "./ui/button";

type Tab = "ai" | "voice";
interface ConnectionStatus {
  ai: { mode: string; model: string | null; key_hint: string | null };
  voice: { connected: boolean; key_hint: string | null; voice_id: string };
}
const local = { "X-Local-Settings": "1" };

export function AISettings({
  onClose,
  onConnected,
  onDisconnected,
  onVoiceConnected,
  onVoiceDisconnected,
  mode = "demo",
  initialTab = "ai",
}: {
  mode?: string;
  initialTab?: Tab;
  onClose: () => void;
  onConnected: () => void;
  onDisconnected?: (mode: string) => void;
  onVoiceConnected?: () => void;
  onVoiceDisconnected?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"" | "connect" | "remove">("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ConnectionStatus>("/settings", { headers: local })
      .then(s => {
        if (s?.ai && s?.voice) setStatus(s);
      })
      .catch(() => {});
  }, []);

  const aiMode = status?.ai.mode ?? mode;
  const connected =
    tab === "ai" ? aiMode === "anthropic" || aiMode === "openai" : !!status?.voice.connected;
  const removable = tab === "voice" || aiMode === "anthropic";
  const showForm = !connected || editing;
  const keyHint = tab === "ai" ? status?.ai.key_hint : status?.voice.key_hint;

  useEffect(() => {
    const target = dialog.current?.querySelector<HTMLElement>(
      showForm ? "input" : ".connection-actions button"
    );
    target?.focus();
  }, [tab, showForm]);

  function reset(nextTab: Tab = tab) {
    setTab(nextTab);
    setEditing(false);
    setConfirmRemove(false);
    setKey("");
    setError("");
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy("connect");
    setError("");
    try {
      await api(tab === "voice" ? "/settings/elevenlabs" : "/settings/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...local },
        body: JSON.stringify({ api_key: key }),
      });
      setKey("");
      if (tab === "voice") onVoiceConnected?.();
      else onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("remove");
    setError("");
    try {
      if (tab === "voice") {
        await api("/settings/elevenlabs", { method: "DELETE", headers: local });
        setStatus(s => s && { ...s, voice: { ...s.voice, connected: false, key_hint: null } });
        onVoiceDisconnected?.();
      } else {
        const result = await api<{ mode: string }>("/settings/anthropic", {
          method: "DELETE",
          headers: local,
        });
        setStatus(s => s && { ...s, ai: { mode: result.mode, model: null, key_hint: null } });
        onDisconnected?.(result.mode);
      }
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const provider =
    tab === "voice"
      ? {
          name: "ElevenLabs",
          detail: "Speech-to-text and spoken answers",
          icon: <AudioLines size={20} />,
        }
      : aiMode === "openai"
        ? {
            name: "OpenAI",
            detail: status?.ai.model ?? "Configured in .env",
            icon: <Sparkles size={20} />,
          }
        : {
            name: "Anthropic Claude",
            detail: connected
              ? (status?.ai.model ?? "Summaries, decisions and answers")
              : "Summaries, decisions and answers",
            icon: <Sparkles size={20} />,
          };
  const label = tab === "voice" ? "ElevenLabs API key" : "Anthropic API key";

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={dialog}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={e => e.stopPropagation()}
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
        <header className="settings-header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p>Connections for this local workspace</p>
          </div>
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            disabled={!!busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {(["ai", "voice"] as const).map(t => (
            <button
              type="button"
              key={t}
              role="tab"
              aria-selected={tab === t}
              disabled={!!busy}
              onClick={() => reset(t)}
            >
              {t === "ai" ? <Sparkles size={15} /> : <AudioLines size={15} />}
              {t === "ai" ? "AI connection" : "Voice · ElevenLabs"}
            </button>
          ))}
        </div>

        <section className="connection-card" aria-label={`${provider.name} connection`}>
          <div className="connection-head">
            <span className="connection-logo">{provider.icon}</span>
            <div className="connection-name">
              <strong>{provider.name}</strong>
              <small>{provider.detail}</small>
            </div>
            <span className={`connection-badge ${connected ? "on" : ""}`}>
              <span />
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>

          {connected && !editing && !confirmRemove && (
            <>
              <dl className="connection-meta">
                <div>
                  <dt>API key</dt>
                  <dd>
                    <KeyRound size={14} />
                    <code>{keyHint ? `••••••••${keyHint.replace("…", "")}` : "••••••••"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Stored</dt>
                  <dd>{removable ? "Backend memory · this session" : "Project .env file"}</dd>
                </div>
              </dl>
              <div className="connection-actions">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  <RefreshCw size={15} />
                  {removable ? "Replace key" : "Switch to Claude"}
                </Button>
                {removable && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="danger-ghost"
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 size={15} />
                    Remove key
                  </Button>
                )}
              </div>
            </>
          )}

          {confirmRemove && (
            <div className="connection-confirm" role="alertdialog" aria-label="Confirm key removal">
              <strong>Remove the {provider.name} key?</strong>
              <p>
                {tab === "voice"
                  ? "Voice questions and spoken answers stop until you connect a key again."
                  : "Answers fall back to demo mode. After reconnecting, reprocess meetings to use Claude again."}
              </p>
              <div className="connection-actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </Button>
                <Button type="button" className="danger-solid" disabled={!!busy} onClick={remove}>
                  {busy === "remove" ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  Remove key
                </Button>
              </div>
            </div>
          )}

          {showForm && (
            <form className="connection-form" onSubmit={connect}>
              <label htmlFor="provider-key">{editing ? `New ${label}` : label}</label>
              <input
                id="provider-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder={tab === "voice" ? "Paste your ElevenLabs key" : "sk-ant-…"}
                maxLength={500}
                disabled={!!busy}
                required
              />
              <div className="connection-actions">
                {editing && (
                  <Button type="button" variant="ghost" disabled={!!busy} onClick={() => reset()}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={!!busy || !key.trim()}>
                  {busy === "connect" ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <KeyRound size={15} />
                  )}
                  {busy === "connect"
                    ? "Checking key…"
                    : editing
                      ? "Verify and replace"
                      : tab === "voice"
                        ? "Connect ElevenLabs"
                        : "Connect and enable AI"}
                </Button>
              </div>
            </form>
          )}

          {error && (
            <p className="connection-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <p className="settings-privacy">
          <ShieldCheck size={15} />
          {tab === "voice"
            ? "Keys stay in backend memory and are cleared on restart. Recorded questions and answer text are sent to ElevenLabs and use your credits."
            : "Keys stay in backend memory and are cleared on restart. Meeting text and questions are sent to Anthropic when you process or chat."}
        </p>
      </div>
    </div>
  );
}
