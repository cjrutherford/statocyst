#!/usr/bin/env python3 -I
"""Seeds the emulator/device debug build with demo tracks (fixtures/audio) for UI checks.

Usage: tools/android-seed-fixtures.py [adb-path]   (the app must have run once so its DB exists)
Pushes the demo audio into the app's files/library and inserts rows, including long/unicode
titles for layout testing. Debug builds only (uses run-as). Replaces the app database rows.
"""
import os, sqlite3, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADB = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Android/Sdk/platform-tools/adb")
PKG = "net.christopherrutherford.statocyst"
FIX = os.path.join(ROOT, "fixtures/audio")

def adb(*a, **k):
    return subprocess.run([ADB, *a], check=True, **k)

def run_as(cmd, stdin=None, capture=False):
    # `adb shell` (not exec-out) so stdin is forwarded; run-as keeps this to debug builds.
    return subprocess.run([ADB, "shell", "run-as", PKG, "sh", "-c", f"'{cmd}'"], check=True,
                          stdin=stdin if stdin is not None else subprocess.DEVNULL, capture_output=capture, timeout=60).stdout

adb("shell", "am", "force-stop", PKG)
run_as("mkdir -p files/library")
for name in sorted(os.listdir(FIX)):
    with open(os.path.join(FIX, name), "rb") as f:
        run_as(f"cat > files/library/{name}", stdin=f)
base = run_as("pwd", capture=True).decode().strip()

tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "statocyst.db")
with open(db, "wb") as f:
    f.write(run_as("cat databases/statocyst.db", capture=True))
wal = run_as("cat databases/statocyst.db-wal", capture=True)
if wal:
    open(db + "-wal", "wb").write(wal)

files = sorted(os.listdir(FIX))
rows = [
    ("Sonar Bloom", "Statocyst Ensemble", "Bathypelagic Sessions", "Ambient"),
    ("Tide Glass", "Statocyst Ensemble", "Bathypelagic Sessions", "Ambient"),
    ("Pearl Drift", "Kelp Forest Collective", "Salt & Light", "Electronic"),
    ("Abyssal Pulse", "Kelp Forest Collective", "Salt & Light", "Electronic"),
    ("A Remarkably Long Track Title That Keeps Going Past Any Reasonable Width Limit", "An Artist With An Equally Long Name Featuring Many Collaborators", "An Album Title Long Enough To Wrap Over Several Lines In Narrow Layouts", "Experimental"),
    ("Café del Mar — Édition spéciale", "Beyoncé & Björk", "Ünïcödé Sessions", "Pop"),
    ("日本語のタイトル", "アーティスト名", "アルバム", "J-Pop"),
    ("Low Tide", "Driftwood", "Shoreline", "Folk"),
    ("High Tide", "Driftwood", "Shoreline", "Folk"),
    ("Undertow", "Driftwood", "Shoreline", "Folk"),
    ("Neap", "Moonpull", "Gravity Wells", "Ambient"),
    ("Spring", "Moonpull", "Gravity Wells", "Ambient"),
]
c = sqlite3.connect(db)
c.execute("delete from media_item")
now = "2026-10-28T00:00:00Z"
for i, (title, artist, album, genre) in enumerate(rows):
    name = files[i % len(files)]
    ext = name.rsplit(".", 1)[1]
    tid = f"seed-{i+1:02d}"
    c.execute(
        "insert into media_item (id,sourceId,path,pathKey,fileName,ext,sizeBytes,mtimeMs,title,artist,album,albumArtist,trackNo,discNo,year,genre,durationMs,bitrate,sampleRate,channels,codec,format,artworkPath,jellyfinImageTag,sourceKind,sourceLabel,addedAt,updatedAt,missing,albumId) "
        "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, "local", f"{base}/files/library/{name}", f"seed:{tid}", name, ext, 1000, 0, title, artist, album, artist,
         i % 4 + 1, None, 2020 + i % 5, genre, 180000 + i * 7000, None, None, None, None, ext, None, None,
         "local", "Local", now, now, 0, None),
    )
c.commit(); c.execute("pragma wal_checkpoint(truncate)"); c.close()
run_as("rm -f databases/statocyst.db-wal databases/statocyst.db-shm")
with open(db, "rb") as f:
    run_as("cat > databases/statocyst.db", stdin=f)
print(f"seeded {len(rows)} tracks")
