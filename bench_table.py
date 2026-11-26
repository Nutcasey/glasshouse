"""bench_table.py <before dir> <after dir>: markdown table of medians (and range) per scenario."""
import json, os, subprocess, sys, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__))
def load(d): return json.loads(subprocess.check_output([sys.executable, os.path.join(HERE, 'bench_parse.py'), d]))
b, a = load(sys.argv[1]), load(sys.argv[2])
def req(name): return lambda r: r['req'][name]['max'] if name in r['req'] else None
ROWS = [
    ('Return', 'return', 'Catalogue reply, ms', req('/api/home/catalogue')),
    ('Return', 'return', 'Channel guide reply, ms', req('/api/home/guide')),
    ('Return', 'return', 'What is on (/now) reply, ms', req('/api/home/now')),
    ('Return', 'return', 'Row redraws (render calls)', lambda r: r['fn'].get('render', {}).get('n', 0)),
    ('Return', 'return', 'Time in render, ms', lambda r: round(r['fn']['render']['ms']) if 'render' in r['fn'] else 0),
    ('Return', 'return', 'luna-send started (all, background included)', lambda r: r['lunaApp']),
    ('Return', 'return', 'Worst frame, ms', lambda r: r['worst']),
    ('Cold start', 'cold', 'Navigation to first frame, ms', lambda r: r['boot']['firstFrame'] - r['boot']['navStart'] if r['boot'] else None),
    ('Cold start', 'cold', 'First render, ms', lambda r: r['boot']['firstRenderMs'] if r['boot'] else None),
    ('Cold start', 'cold', 'Rows replaced after first paint', lambda r: r['rowsReplaced']),
    ('Cold start', 'cold', 'Longest task, ms', lambda r: max(r['long']) if r['long'] else 0),
    ('Cold start', 'cold', 'Frames over 33 ms', lambda r: r['over33']),
    ('Cold start', 'cold', 'Worst frame, ms', lambda r: r['worst']),
    ('Recent apps', 'recents', 'Frames over 33 ms', lambda r: r['over33']),
    ('Recent apps', 'recents', 'Worst frame, ms', lambda r: r['worst']),
    ('Change rows', 'rows', 'Frames over 33 ms', lambda r: r['over33']),
    ('Change rows', 'rows', 'Worst frame, ms', lambda r: r['worst']),
    ('Change rows', 'rows', 'applyFocus longest, ms', lambda r: r['fn'].get('applyFocus', {}).get('max', 0)),
    ('Scroll (36 keys)', 'scroll', 'Frames over 33 ms', lambda r: r['over33']),
    ('Scroll (36 keys)', 'scroll', 'Worst frame, ms', lambda r: r['worst']),
    ('Scroll (36 keys)', 'scroll', 'applyFocus average, ms', lambda r: round(r['fn']['applyFocus']['ms'] / r['fn']['applyFocus']['n'], 1) if 'applyFocus' in r['fn'] else None),
    ('Single steps', 'steps', 'Worst frame, ms', lambda r: r['worst']),
]
def cell(data, sc, fn):
    vs = [v for v in (fn(r) for r in data.get(sc, [])) if v is not None]
    if not vs: return 'n/a'
    m = st.median(vs)
    m = ('%.1f' % m).rstrip('0').rstrip('.')
    return m if min(vs) == max(vs) else '%s (%s to %s)' % (m, min(vs), max(vs))
print('| Scenario | Measure | main | this branch |')
print('|---|---|---|---|')
for sc_name, sc, label, fn in ROWS:
    print('| %s | %s | %s | %s |' % (sc_name, label, cell(b, sc, fn), cell(a, sc, fn)))
print()
print('runs: ' + ', '.join('%s %d/%d' % (k, len(b.get(k, [])), len(a.get(k, []))) for k in ['scroll', 'steps', 'rows', 'recents', 'return', 'cold']))
