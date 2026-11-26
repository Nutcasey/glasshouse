#!/bin/sh
# funcheck.sh <label>: the same functional steps on whatever build the TV runs,
# a checked screenshot after each, and the page's script errors from the trace.
S=${BENCH_DIR:-$(pwd)}
export PATH=$S/bin:$PATH
TV=${TV:?set TV to the address}
OUT=$S/func/$1
rm -rf "$OUT"; mkdir -p "$OUT"
cd "${GLASSHOUSE:?set GLASSHOUSE to the glasshouse checkout}"
tvsh() { ssh root@$TV "$@"; }
keys() {  # keys k1 k2 ... ; "w" waits a second
  script=''
  for k in "$@"; do
    if [ "$k" = w ]; then script="$script sleep 1;"; continue; fi
    script="$script curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{\"action\":\"rcu\",\"value\":\"$k\"}' http://127.0.0.1:8080/api/control; sleep ${KEYGAP:-0.4};"
  done
  tvsh "$script"
}
# luna-send needs a terminal over ssh, or the call can be dropped.
launch() { ssh -tt root@$TV "luna-send -n 1 -f luna://com.webos.applicationManager/launch '$1'" >/dev/null 2>&1; }
# front <app id>: waits up to 8 s for it in front, and records whether it came.
front() { i=0; while [ $i -lt 16 ]; do f=$(scripts/tv.sh $TV app); [ "$f" = "$1" ] && { echo "  front $1 ok" >> "$OUT/steps.txt"; return 0; }; sleep 0.5; i=$((i+1)); done; echo "  FRONT WRONG: wanted $1, got $f" >> "$OUT/steps.txt"; }
home() { launch '{"id":"com.webos.app.home"}'; }
layout() { tvsh "curl -s -X POST -H 'Content-Type: application/json' -d '$1' http://127.0.0.1:8080/api/home/layout" | head -c 60; echo; }
shot() { "$S/shot.sh" "$OUT/$1.jpg" >> "$OUT/shots.txt" 2>&1 || echo "INVALID $1" >> "$OUT/shots.txt"; }
step() { echo "$(date -u +%T) $1" >> "$OUT/steps.txt"; }

tvsh "cat /var/lib/tvweb/build.json" > "$OUT/build.txt"
from=$(tvsh "wc -l < /var/lib/tvweb/tvweb.log")
power() { tvsh "luna-send -n 1 -f luna://com.webos.service.tvpower/power/getPowerState '{}'" | sed -n 's/.*"state": *"\([^"]*\)".*/\1/p'; }
[ "$(power)" = "ScreenSaver" ] && keys back w w
# A known start: the page loaded afresh, focus on the first app, nothing open.
home; front com.webos.app.home
tvsh "echo reload > /var/lib/tvweb/home-trace"; sleep 14
step "01 rest";            shot 01-rest
step "02 apps right 3";    keys right right right w; shot 02-apps-right3
step "03 apps scrolled";   keys right right right right right right right right right w w; shot 03-apps-scrolled
step "04 back to start";   keys left left left left left left left left left left left left w
step "05 channels row";    keys down down w w w; shot 05-channels-row
step "06 iptv row";        keys down w w; shot 06-iptv-row
step "07 iptv player";     keys ok w w w w w w; shot 07-iptv-player
step "08 player closed";   keys back w w; shot 08-player-closed
step "09 search rail";     keys up up up w left w; shot 09-search-rail
step "10 recents";         keys right w back w w; shot 10-recents
step "11 recents closed";  keys back w w; shot 11-recents-closed
step "12 guide launch";    home; sleep 3; launch '{"id":"com.webos.app.home","params":{"glasshouse":"guide"}}'; sleep 6; shot 12-guide-launch
step "13 guide closed";    keys back w w; shot 13-guide-closed
step "14 play launch";     launch '{"id":"com.webos.app.home","params":{"glasshouse":"play","pl":"pa303c8dc","key":"x1290317"}}'; sleep 8; shot 14-play-launch
step "15 play closed";     keys back w w; shot 15-play-closed
step "16 browser return";  launch '{"id":"com.webos.app.browser"}'; front com.webos.app.browser; sleep 8; home; front com.webos.app.home; sleep 6; shot 16-return-browser
step "17 livetv return";   launch '{"id":"com.webos.app.livetv"}'; front com.webos.app.livetv; sleep 6; home; front com.webos.app.home; sleep 6; shot 17-return-livetv
step "17b preview return";  keys down down w w w; launch '{"id":"com.webos.app.browser"}'; front com.webos.app.browser; sleep 6; home; front com.webos.app.home; sleep 7; shot 17b-return-preview
step "17c shown return";    keys up up up w; launch '{"id":"com.webos.app.browser"}'; front com.webos.app.browser; sleep 6; ssh -tt root@$TV "luna-send -n 1 -f luna://com.webos.applicationManager/closeByAppId '{\"id\":\"com.webos.app.browser\"}'" >/dev/null 2>&1; front com.webos.app.home; sleep 3; shot 17c-shown-return
# Back to Home as "shown" alone, then within 2 s the player opened and Home pressed: Home runs in full and closes it.
step "17d player then Home"; launch '{"id":"com.webos.app.browser"}'; front com.webos.app.browser; sleep 6
ssh -tt root@$TV "luna-send -n 1 -f luna://com.webos.applicationManager/closeByAppId '{\"id\":\"com.webos.app.browser\"}' >/dev/null; sleep 0.6; for k in down down down ok; do curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d \"{\\\"action\\\":\\\"rcu\\\",\\\"value\\\":\\\"\$k\\\"}\" http://127.0.0.1:8080/api/control; sleep 0.15; done; sleep 0.3; luna-send -n 1 -f luna://com.webos.applicationManager/launch '{\"id\":\"com.webos.app.home\"}' >/dev/null" >/dev/null 2>&1
sleep 6; shot 17d-home-closes-player; echo "  17d front: $(scripts/tv.sh $TV app)" >> "$OUT/steps.txt"
home; front com.webos.app.home; sleep 3
step "18 clock off";       layout '{"showClock":false}'; sleep 9; keys w; shot 18-clock-off
step "19 clock on";        layout '{"showClock":true}'; sleep 9; keys w; shot 19-clock-on
step "20 screen saver";    ssh -tt root@$TV "luna-send -n 1 -f luna://com.webos.service.tvpower/power/turnOnScreenSaver '{}'" >/dev/null 2>&1; sleep 8
step "21 after saver";     keys back w w w w; shot 21-after-saver
step "22 reload";          tvsh "echo reload > /var/lib/tvweb/home-trace"; sleep 12; shot 22-after-reload
step "23 home at rest";    home; sleep 4; shot 23-rest-again
tvsh "rm -f /var/lib/tvweb/home-trace"
tvsh "tail -n +$((from + 1)) /var/lib/tvweb/tvweb.log" > "$OUT/log.txt"
grep -a -o '"errors":\[[^]]*\]' "$OUT/log.txt" | grep -v '"errors":\[\]' > "$OUT/errors.txt"
echo "errors: $(wc -l < "$OUT/errors.txt")"; grep -c INVALID "$OUT/shots.txt"; cat "$OUT/build.txt"
