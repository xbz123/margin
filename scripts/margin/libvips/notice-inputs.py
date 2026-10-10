#!/usr/bin/env python3 -I
# S22: notice inputs for the rebuilt libvips-cpp that Margin ships. Reads the
# `margin-libvips-sources-<commit>` artifact of a CI run (every archive the recipe
# downloaded, with manifest.tsv, and the crates librsvg was compiled from) and
# writes:
#   scripts/margin/license-inputs/libvips/<sha256>.txt   original license files, verbatim
#   scripts/margin/libvips/notices.json                  one entry per file, read by
#                                                        collect-licenses.mjs
# Only reads the archives; nothing is built or executed.
#   python3 -I scripts/margin/libvips/notice-inputs.py <sources dir>
#   python3 -I scripts/margin/libvips/notice-inputs.py --supplements
#   python3 -I scripts/margin/libvips/notice-inputs.py --rust-std
# The second form adds the notices of the ten compiled crates whose published
# .crate has no license file (SUPPLEMENTS), fetched from fixed URLs and checked
# against the sha256 recorded here or, for crates, the librsvg Cargo.lock checksum.
# The third adds those of the Rust standard library the pinned nightly built
# (RUST_FILES, STD_CRATES), checked the same way against its library/Cargo.lock.
import hashlib, io, json, os, re, sys, tarfile, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
INPUTS = os.path.join(ROOT, 'scripts/margin/license-inputs/libvips')
OUT = os.path.join(ROOT, 'scripts/margin/libvips/notices.json')

# The license files of each library linked into libvips-cpp, by archive name, with
# the license the project states. Paths are relative to the archive's top directory.
LIBRARIES = {
    '0.5.tar.gz': ('proxy-libintl', '0.5', 'LGPL-2.1-or-later', ['COPYING']),
    '2.2.5.tar.gz': ('zlib-ng', '2.2.5', 'Zlib', ['LICENSE.md']),
    'libffi-3.5.2.tar.gz': ('libffi', '3.5.2', 'MIT', ['LICENSE']),
    'glib-2.86.1.tar.xz': ('glib', '2.86.1', 'LGPL-2.1-or-later', [
        'LICENSES/LGPL-2.1-or-later.txt', 'LICENSES/LGPL-2.1-only.txt', 'LICENSES/Apache-2.0.txt',
        'LICENSES/CC0-1.0.txt', 'LICENSES/LLVM-exception.txt', 'LICENSES/MIT.txt', 'LICENSES/MPL-1.1.txt',
        'LICENSES/GPL-2.0-or-later.txt']),
    'libxml2-2.15.1.tar.xz': ('libxml2', '2.15.1', 'MIT', ['Copyright']),
    'libexif-0.6.25.tar.xz': ('libexif', '0.6.25', 'LGPL-2.1-or-later', ['COPYING']),
    'lcms2-2.17.tar.gz': ('lcms2', '2.17', 'MIT', ['LICENSE']),
    'libaom-3.13.1.tar.gz': ('aom', '3.13.1', 'BSD-2-Clause', [
        'LICENSE', 'PATENTS', 'third_party/fastfeat/LICENSE', 'third_party/highway/LICENSE-BSD3',
        'third_party/libyuv/LICENSE', 'third_party/vector/LICENSE', 'third_party/SVT-AV1/LICENSE.md',
        'third_party/SVT-AV1/PATENTS.md']),
    'libheif-1.20.2.tar.gz': ('libheif', '1.20.2', 'LGPL-3.0-or-later', ['COPYING']),
    '0826579.tar.gz': ('mozjpeg', '0826579', 'IJG AND BSD-3-Clause AND Zlib', ['LICENSE.md', 'README.ijg']),
    'v1.6.50.tar.gz': ('libpng', '1.6.50', 'libpng-2.0', ['LICENSE']),
    'v0.7.4.tar.gz': ('libspng', '0.7.4', 'BSD-2-Clause', ['LICENSE']),
    'v2.4.1.tar.gz': ('libimagequant', '2.4.1', 'BSD-2-Clause', ['COPYRIGHT']),
    'libwebp-1.6.0.tar.gz': ('libwebp', '1.6.0', 'BSD-3-Clause', ['COPYING', 'PATENTS']),
    'tiff-4.7.1.tar.gz': ('libtiff', '4.7.1', 'libtiff', ['LICENSE.md']),
    '1.3.0.tar.gz': ('highway', '1.3.0', 'Apache-2.0 OR BSD-3-Clause', ['LICENSE', 'LICENSE-BSD3']),
    'VER-2-14-1.tar.gz': ('freetype', '2.14.1', 'FTL', ['LICENSE.TXT', 'docs/FTL.TXT', 'src/bdf/README', 'src/pcf/README']),
    'expat-2.7.3.tar.xz': ('expat', '2.7.3', 'MIT', ['COPYING']),
    'libarchive-3.8.2.tar.xz': ('libarchive', '3.8.2', 'BSD-2-Clause', ['COPYING']),
    'fontconfig-2.17.1.tar.gz': ('fontconfig', '2.17.1', 'MIT', ['COPYING']),
    '12.1.0.tar.gz': ('harfbuzz', '12.1.0', 'MIT-Modern-Variant', ['COPYING', 'src/ms-use/COPYING']),
    'pixman-0.46.4.tar.gz': ('pixman', '0.46.4', 'MIT', ['COPYING']),
    'cairo-1.18.4.tar.xz': ('cairo', '1.18.4', 'LGPL-2.1-only OR MPL-1.1', ['COPYING', 'COPYING-LGPL-2.1', 'COPYING-MPL-1.1']),
    'fribidi-1.0.16.tar.xz': ('fribidi', '1.0.16', 'LGPL-2.1-or-later', ['COPYING']),
    'pango-1.57.0.tar.xz': ('pango', '1.57.0', 'LGPL-2.1-or-later', ['COPYING']),
    'librsvg-2.61.2.tar.xz': ('librsvg', '2.61.2', 'LGPL-2.1-or-later', ['COPYING.LIB']),
    'v0.5.0.tar.gz': ('cgif', '0.5.0', 'MIT', ['LICENSE']),
    'vips-8.17.3.tar.xz': ('libvips', '8.17.3', 'LGPL-2.1-or-later', ['LICENSE']),
}
# Downloads that are tools or patches, not libraries with their own notices.
NOT_LIBRARIES = {'sh.rustup.rs', 'rustup-init', 'glib-without-gregex.patch', '6d2b7f71b98bfa28e372b1f2d85f137280bdb3de.patch',
                 'ad48f2bf298bac247288c8399a5c0e9a40ed8246.patch', 'libvips-cpp-soversion.patch',
                 'vips-8-heifsave-disable-hbr-support.patch', 'THIRD-PARTY-NOTICES.md'}
CRATE_LICENSE = re.compile(r'^(COPYING|COPYRIGHT|LICEN[CS]E|NOTICE|PATENTS|UNLICENSE)[^/]*$', re.I)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def keep(data):
    os.makedirs(INPUTS, exist_ok=True)
    digest = sha256(data)
    with open(os.path.join(INPUTS, f'{digest}.txt'), 'wb') as f:
        f.write(data)
    return digest


SPDX = 'https://raw.githubusercontent.com/spdx/license-list-data/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text'
CRATE = 'https://static.crates.io/crates/{0}/{0}-{1}.crate'
# (crate, version, license, how): 'url' = the file at the crate's source commit;
# 'header' = the license header of a source file in the crate; 'metadata' = the
# crate's Cargo.toml declaration plus the standard terms, because neither the crate
# nor its repository has a license file (no copyright is supplied for them).
SUPPLEMENTS = [
    ('cssparser-color', '0.3.0', 'MPL-2.0', 'url', 'https://raw.githubusercontent.com/servo/rust-cssparser/3dd4f63639925438d9932dafc0d81395847f9be4/LICENSE',
     'fab3dd6bdab226f1c08630b1dd917e11fcb4ec5e1e020e2c16f83a0a13863e85', 'LICENSE of servo/rust-cssparser at 3dd4f636, the commit in the crate\'s .cargo_vcs_info.json'),
    ('selectors', '0.31.0', 'MPL-2.0', 'header', 'selectors-0.31.0/lib.rs', None,
     'MPL-2.0 header of lib.rs in the published crate; servo/stylo at 7f8df16f (the crate\'s commit) has no license file; the MPL-2.0 text is the cssparser-color entry\'s Servo copy'),
    ('zune-core', '0.4.12', 'Zlib', 'url', 'https://raw.githubusercontent.com/etemesi254/zune-image/f8fbb123d5ed04441e8324a555bfcda0cb1bd28f/LICENSE-ZLIB',
     '7fa429541e55b1509909e058f2d21a37467e4958ec713b357f6e0cf9dc4ee352', 'LICENSE-ZLIB of etemesi254/zune-image at f8fbb123 (the crate\'s commit); Zlib selected from MIT OR Apache-2.0 OR Zlib because only its full text is in the repository'),
    ('zune-core', '0.4.12', 'Zlib', 'url', 'https://raw.githubusercontent.com/etemesi254/zune-image/f8fbb123d5ed04441e8324a555bfcda0cb1bd28f/LICENSE.md',
     'c6dff146a9f31848ac296faa5a08a4253caf2c384c86f906dc99e7fc0a39cc8c', 'LICENSE.md (copyright line) of etemesi254/zune-image at f8fbb123'),
    ('zune-jpeg', '0.4.20', 'Zlib', 'url', 'https://raw.githubusercontent.com/etemesi254/zune-image/12c415278200f0bd42dc2ef19c1be97b7312251e/LICENSE-ZLIB',
     '7fa429541e55b1509909e058f2d21a37467e4958ec713b357f6e0cf9dc4ee352', 'LICENSE-ZLIB of etemesi254/zune-image at 12c41527 (the crate\'s commit); Zlib selected as for zune-core'),
    ('zune-jpeg', '0.4.20', 'Zlib', 'url', 'https://raw.githubusercontent.com/etemesi254/zune-image/12c415278200f0bd42dc2ef19c1be97b7312251e/LICENSE.md',
     'c6dff146a9f31848ac296faa5a08a4253caf2c384c86f906dc99e7fc0a39cc8c', 'LICENSE.md (copyright line) of etemesi254/zune-image at 12c41527'),
    ('malloc_buf', '0.0.6', 'MIT', 'url', 'https://raw.githubusercontent.com/SSheldon/malloc_buf/d9a3e539642bd90e07df458d226b19cdfa606863/LICENSE',
     'aced7b57e474a63edb5a724954222bf7659c01ceef0e648a03af799582991db7', 'MIT LICENSE the author added to SSheldon/malloc_buf in 2020 (d9a3e539), after the 0.0.6 tag a7811e5f; not asserted to have been in the 0.0.6 crate'),
    ('block', '0.1.6', 'MIT', 'metadata', 'block-0.1.6/Cargo.toml', None, 'license = "MIT" in the published Cargo.toml; neither the crate nor SSheldon/rust-block has a license file'),
    ('objc_id', '0.1.1', 'MIT', 'metadata', 'objc_id-0.1.1/Cargo.toml', None, 'license = "MIT" in the published Cargo.toml; neither the crate nor SSheldon/rust-objc-id has a license file'),
    ('objc-foundation', '0.1.1', 'MIT', 'metadata', 'objc-foundation-0.1.1/Cargo.toml', None, 'license = "MIT" in the published Cargo.toml; neither the crate nor SSheldon/rust-objc-foundation has a license file'),
    ('fxhash', '0.2.1', 'Apache-2.0', 'metadata', 'fxhash-0.2.1/Cargo.toml', None, 'license = "Apache-2.0/MIT" in the published Cargo.toml, Apache-2.0 selected; neither the crate nor cbreeden/fxhash has a license file'),
    ('mac', '0.1.1', 'Apache-2.0', 'metadata', 'mac-0.1.1/Cargo.toml', None, 'license = "MIT/Apache-2.0" in the published Cargo.toml (the README says "MIT/Apache-2.0, like rust itself"), Apache-2.0 selected; neither the crate nor reem/rust-mac has a license file'),
]
STANDARD = {'MIT': (f'{SPDX}/MIT.txt', 'b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5'),
            'Apache-2.0': (f'{SPDX}/Apache-2.0.txt', '074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff')}


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def lock_checksums():
    sums, block = {}, ''
    for block in open(os.path.join(ROOT, 'scripts/margin/libvips/librsvg-Cargo.lock')).read().split('[[package]]'):
        field = lambda k: (re.search(rf'^{k} = "([^"]+)"', block, re.M) or [None, None])[1]
        if field('checksum'):
            sums[(field('name'), field('version'))] = field('checksum')
    return sums


def supplements():
    sums, entries = lock_checksums(), []
    def entry(id_, version, license, url, data, role, extra=None):
        text = keep(data)
        entries.append({'id': id_, 'version': version, 'license': license, 'url': url,
                        'localPath': f'scripts/margin/license-inputs/libvips/{text}.txt', 'sourceSHA256': text, 'sha256': text,
                        'gitBlob': git_blob(data), **(extra or {}), 'role': role + ' (S22)', 'closesMissing': False})
    for name, version, license, how, where, expected, note in SUPPLEMENTS:
        if how == 'url':
            data = fetch(where)
            if sha256(data) != expected:
                raise SystemExit(f'changed: {where}')
            entry(f'librsvg-crate:{name}@{version}:{where.rsplit("/", 1)[1]}', version, license, where, data, note)
            continue
        url = CRATE.format(name, version)
        crate = fetch(url)
        if sha256(crate) != sums[(name, version)]:
            raise SystemExit(f'crate checksum mismatch: {name} {version}')
        with tarfile.open(fileobj=io.BytesIO(crate)) as t:
            data = t.extractfile(where).read()
        archive = {'archive': {'url': url, 'sha256': sums[(name, version)], 'member': where}}
        if how == 'header':
            end = data.index(b'*/') + 2
            entry(f'librsvg-crate:{name}@{version}:license-header', version, license, url, data[:end], note,
                  {**archive, 'byteRange': {'start': 0, 'endExclusive': end}})
        else:
            entry(f'librsvg-crate:{name}@{version}:metadata', version, license, url, data, note, archive)
            standard_url, standard_sha = STANDARD[license]
            standard = fetch(standard_url)
            if sha256(standard) != standard_sha:
                raise SystemExit(f'changed: {standard_url}')
            entry(f'librsvg-crate:{name}@{version}:standard-{license}', version, license, standard_url, standard,
                  f'fixed SPDX {license} terms for {name} {version}, which declares {license} in metadata only; standard placeholders unchanged, no copyright supplied')
    with open(OUT) as f:
        notices = json.load(f)
    notices['supplements'] = entries
    with open(OUT, 'w') as f:
        json.dump(notices, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(json.dumps({'supplements': len(entries), 'texts': len(os.listdir(INPUTS))}))


# The Rust standard library linked through librsvg into libvips-cpp, built by the
# recipe's pinned nightly (rebuild.sh: nightly-2026-10-09, rustc a30aa906). libvips
# has no linker map, so every registry dependency of std for aarch64-apple-darwin in
# that commit's library/Cargo.lock is covered (not the wasm, sgx, hermit, uefi, xous
# or windows ones, nor build tools and test crates), with the license files of the
# in-tree compiler-builtins and stdarch (core::arch).
RUSTC_COMMIT = 'a30aa9064df6a504b6a323c6884a2f4cfbfff666'
RUST_RAW = f'https://raw.githubusercontent.com/rust-lang/rust/{RUSTC_COMMIT}'
RUST_FILES = [
    ('COPYRIGHT', '172020dbfd5b53a226dfde77616190a48dcff519b0bc0e6deb91a8450782c4af'),
    ('LICENSE-MIT', 'b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1'),
    ('LICENSE-APACHE', '62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a'),
    ('library/compiler-builtins/LICENSE.txt', 'ab6eec6caf0fa5775e411c7a8bc6a45c4ef2956b0980b157ab74fc5cd62a928b'),
    ('library/stdarch/LICENSE-MIT', '29662666b44dff84977b46e05642cdef910bc3a93a17b5fd86e632bafa59cf21'),
    ('library/stdarch/LICENSE-APACHE', 'a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2'),
]
STD_LOCK_SHA256 = '45e36114b9fbeb1a778c470ea4e3a6e31b9ac2029de0d9a7077abac757ec0b29'
STD_CRATES = ['addr2line', 'gimli', 'miniz_oxide', 'adler2', 'cfg-if', 'hashbrown', 'foldhash', 'libc', 'memchr', 'object', 'rustc-demangle']


def rust_std():
    entries = []
    def entry(id_, version, license, url, data, role, extra=None):
        text = keep(data)
        entries.append({'id': id_, 'version': version, 'license': license, 'url': url,
                        'localPath': f'scripts/margin/license-inputs/libvips/{text}.txt', 'sourceSHA256': text, 'sha256': text,
                        'gitBlob': git_blob(data), **(extra or {}), 'role': role, 'closesMissing': False})
    linked = 'statically linked through librsvg into the libvips-cpp Margin ships, as part of the Rust standard library built by nightly-2026-10-09 (rustc a30aa906)'
    for path, expected in RUST_FILES:
        data = fetch(f'{RUST_RAW}/{path}')
        if sha256(data) != expected:
            raise SystemExit(f'changed: {path}')
        entry(f'rust-std:rust@{RUSTC_COMMIT[:9]}:{path}', RUSTC_COMMIT[:9], 'MIT OR Apache-2.0', f'{RUST_RAW}/{path}', data,
              f'original {path} of rust-lang/rust at {RUSTC_COMMIT[:9]}; {linked}')
    lock = fetch(f'{RUST_RAW}/library/Cargo.lock')
    if sha256(lock) != STD_LOCK_SHA256:
        raise SystemExit('changed: library/Cargo.lock')
    packages = {}
    for block in lock.decode('utf8').split('[[package]]'):
        field = lambda k: (re.search(rf'^{k} = "([^"]+)"', block, re.M) or [None, None])[1]
        if field('checksum'):
            packages[field('name')] = (field('version'), field('checksum'))
    for name in STD_CRATES:
        version, checksum = packages[name]
        url = CRATE.format(name, version)
        crate = fetch(url)
        if sha256(crate) != checksum:
            raise SystemExit(f'crate checksum mismatch: {name} {version}')
        top = f'{name}-{version}'
        with tarfile.open(fileobj=io.BytesIO(crate)) as t:
            toml = t.extractfile(f'{top}/Cargo.toml').read().decode('utf8')
            license = (re.search(r'^license\s*=\s*"([^"]+)"', toml, re.M) or [None, 'UNKNOWN'])[1]
            files = sorted(m.name[len(top) + 1:] for m in t.getmembers()
                           if m.isfile() and '/' not in m.name[len(top) + 1:] and CRATE_LICENSE.match(m.name[len(top) + 1:]))
            if not files:
                raise SystemExit(f'no license file: {name} {version}')
            for member in files:
                entry(f'rust-std-crate:{name}@{version}:{member}', version, license, url, t.extractfile(f'{top}/{member}').read(),
                      f'original {member} of the {name} {version} crate (version and checksum from library/Cargo.lock of rust-lang/rust at {RUSTC_COMMIT[:9]}); {linked}',
                      {'archive': {'url': url, 'sha256': checksum, 'member': f'{top}/{member}'}})
    with open(OUT) as f:
        notices = json.load(f)
    notices['rustStd'] = entries
    with open(OUT, 'w') as f:
        json.dump(notices, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(json.dumps({'rustStd': len(entries), 'texts': len(os.listdir(INPUTS))}))


def main(src):
    entries, seen = [], set()
    for line in open(os.path.join(src, 'manifest.tsv')):
        digest, size, name, url = line.rstrip('\n').split('\t')
        if name in NOT_LIBRARIES:
            continue
        if name not in LIBRARIES:
            raise SystemExit(f'unclassified download: {name}')
        if (name, url) in seen:
            continue  # the recipe fetches freetype twice (before and after harfbuzz)
        seen.add((name, url))
        component, version, license, members = LIBRARIES[name]
        archive = os.path.join(src, 'files', f'{digest}-{name}')
        with tarfile.open(archive) as t:
            top = t.getmembers()[0].name.split('/')[0]
            for member in members:
                data = t.extractfile(f'{top}/{member}').read()
                text = keep(data)
                entries.append({
                    'id': f'libvips-dep:{component}@{version}:{member}', 'version': version, 'license': license, 'url': url,
                    'localPath': f'scripts/margin/license-inputs/libvips/{text}.txt', 'sourceSHA256': text,
                    'sha256': text, 'gitBlob': git_blob(data),
                    'archive': {'url': url, 'sha256': digest, 'member': f'{top}/{member}'},
                    'role': f'original {member} of {component} {version}, from the archive the sharp-libvips recipe 20b5e899 downloaded; statically linked into the libvips-cpp Margin ships (S22)',
                    'closesMissing': False})
    missing = []
    for line in open(os.path.join(src, 'librsvg-compiled.txt')):
        name, version = line.split()
        crate = os.path.join(src, 'librsvg-crates', f'{name}-{version}.crate')
        with open(crate, 'rb') as f:
            crate_sha = sha256(f.read())
        top = f'{name}-{version}'
        with tarfile.open(crate) as t:
            toml = t.extractfile(f'{top}/Cargo.toml').read().decode('utf8')
            license = (re.search(r'^license\s*=\s*"([^"]+)"', toml, re.M) or [None, 'UNKNOWN'])[1]
            files = sorted(m.name[len(top) + 1:] for m in t.getmembers()
                           if m.isfile() and '/' not in m.name[len(top) + 1:] and CRATE_LICENSE.match(m.name[len(top) + 1:]))
            if not files:
                missing.append({'crate': name, 'version': version, 'license': license, 'crateSHA256': crate_sha})
            for member in files:
                data = t.extractfile(f'{top}/{member}').read()
                text = keep(data)
                entries.append({
                    'id': f'librsvg-crate:{name}@{version}:{member}', 'version': version, 'license': license,
                    'url': f'https://static.crates.io/crates/{name}/{name}-{version}.crate',
                    'localPath': f'scripts/margin/license-inputs/libvips/{text}.txt', 'sourceSHA256': text,
                    'sha256': text, 'gitBlob': git_blob(data),
                    'archive': {'url': f'https://static.crates.io/crates/{name}/{name}-{version}.crate', 'sha256': crate_sha, 'member': f'{top}/{member}'},
                    'role': f'original {member} of the {name} {version} crate (checksum in librsvg Cargo.lock), compiled into librsvg inside the libvips-cpp Margin ships (S22)',
                    'closesMissing': False})
    previous = json.load(open(OUT)) if os.path.exists(OUT) else {}
    with open(OUT, 'w') as f:
        json.dump({'recipe': '20b5e899954907a3039d6e3d4c200aaa0ec52c4c', 'entries': entries, 'cratesWithoutLicenseFile': missing,
                   'supplements': previous.get('supplements', []), 'rustStd': previous.get('rustStd', [])}, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(json.dumps({'entries': len(entries), 'texts': len(os.listdir(INPUTS)), 'cratesWithoutLicenseFile': [m['crate'] for m in missing]}))


if __name__ == '__main__':
    {'--supplements': supplements, '--rust-std': rust_std}.get(sys.argv[1], lambda: main(sys.argv[1]))()
