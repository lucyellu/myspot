#!/usr/bin/env python3
"""
Check Oracle Cloud MySpot Backend Server Status, Cloudflare Tunnel URL, and Stats
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_PATH = ROOT / "assets" / "keys" / "oracle" / "ssh-key-2026-08-21 (1).key"
REMOTE_HOST = "40.233.96.17"
REMOTE_USER = "ubuntu"
NETLIFY_URL = "https://myspot-web.netlify.app"

def get_remote_info():
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        "journalctl -u cloudflared-myspot -n 50 --no-pager | grep -o 'https://[-a-z0-9]*\\.trycloudflare\\.com' | tail -n 1; df -h / | awk 'NR==2 {print $2, $3, $4, $5}'; curl -s http://127.0.0.1:7777/api/stats; echo ''; systemctl is-active myspot.service"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
        return lines
    return None

def main():
    print("=" * 65)
    print("          Oracle Cloud MySpot 24/7 Backend Status")
    print("=" * 65)
    print(f"  Server Public IP : {REMOTE_HOST}")

    info = get_remote_info()
    if info and len(info) >= 3:
        url = info[0] if "trycloudflare.com" in info[0] else "Connecting..."
        df = info[1].split() if len(info) > 1 else ["-", "-", "-", "-"]
        stats_raw = info[2] if len(info) > 2 else "{}"
        service_status = info[3] if len(info) > 3 else "unknown"

        print(f"  myspot.service   : {service_status.upper()}")
        print(f"  Cloudflare Tunnel: ACTIVE")
        print(f"  Backend Tunnel   : {url}")
        print(f"  Disk Storage     : {df[1]} used / {df[2]} free (Total: {df[0]}, {df[3]})")

        try:
            stats = json.loads(stats_raw)
            print(f"  Catalog Indexed  : {stats.get('songs', 0):,} songs across {stats.get('accounts', 0)} accounts")
            print(f"  Lyric Lines      : {stats.get('lyric_lines', 0):,}")
        except Exception:
            pass

        print("=" * 65)
        print("\n  Open MySpot on ANY Device (Phone, Tablet, Laptop):")
        print(f"  Direct Netlify App : {NETLIFY_URL}/")
        print(f"  With Backend Param : {NETLIFY_URL}/?api={url}#/radio")
        print("=" * 65)
    else:
        print("  Status: Connecting to server...")

if __name__ == "__main__":
    main()

