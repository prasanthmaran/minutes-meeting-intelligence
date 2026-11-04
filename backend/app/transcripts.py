"""Strict, lossless parsing of timestamped speaker turns and bounded turn-aware chunks."""

import re

LINE = re.compile(r"^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:\n]{1,80}):\s*(.+)$")


def timestamp(seconds: int) -> str:
    h, remainder = divmod(seconds, 3600)
    m, s = divmod(remainder, 60)
    return f"{h:02}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"


def parse_transcript(text: str) -> list[dict]:
    turns = []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        match = LINE.match(line.strip())
        if not match:
            raise ValueError(
                f"Line {number}: expected [MM:SS] Speaker: text (HH:MM:SS also works)."
            )
        clock, speaker, content = match.groups()
        parts = [int(part) for part in clock.split(":")]
        if any(part >= 60 for part in parts[1:]):
            raise ValueError(f"Line {number}: invalid timestamp.")
        seconds = (
            parts[0] * 60 + parts[1]
            if len(parts) == 2
            else parts[0] * 3600 + parts[1] * 60 + parts[2]
        )
        if turns and seconds < turns[-1]["seconds"]:
            raise ValueError(f"Line {number}: timestamps must be chronological.")
        if len(content) > 6000:
            raise ValueError(
                f"Line {number}: speaker turn exceeds 6,000 characters; split it into shorter turns."
            )
        turns.append(
            {
                "id": len(turns),
                "seconds": seconds,
                "speaker": speaker.strip(),
                "text": content.strip(),
            }
        )
    if not turns:
        raise ValueError("The transcript is empty.")
    return turns


def chunk_turns(turns: list[dict], target_chars: int = 1800) -> list[dict]:
    chunks, start = [], 0
    while start < len(turns):
        end, size = start, 0
        while end < len(turns):
            turn = turns[end]
            length = len(turn["text"]) + len(turn["speaker"]) + 16
            if end > start and size + length > target_chars:
                break
            size += length
            end += 1
        section = turns[start:end]
        chunks.append(
            {
                "ordinal": len(chunks),
                "start": section[0]["seconds"],
                "end": section[-1]["seconds"],
                "text": "\n".join(
                    f"[{timestamp(t['seconds'])}] {t['speaker']}: {t['text']}" for t in section
                ),
            }
        )
        if end == len(turns):
            break
        start = max(start + 1, end - 1)  # one turn of overlap, always making progress
    return chunks
