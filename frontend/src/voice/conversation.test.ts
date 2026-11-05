import { expect, it, vi } from "vitest";
import { Conversation, type ConversationIO, type ConversationState } from "./conversation";
import { SpeechGate } from "./browserAudio";
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const cancel = () => reject(new DOMException("Stopped", "AbortError"));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup(overrides: Partial<ConversationIO> = {}) {
  const states: ConversationState[] = [];
  const heard = vi.fn(),
    replied = vi.fn(),
    failed = vi.fn();
  const io: ConversationIO = {
    open: vi.fn(async () => {}),
    capture: vi.fn(async () => new Blob(["voice"])),
    transcribe: vi.fn(async () => "Who owns the review?"),
    answer: vi.fn(async () => ({ id: "answer", content: "Sam owns the review." })),
    speech: vi.fn(async () => new Blob(["audio"])),
    play: vi.fn(async () => {}),
    close: vi.fn(),
    ...overrides,
  };
  const engine = new Conversation(io, state => states.push(state), heard, replied, failed);
  return { engine, io, states, heard, replied, failed };
}
it("automatically transcribes, answers, speaks, then listens for the next turn", async () => {
  let captures = 0;
  const s = setup({
    capture: vi.fn(async signal => (++captures === 1 ? new Blob(["voice"]) : aborted(signal))),
  });
  const run = s.engine.start();
  await flush();
  expect(s.states).toEqual([
    "connecting",
    "listening",
    "transcribing",
    "thinking",
    "preparing",
    "speaking",
    "listening",
  ]);
  expect(s.heard).toHaveBeenCalledWith("Who owns the review?");
  expect(s.replied).toHaveBeenCalledWith("Sam owns the review.");
  expect(s.io.play).toHaveBeenCalledOnce();
  s.engine.stop();
  await run;
  expect(s.states.at(-1)).toBe("idle");
  expect(s.failed).not.toHaveBeenCalled();
});
it("interrupts playback and returns to listening without another Start click", async () => {
  let captures = 0;
  const s = setup({
    capture: vi.fn(async signal => (++captures === 1 ? new Blob(["voice"]) : aborted(signal))),
    play: vi.fn((_audio, signal) => aborted(signal)),
  });
  const run = s.engine.start();
  await flush();
  expect(s.states.at(-1)).toBe("speaking");
  s.engine.interrupt();
  await flush();
  expect(s.states.at(-1)).toBe("listening");
  expect(s.io.capture).toHaveBeenCalledTimes(2);
  s.engine.stop();
  await run;
});
it("stops pending transcription without submitting a stale question", async () => {
  const s = setup({ transcribe: vi.fn((_audio, signal) => aborted(signal)) });
  const run = s.engine.start();
  await flush();
  expect(s.states.at(-1)).toBe("transcribing");
  s.engine.stop();
  await run;
  expect(s.io.answer).not.toHaveBeenCalled();
  expect(s.failed).not.toHaveBeenCalled();
});
it("releases microphone and reports provider failures", async () => {
  const s = setup({
    speech: vi.fn(async () => {
      throw new Error("No voice credits");
    }),
  });
  await s.engine.start();
  expect(s.failed).toHaveBeenCalledWith("No voice credits");
  expect(s.io.close).toHaveBeenCalled();
  expect(s.states.at(-1)).toBe("idle");
});
it("waits for actual speech and then 1.2 seconds of silence before committing a turn", () => {
  const gate = new SpeechGate();
  expect(gate.update(0, 5000, 50)).toBe(false);
  for (let now = 5050; now <= 5500; now += 50) expect(gate.update(0.04, now, 50)).toBe(false);
  expect(gate.hasSpeech).toBe(true);
  expect(gate.update(0, 6600, 50)).toBe(false);
  expect(gate.update(0, 6700, 50)).toBe(true);
});
