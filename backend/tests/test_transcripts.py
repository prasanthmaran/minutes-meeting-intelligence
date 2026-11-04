import pytest
from app.transcripts import chunk_turns, parse_transcript, timestamp


def test_preserves_speakers_timestamps_and_unicode():
    turns = parse_transcript("[00:00] Maya: Launch café.\n\n[01:02:03] 李: Confirmed.")
    assert turns[1] == {"id": 1, "seconds": 3723, "speaker": "李", "text": "Confirmed."}
    assert timestamp(turns[1]["seconds"]) == "01:02:03"


@pytest.mark.parametrize(
    "text",
    [
        "",
        "No timestamp",
        "[00:61] A: Bad",
        "[01:00] A: Hi\n[00:59] B: Earlier",
        "[00:00] A: " + "x" * 6001,
    ],
)
def test_invalid_transcripts_fail_without_silent_data_loss(text):
    with pytest.raises(ValueError):
        parse_transcript(text)


def test_chunks_overlap_and_cover_every_turn():
    turns = parse_transcript(
        "\n".join(f"[00:{i:02}] Speaker: Unique{i} " + "word " * 15 for i in range(20))
    )
    chunks = chunk_turns(turns, target_chars=250)
    assert len(chunks) > 1
    for turn in turns:
        assert any(turn["text"] in c["text"] for c in chunks)
    assert chunks[0]["text"].splitlines()[-1] == chunks[1]["text"].splitlines()[0]
    assert chunks[-1]["end"] == 19


def test_large_single_turn_does_not_loop_forever():
    turns = parse_transcript("[00:00] A: " + "x" * 5000 + "\n[00:30] B: End")
    assert len(chunk_turns(turns)) == 2
