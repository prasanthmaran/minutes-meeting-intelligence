import { useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Mic, Square, Volume2 } from "lucide-react";
import { api } from "../api";
import type { Message } from "../types";
import { Button } from "./ui/button";

type VoiceStatus = { connected: boolean };
export function VoiceAssistant({
  meetingId,
  ready,
  aiEnabled,
  onQuestion,
  onSettings,
  settingsVersion,
  lastAnswer,
  sending,
}: {
  meetingId: string;
  ready: boolean;
  aiEnabled: boolean;
  onQuestion: (text: string) => void;
  onSettings: () => void;
  settingsVersion: number;
  lastAnswer: Message | null;
  sending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const abort = useRef(new AbortController());
  const player = useRef<HTMLAudioElement>(null);
  const supported =
    typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => {
    api<VoiceStatus>("/voice/status")
      .then(s => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, [settingsVersion]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current.abort();
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state === "recording") recorder.current.stop();
      }
      stream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl]
  );
  useEffect(() => {
    if (audioUrl)
      player.current?.play().catch(() => {
        if (mounted.current) setNotice("Your spoken answer is ready. Press Play to listen.");
      });
  }, [audioUrl]);
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(t => t.stop());
    setRecording(false);
  }
  async function start() {
    setError("");
    setNotice("");
    setWorking(true);
    player.current?.pause();
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach(t => t.stop());
        return;
      }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t =>
        MediaRecorder.isTypeSupported(t)
      );
      if (!mime)
        throw new Error(
          "This browser cannot record a supported audio format. Try Chrome or Safari."
        );
      const rec = new MediaRecorder(media, { mimeType: mime });
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = e => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onerror = () => {
        stop();
        setError("Microphone recording failed. Please try again.");
      };
      rec.onstop = async () => {
        if (!mounted.current) return;
        setRecording(false);
        setWorking(true);
        const body = new FormData();
        body.append("file", new Blob(chunks, { type: rec.mimeType }), "question.audio");
        try {
          const result = await api<{ text: string; language_code?: string }>(
            `/meetings/${meetingId}/voice/transcribe`,
            {
              method: "POST",
              headers: { "X-Local-Settings": "1" },
              body,
              signal: abort.current.signal,
            }
          );
          if (mounted.current) {
            onQuestion(result.text);
            setNotice(
              `Question transcribed${result.language_code ? ` (${result.language_code})` : ""}. Review it below, then press Send.`
            );
          }
        } catch (e) {
          if (mounted.current) setError((e as Error).message);
        } finally {
          if (mounted.current) setWorking(false);
        }
      };
      rec.start();
      setRecording(true);
      timer.current = setTimeout(stop, 60000);
    } catch (e) {
      stream.current?.getTracks().forEach(t => t.stop());
      if (mounted.current)
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Microphone permission was denied. Allow microphone access in your browser and try again."
            : (e as Error).message
        );
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  async function listen() {
    if (!lastAnswer) return;
    setError("");
    setWorking(true);
    player.current?.pause();
    try {
      const response = await fetch(`/api/meetings/${meetingId}/messages/${lastAnswer.id}/speech`, {
        method: "POST",
        headers: { "X-Local-Settings": "1" },
        signal: abort.current.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail ?? "Voice playback failed. Please try again.");
      }
      const blob = await response.blob();
      if (!mounted.current) return;
      setAudioUrl(URL.createObjectURL(blob));
      setNotice("Your spoken answer is ready. Press Play to listen.");
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <section className="voice-assistant" aria-label="Voice assistant">
      <button
        className="voice-toggle"
        aria-expanded={open}
        onClick={() => {
          if (recording) stop();
          setOpen(!open);
        }}
      >
        <AudioLines size={18} />
        <strong>Voice assistant</strong>
        <span>{connected ? "ElevenLabs connected" : "Connect ElevenLabs"}</span>
      </button>
      {open && (
        <div className="voice-panel">
          {!connected ? (
            <>
              <p>Connect ElevenLabs to ask spoken questions and hear answers from this meeting.</p>
              <Button variant="outline" onClick={onSettings}>
                Open voice settings
              </Button>
            </>
          ) : (
            <>
              <p>
                Record a question (up to 60 seconds), review the transcription, and send it. Then
                generate a spoken reply.
              </p>
              {!aiEnabled && (
                <p className="voice-warning">
                  Connect Claude or OpenAI in Settings to answer your questions first.
                </p>
              )}
              <div className="voice-buttons">
                <Button
                  variant="outline"
                  disabled={
                    !ready || !aiEnabled || (!recording && (working || sending || !supported))
                  }
                  onClick={recording ? stop : start}
                >
                  {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
                  {recording ? "Stop recording" : "Ask by voice"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!lastAnswer || recording || working || sending}
                  onClick={listen}
                >
                  <Volume2 size={16} />
                  Speak latest answer
                </Button>
              </div>
              {!supported && (
                <p className="voice-warning">
                  Microphone recording needs a supported browser on localhost or HTTPS.
                </p>
              )}
              {recording && (
                <p className="recording-indicator" role="status">
                  ● Recording… press Stop when finished.
                </p>
              )}
              {working && (
                <p role="status">
                  <Loader2 size={14} className="spin" /> Processing voice…
                </p>
              )}
              <small>
                Uses ElevenLabs credits. Audio questions and answer text are sent to ElevenLabs.
              </small>
            </>
          )}
          {notice && (
            <p className="voice-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="voice-error" role="alert">
              {error}
            </p>
          )}
          {audioUrl && (
            <audio ref={player} controls src={audioUrl} aria-label="Spoken meeting answer" />
          )}
        </div>
      )}
    </section>
  );
}
