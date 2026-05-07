#!/usr/bin/env bash
# install_pet.sh — drop a generated pet into Codex's pet directory.
#
# Usage:
#   bash install_pet.sh <pet.png> <pet-name>
#   bash install_pet.sh --bundle <dir>/ <pet-name>
#
# The Codex pet folder location depends on OS and Codex version. This script
# probes the well-known candidates and uses the first writable directory it
# finds, falling back to ~/.codex/pets/.
#
# After install, FULLY QUIT and relaunch Codex (system tray → Quit, not just
# close window). The new pet should appear in the picker.
#
set -euo pipefail

# ── colors ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  C_GRN='\033[0;32m'; C_YEL='\033[0;33m'; C_RED='\033[0;31m'
  C_CYN='\033[0;36m'; C_BLD='\033[1m';   C_RST='\033[0m'
else
  C_GRN=''; C_YEL=''; C_RED=''; C_CYN=''; C_BLD=''; C_RST=''
fi
step() { printf "${C_CYN}${C_BLD}==>${C_RST} %s\n" "$1"; }
ok()   { printf "${C_GRN} ✓${C_RST} %s\n" "$1"; }
warn() { printf "${C_YEL} !${C_RST} %s\n" "$1"; }
err()  { printf "${C_RED} ✗${C_RST} %s\n" "$1" >&2; }

# Find a working Python interpreter. On Windows, `python3` may be the
# Microsoft Store launcher stub which does nothing useful — verify each
# candidate actually runs.
detect_python() {
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -c "import sys, json; sys.exit(0)" >/dev/null 2>&1; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}
PY=$(detect_python || true)
if [[ -z "$PY" ]]; then
  err "no working Python interpreter found (tried python3, python, py)"
  err "manifest generation needs Python — install Python 3 from https://python.org"
  exit 1
fi

# ── args ────────────────────────────────────────────────────────────────────
BUNDLE_MODE=false
SOURCE=""
NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      BUNDLE_MODE=true
      SOURCE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "$SOURCE" ]]; then SOURCE="$1"
      elif [[ -z "$NAME" ]]; then NAME="$1"
      else err "unexpected arg: $1"; exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$SOURCE" ]] || [[ -z "$NAME" ]]; then
  err "usage: install_pet.sh <pet.png|--bundle DIR> <pet-name>"
  exit 2
fi

if ! [[ -e "$SOURCE" ]]; then
  err "source does not exist: $SOURCE"
  exit 1
fi

# Sanitize pet name (lowercase, alnum + dash)
SAFE_NAME=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//')
if [[ -z "$SAFE_NAME" ]]; then
  err "pet name '$NAME' yields empty slug after sanitization"
  exit 1
fi

# ── locate Codex pet folder ─────────────────────────────────────────────────
step "Locating Codex pet folder"

CANDIDATES=()
case "$(uname -s)" in
  Darwin)
    CANDIDATES+=(
      "$HOME/Library/Application Support/Codex/pets"
      "$HOME/Documents/Codex/pets"
      "$HOME/.codex/pets"
    )
    ;;
  Linux)
    CANDIDATES+=(
      "$HOME/.config/Codex/pets"
      "$HOME/.local/share/Codex/pets"
      "$HOME/.codex/pets"
    )
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Windows under Git Bash
    CANDIDATES+=(
      "${APPDATA:-$HOME/AppData/Roaming}/Codex/pets"
      "$HOME/.codex/pets"
    )
    ;;
  *)
    CANDIDATES+=("$HOME/.codex/pets")
    ;;
esac

PET_DIR=""
for c in "${CANDIDATES[@]}"; do
  parent=$(dirname "$c")
  if [[ -d "$parent" ]]; then
    PET_DIR="$c"
    ok "found Codex parent at $parent — using $PET_DIR"
    break
  fi
done

if [[ -z "$PET_DIR" ]]; then
  PET_DIR="$HOME/.codex/pets"
  warn "no existing Codex directory found; defaulting to $PET_DIR"
  warn "if Codex doesn't pick this up, copy the bundle to its actual pets/ folder manually"
fi

mkdir -p "$PET_DIR"

# ── install ─────────────────────────────────────────────────────────────────
TARGET="$PET_DIR/$SAFE_NAME"
if [[ -e "$TARGET" ]]; then
  warn "$TARGET already exists; backing up to $TARGET.bak.$(date +%s)"
  mv "$TARGET" "$TARGET.bak.$(date +%s)"
fi
mkdir -p "$TARGET"

if [[ "$BUNDLE_MODE" == true ]]; then
  step "Installing bundle from $SOURCE"
  if ! [[ -d "$SOURCE" ]]; then
    err "--bundle expects a directory, got: $SOURCE"
    exit 1
  fi
  # Copy bundle contents
  cp -R "$SOURCE"/. "$TARGET"/
  # Rewrite manifest.json with the chosen name (preserving existing states map)
  if [[ -f "$TARGET/manifest.json" ]]; then
    "$PY" - "$TARGET/manifest.json" "$SAFE_NAME" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
m = json.load(open(path))
m["name"] = name
m.setdefault("version", 1)
json.dump(m, open(path, "w"), indent=2)
PY
  else
    # Generate a manifest from PNGs found in the directory
    "$PY" - "$TARGET" "$SAFE_NAME" <<'PY'
import json, os, sys
target, name = sys.argv[1], sys.argv[2]
states = {}
for fname in ("idle", "working", "done", "error"):
    p = f"{fname}.png"
    if os.path.exists(os.path.join(target, p)):
        states[fname] = p
if "idle" not in states and states:
    states["idle"] = next(iter(states.values()))
manifest = {"version": 1, "name": name, "states": states}
json.dump(manifest, open(os.path.join(target, "manifest.json"), "w"), indent=2)
PY
  fi
  ok "bundle installed at $TARGET"
else
  step "Installing single image from $SOURCE"
  cp "$SOURCE" "$TARGET/idle.png"
  # Reuse the same image for all states so Codex always has something to draw
  cp "$SOURCE" "$TARGET/working.png"
  cp "$SOURCE" "$TARGET/done.png"
  cat > "$TARGET/manifest.json" <<EOF
{
  "version": 1,
  "name": "$SAFE_NAME",
  "states": {
    "idle": "idle.png",
    "working": "working.png",
    "done": "done.png"
  }
}
EOF
  ok "installed → $TARGET/{idle,working,done}.png"
fi

# ── final instructions ─────────────────────────────────────────────────────
cat <<EOF

${C_GRN}${C_BLD}✓ Pet installed:${C_RST} ${C_BLD}$TARGET${C_RST}

${C_BLD}Next steps:${C_RST}
  1. ${C_CYN}Fully quit Codex${C_RST} (system tray / menu bar → Quit, not just close window)
  2. Relaunch Codex
  3. Open the pet picker (e.g. /pet command, or settings → Pets)
  4. Select "${C_BLD}$SAFE_NAME${C_RST}"

If the new pet doesn't appear:
  - Confirm Codex's actual pets folder (check Codex's docs / app settings)
  - Move the directory at $TARGET to that folder manually
  - Make sure the manifest.json schema matches what your Codex version expects

EOF
