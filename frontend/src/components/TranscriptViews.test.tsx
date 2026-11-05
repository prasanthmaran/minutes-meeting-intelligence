import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TranscriptViews } from "./TranscriptViews";
import type { Detail } from "../types";

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();

const detail: Detail = {
  id: "m1",
  title: "Launch",
  created_at: "2026-11-06",
  status: "ready",
  mode: "anthropic",
  error: null,
  speakers: ["Maya", "Leo"],
  duration: 60,
  turn_count: 3,
  sources: [],
  turns: [
    { id: 0, seconds: 0, speaker: "Maya", text: "Can we ship Thursday?" },
    { id: 1, seconds: 20, speaker: "Leo", text: "I'm worried the build is broken." },
    { id: 2, seconds: 60, speaker: "Maya", text: "Decision: we ship Thursday." },
  ],
  notes: {
    summary: [],
    decisions: [],
    actions: [],
    questions: [],
    analysis: "ai",
    turn_marks: [
      { turn_id: 0, kinds: ["question"], emotion: "neutral", emotion_note: null },
      { turn_id: 1, kinds: ["risk"], emotion: "anxious", emotion_note: "build may slip" },
      { turn_id: 2, kinds: ["decision"], emotion: "positive", emotion_note: "confident" },
    ],
    speakers: [
      { speaker: "Maya", summary: "Drove the launch decision.", key_points: ["Ship Thursday"] },
      { speaker: "Leo", summary: "Raised a build risk.", key_points: [] },
    ],
  },
};

it("marks questions, items and emotions at the end of each turn and filters them", () => {
  render(<TranscriptViews detail={detail} aiAvailable onReprocess={vi.fn()} />);
  const leo = document.getElementById("turn-1")!;
  expect(within(leo).getByText("Risk")).toBeInTheDocument();
  expect(within(leo).getByText(/Anxious/)).toHaveTextContent("😰 Anxious · build may slip");

  fireEvent.click(screen.getByRole("button", { name: /Questions/ }));
  expect(document.getElementById("turn-0")).toBeInTheDocument();
  expect(document.getElementById("turn-1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Emotions/ }));
  expect(document.getElementById("turn-1")).toBeInTheDocument();
  expect(document.getElementById("turn-0")).not.toBeInTheDocument();
});

it("shows collapsible speaker sections with summaries and talk share", () => {
  render(<TranscriptViews detail={detail} aiAvailable onReprocess={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /By speaker/ }));
  const maya = screen.getByRole("button", { name: /Maya/ });
  expect(maya).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Drove the launch decision.")).toBeInTheDocument();
  const leo = screen.getByRole("button", { name: /Leo/ });
  expect(leo).toHaveAttribute("aria-expanded", "false");
  expect(leo).toHaveTextContent("1 turn · 00:40 talk time");
  fireEvent.click(leo);
  expect(screen.getByText("Raised a build risk.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.queryByText("Drove the launch decision.")).not.toBeInTheDocument();
});

it("timeline moments jump back to the conversation", () => {
  render(<TranscriptViews detail={detail} aiAvailable onReprocess={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /Timeline/ }));
  expect(screen.getByRole("heading", { name: "Key moments" })).toBeInTheDocument();
  // Pin, lane block and key-moment entries all jump to the same turn.
  fireEvent.click(screen.getAllByRole("button", { name: /01:00 Maya: Decision/ })[0]);
  expect(screen.getByRole("tab", { name: /Conversation/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(document.getElementById("turn-2")).toHaveClass("turn-focus");
});

it("offers reprocessing when the meeting has no AI analysis", () => {
  const onReprocess = vi.fn();
  render(
    <TranscriptViews
      detail={{ ...detail, notes: { ...detail.notes!, analysis: "demo", speakers: [] } }}
      aiAvailable
      onReprocess={onReprocess}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Reprocess with Claude" }));
  expect(onReprocess).toHaveBeenCalledOnce();
});
