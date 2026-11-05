import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "./ui/button";

/** Confirmation before permanently deleting a meeting and everything derived from it. */
export function ConfirmDelete({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Safe default: focus Cancel, not the destructive action.
    dialog.current?.querySelector<HTMLButtonElement>(".confirm-actions button")?.focus();
    return () => previous?.focus();
  }, []);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div
        className="confirm-dialog"
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Escape" && !busy) onCancel();
          if (e.key === "Tab") {
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"),
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
        <span className="confirm-icon" aria-hidden="true">
          <Trash2 size={20} />
        </span>
        <h2 id="confirm-title">Delete “{title}”?</h2>
        <p id="confirm-body">
          This permanently removes the transcript, original file, notes, analysis and chat history.
          It can’t be undone.
        </p>
        {error && (
          <p className="confirm-error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button className="danger-solid" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
            Delete meeting
          </Button>
        </div>
      </div>
    </div>
  );
}
