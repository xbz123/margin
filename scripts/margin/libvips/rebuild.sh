#!/usr/bin/env bash
# CI only (PLAN S21): rebuild libvips-cpp for macOS arm64 from the fixed
# sharp-libvips recipe that produced @img/sharp-libvips-darwin-arm64 1.2.4, keeping
# every source the recipe downloads (scripts/margin/libvips/curl) plus the librsvg
# crate closure it resolved, as corresponding source and replacement evidence.
#   scripts/margin/libvips/rebuild.sh <output dir>
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = true ] || { echo "GitHub Actions only" >&2; exit 1; }
RECIPE=20b5e899954907a3039d6e3d4c200aaa0ec52c4c
# The recipe installs rustup's newest nightly and builds librsvg, with the Rust
# standard library it links, by it (nightly-only -Z flags), and mozjpeg writes the
# build date into the library. Both are pinned to the recorded build, made on
# 2026-10-09 with nightly-2026-10-09 (rustc a30aa906), so a later run builds the
# same bytes (run 38052543358 did). The Rust code in the library is checked at the
# end because the notices depend on it; the toolchain version, mozjpeg's build
# string and the library's sha256 are only recorded in BUILD-INFO.txt.
RUST_NIGHTLY=nightly-2026-10-09
RUSTC_COMMIT=a30aa9064df6a504b6a323c6884a2f4cfbfff666
export RUSTUP_TOOLCHAIN="$RUST_NIGHTLY" RUSTUP_AUTO_INSTALL=1
export SOURCE_DATE_EPOCH=1791547200 # 2026-10-09T12:00:00Z
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

# The recipe's own toolchain (its RUSTUP_HOME), not the runner's.
recipe_rustc() { RUSTUP_HOME="$WORK/deps/rustup" CARGO_HOME="$WORK/deps/cargo" deps/cargo/bin/rustc -V; }
built="$(mktemp -d)"
tar -xzf sharp-libvips-darwin-arm64v8.tar.gz -C "$built"
dylib="$(find "$built" -name 'libvips-cpp.*.dylib' -type f)"
[ -n "$dylib" ] && [ "$(printf '%s\n' "$dylib" | wc -l | tr -d ' ')" = 1 ]
strings -a "$dylib" > "$built/strings.txt"
rustc_commits() { grep -o 'rustc/[0-9a-f]\{40\}' "$built/strings.txt" | sort -u | tr '\n' ' '; }
{
  echo "recipe: $RECIPE"
  echo "commit: $GITHUB_SHA"
  echo "run: $GITHUB_RUN_ID (attempt $GITHUB_RUN_ATTEMPT)"
  echo "rustc (librsvg, recipe toolchain $RUST_NIGHTLY): $(recipe_rustc)"
  echo "rustc commits embedded in libvips-cpp: $(rustc_commits)"
  echo "mozjpeg: $(grep -F 'mozjpeg version' "$built/strings.txt")"
  echo "SOURCE_DATE_EPOCH: $SOURCE_DATE_EPOCH"
  echo "cargo-c: $(grep -o 'Installed package `cargo-c [^`]*' "$OUT/build.log" | cut -d' ' -f4)"
  echo "meson: $(meson --version)"
  echo "clang: $(clang --version | head -1)"
  echo "xcode: $(xcodebuild -version | tr '\n' ' ')"
  echo "librsvg crates locked: $(grep -c '^name = ' deps/rsvg/Cargo.lock), kept: $(ls "$OUT/sources/librsvg-crates" | wc -l | tr -d ' '), compiled from the registry: $(wc -l < "$OUT/sources/librsvg-compiled.txt" | tr -d ' ') (all kept)"
  shasum -a 256 sharp-libvips-darwin-arm64v8.tar.gz
  echo "libvips-cpp: $(shasum -a 256 "$dylib" | cut -d' ' -f1) $(dwarfdump --uuid "$dylib" | cut -d' ' -f2)"
} > "$OUT/BUILD-INFO.txt"
cp sharp-libvips-darwin-arm64v8.tar.gz "$OUT/"
cat "$OUT/BUILD-INFO.txt"

# S22: Margin ships this library and its notices (scripts/margin/libvips/notices.json)
# were made from one recorded build. Fail if this build drifted from it: the
# downloads (except the rustup installer and the recipe's THIRD-PARTY-NOTICES.md,
# fetched from moving URLs), librsvg's resolved Cargo.lock, the crates compiled
# for it, or the Rust compiler that built its Rust code and standard library
# (read from the library itself; notices.json's rustStd is for that commit).
REF="$GITHUB_WORKSPACE/scripts/margin/libvips"
drift=0
awk -F'\t' '$3 != "THIRD-PARTY-NOTICES.md" && $3 != "rustup-init" && $3 != "sh.rustup.rs" {print $1"\t"$3"\t"$4}' "$OUT/sources/manifest.tsv" \
  | diff "$REF/expected-sources.tsv" - || { echo "recipe downloads differ from expected-sources.tsv" >&2; drift=1; }
diff "$REF/librsvg-Cargo.lock" "$OUT/sources/librsvg-Cargo.lock" > /dev/null || { echo "librsvg Cargo.lock differs from the recorded one" >&2; drift=1; }
diff "$REF/librsvg-compiled.txt" "$OUT/sources/librsvg-compiled.txt" || { echo "librsvg compiled crates differ" >&2; drift=1; }
[ "$(rustc_commits)" = "rustc/$RUSTC_COMMIT " ] || { echo "libvips-cpp has Rust code from $(rustc_commits), notices are for rustc $RUSTC_COMMIT" >&2; drift=1; }
[ "$drift" = 0 ] && echo "no drift from the recorded build"
