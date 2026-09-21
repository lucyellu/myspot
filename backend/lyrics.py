"""Lyrics parser for Suno-style .txt files.

Format observed in the user's library:
    [Intro]
    (Hoo-ooh-ooh)

    [Verse]
    Echoes in the hall

Bracketed lines are section markers; non-empty plain lines are lyric lines.
Returned rows: list[(idx, text, section)].
"""
import re
from pathlib import Path

KNOWN_SECTION_PREFIXES = (
    "verse", "chorus", "bridge", "hook", "intro", "outro",
    "pre-chorus", "pre chorus", "post-chorus", "post chorus",
    "refrain", "break", "interlude", "drop", "tag", "coda",
    "ad-lib", "ad lib", "adlib", "rap", "spoken", "end",
    "instrumental", "solo", "guitar solo", "piano solo",
    "beat drop", "build", "buildup", "breakdown", "vamp", "fade out", "fade"
)

SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")


def _is_section_header(tag: str) -> bool:
    clean = re.sub(r"[\d\.:\-_]", " ", tag.lower()).strip()
    first_word = clean.split()[0] if clean.split() else ""
    return any(clean.startswith(p) or first_word == p for p in KNOWN_SECTION_PREFIXES)


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
    if not text or not text.strip():
        return []
    raw_lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not raw_lines:
        return []

    # First pass: try standard section + lyric line parsing
    rows: list[tuple[int, str, str | None]] = []
    section: str | None = None
    idx = 0
    for line in raw_lines:
        m = SECTION_RE.match(line)
        if m and _is_section_header(m.group(1)):
            section = m.group(1).strip()
            continue
        # If line is in brackets but not a known section header, strip brackets or keep as lyric
        lyric_text = m.group(1).strip() if m else line
        rows.append((idx, lyric_text, section))
        idx += 1

    # If first pass found no lyrics (e.g. all lines were headers or instrumental cues)
    if not rows and raw_lines:
        for i, line in enumerate(raw_lines):
            m = SECTION_RE.match(line)
            lyric_text = m.group(1).strip() if m else line
            rows.append((i, lyric_text, None))

    return rows

