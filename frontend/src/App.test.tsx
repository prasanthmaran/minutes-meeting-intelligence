import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";

/** Mimics GET /api/meetings: server-side search, status filter, counts and page shape. */
function asPage<T extends { title: string; status: string; speakers: string[] }>(
  items: T[],
  url = ""
) {
  const params = new URL(url || "/api/meetings", "http://test").searchParams;
  const q = (params.get("q") ?? "").toLowerCase();
  const status = params.get("status") ?? "all";
  const searched = items.filter(m => [m.title, ...m.speakers].join(" ").toLowerCase().includes(q));
  const shown = searched.filter(m => status === "all" || m.status === status);
  const count = (s: string) => searched.filter(m => m.status === s).length;
  return {
    items: shown,
    total: shown.length,
    page: 1,
    page_size: 20,
    pages: 1,
    counts: {
      all: searched.length,
      queued: count("queued"),
      processing: count("processing"),
      ready: count("ready"),
      failed: count("failed"),
    },
  };
}
const isList = (url: string) => url.includes("/api/meetings?");

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  // Existing tests run as returning users; the first-run tour has its own tests.
  const stored = new Map<string, string>([
    ["minutes.tourCompleted", "true"],
    ["minutes.meetingTourCompleted", "true"],
  ]);
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
      json: async () =>
        url.endsWith("/health") ? { mode: "demo" } : isList(url) ? asPage([], url) : [],
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
  expect(await screen.findByText("Not connected")).toBeInTheDocument();
  expect(screen.getByLabelText("Anthropic API key")).toBeInTheDocument();
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
        return asPage(
          [
            sampleMeeting,
            {
              ...sampleMeeting,
              id: "two",
              title: "Planning meeting",
              status: "failed",
              speakers: ["Leo"],
            },
          ],
          url
        );
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
  // Debounced server-side search: the list updates once the API responds.
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Planning meeting" })).not.toBeInTheDocument()
  );
  expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining("q=Sam"), undefined);
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
  expect(screen.getByRole("option", { name: "Failed (1)" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter meetings by status"), {
    target: { value: "failed" },
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Launch review" })).not.toBeInTheDocument()
  );
  expect(screen.getByRole("button", { name: "Planning meeting" })).toBeInTheDocument();
  expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining("status=failed"), undefined);
  fireEvent.change(screen.getByLabelText("Search meetings"), { target: { value: "not-present" } });
  expect(
    await screen.findByText("No meetings match your search or status filter.")
  ).toBeInTheDocument();
});

it("keeps Claude status in Settings instead of the main header", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/health") ? { mode: "anthropic" } : isList(url) ? asPage([], url) : [],
    }))
  );
  render(<App />);
  await screen.findByRole("button", { name: /Explore a sample/ });
  expect(screen.queryByText("Claude enabled")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Replace key" })).toBeInTheDocument();
});

it("shows an illustrated empty library with an import action", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "No meetings yet" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Import meetings" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toHaveAttribute("multiple");
});

it("replaces an endless spinner with a recoverable state for a deleted meeting link", async () => {
  window.location.hash = "#/meetings/0b1c2d3e-0000-4000-8000-000000000000";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/meetings/0b1c")
        ? { ok: false, status: 404, json: async () => ({ detail: "Meeting not found." }) }
        : {
            ok: true,
            status: 200,
            json: async () =>
              url.endsWith("/health") ? { mode: "demo" } : isList(url) ? asPage([], url) : [],
          }
    )
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "This meeting isn’t available" })
  ).toBeInTheDocument();
  expect(screen.queryByText(/Loading meeting/)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  // The empty state and the breadcrumb both lead back; use the empty-state action.
  fireEvent.click(screen.getAllByRole("button", { name: /Back to meetings/ }).at(-1)!);
  expect(await screen.findByRole("heading", { name: "No meetings yet" })).toBeInTheDocument();
});

it("imports several transcripts and reports the ones that fail", async () => {
  let created = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const file = (init.body as FormData).get("file") as File;
      if (file.name === "bad.txt")
        return {
          ok: false,
          status: 422,
          json: async () => ({ detail: "Line 1: expected [MM:SS] Speaker: text" }),
        };
      created += 1;
      return {
        ok: true,
        status: 202,
        json: async () => ({ id: `m${created}`, title: file.name, status: "queued" }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/health") ? { mode: "demo" } : isList(url) ? asPage([], url) : [],
    };
  });
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Import meetings" }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const files = ["a.txt", "bad.txt", "c.txt"].map(
    n => new File(["[00:00] A: hi"], n, { type: "text/plain" })
  );
  fireEvent.change(input, { target: { files } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Imported 2 of 3 transcripts. bad.txt: Line 1"
  );
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
});

it("streams processing progress and loads the finished meeting", async () => {
  const sources: FakeEventSource[] = [];
  class FakeEventSource {
    listeners: Record<string, (e: MessageEvent) => void> = {};
    onerror: (() => void) | null = null;
    closed = false;
    constructor(public url: string) {
      sources.push(this);
    }
    addEventListener(type: string, fn: (e: MessageEvent) => void) {
      this.listeners[type] = fn;
    }
    close() {
      this.closed = true;
    }
    emit(type: string, data: unknown) {
      this.listeners[type]?.({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
  vi.stubGlobal("EventSource", FakeEventSource);
  const meeting = {
    id: "m1",
    title: "Launch",
    created_at: "2026-11-06",
    status: "processing",
    mode: "anthropic",
    error: null,
    speakers: ["Maya"],
    duration: 5,
    turn_count: 1,
    turns: [{ id: 0, seconds: 0, speaker: "Maya", text: "Hi" }],
    sources: [],
    notes: null,
    progress: null,
  };
  let ready = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/health")
          ? { mode: "anthropic" }
          : isList(url)
            ? asPage([{ ...meeting, status: ready ? "ready" : "processing" }], url)
            : url.endsWith("/messages")
              ? []
              : ready
                ? {
                    ...meeting,
                    status: "ready",
                    notes: { summary: [], decisions: [], actions: [], questions: [] },
                  }
                : meeting,
    }))
  );
  window.location.hash = "#/meetings/m1";
  render(<App />);
  await waitFor(() => expect(sources).toHaveLength(1));
  expect(sources[0].url).toBe("/api/meetings/m1/events");
  sources[0].emit("progress", {
    status: "processing",
    error: null,
    progress: {
      percent: 40,
      detail: "Marked turns 1–40 of 80",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: [
        {
          key: "marks",
          label: "Marking questions and emotions",
          state: "active",
          done: 1,
          total: 2,
        },
      ],
    },
  });
  expect(await screen.findByText("Marked turns 1–40 of 80")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  ready = true;
  sources[0].emit("done", { status: "ready", error: null, progress: null });
  await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  expect(sources[0].closed).toBe(true);
});

it("falls back to polling when the event stream is buffered", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const closed: boolean[] = [];
  class SilentEventSource {
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      closed.push(false);
    }
    addEventListener() {}
    close() {
      closed[0] = true;
    }
  }
  vi.stubGlobal("EventSource", SilentEventSource);
  const processing = {
    id: "m2",
    title: "Buffered",
    created_at: "2026-11-06",
    status: "processing",
    mode: "anthropic",
    error: null,
    speakers: ["Maya"],
    duration: 5,
    turn_count: 1,
    turns: [{ id: 0, seconds: 0, speaker: "Maya", text: "Hi" }],
    sources: [],
    notes: null,
    progress: {
      percent: 62,
      detail: "Summarizing 4 speakers",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: [],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/health")
          ? { mode: "anthropic" }
          : isList(url)
            ? asPage([processing], url)
            : url.endsWith("/messages")
              ? []
              : processing,
    }))
  );
  window.location.hash = "#/meetings/m2";
  render(<App />);
  expect(await screen.findByText("Live updates")).toBeInTheDocument();
  await vi.advanceTimersByTimeAsync(3100);
  expect(closed[0]).toBe(true);
  expect(await screen.findByText("Checking for updates")).toBeInTheDocument();
  expect(screen.getByText("Summarizing 4 speakers")).toBeInTheDocument();
  vi.useRealTimers();
});

it("shows the six-step product tour on first visit and remembers completion", async () => {
  window.localStorage.removeItem("minutes.tourCompleted");
  render(<App />);
  const tour = await screen.findByRole("dialog", { name: "Welcome to Minutes" });
  expect(tour).toHaveTextContent("Step 1 of 6");
  const titles = [
    "Import transcripts",
    "Your meeting library",
    "Connect Claude and voice",
    "Explore a meeting",
    "Ask with evidence",
  ];
  for (const title of titles) {
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
  }
  expect(screen.getByRole("dialog")).toHaveTextContent("Step 6 of 6");
  expect(screen.getByRole("button", { name: "Try the sample" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(window.localStorage.getItem("minutes.tourCompleted")).toBe("true");
});

it("can be skipped with Escape and replayed from the help button", async () => {
  window.localStorage.removeItem("minutes.tourCompleted");
  render(<App />);
  const tour = await screen.findByRole("dialog", { name: "Welcome to Minutes" });
  fireEvent.keyDown(tour, { key: "ArrowRight" });
  expect(screen.getByRole("dialog", { name: "Import transcripts" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Take the product tour" }));
  expect(screen.getByRole("dialog", { name: "Welcome to Minutes" })).toBeInTheDocument();
});

it("walks a first-time visitor through the meeting page, switching tabs as it goes", async () => {
  window.localStorage.removeItem("minutes.meetingTourCompleted");
  window.history.replaceState(null, "", "/#/meetings/one");
  mockMeetings();
  render(<App />);
  expect(await screen.findByRole("dialog", { name: "Your meeting at a glance" })).toHaveTextContent(
    "Step 1 of 6"
  );
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("dialog", { name: "Overview" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("dialog", { name: "Transcript, four ways" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("dialog", { name: "Action items" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Action items/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("dialog", { name: "Ask your meeting" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("dialog", { name: "Talk to the voice agent" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(window.localStorage.getItem("minutes.meetingTourCompleted")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Take the meeting page tour" }));
  expect(screen.getByRole("dialog", { name: "Your meeting at a glance" })).toBeInTheDocument();
});

it("deletes a meeting from the list after confirmation", async () => {
  mockMeetings();
  const base = window.fetch as unknown as (url: string, init?: RequestInit) => Promise<unknown>;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        calls.push(url);
        return { ok: true, status: 204, json: async () => null };
      }
      return base(url, init);
    })
  );
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete Launch review" }));
  const dialog = screen.getByRole("alertdialog", { name: "Delete “Launch review”?" });
  expect(dialog).toHaveTextContent("can’t be undone");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(calls).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: "Delete Launch review" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete meeting" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(calls).toEqual(["/api/meetings/one"]);
});

it("sorts and pages through meetings on the server", async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const page = Number(new URL(url, "http://t").searchParams.get("page") ?? 1);
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith("/health")
            ? { mode: "demo" }
            : {
                ...asPage([{ ...sampleMeeting, id: `m${page}`, title: `Meeting on page ${page}` }]),
                total: 45,
                page,
                pages: 3,
                counts: { all: 45, queued: 0, processing: 0, ready: 45, failed: 0 },
              },
      };
    })
  );
  render(<App />);
  expect(await screen.findByText("1–20 of 45 meetings")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
  expect(await screen.findByRole("button", { name: "Meeting on page 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

  fireEvent.click(screen.getByTitle("Sort by meeting"));
  await waitFor(() => expect(urls.at(-1)).toContain("sort=title&order=asc&page=1"));
  expect(screen.getByRole("columnheader", { name: /Meeting/ })).toHaveAttribute(
    "aria-sort",
    "ascending"
  );
  fireEvent.click(screen.getByTitle("Sort by meeting"));
  await waitFor(() => expect(urls.at(-1)).toContain("sort=title&order=desc"));

  fireEvent.change(screen.getByLabelText("Meetings per page"), { target: { value: "50" } });
  await waitFor(() => expect(urls.at(-1)).toContain("page_size=50"));
});
