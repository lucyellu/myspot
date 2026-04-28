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


def main():
    test_lyrics_parser()
    test_derivatives()
    test_cache_lookup()
    test_indexer_roundtrip()
    print()
    print(f"PASSED: {PASSED}")
    print(f"FAILED: {len(FAILED)}")
    for f in FAILED:
        print(f"  - {f}")
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
