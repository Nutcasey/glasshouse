import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bench_charts as bc
bc.PANELS = [
    ('Catalogue reply on a return', 'ms', 'return', bc.req_max('/api/home/catalogue')),
    ('What is on (/now) reply on a return', 'ms', 'return', bc.req_max('/api/home/now')),
    ('Row redraws per return', 'render() calls', 'return', bc.fn_n('render')),
    ('luna-send started per return', 'calls', 'return', lambda r: r['lunaApp']),
]
b, a = bc.load(sys.argv[1]), bc.load(sys.argv[2])
bc.headline(b, a, sys.argv[3], sys.argv[4], sys.argv[5])
