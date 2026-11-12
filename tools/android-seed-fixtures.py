#!/usr/bin/env python3 -I
"""Seeds the emulator/device debug build with demo tracks (fixtures/audio) for UI checks.

Usage: tools/android-seed-fixtures.py [--demo] [adb-path]
       (the app must have run once so its DB exists)
Pushes the demo audio into the app's files/library and inserts rows, including long/unicode
titles for layout testing. Pass --demo for the four branded fixture tracks only, which is what
the marketing captures use. Debug builds only (uses run-as). Replaces the app database rows.
"""
import os, sqlite3, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
ADB = args[0] if args else os.path.expanduser("~/Android/Sdk/platform-tools/adb")
DEMO = "--demo" in sys.argv
PKG = "com.hopefulaspirationsindustries.statocyst"
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
sizes = {name: os.path.getsize(os.path.join(FIX, name)) for name in files}
# The four branded fixture tracks, matching tools/generate-fixtures.mjs.
demo_rows = [
    ("Sonar Bloom", "Statocyst Ensemble", "Bathypelagic Sessions", "Ambient", 1, 2026, 12000),
    ("Tide Glass", "Statocyst Ensemble", "Bathypelagic Sessions", "Ambient", 2, 2026, 10000),
    ("Pearl Drift", "Neritic Choir", "Suspended Light", "Downtempo", 1, 2026, 9000),
    ("Abyssal Pulse", "Neritic Choir", "Suspended Light", "Downtempo", 2, 2026, 8000),
]
layout_rows = [
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
rows = demo_rows if DEMO else [
    (title, artist, album, genre, i % 4 + 1, 2020 + i % 5, 180000 + i * 7000)
    for i, (title, artist, album, genre) in enumerate(layout_rows)
]
c = sqlite3.connect(db)
c.execute("delete from media_item")
now = "2026-10-28T00:00:00Z"
for i, (title, artist, album, genre, track_no, year, duration_ms) in enumerate(rows):
    name = files[i % len(files)]
    ext = name.rsplit(".", 1)[1]
    tid = f"seed-{i+1:02d}"
    c.execute(
        "insert into media_item (id,sourceId,path,pathKey,fileName,ext,sizeBytes,mtimeMs,title,artist,album,albumArtist,trackNo,discNo,year,genre,durationMs,bitrate,sampleRate,channels,codec,format,artworkPath,jellyfinImageTag,sourceKind,sourceLabel,addedAt,updatedAt,missing,albumId) "
        "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, "local", f"{base}/files/library/{name}", f"seed:{tid}", name, ext, sizes[name], 0, title, artist, album, artist,
         track_no, None, year, genre, duration_ms, None, None, None, None, ext, None, None,
         "local", "Local", now, now, 0, None),
    )
c.commit(); c.execute("pragma wal_checkpoint(truncate)"); c.close()
run_as("rm -f databases/statocyst.db-wal databases/statocyst.db-shm")
with open(db, "rb") as f:
    run_as("cat > databases/statocyst.db", stdin=f)
print(f"seeded {len(rows)} tracks")
