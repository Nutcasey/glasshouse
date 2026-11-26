# Glasshouse Home performance: benchmark data

Charts, screenshots and raw runs for the Glasshouse Home performance pull
request. Everything was measured on the office G3 (OLED55G36LA, webOS 9.2.2)
on 26 November 2026, all `main` runs first and then the branch's (scenarios interleaved within each side), with `scripts/tv.sh <tv> frames <scenario>` from the
pull request's branch.

| Side | Commit on the TV | What it is |
|---|---|---|
| main | `05d04a19` | `main` at `1005b9a6` (v0.160.0) plus the measuring commits only: no change to how Home behaves |
| branch | `54b5f21a` | the pull request's changes; its server and page code are the same as the pull request's head |
| earlier branch | `02ce6be4` | an earlier state of the branch, before the guide and media-server fixes, kept for reference |

"Cold start" in the raw files is the `cold` scenario: the page reloaded with the server already running, not a TV boot. `rowsReplaced` on main is derived as rebuilds × 5 sections, since that build replaced every row on each rebuild and had no counter.

Each `bench:` line in `raw/` records the build the TV reported (`build.json`:
version, commit, dirty), its webOS and its load average.

- `raw/<side>/<scenario>-<n>.txt`: one run each, five per scenario (rows on
  main has ten; runs 1 to 3 got none of their keys and are left out).
- `bench_parse.py` reads a folder of runs, `bench_table.py` prints the table
  of medians (`bench-table.md`), and `bench_charts.py` draws the charts:

```bash
python3 bench_table.py raw/main-1005b9a6 raw/branch-54b5f21a
python3 bench_charts.py raw/main-1005b9a6 raw/branch-54b5f21a "main 1005b9a6" "branch 54b5f21a" out/
```

`bench_charts.py` needs matplotlib. A run whose keys did not all reach the TV,
a return with no catalogue request, or a cold start with no start marks is
skipped, and the scripts say which.
