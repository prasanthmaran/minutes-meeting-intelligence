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
