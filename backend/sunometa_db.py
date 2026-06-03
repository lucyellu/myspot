import sqlite3
from pathlib import Path

from .config import SUNO_META_DB


class SunoMetaDB:
    """
    Reads suno_nightly/suno_meta.db for rich per-song Suno API data:
    play_count, upvote_count, is_liked, model_name, style, video_url.
    Keyed by Suno song UUID (matches songs.suno_id in myspot DB).
    Also supports lookup by local_mp3 path for suno_nightly-downloaded files.
    """

    def __init__(self, path: Path = SUNO_META_DB):
        self.path = Path(path)
        self._cache: dict[str, dict] = {}
        self._by_local_path: dict[str, dict] = {}
        self._by_prefix: dict[str, dict] = {}  # first 8 hex chars of id
        self.loaded = False
        self.entry_count = 0

    def load(self) -> bool:
        if not self.path.exists():
            return False
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, play_count, upvote_count, is_liked, "
                "model_name, style, video_url, local_mp3 FROM songs"
            ).fetchall()
        except Exception:
            return False
        finally:
            conn.close()
        for row in rows:
            d = dict(row)
            self._cache[row["id"]] = d
            # Path index: keep highest play_count when multiple songs share a path
            if row["local_mp3"]:
                norm = str(row["local_mp3"]).replace("\\", "/")
                existing = self._by_local_path.get(norm)
                if existing is None or (d.get("play_count") or 0) > (existing.get("play_count") or 0):
                    self._by_local_path[norm] = d
            # Prefix index: 8-char UUID prefix used in __xxxxxxxx filename suffixes
            prefix = row["id"][:8].lower()
            existing_p = self._by_prefix.get(prefix)
            if existing_p is None or (d.get("play_count") or 0) > (existing_p.get("play_count") or 0):
                self._by_prefix[prefix] = d
        self.entry_count = len(self._cache)
        self.loaded = True
        return True

    def lookup(self, suno_id: str) -> dict | None:
        if not suno_id:
            return None
        return self._cache.get(suno_id)

    def lookup_by_path(self, mp3_path: str) -> dict | None:
        """Look up by local_mp3 path — resolves suno_id for suno_nightly files
        that have no library_cache.json entry."""
        norm = str(mp3_path).replace("\\", "/")
        return self._by_local_path.get(norm)

    def lookup_by_filename_prefix(self, stem: str) -> dict | None:
        """Extract the 8-char UUID suffix from a filename like 'Song Title__a1b2c3d4'
        and look up in the prefix index."""
        import re
        m = re.search(r"__([0-9a-f]{8})$", stem, re.IGNORECASE)
        if not m:
            return None
        return self._by_prefix.get(m.group(1).lower())
