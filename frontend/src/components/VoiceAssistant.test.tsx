import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceAssistant } from "./VoiceAssistant";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = {
  meetingId: "meeting",
  ready: true,
  aiEnabled: true,
  onQuestion: vi.fn(),
  onSettings: vi.fn(),
  settingsVersion: 0,
  lastAnswer: null,
  sending: false,
  onConversationActive: vi.fn(),
  onConversationTurn: vi.fn(),
  onAISettings: vi.fn(),
};
it("shows an accessible route to ElevenLabs settings before enabling voice", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connected: false }) }))
  );
  render(<VoiceAssistant {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Voice assistant/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open voice settings" }));
  expect(props.onSettings).toHaveBeenCalled();
});
it("requires a generated answer for speech playback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connected: true }) }))
  );
  render(<VoiceAssistant {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Voice assistant/ }));
  fireEvent.click(await screen.findByText("Manual voice controls"));
  expect(await screen.findByRole("button", { name: "Speak latest answer" })).toBeDisabled();
});

it("reports microphone denial without sending audio", async () => {
  vi.stubGlobal("MediaRecorder", class {});
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        throw new DOMException("Denied", "NotAllowedError");
      }),
    },
  });
  const fetch = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ connected: true }),
  }));
  vi.stubGlobal("fetch", fetch);
  render(<VoiceAssistant {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Voice assistant/ }));
  fireEvent.click(await screen.findByText("Manual voice controls"));
  fireEvent.click(await screen.findByRole("button", { name: "Ask by voice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Microphone permission was denied");
  expect(fetch.mock.calls.every(call => !String(call[0]).includes("/transcribe"))).toBe(true);
});

it("opens a dedicated agent window and closes it safely", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/health") ? { mode: "anthropic" } : { connected: true }),
    }))
  );
  render(<VoiceAssistant {...props} meetingTitle="Atlas review" />);
  fireEvent.click(screen.getByRole("button", { name: /Voice assistant/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open conversation agent" }));
  expect(await screen.findByRole("dialog", { name: "Minutes voice agent" })).toBeInTheDocument();
  expect(screen.getByText("Atlas review")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start conversation" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close voice agent and end conversation" }));
  expect(screen.queryByRole("dialog", { name: "Minutes voice agent" })).not.toBeInTheDocument();
});
it("live voice works independently of the text chat provider", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connected: true }) }))
  );
  render(<VoiceAssistant {...props} aiEnabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: /Voice assistant/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Open conversation agent" }));
  expect(screen.queryByRole("button", { name: "Connect Claude" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start conversation" })).toBeEnabled();
});
