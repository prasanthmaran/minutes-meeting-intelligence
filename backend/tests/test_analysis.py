from app.analysis import BATCH, analyze
from app.schemas import SpeakerSummaries, SpeakerSummary, TurnMark, TurnMarks

TURNS = [
    {"id": 0, "seconds": 0, "speaker": "Maya", "text": "Can we ship Thursday?"},
    {"id": 1, "seconds": 20, "speaker": "Leo", "text": "I'm worried the build is broken."},
    {"id": 2, "seconds": 45, "speaker": "Maya", "text": "Decision: we ship Thursday."},
]


class Provider:
    def __init__(self):
        self.batches = []

    def mark_turns(self, turns):
        self.batches.append([t["turn_id"] for t in turns])
        return TurnMarks(
            turns=[
                TurnMark(turn_id=0, kinds=["question"], emotion="neutral", emotion_note="x"),
                TurnMark(turn_id=1, kinds=["risk"], emotion="anxious", emotion_note="build"),
                TurnMark(turn_id=1, kinds=[], emotion="positive", emotion_note=None),  # dup
                TurnMark(turn_id=99, kinds=["decision"], emotion="neutral", emotion_note=None),
                TurnMark(
                    turn_id=2, kinds=["decision", "decision"], emotion="neutral", emotion_note=None
                ),
            ]
        )

    def summarize_speakers(self, turns, speakers):
        assert speakers == ["Maya", "Leo"]
        return SpeakerSummaries(
            speakers=[
                SpeakerSummary(
                    speaker="Leo", summary=" Raised a build risk. ", key_points=["Build"]
                ),
                SpeakerSummary(speaker="Ghost", summary="Invented", key_points=[]),
                SpeakerSummary(
                    speaker="Maya",
                    summary="Drove the decision.",
                    key_points=["a", "b", "c", "d", "e", " "],
                ),
            ]
        )


def test_ai_analysis_keeps_only_valid_turns_and_speakers():
    result = analyze(Provider(), TURNS)
    assert result["analysis"] == "ai"
    assert result["turn_marks"] == [
        {"turn_id": 0, "kinds": ["question"], "emotion": "neutral", "emotion_note": None},
        {"turn_id": 1, "kinds": ["risk"], "emotion": "anxious", "emotion_note": "build"},
        {"turn_id": 2, "kinds": ["decision"], "emotion": "neutral", "emotion_note": None},
    ]
    assert [s["speaker"] for s in result["speakers"]] == ["Maya", "Leo"]  # meeting order
    assert result["speakers"][1]["summary"] == "Raised a build risk."
    assert result["speakers"][0]["key_points"] == ["a", "b", "c", "d"]


def test_long_meetings_are_marked_in_bounded_batches():
    turns = [{"id": i, "seconds": i, "speaker": "A", "text": "ok"} for i in range(BATCH * 2 + 3)]
    provider = Provider()
    provider.summarize_speakers = lambda turns, speakers: SpeakerSummaries(speakers=[])
    analyze(provider, turns)
    assert [len(b) for b in provider.batches] == [BATCH, BATCH, 3]


def test_demo_mode_marks_questions_only():
    result = analyze(None, TURNS)
    assert result == {
        "turn_marks": [
            {"turn_id": 0, "kinds": ["question"], "emotion": "neutral", "emotion_note": None}
        ],
        "speakers": [],
        "analysis": "demo",
    }


def test_provider_failure_keeps_the_meeting_usable():
    class Broken:
        def mark_turns(self, turns):
            raise RuntimeError("provider down")

    result = analyze(Broken(), TURNS)
    assert result["analysis"] == "failed"
    assert result["turn_marks"][0]["kinds"] == ["question"]
