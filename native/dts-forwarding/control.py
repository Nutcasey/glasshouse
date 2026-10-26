#!/usr/bin/env python3
"""Own the shared native DTS route and reversible GStreamer registration."""
import fcntl
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

BASE = Path('/var/lib/lg-dts-native')
DROPIN = Path('/run/systemd/system/umediaserver.service.d/90-glasshouse-dts.conf')
PARAMS = Path('/sys/module/gh_dts_native/parameters')
RANK_CONFIG = Path('/etc/gst/gstcool.conf')
RANK_STOCK_SHA256 = '3ce8ba5b6b2b740c252aee58440f0e8d950a62866a81397cfa4ae72851b65c9c'
KEY = 'tv.model.edidType'
TARGET = 'TrueHD+dts'
IDENTITY = {'modelName': 'OLED83G54LW.BEKYLJP', 'firmwareVersion': '33.31.68'}


def run(arguments, timeout=25):
    return subprocess.check_output(arguments, stderr=subprocess.STDOUT, timeout=timeout).decode()


def luna(method, payload):
    command = '/usr/bin/luna-send -w 4000 -n 1 ' + shlex.quote('luna://' + method) + ' ' + shlex.quote(json.dumps(payload))
    result = json.loads(run(['/usr/bin/script', '-q', '-e', '-c', command, '/dev/null'], 8).strip())
    if result.get('returnValue') is not True:
        raise RuntimeError('TV service refused ' + method)
    return result


def verify():
    if os.uname().release != '5.4.268-329.ptl4tv.5':
        raise RuntimeError('Native DTS kernel profile mismatch')
    if hashlib.sha256(Path('/boot/Image.lz4').read_bytes()).hexdigest() != 'b8e8c0019bf7f37379b28a98605710c15212f9fdf40392fb5742ca0f43f8bf53':
        raise RuntimeError('Native DTS boot image mismatch')
    identity = luna('com.webos.service.tv.systemproperty/getSystemInfo', {'keys': list(IDENTITY)})
    if any(identity.get(key) != value for key, value in IDENTITY.items()):
        raise RuntimeError('Native DTS model or firmware profile mismatch')
    manifest = json.loads((BASE / 'manifest.json').read_text())
    if manifest.get('target') != IDENTITY:
        raise RuntimeError('Native DTS manifest profile mismatch')
    required = {'gst/libgstghdts.so', 'control.py', 'gh_dts_native-apply0.ko', 'gh_dts_native-apply1.ko'}
    if set(manifest['files']) != required:
        raise RuntimeError('Incomplete native DTS manifest')
    for name, expected in manifest['files'].items():
        if hashlib.sha256((BASE / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError('Native DTS file verification failed: ' + name)


@contextmanager
def module_lock():
    with (BASE / 'route-control.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def stop_unlocked():
    if PARAMS.exists():
        run(['/sbin/rmmod', 'gh_dts_native'], 8)
    if PARAMS.exists():
        raise RuntimeError('Native DTS module did not unload')


def stop():
    with module_lock():
        stop_unlocked()


def start(index):
    verify()
    if index not in (0, 1) or not (BASE / 'enabled').exists():
        raise RuntimeError('Native DTS forwarding is disabled')
    if PARAMS.exists():
        # The forwarder owns stream.lock before this call. A surviving module
        # therefore belongs to an exited producer and must be released first.
        stop_unlocked()
    settings = luna('com.webos.service.settings/getSystemSettings', {
        'category': 'sound', 'keys': ['soundOutput', 'soundOutputDigital', 'eArcSupport']})['settings']
    if settings.get('soundOutput') != 'external_arc' or settings.get('soundOutputDigital') != 'passThrough':
        raise RuntimeError('Native DTS requires HDMI ARC and Pass Through')
    sound = Path('/proc/lgtv-driver/audio/sndout').read_text()
    if 'EArcOnOff=On' not in sound.replace(' ', ''):
        raise RuntimeError('The active output is not eARC')
    arc = luna('com.webos.service.arccontroller/getARCState', {})
    formats = arc.get('earcCapability', [])
    advanced = arc.get('advancedEarcCapability', [])
    if 'DTS' not in formats and not any(item.get('audioCodingType') == 'DTS' for item in advanced):
        raise RuntimeError('The receiver does not advertise DTS')
    graph = Path('/proc/aaudio/dot_block_connection').read_text()
    (BASE / 'last-start-graph.dot').write_text(graph)
    sources = [source for source in ('encoder_3_out0', 'mixer_0_out0') if source + ' -> output_3_in0' in graph]
    if len(sources) != 1:
        raise RuntimeError('The expected original encoder or PCM mixer output route is absent')
    if 'cluster_renderer_0x' + str(index) not in graph:
        raise RuntimeError('Native renderer ' + str(index) + ' is not present yet')
    try:
        run(['/sbin/insmod', str(BASE / ('gh_dts_native-apply' + str(index) + '.ko')),
             'restore_pcm=' + str(int(sources[0] == 'mixer_0_out0'))], 8)
        if (PARAMS / 'active').read_text().strip() != '1':
            raise RuntimeError('The native route did not become active')
        (BASE / 'last-error.json').unlink(missing_ok=True)
    except Exception:
        stop_unlocked()
        raise


def get_edid():
    return luna('com.webos.service.config/getConfigs', {'configNames': [KEY]})['configs'][KEY]


def set_edid(value):
    if value not in ('TrueHD', TARGET):
        raise RuntimeError('Unknown EDID family')
    luna('com.webos.service.config/setConfigs', {'configs': {KEY: value}})
    if get_edid() != value:
        raise RuntimeError('DTS declaration readback failed')


def restore_declaration():
    journal = BASE / 'config-original.json'
    if journal.exists():
        if json.loads(journal.read_text()) != {'original': 'TrueHD'}:
            raise RuntimeError('Invalid saved native DTS declaration')
        if get_edid() == TARGET:
            set_edid('TrueHD')
            run(['/bin/systemctl', 'restart', 'arccontroller.service'])
        journal.unlink()


def rank_owned():
    staged = BASE / 'gstcool-native.conf'
    return staged.exists() and staged.samefile(RANK_CONFIG)


def enable_rank():
    if rank_owned():
        return
    data = RANK_CONFIG.read_bytes()
    if hashlib.sha256(data).hexdigest() != RANK_STOCK_SHA256:
        raise RuntimeError('Native DTS rank configuration differs from the checked stock file')
    if any(line.split()[4] == str(RANK_CONFIG) for line in Path('/proc/self/mountinfo').read_text().splitlines()):
        raise RuntimeError('Another helper owns the decoder rank configuration')
    text = data.decode()
    if text.count('dts_audiodec=290') != 1 or text.count('[sw_decoder]\n') != 1:
        raise RuntimeError('Unexpected native decoder rank layout')
    text = text.replace('dts_audiodec=290', 'dts_audiodec=356')
    text = text.replace('[sw_decoder]\n', '[sw_decoder]\ndts_audiodec=356\n')
    staged = BASE / 'gstcool-native.conf'
    staged.write_text(text)
    run(['/bin/mount', '--bind', str(staged), str(RANK_CONFIG)])
    if not rank_owned():
        raise RuntimeError('Native DTS decoder rank bind was not confirmed')


def disable_rank():
    if rank_owned():
        run(['/bin/umount', str(RANK_CONFIG)])
    if rank_owned():
        raise RuntimeError('Native DTS decoder rank bind did not release')


def disable():
    (BASE / 'enabled').unlink(missing_ok=True)
    stop()
    disable_rank()
    DROPIN.unlink(missing_ok=True)
    run(['/bin/systemctl', 'daemon-reload'])
    restore_declaration()
    run(['/bin/systemctl', 'restart', 'umediaserver.service'])


def enable():
    verify()
    if Path('/var/lib/lg-dts-core/enabled').exists():
        raise RuntimeError('Disable the HDMI DTS helper before native forwarding')
    value = get_edid()
    if value not in ('TrueHD', TARGET):
        raise RuntimeError('Unknown TV declaration family')
    if value == 'TrueHD':
        journal = BASE / 'config-original.json'
        temporary = journal.with_suffix('.tmp')
        with temporary.open('w') as stream:
            json.dump({'original': value}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(journal)
    try:
        enable_rank()
        set_edid(TARGET)
        DROPIN.parent.mkdir(parents=True, exist_ok=True)
        # The TV sets version-specific variables and disables registry updates.
        # Those override the unversioned plugin path inherited by app players.
        DROPIN.write_text('[Service]\nEnvironment=GST_PLUGIN_PATH=' + str(BASE / 'gst') + '\n'
                          'Environment=GST_PLUGIN_PATH_1_0=' + str(BASE / 'gst') + ':/usr/lib/gstreamer-1.0:/mnt/lg/res/lglib/gstreamer-1.0\n'
                          'Environment=GST_REGISTRY_1_0=' + str(BASE / 'gst-registry.bin') + '\n'
                          'Environment=GST_REGISTRY_UPDATE=yes\n')
        (BASE / 'enabled').touch(mode=0o600)
        run(['/bin/systemctl', 'daemon-reload'])
        run(['/bin/systemctl', 'restart', 'arccontroller.service'])
        run(['/bin/systemctl', 'restart', 'umediaserver.service'])
    except Exception:
        disable()
        raise


def status():
    verify()
    enabled = (BASE / 'enabled').exists()
    active = PARAMS.exists() and (PARAMS / 'active').read_text().strip() == '1'
    print(json.dumps({'enabled': enabled, 'running': enabled and DROPIN.exists() and rank_owned(),
                      'active': active, 'scope': 'native-apps', 'format': 'DTS core 48 kHz'}))


if __name__ == '__main__':
    if os.geteuid() != 0 or len(sys.argv) < 2 or sys.argv[1] not in ('start', 'stop', 'enable', 'disable', 'boot', 'status'):
        sys.exit('Usage: control.py start 0|1 | stop | enable | disable | boot | status (root)')
    try:
        action = sys.argv[1]
        if action == 'start':
            with module_lock():
                start(int(sys.argv[2]))
        elif action == 'stop':
            stop()
        else:
            # Service restart can stop a pipeline whose cleanup calls stop().
            # Its module lock must remain independent of this settings lock.
            with (BASE / 'control.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if action == 'boot':
                    if (BASE / 'enabled').exists():
                        try:
                            enable()
                        except Exception:
                            disable()
                            raise
                else:
                    globals()[action]()
    except Exception as error:
        try:
            (BASE / 'last-error.json').write_text(json.dumps({'action': sys.argv[1], 'error': str(error)}) + '\n')
        except OSError:
            pass
        sys.exit('Native DTS: ' + str(error))
