# Scores OCR output against ground-truth.txt: for every ground-truth line, the best
# character similarity (1 - edit distance / length, spaces ignored) among the OCR
# lines, floored at 0; reports the mean and the number of lines read exactly.
#   python3 -I score.py ground-truth.txt ocr.jsonl
import json, sys, unicodedata

def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

# NFKC folds the full-width punctuation Vision returns for mixed Chinese text.
norm = lambda s: ''.join(unicodedata.normalize('NFKC', s).split())
truth = [norm(l) for l in open(sys.argv[1], encoding='utf-8').read().splitlines() if l.strip()]
rows = {}
for line in open(sys.argv[2], encoding='utf-8'):
    r = json.loads(line)
    ocr = [norm(l) for l in r.get('lines', [])]
    sims = [max((max(0.0, 1 - lev(t, o) / max(len(t), 1)) for o in ocr), default=0.0) for t in truth]
    rows[r['file']] = {'mean': round(sum(sims) / len(sims), 4), 'exact': sum(s == 1 for s in sims), 'of': len(truth)}
json.dump(rows, sys.stdout, ensure_ascii=False, indent=1)
