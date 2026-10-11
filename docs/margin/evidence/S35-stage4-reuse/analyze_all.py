# Per-file provenance profile of every file old Margin (b8ade3f7) adds or changes
# against the baseline (PLAN S35). Nothing here proves who first wrote a line:
#
# - `git blame -w -M -C -C fcfbb02a..b8ade3f7` names the commit that last changed
#   each current line, with help for moved and copied lines. Boundary lines come
#   from the imported snapshot fcfbb02a; the others were last changed in Margin's
#   own commits ("Margin lines"). A Margin line may still be an edited upstream
#   line, so Margin lines are review candidates, not cleared code.
# - Snapshot lines absent from the same baseline (a786910e) file count as upstream
#   content (`snapshotNotBaselineLines`).
# - `nearSnapshotLines`: Margin lines whose shape (identifiers, strings and numbers
#   masked) equals a snapshot-only line of the file's snapshot version and that
#   share at least half of their identifier and string tokens with it (Jaccard):
#   likely edits of upstream lines.
# - `forkUpstream`: substantive lines of the file's snapshot version (rename
#   followed) that the baseline file lacks. Above zero, Margin's lines are edits
#   inside upstream-derived code and need a look at the commit diffs.
# - `hits` come from
#     node scripts/margin/provenance-check.mjs --target b8ade3f7 --json --max-hits 0
#   (saved as hit-lines.json: path -> line numbers). Lines of 12 characters or
#   fewer are never scanned (`shortLines`), and the upstream pool only holds the
#   extensions in the check's TEXT_EXT, so `coverage` records per file whether its
#   lines were compared at all: text-scanned, ext-not-covered, excluded or asset.
#   python3 analyze_all.py <repo> files-all.txt hit-lines.json <out.json>
import collections, json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

TIP, FORK, BASE = 'b8ade3f7', 'fcfbb02a', 'a786910e'
MIN = 12
# Set by setup(); rule_probes.py sets them on a synthetic repository.
repo, hits, SOURCE, TEXT_EXT, EXCLUDE = None, {}, {}, None, []

def git(*a, binary=False):
    r = subprocess.run(['git', '-C', repo, *a], capture_output=True)
    return r.returncode, (r.stdout if binary else r.stdout.decode('utf-8', 'replace'))

def setup(repo_path, hit_lines):
    global repo, hits, SOURCE, TEXT_EXT, EXCLUDE
    repo, hits = repo_path, hit_lines
    # Keep the scan's extension list and excluded paths in step with the check itself.
    check_src = open(f'{repo}/scripts/margin/provenance-check.mjs').read()
    TEXT_EXT = re.compile(re.search(r'const TEXT_EXT = /(.+)/i;', check_src).group(1), re.I)
    EXCLUDE = json.load(open(f'{repo}/docs/margin/provenance-config.json'))['excludePaths']
    # Snapshot path of each file, following renames between the snapshot and the tip.
    _, ns = git('diff', '--name-status', '-M', FORK, TIP)
    SOURCE = {}
    for row in ns.splitlines():
        f = row.split('\t')
        if f[0].startswith('R'): SOURCE[f[2]] = f[1]

ASSET_EXT = re.compile(r'\.(pdf|docx|xlsx|pptx|zip|png|jpe?g|gif|webp|ico|icns|ttf|otf|woff2?|mp3|wav|m4a|node|dylib|exe)$', re.I)

def coverage(path, blob):
    if ASSET_EXT.search(path) or b'\0' in blob[:8000]: return 'asset'
    if any(path == e or path.startswith(e.rstrip('/') + '/') for e in EXCLUDE): return 'excluded'
    return 'text-scanned' if TEXT_EXT.search(path) else 'ext-not-covered'

KW = set('''const let var function return if else for while do switch case break continue new this class extends
import from export default async await try catch finally throw typeof instanceof in of void delete null undefined
true false interface type enum implements public private protected readonly static get set yield as satisfies keyof
super pub fn mut impl struct use match self Self'''.split())
STR = re.compile(r'''(['"`])(?:\\.|(?!\1)[^\\])*\1''')
NUM = re.compile(r'\b\d[\w.]*')
WORD = re.compile(r'[A-Za-z_$][\w$]*')

def shape(t):
    t = NUM.sub('\x02', STR.sub('\x01', t))
    return WORD.sub(lambda m: m.group(0) if m.group(0) in KW else '\x03', t)

def tokens(t):
    return frozenset(m.group(0) for m in STR.finditer(t)) | frozenset(
        w for w in WORD.findall(STR.sub(' ', t)) if w not in KW)

def index(lines):
    """Shape -> (token sets, token -> positions) for the snapshot-only lines."""
    out = {}
    for x in set(lines):
        sets, post = out.setdefault(shape(x), ([], {}))
        b = tokens(x)
        for tok in b: post.setdefault(tok, []).append(len(sets))
        sets.append(b)
    return out

def near_line(t, shapes):
    bucket = shapes.get(shape(t))
    a = tokens(t)
    if not bucket or not a: return False
    sets, post = bucket
    shared = collections.Counter()
    for tok in a: shared.update(post.get(tok, ()))
    return any(c >= 0.5 * (len(a) + len(sets[i]) - c) for i, c in shared.items())

def runs(ns):
    out = []
    for n in ns:
        if out and n == out[-1][1] + 1: out[-1][1] = n
        else: out.append([n, n])
    return out

def analyze(path):
    rc, blob = git('cat-file', 'blob', f'{TIP}:{path}', binary=True)
    cov = coverage(path, blob)
    rc_b, base_text = git('show', f'{BASE}:{path}')
    base = set(x.strip() for x in base_text.splitlines()) if rc_b == 0 else set()
    src = SOURCE.get(path, path)
    rc_s, snap_text = git('show', f'{FORK}:{src}')
    st = dict(path=path, coverage=cov, inBaseline=rc_b == 0, inSnapshot=rc_s == 0,
              snapshotPath=src if rc_s == 0 else None)
    if cov == 'asset':
        _, blob_sha = git('rev-parse', f'{TIP}:{path}')
        _, snap_sha = git('rev-parse', f'{FORK}:{src}')
        _, log = git('log', '--format=%h %ad %s', '--date=short', f'{FORK}..{TIP}', '--', path)
        st.update(blob=blob_sha.strip(), sameAsSnapshot=rc_s == 0 and blob_sha.strip() == snap_sha.strip(),
                  bytes=len(blob), marginCommits=[l for l in log.splitlines()][:5])
        return st
    snap_only = [x.strip() for x in snap_text.splitlines()
                 if rc_s == 0 and len(x.strip()) > MIN and x.strip() not in base]
    # Only scanned text gets the near test; other files are reviewed by hand anyway.
    shapes = index(snap_only) if cov == 'text-scanned' else {}
    rc, raw = git('blame', '--porcelain', '-w', '-M', '-C', '-C', f'{FORK}..{TIP}', '--', path)
    if rc: return dict(st, error=raw.strip()[:200])
    commits, cur, lines = {}, None, []
    for l in raw.splitlines():
        m = re.match(r'^([0-9a-f]{40}) \d+ (\d+)', l)
        if m:
            cur = m.group(1); commits.setdefault(cur, {'boundary': False})
        elif l == 'boundary': commits[cur]['boundary'] = True
        elif l.startswith('\t'): lines.append((cur, l[1:]))
    hitset = set(hits.get(path, []))
    st.update(lines=len(lines), total=0, margin=0, snapshot=0, snapshotNotBaseline=0, hits=len(hitset),
              marginHits=0, nearSnapshot=0, forkUpstream=len(set(snap_only)), marginCommits=set())
    cand, short, hitl, nearl, nbl = [], [], [], [], []
    for n, (c, text) in enumerate(lines, 1):
        t = text.strip(); boundary = commits[c]['boundary']
        if len(t) <= MIN:
            if not boundary and t: short.append(n)
            continue
        st['total'] += 1
        if boundary:
            st['snapshot'] += 1
            if t not in base: st['snapshotNotBaseline'] += 1; nbl.append(n)
            continue
        st['margin'] += 1; st['marginCommits'].add(c[:8])
        if n in hitset: hitl.append(n); continue
        if near_line(t, shapes):
            nearl.append(n); continue
        cand.append(n)
    st.update(marginHits=len(hitl), nearSnapshot=len(nearl), marginHitLines=hitl, nearSnapshotLines=nearl,
              snapshotNotBaselineRanges=runs(nbl), candidateRanges=runs(cand), shortRanges=runs(short),
              marginCommits=sorted(st['marginCommits']))
    return st

if __name__ == '__main__':
    repo_arg, files_txt, hits_json, out = sys.argv[1:5]
    setup(repo_arg, json.load(open(hits_json)))
    paths = [p.strip() for p in open(files_txt) if p.strip()]
    with ThreadPoolExecutor(8) as ex: res = list(ex.map(analyze, paths))
    # One file per line, so a rerun shows up as a readable diff.
    rows = [json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in sorted(res, key=lambda s: s['path'])]
    open(out, 'w').write('[\n' + ',\n'.join(rows) + '\n]\n')
    print(len(res), 'errors', sum(1 for x in res if 'error' in x),
          'coverage', {c: sum(1 for x in res if x['coverage'] == c) for c in ('text-scanned', 'ext-not-covered', 'excluded', 'asset')})
