"""Filename-based derivative inference.

Suno tracks land on disk with conventions like:
    "Echoes" (original)
    "Echoes v2" (regen)
    "Echoes v3" (regen)
    "Stan Eminem Dido cover - Not so bad 17.4s mashup v4" (cover/mashup with version)

Strategy:
- Strip a trailing " v\\d+" to get base_title and a version int (default 1).
- Group siblings by (account, base_title); lowest version is the "parent".
- Classify kind from base_title substrings: cover|remix|mashup|version.
"""
import re

VERSION_RE = re.compile(r"\s+v(\d+)\s*$", re.IGNORECASE)
COVER_RE = re.compile(r"\bcover\b", re.IGNORECASE)
MASHUP_RE = re.compile(r"\bmash[\s-]?up\b", re.IGNORECASE)
REMIX_RE = re.compile(r"\bremix\b", re.IGNORECASE)


def split_version(title: str) -> tuple[str, int]:
    m = VERSION_RE.search(title)
    if m:
        base = title[: m.start()].strip()
        try:
            return base, int(m.group(1))
        except ValueError:
            return title.strip(), 1
    return title.strip(), 1


def kind_from_title(title: str) -> str:
    if MASHUP_RE.search(title):
        return "mashup"
    if COVER_RE.search(title):
        return "cover"
    if REMIX_RE.search(title):
        return "remix"
    return "version"


def build_relationships(songs: list[dict]) -> list[tuple[int, int, str]]:
    """Returns list of (parent_id, child_id, kind) tuples.

    songs: list of dicts with id, account, base_title, version, title.
    Children are linked to the lowest-versioned sibling within the same
    (account, base_title) group; classification uses the base_title tokens.
    """
    groups: dict[tuple[str, str], list[dict]] = {}
    for s in songs:
        key = (s["account"], s["base_title"].lower())
        groups.setdefault(key, []).append(s)

    rels: list[tuple[int, int, str]] = []
    for (_, _), members in groups.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda x: (x["version"], x["id"]))
        parent = members[0]
        kind = kind_from_title(parent["base_title"])
        for child in members[1:]:
            rels.append((parent["id"], child["id"], kind))
    return rels
