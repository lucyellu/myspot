from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"

ASSETS_DIR = ROOT / "assets"
DATA_DIR = ROOT / "data"
GENS_DIR = DATA_DIR / "gens"
EXPORTS_DIR = DATA_DIR / "exports"
SECRETS_DIR = ROOT / "secrets"
DB_PATH = DATA_DIR / "myspot.db"
FRONTEND_DIR = ROOT / "frontend"

HOST = "127.0.0.1"
PORT = 7777


def _parse_env_file(path: Path) -> dict[str, str]:
    """Minimal .env parser — supports KEY=value and KEY="value", ignores
    blank lines and #-comments. Single-quoted values are preserved literally;
    double-quoted values get \\n / \\t escapes interpreted."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="utf-8", errors="replace")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip()
        if not k:
            continue
        if (v.startswith('"') and v.endswith('"')) and len(v) >= 2:
            v = v[1:-1].encode("utf-8").decode("unicode_escape")
        elif (v.startswith("'") and v.endswith("'")) and len(v) >= 2:
            v = v[1:-1]
        # strip trailing inline comment for unquoted values
        elif "#" in v:
            v = v.split("#", 1)[0].rstrip()
        out[k] = v
    return out


_ENV_CACHE = _parse_env_file(ENV_FILE)


def reload_env() -> dict[str, str]:
    """Re-read .env from disk (used by /api/health when the user has just
    edited it without restarting the server)."""
    global _ENV_CACHE, SUNO_LIBRARY, SUNO_META_DB
    _ENV_CACHE = _parse_env_file(ENV_FILE)
    SUNO_LIBRARY = _path_env("SUNO_LIBRARY", _SUNO_LIBRARY_DEFAULT)
    SUNO_META_DB = _path_env("SUNO_META_DB", _SUNO_META_DB_DEFAULT)
    return _ENV_CACHE


def _path_env(name: str, default: str) -> Path:
    """Resolve a path-valued config: process env > .env file > default."""
    v = os.environ.get(name) or _ENV_CACHE.get(name)
    return Path(v.strip()) if v and v.strip() else Path(default)


_SUNO_LIBRARY_DEFAULT = r"C:/Users/lucyl/Desktop/suno_library"
_SUNO_META_DB_DEFAULT = r"C:/Users/lucyl/Desktop/suno-dl/suno_meta.db"

SUNO_LIBRARY  = _path_env("SUNO_LIBRARY",  _SUNO_LIBRARY_DEFAULT)
SUNO_META_DB  = _path_env("SUNO_META_DB",  _SUNO_META_DB_DEFAULT)
SUNOSYNC_CACHE = Path(r"C:/Users/lucyl/Desktop/hold/sunosync/SunoSync/library_cache.json")


def read_secret(name: str) -> str | None:
    """Resolution order:
       1. Process environment variable (highest priority)
       2. secrets/<NAME>.txt (one file per key)
       3. .env file at project root (KEY=value)
    """
    env = os.environ.get(name)
    if env:
        return env.strip()
    f = SECRETS_DIR / f"{name}.txt"
    if f.exists():
        v = f.read_text(encoding="utf-8").strip()
        if v:
            return v
    v = _ENV_CACHE.get(name)
    return v.strip() if v else None


def secret_source(name: str) -> str | None:
    """Which source supplied the given secret, if any (for /api/health)."""
    if os.environ.get(name):
        return "env"
    f = SECRETS_DIR / f"{name}.txt"
    if f.exists() and f.read_text(encoding="utf-8").strip():
        return "secrets/"
    if (_ENV_CACHE.get(name) or "").strip():
        return ".env"
    return None
