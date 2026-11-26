"""bench_charts.py <before dir> <after dir> <before label> <after label> <out dir>"""
import json, os, subprocess, sys, statistics as st
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
BEFORE_C, AFTER_C = '#eb6834', '#2a78d6'
INK, INK2, GRID, SURF = '#0b0b0b', '#52514e', '#e4e3df', '#fcfcfb'
plt.rcParams.update({'font.family': 'Helvetica Neue', 'font.size': 11, 'axes.edgecolor': GRID, 'axes.labelcolor': INK2,
                     'xtick.color': INK2, 'ytick.color': INK2, 'figure.facecolor': SURF, 'axes.facecolor': SURF})

def load(d):
    return json.loads(subprocess.check_output([sys.executable, os.path.join(HERE, 'bench_parse.py'), d]))

def values(data, scenario, fn):
    out = []
    for r in data.get(scenario, []):
        v = fn(r)
        if v is not None:
            out.append(v)
    return out

def req_max(name):
    return lambda r: r['req'][name]['max'] if name in r['req'] else None
def fn_n(name):
    return lambda r: r['fn'].get(name, {}).get('n', 0)
def fn_ms(name):
    return lambda r: r['fn'][name]['ms'] if name in r['fn'] else 0
def longest(r):
    return max(r['long']) if r['long'] else 0
def boot_ms(r):
    b = r['boot']
    return b['firstFrame'] - b['navStart'] if b else None

# (title, unit, scenario, extractor)
PANELS = [
    ('Catalogue reply on a return', 'ms', 'return', req_max('/api/home/catalogue')),
    ('Channel guide reply on a return', 'ms', 'return', req_max('/api/home/guide')),
    ('Row redraws per return', 'render() calls', 'return', fn_n('render')),
    ('Time redrawing rows per return', 'ms', 'return', fn_ms('render')),
    ('Rows rebuilt after a cold start', 'rows replaced', 'cold', lambda r: r['rowsReplaced']),
    ('Longest task after a cold start', 'ms', 'cold', longest),
    ('Worst frame after a cold start', 'ms', 'cold', lambda r: r['worst']),
    ('Frames over 33 ms after a cold start', 'frames', 'cold', lambda r: r['over33']),
]

def headline(b, a, lb, la, out):
    fig, axes = plt.subplots(2, 4, figsize=(16, 8.4))
    for ax, (title, unit, sc, fn) in zip(axes.flat, PANELS):
        vb, va = values(b, sc, fn), values(a, sc, fn)
        mb, ma = (st.median(vb) if vb else 0), (st.median(va) if va else 0)
        ax.bar([0], [mb], width=0.56, color=BEFORE_C, zorder=2)
        ax.bar([1], [ma], width=0.56, color=AFTER_C, zorder=2)
        for x, vs in ((0, vb), (1, va)):
            n = len(vs)
            for i, v in enumerate(vs):
                ax.plot(x - 0.15 + (0.3 * i / max(1, n - 1)), v, 'o', ms=5, color='white', mec=INK, mew=1, zorder=3)
        top = max([mb, ma] + vb + va + [1])
        for x, m, vs in ((0, mb, vb), (1, ma, va)):
            ax.text(x, max([m] + vs) + top * 0.04, ('%d' % round(m)) if m >= 10 or m == int(m) else '%.1f' % m,
                    ha='center', va='bottom', color=INK, fontsize=13, fontweight='bold')
        ax.set_ylim(0, top * 1.22)
        ax.set_xticks([0, 1]); ax.set_xticklabels([lb, la])
        ax.set_title(title, loc='left', color=INK, fontsize=12.5, pad=10)
        ax.set_ylabel(unit)
        ax.grid(axis='y', color=GRID, lw=0.8, zorder=0)
        for s in ('top', 'right'):
            ax.spines[s].set_visible(False)
        n = '%d runs each' % min(len(vb), len(va)) if vb and va else ''
        ax.text(1.0, -0.17, n, transform=ax.transAxes, ha='right', fontsize=9, color=INK2)
    fig.suptitle('Glasshouse Home on the office G3 (webOS 9.2.2): bars are the median, dots single runs',
                 x=0.01, ha='left', fontsize=14, color=INK)
    fig.tight_layout(rect=(0, 0, 1, 0.95), h_pad=3)
    fig.savefig(out, dpi=150)

BUCKETS = ['0-17', '17-34', '34-50', '50-67', '67-100', '100-150', '150-250', '250-500', 'over 500']

def histogram(b, a, lb, la, scenarios, out, title):
    def total(data):
        h = [0] * 9
        runs = 0
        for sc in scenarios:
            for r in data.get(sc, []):
                runs += 1
                for i, n in enumerate(r['hist']):
                    h[i] += n
        return h, runs
    hb, nb = total(b)
    ha, na = total(a)
    xs = range(1, 9)
    fig, ax = plt.subplots(figsize=(11, 4.6))
    w = 0.38
    ax.bar([x - w / 2 - 0.01 for x in xs], [hb[i] / nb for i in xs], width=w, color=BEFORE_C, label=lb, zorder=2)
    ax.bar([x + w / 2 + 0.01 for x in xs], [ha[i] / na for i in xs], width=w, color=AFTER_C, label=la, zorder=2)
    for x in xs:
        for dx, v in ((-w / 2, hb[x] / nb), (w / 2, ha[x] / na)):
            if v:
                ax.text(x + dx, v, '%.1f' % v, ha='center', va='bottom', fontsize=10, color=INK)
    ax.set_xticks(list(xs)); ax.set_xticklabels([BUCKETS[i] + ' ms' for i in xs])
    ax.set_ylabel('frames per run')
    ax.set_title(title, loc='left', color=INK, fontsize=12.5)
    ax.legend(frameon=False, loc='upper right')
    ax.grid(axis='y', color=GRID, lw=0.8, zorder=0)
    for s in ('top', 'right'):
        ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(out, dpi=150)

def worst(b, a, lb, la, out):
    scs = ['scroll', 'steps', 'rows', 'recents', 'return', 'cold']
    names = {'scroll': 'Scroll the Apps row', 'steps': 'Single steps', 'rows': 'Change rows', 'recents': 'Recent apps',
             'return': 'Return from an app', 'cold': 'Cold start'}
    fig, ax = plt.subplots(figsize=(11, 4.6))
    for i, sc in enumerate(scs):
        vb = values(b, sc, lambda r: r['worst']); va = values(a, sc, lambda r: r['worst'])
        mb = st.median(vb) if vb else 0; ma = st.median(va) if va else 0
        y = len(scs) - 1 - i
        ax.plot([mb, ma], [y, y], color=GRID, lw=3, zorder=1)
        ax.plot(mb, y, 'o', ms=11, color=BEFORE_C, mec=SURF, mew=2, zorder=3, label=lb if i == 0 else None)
        ax.plot(ma, y, 'o', ms=11, color=AFTER_C, mec=SURF, mew=2, zorder=3, label=la if i == 0 else None)
        label = '%d ms' % mb if round(mb) == round(ma) else '%d to %d ms' % (mb, ma)
        ax.text(max(mb, ma) + 6, y, label, va='center', fontsize=10.5, color=INK)
    ax.set_yticks(range(len(scs))); ax.set_yticklabels([names[s] for s in reversed(scs)])
    ax.axvline(16.7, color=INK2, lw=0.8, ls=':', zorder=0)
    ax.text(16.7, -0.75, ' one frame at 60 Hz', fontsize=9, color=INK2, va='center')
    ax.set_xlabel('worst frame gap, ms (median of runs)')
    ax.set_xlim(0, 200)
    ax.set_ylim(-1, len(scs) - 0.4)
    ax.set_title('Worst frame in each scenario', loc='left', color=INK, fontsize=12.5, pad=28)
    ax.legend(frameon=False, loc='lower right', bbox_to_anchor=(1, 1.0), ncol=2)
    ax.grid(axis='x', color=GRID, lw=0.8, zorder=0)
    for s in ('top', 'right', 'left'):
        ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(out, dpi=150)

if __name__ == '__main__':
    bd, ad, lb, la, out = sys.argv[1:6]
    os.makedirs(out, exist_ok=True)
    b, a = load(bd), load(ad)
    headline(b, a, lb, la, os.path.join(out, 'home-perf-headline.png'))
    histogram(b, a, lb, la, ['cold'], os.path.join(out, 'home-perf-cold-frames.png'),
              'Slow frames in the 10 s after a cold start, by length (frames under 17 ms left out)')
    worst(b, a, lb, la, os.path.join(out, 'home-perf-worst-frame.png'))
    print('written to', out)
