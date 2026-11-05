import math
import unicodedata
from collections import Counter

from pgvector.sqlalchemy import Vector
from sqlalchemy import cast, select

from .db import Chunk
from .schemas import Answer, Notes

STOP = set(
    "a an the is are was were be been to of for in on and or it we i you our this that what who when how did do does about with me tell please can could would should have has will s".split()
)


def _word_char(ch: str) -> bool:
    # Letters, digits and combining marks: keeps Tamil/Devanagari vowel signs and
    # accented Latin letters inside the word instead of splitting at them.
    return ch.isalnum() or unicodedata.category(ch).startswith("M")


def tokens(text: str) -> list[str]:
    """Language-neutral word tokens for BM25 (any script, case-folded, NFC)."""
    words, current = [], []
    for ch in unicodedata.normalize("NFC", text).casefold():
        if _word_char(ch):
            current.append(ch)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return [word for word in words if word not in STOP]


def lexical_rank(chunks: list[Chunk], query: str) -> list[tuple[Chunk, float]]:
    """Small-corpus BM25; exact keywords complement semantic retrieval."""
    terms = set(tokens(query))
    docs = [Counter(tokens(chunk.text)) for chunk in chunks]
    avg = sum(sum(doc.values()) for doc in docs) / max(len(docs), 1)
    ranked = []
    for chunk, doc in zip(chunks, docs):
        score = 0.0
        for term in terms:
            frequency = doc[term]
            if frequency:
                df = sum(term in d for d in docs)
                idf = math.log(1 + (len(docs) - df + 0.5) / (df + 0.5))
                score += (
                    idf
                    * frequency
                    * 2.5
                    / (frequency + 1.5 * (0.25 + 0.75 * sum(doc.values()) / max(avg, 1)))
                )
        if score > 0:
            ranked.append((chunk, score))
    return sorted(ranked, key=lambda row: row[1], reverse=True)


def retrieve(db, meeting_id: str, query: str, vector: list | None) -> list[Chunk]:
    chunks = list(
        db.scalars(select(Chunk).where(Chunk.meeting_id == meeting_id).order_by(Chunk.ordinal))
    )
    lexical = [chunk for chunk, _ in lexical_rank(chunks, query)]
    if vector is None:
        return lexical[:5]
    if db.bind.dialect.name == "postgresql":
        semantic = list(
            db.scalars(
                select(Chunk)
                .where(Chunk.meeting_id == meeting_id)
                .order_by(cast(Chunk.embedding, Vector(1536)).cosine_distance(vector))
                .limit(8)
            )
        )
    else:

        def cosine(chunk):
            values = chunk.embedding or []
            numerator = sum(a * b for a, b in zip(vector, values))
            denominator = math.sqrt(sum(a * a for a in vector) * sum(b * b for b in values))
            return numerator / denominator if denominator else -1

        semantic = sorted(chunks, key=cosine, reverse=True)[:8]
    # Reciprocal rank fusion avoids mixing incomparable BM25 and cosine scores.
    scores, by_id = {}, {chunk.id: chunk for chunk in chunks}
    for ranking in (lexical[:8], semantic):
        for rank, chunk in enumerate(ranking):
            scores[chunk.id] = scores.get(chunk.id, 0) + 1 / (60 + rank + 1)
    ordered = sorted(scores, key=scores.get, reverse=True)
    selected, size = [], 0
    for chunk_id in ordered:
        chunk = by_id[chunk_id]
        if size + len(chunk.text) > 14000:
            continue
        selected.append(chunk)
        size += len(chunk.text)
        if len(selected) == 5:
            break
    return selected


def source(chunk: Chunk) -> dict:
    return {"id": chunk.id, "start": chunk.start, "end": chunk.end, "text": chunk.text}


def validate_sources(ids: list[str], allowed: set[str]) -> None:
    if not ids or not set(ids).issubset(allowed):
        raise ValueError("Generated content contained missing or invalid citations.")


def validate_notes(notes: Notes, allowed: set[str]) -> None:
    for group in (notes.summary, notes.decisions, notes.actions, notes.questions):
        for item in group:
            validate_sources(item.source_ids, allowed)


def demo_notes() -> dict:
    # No heuristic guesses presented as decisions or assignments.
    return {"summary": [], "decisions": [], "actions": [], "questions": []}


def demo_answer(chunks: list[Chunk]) -> Answer:
    if not chunks:
        return Answer(
            text="I couldn't find matching evidence in this meeting. Try a specific topic or name from the transcript.",
            source_ids=[],
            insufficient_evidence=True,
        )
    return Answer(
        text="Demo mode found these matching transcript passages. Open the evidence below to read what was said. Enable AI mode for a synthesized answer and conversational follow-ups.",
        source_ids=[chunk.id for chunk in chunks[:3]],
        insufficient_evidence=False,
    )
