from __future__ import annotations

import argparse
import concurrent.futures
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "data" / "exports" / "free_live_cinematic_batch" / "manifest_compact.json"
DEFAULT_RESULTS = ROOT / "data" / "exports" / "free_live_cinematic_batch" / "results_backend.jsonl"
DEFAULT_PROGRESS = ROOT / "data" / "exports" / "free_live_cinematic_batch" / "progress_backend.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def item_key(item: dict[str, Any]) -> str:
    return f"{item['song_id']}:{item['shot_index']}:{item['shot_slug']}"


def load_completed_keys(*paths: Path) -> set[str]:
    completed: set[str] = set()
    for path in paths:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = row.get("key")
            if key and row.get("ok"):
                completed.add(str(key))
    return completed


def append_jsonl(path: Path, row: dict[str, Any], lock: threading.Lock) -> None:
    payload = json.dumps(row, ensure_ascii=False)
    with lock:
        with path.open("a", encoding="utf-8") as f:
            f.write(payload + "\n")


def write_progress(path: Path, progress: dict[str, Any], lock: threading.Lock) -> None:
    payload = json.dumps(progress, indent=2, ensure_ascii=False)
    with lock:
        path.write_text(payload + "\n", encoding="utf-8")


def generate_one(
    base_url: str,
    item: dict[str, Any],
    tools: list[str],
    aspect: str,
    timeout_s: float,
    queue_wait_s: float,
    queue_retries: int,
) -> dict[str, Any]:
    key = item_key(item)
    started = time.time()
    attempts: list[dict[str, Any]] = []
    endpoint = f"{base_url.rstrip('/')}/api/songs/{item['song_id']}/gens/generate"
    payload_base = {"prompt": item["prompt"], "aspect": aspect}

    for tool in tools:
        payload = dict(payload_base)
        payload["tool"] = tool
        for retry_index in range(queue_retries + 1):
            attempt_started = time.time()
            try:
                with httpx.Client(
                    timeout=httpx.Timeout(timeout_s, connect=20.0),
                    follow_redirects=True,
                ) as client:
                    response = client.post(endpoint, json=payload)
                elapsed = round(time.time() - attempt_started, 2)
                try:
                    body = response.json()
                except json.JSONDecodeError:
                    body = {"error": response.text[:500]}
                error_text = str(body.get("detail") or body.get("error") or "")
                if "Queue full" in error_text and retry_index < queue_retries:
                    attempts.append(
                        {
                            "tool": tool,
                            "status_code": response.status_code,
                            "error": error_text[:500],
                            "retry": retry_index + 1,
                            "elapsed_s": elapsed,
                        }
                    )
                    time.sleep(queue_wait_s)
                    continue
                if response.status_code >= 400:
                    attempts.append(
                        {
                            "tool": tool,
                            "status_code": response.status_code,
                            "error": error_text or response.text[:500],
                            "elapsed_s": elapsed,
                        }
                    )
                    continue
                if body.get("file_path"):
                    return {
                        "ok": True,
                        "key": key,
                        "song_id": item["song_id"],
                        "title": item["title"],
                        "shot_index": item["shot_index"],
                        "shot_slug": item["shot_slug"],
                        "gen_id": body.get("id"),
                        "tool": body.get("tool") or tool,
                        "file_path": body.get("file_path"),
                        "attempts": attempts
                        + [{"tool": tool, "status_code": response.status_code, "elapsed_s": elapsed}],
                        "elapsed_s": round(time.time() - started, 2),
                        "created_at": now_iso(),
                    }
                attempts.append(
                    {
                        "tool": tool,
                        "status_code": response.status_code,
                        "error": error_text or "missing file_path",
                        "gen_id": body.get("id"),
                        "elapsed_s": elapsed,
                    }
                )
            except Exception as exc:  # noqa: BLE001 - record and try next free backend
                attempts.append(
                    {
                        "tool": tool,
                        "error": f"{type(exc).__name__}: {exc}",
                        "elapsed_s": round(time.time() - attempt_started, 2),
                    }
                )
                break

    return {
        "ok": False,
        "key": key,
        "song_id": item["song_id"],
        "title": item["title"],
        "shot_index": item["shot_index"],
        "shot_slug": item["shot_slug"],
        "attempts": attempts,
        "elapsed_s": round(time.time() - started, 2),
        "created_at": now_iso(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate free live concert previz frames via myspot.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--also-skip", type=Path, action="append", default=[])
    parser.add_argument("--progress", type=Path, default=DEFAULT_PROGRESS)
    parser.add_argument("--base-url", default="http://127.0.0.1:7777")
    parser.add_argument("--max-attempts", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=240.0)
    parser.add_argument("--queue-wait", type=float, default=75.0)
    parser.add_argument("--queue-retries", type=int, default=3)
    parser.add_argument("--settle-delay", type=float, default=0.0)
    parser.add_argument("--aspect", default="landscape")
    parser.add_argument("--tools", default="pollinations-realism,pollinations")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.progress.parent.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    completed = load_completed_keys(args.results, *args.also_skip)
    pending = [item for item in manifest if item_key(item) not in completed]
    target = pending[: max(0, args.max_attempts)]
    tools = [part.strip() for part in args.tools.split(",") if part.strip()]

    result_lock = threading.Lock()
    progress_lock = threading.Lock()
    progress: dict[str, Any] = {
        "started_at": now_iso(),
        "updated_at": now_iso(),
        "manifest_count": len(manifest),
        "already_completed": len(completed),
        "target": len(target),
        "done": 0,
        "ok": 0,
        "failed": 0,
        "last": None,
        "status": "running",
    }
    write_progress(args.progress, progress, progress_lock)

    if not target:
        progress["status"] = "complete"
        progress["updated_at"] = now_iso()
        write_progress(args.progress, progress, progress_lock)
        print("Nothing pending.")
        return 0

    print(f"Generating {len(target)} pending images with {tools} at concurrency {args.concurrency}.", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        future_to_item = {
            executor.submit(
                generate_one,
                args.base_url,
                item,
                tools,
                args.aspect,
                args.timeout,
                args.queue_wait,
                args.queue_retries,
            ): item
            for item in target
        }
        for future in concurrent.futures.as_completed(future_to_item):
            item = future_to_item[future]
            try:
                row = future.result()
            except Exception as exc:  # noqa: BLE001 - keep the batch moving and resumable
                row = {
                    "ok": False,
                    "key": item_key(item),
                    "song_id": item["song_id"],
                    "title": item["title"],
                    "shot_index": item["shot_index"],
                    "shot_slug": item["shot_slug"],
                    "error": f"{type(exc).__name__}: {exc}",
                    "created_at": now_iso(),
                }

            append_jsonl(args.results, row, result_lock)
            progress["done"] += 1
            if row.get("ok"):
                progress["ok"] += 1
            else:
                progress["failed"] += 1
            progress["updated_at"] = now_iso()
            progress["last"] = {
                "key": row.get("key"),
                "ok": row.get("ok"),
                "gen_id": row.get("gen_id"),
                "file_path": row.get("file_path"),
                "shot_slug": row.get("shot_slug"),
            }
            write_progress(args.progress, progress, progress_lock)
            state = "ok" if row.get("ok") else "failed"
            print(f"{progress['done']}/{progress['target']} {state} {row.get('key')}", flush=True)

    progress["status"] = "complete"
    progress["updated_at"] = now_iso()
    write_progress(args.progress, progress, progress_lock)
    print(f"Done. ok={progress['ok']} failed={progress['failed']}", flush=True)
    return 0 if progress["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
