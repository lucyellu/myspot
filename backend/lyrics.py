"""Lyrics parser for Suno-style .txt files.

Format observed in the user's library:
    [Intro]
    (Hoo-ooh-ooh)

    [Verse]
    Echoes in the hall

Bracketed lines are section markers; non-empty plain lines are lyric lines.
Returned rows: list[(idx, text, section)].
"""
from pathlib import Path
import re

SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")


def parse_lyrics_file(path: str | Path) -> list[tuple[int, str, str | None]]:
    p = Path(path)
    if not p.exists():
        return []
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = p.read_text(encoding="utf-8", errors="replace")
    return parse_lyrics_text(text)


def parse_lyrics_text(text: str) -> list[tuple[int, str, str | None]]:
    rows: list[tuple[int, str, str | None]] = []
    section: str | None = None
    idx = 0
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        m = SECTION_RE.match(line)
        if m:
            section = m.group(1).strip()
            continue
        rows.append((idx, line.strip(), section))
        idx += 1
    return rows
