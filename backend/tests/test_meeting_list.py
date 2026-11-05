from app.db import Meeting, backfill_summaries, turn_summary


def add(database, title, speakers, seconds, status="ready", created="2026-11-06T10:00:00"):
    turns = [
        {"id": i, "seconds": seconds * i // max(len(speakers) - 1, 1), "speaker": s, "text": "x"}
        for i, s in enumerate(speakers)
    ]
    with database() as db:
        db.add(
            Meeting(
                title=title,
                turns=turns,
                status=status,
                mode="demo",
                created_at=created,
                **turn_summary(turns),
            )
        )
        db.commit()


def seed(database):
    add(database, "Atlas launch", ["Maya", "Leo"], 900, created="2026-11-01T09:00:00")
    add(database, "budget 100% review", ["Sana Iqbal", "Karthik"], 300, "failed", "2026-11-02")
    add(database, "Zeta sync", ["Maya"], 60, "processing", "2026-11-03T09:00:00")
    add(database, "Beta retro", ["Priya", "Omar", "Sam"], 1800, created="2026-11-04T09:00:00")


def titles(response):
    return [m["title"] for m in response.json()["items"]]


def test_default_is_newest_first_with_counts(client, database):
    seed(database)
    body = client.get("/api/meetings").json()
    assert body["items"][0]["title"] == "Beta retro"
    assert body["total"] == 4 and body["pages"] == 1 and body["page"] == 1
    assert body["counts"] == {"all": 4, "queued": 0, "processing": 1, "ready": 2, "failed": 1}
    assert body["items"][0]["speakers"] == ["Priya", "Omar", "Sam"]
    assert body["items"][0]["duration"] == 1800 and body["items"][0]["turn_count"] == 3


def test_search_matches_title_or_participant_case_insensitively(client, database):
    seed(database)
    assert titles(client.get("/api/meetings", params={"q": "ATLAS"})) == ["Atlas launch"]
    assert titles(
        client.get("/api/meetings", params={"q": "maya", "sort": "title", "order": "asc"})
    ) == [
        "Atlas launch",
        "Zeta sync",
    ]
    # LIKE wildcards in the query are literal text, not patterns.
    assert titles(client.get("/api/meetings", params={"q": "100%"})) == ["budget 100% review"]
    assert titles(client.get("/api/meetings", params={"q": "_"})) == []


def test_status_filter_keeps_counts_for_all_statuses(client, database):
    seed(database)
    body = client.get("/api/meetings", params={"status": "ready", "q": "a"}).json()
    assert {m["status"] for m in body["items"]} == {"ready"}
    assert body["counts"]["failed"] == 1  # counts ignore the status filter, honour search


def test_sorting(client, database):
    seed(database)
    assert titles(client.get("/api/meetings", params={"sort": "title", "order": "asc"})) == [
        "Atlas launch",
        "Beta retro",
        "budget 100% review",
        "Zeta sync",
    ]
    assert titles(client.get("/api/meetings", params={"sort": "duration"}))[0] == "Beta retro"
    assert (
        titles(client.get("/api/meetings", params={"sort": "turns", "order": "asc"}))[0]
        == "Zeta sync"
    )


def test_pagination_and_page_clamping(client, database):
    seed(database)
    first = client.get("/api/meetings", params={"page_size": 3}).json()
    second = client.get("/api/meetings", params={"page_size": 3, "page": 2}).json()
    assert first["pages"] == 2 and len(first["items"]) == 3 and len(second["items"]) == 1
    assert not {m["id"] for m in first["items"]} & {m["id"] for m in second["items"]}
    beyond = client.get("/api/meetings", params={"page_size": 3, "page": 9}).json()
    assert beyond["page"] == 2 and len(beyond["items"]) == 1


def test_invalid_parameters_are_rejected(client):
    for params in ({"sort": "speakers"}, {"status": "done"}, {"page": 0}, {"page_size": 101}):
        assert client.get("/api/meetings", params=params).status_code == 422


def test_backfill_fills_old_rows(database):
    with database() as db:
        db.add(
            Meeting(
                title="Old",
                status="ready",
                mode="demo",
                turns=[
                    {"id": 0, "seconds": 0, "speaker": "A", "text": "x"},
                    {"id": 1, "seconds": 42, "speaker": "B", "text": "y"},
                ],
            )
        )
        db.commit()
    with database() as db:
        assert backfill_summaries(db.connection()) == 1
        db.commit()
        meeting = db.query(Meeting).one()
        assert (meeting.speakers, meeting.duration, meeting.turn_count) == (["A", "B"], 42, 2)
