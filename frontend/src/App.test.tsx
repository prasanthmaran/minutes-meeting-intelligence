import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/health") ? { mode: "demo" } : []),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the empty library and honestly labels demo mode", async () => {
  render(<App />);
  expect(await screen.findByRole("button", { name: /Explore a sample/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByText("Demo · no API key")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Explore a sample/ })).toBeEnabled();
});

it("opens upload instructions and closes with escape", async () => {
  render(<App />);
  fireEvent.click(screen.getAllByRole("button", { name: "Upload transcript" })[0]);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText(/250 KB/)).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Explore a sample/ })).toBeInTheDocument()
  );
});

it("surfaces API errors instead of pretending the library is connected", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Backend unavailable");
    })
  );
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Backend unavailable");
});

const sampleMeeting = {
  id: "one",
  title: "Launch review",
  created_at: "2026-11-05T10:00:00Z",
  status: "ready",
  mode: "demo",
  error: null,
  speakers: ["Maya", "Sam"],
  duration: 120,
  turn_count: 2,
};
function mockMeetings() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => {
        if (url.endsWith("/health")) return { mode: "demo" };
        if (url.endsWith("/messages")) return [];
        if (url.endsWith("/meetings/one"))
          return {
            ...sampleMeeting,
            turns: [],
            sources: [],
            notes: { summary: [], decisions: [], actions: [], questions: [] },
          };
        return [
          sampleMeeting,
          {
            ...sampleMeeting,
            id: "two",
            title: "Planning meeting",
            status: "failed",
            speakers: ["Leo"],
          },
        ];
      },
    }))
  );
}
it("starts on the list, filters meetings, opens details and returns to the list", async () => {
  mockMeetings();
  render(<App />);
  expect(await screen.findByRole("button", { name: "Launch review" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back to meetings" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search meetings"), { target: { value: "Sam" } });
  expect(screen.queryByRole("button", { name: "Planning meeting" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Launch review" }));
  expect(await screen.findByRole("button", { name: "Back to meetings" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/meetings/one");
  fireEvent.click(screen.getByRole("button", { name: "Back to meetings" }));
  expect(await screen.findByRole("heading", { name: "Meetings" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/meetings");
});
it("collapses and expands the sidebar and remembers the preference", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  expect(window.localStorage.getItem("minutes.sidebarCollapsed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await screen.findByRole("button", { name: /Explore a sample/ });
});
it("opens a bookmarked meeting URL and responds to browser route changes", async () => {
  window.history.replaceState(null, "", "/#/meetings/one");
  mockMeetings();
  render(<App />);
  expect(await screen.findByRole("button", { name: "Back to meetings" })).toBeInTheDocument();
  window.history.replaceState(null, "", "/#/meetings");
  fireEvent(window, new HashChangeEvent("hashchange"));
  expect(await screen.findByRole("heading", { name: "Meetings" })).toBeInTheDocument();
});
it("filters the list by status and shows a clear empty result", async () => {
  mockMeetings();
  render(<App />);
  await screen.findByRole("button", { name: "Launch review" });
  fireEvent.change(screen.getByLabelText("Filter meetings by status"), {
    target: { value: "failed" },
  });
  expect(screen.queryByRole("button", { name: "Launch review" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Planning meeting" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search meetings"), { target: { value: "not-present" } });
  expect(screen.getByText("No meetings match your search or status filter.")).toBeInTheDocument();
});

it("keeps Claude status in Settings instead of the main header", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/health") ? { mode: "anthropic" } : []),
    }))
  );
  render(<App />);
  await screen.findByRole("button", { name: /Explore a sample/ });
  expect(screen.queryByText("Claude enabled")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("dialog", { name: "AI settings" })).toBeInTheDocument();
  expect(screen.getByText("Claude enabled")).toBeInTheDocument();
});
