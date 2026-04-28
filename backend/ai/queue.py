"""Background job queue.

A single worker thread polls the jobs table, runs pending image-gen jobs,
writes status + file_path back to the row + the linked gen row.
Used by 'batch mode' (POST /api/batch) and any sync POST /api/songs/:id/gen
that the user opted to enqueue rather than block on.
"""
import threading
import time
import sqlite3
from . import generate_image
from ..db import connect


class JobQueue:
    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="myspot-queue")
        self._thread.start()

    def stop(self):
        self._stop.set()

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def enqueue(self, conn: sqlite3.Connection, song_id: int, tool: str) -> int:
        """Returns gen_id (the gens row created for this job)."""
        with self._lock:
            cur = conn.execute(
                """INSERT INTO gens(song_id, kind, tool, prompt, status)
                   VALUES(?,?,?,?,?)""",
                (song_id, "image", tool, "", "pending"),
            )
            gen_id = cur.lastrowid
            conn.execute(
                """INSERT INTO jobs(song_id, gen_id, tool, status)
                   VALUES(?,?,?,?)""",
                (song_id, gen_id, tool, "pending"),
            )
        return gen_id

    def _take_one(self, conn: sqlite3.Connection):
        with self._lock:
            row = conn.execute(
                "SELECT id, song_id, gen_id, tool FROM jobs WHERE status='pending' ORDER BY id LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE jobs SET status='running', started_at=datetime('now') WHERE id=?",
                (row["id"],),
            )
        return row

    def _finish(self, conn, job_id, gen_id, ok: bool, file_path=None, error=None, model_version=None):
        with self._lock:
            if ok:
                conn.execute(
                    "UPDATE jobs SET status='completed', finished_at=datetime('now') WHERE id=?",
                    (job_id,),
                )
                conn.execute(
                    """UPDATE gens SET status='completed', file_path=?, model_version=?
                       WHERE id=?""",
                    (file_path, model_version, gen_id),
                )
            else:
                conn.execute(
                    "UPDATE jobs SET status='failed', finished_at=datetime('now'), error=? WHERE id=?",
                    (error, job_id),
                )
                conn.execute(
                    "UPDATE gens SET status='failed', error=? WHERE id=?",
                    (error, gen_id),
                )

    def _loop(self):
        # Each thread needs its own connection.
        conn = connect()
        backoff = 1.5
        while not self._stop.is_set():
            try:
                job = self._take_one(conn)
            except Exception:
                time.sleep(backoff)
                continue
            if job is None:
                time.sleep(backoff)
                continue
            try:
                song = conn.execute(
                    """SELECT id, title, genre, bpm, prompt
                       FROM songs WHERE id=?""",
                    (job["song_id"],),
                ).fetchone()
                lyrics = conn.execute(
                    "SELECT idx, text, section FROM lyric_lines WHERE song_id=? ORDER BY idx LIMIT 8",
                    (job["song_id"],),
                ).fetchall()
                excerpt = " / ".join(l["text"] for l in lyrics)
                prompt_text = build_default_prompt(song, excerpt)
                conn.execute(
                    "UPDATE gens SET prompt=? WHERE id=?",
                    (prompt_text, job["gen_id"]),
                )
                result = generate_image(job["tool"], prompt_text, job["song_id"])
                if "error" in result:
                    self._finish(conn, job["id"], job["gen_id"], ok=False, error=result["error"])
                else:
                    self._finish(
                        conn, job["id"], job["gen_id"], ok=True,
                        file_path=result["file_path"],
                        model_version=result.get("model_version"),
                    )
            except Exception as e:
                self._finish(conn, job["id"], job["gen_id"], ok=False, error=f"{type(e).__name__}: {e}")
            time.sleep(0.5)


def build_default_prompt(song, lyric_excerpt: str) -> str:
    parts = [f'A cinematic music video frame for "{song["title"]}".']
    if song["genre"]:
        parts.append(f"Genre cues: {song['genre']}.")
    if lyric_excerpt:
        parts.append(f"Lyric mood: {lyric_excerpt}.")
    if song["prompt"]:
        parts.append(f"Suno prompt: {song['prompt'][:240]}.")
    parts.append("16:9, atmospheric lighting, high detail, no text.")
    return " ".join(parts)


queue = JobQueue()
