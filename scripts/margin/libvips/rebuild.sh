#!/usr/bin/env bash
# CI only (PLAN S21): rebuild libvips-cpp for macOS arm64 from the fixed
# sharp-libvips recipe that produced @img/sharp-libvips-darwin-arm64 1.2.4, keeping
# every source the recipe downloads (scripts/margin/libvips/curl) plus the librsvg
# crate closure it resolved, as corresponding source and replacement evidence.
#   scripts/margin/libvips/rebuild.sh <output dir>
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo "GitHub Actions only" >&2; exit 1; }
RECIPE=20b5e899954907a3039d6e3d4c200aaa0ec52c4c
OUT="$1"
WORK="$RUNNER_TEMP/libvips-recipe"
mkdir -p "$OUT/sources"
git clone --quiet --no-checkout https://github.com/lovell/sharp-libvips.git "$WORK"
git -C "$WORK" -c advice.detachedHead=false checkout --quiet "$RECIPE"
[ "$(git -C "$WORK" rev-parse HEAD)" = "$RECIPE" ]
git -C "$WORK" archive --format=tar.gz --prefix="sharp-libvips-$RECIPE/" -o "$OUT/sources/sharp-libvips-$RECIPE.tar.gz" "$RECIPE"

export MARGIN_CAPTURE_DIR="$OUT/sources"
export PATH="$GITHUB_WORKSPACE/scripts/margin/libvips:$PATH"
[ "$(command -v curl)" = "$GITHUB_WORKSPACE/scripts/margin/libvips/curl" ]
cd "$WORK"
set +e
./build.sh darwin-arm64v8 > "$OUT/build.log" 2>&1
status=$?
set -e
tail -n 80 "$OUT/build.log"
[ "$status" = 0 ] || { echo "recipe build failed: $status" >&2; exit "$status"; }

# The crates librsvg was built with: its lockfile after the recipe's
# `cargo update --workspace`, and the .crate files Cargo fetched for it.
cp deps/rsvg/Cargo.lock "$OUT/sources/librsvg-Cargo.lock"
mkdir -p "$OUT/sources/librsvg-crates"
while read -r name version; do
  for crate in deps/cargo/registry/cache/*/"$name-$version.crate"; do
    [ -f "$crate" ] && cp "$crate" "$OUT/sources/librsvg-crates/"
  done
done < <(awk '/^name = /{gsub(/"/,"",$3); n=$3} /^version = /{gsub(/"/,"",$3); print n, $3}' deps/rsvg/Cargo.lock)
# The registry crates Cargo actually compiled for librsvg (the only Rust build after
# cargo-c is installed; path crates end in "(<dir>)"); each must have its .crate kept.
awk '/Installed package `cargo-c/{f=1} f && $1 == "Compiling" && NF == 3 {sub(/^v/, "", $3); print $2, $3}' "$OUT/build.log" \
  | sort -u > "$OUT/sources/librsvg-compiled.txt"
missing=0
while read -r name version; do
  [ -f "$OUT/sources/librsvg-crates/$name-$version.crate" ] || { echo "compiled crate not kept: $name $version" >&2; missing=$((missing + 1)); }
done < "$OUT/sources/librsvg-compiled.txt"
[ "$missing" = 0 ] && [ -s "$OUT/sources/librsvg-compiled.txt" ]

{
  echo "recipe: $RECIPE"
  echo "commit: $GITHUB_SHA"
  echo "run: $GITHUB_RUN_ID (attempt $GITHUB_RUN_ATTEMPT)"
  echo "rustc: $(deps/cargo/bin/rustc -V)"
  echo "cargo-c: $(grep -o 'Installed package `cargo-c [^`]*' "$OUT/build.log" | cut -d' ' -f4)"
  echo "meson: $(meson --version)"
  echo "clang: $(clang --version | head -1)"
  echo "xcode: $(xcodebuild -version | tr '\n' ' ')"
  echo "librsvg crates locked: $(grep -c '^name = ' deps/rsvg/Cargo.lock), kept: $(ls "$OUT/sources/librsvg-crates" | wc -l | tr -d ' '), compiled from the registry: $(wc -l < "$OUT/sources/librsvg-compiled.txt" | tr -d ' ') (all kept)"
  shasum -a 256 sharp-libvips-darwin-arm64v8.tar.gz
} > "$OUT/BUILD-INFO.txt"
cp sharp-libvips-darwin-arm64v8.tar.gz "$OUT/"
cat "$OUT/BUILD-INFO.txt"
