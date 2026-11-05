import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceConversation } from "./VoiceConversation";
const sdk = vi.hoisted(() => ({ start: vi.fn(), end: vi.fn(async () => {}), mute: vi.fn() }));
vi.mock("@elevenlabs/client", () => ({ Conversation: { startSession: sdk.start } }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function setup() {
  sdk.start.mockResolvedValue({ endSession: sdk.end, setMicMuted: sdk.mute });
  const fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/session")
        ? { token: "session-token" }
        : {
            sources: [{ id: "one", text: "Sam owns review.", start: 0, end: 5 }],
            complete_transcript: true,
          },
  }));
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    ...render(<VoiceConversation meetingId="selected" disabled={false} onActive={vi.fn()} />),
  };
}
it("connects with a token, scopes evidence, and closes the SDK session", async () => {
  const { fetch, unmount } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Start conversation" }));
  await waitFor(() => expect(sdk.start).toHaveBeenCalled());
  const options = sdk.start.mock.calls[0][0];
  expect(options.conversationToken).toBe("session-token");
  expect(options.connectionType).toBe("webrtc");
  await act(async () => {
    await options.clientTools.meeting_evidence({ question: "Who owns review?" });
  });
  expect(fetch.mock.calls[1][0]).toBe("/api/meetings/selected/voice/evidence");
  expect(screen.getByText(/Evidence retrieved/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(sdk.mute).toHaveBeenCalledWith(true);
  unmount();
  expect(sdk.end).toHaveBeenCalled();
});
it("closes a session that finishes connecting after the user ends it", async () => {
  setup();
  let resolve!: (value: unknown) => void;
  sdk.start.mockImplementationOnce(
    () =>
      new Promise(r => {
        resolve = r;
      })
  );
  fireEvent.click(screen.getByRole("button", { name: "Start conversation" }));
  await waitFor(() => expect(sdk.start).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "End conversation" }));
  await act(async () => {
    resolve({ endSession: sdk.end });
  });
  expect(sdk.end).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start conversation" })).toBeEnabled();
});
it("shows setup failures without starting microphone transport", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ detail: "Enable Agents permissions" }),
    }))
  );
  fireEvent.click(screen.getByRole("button", { name: "Start conversation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enable Agents permissions");
  expect(sdk.start).not.toHaveBeenCalled();
});
