#!/usr/bin/env bash
# Builds the plugin inside a fresh CloudTAK checkout exactly as the image build does.
# Usage: bash verify-cloudtak.sh <plugin-dir> <dest> [cloudtak-ref]
# Set CLOUDTAK_DIR to reuse an existing checkout (its node_modules are reused too).
set -euo pipefail
PLUGIN=$(cd "${1:-.}" && pwd); DEST="${2:-livewx-radar}"; REF="${3:-main}"
if [ -n "${CLOUDTAK_DIR:-}" ]; then
  CT="$CLOUDTAK_DIR"
else
  WORK=$(mktemp -d); CT="$WORK/CloudTAK"
  git clone -q --depth 1 --branch "$REF" https://github.com/dfpc-coe/CloudTAK "$CT"
fi
echo "CloudTAK v$(node -p "require('$CT/package.json').version") @ $(git -C "$CT" rev-parse --short HEAD) ($(git -C "$CT" log -1 --format=%cs))"
SRC="$PLUGIN"; [ -d "$PLUGIN/plugin" ] && SRC="$PLUGIN/plugin"
rm -rf "$CT/app/plugins/$DEST"
mkdir -p "$CT/app/plugins/$DEST"
cp -a "$SRC/." "$CT/app/plugins/$DEST/"
# Mirror catalog "exclude" + never-shipped dirs
for x in .git .github node_modules test docs scripts dist-bundle release server; do rm -rf "$CT/app/plugins/$DEST/$x"; done
find "$CT/app/plugins/$DEST" -name '*.md' -delete
rm -f "$CT/app/plugins/$DEST/vite.bundle.config.ts" "$CT/app/plugins/$DEST/package.json" "$CT/app/plugins/$DEST/package-lock.json" "$CT/app/plugins/$DEST/install.sh" "$CT/app/plugins/$DEST/verify-cloudtak.sh"
# public/ collision check (CloudTAK refuses to overwrite core assets)
if [ -d "$SRC/public" ]; then
  (cd "$SRC/public" && find . -type f) | while read -r f; do
    [ -e "$CT/app/public/$f" ] && { echo "FAIL public collision: $f"; exit 1; }; done
fi
cd "$CT/app"
[ -d node_modules ] || npm install --no-audit --no-fund
# Separate steps so a failure aborts (set -e ignores failures inside an && chain).
# The checkout may hold other plugins; judge this plugin's own lint and type errors only.
npx eslint --config eslint.config.js "./plugins/$DEST"
npm run check > "$CT/vue-tsc.log" 2>&1 || true
if grep "error TS" "$CT/vue-tsc.log" | grep "plugins/$DEST/"; then echo "FAIL: vue-tsc errors in $DEST"; exit 1; fi
npm run build
if ls "$PLUGIN"/server/*.ts >/dev/null 2>&1; then
  cp "$PLUGIN"/server/*.ts "$CT/api/stateless/routes/"
  cd "$CT/api"
  [ -d node_modules ] || npm install --no-audit --no-fund
  npm run lint
  npx tsc --noEmit
fi
echo "PASS: plugin builds against CloudTAK $REF"
