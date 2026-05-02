import sqlite3
from pathlib import Path

SUNO_META_DB = Path(r"C:\Users\lucyl\Desktop\suno_nightly\suno_meta.db")


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
            if row["local_mp3"]:
                norm = str(row["local_mp3"]).replace("\\", "/")
                self._by_local_path[norm] = d
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
