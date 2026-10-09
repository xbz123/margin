#!/usr/bin/env bash
# CI only (PLAN S19-C): proves a user can replace the LGPL libvips-cpp library in a
# packaged temp app with one built from source, re-sign ad hoc and keep working.
#   scripts/margin/libvips/replace-check.sh <unzipped temp.app> <rebuilt dylib> <output dir>
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo "GitHub Actions only" >&2; exit 1; }
APP="$1"; NEW="$2"; OUT="$3"
mkdir -p "$OUT"
LIB="$APP/Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib"
NODE="$APP/Contents/Resources/app.asar.unpacked/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node"
SMOKE="$GITHUB_WORKSPACE/scripts/margin/libvips/sharp-smoke.cjs"
BIN="$APP/Contents/MacOS/temp"
smoke() {
  ELECTRON_RUN_AS_NODE=1 DYLD_PRINT_LIBRARIES=1 "$BIN" "$SMOKE" "$APP" > "$OUT/$1.json" 2> "$OUT/$1.dyld.log"
  grep 'libvips-cpp' "$OUT/$1.dyld.log" | sed "s#$APP#<app>#" > "$OUT/$1.loaded.txt"
}
{
  echo "shipped: $(shasum -a 256 "$LIB" | cut -d' ' -f1)"
  echo "rebuilt: $(shasum -a 256 "$NEW" | cut -d' ' -f1)"
  echo "rebuilt archs: $(lipo -archs "$NEW")"
  echo "rebuilt install name: $(otool -D "$NEW" | tail -1)"
} > "$OUT/identity.txt"
otool -L "$NEW" > "$OUT/rebuilt-otool-L.txt"
# Symbols sharp imports that the shipped libvips provides must all be in the rebuild.
nm -u "$NODE" | sort -u > "$OUT/sharp-undefined.txt"
nm -gU "$LIB" | awk '{print $3}' | sort -u > "$OUT/shipped-exports.txt"
nm -gU "$NEW" | awk '{print $3}' | sort -u > "$OUT/rebuilt-exports.txt"
comm -12 "$OUT/sharp-undefined.txt" "$OUT/shipped-exports.txt" > "$OUT/sharp-needs-from-libvips.txt"
comm -23 "$OUT/sharp-needs-from-libvips.txt" "$OUT/rebuilt-exports.txt" > "$OUT/missing-in-rebuilt.txt"
echo "sharp imports from libvips: $(wc -l < "$OUT/sharp-needs-from-libvips.txt" | tr -d ' ')" >> "$OUT/identity.txt"

codesign --verify --deep --strict "$APP" && echo "before: signature valid" >> "$OUT/signature.txt"
smoke before
cp "$NEW" "$LIB"
if codesign --verify --deep --strict "$APP" 2> "$OUT/after-replace-verify.log"; then
  echo "after replacement: signature still valid (unexpected)" >> "$OUT/signature.txt"
else
  echo "after replacement: signature invalid until re-signed (expected)" >> "$OUT/signature.txt"
fi
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "after ad hoc re-sign: signature valid" >> "$OUT/signature.txt"
[ "$(shasum -a 256 "$LIB" | cut -d' ' -f1)" = "$(shasum -a 256 "$NEW" | cut -d' ' -f1)" ] || { echo "replacement not in place" >&2; exit 1; }
smoke after
cat "$OUT/identity.txt" "$OUT/signature.txt" "$OUT/before.json" "$OUT/after.json" "$OUT/after.loaded.txt"
echo "symbols sharp needs that the rebuild lacks: $(wc -l < "$OUT/missing-in-rebuilt.txt" | tr -d ' ')"
[ ! -s "$OUT/missing-in-rebuilt.txt" ]
cmp -s <(jq -S . "$OUT/before.json") <(jq -S . "$OUT/after.json")
