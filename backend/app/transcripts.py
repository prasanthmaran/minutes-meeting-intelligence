"""Tolerant parsing of common transcript exports into timestamped speaker turns.

Supported: "[00:00] Name: text" and variants ("00:00 Name: text", "(00:00:00.000) Name -
text", "Name (00:00): text", "Name [00:00] text"), Otter-style "Name  0:03" header lines
with the text below, a timestamp alone on a line followed by "Name: text" lines,
WebVTT (Zoom, Teams <v Name>) and SRT subtitles, wrapped multi-line turns, comment and
title lines before the conversation, and untimed "Name: text" transcripts (times are
then estimated and flagged). Nothing in the conversation is dropped silently: a line we
cannot place is either attached to the previous turn or reported with its line number.
"""

import re

MAX_TURN = 6000
TS = r"(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)"
NAME = r"([^\s:\[\](){}<>][^:\[\](){}<>]{0,59}?)"
TIMED_FIRST = re.compile(rf"^[\[(]?{TS}[\])]?\s*(?:[-–—|]\s*)?{NAME}\s*(?::|\s[-–—]\s)\s*(.+)$")
NAME_FIRST = re.compile(rf"^{NAME}\s*[\[(]{TS}[\])]\s*[:\-–—]?\s*(.+)$")
HEADER = re.compile(rf"^{NAME}\s+[\[(]?{TS}[\])]?$")  # Otter: "Speaker 1  0:03"
TIME_ONLY = re.compile(rf"^[\[(]?{TS}[\])]?$")
UNTIMED = re.compile(rf"^{NAME}\s*:\s*(.+)$")
TIMED_TEXT = re.compile(rf"^[\[(]?{TS}[\])]?\s+(.+)$")  # timestamp + text, no speaker
CUE = re.compile(rf"^{TS}\s*-->\s*{TS}")
VOICE = re.compile(r"^<v(?:\.[^\s>]+)?\s+([^>]+)>(.*?)(?:</v>)?$")
TAG = re.compile(r"</?[^>]+>")
COMMENT = ("#", "//", "NOTE", "WEBVTT", "Kind:", "Language:")
FORMATS = (
    "Supported formats: [MM:SS] Name: text (HH:MM:SS and milliseconds work), "
    "Name (MM:SS): text, Otter/Google Meet exports, WebVTT (.vtt), SRT (.srt), "
    "or untimed Name: text lines."
)


def timestamp(seconds: int) -> str:
    h, remainder = divmod(seconds, 3600)
    m, s = divmod(remainder, 60)
    return f"{h:02}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"


def to_seconds(clock: str, number: int) -> int:
    parts = [int(p) for p in re.split(r"[.,]", clock)[0].split(":")]
    if any(p >= 60 for p in parts[1:]):
        raise ValueError(f"Line {number}: invalid timestamp {clock}.")
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def clean_speaker(name: str) -> str | None:
    name = name.strip().replace("_", " ")
    name = re.sub(r"\s+", " ", name)
    # Reject things that are clearly not names: URLs, sentences, bare numbers.
    if not name or len(name) > 60 or len(name.split()) > 6 or name.isdigit():
        return None
    if name.lower() in ("http", "https", "note", "warning"):
        return None
    return name


def _append(turns, seconds, speaker, text, number, estimated=False):
    text = text.strip()
    if turns and seconds < turns[-1]["seconds"] and not estimated:
        raise ValueError(f"Line {number}: timestamps must be chronological.")
    turn = {"id": len(turns), "seconds": seconds, "speaker": speaker, "text": text}
    turns.append(turn)
    return turn


def _extend(turn, text, number):
    turn["text"] = f"{turn['text']} {text.strip()}".strip()
    if len(turn["text"]) > MAX_TURN:
        raise ValueError(
            f"Line {number}: speaker turn exceeds 6,000 characters; split it into shorter turns."
        )


def parse_cues(lines: list[str]) -> list[dict]:
    """WebVTT / SRT. Consecutive cues from one speaker are merged into one turn."""
    turns: list[dict] = []
    number, i = 0, 0
    while i < len(lines):
        match = CUE.match(lines[i].strip())
        if not match:
            i += 1
            continue
        number = i + 1
        seconds = to_seconds(match.group(1), number)
        i += 1
        texts = []
        while i < len(lines) and lines[i].strip() and not CUE.match(lines[i].strip()):
            texts.append(lines[i].strip())
            i += 1
        if texts and texts[-1].isdigit():  # SRT index of the next cue without a blank line
            texts.pop()
        speaker, parts = None, []
        for text in texts:
            voice = VOICE.match(text)
            if voice:
                speaker = clean_speaker(TAG.sub("", voice.group(1))) or speaker
                text = voice.group(2)
            text = TAG.sub("", text).strip()
            untimed = UNTIMED.match(text)
            if untimed and not parts and clean_speaker(untimed.group(1)):
                speaker, text = clean_speaker(untimed.group(1)), untimed.group(2)
            if text:
                parts.append(text)
        if not parts:
            continue
        speaker = speaker or (turns[-1]["speaker"] if turns else "Speaker")
        text = " ".join(parts)
        if (
            turns
            and turns[-1]["speaker"] == speaker
            and len(turns[-1]["text"]) + len(text) < MAX_TURN
        ):
            _extend(turns[-1], text, number)
        else:
            _append(turns, seconds, speaker, text, number)
    return turns


def parse_lines(lines: list[str]) -> list[dict]:
    turns: list[dict] = []
    untimed: list[tuple[int, str, str]] = []
    pending_time: int | None = None  # from a timestamp-only line or an Otter header
    pending_speaker: str | None = None
    timed = False
    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or line.startswith(COMMENT):
            continue
        for pattern, order in ((TIMED_FIRST, "ts"), (NAME_FIRST, "name")):
            match = pattern.match(line)
            if match:
                clock, name, text = (
                    match.groups() if order == "ts" else (match[2], match[1], match[3])
                )
                speaker = clean_speaker(name)
                if speaker:
                    timed = True
                    _append(turns, to_seconds(clock, number), speaker, text, number)
                    if len(text) > MAX_TURN:
                        _extend(turns[-1], "", number)
                    pending_time = pending_speaker = None
                    break
        else:
            header = HEADER.match(line)
            if header and clean_speaker(header.group(1)):
                pending_speaker = clean_speaker(header.group(1))
                pending_time = to_seconds(header.group(2), number)
                timed = True
                continue
            loose = TIMED_TEXT.match(line)
            if loose:
                timed = True
                _append(
                    turns,
                    to_seconds(loose.group(1), number),
                    "Unknown speaker",
                    loose.group(2),
                    number,
                )
                pending_time = pending_speaker = None
                continue
            only = TIME_ONLY.match(line)
            if only:
                pending_time = to_seconds(only.group(1), number)
                timed = True
                continue
            plain = UNTIMED.match(line)
            speaker = clean_speaker(plain.group(1)) if plain else None
            if speaker and pending_time is not None:
                _append(turns, pending_time, speaker, plain.group(2), number)
                pending_speaker = None
                continue
            if pending_speaker is not None and pending_time is not None:
                _append(turns, pending_time, pending_speaker, line, number)
                pending_speaker = None
                continue
            if speaker and not timed:
                untimed.append((number, speaker, plain.group(2)))
                continue
            if speaker and turns:
                # "Name: text" after timed turns: same moment as the previous turn.
                _append(turns, turns[-1]["seconds"], speaker, plain.group(2), number)
                continue
            if turns:
                _extend(turns[-1], line, number)  # wrapped text continues the turn
                continue
            if untimed:
                number_, speaker_, text_ = untimed[-1]
                untimed[-1] = (number_, speaker_, f"{text_} {line}")
            # Otherwise a title/date line before the conversation starts: skip it.
    if turns and untimed:
        # Untimed lines before the first timestamp were headers like "Date: 6 Nov".
        untimed = []
    if not turns and untimed:
        seconds = 0.0
        for number, speaker, text in untimed:
            turn = _append(turns, int(seconds), speaker, text, number, estimated=True)
            turn["estimated"] = True
            seconds += max(2.0, len(text.split()) / 2.5)  # ~150 words per minute
    return turns


def parse_transcript(text: str) -> list[dict]:
    lines = text.replace("\ufeff", "").splitlines()
    cues = any(CUE.match(line.strip()) for line in lines)
    turns = parse_cues(lines) if cues else parse_lines(lines)
    if not turns:
        if not any(line.strip() for line in lines):
            raise ValueError("The transcript is empty.")
        raise ValueError(f"No speaker turns found. {FORMATS}")
    for turn in turns:
        if len(turn["text"]) > MAX_TURN:
            raise ValueError(
                f"Turn at {timestamp(turn['seconds'])}: speaker turn exceeds 6,000 characters; "
                "split it into shorter turns."
            )
        if not turn["text"]:
            raise ValueError(f"Turn at {timestamp(turn['seconds'])} has no text.")
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
