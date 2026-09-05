"""Create a flat, searchable copy of an art library.

Default behavior is a dry run over visual media only. Use --copy to create the
target folder and copy files.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import re
import shutil
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - runtime environment guard
    Image = None
else:
    Image.MAX_IMAGE_PIXELS = None


VISUAL_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".mp4",
    ".mov",
    ".m4v",
    ".avi",
    ".mkv",
}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

GENERIC_STEMS = {
    "image",
    "img",
    "animate",
    "output",
    "untitled",
    "download",
    "generated",
    "final",
}

PROMPT_KEYS = (
    "description",
    "prompt",
    "parameters",
    "comment",
    "caption",
    "title",
    "subject",
)

LOW_VALUE_PROMPT_PATTERNS = (
    r"^creator:\s",
    r"^created with ",
    r"^screenshot$",
    r"^paint\s",
    r"^gimp$",
    r"^adobe\s",
    r"^image$",
)


@dataclass
class MediaInfo:
    width: int | None = None
    height: int | None = None
    prompt: str = ""
    prompt_source: str = ""


def is_under(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def clean_text(value: object, limit: int = 220) -> str:
    text = str(value or "")
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0]
    return text


def maybe_decode(value: object) -> str:
    if isinstance(value, bytes):
        for encoding in ("utf-8", "utf-16", "latin-1"):
            try:
                return value.decode(encoding, errors="ignore")
            except Exception:
                continue
        return ""
    return str(value or "")


def xmp_description(text: str) -> str:
    patterns = [
        r"<dc:description>\s*<rdf:Alt>\s*<rdf:li[^>]*>(.*?)</rdf:li>",
        r"<dc:description>\s*(.*?)\s*</dc:description>",
        r"<rdf:Description[^>]+dc:description=[\"']([^\"']+)[\"']",
        r"<photoshop:Headline>\s*(.*?)\s*</photoshop:Headline>",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I | re.S)
        if match:
            return clean_text(match.group(1))
    return ""


def is_useful_prompt(text: str) -> bool:
    text = clean_text(text)
    if not text:
        return False
    lower = text.lower()
    if any(re.search(pattern, lower) for pattern in LOW_VALUE_PROMPT_PATTERNS):
        return False
    word_count = len(re.findall(r"[a-zA-Z0-9]+", text))
    return len(text) >= 32 or word_count >= 5


def read_image_info(path: Path) -> MediaInfo:
    info = MediaInfo()
    if Image is None:
        return info
    try:
        with Image.open(path) as im:
            info.width = im.width
            info.height = im.height
            raw_info = dict(im.info)
    except Exception:
        return info

    for key, value in raw_info.items():
        if any(fragment in key.lower() for fragment in PROMPT_KEYS):
            text = clean_text(maybe_decode(value))
            if is_useful_prompt(text):
                info.prompt = text
                info.prompt_source = key
                return info

    for key in ("xmp", "XML:com.adobe.xmp"):
        value = raw_info.get(key)
        if value:
            text = xmp_description(maybe_decode(value))
            if is_useful_prompt(text):
                info.prompt = text
                info.prompt_source = key
                return info

    return info


def is_generic_stem(stem: str) -> bool:
    s = stem.strip().lower()
    s = re.sub(r"\s*\(\d+\)$", "", s)
    if s in GENERIC_STEMS:
        return True
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return True
    if re.fullmatch(r"[a-f0-9]{16,}", s):
        return True
    if re.fullmatch(r"[a-f0-9-]{32,}", s):
        return True
    return False


def slugify(text: str, limit: int = 92) -> str:
    text = clean_text(text, limit=500)
    if re.match(r"^-\d", text.strip()):
        text = "minus " + text.strip()[1:]
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    if not text:
        text = "untitled"
    if len(text) > limit:
        text = text[:limit].rstrip("-")
    return text


def source_top(source: Path, path: Path) -> str:
    try:
        rel = path.relative_to(source)
    except ValueError:
        return "_external"
    return rel.parts[0] if len(rel.parts) > 1 else "_root"


def relative_label(source: Path, path: Path, prompt: str) -> tuple[str, str]:
    if prompt:
        return prompt, "prompt"

    stem = path.stem
    top = source_top(source, path)
    try:
        rel_parts = list(path.relative_to(source).parts[:-1])
    except ValueError:
        rel_parts = list(path.parts[:-1])

    context = [part for part in rel_parts[1:] if part and part != top]
    pieces: list[str] = context[-1:] if context and not is_generic_stem(stem) else context[-2:]
    if not is_generic_stem(stem):
        pieces.append(stem)

    if not pieces:
        pieces.append(top if top != "_root" else stem)
    return " ".join(pieces), "path"


def short_hash(source: Path, path: Path) -> str:
    stat = path.stat()
    try:
        rel = str(path.relative_to(source)).replace("\\", "/")
    except ValueError:
        rel = str(path)
    payload = f"{rel}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8", errors="ignore")
    return hashlib.sha1(payload).hexdigest()[:10]


def category_for(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in {".mp4", ".mov", ".m4v", ".avi", ".mkv"}:
        return "video"
    return ext.lstrip(".") or "file"


def destination_name(source: Path, path: Path, info: MediaInfo) -> tuple[str, str]:
    top = slugify(source_top(source, path), limit=36)
    label, label_source = relative_label(source, path, info.prompt)
    label_slug = slugify(label, limit=88)
    dim = ""
    if info.width and info.height:
        dim = f"__{info.width}x{info.height}"
    digest = short_hash(source, path)
    ext = path.suffix.lower() or ".bin"
    name = f"{category_for(path)}__{top}__{label_slug}{dim}__{digest}{ext}"
    if len(name) > 240:
        overflow = len(name) - 240
        label_slug = label_slug[:-overflow].rstrip("-") or "untitled"
        name = f"{category_for(path)}__{top}__{label_slug}{dim}__{digest}{ext}"
    return name, label_source


def iter_files(source: Path, include_non_visual: bool) -> list[Path]:
    files = []
    for path in source.rglob("*"):
        if not path.is_file():
            continue
        if include_non_visual or path.suffix.lower() in VISUAL_EXTS:
            files.append(path)
    return sorted(files, key=lambda p: str(p).lower())


def manifest_path(target: Path, copy: bool, explicit: str | None) -> Path:
    if explicit:
        return Path(explicit)
    if copy:
        return target / "_art_2_manifest.csv"
    return target.parent / f"{target.name}_manifest_dry_run.csv"


def write_manifest_row(writer: csv.DictWriter, row: dict[str, object]) -> None:
    writer.writerow({k: "" if v is None else v for k, v in row.items()})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="L:/Media/Art")
    parser.add_argument("--target", default="L:/Media/Art_2")
    parser.add_argument("--manifest")
    parser.add_argument("--copy", action="store_true", help="Actually copy files. Default is dry run.")
    parser.add_argument(
        "--include-non-visual",
        action="store_true",
        help="Include docs/audio/project files too. Default is visual media only.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Limit files for testing.")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    target = Path(args.target).resolve()
    if not source.exists():
        print(f"source missing: {source}", file=sys.stderr)
        return 2
    if source == target or is_under(target, source):
        print("target must not be inside the source tree", file=sys.stderr)
        return 2

    files = iter_files(source, args.include_non_visual)
    if args.limit:
        files = files[: args.limit]

    if args.copy:
        target.mkdir(parents=True, exist_ok=True)

    mpath = manifest_path(target, args.copy, args.manifest)
    mpath.parent.mkdir(parents=True, exist_ok=True)

    fields = [
        "status",
        "category",
        "source_top_folder",
        "source_path",
        "dest_path",
        "dest_name",
        "original_name",
        "extension",
        "bytes",
        "width",
        "height",
        "label_source",
        "prompt_source",
        "prompt_text",
    ]

    copied = skipped = errors = total_bytes = 0
    with mpath.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for idx, path in enumerate(files, 1):
            info = read_image_info(path) if path.suffix.lower() in IMAGE_EXTS else MediaInfo()
            dest_name, label_source = destination_name(source, path, info)
            dest = target / dest_name
            row = {
                "status": "dry_run",
                "category": category_for(path),
                "source_top_folder": source_top(source, path),
                "source_path": str(path),
                "dest_path": str(dest),
                "dest_name": dest_name,
                "original_name": path.name,
                "extension": path.suffix.lower(),
                "bytes": path.stat().st_size,
                "width": info.width,
                "height": info.height,
                "label_source": label_source,
                "prompt_source": info.prompt_source,
                "prompt_text": info.prompt,
            }
            if args.copy:
                try:
                    if dest.exists() and dest.stat().st_size == path.stat().st_size:
                        row["status"] = "exists_same_size"
                        skipped += 1
                    else:
                        shutil.copy2(path, dest)
                        row["status"] = "copied"
                        copied += 1
                        total_bytes += path.stat().st_size
                except Exception as exc:
                    row["status"] = f"error: {exc}"
                    errors += 1
            write_manifest_row(writer, row)
            if idx % 250 == 0:
                print(f"{idx}/{len(files)} processed; copied={copied}; skipped={skipped}; errors={errors}")

    print(
        f"done: files={len(files)} copied={copied} skipped={skipped} errors={errors} "
        f"bytes_copied={total_bytes} manifest={mpath}"
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
