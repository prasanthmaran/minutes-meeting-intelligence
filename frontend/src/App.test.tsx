import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
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
  expect(await screen.findByText("Demo · no API key")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Explore a sample/ })).toBeEnabled();
});

it("opens upload instructions and closes with escape", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "New meeting" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText(/250 KB/)).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Demo · no API key")).toBeInTheDocument());
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
