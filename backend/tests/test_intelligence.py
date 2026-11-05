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


def test_search_tokens_keep_any_script_whole():
    from app.intelligence import tokens

    assert tokens("நான் personally chase பண்றேன்") == ["நான்", "personally", "chase", "பண்றேன்"]
    assert tokens("Nos ayudó a no perder dueños") == ["nos", "ayudó", "no", "perder", "dueños"]
    assert tokens("ÉCOLE") == tokens("école")


def test_tamil_question_retrieves_the_tamil_passage():
    from types import SimpleNamespace

    from app.intelligence import lexical_rank

    chunks = [
        SimpleNamespace(id="en", text="Karthik: Slack invite please, Monday works."),
        SimpleNamespace(id="ta", text="Karthik: நான் team-கிட்ட overpromise பண்ண மாட்டேன்."),
    ]
    ranked = lexical_rank(chunks, "overpromise மாட்டேன்")
    assert ranked[0][0].id == "ta"
