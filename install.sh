#!/usr/bin/env bash
#
# install.sh — deploy LiveWX Radar into a CloudTAK checkout.
#
# This plugin is a flat Vue/TS repo (index.ts at the root). CloudTAK's
# WEB_PLUGINS env var can also deploy it, but this installer matches the
# same operator flow as Quick Point Dropper: copy into
# app/plugins/<name>/ (CloudTAK 13.102+), then rebuild + restart the API image.
#
# This script:
#   • fetch the newest plugin source (git pull, or clone GitHub if this
#     folder is a marketplace copy without its own .git)
#   • copy plugin sources → <CloudTAK>/app/plugins/livewx-radar/
#   • remove a pre-13.102 copy under api/web/plugins/ if one is still there
#   • rebuild + restart the CloudTAK API image so the plugin is baked in.
#
# Usage:
#   Install / update:  ./install.sh [/path/to/CloudTAK]
#   Remove:            ./install.sh --remove [/path/to/CloudTAK]
#
# Options:
#   /path/to/CloudTAK   CloudTAK checkout (the dir containing docker-compose.yml).
#                       Optional. If omitted (or the given path is missing), the
#                       script uses the first of: $CLOUDTAK, ~/CloudTAK,
#                       /home/takwerx/CloudTAK, /home/*/CloudTAK.
#   --no-pull           Skip git fetch (deploy whatever is already in this checkout).
#   --pull              No-op; pull is the default on install/update.
#   --no-build          Copy/remove files only; skip the docker rebuild + restart.
#   --remove            Uninstall: delete the copied files, then rebuild.
#
# Requires: bash; git (unless --no-pull or --remove); and (unless --no-build) docker + docker compose.
#
# Env:
#   LIVEWX_GIT_URL      Override the GitHub clone URL.
#   LIVEWX_GIT_REF      Override the branch/tag (default: main).

set -euo pipefail

INSTALL_DIR_NAME="livewx-radar"
# Oldest CloudTAK this plugin is built and verified against (no upper limit)
MIN_CLOUDTAK="14.4.1"
PLUGIN_GIT_URL="${LIVEWX_GIT_URL:-https://github.com/ValleyTacticalSolutions/cloudtak-plugin-livewx.git}"
PLUGIN_GIT_REF="${LIVEWX_GIT_REF:-main}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$REPO_DIR"
FETCH_DIR=""

usage() {
    sed -n '/^# Usage:/,/^# Requires:/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

canon() {
    (cd "$1" && pwd -P)
}

cleanup_fetch() {
    if [ -n "${FETCH_DIR:-}" ] && [ -d "$FETCH_DIR" ]; then
        rm -rf "$FETCH_DIR"
    fi
}
trap cleanup_fetch EXIT

CT_DIR=""
DO_BUILD=1
DO_PULL=1
ACTION="install"
for arg in "$@"; do
    case "$arg" in
        --pull) DO_PULL=1 ;;
        --no-pull) DO_PULL=0 ;;
        --no-build) DO_BUILD=0 ;;
        --remove) ACTION="remove" ;;
        -h|--help) usage; exit 0 ;;
        -*) echo "Unknown option: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
        *) CT_DIR="$arg" ;;
    esac
done

# A CloudTAK checkout is the dir that contains api/ (and usually docker-compose.yml).
looks_like_cloudtak() {
    [ -d "$1/api" ]
}

# First matching checkout. Prints the path or returns 1.
find_cloudtak() {
    local cand seen="|"
    local candidates=()

    [ -n "${CLOUDTAK:-}" ] && candidates+=("$CLOUDTAK")
    candidates+=("$HOME/CloudTAK")
    candidates+=("/home/takwerx/CloudTAK")
    for cand in /home/*/CloudTAK; do
        [ -d "$cand" ] && candidates+=("$cand")
    done

    for cand in "${candidates[@]}"; do
        case "$seen" in
            *"|$cand|"*) continue ;;
        esac
        seen="${seen}${cand}|"
        if looks_like_cloudtak "$cand"; then
            printf '%s\n' "$cand"
            return 0
        fi
    done
    return 1
}

# Newest plugin files: pull this repo if it is the git root, otherwise clone GitHub.
# Marketplace copies live under cloudtak-marketplace-plugins/ and have no plugin .git,
# so a plain `git pull` either no-ops or updates the parent marketplace repo instead.
pull_newest_source() {
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required to pull the newest plugin source (or pass --no-pull)." >&2
        exit 1
    fi

    local git_root
    git_root="$(git -C "$REPO_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

    if [ -n "$git_root" ] && [ "$(canon "$git_root")" = "$(canon "$REPO_DIR")" ]; then
        echo "Pulling latest plugin source from origin ($PLUGIN_GIT_REF)..."
        if ! git -C "$REPO_DIR" remote get-url origin >/dev/null 2>&1; then
            git -C "$REPO_DIR" remote add origin "$PLUGIN_GIT_URL"
        fi
        git -C "$REPO_DIR" fetch --tags origin "$PLUGIN_GIT_REF"
        if [ -n "$(git -C "$REPO_DIR" status --porcelain)" ]; then
            echo "WARNING: uncommitted local changes — deploying this working tree (not resetting to origin)."
        else
            git -C "$REPO_DIR" merge --ff-only FETCH_HEAD
        fi
        git -C "$REPO_DIR" log -1 --oneline
        SOURCE_DIR="$REPO_DIR"
        return 0
    fi

    echo "This folder is not the plugin git root (marketplace copy or nested tree)."
    echo "Cloning $PLUGIN_GIT_REF from $PLUGIN_GIT_URL ..."
    FETCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/livewx-radar.XXXXXX")"
    git clone --depth 1 --branch "$PLUGIN_GIT_REF" "$PLUGIN_GIT_URL" "$FETCH_DIR"
    SOURCE_DIR="$FETCH_DIR"
    git -C "$SOURCE_DIR" log -1 --oneline
}

REQUESTED="$CT_DIR"
if [ -n "$CT_DIR" ] && looks_like_cloudtak "$CT_DIR"; then
    :
elif [ -n "$CT_DIR" ] && [ -e "$CT_DIR" ]; then
    echo "ERROR: $CT_DIR does not look like a CloudTAK checkout (no api/ dir)." >&2
    exit 1
else
    FOUND="$(find_cloudtak || true)"
    if [ -z "$FOUND" ]; then
        if [ -n "$REQUESTED" ]; then
            echo "ERROR: CloudTAK dir not found: $REQUESTED" >&2
        else
            echo "ERROR: CloudTAK dir not found (tried \$CLOUDTAK, ~/CloudTAK, /home/takwerx/CloudTAK)." >&2
        fi
        echo "  Pass the path explicitly: ./install.sh /path/to/CloudTAK" >&2
        exit 1
    fi
    if [ -n "$REQUESTED" ] && [ "$FOUND" != "$REQUESTED" ]; then
        echo "Note: $REQUESTED not found; using $FOUND"
        echo
    fi
    CT_DIR="$FOUND"
fi
if [ "$DO_BUILD" -eq 1 ] && [ ! -f "$CT_DIR/docker-compose.yml" ]; then
    echo "ERROR: no docker-compose.yml in $CT_DIR — cannot rebuild." >&2
    echo "  Re-run with --no-build to copy files only, then rebuild yourself." >&2
    exit 1
fi
if [ ! -d "$CT_DIR/app" ]; then
    echo "ERROR: $CT_DIR/app not found." >&2
    echo "  Plugins install into app/plugins/. That layout arrived in CloudTAK 13.102." >&2
    exit 1
fi

# Warn when the CloudTAK checkout is older than the supported minimum
CT_VERSION="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*//p' "$CT_DIR/package.json" 2>/dev/null | head -n1)"
if [ -n "$CT_VERSION" ] && [ "$(printf '%s
%s
' "$MIN_CLOUDTAK" "$CT_VERSION" | sort -V | head -n1)" != "$MIN_CLOUDTAK" ]; then
    echo "WARNING: CloudTAK v$CT_VERSION is older than the supported minimum v$MIN_CLOUDTAK; the plugin may not work." >&2
fi

PLUGIN_DEST="$CT_DIR/app/plugins/$INSTALL_DIR_NAME"
LEGACY_DEST="$CT_DIR/api/web/plugins/$INSTALL_DIR_NAME"
SERVER_ROUTE_DEST="$CT_DIR/api/stateless/routes/plugin-livewx.ts"
SERVER_ROUTE_SRC_NAME="plugin-livewx.ts"

# CloudTAK 13.102 does not load api/web/plugins. A leftover copy there is often
# owned by another user, so a failed delete must not fail the install.
remove_legacy() {
    if [ ! -e "$LEGACY_DEST" ]; then
        return 0
    fi
    if rm -rf "$LEGACY_DEST" 2>/dev/null; then
        echo "Removed pre-13.102 copy: api/web/plugins/$INSTALL_DIR_NAME"
        return 0
    fi
    echo "WARNING: left pre-13.102 copy in place (not writable): api/web/plugins/$INSTALL_DIR_NAME" >&2
    echo "  CloudTAK 13.102 loads app/plugins only. Remove that old directory manually if you want it gone." >&2
}

echo "CloudTAK: $CT_DIR"
echo "Plugin:   $REPO_DIR"
echo "Action:   $ACTION"
echo

if [ "$ACTION" = "remove" ]; then
    DO_PULL=0
fi

if [ "$DO_PULL" -eq 1 ]; then
    pull_newest_source
    echo
fi

if [ "$ACTION" = "remove" ]; then
    if [ -d "$PLUGIN_DEST" ]; then
        rm -rf "$PLUGIN_DEST"
        echo "Removed plugin: app/plugins/$INSTALL_DIR_NAME"
    fi
    if [ -f "$SERVER_ROUTE_DEST" ]; then
        rm -f "$SERVER_ROUTE_DEST"
        echo "Removed server route: api/stateless/routes/$SERVER_ROUTE_SRC_NAME"
    fi
    remove_legacy
else
    if [ ! -f "$SOURCE_DIR/index.ts" ]; then
        echo "ERROR: $SOURCE_DIR/index.ts not found — run this from the plugin repo." >&2
        exit 1
    fi
    mkdir -p "$CT_DIR/app/plugins"

    rm -rf "$PLUGIN_DEST"
    mkdir -p "$PLUGIN_DEST/lib" "$PLUGIN_DEST/data"
    cp "$SOURCE_DIR/index.ts" "$SOURCE_DIR/package.json" "$SOURCE_DIR/tsconfig.json" \
        "$SOURCE_DIR/eslint.config.js" "$SOURCE_DIR/env.d.ts" "$PLUGIN_DEST/"
    cp -R "$SOURCE_DIR/lib/." "$PLUGIN_DEST/lib/"
    cp -R "$SOURCE_DIR/data/." "$PLUGIN_DEST/data/"
    # Older versions installed a server route; the plugin no longer needs one
    if [ -f "$SERVER_ROUTE_DEST" ]; then
        rm -f "$SERVER_ROUTE_DEST"
        echo "Removed old server route: api/stateless/routes/$SERVER_ROUTE_SRC_NAME"
    fi
    echo "Installed plugin: app/plugins/$INSTALL_DIR_NAME"
    echo "  source: $SOURCE_DIR"
    remove_legacy
fi

echo

if [ "$DO_BUILD" -eq 0 ]; then
    echo "Skipped rebuild (--no-build). To apply, run in $CT_DIR:"
    echo "  docker compose build --no-cache api && docker compose up -d --force-recreate api"
    exit 0
fi

echo "Rebuilding CloudTAK API image — this takes 5–15 minutes..."
( cd "$CT_DIR" && docker compose build --no-cache api )
echo "Restarting CloudTAK API container..."
( cd "$CT_DIR" && docker compose up -d --force-recreate api )

echo
if [ "$ACTION" = "remove" ]; then
    echo "Plugin removed."
else
    echo "Plugin installed."
    echo "  → In CloudTAK: Settings → Refresh App to activate the new service worker."
    echo "    (Cmd+Shift+R does NOT work — the service worker intercepts requests.)"
    echo "    Or close all CloudTAK tabs and reopen. The plugin appears at the"
    echo "    bottom of the right-side menu."
fi
