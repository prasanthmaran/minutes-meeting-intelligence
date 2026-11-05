import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OriginalTranscript } from "./OriginalTranscript";
import type { Detail } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const detail = {
  id: "m1",
  title: "Sales call",
  source_name: "sales-call.txt",
  turns: [{ id: 0, seconds: 0, speaker: "Karthik", text: "சரி, okay." }],
} as Detail;

it("shows the uploaded file exactly, with copy and download", async () => {
  const raw = "# header comment\n\n[00:00] Karthik_Menon: சரி, okay.";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => raw }))
  );
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<OriginalTranscript detail={detail} />);
  expect(await screen.findByText("# header comment")).toBeInTheDocument();
  expect(screen.getByText("[00:00] Karthik_Menon: சரி, okay.")).toBeInTheDocument();
  expect(screen.getByText(`3 lines · ${raw.length} characters`)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
    "href",
    "/api/meetings/m1/source?download=1"
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy original text" }));
  await screen.findByText("Copied");
  expect(writeText).toHaveBeenCalledWith(raw);
});

it("rebuilds the text for meetings uploaded before originals were kept", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }))
  );
  render(<OriginalTranscript detail={detail} />);
  expect(await screen.findByText("Reconstructed transcript")).toBeInTheDocument();
  expect(screen.getByText("[00:00] Karthik: சரி, okay.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
});
