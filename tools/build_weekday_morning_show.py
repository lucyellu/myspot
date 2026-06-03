"""Build the weekday myspot morning radio show.

This is intentionally browser-free so it can be run by Task Scheduler, Codex
automations, or a simple .bat file before the 6 AM air time.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.db import init_db  # noqa: E402
from backend.radio import build_weekday_morning_show, local_show_date  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD. Defaults to today in Vancouver.")
    parser.add_argument("--days-ahead", type=int, default=0, help="Build today + N days in Vancouver when --date is omitted.")
    parser.add_argument("--place", default="Vancouver")
    parser.add_argument("--target-hours", type=float, default=1.0)
    parser.add_argument("--air-time", default="06:00")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    show_date = args.date
    if not show_date and args.days_ahead:
        show_date = (local_show_date() + timedelta(days=args.days_ahead)).isoformat()

    conn = init_db()
    show = build_weekday_morning_show(
        conn,
        show_date=show_date,
        place=args.place,
        target_hours=args.target_hours,
        air_time=args.air_time,
        force=args.force,
    )
    print(json.dumps({
        "id": show.get("id"),
        "title": show.get("title"),
        "total": show.get("total"),
        "skipped": show.get("skipped", False),
        "alreadyExists": show.get("alreadyExists", False),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
