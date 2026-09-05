#!/usr/bin/env python3
"""
Sync Suno Library to Oracle Cloud Music Server
Transfers audio files and metadata to your Always-Free Oracle VM.
"""

import os
import sys
import subprocess
import time
from pathlib import Path

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

def sync_folder(folder_name):
    if not KEY_PATH.exists():
        print(f"[-] SSH key not found at {KEY_PATH}")
        return False

    src_path = LOCAL_MUSIC / folder_name
    print(f"\n[>] Syncing folder: {folder_name}")

    files = list(src_path.rglob("*.mp3")) + list(src_path.rglob("*.wav")) + list(src_path.rglob("*.json"))
    total_mb = sum(f.stat().st_size for f in files) / (1024 * 1024)
    print(f"[*] Found {len(files)} files (~{total_mb:.1f} MB)")

    if len(files) == 0:
        print("[-] No files to transfer in this folder.")
        return True

    print(f"[*] Uploading archive for {folder_name} over SSH...")
    t0 = time.time()

    tar_cmd = ["tar", "-cf", "-", "-C", str(LOCAL_MUSIC), folder_name]
    ssh_cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-i", str(KEY_PATH),
        f"{REMOTE_USER}@{REMOTE_HOST}",
        f"tar -xf - -C {REMOTE_DIR}"
    ]

    p1 = subprocess.Popen(tar_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    p2 = subprocess.Popen(ssh_cmd, stdin=p1.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    p1.stdout.close()

    stdout, stderr = p2.communicate()
    elapsed = time.time() - t0

    if p2.returncode == 0:
        speed = (total_mb / elapsed) if elapsed > 0 else 0
        print(f"[+] Synced {folder_name}: {len(files)} files in {elapsed:.1f}s ({speed:.2f} MB/s)")
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
        # Remaining folders to finish
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
        print(f"\n[***] Starting full sequential sync of {len(subfolders)} folders...")
        start_all = time.time()
        for idx, folder in enumerate(subfolders, 1):
            print(f"\n--- Progress: Folder {idx}/{len(subfolders)} ---")
            sync_folder(folder)
        total_time = time.time() - start_all
        print(f"\n[***] Full sync complete in {total_time/60:.1f} minutes!")
        trigger_rescan()
    else:
        try:
            num = int(choice)
            if 1 <= num <= len(subfolders):
                sync_folder(subfolders[num - 1])
                trigger_rescan()
            else:
                print("[-] Invalid choice.")
        except ValueError:
            print("[-] Invalid input.")

if __name__ == "__main__":
    main()
