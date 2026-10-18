# 261018-0949 - PR 845 picture review and fixes

Reviewed PR 845, `feature/home-tv-info` at `4af1e55405273655faba8e081ce9444e5a732b5b`, against `origin/main`, using code-reviewer-cx and the repository's CLAUDE.md. The user authorised repairs, updating the existing PR, and marking it ready for review when verification is complete. Test changes followed test-audit.

## Findings and repairs

Two high-confidence functional findings were repaired (Critical under the skill's confidence grouping, 95/100 each):

1. `server/assets/home.html:440`: picture requests could start before the saved layout was known, and their replies were accepted after the source or layout changed. The browser reproduced a disabled initial plate appearing, an old HDMI reply replacing Netflix's details, and a late reply restoring a switched-off plate. Picture reads now wait for a layout, invalidate older requests on every refresh, clear the plate when its source changes, and refresh immediately when a catalogue supplies the layout. A timeout alone would not protect a newer source or disabled layout.
2. `server/tvweb.js:1706` and `server/lib/home-picture.js:218`: app-video tracking started only on the first picture API request. With Home enabled after a server restart, a video played and stopped before that request was never recorded. A copied real server, redirected TV filesystem and fake Luna transport reproduced a null Netflix signal on the original code. Tracking now starts and stops with Home's existing enabled-state callback; initialisation occurs before Home can invoke it. The same real-server probe then retained 3840 x 2160, 23.98 Hz Dolby Vision before any app plate request. This also stops the subscription when Home is disabled; API reads cannot restart it.

Only confirmed findings were changed. The existing Home lifecycle callback already covers startup, successful enable, disable, shutdown and external home.json restoration, so a second watcher or polling loop was unnecessary. Recorded app video remains in memory when tracking stops and is lost on server restart, as before. Picture-details visibility does not control recording while Home itself remains enabled.

## Coverage and decisions

Extended the existing browser smoke script at the rendered Home boundary: delayed initial catalogue, HDMI-to-Netflix response ordering, and disabling details with a request in flight. The exact new browser scenario was run against the original HTML and produced four failures; against the fixed HTML it produced none. It uses public routes and relaunch events, with no production test seam.

Consolidated subscription lifetime and app-video retention checks in test-home-picture.js. It feeds video through the subscription message handler, exercises explicit start/stop and verifies that querying a stopped tracker does not restart it. Removed the now-unused test-only notePlaying export. Receiver/HDR tests remain intact. The module test owns tracker lifetime; the browser scenario owns rendering and reply ordering. The full-server exploratory probe separately verified the actual tvweb.js wiring.

Updated docs/dashboard/home.md, docs/TV-CHANGES.md and docs/development/testing.md for the final lifecycle, rendering and regression coverage. Production changed by +27/-8 lines; tooling by +81/-1; tests by +21/-14; documentation by +6/-2 (before this entry).

## Verification

Exploration preceded the official suite, as requested. Scratch scripts, captures and output are under the ignored `.log/review-845/`; test temporary directories used TMPDIR there. No TV deployment, settings change or remote mutation was performed during the review.

Passed:

- `node .log/review-845/probe-picture.cjs`: a delayed reply no longer reveals a disabled plate; the 1920 x 1080 layout was also inspected with 4K 119.88 Hz, 4:4:4 10-bit, VRR and low latency.
- `node .log/review-845/probe-first-playback.cjs`: original null signal versus repaired first-playback Dolby Vision signal, through a copied real server and fake TV transport.
- `node .log/review-845/probe-browser-regression.cjs`: four baseline browser failures, zero with the repair.
- `TMPDIR=... node test/run-all.js`: 83 suites passed, zero failed, on Node 22.15.1.
- `TMPDIR=... BROWSER_CHANNEL=chrome node scripts/check-dashboards.js`: 24 tabs (13 web, 11 TV app), Home arranging, picture, update, editing, uploads, readiness and availability; zero problems.
- `node_modules/.bin/tsc`; `node --check` for all 52 server JS files.
- check-es5.py, check-module-calls.py, check-ui-ids.py, check-strings.py, check-screensavers.py, check-drift.py, check-entity-stability.py and check-entities.py against stats-b8-webos4.json.
- `node scripts/check-upgrade.js`: current tree installs over v0.80.8 and v0.111.0.
- ShellCheck for deploy.sh, tvwebctl, 50-tvweb.sh and tvstats.sh; `git diff --check`.

The original feature's G3/webOS 9.2.2 tests remain the real-TV evidence in the PR. These review fixes were verified locally, not redeployed to the G3. Dolby Vision over HDMI, LCD panels, the TV-app toggle on hardware and other webOS versions remain untested. No further high-confidence issue remained after reviewing the final diff.

## Publication

The existing branch tracks origin/main locally, but PR 845's head is the Nutcasey/glasshouse fork. Push explicitly to that fork's feature/home-tv-info branch, without changing the tracking configuration or force-pushing. The personal identity established for this branch is Garry Casey <nutcasey@gmail.com>; use per-command identity rather than changing global Git configuration. Preserve the PR's TV evidence, state the local verification limits, and mark the existing draft ready after the new CI run passes. No merge is authorised.
