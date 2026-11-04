export type Source = { id: string; start: number; end: number; text: string };
export type Turn = { id: number; seconds: number; speaker: string; text: string };
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
};
export type Detail = Meeting & {
  turns: Turn[];
  sources: Source[];
  notes: { summary: Note[]; decisions: Note[]; actions: Note[]; questions: Note[] } | null;
};
export type Message = { id: string; role: string; content: string; citations: Source[] };
