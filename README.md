# Glasshouse Home performance: benchmark data and screenshots

Charts, screenshots and raw runs for the Glasshouse Home performance pull
request, all from the office G3 (OLED55G36LA, webOS 9.2.2) on 26 November 2026.

## Frame timing

Measured with `scripts/tv.sh <tv> frames <scenario>`. All `main` runs came first, then the branch's, with the scenarios interleaved within each side.

| Side | Commit on the TV | What it is |
|---|---|---|
| main | `05d04a19` | `main` at `1005b9a6` (v0.160.0) plus the measuring commits only: no change to how Home behaves |
| branch | `54b5f21a` | the pull request's changes before the review fixes that followed (see the pull request) |
| earlier branch | `02ce6be4` | an earlier state of the branch, kept for reference |

"Cold start" in the raw files is the `cold` scenario: the page reloaded with the server already running, not a TV boot. `rowsReplaced` on main is derived as rebuilds × 5 sections, since that build replaced every row on each rebuild and had no counter.

**The `return` runs are not used.** That scenario launched the web browser over SSH without a terminal, which on this TV can be dropped with no error, and then pressed Home after a fixed 20 s.
- In 1 of the 5 main runs, Home was never hidden.
- In the others, it was hidden only in the last seconds before Home was pressed.

The raw files are kept, but the table and charts leave them out. `tv.sh` now launches with a terminal and waits for the browser to be in front.

Each `bench:` line in `raw/` records the build the TV reported (`build.json`: version, commit, dirty), its webOS and its load average.

- `raw/<side>/<scenario>-<n>.txt`: one run each, five per scenario. Rows on main has ten runs: runs 1 to 3 got none of their keys and are left out.
- `bench_parse.py` reads a folder of runs. `bench_table.py` prints the table of medians (`bench-table.md`), and `bench_charts.py` draws the charts:

```bash
python3 bench_table.py raw/main-1005b9a6 raw/branch-54b5f21a
python3 bench_charts.py raw/main-1005b9a6 raw/branch-54b5f21a "main 1005b9a6" "branch 54b5f21a" out/
```

`bench_charts.py` needs matplotlib. The scripts skip these runs and say which:
- a run whose keys did not all reach the TV;
- a return with no catalogue request, or in which Home was never hidden;
- a cold start with no start marks.

## Functional comparison

`functional/<side>/` holds the same 23 steps on each build, run by `functional/funcheck.sh`. `home-functional-compare.jpg` puts nine of them side by side.

| Side | Commit on the TV |
|---|---|
| main | `a9127c6b`: `1005b9a6` plus the measuring commits plus one reporting the page's script errors in the trace |
| branch | `e5ecb6b7`: the pull request with the review fixes. Its code is the same as the head's; only comments and docs differ |

Every capture went through `functional/shot.sh`. It reads the power state and the app in front before and after the capture, and refuses the picture unless both say Active and Glasshouse Home, so a screen saver or another app cannot pass as Home.

Step 17d (Home pressed just after a return, with the player open) and its follow-up are left out on both sides. The keys sent within about 0.6 s of the return did not reach the page, and OK opened YouTube instead, on both builds.

The playlist's name is blacked out on the Internet TV row.
