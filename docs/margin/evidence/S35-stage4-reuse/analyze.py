# Per-file provenance profile of old Margin (b8ade3f7) files for stage 4 (PLAN S35).
# For every line of each file it runs `git blame -w -M -C -C fcfbb02a..b8ade3f7`:
# lines blamed on the boundary are from the imported snapshot fcfbb02a, the rest
# were written in Margin's own commits. Snapshot lines not present in the same
# baseline (a786910e) file count as upstream content. `hits` come from
#   node scripts/margin/provenance-check.mjs --target b8ade3f7 --json --max-hits 0
# Lines of 12 characters or fewer are skipped, as in the provenance check.
#   python3 analyze.py <repo> files.txt <provenance.json> <out.json>
import json, subprocess, sys, re
from concurrent.futures import ThreadPoolExecutor
repo, files_txt, prov_json, out = sys.argv[1:5]
TIP, FORK, BASE = 'b8ade3f7', 'fcfbb02a', 'a786910e'
MIN = 12
hits = json.load(open(prov_json))['hitsByFile']
def git(*a, check=True):
    r = subprocess.run(['git', '-C', repo, *a], capture_output=True, text=True)
    if check and r.returncode: raise RuntimeError(r.stderr)
    return r.stdout
def base_lines(path):
    r = subprocess.run(['git', '-C', repo, 'show', f'{BASE}:{path}'], capture_output=True, text=True)
    return set(l.strip() for l in r.stdout.splitlines()) if r.returncode == 0 else set()
def analyze(path):
    por = git('blame', '--porcelain', '-w', '-M', '-C', '-C', f'{FORK}..{TIP}', '--', path)
    commits, cur, lines = {}, None, []
    it = iter(por.splitlines())
    for l in it:
        m = re.match(r'^([0-9a-f]{40}) \d+ (\d+)', l)
        if m:
            cur = m.group(1); commits.setdefault(cur, {'boundary': False, 'file': None})
            continue
        if l == 'boundary': commits[cur]['boundary'] = True
        elif l.startswith('filename '): commits[cur]['file'] = l[9:]
        elif l.startswith('\t'): lines.append((cur, l[1:]))
    base = base_lines(path)
    hitset = {h['line'] for h in hits.get(path, [])}
    st = dict(path=path, total=0, margin=0, snapshot=0, snapshotNotBaseline=0, hits=len(hitset), marginHits=0, movedFromOther=0, marginCommits=set())
    for n, (c, text) in enumerate(lines, 1):
        t = text.strip()
        if len(t) <= MIN: continue
        st['total'] += 1
        info = commits[c]
        if info['boundary']:
            st['snapshot'] += 1
            if t not in base: st['snapshotNotBaseline'] += 1
        else:
            st['margin'] += 1; st['marginCommits'].add(c[:8])
            if n in hitset: st['marginHits'] += 1
            if info['file'] and info['file'] != path: st['movedFromOther'] += 1
    st['inBaseline'] = bool(base)
    st['marginCommits'] = sorted(st['marginCommits'])
    return st
paths = [p.strip() for p in open(files_txt) if p.strip()]
with ThreadPoolExecutor(8) as ex: res = list(ex.map(analyze, paths))
json.dump(res, open(out, 'w'), indent=1)
print(len(res))
