#!/bin/sh
# shot.sh <out.jpg>: wake the TV with a Home relaunch, wait, and capture only if
# the TV is Active, Home is in front and no screen saver is up, before and after.
S=${BENCH_DIR:-$(pwd)}
export PATH=$S/bin:$PATH
TV=${TV:?set TV to the address}
cd "${GLASSHOUSE:?set GLASSHOUSE to the glasshouse checkout}"
state() { scripts/tv.sh $TV luna com.webos.service.tvpower/power/getPowerState | tr -d ' \n' | sed -n 's/.*"state":"\([^"]*\)".*/\1/p'; }
s1=$(state); a1=$(scripts/tv.sh $TV app)
scripts/tv.sh $TV capture "$1" >/dev/null || exit 1
s2=$(state); a2=$(scripts/tv.sh $TV app)
echo "$1: power $s1/$s2, front $a1/$a2"
[ "$s1" = Active ] && [ "$s2" = Active ] && [ "$a1" = com.webos.app.home ] && [ "$a2" = com.webos.app.home ] || { echo "NOT VALID: $1"; exit 1; }
