"""Transcript analysis for the Transcript tab: per-turn markers and speaker summaries.

AI modes ask the provider in bounded batches and keep only valid turn IDs and speaker
names. Demo mode marks questions from punctuation only; it never guesses emotions or
writes summaries. Analysis is an enhancement: a provider failure here is logged and the
meeting still becomes ready with its notes.
"""

import logging

from .transcripts import timestamp

log = logging.getLogger(__name__)
BATCH = 40  # turns per marking request; keeps output well under the token limit


def demo_marks(turns: list[dict]) -> list[dict]:
    return [
        {"turn_id": t["id"], "kinds": ["question"], "emotion": "neutral", "emotion_note": None}
        for t in turns
        if "?" in t["text"]
    ]


def _prompt_turns(turns: list[dict]) -> list[dict]:
    return [
        {
            "turn_id": t["id"],
            "time": timestamp(t["seconds"]),
            "speaker": t["speaker"],
            "text": t["text"],
        }
        for t in turns
    ]


def ai_marks(provider, turns: list[dict], progress=None) -> list[dict]:
    marks = []
    batches = range(0, len(turns), BATCH)
    if progress:
        progress.start("marks", total=len(batches), detail="Marking questions and emotions")
    for number, offset in enumerate(batches, 1):
        batch = turns[offset : offset + BATCH]
        allowed = {t["id"] for t in batch}
        result = provider.mark_turns(_prompt_turns(batch))
        seen = set()
        for mark in result.turns:
            if mark.turn_id not in allowed or mark.turn_id in seen:
                continue  # never attach a marker to a turn the model was not given
            seen.add(mark.turn_id)
            item = mark.model_dump()
            item["kinds"] = sorted(set(item["kinds"]))
            if item["emotion"] == "neutral":
                item["emotion_note"] = None
            if item["kinds"] or item["emotion"] != "neutral":
                marks.append(item)
        if progress:
            last = min(offset + BATCH, len(turns))
            progress.advance("marks", detail=f"Marked turns {offset + 1}–{last} of {len(turns)}")
    if progress:
        progress.finish("marks", write=False)
    return sorted(marks, key=lambda m: m["turn_id"])


def ai_speakers(provider, turns: list[dict], progress=None) -> list[dict]:
    names = list(dict.fromkeys(t["speaker"] for t in turns))
    if progress:
        progress.start("speakers", detail=f"Summarizing {len(names)} speakers")
    result = provider.summarize_speakers(_prompt_turns(turns), names)
    by_name = {}
    for item in result.speakers:
        if item.speaker in names and item.speaker not in by_name:
            by_name[item.speaker] = {
                "speaker": item.speaker,
                "summary": item.summary.strip(),
                "key_points": [p.strip() for p in item.key_points if p.strip()][:4],
            }
    if progress:
        progress.finish("speakers", write=False)
    return [by_name[name] for name in names if name in by_name]


def analyze(provider, turns: list[dict], progress=None) -> dict:
    """Return {"turn_marks": [...], "speakers": [...], "analysis": status}."""
    if provider is None:
        if progress:
            progress.start("marks", detail="Marking questions")
            progress.finish("marks", write=False)
        return {"turn_marks": demo_marks(turns), "speakers": [], "analysis": "demo"}
    try:
        return {
            "turn_marks": ai_marks(provider, turns, progress),
            "speakers": ai_speakers(provider, turns, progress),
            "analysis": "ai",
        }
    except Exception as exc:  # noqa: BLE001 - analysis must never fail ingestion
        # Never log provider text: it may contain transcript content.
        log.error("transcript_analysis_failed error_type=%s", type(exc).__name__)
        if progress:  # analysis is optional: mark its steps done and continue
            progress.finish("marks", write=False)
            progress.finish("speakers", write=False)
        return {"turn_marks": demo_marks(turns), "speakers": [], "analysis": "failed"}
