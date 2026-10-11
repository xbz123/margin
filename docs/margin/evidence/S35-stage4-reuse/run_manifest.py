# Records the inputs of one S35 run so a rerun can tell rule changes, input changes
# and code changes apart: the commits, the upstream refs the provenance check pooled,
# its configuration and script, the scan summary and the tool versions.
#   python3 run_manifest.py <repo> <provenance.json> <this branch's commit> <out.json>
import hashlib, json, subprocess, sys

repo, prov_path, new, out = sys.argv[1:5]

def run(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout.strip()

def git(*a):
    return run('git', '-C', repo, *a)

def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

config_path = f'{repo}/docs/margin/provenance-config.json'
config = json.load(open(config_path))
refs = git('for-each-ref', '--format=%(objectname) %(refname)', *config['restrictedRefPrefixes']).splitlines()
refs += [f'{git("rev-parse", r)} (restrictedExtraRefs)' for r in config['restrictedExtraRefs']]
prov = json.load(open(prov_path))
ev = 'docs/margin/evidence/S35-stage4-reuse'
manifest = dict(
    commits=dict(baseline=git('rev-parse', 'a786910e'), snapshot=git('rev-parse', 'fcfbb02a'),
                 oldMargin=git('rev-parse', 'b8ade3f7'), thisBranch=git('rev-parse', new)),
    # The check reads its script and configuration from the working tree.
    head=git('rev-parse', 'HEAD'),
    checkInputsMatchHead=git('status', '--porcelain', '--', 'scripts/margin/provenance-check.mjs',
                             'docs/margin/provenance-config.json') == '',
    provenanceCheck=dict(script=git('hash-object', f'{repo}/scripts/margin/provenance-check.mjs'),
                         configSha256=sha256(config_path),
                         command='node scripts/margin/provenance-check.mjs --target b8ade3f7 --json --max-hits 0',
                         outputSha256=sha256(prov_path),
                         summary={k: v for k, v in prov.items() if k not in ('hitsByFile', 'genericIdioms', 'binariesToReviewByHand')},
                         binariesToReviewByHand=prov['binariesToReviewByHand']),
    restrictedRefs=dict(count=len(refs), sha256=hashlib.sha256('\n'.join(sorted(refs)).encode()).hexdigest(), refs=sorted(refs)),
    evidenceInputs={f: sha256(f'{repo}/{ev}/{f}') for f in ('files-all.txt', 'hit-lines.json', 'analyze_all.py', 'build_reuse_list.py')},
    tools=dict(git=run('git', '--version'), node=run('node', '--version'), python=sys.version.split()[0]),
)
json.dump(manifest, open(out, 'w'), indent=1)
open(out, 'a').write('\n')
print(manifest['commits'], manifest['restrictedRefs']['count'], manifest['checkInputsMatchHead'])
