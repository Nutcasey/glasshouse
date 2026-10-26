# Native TV-app DTS forwarding

Experimental shared GStreamer forwarding for OLED83G54LW.BEKYLJP, firmware
33.31.68, webOS 10.3.1 and kernel `5.4.268-329.ptl4tv.5`. This is separate
from the upstream HDMI-input helper. Plex is a test source, not an integration
boundary.

`dts_audiodec` accepts DTS and LG's unknown `A_DTS` caps. It preserves 16-bit
DTS core frames at 48 kHz in IEC 61937 bursts and supplies LG audiosink in PCM
bypass mode. The kernel route connects the active renderer port 0x100 to eARC
output3 with non-PCM signalling. DTS-HD extensions are skipped; this version
does not provide lossless DTS-HD or DTS:X forwarding. DTS Express and
14-bit-packed DTS are outside this initial profile.

The element holds an exclusive stream lock and renews a kernel lease. Stop
and EOS release the route; seek retains it so the native bypass stays valid. A stalled producer loses its route after
20 seconds without a renewal; it cannot resume forwarding on an expired route.
The sink remains in bypass until route removal succeeds. The existing TV
encoder or PCM-mixer route and HAL format are saved and restored. A new
producer releases a module left by a crashed process before acquiring its route. Only one compressed
native stream can hold the output.

## Build

Private target inputs are `kernel.bin`, `kallsyms.txt` and an unmodified
`stock-module.ko` captured from the target. The builder refuses any other raw
kernel hash, checks the module ABI against stock, checks standard imports
against target PREL32 exports and emits guards for every private audio call.
The raw-image SHA-256 is
`c219532590e1d691a459ef8c0faab95745d04d36b6cbee4a32685409f3e7460e`.
The controller also checks the compressed boot image, model and firmware.

```sh
python3 native/dts-forwarding/build-target.py --inputs TARGET --output BUILD --apply --source-index 0
python3 native/dts-forwarding/build-target.py --inputs TARGET --output BUILD --apply --source-index 1
sh native/dts-forwarding/build-plugin.sh BUILD
python3 native/dts-forwarding/package.py BUILD
```

The module builder uses AArch64 GCC/binutils. The plugin builder uses Zig's
`arm-linux-gnueabi.2.17` target: the TV has the soft-float ABI and
`/lib/ld-linux.so.3`. Its ARM32 SDK headers are extracted beneath
`BUILD/sdk/root` from Ubuntu's official packages:
`libglib2.0-dev_2.80.0-6ubuntu3.9_armhf`,
`libgstreamer1.0-dev_1.24.2-1ubuntu0.1_armhf` and
`libgstreamer-plugins-base1.0-dev_1.24.2-1ubuntu0.5_armhf`.
The plugin limits GLib APIs to 2.72. ARM32 GLib data layout matches across
float ABIs; the build still links with soft-float target libraries.
`BUILD/sdk/lib` contains the target's libgstaudio, libgstbase, libgstreamer,
libglib and libgobject `.so.0` files. Firmware and captured libraries remain
private and are not included in the package.

## Installation and control

The separately built package lives at `/var/lib/lg-dts-native`, owned by root
with mode 0700. Its boot hook is installed as
`/var/lib/webosbrew/init.d/90-glasshouse-dts-native`, mode 0700.
Glasshouse's native audio profile pins the four runtime-file hashes; rebuilt
artefacts need qualification and updated pins before the dashboard offers them.
The default Glasshouse deployment does not install this package.

```sh
python3 /var/lib/lg-dts-native/control.py enable
python3 /var/lib/lg-dts-native/control.py status
python3 /var/lib/lg-dts-native/control.py disable
```

Enable owns an EDID-declaration journal and a volatile systemd drop-in. Both
GStreamer plugin-path variables are set because LG supplies a version-specific
path. A private version-specific registry permits scanning without replacing
LG's registry. ARC and umediaserver restart so new native app players inherit
the registration. Apps must supply DTS to that shared pipeline; app-specific
codec refusal or transcoding remains outside the forwarder's control.

Receiver evidence on the Cinema G5/AVC-A10H includes `SYSDA DTS`, normal EOS,
a 30-second native Matroska run and a suspended-producer lease expiry. Plex Casino direct-played its original DTS-HD MA/DTS:X source while the Denon
received DTS core. Seek, notification, pause/resume, EOS and player-crash
recovery were also tried. Full power-cycle persistence remains untested. No audible assessment or
lossless extension forwarding is established by the silent carrier trials.
