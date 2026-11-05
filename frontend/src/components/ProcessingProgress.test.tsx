import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProcessingProgress } from "./ProcessingProgress";
import type { Detail } from "../types";

afterEach(cleanup);

const base: Detail = {
  id: "m1",
  title: "Launch",
  created_at: "2026-11-06",
  status: "processing",
  mode: "anthropic",
  error: null,
  speakers: ["Maya", "Leo"],
  duration: 60,
  turn_count: 12,
  turns: [],
  sources: [],
  notes: null,
  progress: {
    percent: 46,
    detail: "Read section 2 of 3 for decisions",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    steps: [
      { key: "read", label: "Reading the transcript", state: "done", done: 0, total: 0 },
      {
        key: "notes",
        label: "Finding decisions and action items",
        state: "active",
        done: 2,
        total: 3,
      },
      {
        key: "marks",
        label: "Marking questions and emotions",
        state: "pending",
        done: 0,
        total: 0,
      },
    ],
  },
};

it("shows streamed steps, live detail and progress", () => {
  render(<ProcessingProgress meeting={base} live onRetry={vi.fn()} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "46");
  expect(screen.getByText("Read section 2 of 3 for decisions")).toBeInTheDocument();
  expect(screen.getByText("2 / 3")).toBeInTheDocument();
  expect(screen.getByText("Reading the transcript").closest("li")).toHaveClass("step-done");
  expect(screen.getByText("Live updates")).toBeInTheDocument();
});

it("shows a queued state before progress exists", () => {
  render(
    <ProcessingProgress
      meeting={{ ...base, status: "queued", progress: null }}
      live
      onRetry={vi.fn()}
    />
  );
  expect(screen.getByRole("heading", { name: "Waiting to start…" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
});

it("offers retry when processing failed", () => {
  const retry = vi.fn();
  render(
    <ProcessingProgress
      meeting={{ ...base, status: "failed", error: "The AI provider limit was reached." }}
      live={false}
      onRetry={retry}
    />
  );
  expect(screen.getByText("The AI provider limit was reached.")).toBeInTheDocument();
  screen.getByRole("button", { name: /Retry processing/ }).click();
  expect(retry).toHaveBeenCalledOnce();
});
