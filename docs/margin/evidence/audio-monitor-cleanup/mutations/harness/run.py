import json, subprocess, sys, os
REPO = '/Users/mac/code/Natively/.claude/worktrees/margin-agpl-migration'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
M = 'main.ts'; P = 'MeetingAudioPipeline.ts'
muts = {
  'M1-monitor-user-no-return': [dict(file=M, from_="if (channel === 'user') return this.wireMicCapture(", to="if (channel === 'user') this.wireMicCapture(")],
  'M2-monitor-system-no-return': [dict(file=M, from_="return this.wireSystemCapture(capture as SystemAudioCapture);", to="this.wireSystemCapture(capture as SystemAudioCapture);")],
  'M3-wireSystem-no-return': [dict(file=M, from_="    return disarmStuckWatchdog;\n", to="", nth=1)],
  'M4-wireMic-no-return': [dict(file=M, from_="    return disarmStuckWatchdog;\n", to="", nth=2)],
  'M5-destroy-skips-cleanup': [dict(file=P, from_="try { cleanup?.(); }", to="try { }")],
  'M6-wire-drops-cleanup': [dict(file=P, from_="if (this.events.monitorCapture) this.monitorCleanups.set(capture, this.events.monitorCapture(capture, channel));", to="this.events.monitorCapture?.(capture, channel);")],
  'M7-single-slot-not-per-instance': [
     dict(file=P, from_="if (this.events.monitorCapture) this.monitorCleanups.set(capture, this.events.monitorCapture(capture, channel));", to="if (this.events.monitorCapture) (this as any).lastCleanup = this.events.monitorCapture(capture, channel);"),
     dict(file=P, from_="const cleanup = this.monitorCleanups.get(capture);", to="const cleanup = (this as any).lastCleanup;")],
  'M8-cleanup-after-destroy': [dict(file=P, from_="try { cleanup?.(); }\n      finally { await capture.destroy(); }", to="try { await capture.destroy(); }\n      finally { cleanup?.(); }")],
  'M9-no-finally-on-throw': [dict(file=P, from_="try { cleanup?.(); }\n      finally { await capture.destroy(); }", to="cleanup?.();\n      await capture.destroy();")],
}
rows = []
for name, spec in [('M0-control', [])] + list(muts.items()):
  with open(os.path.join(HERE, 'spec.json'), 'w') as f:
    json.dump([{'file': s['file'], 'from': s['from_'], 'to': s['to'], **({'nth': s['nth']} if 'nth' in s else {})} for s in spec], f)
  cmd = ['node', 'scripts/margin/isolation/run-node.mjs', '--require', os.path.join(HERE, 'preload.cjs'), '--test', '--test-isolation=none', '--test-reporter=tap', 'electron/audio/__tests__/StuckWatchdogDisarmOnEndAndAbort.test.mjs']
  r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
  log = os.path.join(OUT, name + '.log')
  with open(log, 'w') as f: f.write('$ ' + ' '.join(cmd) + '\n# spec ' + json.dumps(spec) + '\n' + r.stdout + r.stderr + f'\n# exit {r.returncode}\n')
  fails = [l for l in r.stdout.splitlines() if l.startswith('not ok')]
  applied = [l for l in r.stderr.splitlines() if l.startswith('[mutation]')]
  rows.append((name, r.returncode, fails, applied))
  print(name, 'exit', r.returncode, '|', '; '.join(fails) or 'all ok', '|', ' '.join(applied))
with open(os.path.join(OUT, 'summary.txt'), 'w') as f:
  for name, code, fails, applied in rows: f.write(f"{name}\texit={code}\t{' '.join(applied)}\t{'; '.join(fails) or 'all ok'}\n")
