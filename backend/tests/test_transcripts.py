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


FIXTURE = __import__("pathlib").Path(__file__).parent / "fixtures" / "sales-call-multilingual.txt"


def test_real_world_file_with_comment_header_and_mixed_languages():
    turns = parse_transcript(FIXTURE.read_text(encoding="utf-8"))
    assert len(turns) == 82  # every timestamped line, comment header skipped
    assert turns[0] == {
        "id": 0,
        "seconds": 0,
        "speaker": "Jordan Hale",
        "text": "Hi everyone, thanks for joining. I'm Jordan Hale, account executive at CoralStack. "
        "With me is Divya from solutions.",
    }
    assert turns[5]["text"].startswith("சரி, okay.")
    assert turns[-1]["seconds"] == 15 * 60 + 12
    assert {t["speaker"] for t in turns} == {
        "Jordan Hale",
        "Divya Krishnan",
        "Karthik Menon",
        "Sana Iqbal",
        "Unidentified speaker",
    }
    assert "Quick context: HarborNotes" in turns[8]["text"]  # colons inside text are kept


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "Weekly sync\nDate: 6 Nov\n\n00:05 Maya: Hi\n01:10 Leo: Hello",
            [(5, "Maya", "Hi"), (70, "Leo", "Hello")],
        ),
        (
            "[00:00:01.250] Maya - Hi there\n(00:00:04) Leo: Yes",
            [(1, "Maya", "Hi there"), (4, "Leo", "Yes")],
        ),
        (
            "Maya (00:03): Hi\nLeo [01:00] Sure thing",
            [(3, "Maya", "Hi"), (60, "Leo", "Sure thing")],
        ),
        (
            "Speaker 1  0:03\nHello there\nstill me\n\nSpeaker 2  0:20\nHi",
            [(3, "Speaker 1", "Hello there still me"), (20, "Speaker 2", "Hi")],
        ),
        (
            "00:05:12\nMaya: First\nLeo: Second\n00:06:00\nMaya: Third",
            [(312, "Maya", "First"), (312, "Leo", "Second"), (360, "Maya", "Third")],
        ),
        (
            "[00:00] Maya: This wraps\nonto the next line\n[00:09] okay no speaker",
            [
                (0, "Maya", "This wraps onto the next line"),
                (9, "Unknown speaker", "okay no speaker"),
            ],
        ),
    ],
)
def test_common_line_formats(text, expected):
    assert [(t["seconds"], t["speaker"], t["text"]) for t in parse_transcript(text)] == expected


def test_webvtt_with_voice_tags_merges_consecutive_cues():
    vtt = """WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Maya Chen>Let's start.</v>

2
00:00:03.500 --> 00:00:05.000
<v Maya Chen>Agenda first.</v>

3
00:01:02.000 --> 00:01:04.000
Leo: Sounds good.
"""
    assert [(t["seconds"], t["speaker"], t["text"]) for t in parse_transcript(vtt)] == [
        (1, "Maya Chen", "Let's start. Agenda first."),
        (62, "Leo", "Sounds good."),
    ]


def test_srt_subtitles():
    srt = "1\n00:00:01,000 --> 00:00:02,000\nMaya: Hello\n\n2\n00:00:10,000 --> 00:00:12,000\nLeo: Hi Maya\n"
    assert [(t["seconds"], t["speaker"]) for t in parse_transcript(srt)] == [
        (1, "Maya"),
        (10, "Leo"),
    ]


def test_untimed_transcripts_get_flagged_estimated_times():
    turns = parse_transcript("Maya: " + "word " * 25 + "\nLeo: Short reply")
    assert [t["speaker"] for t in turns] == ["Maya", "Leo"]
    assert turns[0]["seconds"] == 0 and turns[1]["seconds"] == 10  # 25 words ≈ 10 s
    assert all(t["estimated"] for t in turns)


def test_plain_prose_is_rejected_with_supported_formats():
    with pytest.raises(ValueError, match="Supported formats"):
        parse_transcript("Just some notes about the meeting\nwithout any speakers")
