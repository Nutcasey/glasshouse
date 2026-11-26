import json, subprocess, sys, os, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__))
def load(d):
    p = subprocess.run([sys.executable, os.path.join(HERE, 'bench_parse.py'), d], capture_output=True, text=True)
    sys.stderr.write(p.stderr); return json.loads(p.stdout).get('return', [])
def req(name, k='max'): return lambda r: r['req'][name][k] if name in r['req'] else None
def reqn(name): return lambda r: r['req'][name]['n'] if name in r['req'] else 0
ROWS = [
    ('Catalogue reply, ms', req('/api/home/catalogue')),
    ('Channel guide reply, ms', req('/api/home/guide')),
    ('What is on (/now) reply, ms', req('/api/home/now')),
    ('Catalogue requests', reqn('/api/home/catalogue')),
    ('Row redraws (render calls)', lambda r: r['fn'].get('render', {}).get('n', 0)),
    ('Time in render, ms', lambda r: round(r['fn']['render']['ms']) if 'render' in r['fn'] else 0),
    ('Frames over 33 ms', lambda r: r['over33']),
    ('Worst frame, ms', lambda r: r['worst']),
    ('luna-send started (background included)', lambda r: r['lunaApp']),
]
def cell(vs):
    vs = [v for v in vs if v is not None]
    if not vs: return 'n/a'
    m = st.median(vs); m = int(m) if m == int(m) else round(m, 1)
    lo, hi = min(vs), max(vs)
    return str(m) if lo == hi else '%s (%s to %s)' % (m, lo, hi)
a, b = load(sys.argv[1]), load(sys.argv[2])
print('| Measure | main | this branch |\n|---|---|---|')
for name, fn in ROWS:
    print('| %s | %s | %s |' % (name, cell([fn(r) for r in a]), cell([fn(r) for r in b])))
print('\nruns: main %d, branch %d' % (len(a), len(b)))
