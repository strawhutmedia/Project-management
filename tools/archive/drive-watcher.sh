#!/bin/sh
# drive-watcher.sh — auto-slot watcher + fresh-scan swap gate for RED.
#
# WHY (Ryan, 2026-09-18): "how do I know that ALL the content is backed up
# and ACTUALLY in the archive?" — a stale census is not proof (RHINO's
# restart found 2.5 TiB the old census never counted). And: no terminal —
# docking the next drive (queue: Rabbit, SHM #1, Octopus, Lion, Stork,
# Hippo) must upload + verify itself with zero pastes.
#
# WHAT IT DOES, every 5 minutes:
#   1. Lists mounted USB drives (via short-lived alpine containers, so
#      newly docked drives are always seen — no mount-propagation games).
#   2. Recognizes RHINO (root has 1_PODCASTS/) and RECOVERY (root has
#      Root/); anything else non-empty becomes NEW-<dev> and gets an
#      upload container created for it automatically (full drive →
#      vault 1_PODCASTS/, standard flags, its own dashboard row).
#   3. If a known drive's container exited non-zero → docker start it
#      (NAS-side self-heal; Slate's heal loop covers the vault side).
#   4. If a drive's container is bound to a stale /mnt/@usb letter
#      (drive replugged into a different slot) → recreates the container
#      with the correct bind and the SAME log file, so the row continues.
#   5. THE SWAP GATE: when a drive's upload container exits 0, runs a
#      FRESH full scan of the drive (rclone lsf), uploads it as
#      _INVENTORY/inventory-<NAME>.txt (+ a dated copy). Slate's
#      auto-verify reads exactly that file, so the next sweep verifies
#      the drive against TODAY's census, not a stale one. Only a
#      VERIFIED verdict on a fresh census means "safe to pull".
#      For RHINO it also launches a one-shot top-up for the root files
#      outside 1_PODCASTS/ (they map to 1_PODCASTS/Henri G/ in the
#      census) so "finished" really covers the whole drive.
#
# WHAT IT NEVER DOES: delete, sync, move, or write to any source drive.
# Every rclone verb here is `copy`/`copyto`/`lsf`. Drives are mounted
# read-only into every container this script creates.
#
# RUNS AS: container `archive-watcher` (docker:27-cli image, restart
# always), mounts /var/run/docker.sock + /volume1/rclone-config:/config.
# Install paste lives in docs/ARCHIVE_MIGRATION_STATUS.md ("Drive
# watcher" section). Status lines land in each row's own log file, so
# they show up on the Slate Storage page via the existing reporter.

set -u

CONF=/config                     # /volume1/rclone-config on the host
STATE=$CONF/watcher/state
TMP=$CONF/watcher/tmp
BUCKET=strawhut-master-archive
RCLONE_IMG=rclone/rclone
COPY_FLAGS="--ignore-existing --exclude-from /config/watcher/excludes.txt --transfers 4 --checkers 8 --stats 1m --log-level NOTICE --s3-no-check-bucket"

mkdir -p "$STATE" "$TMP"
# exclude patterns live in a file because two of them contain spaces,
# which unquoted $COPY_FLAGS word-splitting would mangle
cat > "$CONF/watcher/excludes.txt" <<'EOF'
.DS_Store
Thumbs.db
$RECYCLE.BIN/**
System Volume Information/**
EOF

note() { # note <ROWNAME> <message> — shows on the Slate Storage page
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) NOTICE: watcher: $2" >> "$CONF/$1.log"
}

rclone_run() { # rclone with the shared config, extra -v binds first
  # usage: rclone_run "<extra docker -v args>" <rclone args...>
  binds=$1; shift
  # shellcheck disable=SC2086
  docker run --rm $binds -v /volume1/rclone-config:/config "$RCLONE_IMG" \
    --config /config/rclone.conf "$@"
}

list_drives() { # prints device basenames (sde2 …) that are mounted non-empty
  docker run --rm -v /mnt/@usb:/u:ro alpine sh -c \
    'for d in /u/*/; do [ -n "$(ls -A "$d" 2>/dev/null)" ] && basename "$d"; done' 2>/dev/null
}

top_listing() { # top_listing <dev> — root entries of a drive
  docker run --rm -v "/mnt/@usb/$1":/d:ro alpine ls -A /d 2>/dev/null
}

container_bind() { # first bind source of a container, "" if no container
  docker inspect -f '{{range .Mounts}}{{if eq .Destination "/usb"}}{{.Source}}{{end}}{{end}}' "$1" 2>/dev/null
}

container_state() { # "running" | "exited <code>" | "none"
  s=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$1" 2>/dev/null) || { echo none; return; }
  case $s in running*) echo running ;; *) echo "exited ${s#* }" ;; esac
}

# ── identity ──────────────────────────────────────────────────────────
# RHINO: root has 1_PODCASTS/.  RECOVERY: root has Root/.  A retired
# marker (drive passed the gate and was pulled) stops a future drive
# with the same shape from stealing the name. Everything else keeps a
# per-name fingerprint (hash of the root listing) so a replug at a new
# letter is recognized instead of double-uploaded.
name_for() { # name_for <dev> → echoes NAME
  dev=$1
  top=$(top_listing "$dev")
  if echo "$top" | grep -qx '1_PODCASTS' && [ ! -f "$STATE/RHINO.retired" ]; then echo RHINO; return; fi
  if echo "$top" | grep -qx 'Root' && [ ! -f "$STATE/RECOVERY.retired" ]; then echo RECOVERY; return; fi
  fp=$(echo "$top" | sha1sum | cut -d' ' -f1)
  for f in "$STATE"/*.fp; do
    [ -f "$f" ] || continue
    [ "$(cat "$f")" = "$fp" ] || continue
    n=$(basename "$f" .fp)
    [ -f "$STATE/$n.retired" ] && continue
    echo "$n"; return
  done
  n="NEW-$dev"
  echo "$fp" > "$STATE/$n.fp"
  echo "$n"
}

# per-name facts: upload container, source subdir the JOB copies, subdir
# the CENSUS scans (must match Slate's mapPath for that name: RHINO's
# census is drive-root-relative, RECOVERY's is Root/-relative), vault dest
container_of() { case $1 in RHINO) echo archive-rhino ;; RECOVERY) echo archive-recovery ;; *) echo "archive-$(echo "$1" | tr 'A-Z' 'a-z')" ;; esac; }
srcsub_of()    { case $1 in RHINO) echo 1_PODCASTS ;; RECOVERY) echo Root ;; *) echo "" ;; esac; }
scansub_of()   { case $1 in RECOVERY) echo Root ;; *) echo "" ;; esac; }
destroot_of()  { echo 1_PODCASTS; }

create_upload_container() { # create_upload_container <NAME> <dev>
  name=$1; dev=$2
  c=$(container_of "$name"); sub=$(srcsub_of "$name"); dest=$(destroot_of "$name")
  src="/mnt/@usb/$dev"; [ -n "$sub" ] && src="$src/$sub"
  docker rm -f "$c" >/dev/null 2>&1
  # shellcheck disable=SC2086
  docker run -d --name "$c" \
    -v "$src":/usb:ro -v /volume1/rclone-config:/config \
    "$RCLONE_IMG" --config /config/rclone.conf \
    copy /usb "archive:$BUCKET/$dest" \
    --log-file "/config/$name.log" $COPY_FLAGS >/dev/null 2>&1 \
    && note "$name" "upload container ($c) created for /mnt/@usb/$dev → $dest/" \
    || note "$name" "ERROR could not create upload container $c"
  grep -q "^$name=" "$CONF/containers.map" 2>/dev/null || echo "$name=$c" >> "$CONF/containers.map"
}

fresh_scan() { # fresh_scan <NAME> <dev> — THE SWAP GATE census
  name=$1; dev=$2
  sub=$(scansub_of "$name"); scanroot="/mnt/@usb/$dev"; [ -n "$sub" ] && scanroot="$scanroot/$sub"
  note "$name" "upload finished — running FRESH full-drive scan (swap gate)…"
  if ! rclone_run "-v $scanroot:/usb:ro" lsf -R --files-only --format sp --separator " " /usb > "$TMP/$name.census" 2>>"$CONF/$name.log"; then
    note "$name" "ERROR fresh scan failed — drive NOT swappable"; return 1
  fi
  files=$(wc -l < "$TMP/$name.census" | tr -d ' ')
  bytes=$(awk '{s+=$1} END{printf "%.0f", s}' "$TMP/$name.census")
  # anything on the drive OUTSIDE the scanned root is a blind spot — say so
  if [ -n "$sub" ]; then
    extra=$(docker run --rm -v "/mnt/@usb/$dev":/d:ro alpine sh -c "ls -A /d | grep -vx '$sub' | wc -l" | tr -d ' ')
    [ "$extra" != "0" ] && note "$name" "WARNING $extra root entries outside $sub/ are NOT covered by this job — tell Claude before swapping"
  fi
  rclone_run "" copyto "/config/watcher/tmp/$name.census" "archive:$BUCKET/_INVENTORY/inventory-$name.txt" --s3-no-check-bucket 2>>"$CONF/$name.log" &&
  rclone_run "" copyto "/config/watcher/tmp/$name.census" "archive:$BUCKET/_INVENTORY/inventory-$name-$(date -u +%Y%m%d).txt" --s3-no-check-bucket 2>>"$CONF/$name.log" || {
    note "$name" "ERROR census upload failed — drive NOT swappable"; return 1; }
  date -u +%s > "$STATE/$name.lastscan"
  note "$name" "FRESH census uploaded: $files files / $bytes bytes. Slate re-verifies within 30 min — pull the drive only when its row reads safe on THIS scan."
}

rhino_topup() { # root files outside 1_PODCASTS/ map to 1_PODCASTS/Henri G/
  dev=$1
  st=$(container_state archive-rhino-topup)
  [ "$st" = running ] && return
  [ -f "$STATE/RHINO.topup" ] && return
  docker rm -f archive-rhino-topup >/dev/null 2>&1
  # shellcheck disable=SC2086
  docker run -d --name archive-rhino-topup \
    -v "/mnt/@usb/$dev":/usb:ro -v /volume1/rclone-config:/config \
    "$RCLONE_IMG" --config /config/rclone.conf \
    copy /usb "archive:$BUCKET/1_PODCASTS/Henri G" \
    --exclude "1_PODCASTS/**" --log-file /config/RHINO.log $COPY_FLAGS >/dev/null 2>&1 \
    && { touch "$STATE/RHINO.topup"; note RHINO "top-up started: root files outside 1_PODCASTS/ → vault 1_PODCASTS/Henri G/"; }
}

# ── main loop ─────────────────────────────────────────────────────────
while :; do
  drives=$(list_drives)
  for dev in $drives; do
    name=$(name_for "$dev") || continue
    [ -n "$name" ] || continue
    c=$(container_of "$name")
    st=$(container_state "$c")

    if [ "$st" = none ]; then
      # brand-new drive (or a known one whose container was removed)
      files=$(top_listing "$dev" | wc -l | tr -d ' ')
      note "$name" "new drive detected at /mnt/@usb/$dev ($files root entries) — starting upload"
      create_upload_container "$name" "$dev"
      continue
    fi

    # replugged into a different slot? (compare the SLOT prefix only —
    # existing containers differ in whether the subdir is in the bind or
    # the CMD, and that difference must never trigger a recreate)
    bind=$(container_bind "$c")
    case $bind in
      "/mnt/@usb/$dev"|"/mnt/@usb/$dev"/*|"") : ;;
      *)
        if [ "$st" != running ]; then
          note "$name" "drive moved ($bind → /mnt/@usb/$dev) — recreating container with the new slot"
          create_upload_container "$name" "$dev"
          continue
        fi ;;
    esac

    case $st in
      running) : ;;                       # uploading — nothing to do
      "exited 0")
        # finished: RHINO gets its root top-up first, then the gate scan
        if [ "$name" = RHINO ]; then
          rhino_topup "$dev"
          ts=$(container_state archive-rhino-topup)
          [ "$ts" = running ] && continue
          case $ts in "exited 0"|none) : ;; exited*)
            note RHINO "top-up exited (${ts#exited }) — restarting"
            docker start archive-rhino-topup >/dev/null 2>&1; continue ;;
          esac
        fi
        last=$(cat "$STATE/$name.lastscan" 2>/dev/null || echo 0)
        fin=$(docker inspect -f '{{.State.FinishedAt}}' "$c" 2>/dev/null | cut -c1-19 | tr T ' ')
        fins=$(date -u -D '%Y-%m-%d %H:%M:%S' -d "$fin" +%s 2>/dev/null || echo 0)
        [ "$fins" -gt "$last" ] && fresh_scan "$name" "$dev"
        ;;
      exited*)
        note "$name" "container $c exited (${st#exited }) — restarting"
        docker start "$c" >/dev/null 2>&1
        ;;
    esac
  done

  # a known drive that passed the gate and is now unplugged → retire the
  # name so the next drive in the queue can never impersonate it
  for f in "$STATE"/*.lastscan; do
    [ -f "$f" ] || continue
    n=$(basename "$f" .lastscan)
    present=0
    for dev in $drives; do [ "$(name_for "$dev")" = "$n" ] && present=1; done
    [ "$present" = 0 ] && [ ! -f "$STATE/$n.retired" ] && { touch "$STATE/$n.retired"; note "$n" "drive unplugged after its fresh-scan census — name retired"; }
  done

  sleep 300
done
