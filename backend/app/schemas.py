from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceItem(StrictModel):
    text: str
    source_ids: list[str]


class Action(EvidenceItem):
    owner: str | None
    deadline: str | None


class Notes(StrictModel):
    summary: list[EvidenceItem]
    decisions: list[EvidenceItem]
    actions: list[Action]
    questions: list[EvidenceItem]


class Answer(StrictModel):
    text: str
    source_ids: list[str]
    insufficient_evidence: bool


class Question(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class QueryRewrite(StrictModel):
    query: str


# Transcript analysis: per-turn markers and per-speaker summaries (AI modes only).
MarkKind = Literal["question", "decision", "action", "risk", "proposal"]
Emotion = Literal[
    "neutral",
    "positive",
    "excited",
    "agreement",
    "concerned",
    "frustrated",
    "anxious",
    "confused",
    "surprised",
]


class TurnMark(StrictModel):
    turn_id: int
    kinds: list[MarkKind]
    emotion: Emotion
    emotion_note: str | None


class TurnMarks(StrictModel):
    turns: list[TurnMark]


class SpeakerSummary(StrictModel):
    speaker: str
    summary: str
    key_points: list[str]


class SpeakerSummaries(StrictModel):
    speakers: list[SpeakerSummary]
