export type Source = { id: string; start: number; end: number; text: string };
export type Turn = {
  id: number;
  seconds: number;
  speaker: string;
  text: string;
  estimated?: boolean; // time estimated from word count (untimed transcript)
};
export type Note = {
  text: string;
  source_ids: string[];
  owner?: string | null;
  deadline?: string | null;
};
export type Meeting = {
  id: string;
  title: string;
  created_at: string;
  status: string;
  mode: string;
  error: string | null;
  speakers: string[];
  duration: number;
  turn_count: number;
  progress?: Progress | null;
  source_name?: string | null;
};
export type ProgressStep = {
  key: string;
  label: string;
  state: "pending" | "active" | "done" | "failed";
  done: number;
  total: number;
};
export type Progress = {
  steps: ProgressStep[];
  percent: number;
  detail: string;
  started_at: string;
  updated_at: string;
};
export type Detail = Meeting & {
  turns: Turn[];
  sources: Source[];
  notes: {
    summary: Note[];
    decisions: Note[];
    actions: Note[];
    questions: Note[];
    // Transcript analysis (absent on meetings processed before it existed).
    turn_marks?: TurnMark[];
    speakers?: SpeakerSummary[];
    analysis?: "ai" | "demo" | "failed";
  } | null;
};
export type Message = { id: string; role: string; content: string; citations: Source[] };
export type MarkKind = "question" | "decision" | "action" | "risk" | "proposal";
export type Emotion =
  | "neutral"
  | "positive"
  | "excited"
  | "agreement"
  | "concerned"
  | "frustrated"
  | "anxious"
  | "confused"
  | "surprised";
export type TurnMark = {
  turn_id: number;
  kinds: MarkKind[];
  emotion: Emotion;
  emotion_note: string | null;
};
export type SpeakerSummary = { speaker: string; summary: string; key_points: string[] };
