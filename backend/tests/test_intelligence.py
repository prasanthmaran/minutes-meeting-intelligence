import pytest
from app.db import Chunk
from app.intelligence import lexical_rank, validate_notes, validate_sources
from app.schemas import Notes


def test_citations_must_be_nonempty_and_belong_to_context():
    validate_sources(["a"], {"a", "b"})
    for ids in ([], ["c"], ["a", "c"]):
        with pytest.raises(ValueError):
            validate_sources(ids, {"a", "b"})


def test_notes_with_missing_evidence_fail():
    notes = Notes(
        summary=[],
        decisions=[{"text": "Ship now", "source_ids": ["invented"]}],
        actions=[],
        questions=[],
    )
    with pytest.raises(ValueError):
        validate_notes(notes, {"real"})


def test_lexical_retrieval_ranks_relevant_evidence_first():
    chunks = [
        Chunk(id="a", text="Sam owns the security review."),
        Chunk(id="b", text="Priya writes customer announcements."),
    ]
    assert lexical_rank(chunks, "security review")[0][0].id == "a"
    assert lexical_rank(chunks, "volcanoes") == []
