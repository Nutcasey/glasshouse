# 261017-2322 - Home takeover review and recovery fixes

Reviewed every file in PR #829, from base 4295475 to head 30d81b6, against
CLAUDE.md and the supplied global preferences. The working tree was clean at
the start. The user requested fixes and subsequently authorised updating the
existing PR, including committing and pushing to its fork branch.

The review found the following reproducible defects, all above the review
skill's 80% confidence threshold:

- Legacy migration discarded its settings snapshot and removed com.tvweb.home
  after settings restoration failed. The TV could still target that deleted
  app. Home-key and screen saver restoration failures also discarded recovery
  state. Successful migration deleted saved Home/idle-app selections rather
  than putting them back. Migration now retains its snapshot and old app until
  all restoration steps and the snapshot save succeed, and restores those
  selections. Switch-off and SSH restoration run the same cleanup.
- Layout restoration swallowed write failures and deleted the backup anyway.
  A directory placed at the layout target reproduced both false success and
  backup loss. Restoration now returns failure and retains all saved files
  for retry; a partially restored layout can be retried even after the blank
  marker is gone. Taking Home handles layout preparation failures and returns
  LG's Home on failed staging/mounting where recovery succeeds.
- Giving LG's Home its place back left the compositor's starting notice
  armed. If no remote Home press had yet observed the web app, subsequent Home
  presses still showed the starting toast instead of opening LG's restored
  Home. Releases now clear the notice, including both SSH recovery commands;
  taking the place again arms it for the next boot.
- setStarting saved its local map before applying configd, then treated an
  identical retry as success without repairing the failed configd write. It
  now reconciles configd on retry, while clearing an unused installation stays
  a no-op. The regression fails against the original module because configd
  never receives the requested notice.
- Switching on with com.webos.app.home already in front did not arm the
  first-heartbeat watchdog. The unchanged app id need not produce another
  foreground event. The watch is now armed after taking the place and after
  enable persists the enabled state. Both accelerated operational reproduction
  and the real 20-second regression confirmed fallback to LG's Home.
- GitHub's failed Lint and types job identified SC2086 in two new pidof/kill
  expansions. The boot hook now kills each returned PID separately. The Home
  tab's obsolete cold-start warning was also corrected to describe the toast.

Evidence consulted: the full PR diff and metadata; original and current Home,
takeover, remote-key and lifecycle code; their tests and callers; samrescan;
the recorded G3 takeover observations in TV-RESEARCH.md; the latest work log;
CI workflow definitions and the failed ShellCheck job log. No new platform
mechanism is claimed from simulated TV behaviour.

Operational failure probes used the existing filesystem-backed TV stand-in,
including its manifest reader and symlink mount, with scratch state under
.log/review-runtime. The first-heartbeat timer was shortened only for the
operational probe; the formal regression used its real timeout. No TV was
modified. Regression coverage stays at the existing Home and remote-key
owners, with no new production export or test-only option.

Verification after the repairs:

- node test/run-all.js: 82 suites reported passed, zero failures. The Linux
  watchdog suite explicitly skipped on macOS; 81 suites executed.
- BROWSER_CHANNEL=chrome node scripts/check-dashboards.js: 24 tabs plus Home
  arranging, updates, editing, uploads, readiness and availability, zero
  problems, against the real server and fake Luna services.
- npx tsc; check-es5.py; check-module-calls.py; check-ui-ids.py;
  check-strings.py; check-screensavers.py; check-drift.py;
  check-entity-stability.py; check-entities.py with the B8 fixture;
  check-upgrade.js; ShellCheck on the four CI shell scripts; git diff --check:
  all passed. Upgrade checks installed over 0.80.8 and 0.108.0.
- Before adding this entry: production/UI changes +115/-66, tests +101/-0,
  explanatory docs +11/-2. Playwright Core was installed without saving a
  dependency or changing the lockfile; its profile and test state stayed under
  the repository's ignored scratch directory.

The latest fixes have not been retested on a real TV. Native mount/process
behaviour, the Linux watchdog and old-build migration on a TV remain for TV
validation and CI. The PR stays a draft. Its existing G3 testing record is
preserved, with the latest local proof and these limits prepared for its
Testing section. Push target is Nutcasey/glasshouse feature/home-takeover;
origin names the upstream repository, and the local branch tracks main, so
the push must name the fork and branch explicitly. Personal identity is
Garry Casey <nutcasey@gmail.com>, supplied per command without changing the
machine's work identity. This entry is explicitly added despite .log/ being
ignored, as required by the user's work-log instruction.
