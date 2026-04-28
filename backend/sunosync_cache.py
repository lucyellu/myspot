import json
import os
from pathlib import Path
from .config import SUNOSYNC_CACHE


class SunoSyncCache:
    """Reads SunoSync's library_cache.json. Cache keys are old absolute paths;
    the only reliable join with our suno_library/ files is by basename. Multiple
    cache entries can share a basename if a song was re-downloaded — we keep the
    most recent (highest mtime).
    """

    def __init__(self, path: Path = SUNOSYNC_CACHE):
        self.path = Path(path)
        self._by_basename: dict[str, dict] = {}
        self.loaded = False
        self.entry_count = 0

    def load(self) -> bool:
        if not self.path.exists():
            return False
        with open(self.path, "rb") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return False
        for full_path, entry in data.items():
            if not isinstance(entry, dict):
                continue
            base = os.path.basename(full_path).replace("\\", "/")
            base = os.path.basename(base)
            existing = self._by_basename.get(base)
            if existing is None or (entry.get("mtime") or 0) > (existing.get("mtime") or 0):
                self._by_basename[base] = entry
        self.entry_count = len(self._by_basename)
        self.loaded = True
        return True

    def lookup(self, mp3_path: str | Path) -> dict | None:
        return self._by_basename.get(os.path.basename(str(mp3_path)))

    @staticmethod
    def parse_bpm(raw) -> int | None:
        if raw is None:
            return None
        try:
            v = int(float(str(raw).strip()))
            return v if v > 0 else None
        except (ValueError, TypeError):
            return None

    @staticmethod
    def normalize_genre(raw: str | None) -> str | None:
        if not raw:
            return None
        parts = [p.strip() for p in raw.split(",") if p.strip() and p.strip() != "--"]
        return ", ".join(parts) if parts else None
