import sqlite3
import json
import re
from pathlib import Path

from .config import SUNO_META_DB

# Section markers that indicate the prompt is actual lyrics (not just a style tag)
_LYRIC_SECTION_RE = re.compile(
    r"^\s*\[(?:Verse|Chorus|Bridge|Hook|Intro|Outro|Pre-Chorus|Post-Chorus|"
    r"Refrain|Break|Interlude|Drop|Tag|Coda|Ad[ -]?lib|Rap|Spoken|End)",
    re.IGNORECASE | re.MULTILINE,
)


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
        self._handle_by_account: dict[str, str] = {}  # canonical account → suno handle
        self._avatar_by_account: dict[str, str] = {}  # canonical account → suno avatar URL
        self.loaded = False
        self.entry_count = 0

    def load(self) -> bool:
        if not self.path.exists():
            return False
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, account, play_count, upvote_count, is_liked, "
                "model_name, style, video_url, local_mp3, created_at, "
                "lyrics, prompt, raw_meta FROM songs"
            ).fetchall()
        except Exception:
            return False
        finally:
            conn.close()

        # Track handle and avatar counts per account to pick the most common one
        handle_counts: dict[str, dict[str, int]] = {}
        avatar_counts: dict[str, dict[str, int]] = {}

        for row in rows:
            d = dict(row)

            # Extract lyrics, handle, and avatar from raw_meta JSON or prompt column
            raw_meta_str = d.pop("raw_meta", None)
            raw_lyrics = d.get("lyrics") or None  # the dedicated lyrics column
            extracted_lyrics = None
            suno_handle = None
            avatar_url = None

            if raw_meta_str:
                try:
                    raw_meta = json.loads(raw_meta_str)
                    suno_handle = raw_meta.get("handle") or None
                    avatar_url = raw_meta.get("avatar_image_url") or None
                    md = raw_meta.get("metadata") or {}

                    # Extract lyrics from metadata.prompt if not instrumental
                    if not md.get("make_instrumental"):
                        p = md.get("prompt") or ""
                        if p and (
                            _LYRIC_SECTION_RE.search(p)
                            or "\n" in p.strip()
                            or len(p.strip()) > 30
                            or "[" in p
                        ):
                            extracted_lyrics = p
                except (json.JSONDecodeError, TypeError):
                    pass

            if not raw_lyrics and not extracted_lyrics:
                p_col = d.get("prompt")
                if p_col and (
                    _LYRIC_SECTION_RE.search(p_col)
                    or "\n" in p_col.strip()
                    or len(p_col.strip()) > 30
                    or "[" in p_col
                ):
                    extracted_lyrics = p_col

            # Use dedicated lyrics column if populated, else extracted lyrics
            d["lyrics"] = raw_lyrics or extracted_lyrics
            d["suno_handle"] = suno_handle
            d["avatar_image_url"] = avatar_url

            # Track handles and avatars per account for profile resolution
            account = d.get("account")
            if account and suno_handle:
                handle_counts.setdefault(account, {})
                handle_counts[account][suno_handle] = handle_counts[account].get(suno_handle, 0) + 1
            if account and avatar_url:
                avatar_counts.setdefault(account, {})
                avatar_counts[account][avatar_url] = avatar_counts[account].get(avatar_url, 0) + 1

            self._cache[row["id"]] = d
            # Path index: keep highest play_count when multiple songs share a path
            if row["local_mp3"]:
                norm = str(row["local_mp3"]).replace("\\", "/")
                existing = self._by_local_path.get(norm)
                if existing is None or (d.get("play_count") or 0) > (existing.get("play_count") or 0):
                    self._by_local_path[norm] = d

                # Cross-platform relative path index: <account>/<filename>
                # Allows matching between Windows paths (L:/Media/Audio/suno_library/...)
                # and Linux server paths (/home/ubuntu/music/...)
                parts = norm.split("/")
                if len(parts) >= 2:
                    rel = f"{parts[-2]}/{parts[-1]}"
                    existing_rel = self._by_local_path.get(rel)
                    if existing_rel is None or (d.get("play_count") or 0) > (existing_rel.get("play_count") or 0):
                        self._by_local_path[rel] = d
                base = parts[-1]
                existing_b = self._by_local_path.get(base)
                if existing_b is None or (d.get("play_count") or 0) > (existing_b.get("play_count") or 0):
                    self._by_local_path[base] = d

            # Prefix index: 8-char UUID prefix used in __xxxxxxxx filename suffixes
            prefix = row["id"][:8].lower()
            existing_p = self._by_prefix.get(prefix)
            if existing_p is None or (d.get("play_count") or 0) > (existing_p.get("play_count") or 0):
                self._by_prefix[prefix] = d

        # Resolve the most common handle & avatar per account
        for account, counts in handle_counts.items():
            best = max(counts, key=counts.get)
            self._handle_by_account[account] = best
        for account, counts in avatar_counts.items():
            best = max(counts, key=counts.get)
            self._avatar_by_account[account] = best

        self.entry_count = len(self._cache)
        self.loaded = True
        return True

    def lookup(self, suno_id: str) -> dict | None:
        if not suno_id:
            return None
        return self._cache.get(suno_id)

    def lookup_by_path(self, mp3_path: str) -> dict | None:
        """Look up by local_mp3 path — resolves suno_id for suno_nightly files
        that have no library_cache.json entry. Supports cross-platform relative path joins."""
        norm = str(mp3_path).replace("\\", "/")
        hit = self._by_local_path.get(norm)
        if hit:
            return hit
        parts = norm.split("/")
        if len(parts) >= 2:
            hit = self._by_local_path.get(f"{parts[-2]}/{parts[-1]}")
            if hit:
                return hit
        return self._by_local_path.get(parts[-1])


    def lookup_by_filename_prefix(self, stem: str) -> dict | None:
        """Extract the 8-char UUID suffix from a filename like 'Song Title__a1b2c3d4'
        and look up in the prefix index."""
        import re
        m = re.search(r"__([0-9a-f]{8})$", stem, re.IGNORECASE)
        if not m:
            return None
        return self._by_prefix.get(m.group(1).lower())

    def handle_for_account(self, account: str) -> str | None:
        """Return the Suno @handle for a given account name."""
        if not account:
            return None
        if account in self._handle_by_account:
            return self._handle_by_account[account]
        # Strip sunosync_ prefix and date suffixes
        clean = re.sub(r"^sunosync_?", "", account)
        clean = re.sub(r"_\d{4}_[A-Za-z]+_\d{1,2}$", "", clean)
        if clean in self._handle_by_account:
            return self._handle_by_account[clean]
        for acct, handle in self._handle_by_account.items():
            if acct.lower() == clean.lower() or acct.lower() == account.lower():
                return handle
        return None

    def avatar_for_account(self, account: str) -> str | None:
        """Return the Suno avatar image URL for a given account name."""
        if not account:
            return None
        if account in self._avatar_by_account:
            return self._avatar_by_account[account]
        clean = re.sub(r"^sunosync_?", "", account)
        clean = re.sub(r"_\d{4}_[A-Za-z]+_\d{1,2}$", "", clean)
        if clean in self._avatar_by_account:
            return self._avatar_by_account[clean]
        for acct, av in self._avatar_by_account.items():
            if acct.lower() == clean.lower() or acct.lower() == account.lower():
                return av
        return None


