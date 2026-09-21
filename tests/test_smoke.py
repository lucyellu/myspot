"""Smoke tests for myspot's parsers and indexer pieces.

Run with:
    cd C:/Users/lucyl/Desktop/myspot
    python -m tests.test_smoke
"""
import sys
import tempfile
import os
from pathlib import Path

# Ensure the package import works whether run as `python -m tests.test_smoke`
# or `python tests/test_smoke.py`.
_root = Path(__file__).resolve().parent.parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))


PASSED = 0
FAILED: list[str] = []


def check(name, cond, detail=""):
    global PASSED
    if cond:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL {name}: {detail}")


# ----- lyrics parser -----
def test_lyrics_parser():
    print("[lyrics parser]")
    from backend.lyrics import parse_lyrics_text
    text = """[Intro]
(Hoo-ooh)
(Haa-ah)

[Verse]
Echoes in the hall
Underneath it all
"""
    rows = parse_lyrics_text(text)
    check("returns 4 rows", len(rows) == 4, f"got {len(rows)}")
    check("first row in Intro", rows[0][2] == "Intro")
    check("third row in Verse", rows[2][2] == "Verse")
    check("verse text preserved", rows[2][1] == "Echoes in the hall")
    check("idx is sequential", [r[0] for r in rows] == [0, 1, 2, 3])

    # Edge: no sections
    rows2 = parse_lyrics_text("just one line\nanother line")
    check("no-section yields rows", len(rows2) == 2)
    check("no section is None", rows2[0][2] is None)

    # Edge: empty
    check("empty parses", parse_lyrics_text("") == [])


# ----- derivative inference -----
def test_derivatives():
    print("[derivatives]")
    from backend.derivatives import split_version, kind_from_title, build_relationships

    check("v3 strips", split_version("Atmos 4 v3") == ("Atmos 4", 3))
    check("no v defaults to 1", split_version("Echoes") == ("Echoes", 1))
    check("trailing space ok", split_version("Echoes v2  ")[0] == "Echoes")
    check("V uppercase ignored as filename ext", split_version("Stan mashup v4") == ("Stan mashup", 4))

    check("mashup detected", kind_from_title("Stan mashup") == "mashup")
    check("cover detected", kind_from_title("Eminem cover") == "cover")
    check("remix detected", kind_from_title("Tie Me Down (Remix)") == "remix")
    check("default version", kind_from_title("Echoes") == "version")

    songs = [
        {"id": 10, "account": "a", "base_title": "X", "version": 1, "title": "X"},
        {"id": 11, "account": "a", "base_title": "X", "version": 2, "title": "X v2"},
        {"id": 12, "account": "a", "base_title": "X", "version": 3, "title": "X v3"},
        {"id": 13, "account": "b", "base_title": "X", "version": 1, "title": "X"},
        {"id": 14, "account": "a", "base_title": "Y", "version": 1, "title": "Y mashup"},
    ]
    rels = build_relationships(songs)
    parents = {(r[0], r[1]) for r in rels}
    check("parent->v2 link", (10, 11) in parents)
    check("parent->v3 link", (10, 12) in parents)
    check("cross-account does not link", (10, 13) not in parents and (13, 10) not in parents)
    check("singleton in account 'b' has no rels", not any(r[0] == 13 or r[1] == 13 for r in rels))
    check("singleton 'Y' has no rels", not any(r[0] == 14 or r[1] == 14 for r in rels))


# ----- cache lookup -----
def test_cache_lookup():
    print("[cache lookup]")
    from backend.sunosync_cache import SunoSyncCache
    import json

    with tempfile.TemporaryDirectory() as td:
        cache_file = Path(td) / "library_cache.json"
        cache_data = {
            "C:/old/path/to/Echoes v2.mp3": {
                "id": "abc-123", "title": "Echoes", "artist": "x",
                "genre": "moody, dreamy", "bpm": "120", "prompt": "atmospheric",
                "mtime": 1000,
            },
            "C:/different/path/Echoes v2.mp3": {
                "id": "abc-NEW", "title": "Echoes", "mtime": 2000,
            },
        }
        cache_file.write_text(json.dumps(cache_data))
        cache = SunoSyncCache(cache_file)
        ok = cache.load()
        check("loaded", ok)
        # Most recent mtime wins on basename collision
        e = cache.lookup("Echoes v2.mp3")
        check("collision: newer mtime wins", e and e.get("id") == "abc-NEW")

        check("missing returns None", cache.lookup("nope.mp3") is None)
        check("bpm parser handles dash", SunoSyncCache.parse_bpm("--") is None)
        check("bpm parser handles int", SunoSyncCache.parse_bpm("120") == 120)
        check("bpm parser handles float", SunoSyncCache.parse_bpm("87.5") == 87)
        check(
            "genre normalizes",
            SunoSyncCache.normalize_genre("moody, dreamy,, --, atmospheric") == "moody, dreamy, atmospheric",
        )
        check("empty genre is None", SunoSyncCache.normalize_genre("") is None)


# ----- end-to-end indexer round-trip on a tiny temp library -----
def test_indexer_roundtrip():
    print("[indexer round-trip]")
    import sqlite3, json
    from backend import config as cfg
    from backend.library import index_suno_library, index_assets, rebuild_relationships
    from backend.db import init_db
    from backend.sunosync_cache import SunoSyncCache

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        suno = td / "suno_library"
        acct = suno / "sunosync_test"
        acct.mkdir(parents=True)
        # Create a fake mp3 + jpg + txt triplet (mp3 is just empty bytes — mutagen will fail gracefully)
        (acct / "Song A.mp3").write_bytes(b"\x00")
        (acct / "Song A.jpg").write_bytes(b"\x00")
        (acct / "Song A.txt").write_text("[Verse]\nfirst line\n")
        (acct / "Song A v2.mp3").write_bytes(b"\x00")
        (acct / "Song A v2.txt").write_text("[Verse]\nsecond line\n")

        # Tiny cache hit
        cache = SunoSyncCache.__new__(SunoSyncCache)
        cache._by_basename = {
            "Song A.mp3": {
                "id": "uuid-A", "title": "Song A", "genre": "test, pop",
                "bpm": "100", "prompt": "make it good", "duration": 30.0,
            }
        }
        cache.loaded = True
        cache.entry_count = 1

        # Patch config for the duration of the test
        old_db = cfg.DB_PATH
        old_lib = cfg.SUNO_LIBRARY
        old_assets = cfg.ASSETS_DIR
        cfg.DB_PATH = td / "myspot.db"
        cfg.SUNO_LIBRARY = suno
        cfg.ASSETS_DIR = td / "assets"
        cfg.ASSETS_DIR.mkdir()
        conn = None
        try:
            from importlib import reload
            from backend import db
            reload(db)
            from backend import library
            reload(library)
            conn = library.init_db()
            stats = library.index_suno_library(conn, cache, verbose=False)
            check("inserted 2 songs", stats["songs_inserted"] == 2)
            n_rels = library.rebuild_relationships(conn)
            check("1 derivative relationship", n_rels == 1, f"got {n_rels}")

            # Cache fields landed
            row = conn.execute(
                "SELECT suno_id, genre, bpm, prompt FROM songs WHERE base_title='Song A' AND version=1"
            ).fetchone()
            check("cache suno_id present", row[0] == "uuid-A")
            check("cache genre present", row[1] == "test, pop")
            check("cache bpm parsed", row[2] == 100)
            check("cache prompt present", row[3] == "make it good")

            # Lyrics rows
            n_lines = conn.execute(
                "SELECT COUNT(*) FROM lyric_lines WHERE song_id IN (SELECT id FROM songs)"
            ).fetchone()[0]
            check("2 lyric lines indexed", n_lines == 2)

            # FTS populated
            fts = conn.execute(
                "SELECT COUNT(*) FROM lyric_fts WHERE lyric_fts MATCH 'first'"
            ).fetchone()[0]
            check("FTS finds 'first'", fts == 1)
        finally:
            if conn is not None:
                try: conn.close()
                except Exception: pass
            cfg.DB_PATH = old_db
            cfg.SUNO_LIBRARY = old_lib
            cfg.ASSETS_DIR = old_assets
            from importlib import reload
            from backend import db, library  # noqa
            reload(db); reload(library)
            import gc; gc.collect()


def test_ai_registry():
    print("[ai registry]")
    from backend.ai import enhance_prompt, tool_status

    tools = tool_status()
    check("Groq prompt tool registered", tools.get("groq", {}).get("kind") == "prompt")
    check("Cerebras prompt tool registered", tools.get("cerebras", {}).get("kind") == "prompt")
    check("Grok image tool still registered", tools.get("grok", {}).get("kind") == "image")
    check("unknown prompt model errors", "error" in enhance_prompt("not-a-model", {"title": "X"}))


def test_video_filter():
    print("[video filter]")
    from backend.app import list_songs
    res_all = list_songs(limit=10)
    check("list_songs returns items", "items" in res_all)
    res_vid = list_songs(has_video=True, limit=10)
    check("list_songs with has_video=True works", "items" in res_vid)
    for s in res_vid["items"]:
        check("returned song has video", s.get("has_video") is True or s.get("video_path") is not None or s.get("video_only") is True)


def test_channel_rename():
    print("[channel rename & filter]")
    from backend.app import rename_channel, list_channels
    res = rename_channel("test_channel_smoke", {"display_name": "Smoke Display Name"})
    check("rename_channel returns ok", res.get("ok") is True)
    check("rename_channel returns display_name", res.get("display_name") == "Smoke Display Name")
    # Reset name
    res_reset = rename_channel("test_channel_smoke", {"display_name": ""})
    check("reset channel name ok", res_reset.get("display_name") is None)
    # Check main is excluded from list_channels
    channels = list_channels()
    check("main is excluded from channels list", not any(c["account"] == "main" for c in channels))


def test_media_endpoints():
    print("[media endpoints]")
    from fastapi.testclient import TestClient
    from backend.app import app
    client = TestClient(app)
    # Test a song with video (song 32)
    r_audio = client.get("/media/audio/32")
    check("media audio returns 200/206", r_audio.status_code in (200, 206))
    r_video = client.get("/media/video/32")
    check("media video returns 200/206", r_video.status_code in (200, 206))
    r_cover = client.get("/media/cover/32")
    check("media cover returns 200/206", r_cover.status_code in (200, 206))


def test_related_and_lyrics():
    print("[related & lyrics test]")
    from fastapi.testclient import TestClient
    from backend.app import app
    from backend.lyrics import parse_lyrics_text

    client = TestClient(app)
    r_rel = client.get("/api/songs/32/related")
    check("related returns 200", r_rel.status_code == 200)
    items = r_rel.json()
    check("related returns list", isinstance(items, list))
    if items:
        first = items[0]
        check("related item has id", "id" in first)
        check("related item has title", "title" in first)
        check("related item has account", "account" in first)
        check("related item has duration", "duration" in first)

    # Test bracketed cues
    cues = "[Instrumental]\n[Intro]\n[heavy bass synth]\n[Outro]"
    parsed_cues = parse_lyrics_text(cues)
    check("bracketed cues are not dropped", len(parsed_cues) >= 1)


def main():
    test_lyrics_parser()
    test_derivatives()
    test_cache_lookup()
    test_indexer_roundtrip()
    test_ai_registry()
    test_video_filter()
    test_channel_rename()
    test_media_endpoints()
    test_related_and_lyrics()
    print()
    print(f"PASSED: {PASSED}")
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print(f"  - {f}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()

