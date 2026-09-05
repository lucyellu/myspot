#!/usr/bin/env python3
"""
Check Oracle Cloud Server Status, URL, and Storage
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY_PATH = ROOT / "assets" / "keys" / "oracle" / "ssh-key-2026-08-21 (1).key"
REMOTE_HOST = "40.233.96.17"
REMOTE_USER = "ubuntu"

def get_remote_info():
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        "journalctl -u cloudflared-navidrome -n 50 --no-pager | grep -o 'https://[-a-z0-9]*\\.trycloudflare\\.com' | tail -n 1 && df -h / | awk 'NR==2 {print $2, $3, $4, $5}' && free -h | awk 'NR==2 {print $2, $3, $7}' && ls -1 /home/ubuntu/music 2>/dev/null | wc -l"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
        return lines
    return None

def main():
    print("=" * 60)
    print("        Oracle Cloud Music Server Status")
    print("=" * 60)
    print(f"  Server Public IP : {REMOTE_HOST}")

    info = get_remote_info()
    if info and len(info) >= 3:
        url = info[0] if "trycloudflare.com" in info[0] else "Connecting..."
        df = info[1].split() if len(info) > 1 else ["-", "-", "-", "-"]
        mem = info[2].split() if len(info) > 2 else ["-", "-", "-"]
        folders = info[3] if len(info) > 3 else "0"

        print(f"  Web / App URL    : {url}")
        print(f"  Disk Storage     : {df[1]} used / {df[2]} free (Total: {df[0]}, {df[3]})")
        print(f"  Memory & Swap    : {mem[1]} used / {mem[2]} available (Total: ~5GB)")
        print(f"  Music Folders    : {folders} folders synced")
    else:
        print("  Status: Connecting to server...")

    print("=" * 60)
    print("\nHow to connect from Mobile Apps (Symfonium / Amperfy / SubStreamer):")
    print(f"  Server URL : {info[0] if info else 'https://...'}")
    print("  Username   : (Create your admin account on first visit to the Web URL)")
    print("  Password   : (Your chosen password)")
    print("=" * 60)

if __name__ == "__main__":
    main()
