"""Indexes suno_library/<account>/ track triplets and assets/ media into SQLite."""
import os
import sqlite3
import time
from pathlib import Path

from mutagen.mp3 import MP3
from PIL import Image
import imagehash

# Import the module (not the names) so that a settings change followed by
# config.reload_env() is picked up here without restarting the server —
# `from .config import ASSETS_DIR` would bind the value once at import time.
from . import config
from .db import init_db, tx
from .sunosync_cache import SunoSyncCache
from .sunometa_db import SunoMetaDB
from .lyrics import parse_lyrics_file, parse_lyrics_text
from .derivatives import split_version, build_relationships


AUDIO_EXTS = {".mp3"}
TRACK_VIDEO_EXTS = {".mp4"}  # Suno's video-export, used as a playable fallback when no mp3 exists
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".avi"}


def _try_mp3_duration(mp3_path: Path) -> float | None:
    try:
        return float(MP3(str(mp3_path)).info.length)
    except Exception:
        return None


def _try_mp4_duration(mp4_path: Path) -> float | None:
    try:
        from mutagen.mp4 import MP4
        return float(MP4(str(mp4_path)).info.length)
    except Exception:
        return None


def _try_phash(img_path: Path) -> str | None:
    try:
        with Image.open(img_path) as im:
            im.thumbnail((256, 256))
            return str(imagehash.phash(im))
    except Exception:
        return None


def _try_image_dims(img_path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(img_path) as im:
            return im.width, im.height
    except Exception:
        return None, None


def _prune_songs(conn, song_ids: list[int]) -> None:
    """Delete songs and everything hanging off them."""
    ids = [(i,) for i in song_ids]
    with tx(conn):
        for table, col in (
            ("lyric_lines", "song_id"),
            ("lyric_fts", "song_id"),
            ("playlist_songs", "song_id"),
            ("play_history", "song_id"),
            ("relationships", "parent_id"),
            ("relationships", "child_id"),
        ):
            try:
                conn.executemany(f"DELETE FROM {table} WHERE {col}=?", ids)
            except sqlite3.OperationalError:
                pass  # optional table not present in this schema version
        conn.executemany("DELETE FROM songs WHERE id=?", ids)


def index_suno_library(conn, cache: SunoSyncCache, meta_db: SunoMetaDB | None = None, *,
                       verbose: bool = True, prune: bool = True) -> dict:
    """Walk SUNO_LIBRARY/<account>/*.mp3 and upsert into songs + lyric_lines.

    Existing rows are updated (not duplicated) by mp3_path uniqueness.

    When `prune` is set, song rows whose mp3 lives outside the current library
    root — or has since been deleted — are dropped. Without this, moving the
    library leaves every track indexed twice: once at the old root and once at
    the new one.

    Returns counts dict.
    """
    suno_library = config.SUNO_LIBRARY
    if not suno_library.exists():
        return {"songs": 0, "lyrics": 0, "skipped": 0, "error": "library_missing"}

    inserted = 0
    updated = 0
    lyric_count = 0
    skipped = 0
    pruned_outside = 0
    pruned_missing = 0
    t0 = time.time()

    if prune:
        outside, gone = [], []
        for row in conn.execute("SELECT id, mp3_path, video_path FROM songs"):
            paths = [p for p in (row["mp3_path"], row["video_path"]) if p]
            if not paths:
                continue
            if not any(_is_under(p, suno_library) for p in paths):
                outside.append(row["id"])
            elif not any(Path(p).exists() for p in paths):
                gone.append(row["id"])
        if outside or gone:
            _prune_songs(conn, outside + gone)
            pruned_outside, pruned_missing = len(outside), len(gone)
            if verbose:
                print(f"  ... pruned {pruned_outside} songs outside {suno_library}, "
                      f"{pruned_missing} whose file is gone")

    existing_by_mp3 = {
        row["mp3_path"]: row["id"]
        for row in conn.execute("SELECT id, mp3_path FROM songs WHERE mp3_path IS NOT NULL")
    }
    existing_by_video = {
        row["video_path"]: row["id"]
        for row in conn.execute("SELECT id, video_path FROM songs WHERE video_path IS NOT NULL")
    }
    # Also index by suno_id and by (account, base_title) so hold-path songs
    # get UPDATED (not duplicated) when the same song is found at a new L: location.
    existing_by_suno = {}
    existing_by_title = {}  # key: (account, base_title) → id
    for row in conn.execute("SELECT id, suno_id, account, base_title FROM songs"):
        sid = row["suno_id"]
        if sid and sid not in existing_by_suno:
            existing_by_suno[sid] = row["id"]
        tkey = (row["account"], row["base_title"] or "")
        if tkey not in existing_by_title:
            existing_by_title[tkey] = row["id"]

    with tx(conn):
        for account_dir in sorted(p for p in suno_library.iterdir() if p.is_dir()):
            account = account_dir.name

            # Group files by stem so an mp3 and mp4 for the same track (Suno
            # names both "<title>__<id8>.<ext>") become one song row, and a
            # track with only mp4 (Suno's audio_url returned 403 but the
            # video render is still available) still gets indexed.
            tracks: dict[str, dict[str, Path]] = {}
            for f in account_dir.iterdir():
                if not f.is_file():
                    continue
                ext = f.suffix.lower()
                if ext == ".mp3":
                    tracks.setdefault(f.stem, {})["mp3"] = f
                elif ext in TRACK_VIDEO_EXTS:
                    tracks.setdefault(f.stem, {})["mp4"] = f

            for stem, files in sorted(tracks.items()):
                mp3_file = files.get("mp3")
                mp4_file = files.get("mp4")
                primary = mp3_file or mp4_file
                jpg = primary.with_suffix(".jpg")
                txt = primary.with_suffix(".txt")
                wav = primary.with_suffix(".wav")
                mid = primary.with_suffix(".mid")

                base_title, version = split_version(stem)
                cache_entry = cache.lookup(stem + ".mp3") or {}
                duration = cache_entry.get("duration")
                if duration is None and mp3_file:
                    duration = _try_mp3_duration(mp3_file)
                if duration is None and mp4_file:
                    duration = _try_mp4_duration(mp4_file)
                genre = SunoSyncCache.normalize_genre(cache_entry.get("genre"))
                bpm = SunoSyncCache.parse_bpm(cache_entry.get("bpm"))
                prompt = cache_entry.get("prompt") or None
                suno_id = cache_entry.get("id") or None
                artist = cache_entry.get("artist") or None
                suno_date = cache_entry.get("date") or None
                title = cache_entry.get("title") or stem

                # Enrich with live Suno API metadata if available.
                # For suno_nightly-downloaded files (no library_cache entry), fall
                # back to matching by the local_mp3 path stored in suno_meta.db.
                meta_entry = (meta_db.lookup(suno_id) if meta_db and suno_id else None)
                if meta_entry is None and meta_db and mp3_file:
                    # Fallback 1: match by local_mp3 path (suno_nightly downloads)
                    path_meta = meta_db.lookup_by_path(str(mp3_file))
                    if path_meta:
                        meta_entry = path_meta
                        if not suno_id:
                            suno_id = path_meta.get("id")
                if meta_entry is None and meta_db:
                    # Fallback 2: extract 8-char UUID prefix from __xxxxxxxx filename
                    # suffix — works for mp4-only stems too, since suno_nightly
                    # names both formats "<title>__<id8>".
                    prefix_meta = meta_db.lookup_by_filename_prefix(stem)
                    if prefix_meta:
                        meta_entry = prefix_meta
                        if not suno_id:
                            suno_id = prefix_meta.get("id")
                meta_entry = meta_entry or {}
                suno_play_count   = meta_entry.get("play_count")
                suno_upvote_count = meta_entry.get("upvote_count")
                suno_is_liked     = meta_entry.get("is_liked")
                suno_model        = meta_entry.get("model_name") or None
                suno_style        = meta_entry.get("style") or None
                suno_video_url    = meta_entry.get("video_url") or None
                # library_cache is usually absent, so without this fallback
                # suno_date stays NULL and "recent" degrades to insertion order.
                suno_date         = suno_date or meta_entry.get("created_at") or None

                mp3_path_str   = str(mp3_file).replace("\\", "/") if mp3_file else None
                video_path_str = str(mp4_file).replace("\\", "/") if mp4_file else None
                jpg_path_str = str(jpg).replace("\\", "/") if jpg.exists() else None
                txt_path_str = str(txt).replace("\\", "/") if txt.exists() else None
                wav_path_str = str(wav).replace("\\", "/") if wav.exists() else None
                mid_path_str = str(mid).replace("\\", "/") if mid.exists() else None

                fields = (
                    suno_id, title, base_title, version, artist, account, genre,
                    bpm, prompt, duration, mp3_path_str, video_path_str,
                    jpg_path_str, txt_path_str, wav_path_str, mid_path_str, suno_date,
                    suno_play_count, suno_upvote_count, suno_is_liked,
                    suno_model, suno_style, suno_video_url,
                )

                song_id = None
                if mp3_path_str and mp3_path_str in existing_by_mp3:
                    song_id = existing_by_mp3[mp3_path_str]
                elif video_path_str and video_path_str in existing_by_video:
                    song_id = existing_by_video[video_path_str]
                elif suno_id and suno_id in existing_by_suno:
                    song_id = existing_by_suno[suno_id]
                elif (account, base_title) in existing_by_title:
                    song_id = existing_by_title[(account, base_title)]

                if song_id is not None:
                    conn.execute(
                        """UPDATE songs SET
                            suno_id=?, title=?, base_title=?, version=?, artist=?,
                            account=?, genre=?, bpm=?, prompt=?, duration=?,
                            mp3_path=?, video_path=?, jpg_path=?, txt_path=?, wav_path=?,
                            mid_path=?, suno_date=?,
                            suno_play_count=?, suno_upvote_count=?, suno_is_liked=?,
                            suno_model=?, suno_style=?, suno_video_url=?
                           WHERE id=?""",
                        fields + (song_id,),
                    )
                    updated += 1
                else:
                    cur = conn.execute(
                        """INSERT INTO songs(
                            suno_id, title, base_title, version, artist,
                            account, genre, bpm, prompt, duration,
                            mp3_path, video_path, jpg_path, txt_path, wav_path,
                            mid_path, suno_date,
                            suno_play_count, suno_upvote_count, suno_is_liked,
                            suno_model, suno_style, suno_video_url
                           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        fields,
                    )
                    song_id = cur.lastrowid
                    inserted += 1
                if mp3_path_str:
                    existing_by_mp3[mp3_path_str] = song_id
                if video_path_str:
                    existing_by_video[video_path_str] = song_id

                lyrics_rows = parse_lyrics_file(txt) if txt_path_str else []
                if not lyrics_rows and meta_entry.get("lyrics"):
                    lyrics_rows = parse_lyrics_text(meta_entry["lyrics"])
                if lyrics_rows:
                    conn.execute("DELETE FROM lyric_lines WHERE song_id=?", (song_id,))
                    conn.execute("DELETE FROM lyric_fts WHERE song_id=?", (song_id,))
                    conn.executemany(
                        "INSERT INTO lyric_lines(song_id, idx, text, section) VALUES(?,?,?,?)",
                        [(song_id, i, t, sec) for (i, t, sec) in lyrics_rows],
                    )
                    conn.executemany(
                        "INSERT INTO lyric_fts(text, song_id) VALUES(?,?)",
                        [(t, song_id) for (_, t, _) in lyrics_rows],
                    )
                    lyric_count += len(lyrics_rows)

                if verbose and (inserted + updated) % 200 == 0:
                    print(f"  ... {inserted + updated} songs ({inserted} new)")

    return {
        "songs_inserted": inserted,
        "songs_updated": updated,
        "songs_pruned_outside_root": pruned_outside,
        "songs_pruned_file_missing": pruned_missing,
        "lyric_lines": lyric_count,
        "skipped": skipped,
        "elapsed_sec": round(time.time() - t0, 2),
    }


def rebuild_relationships(conn) -> int:
    rows = conn.execute(
        "SELECT id, account, base_title, version, title FROM songs"
    ).fetchall()
    songs = [dict(r) for r in rows]
    rels = build_relationships(songs)
    with tx(conn):
        conn.execute("DELETE FROM relationships")
        if rels:
            conn.executemany(
                "INSERT OR IGNORE INTO relationships(parent_id, child_id, kind) VALUES(?,?,?)",
                rels,
            )
    return len(rels)


def _is_under(path_str: str, root: Path) -> bool:
    """Case-insensitive prefix check (Windows paths) with / normalisation."""
    a = path_str.replace("\\", "/").rstrip("/").lower()
    b = str(root).replace("\\", "/").rstrip("/").lower()
    return a == b or a.startswith(b + "/")


def index_assets(conn, *, verbose: bool = True, prune: bool = True,
                 progress=None) -> dict:
    """Walk the configured media library (ASSETS_DIR) and index each
    image/video file.

    Folder = first subdir under the library root (used as a tag-ish grouping).

    When `prune` is set, asset rows that live outside the current library root
    are dropped — otherwise pointing the library at a new folder would leave
    the old folder's images stacked on top of the new ones forever.
    """
    assets_dir = config.ASSETS_DIR
    if not assets_dir.exists():
        return {"assets": 0, "error": "assets_missing", "root": str(assets_dir)}

    inserted = 0
    updated = 0
    skipped = 0
    pruned = 0
    t0 = time.time()

    existing = {
        row["file_path"]: row["id"]
        for row in conn.execute("SELECT id, file_path FROM assets")
    }

    if prune:
        stale = [aid for fp, aid in existing.items() if not _is_under(fp, assets_dir)]
        if stale:
            with tx(conn):
                conn.executemany("DELETE FROM assets WHERE id=?", [(i,) for i in stale])
            for fp in [fp for fp in existing if not _is_under(fp, assets_dir)]:
                existing.pop(fp, None)
            pruned = len(stale)
            if verbose:
                print(f"  ... pruned {pruned} assets outside {assets_dir}")

    with tx(conn):
        for path in assets_dir.rglob("*"):
            if not path.is_file():
                continue
            ext = path.suffix.lower()
            if ext in IMAGE_EXTS:
                kind = "image"
            elif ext in VIDEO_EXTS:
                kind = "video"
            else:
                skipped += 1
                continue

            rel = path.relative_to(assets_dir)
            folder = rel.parts[0] if len(rel.parts) > 1 else "_root"
            file_path_str = str(path).replace("\\", "/")

            width = height = None
            phash = None
            duration = None
            if kind == "image":
                width, height = _try_image_dims(path)
                phash = _try_phash(path)

            if file_path_str in existing:
                conn.execute(
                    """UPDATE assets SET kind=?, folder=?, width=?, height=?,
                        duration=?, phash=? WHERE id=?""",
                    (kind, folder, width, height, duration, phash, existing[file_path_str]),
                )
                updated += 1
            else:
                conn.execute(
                    """INSERT INTO assets(kind, file_path, folder, width, height, duration, phash)
                       VALUES(?,?,?,?,?,?,?)""",
                    (kind, file_path_str, folder, width, height, duration, phash),
                )
                inserted += 1
            if (inserted + updated) % 200 == 0:
                # The whole scan runs in one transaction, so a caller polling
                # COUNT(*) sees nothing until commit — report progress directly.
                if progress:
                    progress(inserted + updated)
                if verbose:
                    print(f"  ... {inserted + updated} assets")

    return {
        "assets_inserted": inserted,
        "assets_updated": updated,
        "assets_pruned": pruned,
        "skipped": skipped,
        "root": str(assets_dir),
        "elapsed_sec": round(time.time() - t0, 2),
    }


def full_reindex(verbose: bool = True, scope: str = "all", progress=None) -> dict:
    """scope="all" rescans everything; "assets" rescans only the media library
    (fast — used when just the media folder changed, so switching folders isn't
    gated on a full music rescan); "music" skips the media library."""
    conn = init_db()
    out: dict = {"scope": scope}

    if scope in ("all", "music"):
        cache = SunoSyncCache()
        cache_loaded = cache.load()
        meta_db = SunoMetaDB()
        meta_loaded = meta_db.load()
        if verbose:
            print(f"[cache] loaded={cache_loaded} entries={cache.entry_count}")
            print(f"[suno_meta] loaded={meta_loaded} entries={meta_db.entry_count}")
            print(f"[suno_library] scanning {config.SUNO_LIBRARY}...")
        suno_stats = index_suno_library(conn, cache, meta_db, verbose=verbose)
        if verbose:
            print(f"[suno_library] {suno_stats}")
            print("[derivatives] rebuilding relationships...")
        rel_count = rebuild_relationships(conn)
        if verbose:
            print(f"[derivatives] {rel_count} relationships")
        out["cache"] = {"loaded": cache_loaded, "entries": cache.entry_count}
        out["suno_library"] = suno_stats
        out["relationships"] = rel_count

    if scope in ("all", "assets"):
        if verbose:
            print(f"[assets] scanning {config.ASSETS_DIR}...")
        asset_stats = index_assets(conn, verbose=verbose, progress=progress)
        if verbose:
            print(f"[assets] {asset_stats}")
        out["assets"] = asset_stats

    return out


if __name__ == "__main__":
    import json
    print(json.dumps(full_reindex(), indent=2))
