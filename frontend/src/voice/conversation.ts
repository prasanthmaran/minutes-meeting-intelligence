export type ConversationState =
  "idle" | "connecting" | "listening" | "transcribing" | "thinking" | "preparing" | "speaking";
export interface ConversationIO {
  open(signal: AbortSignal): Promise<void>;
  capture(signal: AbortSignal): Promise<Blob>;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  answer(question: string, signal: AbortSignal): Promise<{ id: string; content: string }>;
  speech(id: string, signal: AbortSignal): Promise<Blob>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
  close(): void;
}
export class Conversation {
  private session: AbortController | null = null;
  private turn: AbortController | null = null;
  private current: ConversationState = "idle";
  constructor(
    private io: ConversationIO,
    private changed: (state: ConversationState) => void,
    private heard: (text: string) => void,
    private replied: (text: string) => void,
    private failed: (message: string) => void
  ) {}
  private state(state: ConversationState) {
    this.current = state;
    this.changed(state);
  }
  private ensure(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  }
  async start() {
    if (this.session) return;
    const session = new AbortController();
    this.session = session;
    try {
      this.state("connecting");
      await this.io.open(session.signal);
      this.ensure(session.signal);
      while (!session.signal.aborted) {
        const turn = new AbortController();
        this.turn = turn;
        const cancel = () => turn.abort();
        session.signal.addEventListener("abort", cancel, { once: true });
        try {
          this.state("listening");
          const audio = await this.io.capture(turn.signal);
          this.ensure(turn.signal);
          this.state("transcribing");
          const question = await this.io.transcribe(audio, turn.signal);
          this.ensure(turn.signal);
          if (!question.trim())
            throw new Error("No speech detected. Start again and speak clearly.");
          this.heard(question);
          this.state("thinking");
          const answer = await this.io.answer(question, turn.signal);
          this.ensure(turn.signal);
          this.replied(answer.content);
          this.state("preparing");
          const speech = await this.io.speech(answer.id, turn.signal);
          this.ensure(turn.signal);
          this.state("speaking");
          await this.io.play(speech, turn.signal);
          this.ensure(turn.signal);
        } catch (error) {
          if (!turn.signal.aborted) throw error;
        } finally {
          session.signal.removeEventListener("abort", cancel);
          if (this.turn === turn) this.turn = null;
        }
      }
    } catch (error) {
      if (!session.signal.aborted)
        this.failed(
          (error as Error).name === "NotAllowedError"
            ? "Allow microphone access, then start the conversation again."
            : (error as Error).message
        );
    } finally {
      if (this.session === session) {
        this.session = null;
        this.turn = null;
        this.io.close();
        this.state("idle");
      }
    }
  }
  interrupt() {
    if (this.current === "speaking") this.turn?.abort();
  }
  stop() {
    this.session?.abort();
    this.turn?.abort();
    this.io.close();
  }
}
