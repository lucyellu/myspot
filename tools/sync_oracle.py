#!/usr/bin/env python3
"""
Sync Suno Library to Oracle Cloud Music Server
Transfers audio files and metadata to your Always-Free Oracle VM incrementally.
"""

import os
import sys
import subprocess
import time
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
LOCAL_MUSIC = Path(r"L:\Media\Audio\suno_library")
KEY_PATH = ROOT / "assets" / "keys" / "oracle" / "ssh-key-2026-08-21 (1).key"
REMOTE_HOST = "40.233.96.17"
REMOTE_USER = "ubuntu"
REMOTE_DIR = "/home/ubuntu/music"

def check_ssh():
    print(f"[*] Checking connection to Oracle server ({REMOTE_HOST})...")
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        "df -h / | awk 'NR==2 {print $4}'"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
        if res.returncode == 0:
            free_space = res.stdout.strip()
            print(f"[+] Connected! Remote free disk space: {free_space}")
            return True
        else:
            print(f"[-] SSH connection failed: {res.stderr.strip()}")
            return False
    except Exception as e:
        print(f"[-] Error connecting: {e}")
        return False

def get_subfolders():
    if not LOCAL_MUSIC.exists():
        print(f"[-] Local library path not found: {LOCAL_MUSIC}")
        return []
    return sorted([d for d in os.listdir(LOCAL_MUSIC) if (LOCAL_MUSIC / d).is_dir()])

def get_remote_inventory(folder_name):
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        f"find {REMOTE_DIR}/{folder_name} -maxdepth 1 -type f -printf '%f\\t%s\\n' 2>/dev/null"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=25)
        if res.returncode == 0:
            inv = {}
            for line in res.stdout.splitlines():
                if '\t' in line:
                    parts = line.split('\t', 1)
                    try:
                        inv[parts[0].strip()] = int(parts[1].strip())
                    except ValueError:
                        pass
            return inv
    except Exception as e:
        print(f"[-] Could not query remote inventory: {e}")
    return None

def sync_folder(folder_name):
    if not KEY_PATH.exists():
        print(f"[-] SSH key not found at {KEY_PATH}")
        return False

    src_path = LOCAL_MUSIC / folder_name
    if not src_path.exists():
        print(f"[-] Local folder not found: {src_path}")
        return False

    print(f"\n[>] Checking folder: {folder_name}")
    local_files = [f for f in src_path.iterdir() if f.is_file()]
    if not local_files:
        print("[-] No files found in this folder.")
        return True

    remote_inv = get_remote_inventory(folder_name)
    if remote_inv is not None:
        todo_files = [
            f for f in local_files
            if f.name not in remote_inv or f.stat().st_size != remote_inv[f.name]
        ]
        if not todo_files:
            print(f"[+] Up to date: all {len(local_files)} files already on Oracle server.")
            return True
        total_mb = sum(f.stat().st_size for f in todo_files) / (1024 * 1024)
        print(f"[*] Found {len(todo_files)} new/updated files to upload (~{total_mb:.1f} MB out of {len(local_files)} total files)")
    else:
        todo_files = local_files
        total_mb = sum(f.stat().st_size for f in todo_files) / (1024 * 1024)
        print(f"[*] Uploading full folder ({len(todo_files)} files, ~{total_mb:.1f} MB)...")

    print(f"[*] Streaming archive for {folder_name} over SSH...")
    t0 = time.time()

    import tarfile

    ssh_cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        f"mkdir -p {REMOTE_DIR}/{folder_name} && tar -xf - -C {REMOTE_DIR}"
    ]

    p2 = subprocess.Popen(ssh_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=p2.stdin, mode="w|") as tar:
            for f in todo_files:
                tar.add(f, arcname=f"{folder_name}/{f.name}")
    except Exception as e:
        print(f"[-] Tar streaming error: {e}")
    finally:
        p2.stdin.close()

    stdout, stderr = p2.communicate()
    elapsed = time.time() - t0

    if p2.returncode == 0:
        speed = (total_mb / elapsed) if elapsed > 0 else 0
        print(f"[+] Synced {folder_name}: {len(todo_files)} files in {elapsed:.1f}s ({speed:.2f} MB/s)")
        return True
    else:
        print(f"[-] Sync failed for {folder_name}:\n{stderr.decode('utf-8', errors='replace')}")
        return False

def trigger_rescan():
    print("\n[*] Triggering Navidrome library scan on Oracle server...")
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        "sudo systemctl restart navidrome"
    ]
    subprocess.run(cmd, capture_output=True, text=True)
    print("[+] Navidrome restarted and scanning new tracks in background!")

def main():
    print("=" * 60)
    print("      myspot -> Oracle Cloud Library Sync")
    print("=" * 60)

    if not check_ssh():
        sys.exit(1)

    subfolders = get_subfolders()
    print("\nAvailable Folders:")
    print("  0. [ALL] Sync all folders sequentially")
    print("  R. [RESUME] Sync remaining unfinished folders")
    for idx, name in enumerate(subfolders, 1):
        print(f"  {idx}. {name}")

    if len(sys.argv) > 1:
        choice = sys.argv[1]
    else:
        choice = input("\nEnter choice (0 to sync all, R to resume, or folder number): ").strip()

    if choice.upper() == 'R' or choice.lower() == 'resume':
        remaining = [
            "sunosync_lllucylllu",
            "sunosync_lucylucontact_chaimanmeow",
            "sunosync_manualthinker",
            "sunosync_primenotation",
            "sunosync_primenotation_2026_April_17"
        ]
        print(f"\n[***] Resuming sync for {len(remaining)} remaining folders...")
        start_all = time.time()
        for idx, folder in enumerate(remaining, 1):
            print(f"\n--- Progress: Folder {idx}/{len(remaining)}: {folder} ---")
            sync_folder(folder)
        total_time = time.time() - start_all
        print(f"\n[***] Remaining folders sync complete in {total_time/60:.1f} minutes!")
        trigger_rescan()
    elif choice == '0' or choice.lower() == 'all':
        print(f"\n[***] Starting sync of all {len(subfolders)} folders...")
        start_all = time.time()
        for idx, folder in enumerate(subfolders, 1):
            print(f"\n--- Progress: Folder {idx}/{len(subfolders)}: {folder} ---")
            sync_folder(folder)
        total_time = time.time() - start_all
        print(f"\n[***] Full sync complete in {total_time/60:.1f} minutes!")
        trigger_rescan()
    else:
        target_folder = None
        if choice.isdigit():
            num = int(choice)
            if 1 <= num <= len(subfolders):
                target_folder = subfolders[num - 1]
        else:
            for sf in subfolders:
                if sf.lower() == choice.lower() or sf.lower() == f"sunosync_{choice.lower()}":
                    target_folder = sf
                    break
        if target_folder:
            sync_folder(target_folder)
            trigger_rescan()
        else:
            print(f"[-] Invalid folder choice: '{choice}'")

if __name__ == "__main__":
    main()
