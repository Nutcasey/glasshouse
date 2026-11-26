# Glasshouse Home performance: benchmark data

Charts, screenshots and raw runs for the Glasshouse Home performance pull
request. Everything was measured on the office G3 (OLED55G36LA, webOS 9.2.2)
on 26 November 2026 with `scripts/tv.sh <tv> frames <scenario>` from the
pull request's branch.

| Side | Commit on the TV | What it is |
|---|---|---|
| main | `05d04a19` | `main` at `1005b9a6` (v0.160.0) plus the measuring commits only: no change to how Home behaves |
| branch | `02ce6be4` | the pull request's changes; its server and page code are the same as the pull request's head |

Each `bench:` line in `raw/` records the build the TV reported (`build.json`:
version, commit, dirty), its webOS and its load average.

- `raw/<side>/<scenario>-<n>.txt`: one run each, five per scenario (rows on
  main has ten; runs 1 to 3 got none of their keys and are left out).
- `bench_parse.py` reads a folder of runs, `bench_table.py` prints the table
  of medians (`bench-table.md`), and `bench_charts.py` draws the charts:

```bash
python3 bench_table.py raw/main-1005b9a6 raw/branch-02ce6be4
python3 bench_charts.py raw/main-1005b9a6 raw/branch-02ce6be4 "main 1005b9a6" "branch 02ce6be4" out/
```

`bench_charts.py` needs matplotlib. A run whose keys did not all reach the TV,
a return with no catalogue request, or a cold start with no start marks is
skipped, and the scripts say which.
