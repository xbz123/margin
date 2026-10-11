# Per-file provenance profile of every file old Margin (b8ade3f7) adds or changes
# against the baseline (PLAN S35). For each line it runs
# `git blame -w -M -C -C fcfbb02a..b8ade3f7`: boundary lines come from the
# imported snapshot fcfbb02a, the rest were written in Margin's own commits.
# Snapshot lines not present in the same baseline (a786910e) file count as
# upstream content. `hits` come from
#   node scripts/margin/provenance-check.mjs --target b8ade3f7 --json --max-hits 0
# Lines of 12 characters or fewer are not counted, as in the provenance check;
# `cleanRanges` are runs of Margin-written lines (short lines included) that hold
# no hit and no snapshot line; `marginHitLines` are Margin-written lines that hit.
#   python3 analyze_all.py <repo> files.txt <provenance.json> <out.json>
import json, subprocess, sys, re
from concurrent.futures import ThreadPoolExecutor
repo, files_txt, prov_json, out = sys.argv[1:5]
TIP, FORK, BASE = 'b8ade3f7', 'fcfbb02a', 'a786910e'
MIN = 12
hits = json.load(open(prov_json))['hitsByFile']

def run(*a):
    return subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True, errors='replace')

def analyze(path):
    r = run('blame', '--porcelain', '-w', '-M', '-C', '-C', f'{FORK}..{TIP}', '--', path)
    if r.returncode:
        return dict(path=path, error=r.stderr.strip()[:200])
    commits, cur, lines = {}, None, []
    for l in r.stdout.splitlines():
        m = re.match(r'^([0-9a-f]{40}) \d+ (\d+)', l)
        if m:
            cur = m.group(1); commits.setdefault(cur, {'boundary': False})
        elif l == 'boundary': commits[cur]['boundary'] = True
        elif l.startswith('\t'): lines.append((cur, l[1:]))
    b = run('show', f'{BASE}:{path}')
    base = set(x.strip() for x in b.stdout.splitlines()) if b.returncode == 0 else set()
    hitset = {h['line'] for h in hits.get(path, [])}
    st = dict(path=path, lines=len(lines), inBaseline=b.returncode == 0, total=0, margin=0, snapshot=0,
              snapshotNotBaseline=0, hits=len(hitset), marginHits=0, marginHitLines=[], marginCommits=set())
    clean = []
    for n, (c, text) in enumerate(lines, 1):
        t = text.strip(); boundary = commits[c]['boundary']; sub = len(t) > MIN
        if sub:
            st['total'] += 1
            if boundary:
                st['snapshot'] += 1
                if t not in base: st['snapshotNotBaseline'] += 1
            else:
                st['margin'] += 1; st['marginCommits'].add(c[:8])
                if n in hitset: st['marginHits'] += 1; st['marginHitLines'].append(n)
        if not boundary and n not in hitset: clean.append(n)
    ranges = []
    for n in clean:
        if ranges and n == ranges[-1][1] + 1: ranges[-1][1] = n
        else: ranges.append([n, n])
    st['cleanRanges'] = ranges
    st['marginCommits'] = sorted(st['marginCommits'])
    return st

paths = [p.strip() for p in open(files_txt) if p.strip()]
with ThreadPoolExecutor(8) as ex: res = list(ex.map(analyze, paths))
json.dump(sorted(res, key=lambda s: s['path']), open(out, 'w'), indent=1)
open(out, 'a').write('\n')
print(len(res), sum(1 for x in res if 'error' in x))
