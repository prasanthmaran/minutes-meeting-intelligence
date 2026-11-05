import { useEffect, useState } from "react";
import { Check, Copy, Download, FileText, Loader2 } from "lucide-react";
import { clock } from "../api";
import { Button } from "./ui/button";
import type { Detail } from "../types";

type State =
  | { kind: "loading" }
  | { kind: "file"; text: string }
  | { kind: "reconstructed"; text: string }
  | { kind: "error"; message: string };

function reconstruct(detail: Detail) {
  return detail.turns.map(t => `[${clock(t.seconds)}] ${t.speaker}: ${t.text}`).join("\n");
}

/** The uploaded file exactly as received, before any parsing or AI processing. */
export function OriginalTranscript({ detail }: { detail: Detail }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/meetings/${detail.id}/source`)
      .then(async response => {
        if (!active) return;
        if (response.ok) setState({ kind: "file", text: await response.text() });
        else if (response.status === 404)
          setState({ kind: "reconstructed", text: reconstruct(detail) });
        else setState({ kind: "error", message: `Could not load the file (${response.status}).` });
      })
      .catch(() => active && setState({ kind: "error", message: "Could not load the file." }));
    return () => {
      active = false;
    };
  }, [detail]);

  if (state.kind === "loading")
    return (
      <div className="original-loading" role="status">
        <Loader2 size={16} className="spin" /> Loading the original file…
      </div>
    );
  if (state.kind === "error") return <p className="transcript-empty">{state.message}</p>;

  const lines = state.text.split(/\r?\n/);
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        state.kind === "error" || state.kind === "loading" ? "" : state.text
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard can be blocked; the text stays selectable. */
    }
  }

  return (
    <div className="original-view">
      <div className="original-bar">
        <FileText size={16} aria-hidden="true" />
        <span className="original-name">
          {state.kind === "file"
            ? (detail.source_name ?? "Uploaded file")
            : "Reconstructed transcript"}
        </span>
        <span className="original-stats">
          {lines.length} lines · {state.text.length.toLocaleString()} characters
        </span>
        <Button variant="ghost" onClick={copy} aria-label="Copy original text">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {state.kind === "file" && (
          <Button variant="outline" asChild>
            <a href={`/api/meetings/${detail.id}/source?download=1`} download>
              <Download size={15} /> Download
            </a>
          </Button>
        )}
      </div>
      {state.kind === "reconstructed" && (
        <p className="original-note">
          This meeting was uploaded before original files were kept, so this is rebuilt from the
          parsed turns. Upload the file again to keep the exact original.
        </p>
      )}
      <pre className="original-text" dir="auto" tabIndex={0} aria-label="Original transcript text">
        {lines.map((line, i) => (
          <span key={i} className="original-line">
            {line || " "}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}
