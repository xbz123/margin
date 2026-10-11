# Checks the S35 rules against the counterexamples of the 2026-10-11 review
# (Astra): an upstream line with one identifier renamed, a binary file, a short
# line, a file type the upstream scan does not pool, and the two classification
# inputs. Runs analyze_all.analyze() and build_reuse_list.kind() unchanged on a
# synthetic repository in a temporary directory; no network.
#   python3 rule_probes.py <repo>      (repo: for the check's TEXT_EXT and config)
import importlib.util, json, os, re, shutil, subprocess, sys, tempfile
sys.dont_write_bytecode = True

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('analyze_all', os.path.join(here, 'analyze_all.py'))
aa = importlib.util.module_from_spec(spec); spec.loader.exec_module(aa)
build_src = open(os.path.join(here, 'build_reuse_list.py')).read()
ns = {}; exec(re.search(r'^def kind\(s\):\n(?:    .*\n)+', build_src, re.M).group(0), ns)
kind = ns['kind']

def git(root, *a, input=None):
    return subprocess.run(['git', '-C', root, *a], capture_output=True, check=True, input=input).stdout.decode().strip()

def commit(root, files, message, parent=None):
    for path, data in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, path)) or root, exist_ok=True)
        open(os.path.join(root, path), 'wb').write(data if isinstance(data, bytes) else data.encode())
    git(root, 'add', '-f', *files)
    tree = git(root, 'write-tree')
    sha = git(root, 'commit-tree', tree, *(['-p', parent] if parent else []), '-m', message)
    git(root, 'reset', '-q', sha)
    return sha

UPSTREAM = 'const restrictedOrdering = calls.map((call) => normalizeCall(call)).reverse();'
results, failures = {}, []
def check(name, ok, detail):
    results[name] = dict(ok=ok, detail=detail)
    if not ok: failures.append(name)

with tempfile.TemporaryDirectory(prefix='s35-probe-') as root:
    git(root, 'init', '-q')
    git(root, 'config', 'user.name', 'S35 probe'); git(root, 'config', 'user.email', 'probe@example.invalid')
    for f in ('scripts/margin/provenance-check.mjs', 'docs/margin/provenance-config.json'):
        os.makedirs(os.path.dirname(os.path.join(root, f)), exist_ok=True)
        shutil.copy(os.path.join(sys.argv[1], f), os.path.join(root, f))
    base = commit(root, {'example.ts': 'export const baselineLine = computeBaselineValue(input);\n'}, 'baseline')
    # The snapshot has no common history with the baseline, as fcfbb02a.
    fork = commit(root, {'example.ts': 'export const baselineLine = computeBaselineValue(input);\n' + UPSTREAM + '\n',
                         'binary.docx': b'PK\x03\x04\x00first-long-synthetic-binary-record\n',
                         'data.json': '{ "upstreamSetting": "upstream value here" }\n'}, 'snapshot')
    tip = commit(root, {'example.ts': 'export const baselineLine = computeBaselineValue(input);\n'
                                      + UPSTREAM.replace('restrictedOrdering', 'marginOrdering') + '\n'
                                      + 'const marginOnlyHelper = buildMarginThing(options);\n' + 'return x;\n',
                        'binary.docx': b'PK\x03\x04\x00second-long-synthetic-binary-record\n',
                        'data.json': '{ "upstreamSetting": "upstream value here", "marginSetting": true }\n'}, 'margin', fork)
    aa.TIP, aa.FORK, aa.BASE = tip, fork, base
    aa.setup(root, {})
    ex = aa.analyze('example.ts')
    check('renamed upstream line is flagged near-snapshot, not a candidate', ex['nearSnapshotLines'] == [2],
          dict(nearSnapshotLines=ex['nearSnapshotLines'], candidateRanges=ex['candidateRanges']))
    check('short line is listed as not scanned, outside candidate ranges', ex['shortRanges'] == [[4, 4]]
          and all(not (a <= 4 <= b) for a, b in ex['candidateRanges']), dict(shortRanges=ex['shortRanges']))
    check('file with upstream content at the fork is not a whole-file candidate',
          ex['forkUpstream'] == 1 and kind(ex) != 'whole', dict(forkUpstream=ex['forkUpstream'], kind=kind(ex)))
    bi = aa.analyze('binary.docx')
    check('binary file goes to asset review', bi['coverage'] == 'asset' and kind(bi) == 'asset',
          dict(coverage=bi['coverage'], kind=kind(bi)))
    js = aa.analyze('data.json')
    check('extension outside the upstream pool is marked not covered', js['coverage'] == 'ext-not-covered',
          dict(coverage=js['coverage']))

def profile(**k):
    return dict(dict(coverage='text-scanned', total=0, margin=0, marginHits=0, nearSnapshot=0,
                     snapshotNotBaseline=0, forkUpstream=0), **k)
a = profile(total=43, margin=43, marginHits=1)
b = profile(total=100, margin=91, snapshotNotBaseline=9)
check('one hit is no longer a whole-file candidate', kind(a) == 'rewrite', dict(input=a, kind=kind(a)))
check('snapshot lines with no hit are no longer whole either', kind(b) == 'rewrite', dict(input=b, kind=kind(b)))
check('only a file with no signal at all is a whole-file candidate', kind(profile(total=43, margin=43)) == 'whole', {})

print(json.dumps(results, indent=1, ensure_ascii=False))
print('failures:', failures)
sys.exit(1 if failures else 0)
