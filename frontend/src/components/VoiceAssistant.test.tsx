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
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ connected: true }),
  }));
  vi.stubGlobal("fetch", fetch);
  render(<VoiceAssistant {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /Voice assistant/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Ask by voice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Microphone permission was denied");
  expect(fetch).toHaveBeenCalledTimes(1);
});
