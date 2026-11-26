"""Summarise tv.sh frames runs: python3 bench_parse.py <bench dir> -> JSON on stdout."""
import json, os, re, sys, statistics as st
ROWS = 5  # sections on the office G3's Home: app rec dev ch iptv
HARNESS = ('com.webos.service.networkinput/test/sendKeyCode',)
KEYS = {'scroll': 36, 'steps': 8, 'rows': 4, 'recents': 10}

def parse(path):
    run = {'frames': 0, 'over33': 0, 'over100': 0, 'worst': 0, 'hist': [0]*9, 'long': [], 'fn': {}, 'req': {},
           'rebuilds': 0, 'rowsReplaced': 0, 'luna': {}, 'boot': None, 'forks': None, 'bench': None}
    for line in open(path, errors='replace'):
        line = line.strip()
        if line.startswith('bench: '):
            run['bench'] = line[7:]
        elif line.startswith('forks: '):
            run['forks'] = int(line.split()[1])
        elif line.startswith('frames '):
            f = json.loads(line[7:])
            run.setdefault('windows', []).append(f.get('frames', 0))
            for k in ('frames', 'over33', 'over100', 'rebuilds'):
                run[k] += f.get(k, 0)
            run['rowsReplaced'] += f['rowsReplaced'] if 'rowsReplaced' in f else f.get('rebuilds', 0) * ROWS
            run['worst'] = max(run['worst'], f['worst'])
            run['long'] += f.get('long', [])
            for i, n in enumerate(f.get('hist', [])):
                run['hist'][i] += n
            for name, s in f.get('fn', {}).items():
                o = run['fn'].setdefault(name, {'n': 0, 'ms': 0.0, 'max': 0})
                o['n'] += s['n']; o['ms'] += s['n'] * s['avg']; o['max'] = max(o['max'], s['max'])
            for name, s in f.get('req', {}).items():
                o = run['req'].setdefault(name, {'n': 0, 'ms': 0.0, 'max': 0})
                o['n'] += s['n']; o['ms'] += s['n'] * s['avg']; o['max'] = max(o['max'], s['max'])
        elif line.startswith('luna '):
            for uri, n in json.loads(line[5:]).items():
                run['luna'][uri] = run['luna'].get(uri, 0) + n
        elif line.startswith('boot '):
            run['boot'] = json.loads(line[5:])
    run['lunaApp'] = sum(n for u, n in run['luna'].items() if u not in HARNESS)
    return run

def main(d):
    out = {}
    for name in sorted(os.listdir(d)):
        m = re.match(r'(\w+)-(\d+)\.txt$', name)
        if not m:
            continue
        r = parse(os.path.join(d, name))
        if r['bench'] is None or (r['frames'] == 0 and r['boot'] is None):
            continue
        # A run whose keys did not all reach the TV is not the scenario.
        want = KEYS.get(m.group(1))
        if want is not None and r['luna'].get(HARNESS[0], 0) != want:
            sys.stderr.write('skipped %s: %d of %d keys\n' % (name, r['luna'].get(HARNESS[0], 0), want))
            continue
        if m.group(1) == 'return' and not r['req'].get('/api/home/catalogue'):
            sys.stderr.write('skipped %s: no return seen\n' % name)
            continue
        # Home hidden behind the browser draws next to nothing: a run in which
        # every 5 s drew over 100 frames never left Home.
        if m.group(1) == 'return' and min(r.get('windows') or [0]) > 100:
            sys.stderr.write('skipped %s: Home never hidden\n' % name)
            continue
        if m.group(1) == 'cold' and not r['boot']:
            sys.stderr.write('skipped %s: no boot marks\n' % name)
            continue
        out.setdefault(m.group(1), []).append(r)
    json.dump(out, sys.stdout)

if __name__ == '__main__':
    main(sys.argv[1])
