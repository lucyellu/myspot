import sqlite3
from pathlib import Path
from contextlib import contextmanager
from .config import DB_PATH

SCHEMA_VERSION = 3

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suno_id TEXT,
    title TEXT NOT NULL,
    base_title TEXT NOT NULL,
    version INTEGER,
    artist TEXT,
    account TEXT NOT NULL,
    genre TEXT,
    bpm INTEGER,
    prompt TEXT,
    duration REAL,
    mp3_path TEXT NOT NULL UNIQUE,
    jpg_path TEXT,
    txt_path TEXT,
    wav_path TEXT,
    mid_path TEXT,
    suno_date TEXT,
    suno_play_count INTEGER,
    suno_upvote_count INTEGER,
    suno_is_liked INTEGER,
    suno_model TEXT,
    suno_style TEXT,
    suno_video_url TEXT,
    mfcc TEXT,
    liked INTEGER NOT NULL DEFAULT 0,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_songs_account ON songs(account);
CREATE INDEX IF NOT EXISTS idx_songs_base_title ON songs(base_title);
CREATE INDEX IF NOT EXISTS idx_songs_suno_id ON songs(suno_id);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_liked ON songs(liked) WHERE liked=1;

CREATE TABLE IF NOT EXISTS lyric_lines (
    song_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    section TEXT,
    t_start REAL,
    t_end REAL,
    PRIMARY KEY (song_id, idx),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationships (
    parent_id INTEGER NOT NULL,
    child_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (parent_id, child_id, kind),
    FOREIGN KEY (parent_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rel_parent ON relationships(parent_id);
CREATE INDEX IF NOT EXISTS idx_rel_child ON relationships(child_id);

CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    folder TEXT,
    width INTEGER,
    height INTEGER,
    duration REAL,
    phash TEXT,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder);

CREATE TABLE IF NOT EXISTS gens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    tool TEXT NOT NULL,
    prompt TEXT,
    prompt_vars_json TEXT,
    seed TEXT,
    model_version TEXT,
    parent_gen_id INTEGER,
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_gen_id) REFERENCES gens(id)
);
CREATE INDEX IF NOT EXISTS idx_gens_song ON gens(song_id);
CREATE INDEX IF NOT EXISTS idx_gens_status ON gens(status);

CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    tags TEXT,
    template TEXT NOT NULL,
    default_vars_json TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL,
    gen_id INTEGER,
    tool TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    finished_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (gen_id) REFERENCES gens(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS notes (
    song_id INTEGER PRIMARY KEY,
    body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
    song_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (song_id, tag),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_songs (
    playlist_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, song_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL,
    played_at TEXT NOT NULL DEFAULT (datetime('now')),
    ms_played INTEGER,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_history_song ON play_history(song_id);

CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL,
    timeline_json TEXT NOT NULL DEFAULT '{}',
    last_export_path TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edit_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    asset_id INTEGER,
    gen_id INTEGER,
    t_start REAL NOT NULL,
    t_end REAL NOT NULL,
    transition TEXT,
    FOREIGN KEY (edit_id) REFERENCES edits(id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
    FOREIGN KEY (gen_id) REFERENCES gens(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_edit ON clips(edit_id);

CREATE VIRTUAL TABLE IF NOT EXISTS lyric_fts USING fts5(
    text, song_id UNINDEXED
);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> sqlite3.Connection:
    conn = connect()
    conn.executescript(SCHEMA)
    cur = conn.execute("SELECT value FROM meta WHERE key='schema_version'")
    row = cur.fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
    else:
        stored = int(row["value"])
        if stored < 2:
            try:
                conn.execute("ALTER TABLE songs ADD COLUMN mfcc TEXT")
            except Exception:
                pass
        if stored < 3:
            for col, typ in [
                ("suno_play_count",   "INTEGER"),
                ("suno_upvote_count", "INTEGER"),
                ("suno_is_liked",     "INTEGER"),
                ("suno_model",        "TEXT"),
                ("suno_style",        "TEXT"),
                ("suno_video_url",    "TEXT"),
            ]:
                try:
                    conn.execute(f"ALTER TABLE songs ADD COLUMN {col} {typ}")
                except Exception:
                    pass
        if stored < SCHEMA_VERSION:
            conn.execute(
                "UPDATE meta SET value=? WHERE key='schema_version'",
                (str(SCHEMA_VERSION),),
            )
    return conn


@contextmanager
def tx(conn: sqlite3.Connection):
    conn.execute("BEGIN")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
